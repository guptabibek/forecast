// Outstanding / AR-AP read-model extracted from MargEdeService.
// Pure read path: depends only on PrismaService + marg-normalize util —
// no sync, queue, storage, audit, or accounting dependencies.

import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  ActualType,
  AuditAction,
  BatchStatus,
  CustomerType,
  DimensionStatus,
  GLAccountType,
  GoodsReceiptStatus,
  InventoryTransactionType,
  JournalEntryStatus,
  LedgerEntryType,
  LocationType,
  MargReconciliationStatus,
  MargReconciliationType,
  NormalBalance,
  PeriodType,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { inflateRawSync } from 'zlib';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { AccountingService } from '../manufacturing/services/accounting.service';
import {
  CreateMargConfigDto,
  CreateMargGlMappingRuleDto,
  UpdateMargConfigDto,
  UpdateMargGlMappingRuleDto,
} from './dto';
import { MargSyncLogStatusDto, toMargSyncLogStatusDto } from './dto/marg-sync-log-status.dto';
import { decryptMargCompressedPayload, decryptMargPayload } from './marg-decrypt.util';
import { MargRawPageStorage } from './marg-raw-page-storage';
import {
  classifyMargSyncError,
  MARG_FAILURE_TYPE,
  MARG_RAW_PAGE_STATUS,
  MARG_SYNC_MODE,
  MARG_SYNC_SCOPE,
  MARG_SYNC_STAGE,
  MargSyncMode,
  MargSyncScope,
  MargSyncStage,
} from './marg-sync.types';
import { SyncLogger } from './sync-logger';
import { normalizeMargCode as normalizeMargCodeUtil, parseMargDate as parseMargDateUtil, masterFallbackName as masterFallbackNameUtil } from './marg-normalize.util';

type FinancialReportFieldType = 'string' | 'number' | 'date';

type FinancialReportFilterOperator =
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'isNull'
  | 'isNotNull';

interface FinancialReportColumnFilter {
  field: string;
  operator: FinancialReportFilterOperator;
  value?: unknown;
}

interface FinancialReportColumnSpec<T> {
  value: (row: T) => unknown;
  type: FinancialReportFieldType;
}


@Injectable()
export class MargOutstandingService {
  constructor(private readonly prisma: PrismaService) {}

  private get margPrisma(): any {
    return this.prisma;
  }

  private normalizeMargCode(value: unknown, maxLength = 20): string {
    return normalizeMargCodeUtil(value, maxLength);
  }

  private parseMargDate(value: any): Date | null {
    return parseMargDateUtil(value);
  }

  private masterFallbackName(label: string, code: string): string {
    return masterFallbackNameUtil(label, code);
  }

  /**
   * Outstanding balance summary, broken down by Marg account-group family so
   * customers (sundry debtors, group prefix `C`) and suppliers (sundry
   * creditors, group prefix `D`) are reported separately. Each row also
   * includes Marg-style aging buckets (current / 31-60 / 61-90 / 91+) plus
   * the count of open invoices and the latest activity date — what the
   * client expects on an AR / AP outstanding-summary page.
   */
  async getMargOutstandingSummary(
    tenantId: string,
    options: {
      partyType?: 'CUSTOMER' | 'SUPPLIER' | 'ALL';
      companyId?: number;
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
      filters?: string;
      /** ISO date — recompute aging as of this anchor instead of "today". */
      asOfDate?: string | null;
      /** Custom bucket upper-bounds in days, e.g. [30, 60, 90, 180]. */
      bucketBoundaries?: string | number[] | null;
      /** Window in days used for the DSO calculation (defaults to 90). */
      dsoDays?: number | null;
    } = {},
  ): Promise<{
    asOf: string;
    asOfExplicit: boolean;
    partyType: 'CUSTOMER' | 'SUPPLIER' | 'ALL';
    bucketDefinitions: Array<{ key: string; label: string; fromDays: number; toDays: number | null }>;
    summary: {
      partyCount: number;
      openInvoiceCount: number;
      totalOutstanding: number;
      creditBalance: number;
      signedBalance: number;
      pdLessTotal: number;
      currentBucket: number;
      days31To60Bucket: number;
      days61To90Bucket: number;
      days91PlusBucket: number;
      bucketTotals: number[];
      dso: {
        days: number;
        totalCreditSales: number;
        windowDays: number;
        windowStart: string;
        windowEnd: string;
      } | null;
      topOverdue: Array<{
        partyCode: string;
        partyName: string | null;
        companyId: number;
        overdueAmount: number;
        totalOutstanding: number;
      }>;
    };
    rows: Array<{
      partyCode: string;
      partyName: string | null;
      groupCode: string | null;
      groupName: string | null;
      companyId: number;
      openInvoiceCount: number;
      totalOutstanding: number;
      creditBalance: number;
      signedBalance: number;
      pdLess: number;
      currentBucket: number;
      days31To60: number;
      days61To90: number;
      days91Plus: number;
      bucketAmounts: number[];
      avgDaysOutstanding: number | null;
      lastInvoiceDate: Date | null;
    }>;
    total: number;
  }> {
    const partyType = options.partyType ?? 'ALL';
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 10000);
    const offset = Math.max(options.offset ?? 0, 0);
    const boundaries = this.parseBucketBoundaries(options.bucketBoundaries);
    const bucketCount = boundaries.length + 1;
    const bucketDefinitions = this.buildBucketDefinitions(boundaries);
    const { asOf, asOfIso, explicit } = this.resolveAsOf(options.asOfDate);
    const dsoDays = options.dsoDays != null && Number.isFinite(Number(options.dsoDays))
      ? Math.min(Math.max(Math.round(Number(options.dsoDays)), 7), 365)
      : 90;

    // Marg encodes party type in `groupCode`: anything starting with C is a
    // customer (debtor), anything starting with D is a supplier (creditor).
    // Outstanding rows that have no group fall through as 'OTHER'.
    const groupFilter = partyType === 'CUSTOMER'
      ? { startsWith: 'C' }
      : partyType === 'SUPPLIER'
        ? { startsWith: 'D' }
        : undefined;

    // Always exclude source-deleted rows: an outstanding that Marg's
    // authoritative snapshot dropped (closeUnseenMargOutstandings) has been
    // settled or cancelled at source and must not surface in open AR/AP aging.
    const baseWhere: Prisma.MargOutstandingWhereInput = {
      tenantId,
      sourceDeleted: false,
      ...(options.companyId ? { companyId: options.companyId } : {}),
      ...(groupFilter ? { groupCode: groupFilter } : {}),
    };

    // Aggregate per (companyId, ord, groupCode). We filter out rows where the
    // outstanding has been fully settled (balance ~ 0) so the report only
    // shows actually-open exposure.
    const allRows = await this.margPrisma.margOutstanding.findMany({
      where: { ...baseWhere, balance: { not: 0 } },
      select: {
        companyId: true,
        ord: true,
        groupCode: true,
        date: true,
        days: true,
        balance: true,
        pdLess: true,
      },
    });

    interface Bucket {
      partyCode: string;
      groupCode: string | null;
      companyId: number;
      openInvoiceCount: number;
      totalOutstanding: number;
      creditBalance: number;
      signedBalance: number;
      pdLess: number;
      bucketAmounts: number[];
      /** Sum of (exposure × days) — divided by total exposure → weighted avg days. */
      weightedDaysExposure: number;
      lastInvoiceDate: Date | null;
    }
    const grouped = new Map<string, Bucket>();
    for (const row of allRows) {
      const key = `${row.companyId}|${row.ord}|${row.groupCode ?? ''}`;
      const balance = row.balance != null ? Number(row.balance) : 0;
      const pdLess = row.pdLess != null ? Number(row.pdLess) : 0;
      // When the caller supplies an explicit asOfDate, ignore stored `days`
      // (which was anchored at sync time) and recompute from invoice→asOf so
      // the report is correct for the requested anchor.
      const days = explicit
        ? this.resolveOutstandingAgeDays(null, row.date, asOf)
        : this.resolveOutstandingAgeDays(row.days, row.date, asOf);
      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          partyCode: row.ord,
          groupCode: row.groupCode,
          companyId: row.companyId,
          openInvoiceCount: 0,
          totalOutstanding: 0,
          creditBalance: 0,
          signedBalance: 0,
          pdLess: 0,
          bucketAmounts: new Array(bucketCount).fill(0),
          weightedDaysExposure: 0,
          lastInvoiceDate: null,
        };
        grouped.set(key, entry);
      }
      const groupCode = (row.groupCode ?? '').toUpperCase();
      const isSupplier = groupCode.startsWith('D');
      const isCustomer = groupCode.startsWith('C');
      const exposure = isSupplier
        ? Math.max(-balance, 0)
        : isCustomer
          ? Math.max(balance, 0)
          : Math.abs(balance);
      const credit = isSupplier
        ? Math.max(balance, 0)
        : isCustomer
          ? Math.max(-balance, 0)
          : 0;

      if (exposure > 0) entry.openInvoiceCount += 1;
      entry.totalOutstanding += exposure;
      entry.creditBalance += credit;
      entry.signedBalance += balance;
      entry.pdLess += pdLess;
      entry.bucketAmounts[this.assignBucketIndex(days, boundaries)] += exposure;
      entry.weightedDaysExposure += exposure * days;
      if (!entry.lastInvoiceDate || row.date > entry.lastInvoiceDate) {
        entry.lastInvoiceDate = row.date;
      }
    }

    // Resolve party names from MargParty (CID == ord, scoped by companyId)
    // and group names from MargAccountGroup. Both lookups are cheap because
    // we already have the distinct party codes.
    const partyCodeKeys = Array.from(grouped.values()).map((g) => ({ companyId: g.companyId, cid: g.partyCode }));
    const partyNameMap = new Map<string, string>();
    if (partyCodeKeys.length > 0) {
      const parties = await this.margPrisma.margParty.findMany({
        where: {
          tenantId,
          OR: partyCodeKeys.map((k) => ({ companyId: k.companyId, cid: k.cid })),
        },
        select: { companyId: true, cid: true, parName: true },
      });
      for (const p of parties) {
        partyNameMap.set(`${p.companyId}|${p.cid}`, p.parName);
      }
    }
    const groupCodeKeys = new Set(Array.from(grouped.values()).map((g) => g.groupCode).filter(Boolean) as string[]);
    const groupNameMap = new Map<string, string>();
    if (groupCodeKeys.size > 0) {
      const groups = await this.margPrisma.margAccountGroup.findMany({
        where: { tenantId, aid: { in: Array.from(groupCodeKeys) } },
        select: { aid: true, name: true },
      });
      for (const g of groups) {
        groupNameMap.set(g.aid, g.name);
      }
    }

    // Project each grouped entry onto the on-the-wire shape. Legacy fields
    // (currentBucket, days31To60, days61To90, days91Plus) are populated from
    // the first 4 dynamic buckets so existing UI code keeps rendering. New
    // consumers should read `bucketAmounts[]` which is canonical.
    const rowsWithNames = Array.from(grouped.values()).map((r) => {
      const bucketAmounts = [...r.bucketAmounts];
      // Pad to at least 4 entries so legacy [0..3] indexing is always defined.
      while (bucketAmounts.length < 4) bucketAmounts.push(0);
      return {
        partyCode: r.partyCode,
        partyName: partyNameMap.get(`${r.companyId}|${r.partyCode}`) ?? null,
        groupCode: r.groupCode,
        groupName: r.groupCode ? groupNameMap.get(r.groupCode) ?? null : null,
        companyId: r.companyId,
        openInvoiceCount: r.openInvoiceCount,
        totalOutstanding: r.totalOutstanding,
        creditBalance: r.creditBalance,
        signedBalance: r.signedBalance,
        pdLess: r.pdLess,
        currentBucket: bucketAmounts[0],
        days31To60: bucketAmounts[1],
        days61To90: bucketAmounts[2],
        // For default 4-bucket scheme, last bucket = bucketAmounts[3]. For
        // custom schemes with more buckets, sum everything past the third
        // boundary so the legacy "91+" field stays meaningful.
        days91Plus:
          bucketAmounts.length <= 4
            ? bucketAmounts[3] ?? 0
            : bucketAmounts.slice(3).reduce((a, b) => a + b, 0),
        bucketAmounts: r.bucketAmounts,
        avgDaysOutstanding:
          r.totalOutstanding > 0 ? Math.round((r.weightedDaysExposure / r.totalOutstanding) * 10) / 10 : null,
        lastInvoiceDate: r.lastInvoiceDate,
      };
    });

    const columnSpecs: Record<string, FinancialReportColumnSpec<(typeof rowsWithNames)[number]>> = {
      partyCode: { type: 'string', value: (r) => r.partyCode },
      partyName: { type: 'string', value: (r) => r.partyName ?? r.partyCode },
      companyId: { type: 'number', value: (r) => r.companyId },
      groupCode: { type: 'string', value: (r) => r.groupCode },
      groupName: { type: 'string', value: (r) => r.groupName ?? r.groupCode },
      openInvoiceCount: { type: 'number', value: (r) => r.openInvoiceCount },
      totalOutstanding: { type: 'number', value: (r) => r.totalOutstanding },
      creditBalance: { type: 'number', value: (r) => r.creditBalance },
      signedBalance: { type: 'number', value: (r) => r.signedBalance },
      pdLess: { type: 'number', value: (r) => r.pdLess },
      currentBucket: { type: 'number', value: (r) => r.currentBucket },
      days31To60: { type: 'number', value: (r) => r.days31To60 },
      days61To90: { type: 'number', value: (r) => r.days61To90 },
      days91Plus: { type: 'number', value: (r) => r.days91Plus },
      avgDaysOutstanding: { type: 'number', value: (r) => r.avgDaysOutstanding },
      lastInvoiceDate: { type: 'date', value: (r) => r.lastInvoiceDate },
    };

    const filtered = this.filterFinancialReportRows(rowsWithNames, options.filters, columnSpecs);
    const sorted = this.sortFinancialReportRows(
      filtered,
      options.sortBy,
      options.sortDir,
      columnSpecs,
      (a, b) => (b.totalOutstanding + b.creditBalance) - (a.totalOutstanding + a.creditBalance),
    );

    const bucketTotals = new Array(bucketCount).fill(0) as number[];
    const summaryAccum = sorted.reduce(
      (acc, r) => {
        for (let i = 0; i < r.bucketAmounts.length && i < bucketCount; i += 1) {
          bucketTotals[i] += r.bucketAmounts[i];
        }
        return {
          partyCount: acc.partyCount + 1,
          openInvoiceCount: acc.openInvoiceCount + r.openInvoiceCount,
          totalOutstanding: acc.totalOutstanding + r.totalOutstanding,
          creditBalance: acc.creditBalance + r.creditBalance,
          signedBalance: acc.signedBalance + r.signedBalance,
          pdLessTotal: acc.pdLessTotal + r.pdLess,
        };
      },
      { partyCount: 0, openInvoiceCount: 0, totalOutstanding: 0, creditBalance: 0, signedBalance: 0, pdLessTotal: 0 },
    );

    // Top-N most-overdue: parties with the largest exposure in buckets >
    // boundaries[0] (i.e. anything past the first "current" bucket). Limited
    // to 10 — this is a CFO-facing "who do I chase first?" list.
    const topOverdue = [...sorted]
      .map((r) => {
        const overdue = r.bucketAmounts.slice(1).reduce((a, b) => a + b, 0);
        return {
          partyCode: r.partyCode,
          partyName: r.partyName,
          companyId: r.companyId,
          overdueAmount: overdue,
          totalOutstanding: r.totalOutstanding,
        };
      })
      .filter((r) => r.overdueAmount > 0)
      .sort((a, b) => b.overdueAmount - a.overdueAmount)
      .slice(0, 10);

    // Customers only — DSO is undefined for payables. Run only when the
    // active filter is CUSTOMER or ALL (we still scope to receivables only
    // by passing customer-side totalReceivables in).
    const totalReceivables = sorted.reduce((acc, r) => {
      const code = (r.groupCode ?? '').toUpperCase();
      if (code.startsWith('C') || (partyType === 'CUSTOMER' && !code)) {
        return acc + r.totalOutstanding;
      }
      return acc;
    }, 0);

    const dso =
      partyType !== 'SUPPLIER'
        ? await this.computeDso(tenantId, {
            totalReceivables,
            windowEnd: asOf,
            windowDays: dsoDays,
            companyId: options.companyId,
          })
        : null;

    const paged = sorted.slice(offset, offset + limit);

    return {
      asOf: asOfIso,
      asOfExplicit: explicit,
      partyType,
      bucketDefinitions,
      summary: {
        partyCount: summaryAccum.partyCount,
        openInvoiceCount: summaryAccum.openInvoiceCount,
        totalOutstanding: summaryAccum.totalOutstanding,
        creditBalance: summaryAccum.creditBalance,
        signedBalance: summaryAccum.signedBalance,
        pdLessTotal: summaryAccum.pdLessTotal,
        currentBucket: bucketTotals[0] ?? 0,
        days31To60Bucket: bucketTotals[1] ?? 0,
        days61To90Bucket: bucketTotals[2] ?? 0,
        days91PlusBucket:
          bucketTotals.length <= 4
            ? bucketTotals[3] ?? 0
            : bucketTotals.slice(3).reduce((a, b) => a + b, 0),
        bucketTotals,
        dso,
        topOverdue,
      },
      rows: paged,
      total: sorted.length,
    };
  }

  /**
   * Per-party outstanding invoice detail — one row per open Marg invoice for
   * the requested party (customer or supplier), with VCN, date, days, original
   * amount, current balance, and bucket. Drives the drill-down view from the
   * outstanding summary.
   */
  async getMargOutstandingDetail(
    tenantId: string,
    partyCode: string,
    options: {
      companyId?: number;
      includeSettled?: boolean;
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
      filters?: string;
      asOfDate?: string | null;
      bucketBoundaries?: string | number[] | null;
      /** Filter to a single bucket index (0-based against bucketDefinitions). */
      bucketIndex?: number | null;
    } = {},
  ): Promise<{
    partyCode: string;
    partyName: string | null;
    groupCode: string | null;
    groupName: string | null;
    asOf: string;
    asOfExplicit: boolean;
    bucketDefinitions: Array<{ key: string; label: string; fromDays: number; toDays: number | null }>;
    invoices: Array<{
      vcn: string | null;
      date: Date;
      days: number;
      finalAmt: number;
      balance: number;
      pdLess: number;
      voucher: string | null;
      sVoucher: string | null;
      bucket: 'CURRENT' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_91_PLUS';
      bucketIndex: number;
    }>;
    totals: {
      finalAmt: number;
      balance: number;
      pdLess: number;
      openCount: number;
      bucketTotals: number[];
    };
    pagination: { limit: number; offset: number; total: number; hasMore: boolean };
  }> {
    const normalizedCode = this.normalizeMargCode(partyCode);
    if (!normalizedCode) {
      throw new BadRequestException('partyCode is required');
    }
    const boundaries = this.parseBucketBoundaries(options.bucketBoundaries);
    const bucketDefinitions = this.buildBucketDefinitions(boundaries);
    const bucketCount = boundaries.length + 1;
    const { asOf, asOfIso, explicit } = this.resolveAsOf(options.asOfDate);

    if (
      options.bucketIndex !== undefined &&
      options.bucketIndex !== null &&
      (!Number.isInteger(options.bucketIndex) || options.bucketIndex < 0 || options.bucketIndex >= bucketCount)
    ) {
      throw new BadRequestException(`bucketIndex must be an integer in [0, ${bucketCount - 1}]`);
    }

    const where: Prisma.MargOutstandingWhereInput = {
      tenantId,
      // Excludes Marg-side closed/settled rows. The `includeSettled` flag
      // below still controls the zero-balance display; source_deleted is
      // a stronger "this row no longer exists in Marg" signal that should
      // not show up in either mode of the report.
      sourceDeleted: false,
      ord: normalizedCode,
      ...(options.companyId ? { companyId: options.companyId } : {}),
      ...(options.includeSettled ? {} : { balance: { not: 0 } }),
    };

    const rows = await this.margPrisma.margOutstanding.findMany({
      where,
      orderBy: [{ date: 'asc' }, { vcn: 'asc' }],
      select: {
        companyId: true,
        vcn: true,
        date: true,
        days: true,
        finalAmt: true,
        balance: true,
        pdLess: true,
        voucher: true,
        sVoucher: true,
        groupCode: true,
      },
    });

    const groupCode = rows[0]?.groupCode ?? null;
    const partyName = await this.lookupMargPartyName(tenantId, rows[0]?.companyId, normalizedCode);
    const groupName = groupCode ? await this.lookupMargAccountGroupName(tenantId, groupCode) : null;

    const invoices = rows.map((r) => {
      // Same as-of semantics as the summary: when explicit, ignore stored days.
      const days = explicit
        ? this.resolveOutstandingAgeDays(null, r.date, asOf)
        : this.resolveOutstandingAgeDays(r.days, r.date, asOf);
      return {
        vcn: r.vcn,
        date: r.date,
        days,
        finalAmt: r.finalAmt != null ? Number(r.finalAmt) : 0,
        balance: r.balance != null ? Number(r.balance) : 0,
        pdLess: r.pdLess != null ? Number(r.pdLess) : 0,
        voucher: r.voucher,
        sVoucher: r.sVoucher,
        bucket: this.resolveOutstandingAgeBucket(days),
        bucketIndex: this.assignBucketIndex(days, boundaries),
      };
    });

    const bucketFiltered =
      options.bucketIndex !== undefined && options.bucketIndex !== null
        ? invoices.filter((inv) => inv.bucketIndex === options.bucketIndex)
        : invoices;

    const columnSpecs: Record<string, FinancialReportColumnSpec<(typeof invoices)[number]>> = {
      date: { type: 'date', value: (r) => r.date },
      vcn: { type: 'string', value: (r) => r.vcn },
      voucher: { type: 'string', value: (r) => [r.voucher, r.sVoucher].filter(Boolean).join(' ') },
      days: { type: 'number', value: (r) => r.days },
      bucket: { type: 'string', value: (r) => r.bucket },
      finalAmt: { type: 'number', value: (r) => r.finalAmt },
      pdLess: { type: 'number', value: (r) => r.pdLess },
      balance: { type: 'number', value: (r) => r.balance },
    };

    const filtered = this.filterFinancialReportRows(bucketFiltered, options.filters, columnSpecs);
    const sorted = this.sortFinancialReportRows(
      filtered,
      options.sortBy,
      options.sortDir,
      columnSpecs,
      (a, b) => {
        const dateOrder = a.date.getTime() - b.date.getTime();
        return dateOrder !== 0 ? dateOrder : String(a.vcn ?? '').localeCompare(String(b.vcn ?? ''));
      },
    );

    const bucketTotals = new Array(bucketCount).fill(0) as number[];
    // Compute bucket totals from the *unfiltered* pool so the visualisation
    // remains consistent when the user has narrowed to a single bucket.
    for (const inv of invoices) {
      bucketTotals[inv.bucketIndex] += Math.abs(inv.balance);
    }
    const totals = sorted.reduce(
      (acc, r) => ({
        finalAmt: acc.finalAmt + r.finalAmt,
        balance: acc.balance + r.balance,
        pdLess: acc.pdLess + r.pdLess,
        openCount: acc.openCount + 1,
      }),
      { finalAmt: 0, balance: 0, pdLess: 0, openCount: 0 },
    );

    const shouldPaginate = options.limit !== undefined || options.offset !== undefined;
    const limit = shouldPaginate ? Math.min(Math.max(options.limit ?? 50, 1), 5000) : Math.max(sorted.length, 1);
    const offset = shouldPaginate ? Math.max(options.offset ?? 0, 0) : 0;
    const pagedInvoices = shouldPaginate ? sorted.slice(offset, offset + limit) : sorted;

    return {
      partyCode: normalizedCode,
      partyName,
      groupCode,
      groupName,
      asOf: asOfIso,
      asOfExplicit: explicit,
      bucketDefinitions,
      invoices: pagedInvoices,
      totals: { ...totals, bucketTotals },
      pagination: {
        limit,
        offset,
        total: sorted.length,
        hasMore: offset + pagedInvoices.length < sorted.length,
      },
    };
  }

  /**
   * Outstanding rollup by Marg account group (e.g., Customer / Sundry Debtors,
   * Supplier / Sundry Creditors, sub-groups by region/route depending on the
   * tenant's Marg setup). Mirrors the by-party summary's filter/sort/aging
   * configuration so the totals on this tab and the party tab always reconcile
   * — switching between them never changes a number, only the grouping grain.
   */
  async getMargOutstandingByGroup(
    tenantId: string,
    options: {
      partyType?: 'CUSTOMER' | 'SUPPLIER' | 'ALL';
      companyId?: number;
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
      filters?: string;
      asOfDate?: string | null;
      bucketBoundaries?: string | number[] | null;
    } = {},
  ): Promise<{
    asOf: string;
    asOfExplicit: boolean;
    partyType: 'CUSTOMER' | 'SUPPLIER' | 'ALL';
    bucketDefinitions: Array<{ key: string; label: string; fromDays: number; toDays: number | null }>;
    rows: Array<{
      groupCode: string | null;
      groupName: string | null;
      partyCount: number;
      openInvoiceCount: number;
      totalOutstanding: number;
      creditBalance: number;
      pdLess: number;
      bucketAmounts: number[];
      avgDaysOutstanding: number | null;
      currentBucket: number;
      days31To60: number;
      days61To90: number;
      days91Plus: number;
      lastInvoiceDate: Date | null;
    }>;
    total: number;
    grandTotals: {
      partyCount: number;
      openInvoiceCount: number;
      totalOutstanding: number;
      creditBalance: number;
      pdLess: number;
      bucketTotals: number[];
    };
  }> {
    const partyType = options.partyType ?? 'ALL';
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 10_000);
    const offset = Math.max(options.offset ?? 0, 0);
    const boundaries = this.parseBucketBoundaries(options.bucketBoundaries);
    const bucketCount = boundaries.length + 1;
    const bucketDefinitions = this.buildBucketDefinitions(boundaries);
    const { asOf, asOfIso, explicit } = this.resolveAsOf(options.asOfDate);

    const groupFilter = partyType === 'CUSTOMER'
      ? { startsWith: 'C' }
      : partyType === 'SUPPLIER'
        ? { startsWith: 'D' }
        : undefined;

    const baseWhere: Prisma.MargOutstandingWhereInput = {
      tenantId,
      sourceDeleted: false,
      ...(options.companyId ? { companyId: options.companyId } : {}),
      ...(groupFilter ? { groupCode: groupFilter } : {}),
      balance: { not: 0 },
    };

    const allRows = await this.margPrisma.margOutstanding.findMany({
      where: baseWhere,
      select: {
        companyId: true,
        ord: true,
        groupCode: true,
        date: true,
        days: true,
        balance: true,
        pdLess: true,
      },
    });

    interface GroupBucket {
      groupCode: string | null;
      // Distinct (companyId, partyCode) tracker for partyCount.
      partyKeys: Set<string>;
      openInvoiceCount: number;
      totalOutstanding: number;
      creditBalance: number;
      pdLess: number;
      bucketAmounts: number[];
      weightedDaysExposure: number;
      lastInvoiceDate: Date | null;
    }
    const grouped = new Map<string, GroupBucket>();

    for (const row of allRows) {
      // Use the literal stored groupCode (or empty string for unmapped) so
      // un-grouped rows roll into their own "Unmapped" bucket rather than
      // dispersing.
      const key = row.groupCode ?? '';
      const balance = row.balance != null ? Number(row.balance) : 0;
      const pdLess = row.pdLess != null ? Number(row.pdLess) : 0;
      const days = explicit
        ? this.resolveOutstandingAgeDays(null, row.date, asOf)
        : this.resolveOutstandingAgeDays(row.days, row.date, asOf);

      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          groupCode: row.groupCode,
          partyKeys: new Set<string>(),
          openInvoiceCount: 0,
          totalOutstanding: 0,
          creditBalance: 0,
          pdLess: 0,
          bucketAmounts: new Array(bucketCount).fill(0),
          weightedDaysExposure: 0,
          lastInvoiceDate: null,
        };
        grouped.set(key, entry);
      }

      const groupCode = (row.groupCode ?? '').toUpperCase();
      const isSupplier = groupCode.startsWith('D');
      const isCustomer = groupCode.startsWith('C');
      const exposure = isSupplier
        ? Math.max(-balance, 0)
        : isCustomer
          ? Math.max(balance, 0)
          : Math.abs(balance);
      const credit = isSupplier
        ? Math.max(balance, 0)
        : isCustomer
          ? Math.max(-balance, 0)
          : 0;

      entry.partyKeys.add(`${row.companyId}|${row.ord}`);
      if (exposure > 0) entry.openInvoiceCount += 1;
      entry.totalOutstanding += exposure;
      entry.creditBalance += credit;
      entry.pdLess += pdLess;
      entry.bucketAmounts[this.assignBucketIndex(days, boundaries)] += exposure;
      entry.weightedDaysExposure += exposure * days;
      if (!entry.lastInvoiceDate || row.date > entry.lastInvoiceDate) {
        entry.lastInvoiceDate = row.date;
      }
    }

    // Resolve human-readable group names for the codes we actually saw.
    const codeKeys = Array.from(grouped.values()).map((g) => g.groupCode).filter(Boolean) as string[];
    const groupNameMap = new Map<string, string>();
    if (codeKeys.length > 0) {
      const lookups = await this.margPrisma.margAccountGroup.findMany({
        where: { tenantId, aid: { in: codeKeys } },
        select: { aid: true, name: true },
      });
      for (const g of lookups) groupNameMap.set(g.aid, g.name);
    }

    const projected = Array.from(grouped.values()).map((g) => {
      const padded = [...g.bucketAmounts];
      while (padded.length < 4) padded.push(0);
      return {
        groupCode: g.groupCode,
        groupName: g.groupCode ? groupNameMap.get(g.groupCode) ?? null : 'Unmapped',
        partyCount: g.partyKeys.size,
        openInvoiceCount: g.openInvoiceCount,
        totalOutstanding: g.totalOutstanding,
        creditBalance: g.creditBalance,
        pdLess: g.pdLess,
        bucketAmounts: g.bucketAmounts,
        avgDaysOutstanding:
          g.totalOutstanding > 0 ? Math.round((g.weightedDaysExposure / g.totalOutstanding) * 10) / 10 : null,
        currentBucket: padded[0],
        days31To60: padded[1],
        days61To90: padded[2],
        days91Plus: padded.length <= 4 ? padded[3] ?? 0 : padded.slice(3).reduce((a, b) => a + b, 0),
        lastInvoiceDate: g.lastInvoiceDate,
      };
    });

    const columnSpecs: Record<string, FinancialReportColumnSpec<(typeof projected)[number]>> = {
      groupCode: { type: 'string', value: (r) => r.groupCode },
      groupName: { type: 'string', value: (r) => r.groupName ?? r.groupCode },
      partyCount: { type: 'number', value: (r) => r.partyCount },
      openInvoiceCount: { type: 'number', value: (r) => r.openInvoiceCount },
      totalOutstanding: { type: 'number', value: (r) => r.totalOutstanding },
      creditBalance: { type: 'number', value: (r) => r.creditBalance },
      pdLess: { type: 'number', value: (r) => r.pdLess },
      currentBucket: { type: 'number', value: (r) => r.currentBucket },
      days31To60: { type: 'number', value: (r) => r.days31To60 },
      days61To90: { type: 'number', value: (r) => r.days61To90 },
      days91Plus: { type: 'number', value: (r) => r.days91Plus },
      avgDaysOutstanding: { type: 'number', value: (r) => r.avgDaysOutstanding },
      lastInvoiceDate: { type: 'date', value: (r) => r.lastInvoiceDate },
    };

    const filtered = this.filterFinancialReportRows(projected, options.filters, columnSpecs);
    const sorted = this.sortFinancialReportRows(
      filtered,
      options.sortBy,
      options.sortDir,
      columnSpecs,
      (a, b) => b.totalOutstanding - a.totalOutstanding,
    );

    const grandBucketTotals = new Array(bucketCount).fill(0) as number[];
    const grandTotals = sorted.reduce(
      (acc, r) => {
        for (let i = 0; i < r.bucketAmounts.length && i < bucketCount; i += 1) {
          grandBucketTotals[i] += r.bucketAmounts[i];
        }
        return {
          partyCount: acc.partyCount + r.partyCount,
          openInvoiceCount: acc.openInvoiceCount + r.openInvoiceCount,
          totalOutstanding: acc.totalOutstanding + r.totalOutstanding,
          creditBalance: acc.creditBalance + r.creditBalance,
          pdLess: acc.pdLess + r.pdLess,
        };
      },
      { partyCount: 0, openInvoiceCount: 0, totalOutstanding: 0, creditBalance: 0, pdLess: 0 },
    );

    const paged = sorted.slice(offset, offset + limit);

    return {
      asOf: asOfIso,
      asOfExplicit: explicit,
      partyType,
      bucketDefinitions,
      rows: paged,
      total: sorted.length,
      grandTotals: { ...grandTotals, bucketTotals: grandBucketTotals },
    };
  }

  /**
   * Tally-style party ledger: opening balance, every transaction in the
   * window with running balance, and closing balance — driven entirely by
   * MargAccountPosting rows, which carry one signed entry per voucher
   * (positive = DR, negative = CR per Marg's convention). Every row includes
   * the source voucher number, book code (S=Sales, A=Purchase, P=Payment,
   * R=Receipt, E=Adjustment, D=Debit Note, J=Journal, …), counter-party
   * code, and Marg's own remark
   * so users can reconcile a single line back to a Marg voucher in seconds.
   */
  async getMargPartyLedger(
    tenantId: string,
    partyCode: string,
    options: {
      companyId?: number;
      fromDate?: string;
      toDate?: string;
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
      filters?: string;
    } = {},
  ): Promise<{
    partyCode: string;
    partyName: string | null;
    groupCode: string | null;
    groupName: string | null;
    companyId: number | null;
    period: { fromDate: string | null; toDate: string | null };
    opening: { fromPartyBalance: number | null; computed: number; source: 'MARG_PARTY_BALANCE' | 'COMPUTED_FROM_POSTINGS' };
    closing: { fromPartyBalance: number | null; computed: number; source: 'MARG_PARTY_BALANCE' | 'COMPUTED_FROM_POSTINGS' };
    totals: { openingBalance: number; debit: number; credit: number; closingBalance: number; transactionCount: number };
    transactions: Array<{
      date: Date;
      voucher: string | null;
      vcn: string | null;
      book: string | null;
      bookName: string | null;
      counterpartyCode: string | null;
      counterpartyName: string | null;
      remark: string | null;
      debit: number;
      credit: number;
      runningBalance: number;
    }>;
    pagination: { limit: number; offset: number; total: number; hasMore: boolean };
  }> {
    const normalizedCode = this.normalizeMargCode(partyCode);
    if (!normalizedCode) {
      throw new BadRequestException('partyCode is required');
    }
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 100000);
    const offset = Math.max(options.offset ?? 0, 0);

    const fromDate = options.fromDate ? this.parseMargDate(options.fromDate) : null;
    const toDate = options.toDate ? this.parseMargDate(options.toDate) : null;
    if (options.fromDate && !fromDate) throw new BadRequestException('fromDate must be a valid date');
    if (options.toDate && !toDate) throw new BadRequestException('toDate must be a valid date');

    const baseWhere: Prisma.MargAccountPostingWhereInput = {
      tenantId,
      code: normalizedCode,
      ...(options.companyId ? { companyId: options.companyId } : {}),
    };

    // Opening = sum of postings BEFORE fromDate (or 0 if no window). When the
    // user provides no fromDate we fall back to MargPartyBalance.opening so
    // the report matches Marg's own opening figure exactly.
    let openingComputed = 0;
    if (fromDate) {
      const priorAgg = await this.margPrisma.margAccountPosting.aggregate({
        where: { ...baseWhere, date: { lt: fromDate } },
        _sum: { amount: true },
      });
      openingComputed = priorAgg._sum.amount != null ? Number(priorAgg._sum.amount) : 0;
    }

    const partyBalanceRow = await this.margPrisma.margPartyBalance.findFirst({
      where: { tenantId, cid: normalizedCode, ...(options.companyId ? { companyId: options.companyId } : {}) },
      select: { opening: true, balance: true, companyId: true },
    });
    const openingFromPb = partyBalanceRow?.opening != null ? Number(partyBalanceRow.opening) : null;
    const closingFromPb = partyBalanceRow?.balance != null ? Number(partyBalanceRow.balance) : null;

    const openingBalance = !fromDate && openingFromPb != null ? openingFromPb : openingComputed;

    const postingWhere: Prisma.MargAccountPostingWhereInput = {
      ...baseWhere,
      ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
    };

    const postings = await this.margPrisma.margAccountPosting.findMany({
      where: postingWhere,
      orderBy: [{ date: 'asc' }, { voucher: 'asc' }, { margId: 'asc' }],
      select: {
        date: true,
        voucher: true,
        book: true,
        code1: true,
        gCode: true,
        amount: true,
        remark: true,
        companyId: true,
      },
    });

    // Cross-reference voucher VCN from MargVoucher (when posting was generated
    // by an MDis voucher). We batch the lookup to keep the query count bounded.
    const voucherKeys = new Set<string>();
    for (const p of postings) {
      if (p.voucher) voucherKeys.add(`${p.companyId}|${p.voucher}`);
    }
    const voucherMap = new Map<string, string | null>();
    if (voucherKeys.size > 0) {
      const voucherRows = await this.margPrisma.margVoucher.findMany({
        where: {
          tenantId,
          OR: Array.from(voucherKeys).map((k) => {
            const [cidStr, voucher] = k.split('|');
            return { companyId: Number(cidStr), voucher };
          }),
        },
        select: { companyId: true, voucher: true, vcn: true },
      });
      for (const v of voucherRows) {
        voucherMap.set(`${v.companyId}|${v.voucher}`, v.vcn);
      }
    }

    // Resolve counter-party (Code1) names. Marg uses the same code namespace
    // for both customers/suppliers and intermediary GL accounts, so we check
    // MargParty first then fall back to MargAccountGroup.
    const counterpartyKeys = new Set<string>();
    for (const p of postings) {
      const cp = String(p.code1 || '').trim();
      if (cp) counterpartyKeys.add(`${p.companyId}|${cp}`);
    }
    const counterpartyMap = new Map<string, string>();
    if (counterpartyKeys.size > 0) {
      const cpParties = await this.margPrisma.margParty.findMany({
        where: {
          tenantId,
          OR: Array.from(counterpartyKeys).map((k) => {
            const [cidStr, cid] = k.split('|');
            return { companyId: Number(cidStr), cid };
          }),
        },
        select: { companyId: true, cid: true, parName: true },
      });
      for (const cp of cpParties) {
        counterpartyMap.set(`${cp.companyId}|${cp.cid}`, cp.parName);
      }
    }

    let runningBalance = openingBalance;
    const allTransactions = postings.map((p) => {
      const amount = p.amount != null ? Number(p.amount) : 0;
      const debit = amount > 0 ? amount : 0;
      const credit = amount < 0 ? -amount : 0;
      runningBalance += amount;

      const cpCode = String(p.code1 || '').trim() || null;
      return {
        date: p.date,
        voucher: p.voucher,
        vcn: p.voucher ? voucherMap.get(`${p.companyId}|${p.voucher}`) ?? null : null,
        book: p.book,
        bookName: this.describeMargBook(p.book),
        counterpartyCode: cpCode,
        counterpartyName: cpCode ? counterpartyMap.get(`${p.companyId}|${cpCode}`) ?? this.masterFallbackName('ledger', cpCode) : null,
        remark: p.remark,
        debit,
        credit,
        runningBalance,
      };
    });

    const columnSpecs: Record<string, FinancialReportColumnSpec<(typeof allTransactions)[number]>> = {
      date: { type: 'date', value: (r) => r.date },
      bookName: { type: 'string', value: (r) => [r.bookName, r.book].filter(Boolean).join(' ') },
      voucher: { type: 'string', value: (r) => [r.vcn, r.voucher].filter(Boolean).join(' ') },
      counterpartyName: { type: 'string', value: (r) => [r.counterpartyName, r.counterpartyCode].filter(Boolean).join(' ') },
      remark: { type: 'string', value: (r) => r.remark },
      debit: { type: 'number', value: (r) => r.debit },
      credit: { type: 'number', value: (r) => r.credit },
      runningBalance: { type: 'number', value: (r) => r.runningBalance },
    };

    const filtered = this.filterFinancialReportRows(allTransactions, options.filters, columnSpecs);
    const sorted = this.sortFinancialReportRows(
      filtered,
      options.sortBy,
      options.sortDir,
      columnSpecs,
      () => 0,
    );
    const transactions = sorted.slice(offset, offset + limit);
    const totalDebit = sorted.reduce((acc, r) => acc + r.debit, 0);
    const totalCredit = sorted.reduce((acc, r) => acc + r.credit, 0);
    const total = sorted.length;

    // Closing remains the ledger balance at the end of the selected date window;
    // debit and credit totals above follow the active grid filters.
    const closingComputed = allTransactions.length
      ? allTransactions[allTransactions.length - 1].runningBalance
      : openingBalance;
    const isFullWindow = !fromDate && !toDate && !options.filters;

    const partyName = await this.lookupMargPartyName(tenantId, partyBalanceRow?.companyId ?? options.companyId, normalizedCode)
      ?? this.masterFallbackName('ledger', normalizedCode);
    const firstPosting = postings[0];
    const groupCode = firstPosting?.gCode ?? null;
    const groupName = groupCode
      ? await this.lookupMargAccountGroupName(tenantId, groupCode) ?? this.masterFallbackName('ledger group', groupCode)
      : null;

    return {
      partyCode: normalizedCode,
      partyName,
      groupCode,
      groupName,
      companyId: partyBalanceRow?.companyId ?? options.companyId ?? null,
      period: {
        fromDate: fromDate ? fromDate.toISOString().slice(0, 10) : null,
        toDate: toDate ? toDate.toISOString().slice(0, 10) : null,
      },
      opening: {
        fromPartyBalance: openingFromPb,
        computed: openingComputed,
        source: !fromDate && openingFromPb != null ? 'MARG_PARTY_BALANCE' : 'COMPUTED_FROM_POSTINGS',
      },
      closing: {
        fromPartyBalance: closingFromPb,
        computed: closingComputed,
        source: closingFromPb != null && isFullWindow ? 'MARG_PARTY_BALANCE' : 'COMPUTED_FROM_POSTINGS',
      },
      totals: { openingBalance, debit: totalDebit, credit: totalCredit, closingBalance: closingComputed, transactionCount: total },
      transactions,
      pagination: { limit, offset, total, hasMore: offset + transactions.length < total },
    };
  }

  private resolveOutstandingAgeDays(
    storedDays: number | null | undefined,
    invoiceDate: Date | null | undefined,
    asOf = new Date(),
  ): number {
    const parsedStoredDays = Number(storedDays ?? 0);
    if (Number.isFinite(parsedStoredDays) && parsedStoredDays > 0) {
      return Math.floor(parsedStoredDays);
    }

    if (!invoiceDate) return 0;

    const invoice = new Date(invoiceDate);
    if (Number.isNaN(invoice.getTime())) return 0;

    const invoiceDay = Date.UTC(invoice.getUTCFullYear(), invoice.getUTCMonth(), invoice.getUTCDate());
    const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
    return Math.max(0, Math.floor((asOfDay - invoiceDay) / 86_400_000));
  }

  private resolveOutstandingAgeBucket(
    days: number,
  ): 'CURRENT' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_91_PLUS' {
    if (days <= 30) return 'CURRENT';
    if (days <= 60) return 'DAYS_31_60';
    if (days <= 90) return 'DAYS_61_90';
    return 'DAYS_91_PLUS';
  }

  /**
   * Default aging bucket boundaries: 30 / 60 / 90 days. The trailing "..>last"
   * bucket has no upper bound and represents 91+ days. Tenants can override
   * via the `bucketBoundaries` query param to pick e.g. [15, 30, 60, 90, 180]
   * for stricter control or [30, 60, 90, 180] for a 5-bucket pharma view.
   */
  private static readonly DEFAULT_AGING_BOUNDARIES: number[] = [30, 60, 90];

  /**
   * Parse and validate the aging bucket boundaries supplied via query (CSV
   * string of integers like "30,60,90" or already-parsed number array).
   * Returns the default when input is empty/invalid-shape; throws on malformed
   * non-empty input so callers see a clear 400 instead of silent surprise.
   */
  private parseBucketBoundaries(input?: string | number[] | null): number[] {
    if (input == null || input === '') return [...MargOutstandingService.DEFAULT_AGING_BOUNDARIES];

    let arr: unknown[];
    if (Array.isArray(input)) {
      arr = input as unknown[];
    } else if (typeof input === 'string') {
      arr = input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    } else {
      throw new BadRequestException('bucketBoundaries must be CSV or array of integers');
    }

    if (arr.length === 0) return [...MargOutstandingService.DEFAULT_AGING_BOUNDARIES];
    if (arr.length > 10) {
      throw new BadRequestException('bucketBoundaries supports at most 10 thresholds (11 buckets)');
    }

    const parsed = arr.map((value) => {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 10_000) {
        throw new BadRequestException(`Invalid bucket threshold: ${String(value)} (must be a positive integer ≤ 10000)`);
      }
      return n;
    });

    for (let i = 1; i < parsed.length; i += 1) {
      if (parsed[i] <= parsed[i - 1]) {
        throw new BadRequestException('bucketBoundaries must be strictly ascending');
      }
    }

    return parsed;
  }

  /**
   * Map an age (days) to its bucket index given the configured upper-bound
   * thresholds. Buckets[i] covers `(boundaries[i-1], boundaries[i]]`; the last
   * bucket covers `> boundaries[last]`. Bucket 0 covers `0..boundaries[0]`.
   */
  private assignBucketIndex(days: number, boundaries: number[]): number {
    for (let i = 0; i < boundaries.length; i += 1) {
      if (days <= boundaries[i]) return i;
    }
    return boundaries.length;
  }

  /** Symbolic, deterministic bucket keys for boundary configurations. */
  private buildBucketDefinitions(boundaries: number[]): Array<{
    key: string;
    label: string;
    fromDays: number;
    toDays: number | null;
  }> {
    const defs: Array<{ key: string; label: string; fromDays: number; toDays: number | null }> = [];
    let from = 0;
    for (let i = 0; i < boundaries.length; i += 1) {
      const to = boundaries[i];
      defs.push({
        key: i === 0 ? 'CURRENT' : `DAYS_${from + 1}_${to}`,
        label: i === 0 ? `0-${to}` : `${from + 1}-${to}`,
        fromDays: from,
        toDays: to,
      });
      from = to;
    }
    defs.push({
      key: `DAYS_${from + 1}_PLUS`,
      label: `${from + 1}+`,
      fromDays: from,
      toDays: null,
    });
    return defs;
  }

  /**
   * Resolve the as-of anchor date. When the caller supplies an ISO date we
   * use it (clamping to end-of-day so a same-day invoice ages to 0). When
   * absent we fall back to "now". Returns both the Date object and an ISO
   * string echoed back to the consumer for traceability.
   */
  private resolveAsOf(asOfDate?: string | null): { asOf: Date; asOfIso: string; explicit: boolean } {
    if (asOfDate) {
      const parsed = new Date(asOfDate);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(`Invalid asOfDate: ${asOfDate}`);
      }
      // Anchor to UTC end-of-day so an invoice dated the asOf date ages to 0,
      // matching the inclusive convention users expect ("show me what was
      // outstanding *as of* 2026-04-30").
      parsed.setUTCHours(23, 59, 59, 999);
      return { asOf: parsed, asOfIso: parsed.toISOString(), explicit: true };
    }
    const now = new Date();
    return { asOf: now, asOfIso: now.toISOString(), explicit: false };
  }

  /**
   * Compute Days Sales Outstanding from Marg vouchers within the configured
   * window. DSO = (open AR / credit sales in window) × window length in days.
   * Returns null when there's no AR or no credit sales (the metric is
   * undefined and showing 0 would be misleading).
   *
   * Credit sales = sale vouchers (type='S') minus sale returns (type='R'/'T'),
   * excluding cash portion (`cash`) — i.e. only the credit-extended slice.
   */
  private async computeDso(
    tenantId: string,
    options: {
      totalReceivables: number;
      windowEnd: Date;
      windowDays: number;
      companyId?: number;
    },
  ): Promise<{
    days: number;
    totalCreditSales: number;
    windowDays: number;
    windowStart: string;
    windowEnd: string;
  } | null> {
    if (options.totalReceivables <= 0) return null;
    const windowDays = Math.max(1, Math.min(365, options.windowDays));
    const windowEnd = new Date(options.windowEnd);
    const windowStart = new Date(windowEnd);
    windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

    const where: Prisma.MargVoucherWhereInput = {
      tenantId,
      date: { gte: windowStart, lte: windowEnd },
      type: { in: ['S', 'R', 'T'] },
      ...(options.companyId ? { companyId: options.companyId } : {}),
    };

    const rows = await this.margPrisma.margVoucher.findMany({
      where,
      select: { type: true, finalAmt: true, cash: true },
    });

    let creditSales = 0;
    for (const r of rows) {
      const final = r.finalAmt != null ? Number(r.finalAmt) : 0;
      const cash = r.cash != null ? Number(r.cash) : 0;
      const creditPortion = Math.max(final - cash, 0);
      if (r.type === 'S') {
        creditSales += creditPortion;
      } else {
        // Sale return — net out the credit portion that's being reversed.
        creditSales -= creditPortion;
      }
    }
    creditSales = Math.max(creditSales, 0);
    if (creditSales <= 0) return null;

    const dso = (options.totalReceivables / creditSales) * windowDays;
    return {
      days: Math.round(dso * 10) / 10,
      totalCreditSales: creditSales,
      windowDays,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  private filterFinancialReportRows<T>(
    rows: T[],
    rawFilters: string | undefined | null,
    columns: Record<string, FinancialReportColumnSpec<T>>,
  ): T[] {
    const filters = this.parseFinancialReportFilters(rawFilters);
    if (!filters.length) return rows;

    return rows.filter((row) => filters.every((filter) => {
      const column = columns[filter.field];
      if (!column) {
        throw new BadRequestException(`Filtering on column '${filter.field}' is not permitted`);
      }
      return this.matchesFinancialReportFilter(column.value(row), column.type, filter);
    }));
  }

  private sortFinancialReportRows<T>(
    rows: T[],
    sortBy: string | undefined | null,
    sortDir: 'asc' | 'desc' | undefined | null,
    columns: Record<string, FinancialReportColumnSpec<T>>,
    defaultCompare: (a: T, b: T) => number,
  ): T[] {
    const sorted = [...rows];
    const column = sortBy ? columns[sortBy] : undefined;
    if (!column) {
      return sorted.sort(defaultCompare);
    }

    const direction = sortDir === 'desc' ? -1 : 1;
    return sorted.sort((a, b) => {
      const result = this.compareFinancialReportValues(column.value(a), column.value(b), column.type);
      return result !== 0 ? result * direction : defaultCompare(a, b);
    });
  }

  private parseFinancialReportFilters(rawFilters: string | undefined | null): FinancialReportColumnFilter[] {
    if (!rawFilters) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawFilters);
    } catch {
      throw new BadRequestException('filters must be a valid JSON array');
    }

    if (!Array.isArray(parsed)) return [];

    const allowed = new Set<FinancialReportFilterOperator>([
      'contains',
      'startsWith',
      'endsWith',
      'equals',
      'notEquals',
      'gt',
      'gte',
      'lt',
      'lte',
      'between',
      'in',
      'isNull',
      'isNotNull',
    ]);

    return parsed.map((item) => {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException('filters must contain objects');
      }

      const filter = item as Record<string, unknown>;
      const field = filter.field;
      const operator = filter.operator;
      if (typeof field !== 'string' || typeof operator !== 'string' || !allowed.has(operator as FinancialReportFilterOperator)) {
        throw new BadRequestException('filters contain an unsupported field or operator');
      }

      return {
        field,
        operator: operator as FinancialReportFilterOperator,
        value: filter.value,
      };
    });
  }

  private matchesFinancialReportFilter(
    rowValue: unknown,
    type: FinancialReportFieldType,
    filter: FinancialReportColumnFilter,
  ): boolean {
    switch (filter.operator) {
      case 'isNull':
        return rowValue === null || rowValue === undefined || rowValue === '';
      case 'isNotNull':
        return rowValue !== null && rowValue !== undefined && rowValue !== '';
      case 'contains':
        return this.toFinancialReportString(rowValue).includes(this.toFinancialReportString(filter.value));
      case 'startsWith':
        return this.toFinancialReportString(rowValue).startsWith(this.toFinancialReportString(filter.value));
      case 'endsWith':
        return this.toFinancialReportString(rowValue).endsWith(this.toFinancialReportString(filter.value));
      case 'equals':
        return this.compareFinancialReportValues(rowValue, filter.value, type) === 0;
      case 'notEquals':
        return this.compareFinancialReportValues(rowValue, filter.value, type) !== 0;
      case 'gt':
        return this.compareFinancialReportValues(rowValue, filter.value, type) > 0;
      case 'gte':
        return this.compareFinancialReportValues(rowValue, filter.value, type) >= 0;
      case 'lt':
        return this.compareFinancialReportValues(rowValue, filter.value, type) < 0;
      case 'lte':
        return this.compareFinancialReportValues(rowValue, filter.value, type) <= 0;
      case 'between': {
        const [from, to] = Array.isArray(filter.value) ? filter.value : [filter.value, filter.value];
        return this.compareFinancialReportValues(rowValue, from, type) >= 0
          && this.compareFinancialReportValues(rowValue, to, type) <= 0;
      }
      case 'in': {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        return values.some((value) => this.compareFinancialReportValues(rowValue, value, type) === 0);
      }
      default:
        return true;
    }
  }

  private compareFinancialReportValues(
    left: unknown,
    right: unknown,
    type: FinancialReportFieldType,
  ): number {
    const leftEmpty = left === null || left === undefined || left === '';
    const rightEmpty = right === null || right === undefined || right === '';
    if (leftEmpty && rightEmpty) return 0;
    if (leftEmpty) return 1;
    if (rightEmpty) return -1;

    if (type === 'number') {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
        throw new BadRequestException('Invalid numeric filter value');
      }
      return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
    }

    if (type === 'date') {
      const leftTime = this.toFinancialReportDateTime(left);
      const rightTime = this.toFinancialReportDateTime(right);
      return leftTime === rightTime ? 0 : leftTime > rightTime ? 1 : -1;
    }

    return this.toFinancialReportString(left).localeCompare(this.toFinancialReportString(right));
  }

  private toFinancialReportString(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
  }

  private toFinancialReportDateTime(value: unknown): number {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date filter value');
    }
    return date.getTime();
  }

  /** Lookup helper: party name from MargParty */
  private async lookupMargPartyName(
    tenantId: string,
    companyId: number | null | undefined,
    cid: string,
  ): Promise<string | null> {
    if (!cid) return null;
    const row = await this.margPrisma.margParty.findFirst({
      where: { tenantId, cid, ...(companyId ? { companyId } : {}) },
      select: { parName: true },
      orderBy: { updatedAt: 'desc' },
    });
    return row?.parName ?? null;
  }

  /** Lookup helper: group name from MargAccountGroup */
  private async lookupMargAccountGroupName(tenantId: string, aid: string): Promise<string | null> {
    if (!aid) return null;
    const row = await this.margPrisma.margAccountGroup.findFirst({
      where: { tenantId, aid },
      select: { name: true },
    });
    return row?.name ?? null;
  }

  /** Map Marg book codes to human-readable names for the ledger report */
  private describeMargBook(book: string | null | undefined): string | null {
    const code = String(book || '').trim().toUpperCase();
    switch (code) {
      case 'S': return 'Sales';
      case 'A': return 'Purchase';
      case 'P': return 'Payment';
      case 'R': return 'Receipt';
      case 'E': return 'Sales Adjustment';
      case 'D': return 'Debit Note';
      case 'C': return 'Credit Note';
      case 'J': return 'Journal';
      case '!': return 'Opening';
      default: return code || null;
    }
  }
}
