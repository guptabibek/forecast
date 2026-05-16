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

/** Shape of the Marg EDE POST response before decryption */
interface MargRawResponse {
  Aborting?: boolean;
  Status?: string;
  Message?: string;
  DateTime?: string;
  DataStatus?: number | string;
  Datastatus?: number | string;
  Index?: number | string;
  Data?: string | Record<string, unknown>; // encrypted string when data present, or object when plain
  Details?: any[];
  Masters?: any[];
  MDis?: any[];
  Party?: any[];
  Product?: any[];
  SaleType?: any[];
  Stock?: any[];
  ACGroup?: any[];
  Account?: any[];
  AcBal?: any[];
  PBal?: any[];
  Outstanding?: any[];
}

/** Decrypted/parsed payload from Marg EDE */
interface MargParsedPayload {
  Details: any[];
  Masters: any[];
  MDis: any[];
  Party: any[];
  Product: any[];
  SaleType: any[];
  Stock: any[];
  ACGroup: any[];
  Account: any[];
  AcBal: any[];
  PBal: any[];
  Outstanding: any[];
  Index: number;
  DataStatus: number;
  DateTime: string;
}

interface DateWindow {
  from: Date | null;
  to: Date | null;
}

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

interface MargSyncRunContext {
  id: string;
  startedAt: Date;
  mode?: MargSyncMode;
}

interface MargAccountingProjectionIssue {
  groupKey: string;
  companyId?: number;
  voucher?: string | null;
  bookCode?: string | null;
  entryDate?: string;
  reason: string;
  details?: Record<string, unknown>;
}

interface MargAccountingProjectionSummary {
  journalEntriesSynced: number;
  skippedGroups: MargAccountingProjectionIssue[];
  diagnostics?: {
    duplicateFingerprintCount: number;
    duplicateRowCount: number;
    skippedByReason: Record<string, number>;
  };
}

interface MargInventoryProjectionResetResult {
  affectedLedgerScopes: Set<string>;
}

interface MargSyncDiagnostics {
  freeQuantityRowCount: number;
  freeOnlyRowCount: number;
  freeQuantityUnits: number;
  branchPayloadRowCount: number;
  branchPayloadFallbackCount: number;
  duplicatePartyKeyCount: number;
  duplicatePartyRowCount: number;
  duplicatePartyBalanceKeyCount: number;
  duplicatePartyBalanceRowCount: number;
  supplierCandidates: number;
  suppliersProjected: number;
  duplicateAccountPostingFingerprintCount: number;
  duplicateAccountPostingRowCount: number;
  skippedAccountingGroupsByReason: Record<string, number>;
}

interface MargBootstrapAccountGroup {
  companyId: number;
  aid: string;
  name: string;
  under: string | null;
  addField: string | null;
}

interface MargReconciliationExecutionSummary {
  totalIssues: number;
  warningCount: number;
  failureCount: number;
}

interface MargAccountPostingGroup {
  companyId: number;
  voucher: string | null;
  date: Date;
  book: string | null;
  sourceMargId: bigint | null;
}

interface MargJournalLineDraft {
  glAccountId: string;
  debitAmount: number;
  creditAmount: number;
  description: string;
}

interface MargAccountPostingProjectionRow {
  margId: bigint;
  companyId: number;
  voucher: string | null;
  date: Date;
  book: string | null;
  amount: Prisma.Decimal | number | null;
  code: string | null;
  code1: string | null;
  gCode: string | null;
  remark: string | null;
}

type MargType2DocumentFamily =
  | 'SALES_INVOICE'
  | 'SALES_CHALLAN'
  | 'SALES_ORDER'
  | 'PURCHASE_INVOICE'
  | 'PURCHASE_ORDER'
  | 'SALES_RETURN'
  | 'SALES_RETURN_ADJUSTMENT'
  | 'PURCHASE_RETURN'
  | 'STOCK_RECEIVE'
  | 'STOCK_ISSUE'
  | 'REPLACEMENT_ISSUE'
  | 'UNKNOWN';

interface MargVoucherContext {
  companyId: number;
  voucher: string;
  type: string | null;
  vcn: string | null;
  addField: string | null;
}

interface MargType2ProjectionInput {
  transactionType: string | null | undefined;
  transactionVcn: string | null | undefined;
  transactionAddField: string | null | undefined;
  voucherType?: string | null | undefined;
  voucherVcn?: string | null | undefined;
  voucherAddField?: string | null | undefined;
  effectiveQty: number;
  amount: Prisma.Decimal | number | null | undefined;
}

interface MargType2ProjectionDecision {
  family: MargType2DocumentFamily;
  headerType: string | null;
  lineType: string | null;
  addFieldTag: string | null;
  vcnPrefix: string | null;
  shouldProjectActual: boolean;
  actualType: ActualType | null;
  actualQuantity: number | null;
  actualAmount: number | null;
  shouldProjectInventory: boolean;
  inventoryTransactionType: InventoryTransactionType | null;
  inventoryQuantity: number;
  ledgerEntryType: LedgerEntryType | null;
  ledgerQuantity: number;
  customerFacing: boolean;
  supplierFacing: boolean;
}

export interface MargConnectionProbeSummary {
  apiType: '1' | '2';
  index: number;
  dataStatus: number;
  dateTime: string;
  rowCounts: {
    details: number;
    masters: number;
    vouchers: number;
    parties: number;
    products: number;
    saleTypes: number;
    stock: number;
    accountGroups: number;
    accounts: number;
    accountGroupBalances: number;
    partyBalances: number;
    outstandings: number;
  };
}

interface AuthUser {
  id: string;
  tenantId: string;
}

const DEFAULT_API_BASE_URL = 'https://corporate.margerp.com';
const DEFAULT_SYNC_FREQUENCY = 'DAILY';
const ALLOWED_SYNC_FREQUENCIES = new Set(['HOURLY', 'DAILY', 'WEEKLY']);
const COMPLETE_DATA_STATUS = 10;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const TRANSFORM_BATCH_SIZE = 200;
const MARG_ACCOUNTING_PROJECTION_TX_MAX_WAIT_MS = 10000;
const MARG_ACCOUNTING_PROJECTION_TX_TIMEOUT_MS = 60000;
const MARG_SOURCE_SYSTEM = 'MARG_EDE';
const MARG_REFERENCE_PREFIX = 'MARG-';
const MARG_PURCHASE_ORDER_PREFIX = 'MARG-PO-';
const MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX = 'MARG-PIF-';
const MARG_GOODS_RECEIPT_PREFIX = 'MARG-GRN-';
const MARG_SYNC_PURCHASE_ORDER_MARKER = '[MARG_SYNC_PO]';
const MARG_SYNC_FALLBACK_PURCHASE_ORDER_MARKER = '[MARG_SYNC_PO_FALLBACK]';
const MARG_SYNC_GOODS_RECEIPT_MARKER = '[MARG_SYNC_GRN]';
const MARG_EXPECTED_DATE_UNKNOWN_MARKER = '[MARG_EXPECTED_DATE_UNKNOWN]';
const MARG_ORDER_DATE_UNKNOWN_MARKER = '[MARG_ORDER_DATE_UNKNOWN]';
const MARG_ACCOUNTING_REFERENCE_TYPE = 'MARG_EDE_ACCOUNT';
const PSEUDO_PARTY_NAME_PATTERN = /\b(SUSPENSE|SURCHARGE|TDS|TCS|CGST|SGST|IGST|GST|VAT|CESS|ROUND\s*OFF|ROUNDOFF|DISCOUNT|REBATE|FREIGHT|BANK\s*CHARGES?|C\.?S\.?T\.?)\b/i;
const STOCK_RECONCILIATION_TOLERANCE = 0.0001;
const ACCOUNTING_RECONCILIATION_TOLERANCE = 0.01;
const MAX_RECONCILIATION_ISSUES = 100;
const MARG_SYNC_STATUS = {
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

@Injectable()
export class MargEdeService {
  private readonly logger = new Logger(MargEdeService.name);
  private readonly requestTimeoutMs = this.parsePositiveInt(process.env.MARG_HTTP_TIMEOUT_MS, 30000);
  private readonly dataRequestTimeoutMs = this.parsePositiveInt(
    process.env.MARG_DATA_HTTP_TIMEOUT_MS,
    Math.max(this.requestTimeoutMs, 120000),
  );
  private readonly maxPagesPerSync = this.parsePositiveInt(process.env.MARG_SYNC_MAX_PAGES, 500);
  private readonly encryptionKey = this.resolveEncryptionKey();

  // Configurable batch sizes / timeouts for the resumable pipeline. Read from
  // env once at construction so changes require a restart (matches existing
  // pattern with maxPagesPerSync and dataRequestTimeoutMs).
  private readonly stagingBatchSize = this.parsePositiveInt(process.env.MARG_STAGING_BATCH_SIZE, 5000);
  private readonly transformBatchSize = this.parsePositiveInt(process.env.MARG_TRANSFORM_BATCH_SIZE, 2000);
  private readonly projectionBatchSize = this.parsePositiveInt(process.env.MARG_PROJECTION_BATCH_SIZE, 1000);
  private readonly dbTxTimeoutMs = this.parsePositiveInt(process.env.MARG_DB_TX_TIMEOUT_MS, 300000);
  private readonly accountingProjectionTxTimeoutMs = this.parsePositiveInt(
    process.env.MARG_ACCOUNTING_PROJECTION_TX_TIMEOUT_MS,
    MARG_ACCOUNTING_PROJECTION_TX_TIMEOUT_MS,
  );
  // How long without a heartbeat before a RUNNING sync log is considered
  // stale and may be marked FAILED_RETRYABLE for recovery. Default 30 min
  // — long enough to safely cover a slow projection batch, short enough
  // that an operator does not wait hours after a worker crash.
  private readonly staleSyncAfterMs = this.parsePositiveInt(process.env.MARG_SYNC_STALE_AFTER_MS, 30 * 60 * 1000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly accountingService: AccountingService,
    // Optional so existing tests that build the service with `new MargEdeService(prisma, audit, accounting)`
    // continue to work. When undefined, raw-page persistence is silently
    // skipped — the sync still runs, but it is not resumable from disk.
    @Optional() private readonly rawPageStorage?: MargRawPageStorage,
  ) {}

  private get margPrisma(): any {
    return this.prisma;
  }

  // ===================== CONFIG MANAGEMENT =====================

  async createConfig(dto: CreateMargConfigDto, user: AuthUser) {
    const config = await this.margPrisma.margSyncConfig.create({
      data: {
        tenantId: user.tenantId,
        companyCode: this.normalizeString(dto.companyCode, 100, true),
        margKey: this.encryptSecret(this.normalizeString(dto.margKey, 120, true)),
        decryptionKey: this.encryptSecret(this.normalizeString(dto.decryptionKey, 120, true)),
        apiBaseUrl: this.normalizeBaseUrl(dto.apiBaseUrl),
        companyId: dto.companyId ?? 0,
        syncFrequency: this.normalizeSyncFrequency(dto.syncFrequency),
        stockProjectionMode: this.resolveStockProjectionMode(dto.stockProjectionMode),
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.CREATE,
      'MargSyncConfig',
      config.id,
      null,
      { companyCode: config.companyCode, apiBaseUrl: config.apiBaseUrl, syncFrequency: config.syncFrequency },
      ['companyCode', 'apiBaseUrl', 'syncFrequency'],
    ).catch(() => {/* best-effort */});

    return this.maskConfigSecrets(config);
  }

  async updateConfig(id: string, dto: UpdateMargConfigDto, user: AuthUser) {
    const existing = await this.margPrisma.margSyncConfig.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException('Marg config not found');

    const updated = await this.margPrisma.margSyncConfig.update({
      where: { id },
      data: {
        ...(dto.companyCode !== undefined && { companyCode: this.normalizeString(dto.companyCode, 100, true) }),
        ...(dto.margKey !== undefined && { margKey: this.encryptSecret(this.normalizeString(dto.margKey, 120, true)) }),
        ...(dto.decryptionKey !== undefined && {
          decryptionKey: this.encryptSecret(this.normalizeString(dto.decryptionKey, 120, true)),
        }),
        ...(dto.apiBaseUrl !== undefined && { apiBaseUrl: this.normalizeBaseUrl(dto.apiBaseUrl) }),
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
        ...(dto.syncFrequency !== undefined && { syncFrequency: this.normalizeSyncFrequency(dto.syncFrequency) }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.stockProjectionMode !== undefined && {
          stockProjectionMode: this.resolveStockProjectionMode(dto.stockProjectionMode),
        }),
      },
    });

    const changedFields = Object.keys(dto).filter(
      (k) => !['margKey', 'decryptionKey'].includes(k),
    );
    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'MargSyncConfig',
      id,
      { companyCode: existing.companyCode, apiBaseUrl: existing.apiBaseUrl, syncFrequency: existing.syncFrequency, isActive: existing.isActive },
      { companyCode: updated.companyCode, apiBaseUrl: updated.apiBaseUrl, syncFrequency: updated.syncFrequency, isActive: updated.isActive },
      changedFields,
    ).catch(() => {/* best-effort */});

    return this.maskConfigSecrets(updated);
  }

  async getConfigs(user: AuthUser) {
    const configs = await this.margPrisma.margSyncConfig.findMany({
      where: { tenantId: user.tenantId },
      include: {
        syncLogs: {
          orderBy: { startedAt: 'desc' },
          take: 5,
        },
      },
    });

    return configs.map((config) => this.maskConfigSecrets(config));
  }

  async getConfig(id: string, user: AuthUser) {
    const config = await this.margPrisma.margSyncConfig.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        syncLogs: {
          orderBy: { startedAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!config) throw new NotFoundException('Marg config not found');
    return this.maskConfigSecrets(config);
  }

  async deleteConfig(id: string, user: AuthUser) {
    const existing = await this.margPrisma.margSyncConfig.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException('Marg config not found');

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.DELETE,
      'MargSyncConfig',
      id,
      { companyCode: existing.companyCode, apiBaseUrl: existing.apiBaseUrl },
      null,
      [],
    ).catch(() => {/* best-effort */});

    await this.margPrisma.margSyncConfig.delete({ where: { id, tenantId: user.tenantId } });
  }

  async getGlMappingRules(
    tenantId: string,
    filters?: { companyId?: number; isActive?: boolean },
  ) {
    return this.margPrisma.margGLMappingRule.findMany({
      where: {
        tenantId,
        ...(filters?.companyId !== undefined ? { companyId: filters.companyId } : {}),
        ...(filters?.isActive !== undefined ? { isActive: filters.isActive } : {}),
      },
      include: {
        glAccount: {
          select: {
            id: true,
            accountNumber: true,
            name: true,
            accountType: true,
          },
        },
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
    });
  }

  async getGlAccounts(tenantId: string) {
    return this.prisma.gLAccount.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        accountNumber: true,
        name: true,
        accountType: true,
        normalBalance: true,
      },
      orderBy: { accountNumber: 'asc' },
    });
  }

  async getGlMappingRule(id: string, tenantId: string) {
    const rule = await this.margPrisma.margGLMappingRule.findFirst({
      where: { id, tenantId },
      include: {
        glAccount: {
          select: {
            id: true,
            accountNumber: true,
            name: true,
            accountType: true,
          },
        },
      },
    });

    if (!rule) {
      throw new NotFoundException('Marg GL mapping rule not found');
    }

    return rule;
  }

  async createGlMappingRule(dto: CreateMargGlMappingRuleDto, user: AuthUser) {
    await this.assertGlAccountExists(user.tenantId, dto.glAccountId);

    const created = await this.margPrisma.margGLMappingRule.create({
      data: {
        tenantId: user.tenantId,
        ruleName: this.normalizeString(dto.ruleName, 100, true),
        companyId: dto.companyId ?? null,
        bookCode: this.normalizeOptionalMargCode(dto.bookCode),
        groupCode: this.normalizeOptionalMargCode(dto.groupCode),
        partyCode: this.normalizeOptionalMargCode(dto.partyCode),
        counterpartyCode: this.normalizeOptionalMargCode(dto.counterpartyCode),
        remarkContains: this.normalizeOptionalSearchText(dto.remarkContains, 100),
        glAccountId: dto.glAccountId,
        isReceivableControl: dto.isReceivableControl ?? false,
        priority: dto.priority ?? 0,
        description: this.normalizeOptionalText(dto.description, 500),
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.CREATE,
      'MargGLMappingRule',
      created.id,
      null,
      {
        ruleName: created.ruleName,
        companyId: created.companyId,
        bookCode: created.bookCode,
        groupCode: created.groupCode,
        glAccountId: created.glAccountId,
        priority: created.priority,
      },
      ['ruleName', 'companyId', 'bookCode', 'groupCode', 'glAccountId', 'priority'],
    ).catch(() => {/* best-effort */});

    return this.getGlMappingRule(created.id, user.tenantId);
  }

  async updateGlMappingRule(id: string, dto: UpdateMargGlMappingRuleDto, user: AuthUser) {
    const existing = await this.margPrisma.margGLMappingRule.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Marg GL mapping rule not found');
    }

    if (dto.glAccountId) {
      await this.assertGlAccountExists(user.tenantId, dto.glAccountId);
    }

    await this.margPrisma.margGLMappingRule.update({
      where: { id },
      data: {
        ...(dto.ruleName !== undefined && { ruleName: this.normalizeString(dto.ruleName, 100, true) }),
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
        ...(dto.bookCode !== undefined && { bookCode: this.normalizeOptionalMargCode(dto.bookCode) }),
        ...(dto.groupCode !== undefined && { groupCode: this.normalizeOptionalMargCode(dto.groupCode) }),
        ...(dto.partyCode !== undefined && { partyCode: this.normalizeOptionalMargCode(dto.partyCode) }),
        ...(dto.counterpartyCode !== undefined && {
          counterpartyCode: this.normalizeOptionalMargCode(dto.counterpartyCode),
        }),
        ...(dto.remarkContains !== undefined && {
          remarkContains: this.normalizeOptionalSearchText(dto.remarkContains, 100),
        }),
        ...(dto.glAccountId !== undefined && { glAccountId: dto.glAccountId }),
        ...(dto.isReceivableControl !== undefined && { isReceivableControl: dto.isReceivableControl }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.description !== undefined && { description: this.normalizeOptionalText(dto.description, 500) }),
      },
    });

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'MargGLMappingRule',
      id,
      {
        ruleName: existing.ruleName,
        companyId: existing.companyId,
        bookCode: existing.bookCode,
        groupCode: existing.groupCode,
        partyCode: existing.partyCode,
        counterpartyCode: existing.counterpartyCode,
        glAccountId: existing.glAccountId,
        priority: existing.priority,
        isReceivableControl: existing.isReceivableControl,
      },
      {
        ruleName: dto.ruleName ?? existing.ruleName,
        companyId: dto.companyId ?? existing.companyId,
        bookCode: dto.bookCode !== undefined ? this.normalizeOptionalMargCode(dto.bookCode) : existing.bookCode,
        groupCode: dto.groupCode !== undefined ? this.normalizeOptionalMargCode(dto.groupCode) : existing.groupCode,
        partyCode: dto.partyCode !== undefined ? this.normalizeOptionalMargCode(dto.partyCode) : existing.partyCode,
        counterpartyCode: dto.counterpartyCode !== undefined
          ? this.normalizeOptionalMargCode(dto.counterpartyCode)
          : existing.counterpartyCode,
        glAccountId: dto.glAccountId ?? existing.glAccountId,
        priority: dto.priority ?? existing.priority,
        isReceivableControl: dto.isReceivableControl ?? existing.isReceivableControl,
      },
      Object.keys(dto),
    ).catch(() => {/* best-effort */});

    return this.getGlMappingRule(id, user.tenantId);
  }

  async deleteGlMappingRule(id: string, user: AuthUser) {
    const existing = await this.margPrisma.margGLMappingRule.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Marg GL mapping rule not found');
    }

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.DELETE,
      'MargGLMappingRule',
      id,
      {
        ruleName: existing.ruleName,
        companyId: existing.companyId,
        bookCode: existing.bookCode,
        groupCode: existing.groupCode,
        glAccountId: existing.glAccountId,
      },
      null,
      [],
    ).catch(() => {/* best-effort */});

    await this.margPrisma.margGLMappingRule.delete({ where: { id } });
  }

  async getReconciliationResults(
    tenantId: string,
    filters?: {
      configId?: string;
      syncLogId?: string;
      type?: MargReconciliationType;
      status?: MargReconciliationStatus;
      take?: number;
    },
  ) {
    let scopedSyncLogIds: string[] | undefined;
    if (filters?.configId && !filters.syncLogId) {
      const syncLogs = await this.margPrisma.margSyncLog.findMany({
        where: {
          tenantId,
          configId: filters.configId,
        },
        select: { id: true },
        orderBy: { startedAt: 'desc' },
        take: 200,
      });

      scopedSyncLogIds = syncLogs.map((syncLog) => syncLog.id);
      if (scopedSyncLogIds.length === 0) {
        return [];
      }
    }

    return this.margPrisma.margReconciliationResult.findMany({
      where: {
        tenantId,
        ...(filters?.syncLogId ? { syncLogId: filters.syncLogId } : {}),
        ...(!filters?.syncLogId && scopedSyncLogIds ? { syncLogId: { in: scopedSyncLogIds } } : {}),
        ...(filters?.type ? { reconciliationType: filters.type } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: [
        { createdAt: 'desc' },
        { reconciliationType: 'asc' },
      ],
      take: Math.min(100, Math.max(1, filters?.take ?? 25)),
    });
  }

  // ===================== SYNC STATUS =====================

  async getSyncLogs(configId: string, user: AuthUser): Promise<MargSyncLogStatusDto[]> {
    const rows = await this.margPrisma.margSyncLog.findMany({
      where: { configId, tenantId: user.tenantId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return rows.map((row: Record<string, unknown>) => toMargSyncLogStatusDto(row, this.staleSyncAfterMs));
  }

  /**
   * Single-log status fetch for the resume / status endpoint. Refuses to
   * return a log that does not belong to the (tenant, config) tuple — UI
   * cannot probe for foreign sync logs by guessing IDs.
   */
  async getSyncLogStatus(
    configId: string,
    syncLogId: string,
    user: AuthUser,
  ): Promise<MargSyncLogStatusDto> {
    const row = await this.margPrisma.margSyncLog.findFirst({
      where: { id: syncLogId, configId, tenantId: user.tenantId },
    });
    if (!row) {
      throw new NotFoundException(`Marg sync log ${syncLogId} not found for this config`);
    }
    return toMargSyncLogStatusDto(row as Record<string, unknown>, this.staleSyncAfterMs);
  }

  // ===================== MARG API CALLS =====================

  /** Fetch branch list (GET, unencrypted) */
  async fetchBranches(config: {
    apiBaseUrl: string;
    companyCode: string;
  }): Promise<any[]> {
    const margOrigin = this.resolveMargOrigin(config.apiBaseUrl);
    const url = `${margOrigin}/api/margcorporateede/masters?companycode=${encodeURIComponent(config.companyCode)}`;
    this.logger.log(`Fetching Marg branches from: ${url}`);

    const body = await this.fetchJsonWithTimeout(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!body || typeof body !== 'object') {
      return [];
    }

    const rows = (body as { Data?: unknown }).Data;
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Fetch main data (POST, encrypted response).
   *
   * Thin orchestrator over fetchRawMargPage → decryptMargPage → parseMargPayload.
   * Public surface preserved exactly: same signature, same return shape. Both
   * runSync call sites and the existing test mocks rely on this API.
   *
   * For the resumable-pipeline path that needs to persist the raw page to
   * durable storage before staging, use fetchMargPageWithMetadata which
   * exposes encrypted/decrypted sizes, hash, parse durations, and per-section
   * row counts.
   */
  async fetchData(config: {
    apiBaseUrl: string;
    companyCode: string;
    margKey: string;
    decryptionKey: string;
    companyId: number;
    index: number;
    datetime: string;
    apiType?: '1' | '2';
  }): Promise<MargParsedPayload> {
    const result = await this.fetchMargPageWithMetadata(config);
    return result.payload;
  }

  /**
   * Fetch + decrypt + parse a single Marg page and return both the parsed
   * payload and the metadata required to persist a marg_raw_sync_pages row.
   *
   * Behavior is bit-for-bit identical to the previous monolithic fetchData()
   * for the parsed payload. The new return shape adds size/hash/duration
   * metadata captured along the way at zero extra cost.
   *
   * Memory note: the caller receives the parsed payload by reference. Once
   * the caller has consumed each section, it should drop its references
   * (processPayloadSections does this automatically) so V8 can reclaim the
   * large arrays mid-staging.
   */
  async fetchMargPageWithMetadata(config: {
    apiBaseUrl: string;
    companyCode: string;
    margKey: string;
    decryptionKey: string;
    companyId: number;
    index: number;
    datetime: string;
    apiType?: '1' | '2';
  }): Promise<{
    payload: MargParsedPayload;
    rowCounts: Record<string, number>;
    encryptedSize: number;
    fetchDurationMs: number;
    decryptDurationMs: number;
    parseDurationMs: number;
  }> {
    const apiType = config.apiType ?? '2';
    const fetchStarted = Date.now();
    const memBefore = process.memoryUsage().heapUsed;

    const fetched = await this.fetchRawMargPage({
      apiBaseUrl: config.apiBaseUrl,
      companyCode: config.companyCode,
      margKey: config.margKey,
      companyId: config.companyId,
      index: config.index,
      datetime: config.datetime,
      apiType,
    });
    const fetchDurationMs = Date.now() - fetchStarted;

    const decryptStarted = Date.now();
    const decrypted = this.decryptMargPage(fetched.rawResponse, config.decryptionKey);
    const decryptDurationMs = Date.now() - decryptStarted;

    const parseStarted = Date.now();
    const parsed = this.parseMargPayload(decrypted.parsedPayload, fetched.rawEnvelope);
    const parseDurationMs = Date.now() - parseStarted;

    const memAfter = process.memoryUsage().heapUsed;
    const totalRows = Object.values(parsed.rowCounts).reduce((sum, n) => sum + n, 0);

    // decryptedSize is reported by storage.save during persistence (see
    // MargRawPageStorage.save) — we no longer compute it here because that
    // required a full-page JSON.stringify which OOMs on huge pages.
    this.logger.log(
      `Marg page fetched apiType=${apiType} index=${config.index} ` +
      `encryptedSize=${fetched.encryptedSize}B ` +
      `rowsTotal=${totalRows} fetchMs=${fetchDurationMs} decryptMs=${decryptDurationMs} ` +
      `parseMs=${parseDurationMs} heapDelta=${(memAfter - memBefore) / (1024 * 1024) | 0}MB ` +
      `dataStatus=${parsed.payload.DataStatus} nextIndex=${parsed.payload.Index}`,
    );

    return {
      payload: parsed.payload,
      rowCounts: parsed.rowCounts,
      encryptedSize: fetched.encryptedSize,
      fetchDurationMs,
      decryptDurationMs,
      parseDurationMs,
    };
  }

  /**
   * Stage 1 of fetchData: hit the Marg POST endpoint and return the raw
   * response body unchanged. Captures the wire size so call sites can log
   * it for capacity-planning (a 50MB page is the threshold we instrument
   * around). No business decoding is done here so a network failure cannot
   * be confused with a payload-shape failure.
   */
  private async fetchRawMargPage(config: {
    apiBaseUrl: string;
    companyCode: string;
    margKey: string;
    companyId: number;
    index: number;
    datetime: string;
    apiType: '1' | '2';
  }): Promise<{ rawResponse: unknown; rawEnvelope: Record<string, unknown> | null; encryptedSize: number }> {
    const margOrigin = this.resolveMargOrigin(config.apiBaseUrl);
    const url = `${margOrigin}/api/eOnlineData/MargCorporateEDE`;

    const body = {
      CompanyCode: config.companyCode,
      Datetime: config.datetime || '',
      MargKey: config.margKey,
      Index: String(config.index),
      CompanyID: String(config.companyId),
      APIType: config.apiType,
    };

    this.logger.log(`Fetching Marg EDE data: apiType=${config.apiType}, index=${config.index}, datetime=${config.datetime || '(all)'}`);

    const rawResponse = await this.fetchJsonWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      this.dataRequestTimeoutMs,
    );

    const rawEnvelope = this.toRecord(rawResponse);
    const envelopeStatus = String(rawEnvelope?.Status ?? '').trim().toUpperCase();
    if (envelopeStatus === 'FAILURE') {
      throw new BadRequestException(`Marg API failure: ${String(rawEnvelope?.Message ?? 'Unknown error')}`);
    }

    // Best-effort wire-size measurement. Marg returns either a raw encrypted
    // string or a JSON envelope; for the JSON envelope we measure the
    // encrypted Data field (the bulky bit) when present, else the serialized
    // envelope. Approximate is fine — this is for observability, not a billed
    // metric.
    // Wire-size measurement: only cheap-to-measure shapes are sized. For a
    // raw encrypted string body we use Buffer.byteLength directly; for the
    // common JSON envelope we size only the encrypted Data field. We do
    // NOT JSON.stringify the entire envelope object as a fallback — for
    // the million-record client the envelope already holds a multi-hundred-
    // MB decoded payload and stringifying it just to measure its byte
    // length is exactly what triggered the OOM in JsonStringifier::Serialize_.
    let encryptedSize = 0;
    if (typeof rawResponse === 'string') {
      encryptedSize = Buffer.byteLength(rawResponse, 'utf8');
    } else if (rawEnvelope && typeof rawEnvelope.Data === 'string') {
      encryptedSize = Buffer.byteLength(rawEnvelope.Data, 'utf8');
    }
    // else: envelope-with-object-Data or unknown shape → leave at 0.
    // encryptedSize is observability, not load-bearing; an unknown value
    // is fine.

    return { rawResponse, rawEnvelope, encryptedSize };
  }

  /**
   * Stage 2 of fetchData: take the raw response/envelope and produce the
   * decoded JSON object. Preserves exact tenant-variant handling:
   *   - raw encrypted string body          → parseMargStringPayload
   *   - JSON envelope with encrypted Data  → parseMargStringPayload(envelope.Data)
   *   - JSON envelope with object Data     → envelope.Data
   *   - JSON envelope alone                → envelope itself (fallback)
   *
   * Memory note: this method intentionally does NOT JSON.stringify the
   * parsed payload to compute a hash. For the million-record client a
   * single page can be 200–500MB of JS objects, and JSON.stringify on
   * the whole thing triggers V8 OOM inside JsonStringifier::Serialize_.
   * Hash + decrypted-size are produced by MargRawPageStorage.save in a
   * streamed pass — it has to walk the bytes anyway to gzip them, so
   * computing the hash there is free and never materializes the full
   * serialized form in memory.
   */
  private decryptMargPage(
    rawResponse: unknown,
    decryptionKey: string,
  ): { parsedPayload: Record<string, unknown> } {
    const rawEnvelope = this.toRecord(rawResponse);

    let parsedPayload: Record<string, unknown>;
    if (typeof rawResponse === 'string') {
      parsedPayload = this.parseMargStringPayload(rawResponse, decryptionKey);
    } else if (rawEnvelope) {
      if (typeof rawEnvelope.Data === 'string' && rawEnvelope.Data.trim().length > 0) {
        parsedPayload = this.parseMargStringPayload(rawEnvelope.Data, decryptionKey);
      } else if (rawEnvelope.Data && typeof rawEnvelope.Data === 'object') {
        parsedPayload = rawEnvelope.Data as Record<string, unknown>;
      } else {
        parsedPayload = rawEnvelope;
      }
    } else {
      throw new BadRequestException('Marg API returned unexpected response shape');
    }

    return { parsedPayload };
  }

  /**
   * Stage 3 of fetchData: normalize the decoded JSON into the canonical
   * MargParsedPayload shape, computing per-section row counts as we go so
   * call sites can log them and persist them on the raw-page row without
   * re-walking the arrays.
   *
   * Fallback to envelope-level fields for Index/DataStatus/DateTime
   * preserves the existing behavior where some Marg variants put cursor
   * fields on the outer envelope rather than inside Details.
   */
  private parseMargPayload(
    parsedPayload: Record<string, unknown>,
    rawEnvelope: Record<string, unknown> | null,
  ): { payload: MargParsedPayload; rowCounts: Record<string, number> } {
    const detailsContainer = this.toRecord(parsedPayload.Details);
    const dataSection = detailsContainer ?? parsedPayload;

    const payloadStatus = String(
      this.readFirstDefined([dataSection, parsedPayload], ['Status', 'status']) ?? '',
    ).trim().toUpperCase();
    if (payloadStatus === 'FAILURE') {
      const failureMessage = String(
        this.readFirstDefined(
          rawEnvelope ? [dataSection, parsedPayload, rawEnvelope] : [dataSection, parsedPayload],
          ['Message', 'message'],
        ) ?? 'Unknown error',
      );
      throw new BadRequestException(`Marg API failure: ${failureMessage}`);
    }

    const cursorSources = rawEnvelope
      ? [dataSection, parsedPayload, rawEnvelope]
      : [dataSection, parsedPayload];
    const sectionSources = [dataSection, parsedPayload];

    const parsedIndex = Number(this.readFirstDefined(cursorSources, ['Index']) ?? 0);
    const rawDataStatus = this.readFirstDefined(cursorSources, ['DataStatus', 'Datastatus']);
    // Marg returns DataStatus as numeric 10 or string "Completed" depending on tenant/version
    const parsedDataStatus = this.normalizeDataStatus(rawDataStatus);
    const parsedDateTime = String(
      this.readFirstDefined(cursorSources, ['DateTime', 'Datetime']) ?? '',
    ).trim();

    const payload: MargParsedPayload = {
      Details: this.toArray(this.readFirstDefined(sectionSources, ['Details', 'Dis'])),
      Masters: this.toEntityArray(this.readFirstDefined(sectionSources, ['Masters'])),
      MDis: this.toArray(this.readFirstDefined(sectionSources, ['MDis'])),
      Party: this.toArray(this.readFirstDefined(sectionSources, ['Party'])),
      Product: this.toArray(this.readFirstDefined(sectionSources, ['Product'])),
      SaleType: this.toArray(this.readFirstDefined(sectionSources, ['SaleType'])),
      Stock: this.toArray(this.readFirstDefined(sectionSources, ['Stock'])),
      ACGroup: this.toArray(this.readFirstDefined(sectionSources, ['ACGroup'])),
      Account: this.toArray(this.readFirstDefined(sectionSources, ['Account'])),
      AcBal: this.toArray(this.readFirstDefined(sectionSources, ['AcBal'])),
      PBal: this.toArray(this.readFirstDefined(sectionSources, ['PBal'])),
      Outstanding: this.toArray(this.readFirstDefined(sectionSources, ['Outstanding'])),
      Index: Number.isFinite(parsedIndex) ? parsedIndex : 0,
      DataStatus: Number.isFinite(parsedDataStatus) ? parsedDataStatus : 0,
      DateTime: parsedDateTime,
    };

    const rowCounts: Record<string, number> = {
      Details: payload.Details.length,
      Masters: payload.Masters.length,
      MDis: payload.MDis.length,
      Party: payload.Party.length,
      Product: payload.Product.length,
      SaleType: payload.SaleType.length,
      Stock: payload.Stock.length,
      ACGroup: payload.ACGroup.length,
      Account: payload.Account.length,
      AcBal: payload.AcBal.length,
      PBal: payload.PBal.length,
      Outstanding: payload.Outstanding.length,
    };

    return { payload, rowCounts };
  }

  /**
   * Stage 4 of fetchData: iterate a parsed payload's sections, run a handler
   * per non-empty section, and release the array reference once the handler
   * returns so V8 can reclaim the memory before the next section is
   * processed. Sections execute strictly in the supplied order; any handler
   * that throws aborts the loop and bubbles the error to the caller (do not
   * swallow — partial section processing must be visible to the resume
   * machinery so the page is marked STAGING_FAILED rather than STAGED).
   *
   * The handler signature is async and receives the section rows as well
   * as the section key so a single shared handler can switch on type.
   */
  protected async processPayloadSections<K extends keyof MargParsedPayload>(
    payload: MargParsedPayload,
    sections: K[],
    handler: (section: K, rows: MargParsedPayload[K]) => Promise<void>,
  ): Promise<void> {
    for (const section of sections) {
      const rows = payload[section];
      if (Array.isArray(rows) && rows.length === 0) {
        continue;
      }
      await handler(section, rows);
      // Release the reference so the array can be GC'd before the next
      // section is processed. Cast through unknown because TS does not
      // know we are intentionally clearing arrays; the sections we mutate
      // here are all `any[]` in MargParsedPayload anyway.
      (payload as unknown as Record<string, unknown>)[section as string] = Array.isArray(rows) ? [] : rows;
    }
  }

  // ===================== FULL SYNC ORCHESTRATOR =====================

  private async getLatestCompletedSyncLogCursor(
    tenantId: string,
    configId: string,
  ): Promise<{ syncIndex: number; syncDatetime: string } | null> {
    if (typeof this.margPrisma.margSyncLog.findFirst !== 'function') {
      return null;
    }

    const latest = await this.margPrisma.margSyncLog.findFirst({
      where: {
        tenantId,
        configId,
        status: MARG_SYNC_STATUS.COMPLETED,
        OR: [
          { syncIndex: { gt: 0 } },
          { syncDatetime: { not: null } },
        ],
      },
      orderBy: [
        { completedAt: 'desc' },
        { startedAt: 'desc' },
      ],
      select: {
        syncIndex: true,
        syncDatetime: true,
      },
    });

    const syncDatetime = String(latest?.syncDatetime || '').trim();
    if (!latest || (!latest.syncIndex && !syncDatetime)) {
      return null;
    }

    return {
      syncIndex: Number(latest.syncIndex ?? 0),
      syncDatetime,
    };
  }

  async runSync(
    configId: string,
    tenantId: string,
    triggeredBy?: string,
    fromDate?: string,
    endDate?: string,
    scope: MargSyncScope = MARG_SYNC_SCOPE.FULL,
    mode: MargSyncMode = MARG_SYNC_MODE.FETCH,
  ): Promise<string> {
    const config = await this.margPrisma.margSyncConfig.findFirst({
      where: { id: configId, tenantId },
    });

    if (!config) throw new NotFoundException('Marg config not found');
    if (!config.isActive) throw new BadRequestException('Marg sync config is disabled');

    const shouldFetchFromMarg = mode === MARG_SYNC_MODE.FETCH;
    const shouldRunInventory = scope === MARG_SYNC_SCOPE.FULL;
    const syncLabel = shouldRunInventory ? 'full' : 'accounting-only';
    const operationLabel = shouldFetchFromMarg ? 'sync' : 'reprojection';

    const lock = await this.margPrisma.margSyncConfig.updateMany({
      where: {
        id: configId,
        tenantId,
        lastSyncStatus: { not: MARG_SYNC_STATUS.RUNNING },
        lastAccountingSyncStatus: { not: MARG_SYNC_STATUS.RUNNING },
      },
      data: shouldRunInventory
        ? {
          lastSyncStatus: MARG_SYNC_STATUS.RUNNING,
          lastAccountingSyncStatus: MARG_SYNC_STATUS.RUNNING,
        }
        : {
          lastAccountingSyncStatus: MARG_SYNC_STATUS.RUNNING,
        },
    });

    if (lock.count === 0) {
      throw new BadRequestException('Sync is already running for this configuration');
    }

    let margKey = '';
    let decryptionKey = '';
    const dateWindow = this.buildDateWindow(fromDate, endDate);
    // No upper bound means Marg can advance us through the latest available page.
    // Date-window backfills with an endDate remain non-committing so old bounded
    // replays cannot move the saved incremental cursor past skipped rows.
    const shouldCommitCursor = shouldFetchFromMarg && !endDate;
    const shouldProcessStockSnapshot = !endDate;
    const recoveredInventoryCursor = shouldFetchFromMarg
      && shouldRunInventory
      && !fromDate
      && !endDate
      && !config.lastSyncIndex
      && !config.lastSyncDatetime
      ? await this.getLatestCompletedSyncLogCursor(tenantId, configId)
      : null;

    // When fromDate is provided, override the stored cursor to fetch from that date.
    // Index resets to 0 so the Marg API returns data starting from the specified date.
    let currentIndex = shouldFetchFromMarg && fromDate ? 0 : (config.lastSyncIndex || recoveredInventoryCursor?.syncIndex || 0);
    let lastDatetime = shouldFetchFromMarg && fromDate ? fromDate : (config.lastSyncDatetime || recoveredInventoryCursor?.syncDatetime || '');
    let accountingIndex = shouldFetchFromMarg && fromDate ? 0 : (config.lastAccountingSyncIndex ?? 0);
    let accountingDatetime = shouldFetchFromMarg && fromDate ? fromDate : config.lastAccountingSyncDatetime || '';
    const getActiveCursor = () => ({
      syncIndex: shouldRunInventory ? currentIndex : accountingIndex,
      syncDatetime: (shouldRunInventory ? lastDatetime : accountingDatetime) || null,
    });

    // Create sync log. Persist the window/scope/mode metadata so resume can
    // reuse the original parameters — without this, a bounded backfill that
    // crashes mid-staging could be resumed as if it were an unbounded
    // incremental, re-staging out-of-window rows.
    const syncLog = await this.margPrisma.margSyncLog.create({
      data: {
        tenantId,
        configId,
        status: MARG_SYNC_STATUS.RUNNING,
        currentStage: MARG_SYNC_STAGE.QUEUED,
        lastHeartbeatAt: new Date(),
        fromDate: fromDate ?? null,
        endDate: endDate ?? null,
        syncScope: scope,
        syncMode: mode,
        ...getActiveCursor(),
      },
    });

    const errors: any[] = [];
    const diagnostics = this.createMargSyncDiagnostics();
    const syncedBranchCompanyIds = new Set<string>();
    let productsCount = 0;
    let partiesCount = 0;
    let transactionsCount = 0;
    let stockCount = 0;
    let branchesCount = 0;
    let vouchersCount = 0;
    let saleTypesCount = 0;
    let accountGroupsCount = 0;
    let accountPostingsCount = 0;
    let accountGroupBalancesCount = 0;
    let partyBalancesCount = 0;
    let outstandingsCount = 0;
    let journalEntriesCount = 0;

    let receivedStockSnapshot = false;

    try {
      margKey = this.decryptSecret(config.margKey);
      decryptionKey = this.decryptSecret(config.decryptionKey);

      if (shouldFetchFromMarg && shouldRunInventory) {
        // Step 1: Fetch and sync branches
        try {
          const branches = await this.fetchBranches({
            apiBaseUrl: config.apiBaseUrl,
            companyCode: config.companyCode,
          });
          const nextBranches = this.takeUnseenMargBranchRows(branches, syncedBranchCompanyIds);
          branchesCount = await this.syncBranches(tenantId, nextBranches);
          await this.touchSyncHeartbeat(configId, shouldRunInventory);
        } catch (err) {
          errors.push({ step: 'branches', error: String(err) });
          this.logger.warn('Branch sync failed (non-fatal)', err);
        }

        // Step 2: Paginated inventory/master data fetch
        let completed = false;

        for (let page = 0; page < this.maxPagesPerSync; page++) {
          const previousIndex = currentIndex;
          const previousDatetime = lastDatetime;

          await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.FETCHING, {
            apiType: '2',
            requestIndex: currentIndex,
          });

          const payload = await this.fetchData({
            apiBaseUrl: config.apiBaseUrl,
            companyCode: config.companyCode,
            margKey,
            decryptionKey,
            companyId: config.companyId,
            index: currentIndex,
            datetime: lastDatetime,
            apiType: '2',
          });

          // Persist the parsed page to the durable raw-page store BEFORE any
          // staging happens. If staging fails for this page, the next sync
          // can resume by re-loading from disk instead of refetching from
          // Marg. The helper is null-safe — it returns null when raw-page
          // storage is not wired (tests, older deployments) or when the
          // write itself fails (errors[] receives a non-fatal entry); in
          // either case the sync continues unmodified.
          const rawPageRowId = await this.persistMargRawPage({
            syncLogId: syncLog.id,
            tenantId,
            configId,
            apiType: '2',
            companyId: config.companyId,
            requestIndex: previousIndex,
            payload,
            errors,
          });

          await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.STAGING_STARTED, {
            apiType: '2',
            requestIndex: previousIndex,
          });

          try {
            const payloadMasters = Array.isArray(payload.Masters) ? payload.Masters : [];
            const payloadProducts = Array.isArray(payload.Product) ? payload.Product : [];
            const payloadParties = Array.isArray(payload.Party) ? payload.Party : [];
            const payloadDetails = Array.isArray(payload.Details) ? payload.Details : [];
            const payloadStock = Array.isArray(payload.Stock) ? payload.Stock : [];
            const payloadVouchers = Array.isArray(payload.MDis) ? payload.MDis : [];
            const payloadSaleTypes = Array.isArray(payload.SaleType) ? payload.SaleType : [];

            if (payloadMasters.length > 0) {
              diagnostics.branchPayloadRowCount += payloadMasters.length;
              const payloadBranches = this.takeUnseenMargBranchRows(payloadMasters, syncedBranchCompanyIds);
              if (payloadBranches.length > 0) {
                const count = await this.syncBranches(tenantId, payloadBranches);
                branchesCount += count;
                diagnostics.branchPayloadFallbackCount += payloadBranches.length;
              }
            }

            if (payloadProducts.length > 0) {
              const count = await this.syncProducts(tenantId, payloadProducts, syncLog.id);
              productsCount += count;
            }

            if (payloadParties.length > 0) {
              const canonicalParties = this.canonicalizeMargParties(payloadParties);
              diagnostics.duplicatePartyKeyCount += canonicalParties.duplicateKeyCount;
              diagnostics.duplicatePartyRowCount += canonicalParties.duplicateRowCount;
              const count = await this.syncParties(tenantId, canonicalParties.rows, syncLog.id);
              partiesCount += count;
            }

            if (payloadDetails.length > 0) {
              for (const detail of payloadDetails) {
                const freeQty = Number(detail?.Free ?? 0);
                const paidQty = Number(detail?.Qty ?? 0);
                if (Number.isFinite(freeQty) && freeQty > 0) {
                  diagnostics.freeQuantityRowCount += 1;
                  diagnostics.freeQuantityUnits += freeQty;
                  if (!Number.isFinite(paidQty) || paidQty === 0) {
                    diagnostics.freeOnlyRowCount += 1;
                  }
                }
              }
              const count = await this.syncTransactions(tenantId, payloadDetails, dateWindow, syncLog.id);
              transactionsCount += count;
            }

            if (shouldProcessStockSnapshot && payloadStock.length > 0) {
              receivedStockSnapshot = true;
              const count = await this.syncStockData(tenantId, payloadStock, syncLog.id);
              stockCount += count;
            }

            if (payloadVouchers.length > 0) {
              const count = await this.syncVouchers(tenantId, payloadVouchers, dateWindow, syncLog.id);
              vouchersCount += count;
            }

            if (payloadSaleTypes.length > 0) {
              const count = await this.syncSaleTypes(tenantId, payloadSaleTypes);
              saleTypesCount += count;
            }
          } catch (stagingErr) {
            await this.markRawPageStagingFailed(rawPageRowId, stagingErr);
            throw stagingErr;
          }

          // All sections for this page persisted successfully. Mark the raw
          // page STAGED so a future resume scan ignores it, then advance the
          // cursor — only AFTER staging is durable.
          await this.markRawPageStaged(rawPageRowId);
          await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.STAGING_COMPLETED, {
            apiType: '2',
            requestIndex: previousIndex,
            responseIndex: payload.Index,
          });

          const nextDatetime = String(payload.DateTime || '').trim();
          const hasIndexCursor = Number.isInteger(payload.Index) && payload.Index >= 0;
          const indexAdvanced = hasIndexCursor && payload.Index > previousIndex;
          const datetimeAdvanced = Boolean(nextDatetime) && nextDatetime !== previousDatetime;

          if (indexAdvanced) {
            currentIndex = payload.Index;
          }

          if (nextDatetime) {
            lastDatetime = nextDatetime;
          }

          await this.touchSyncHeartbeat(configId, shouldRunInventory);

          if (payload.DataStatus === COMPLETE_DATA_STATUS) {
            completed = true;
            break;
          }

          if (!indexAdvanced && !datetimeAdvanced) {
            this.logger.warn(
              `Marg cursor unchanged; treating payload as terminal page (index=${payload.Index}, datetime=${nextDatetime || 'n/a'})`,
            );
            completed = true;
            break;
          }
        }

        if (!completed) {
          throw new BadRequestException(
            `Marg sync exceeded max pages (${this.maxPagesPerSync}) before completion`,
          );
        }
      }

      let accountingCompleted = !shouldFetchFromMarg;

      for (let page = 0; shouldFetchFromMarg && page < this.maxPagesPerSync; page++) {
        const previousIndex = accountingIndex;
        const previousDatetime = accountingDatetime;

        await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.FETCHING, {
          apiType: '1',
          requestIndex: accountingIndex,
        });

        const payload = await this.fetchData({
          apiBaseUrl: config.apiBaseUrl,
          companyCode: config.companyCode,
          margKey,
          decryptionKey,
          companyId: config.companyId,
          index: accountingIndex,
          datetime: accountingDatetime,
          apiType: '1',
        });

        const rawPageRowId = await this.persistMargRawPage({
          syncLogId: syncLog.id,
          tenantId,
          configId,
          apiType: '1',
          companyId: config.companyId,
          requestIndex: previousIndex,
          payload,
          errors,
        });

        await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.STAGING_STARTED, {
          apiType: '1',
          requestIndex: previousIndex,
        });

        try {
          const payloadAccountingVouchers = Array.isArray(payload.MDis) ? payload.MDis : [];
          const payloadAccountGroups = Array.isArray(payload.ACGroup) ? payload.ACGroup : [];
          const payloadAccountRows = Array.isArray(payload.Account) ? payload.Account : [];
          const payloadAccountBalances = Array.isArray(payload.AcBal) ? payload.AcBal : [];
          const payloadPartyBalances = Array.isArray(payload.PBal) ? payload.PBal : [];
          const payloadOutstandings = Array.isArray(payload.Outstanding) ? payload.Outstanding : [];

          if (!shouldRunInventory && payloadAccountingVouchers.length > 0) {
            const count = await this.syncVouchers(tenantId, payloadAccountingVouchers, dateWindow, syncLog.id);
            vouchersCount += count;
          }

          if (payloadAccountGroups.length > 0) {
            const count = await this.syncAccountGroups(tenantId, payloadAccountGroups);
            accountGroupsCount += count;
          }

          if (payloadAccountRows.length > 0) {
            const count = await this.syncAccountPostings(tenantId, payloadAccountRows, dateWindow, syncLog.id);
            accountPostingsCount += count;
          }

          if (payloadAccountBalances.length > 0) {
            const count = await this.syncAccountGroupBalances(tenantId, payloadAccountBalances);
            accountGroupBalancesCount += count;
          }

          if (payloadPartyBalances.length > 0) {
            const canonicalBalances = this.canonicalizeMargPartyBalances(payloadPartyBalances);
            diagnostics.duplicatePartyBalanceKeyCount += canonicalBalances.duplicateKeyCount;
            diagnostics.duplicatePartyBalanceRowCount += canonicalBalances.duplicateRowCount;
            const count = await this.syncPartyBalances(tenantId, canonicalBalances.rows);
            partyBalancesCount += count;
          }

          if (payloadOutstandings.length > 0) {
            const count = await this.syncOutstandings(tenantId, payloadOutstandings, dateWindow, syncLog.id);
            outstandingsCount += count;
          }
        } catch (stagingErr) {
          await this.markRawPageStagingFailed(rawPageRowId, stagingErr);
          throw stagingErr;
        }

        await this.markRawPageStaged(rawPageRowId);
        await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.STAGING_COMPLETED, {
          apiType: '1',
          requestIndex: previousIndex,
          responseIndex: payload.Index,
        });

        const nextDatetime = String(payload.DateTime || '').trim();
        const hasIndexCursor = Number.isInteger(payload.Index) && payload.Index >= 0;
        const indexAdvanced = hasIndexCursor && payload.Index > previousIndex;
        const datetimeAdvanced = Boolean(nextDatetime) && nextDatetime !== previousDatetime;

        if (indexAdvanced) {
          accountingIndex = payload.Index;
        }

        if (nextDatetime) {
          accountingDatetime = nextDatetime;
        }

        await this.touchSyncHeartbeat(configId, shouldRunInventory);

        if (payload.DataStatus === COMPLETE_DATA_STATUS) {
          accountingCompleted = true;
          break;
        }

        if (!indexAdvanced && !datetimeAdvanced) {
          this.logger.warn(
            `Marg accounting cursor unchanged; treating payload as terminal page ` +
            `(index=${payload.Index}, datetime=${nextDatetime || 'n/a'})`,
          );
          accountingCompleted = true;
          break;
        }
      }

      if (!accountingCompleted) {
        throw new BadRequestException(
          `Marg accounting sync exceeded max pages (${this.maxPagesPerSync}) before completion`,
        );
      }

      // We can only safely mark missing-from-payload stock as deleted when the
      // sync just consumed a *complete* current Marg stock snapshot. An
      // incremental fetch (cursor inherited from a previous run, or a
      // date-windowed pull) might only return batches whose movements changed,
      // and zeroing the rest would silently delete genuine on-hand stock.
      const startedFromCleanCursor = !fromDate && config.lastSyncIndex === 0 && !config.lastSyncDatetime;
      const stockSnapshotIsAuthoritative = shouldFetchFromMarg
        && shouldRunInventory
        && shouldProcessStockSnapshot
        && receivedStockSnapshot
        && startedFromCleanCursor
        && !dateWindow;

      if (stockSnapshotIsAuthoritative) {
        await this.markMissingStockAsDeleted(tenantId, syncLog.id);
      } else if (shouldFetchFromMarg && shouldRunInventory && shouldProcessStockSnapshot && !receivedStockSnapshot) {
        this.logger.warn(
          'Marg sync received no stock snapshot rows; preserving previously staged stock and skipping stock-derived projections for this run',
        );
      } else if (shouldFetchFromMarg && shouldRunInventory && shouldProcessStockSnapshot && receivedStockSnapshot) {
        this.logger.log(
          `Marg sync stock snapshot is incremental (cursor=${config.lastSyncIndex}@${config.lastSyncDatetime || 'n/a'}, dateWindow=${dateWindow ? 'yes' : 'no'}); upserting received batches without flagging unseen rows as deleted`,
        );
      }

      // Step 3: Transform staged data → core tables
      await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.MASTER_TRANSFORM_STARTED);
      const shouldResetInventoryProjection = shouldRunInventory && (mode === MARG_SYNC_MODE.REPROJECT || Boolean(dateWindow));
      const shouldApplyStockProjection = shouldProcessStockSnapshot && (!shouldFetchFromMarg || receivedStockSnapshot);
      let inventoryProjectionReset: MargInventoryProjectionResetResult | null = null;
      if (shouldRunInventory) {
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        await this.transformBranches(tenantId);
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        await this.transformMargNamedMasters(tenantId);
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        await this.transformProducts(tenantId);
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        await this.transformParties(tenantId);
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        try {
          diagnostics.suppliersProjected += await this.transformSuppliers(tenantId);
        } catch (err) {
          errors.push({ step: 'supplier_projection', error: String(err) });
          this.logger.warn('Supplier projection failed (non-fatal)', err);
        }
        await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.MASTER_TRANSFORM_COMPLETED);
        await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.INVENTORY_PROJECTION_STARTED);
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        if (shouldResetInventoryProjection) {
          inventoryProjectionReset = await this.resetMargInventoryProjectionWindow(tenantId, dateWindow);
          await this.touchSyncHeartbeat(configId, shouldRunInventory);
        }
        await this.transformMargProcurementDocuments(tenantId, dateWindow, shouldResetInventoryProjection);
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        await this.transformTransactionsToActuals(tenantId, dateWindow, shouldResetInventoryProjection);
        if (shouldApplyStockProjection) {
          await this.touchSyncHeartbeat(configId, shouldRunInventory);
          await this.transformStockToInventoryLevels(tenantId, this.resolveStockProjectionMode(config.stockProjectionMode));
          await this.touchSyncHeartbeat(configId, shouldRunInventory);
          await this.transformStockToBatches(tenantId);
        }
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        await this.transformTransactionsToInventoryTransactions(tenantId, dateWindow, shouldResetInventoryProjection);
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        await this.transformTransactionsToInventoryLedger(
          tenantId,
          dateWindow,
          shouldResetInventoryProjection,
          inventoryProjectionReset?.affectedLedgerScopes,
        );
        await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.INVENTORY_PROJECTION_COMPLETED);
      } else {
        await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.MASTER_TRANSFORM_COMPLETED);
      }

      let accountingProjection: MargAccountingProjectionSummary | null = null;
      if (!shouldRunInventory) {
        try {
          await this.touchSyncHeartbeat(configId, shouldRunInventory);
          diagnostics.suppliersProjected += await this.transformSuppliers(tenantId);
        } catch (err) {
          errors.push({ step: 'supplier_projection', error: String(err) });
          this.logger.warn('Supplier projection failed (non-fatal)', err);
        }
      }

      await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.ACCOUNTING_PROJECTION_STARTED);
      try {
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        accountingProjection = await this.transformAccountPostingsToJournalEntries(
          tenantId,
          { id: syncLog.id, startedAt: syncLog.startedAt, mode },
          dateWindow,
          triggeredBy,
        );
        journalEntriesCount = accountingProjection.journalEntriesSynced;
        diagnostics.duplicateAccountPostingFingerprintCount += accountingProjection.diagnostics?.duplicateFingerprintCount ?? 0;
        diagnostics.duplicateAccountPostingRowCount += accountingProjection.diagnostics?.duplicateRowCount ?? 0;
        for (const [reason, count] of Object.entries(accountingProjection.diagnostics?.skippedByReason ?? {})) {
          this.incrementReasonCount(diagnostics.skippedAccountingGroupsByReason, reason, count);
        }
        if (accountingProjection.skippedGroups.length > 0) {
          errors.push({
            step: 'accounting_projection',
            skippedCount: accountingProjection.skippedGroups.length,
            skippedGroups: accountingProjection.skippedGroups.slice(0, MAX_RECONCILIATION_ISSUES),
          });
        }
      } catch (err) {
        errors.push({ step: 'accounting_projection', error: String(err) });
        this.logger.warn('Accounting projection failed (non-fatal)', err);
      }
      await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.ACCOUNTING_PROJECTION_COMPLETED);

      if (accountingProjection) {
        await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.RECONCILIATION_STARTED);
        try {
          await this.touchSyncHeartbeat(configId, shouldRunInventory);
          const reconciliationSummary = await this.runPostSyncReconciliations(
            tenantId,
            { id: syncLog.id, startedAt: syncLog.startedAt, mode },
            dateWindow,
            accountingProjection.skippedGroups,
            scope,
          );
          if (reconciliationSummary.totalIssues > 0) {
            errors.push({
              step: 'post_sync_reconciliation',
              issueCount: reconciliationSummary.totalIssues,
              warningCount: reconciliationSummary.warningCount,
              failureCount: reconciliationSummary.failureCount,
            });
          }
        } catch (err) {
          errors.push({ step: 'post_sync_reconciliation', error: String(err) });
          this.logger.warn('Post-sync reconciliation failed (non-fatal)', err);
        }
        await this.updateSyncStage(syncLog.id, MARG_SYNC_STAGE.RECONCILIATION_COMPLETED);
      }

      if (
        diagnostics.freeQuantityRowCount > 0 ||
        diagnostics.branchPayloadFallbackCount > 0 ||
        diagnostics.duplicatePartyKeyCount > 0 ||
        diagnostics.duplicatePartyBalanceKeyCount > 0 ||
        diagnostics.suppliersProjected > 0 ||
        diagnostics.duplicateAccountPostingFingerprintCount > 0 ||
        Object.keys(diagnostics.skippedAccountingGroupsByReason).length > 0
      ) {
        errors.push(this.buildMargSyncDiagnosticsErrorStep(diagnostics));
      }

      // Update sync config with latest cursor
      const configUpdate: Prisma.MargSyncConfigUpdateInput = shouldRunInventory
        ? {
          lastSyncStatus: MARG_SYNC_STATUS.COMPLETED,
          lastAccountingSyncStatus: MARG_SYNC_STATUS.COMPLETED,
        }
        : {
          lastAccountingSyncStatus: MARG_SYNC_STATUS.COMPLETED,
        };
      if (shouldCommitCursor) {
        const completedAt = new Date();
        if (shouldRunInventory) {
          configUpdate.lastSyncAt = completedAt;
          configUpdate.lastSyncIndex = currentIndex;
          configUpdate.lastSyncDatetime = lastDatetime || new Date().toISOString();
        }
        configUpdate.lastAccountingSyncAt = completedAt;
        configUpdate.lastAccountingSyncIndex = accountingIndex;
        configUpdate.lastAccountingSyncDatetime = accountingDatetime || new Date().toISOString();
      }
      await this.margPrisma.margSyncConfig.update({
        where: { id: configId },
        data: configUpdate,
      });

      // Finalize sync log
      await this.margPrisma.margSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: MARG_SYNC_STATUS.COMPLETED,
          completedAt: new Date(),
          currentStage: MARG_SYNC_STAGE.COMPLETED,
          lastHeartbeatAt: new Date(),
          failureType: null,
          productsSynced: productsCount,
          partiesSynced: partiesCount,
          transactionsSynced: transactionsCount,
          stockSynced: stockCount,
          branchesSynced: branchesCount,
          vouchersSynced: vouchersCount,
          saleTypesSynced: saleTypesCount,
          accountGroupsSynced: accountGroupsCount,
          accountPostingsSynced: accountPostingsCount,
          accountGroupBalancesSynced: accountGroupBalancesCount,
          partyBalancesSynced: partyBalancesCount,
          outstandingsSynced: outstandingsCount,
          journalEntriesSynced: journalEntriesCount,
          errors: errors as any,
          ...getActiveCursor(),
        },
      });

      this.logger.log(
        `Marg ${syncLabel} ${operationLabel} completed: products=${productsCount}, parties=${partiesCount}, ` +
        `transactions=${transactionsCount}, stock=${stockCount}, branches=${branchesCount}, ` +
        `vouchers=${vouchersCount}, saleTypes=${saleTypesCount}, ` +
        `accountGroups=${accountGroupsCount}, accountPostings=${accountPostingsCount}, ` +
        `accountGroupBalances=${accountGroupBalancesCount}, partyBalances=${partyBalancesCount}, ` +
        `outstandings=${outstandingsCount}, journalEntries=${journalEntriesCount}`,
      );

      await this.auditService.log(
        tenantId,
        triggeredBy ?? null,
        AuditAction.IMPORT,
        'MargSyncLog',
        syncLog.id,
        null,
        {
          status: 'COMPLETED',
          products: productsCount,
          parties: partiesCount,
          transactions: transactionsCount,
          stock: stockCount,
          branches: branchesCount,
          accountPostings: accountPostingsCount,
          outstandings: outstandingsCount,
          journalEntries: journalEntriesCount,
        },
        [],
        { configId, triggeredBy, action: shouldFetchFromMarg ? 'marg_sync_completed' : 'marg_reprojection_completed', scope, mode },
      ).catch(() => {/* best-effort */});
    } catch (err) {
      this.logger.error('Marg sync failed', err);

      // Classify the terminal error so resume eligibility is recorded on the
      // sync log. The structured error preserves stage/apiType/requestIndex
      // context that the legacy `{step:'fatal', error:String(err)}` form lost.
      const { classification, structuredError } = this.classifyAndRecordSyncFailure(
        err,
        syncLog.id,
        null,
        null,
        null,
        null,
        null,
      );
      errors.push(structuredError);

      await this.margPrisma.margSyncConfig.update({
        where: { id: configId },
        data: shouldRunInventory
          ? {
            lastSyncStatus: MARG_SYNC_STATUS.FAILED,
            lastAccountingSyncStatus: MARG_SYNC_STATUS.FAILED,
          }
          : {
            lastAccountingSyncStatus: MARG_SYNC_STATUS.FAILED,
          },
      });

      await this.margPrisma.margSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: MARG_SYNC_STATUS.FAILED,
          completedAt: new Date(),
          currentStage: classification.type === MARG_FAILURE_TYPE.FATAL
            ? MARG_SYNC_STAGE.FAILED_FATAL
            : MARG_SYNC_STAGE.FAILED_RETRYABLE,
          failureType: classification.type,
          lastHeartbeatAt: new Date(),
          productsSynced: productsCount,
          partiesSynced: partiesCount,
          transactionsSynced: transactionsCount,
          stockSynced: stockCount,
          branchesSynced: branchesCount,
          vouchersSynced: vouchersCount,
          saleTypesSynced: saleTypesCount,
          accountGroupsSynced: accountGroupsCount,
          accountPostingsSynced: accountPostingsCount,
          accountGroupBalancesSynced: accountGroupBalancesCount,
          partyBalancesSynced: partyBalancesCount,
          outstandingsSynced: outstandingsCount,
          journalEntriesSynced: journalEntriesCount,
          errors: errors as any,
          ...getActiveCursor(),
        },
      });

      await this.auditService.log(
        tenantId,
        triggeredBy ?? null,
        AuditAction.IMPORT,
        'MargSyncLog',
        syncLog.id,
        null,
        {
          status: 'FAILED',
          failureType: classification.type,
          errorCode: classification.errorCode,
          error: classification.message,
          products: productsCount,
          parties: partiesCount,
          transactions: transactionsCount,
        },
        [],
        { configId, triggeredBy, action: shouldFetchFromMarg ? 'marg_sync_failed' : 'marg_reprojection_failed', scope, mode },
      ).catch(() => {/* best-effort */});

      throw err;
    }

    return syncLog.id;
  }

  /**
   * Diagnostic: surface every staged Marg stock row for a product (or all
   * products) so support / the user can directly compare what Marg sent us
   * against what their dashboard now shows. Returns the current MargStock
   * state, the aggregated totals our InventoryLevel projection would produce,
   * and the live InventoryLevel.onHandQty for cross-check.
   */
  async getStockProjectionDiagnostic(
    tenantId: string,
    options: { productCode?: string; productName?: string; pid?: string; limit?: number } = {},
  ): Promise<{
    matches: Array<{
      pid: string;
      companyId: number;
      productId: string | null;
      productCode: string | null;
      productName: string | null;
      sumOpening: number;
      sumStock: number;
      sumBrkStock: number;
      activeBatchCount: number;
      deletedBatchCount: number;
      inventoryLevelOnHand: number | null;
      mismatchVsStock: number | null;
      batches: Array<{
        batch: string;
        gCode: string | null;
        opening: number;
        stock: number;
        brkStock: number;
        sourceDeleted: boolean;
        lastSeenSyncLogId: string | null;
        expiry: Date | null;
      }>;
    }>;
  }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);

    // Resolve candidate Marg PIDs from the requested filters
    const productWhere: Prisma.MargProductWhereInput = { tenantId };
    if (options.pid) productWhere.pid = options.pid;
    if (options.productCode) productWhere.code = { contains: options.productCode, mode: 'insensitive' };
    if (options.productName) productWhere.name = { contains: options.productName, mode: 'insensitive' };

    const margProducts = await this.margPrisma.margProduct.findMany({
      where: productWhere,
      select: { pid: true, companyId: true, productId: true, code: true, name: true },
      take: limit,
    });

    const matches = [] as any[];

    for (const mp of margProducts) {
      const stocks = await this.margPrisma.margStock.findMany({
        where: { tenantId, companyId: mp.companyId, pid: mp.pid },
        select: {
          batch: true,
          gCode: true,
          opening: true,
          stock: true,
          brkStock: true,
          sourceDeleted: true,
          lastSeenSyncLogId: true,
          expiry: true,
        },
      });

      let sumOpening = 0;
      let sumStock = 0;
      let sumBrk = 0;
      let active = 0;
      let deleted = 0;
      const batchDetails = stocks.map((s) => {
        const opening = s.opening != null ? Number(s.opening) : 0;
        const stockQty = s.stock != null ? Number(s.stock) : 0;
        const brk = s.brkStock != null ? Number(s.brkStock) : 0;
        if (s.sourceDeleted) deleted += 1;
        else {
          active += 1;
          sumOpening += opening;
          sumStock += stockQty;
          sumBrk += brk;
        }
        return {
          batch: s.batch,
          gCode: s.gCode,
          opening,
          stock: stockQty,
          brkStock: brk,
          sourceDeleted: s.sourceDeleted,
          lastSeenSyncLogId: s.lastSeenSyncLogId,
          expiry: s.expiry,
        };
      });

      const locationId = await this.resolveLocationId(tenantId, mp.companyId);
      let inventoryLevelOnHand: number | null = null;
      if (mp.productId && locationId) {
        const lvl = await this.prisma.inventoryLevel.findUnique({
          where: { tenantId_productId_locationId: { tenantId, productId: mp.productId, locationId } },
          select: { onHandQty: true },
        });
        inventoryLevelOnHand = lvl?.onHandQty != null ? Number(lvl.onHandQty) : null;
      }

      matches.push({
        pid: mp.pid,
        companyId: mp.companyId,
        productId: mp.productId,
        productCode: mp.code,
        productName: mp.name,
        sumOpening,
        sumStock,
        sumBrkStock: sumBrk,
        activeBatchCount: active,
        deletedBatchCount: deleted,
        inventoryLevelOnHand,
        mismatchVsStock: inventoryLevelOnHand != null ? inventoryLevelOnHand - sumStock : null,
        batches: batchDetails,
      });
    }

    return { matches };
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

    const baseWhere: Prisma.MargOutstandingWhereInput = {
      tenantId,
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
   * the source voucher number, book code (S=Sales, P=Purchase, R=Receipt,
   * E=Adjustment, J=Journal, …), counter-party code, and Marg's own remark
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
    if (input == null || input === '') return [...MargEdeService.DEFAULT_AGING_BOUNDARIES];

    let arr: unknown[];
    if (Array.isArray(input)) {
      arr = input as unknown[];
    } else if (typeof input === 'string') {
      arr = input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    } else {
      throw new BadRequestException('bucketBoundaries must be CSV or array of integers');
    }

    if (arr.length === 0) return [...MargEdeService.DEFAULT_AGING_BOUNDARIES];
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
      case 'P': return 'Purchase';
      case 'R': return 'Receipt';
      case 'A': return 'Payment';
      case 'E': return 'Sales Adjustment';
      case 'D': return 'Debit Note';
      case 'C': return 'Credit Note';
      case 'J': return 'Journal';
      case '!': return 'Opening';
      default: return code || null;
    }
  }

  /**
   * Reset the saved Marg pagination cursor (Index/DateTime) so the next sync
   * pulls a complete snapshot from the very beginning rather than continuing
   * incrementally. Use this when the user reports stock or transaction totals
   * that diverge from Marg — Marg's masters APIs only re-emit changed rows
   * once the cursor advances, and a stale cursor can leave staged batches
   * frozen at their last-seen state.
   */
  async resetSyncCursor(
    configId: string,
    tenantId: string,
    options: { scope?: MargSyncScope; clearStaging?: boolean } = {},
  ): Promise<{ configId: string; cleared: { inventory: boolean; accounting: boolean }; stagingCleared: boolean }> {
    const config = await this.margPrisma.margSyncConfig.findFirst({ where: { id: configId, tenantId } });
    if (!config) throw new NotFoundException('Marg config not found');

    const clearInventory = !options.scope || options.scope === MARG_SYNC_SCOPE.FULL;
    const clearAccounting = !options.scope || options.scope === MARG_SYNC_SCOPE.ACCOUNTING || options.scope === MARG_SYNC_SCOPE.FULL;

    await this.margPrisma.margSyncConfig.update({
      where: { id: configId },
      data: {
        ...(clearInventory ? { lastSyncIndex: 0, lastSyncDatetime: null } : {}),
        ...(clearAccounting ? { lastAccountingSyncIndex: 0, lastAccountingSyncDatetime: null } : {}),
      },
    });

    let stagingCleared = false;
    if (options.clearStaging) {
      // Drops staged Marg rows for this tenant so the next sync reseeds from
      // scratch. Existing core records (Product/Customer/InventoryLevel) are
      // left intact; the next sync's projections will re-link to them via the
      // canonical MARG-{code} keys.
      await this.margPrisma.margStock.updateMany({ where: { tenantId }, data: { sourceDeleted: true } });
      stagingCleared = true;
    }

    return {
      configId,
      cleared: { inventory: clearInventory, accounting: clearAccounting },
      stagingCleared,
    };
  }

  async runReprojection(
    configId: string,
    tenantId: string,
    triggeredBy?: string,
    fromDate?: string,
    endDate?: string,
    scope: MargSyncScope = MARG_SYNC_SCOPE.FULL,
  ): Promise<string> {
    return this.runSync(
      configId,
      tenantId,
      triggeredBy,
      fromDate,
      endDate,
      scope,
      MARG_SYNC_MODE.REPROJECT,
    );
  }

  // ===================== RESUME FROM CHECKPOINT =====================

  /**
   * Re-stage saved raw pages from a previously-failed sync without
   * refetching from Marg.
   *
   * Targets a sync log whose status is FAILED with failureType=RETRYABLE,
   * loads each MargRawSyncPage row, reads the parsed payload back from
   * MargRawPageStorage, and runs the same staging callbacks the original
   * runSync would have run. After every page is STAGED, the sync log is
   * updated to STAGING_COMPLETED and marked COMPLETED with a note that
   * transforms/projections were not run.
   *
   * Operator workflow:
   *   1. /resume — this call. Re-stages raw pages.
   *   2. /reproject — runs transforms/projections from the now-complete
   *      staged data. Existing endpoint, no changes needed.
   *
   * Why split: keeping resume narrowly-scoped to staging keeps the failure
   * surface tiny (a re-stage of the same page is idempotent because every
   * staging method is upsert-only). Folding transforms in here would
   * duplicate ~230 lines of runSync's post-fetch pipeline and create a
   * second copy that could drift.
   */
  async resumeSync(
    configId: string,
    tenantId: string,
    syncLogId: string,
    triggeredBy?: string,
  ): Promise<{
    syncLogId: string;
    pagesResumed: number;
    pagesAlreadyStaged: number;
    pagesFailed: number;
  }> {
    if (!this.rawPageStorage) {
      throw new BadRequestException(
        'Resume is unavailable: MARG_RAW_PAGE_STORAGE_DIR is not configured. ' +
        'Resume requires the durable raw-page storage backend to be wired.',
      );
    }
    if (typeof this.margPrisma.margRawSyncPage?.findMany !== 'function') {
      throw new BadRequestException(
        'Resume is unavailable: marg_raw_sync_pages table is missing. ' +
        'Apply the 20260516120000_add_marg_resumable_sync_pipeline migration first.',
      );
    }

    const config = await this.margPrisma.margSyncConfig.findFirst({
      where: { id: configId, tenantId },
    });
    if (!config) throw new NotFoundException('Marg config not found');
    if (!config.isActive) throw new BadRequestException('Marg sync config is disabled');

    const targetLog = await this.margPrisma.margSyncLog.findFirst({
      where: { id: syncLogId, tenantId, configId },
    });
    if (!targetLog) {
      throw new NotFoundException(`Marg sync log ${syncLogId} not found for this config`);
    }

    // We accept resume on FAILED runs and on stale RUNNING runs (heartbeat
    // older than the configured stale threshold). FATAL failures must not
    // be resumed silently — they require operator/dev attention first.
    // COMPLETED runs are never resumable.
    if (targetLog.status === MARG_SYNC_STATUS.COMPLETED) {
      throw new BadRequestException(
        `Sync log ${syncLogId} is already COMPLETED. Resume is only valid for FAILED_RETRYABLE or stale RUNNING logs.`,
      );
    }
    const isFailedRetryable = targetLog.status === MARG_SYNC_STATUS.FAILED
      && targetLog.failureType !== MARG_FAILURE_TYPE.FATAL;
    const isStaleRunning = targetLog.status === MARG_SYNC_STATUS.RUNNING
      && targetLog.lastHeartbeatAt
      && (Date.now() - new Date(targetLog.lastHeartbeatAt).getTime()) > this.staleSyncAfterMs;
    if (!isFailedRetryable && !isStaleRunning) {
      throw new BadRequestException(
        `Sync log ${syncLogId} is not resumable (status=${targetLog.status}, failureType=${targetLog.failureType ?? 'null'}). ` +
        `Resume is allowed only when the prior run failed with a RETRYABLE classification, ` +
        `or when a RUNNING log has not produced a heartbeat in the last ${Math.round(this.staleSyncAfterMs / 60000)} minutes.`,
      );
    }

    // Refuse legacy logs created before the resumable-pipeline migration.
    // Such logs have currentStage=NULL and no MargRawSyncPage rows; we
    // cannot reconstruct what stage they reached or replay their staging.
    // Force the operator to start a fresh sync (or use /reproject if the
    // prior run did get to staged data).
    if (targetLog.currentStage === null) {
      throw new BadRequestException(
        `Sync log ${syncLogId} predates the resumable-pipeline migration (currentStage is NULL). ` +
        `Cannot resume — start a fresh sync or run /reproject if the prior run successfully staged data.`,
      );
    }

    // Refuse a windowed run whose window metadata is missing (e.g. the row
    // was hand-edited or the original run failed before the metadata was
    // committed). Resuming without the window would silently re-stage
    // out-of-window rows.
    const hadWindowOriginally = Boolean(targetLog.fromDate || targetLog.endDate);
    const windowMetadataAvailable = Boolean(targetLog.fromDate || targetLog.endDate || targetLog.syncMode);
    if (!windowMetadataAvailable && targetLog.syncMode === null) {
      // Nothing recorded about mode/window; we cannot guarantee safe replay.
      throw new BadRequestException(
        `Sync log ${syncLogId} has no recorded mode/window metadata. ` +
        `Cannot guarantee safe resume — start a fresh sync with explicit fromDate/endDate.`,
      );
    }
    void hadWindowOriginally;

    // Acquire the same lock runSync uses so we cannot overlap a fresh sync.
    const lock = await this.margPrisma.margSyncConfig.updateMany({
      where: {
        id: configId,
        tenantId,
        lastSyncStatus: { not: MARG_SYNC_STATUS.RUNNING },
        lastAccountingSyncStatus: { not: MARG_SYNC_STATUS.RUNNING },
      },
      data: {
        lastSyncStatus: MARG_SYNC_STATUS.RUNNING,
        lastAccountingSyncStatus: MARG_SYNC_STATUS.RUNNING,
      },
    });
    if (lock.count === 0) {
      throw new BadRequestException('Sync is already running for this configuration');
    }

    let pagesResumed = 0;
    let pagesAlreadyStaged = 0;
    let pagesFailed = 0;
    const resumeErrors: Record<string, unknown>[] = [];

    try {
      await this.margPrisma.margSyncLog.update({
        where: { id: syncLogId },
        data: {
          status: MARG_SYNC_STATUS.RUNNING,
          currentStage: MARG_SYNC_STAGE.STAGING_STARTED,
          failureType: null,
          retryCount: { increment: 1 },
          lastHeartbeatAt: new Date(),
        },
      });

      // Reconstruct the original date window from the persisted metadata so
      // staging methods that filter by date apply the same bound the
      // original run used. For unbounded incremental runs, fromDate and
      // endDate are both null, and buildDateWindow returns null — same as
      // the original run.
      const dateWindow = this.buildDateWindow(
        targetLog.fromDate ?? undefined,
        targetLog.endDate ?? undefined,
      );

      const pages = await this.margPrisma.margRawSyncPage.findMany({
        where: { syncLogId, tenantId },
        orderBy: [{ apiType: 'asc' }, { requestIndex: 'asc' }],
      });

      // Guard: a resumable log with zero raw pages means the original run
      // failed before persisting anything. There is nothing to replay; the
      // operator should start a fresh sync. Reporting "0 resumed" as
      // success would leave the operator believing recovery worked when it
      // did not.
      if (pages.length === 0) {
        throw new BadRequestException(
          `Sync log ${syncLogId} has no saved raw pages to resume from. ` +
          `The original run failed before persisting any pages. ` +
          `Start a fresh sync to retry from the beginning.`,
        );
      }

      for (const page of pages) {
        if (page.status === MARG_RAW_PAGE_STATUS.STAGED) {
          pagesAlreadyStaged += 1;
          continue;
        }
        if (page.status === MARG_RAW_PAGE_STATUS.DISCARDED) {
          continue;
        }

        if (!page.storagePath) {
          pagesFailed += 1;
          resumeErrors.push({
            step: 'resume_stage_missing_path',
            apiType: page.apiType,
            requestIndex: page.requestIndex,
          });
          continue;
        }

        let payload: MargParsedPayload;
        try {
          const loaded = await this.rawPageStorage.load({
            storagePath: page.storagePath,
            payloadHash: page.payloadHash,
          });
          payload = this.coerceLoadedPayload(loaded);
        } catch (err) {
          pagesFailed += 1;
          await this.markRawPageStagingFailed(page.id, err);
          resumeErrors.push({
            step: 'resume_load_payload',
            apiType: page.apiType,
            requestIndex: page.requestIndex,
            error: (err as Error).message,
          });
          continue;
        }

        await this.updateSyncStage(syncLogId, MARG_SYNC_STAGE.STAGING_STARTED, {
          apiType: page.apiType,
          requestIndex: page.requestIndex,
        });

        try {
          await this.replayStagingForPage(tenantId, syncLogId, page.apiType, payload, dateWindow);
          await this.markRawPageStaged(page.id);
          pagesResumed += 1;
        } catch (err) {
          pagesFailed += 1;
          await this.markRawPageStagingFailed(page.id, err);
          resumeErrors.push({
            step: 'resume_stage',
            apiType: page.apiType,
            requestIndex: page.requestIndex,
            error: (err as Error).message,
          });
          // Continue with remaining pages — one bad page should not block
          // the others. The operator can run resume again to retry the
          // failed pages once they fix the root cause.
        }

        await this.touchSyncHeartbeat(configId, true);
      }

      // We only mark the sync log STAGING_COMPLETED. Transforms/projections
      // are intentionally not run here — operator runs /reproject next.
      const finalStage = pagesFailed === 0
        ? MARG_SYNC_STAGE.STAGING_COMPLETED
        : MARG_SYNC_STAGE.FAILED_RETRYABLE;
      const finalStatus = pagesFailed === 0
        ? MARG_SYNC_STATUS.COMPLETED
        : MARG_SYNC_STATUS.FAILED;

      await this.margPrisma.margSyncLog.update({
        where: { id: syncLogId },
        data: {
          status: finalStatus,
          currentStage: finalStage,
          failureType: pagesFailed === 0 ? null : MARG_FAILURE_TYPE.RETRYABLE,
          completedAt: new Date(),
          lastHeartbeatAt: new Date(),
          errors: resumeErrors.length > 0 ? (resumeErrors as any) : (targetLog.errors as any),
        },
      });

      await this.margPrisma.margSyncConfig.update({
        where: { id: configId },
        data: {
          lastSyncStatus: pagesFailed === 0 ? MARG_SYNC_STATUS.COMPLETED : MARG_SYNC_STATUS.FAILED,
          lastAccountingSyncStatus: pagesFailed === 0 ? MARG_SYNC_STATUS.COMPLETED : MARG_SYNC_STATUS.FAILED,
        },
      });

      await this.auditService.log(
        tenantId,
        triggeredBy ?? null,
        AuditAction.IMPORT,
        'MargSyncLog',
        syncLogId,
        null,
        { action: 'marg_sync_resumed', pagesResumed, pagesAlreadyStaged, pagesFailed },
        [],
        { configId, triggeredBy },
      ).catch(() => {/* best-effort */});

      return { syncLogId, pagesResumed, pagesAlreadyStaged, pagesFailed };
    } catch (err) {
      // Outer failure — release the lock and surface a classified error.
      const { classification, structuredError } = this.classifyAndRecordSyncFailure(
        err,
        syncLogId,
        MARG_SYNC_STAGE.FAILED_RETRYABLE,
        null,
        null,
        null,
        null,
      );
      await this.margPrisma.margSyncConfig.update({
        where: { id: configId },
        data: {
          lastSyncStatus: MARG_SYNC_STATUS.FAILED,
          lastAccountingSyncStatus: MARG_SYNC_STATUS.FAILED,
        },
      }).catch(() => {/* best-effort */});
      await this.margPrisma.margSyncLog.update({
        where: { id: syncLogId },
        data: {
          status: MARG_SYNC_STATUS.FAILED,
          currentStage: classification.type === MARG_FAILURE_TYPE.FATAL
            ? MARG_SYNC_STAGE.FAILED_FATAL
            : MARG_SYNC_STAGE.FAILED_RETRYABLE,
          failureType: classification.type,
          lastHeartbeatAt: new Date(),
          errors: [structuredError, ...resumeErrors] as any,
        },
      }).catch(() => {/* best-effort */});
      throw err;
    }
  }

  /**
   * Coerce a payload loaded from storage back into a MargParsedPayload.
   * Storage round-trips through JSON, so arrays come back as arrays — we
   * only need to ensure each section field is at least an empty array
   * (defensive against accidental null/undefined that would crash the
   * staging loop).
   */
  private coerceLoadedPayload(loaded: unknown): MargParsedPayload {
    const p = (this.toRecord(loaded) ?? {}) as Record<string, unknown>;
    const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
    return {
      Details: arr(p.Details),
      Masters: arr(p.Masters),
      MDis: arr(p.MDis),
      Party: arr(p.Party),
      Product: arr(p.Product),
      SaleType: arr(p.SaleType),
      Stock: arr(p.Stock),
      ACGroup: arr(p.ACGroup),
      Account: arr(p.Account),
      AcBal: arr(p.AcBal),
      PBal: arr(p.PBal),
      Outstanding: arr(p.Outstanding),
      Index: Number.isFinite(Number(p.Index)) ? Number(p.Index) : 0,
      DataStatus: Number.isFinite(Number(p.DataStatus)) ? Number(p.DataStatus) : 0,
      DateTime: typeof p.DateTime === 'string' ? p.DateTime : '',
    };
  }

  /**
   * Replay the staging methods that the original runSync would have run
   * for a given API page. Mirrors the per-section blocks inside the runSync
   * fetch loops; kept in sync by always calling the same syncX methods.
   *
   * dateWindow defaults to null on resume — see resumeSync notes for why.
   */
  private async replayStagingForPage(
    tenantId: string,
    syncLogId: string,
    apiType: string,
    payload: MargParsedPayload,
    dateWindow: DateWindow | null,
  ): Promise<void> {
    if (apiType === '2') {
      const seenBranches = new Set<string>();
      const masters = payload.Masters;
      if (masters.length > 0) {
        const branches = this.takeUnseenMargBranchRows(masters, seenBranches);
        if (branches.length > 0) await this.syncBranches(tenantId, branches);
      }
      if (payload.Product.length > 0) await this.syncProducts(tenantId, payload.Product, syncLogId);
      if (payload.Party.length > 0) {
        const canonical = this.canonicalizeMargParties(payload.Party);
        await this.syncParties(tenantId, canonical.rows, syncLogId);
      }
      if (payload.Details.length > 0) await this.syncTransactions(tenantId, payload.Details, dateWindow, syncLogId);
      if (payload.Stock.length > 0) await this.syncStockData(tenantId, payload.Stock, syncLogId);
      if (payload.MDis.length > 0) await this.syncVouchers(tenantId, payload.MDis, dateWindow, syncLogId);
      if (payload.SaleType.length > 0) await this.syncSaleTypes(tenantId, payload.SaleType);
    } else {
      // apiType === '1'
      if (payload.MDis.length > 0) await this.syncVouchers(tenantId, payload.MDis, dateWindow, syncLogId);
      if (payload.ACGroup.length > 0) await this.syncAccountGroups(tenantId, payload.ACGroup);
      if (payload.Account.length > 0) await this.syncAccountPostings(tenantId, payload.Account, dateWindow, syncLogId);
      if (payload.AcBal.length > 0) await this.syncAccountGroupBalances(tenantId, payload.AcBal);
      if (payload.PBal.length > 0) {
        const canonical = this.canonicalizeMargPartyBalances(payload.PBal);
        await this.syncPartyBalances(tenantId, canonical.rows);
      }
      if (payload.Outstanding.length > 0) await this.syncOutstandings(tenantId, payload.Outstanding, dateWindow, syncLogId);
    }
  }

  // ===================== STAGING: UPSERT RAW DATA =====================

  private async syncBranches(tenantId: string, branches: any[]): Promise<number> {
    interface PreparedBranch {
      tenantId: string;
      margId: number;
      companyId: number;
      code: string | null;
      name: string;
      storeId: string | null;
      licence: string | null;
      branch: string | null;
      rawData: unknown;
    }

    const prepared: PreparedBranch[] = [];
    const seen = new Map<number, number>();

    for (const b of branches) {
      const companyId = this.toInt32(b.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(b.ID, 0);
      const row: PreparedBranch = {
        tenantId,
        margId,
        companyId,
        code: String(b.Code || '').trim() || null,
        name: String(b.Name || '').trim(),
        storeId: String(b.StoreID || '').trim() || null,
        licence: String(b.Licence || '').trim() || null,
        branch: String(b.Branch || '').trim() || null,
        rawData: b,
      };
      const existingIdx = seen.get(companyId);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(companyId, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 9, 'syncBranches');
    let written = 0;

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::integer,
          ${r.companyId}::integer,
          ${r.code},
          ${r.name},
          ${r.storeId},
          ${r.licence},
          ${r.branch},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_branches (
          tenant_id, marg_id, company_id, code, name, store_id, licence, branch,
          raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id) DO UPDATE SET
          marg_id    = EXCLUDED.marg_id,
          code       = EXCLUDED.code,
          name       = EXCLUDED.name,
          store_id   = EXCLUDED.store_id,
          licence    = EXCLUDED.licence,
          branch     = EXCLUDED.branch,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);
      written += chunk.length;
    }
    return written;
  }

  private async syncProducts(tenantId: string, products: any[], progressSyncLogId?: string | null): Promise<number> {
    interface PreparedProduct {
      tenantId: string;
      margId: number;
      companyId: number;
      pid: string;
      code: string;
      name: string;
      unit: string | null;
      pack: number | null;
      gCode: string | null;
      gCode3: string | null;
      gCode5: string | null;
      gCode6: string | null;
      gst: number | null;
      margCode: string | null;
      addField: string | null;
      rawData: unknown;
    }

    const prepared: PreparedProduct[] = [];
    const seen = new Map<string, number>();

    for (const p of products) {
      const productRow = this.toRecord(p);
      if (!productRow) continue;

      const companyId = this.toInt32(this.readFirstDefined([productRow], ['CompanyID', 'CompanyId', 'companyId']), 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(this.readFirstDefined([productRow], ['ID', 'Id', 'id']), 0);
      const pid = this.readMargString(productRow, ['PID', 'Pid', 'pid', 'Code', 'CODE', 'code'], 20);
      if (!pid) continue;

      const code = this.readMargString(productRow, ['Code', 'CODE', 'code'], 50) ?? pid;
      const name = this.readMargString(productRow, ['Name', 'NAME', 'name'], 255) ?? code;
      const unit = this.readMargString(productRow, ['Unit', 'UNIT', 'unit'], 20);
      const gCode = this.readMargString(productRow, ['GCode', 'GCODE', 'gCode', 'gcode'], 100);
      const gCode3 = this.readMargString(productRow, ['GCode3', 'GCODE3', 'gCode3', 'gcode3'], 100);
      const gCode5 = this.readMargString(productRow, ['GCode5', 'GCODE5', 'gCode5', 'gcode5'], 100);
      const gCode6 = this.readMargString(productRow, ['GCode6', 'GCODE6', 'gCode6', 'gcode6'], 50);
      const pack = this.readFirstDefined([productRow], ['Pack', 'PACK', 'pack']);
      const gst = this.readFirstDefined([productRow], ['GST', 'Gst', 'gst']);
      const margCode = this.readMargString(productRow, ['MargCode', 'MARGCODE', 'margCode', 'marg_code'], 50);
      const addField = this.readMargString(productRow, ['AddField', 'ADDFIELD', 'addField', 'add_field']);

      const dedupKey = `${companyId}:${pid}`;
      const row: PreparedProduct = {
        tenantId,
        margId,
        companyId,
        pid,
        code,
        name,
        unit,
        pack: pack != null ? Number(pack) : null,
        gCode,
        gCode3,
        gCode5,
        gCode6,
        gst: gst != null ? Number(gst) : null,
        margCode,
        addField,
        rawData: p,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 16, 'syncProducts');
    let written = 0;
    const startedAt = Date.now();

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::integer,
          ${r.companyId}::integer,
          ${r.pid},
          ${r.code},
          ${r.name},
          ${r.unit},
          ${r.pack},
          ${r.gCode},
          ${r.gCode3},
          ${r.gCode5},
          ${r.gCode6},
          ${r.gst},
          ${r.margCode},
          ${r.addField},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );

      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_products (
          tenant_id, marg_id, company_id, pid, code, name,
          unit, pack, g_code, g_code3, g_code5, g_code6,
          gst, marg_code, add_field, raw_data,
          created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, pid) DO UPDATE SET
          marg_id    = EXCLUDED.marg_id,
          code       = EXCLUDED.code,
          name       = EXCLUDED.name,
          unit       = EXCLUDED.unit,
          pack       = EXCLUDED.pack,
          g_code     = EXCLUDED.g_code,
          g_code3    = EXCLUDED.g_code3,
          g_code5    = EXCLUDED.g_code5,
          g_code6    = EXCLUDED.g_code6,
          gst        = EXCLUDED.gst,
          marg_code  = EXCLUDED.marg_code,
          add_field  = EXCLUDED.add_field,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);

      written += chunk.length;
      await this.updateBatchProgress(progressSyncLogId, 'products', Math.floor(i / batchSize) + 1, chunk.length);
    }

    const elapsedMs = Date.now() - startedAt;
    if (prepared.length >= 1000 || elapsedMs > 5000) {
      this.logger.log(
        `Marg syncProducts bulk-upserted ${written} rows in ${elapsedMs}ms ` +
        `(${Math.ceil(prepared.length / batchSize)} batches of up to ${batchSize})`,
      );
    }

    return written;
  }

  private async syncParties(tenantId: string, parties: any[], progressSyncLogId?: string | null): Promise<number> {
    interface PreparedParty {
      tenantId: string;
      margId: number;
      companyId: number;
      cid: string;
      parName: string;
      parAddr: string | null;
      parAdd1: string | null;
      parAdd2: string | null;
      gstNo: string | null;
      phone1: string | null;
      phone2: string | null;
      phone3: string | null;
      phone4: string | null;
      route: string | null;
      area: string | null;
      mr: string | null;
      sCode: string | null;
      rate: string | null;
      credit: number | null;
      crDays: number | null;
      crBills: number | null;
      crStatus: string | null;
      margCode: string | null;
      addField: string | null;
      dlNo: string | null;
      pin: string | null;
      lat: string | null;
      lng: string | null;
      isDeleted: boolean;
      rawData: unknown;
    }

    const prepared: PreparedParty[] = [];
    const seen = new Map<string, number>();

    for (const p of parties) {
      const companyId = this.toInt32(p.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(p.ID, 0);
      const cid = String(p.CID || '').trim();
      if (!cid) continue;

      const dedupKey = `${companyId}:${cid}`;
      const row: PreparedParty = {
        tenantId,
        margId,
        companyId,
        cid,
        parName: String(p.ParNam || '').trim(),
        parAddr: String(p.PARADD || '').trim() || null,
        parAdd1: String(p.ParAdd1 || '').trim() || null,
        parAdd2: String(p.ParAdd2 || '').trim() || null,
        gstNo: String(p.GSTNo || '').trim() || null,
        phone1: String(p.Phone1 || '').trim() || null,
        phone2: String(p.Phone2 || '').trim() || null,
        phone3: String(p.Phone3 || '').trim() || null,
        phone4: String(p.Phone4 || '').trim() || null,
        route: String(p.Rout || '').trim() || null,
        area: String(p.Area || '').trim() || null,
        mr: String(p.MR || '').trim() || null,
        sCode: String(p.SCode || '').trim() || null,
        rate: String(p.Rate || '').trim() || null,
        credit: p.Credit != null ? Number(p.Credit) : null,
        crDays: p.CRDays != null ? Number(p.CRDays) : null,
        crBills: p.CRBills != null ? Number(p.CRBills) : null,
        crStatus: String(p.CRStatus || '').trim() || null,
        margCode: String(p.MargCode || '').trim() || null,
        addField: String(p.AddField || '').trim() || null,
        dlNo: String(p.DlNo || '').trim() || null,
        pin: String(p.Pin || '').trim() || null,
        lat: String(p.Lat || '').trim() || null,
        lng: String(p.Lng || '').trim() || null,
        isDeleted: String(p.Is_Deleted) === '1',
        rawData: p,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 30, 'syncParties');
    let written = 0;
    const startedAt = Date.now();

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::integer,
          ${r.companyId}::integer,
          ${r.cid},
          ${r.parName},
          ${r.parAddr},
          ${r.parAdd1},
          ${r.parAdd2},
          ${r.gstNo},
          ${r.phone1},
          ${r.phone2},
          ${r.phone3},
          ${r.phone4},
          ${r.route},
          ${r.area},
          ${r.mr},
          ${r.sCode},
          ${r.rate},
          ${r.credit},
          ${r.crDays},
          ${r.crBills},
          ${r.crStatus},
          ${r.margCode},
          ${r.addField},
          ${r.dlNo},
          ${r.pin},
          ${r.lat},
          ${r.lng},
          ${r.isDeleted},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );

      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_parties (
          tenant_id, marg_id, company_id, cid,
          par_name, par_addr, par_add1, par_add2, gst_no,
          phone1, phone2, phone3, phone4,
          route, area, mr, s_code, rate,
          credit, cr_days, cr_bills, cr_status,
          marg_code, add_field, dl_no, pin, lat, lng,
          is_deleted, raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, cid) DO UPDATE SET
          marg_id    = EXCLUDED.marg_id,
          par_name   = EXCLUDED.par_name,
          par_addr   = EXCLUDED.par_addr,
          par_add1   = EXCLUDED.par_add1,
          par_add2   = EXCLUDED.par_add2,
          gst_no     = EXCLUDED.gst_no,
          phone1     = EXCLUDED.phone1,
          phone2     = EXCLUDED.phone2,
          phone3     = EXCLUDED.phone3,
          phone4     = EXCLUDED.phone4,
          route      = EXCLUDED.route,
          area       = EXCLUDED.area,
          mr         = EXCLUDED.mr,
          s_code     = EXCLUDED.s_code,
          rate       = EXCLUDED.rate,
          credit     = EXCLUDED.credit,
          cr_days    = EXCLUDED.cr_days,
          cr_bills   = EXCLUDED.cr_bills,
          cr_status  = EXCLUDED.cr_status,
          marg_code  = EXCLUDED.marg_code,
          add_field  = EXCLUDED.add_field,
          dl_no      = EXCLUDED.dl_no,
          pin        = EXCLUDED.pin,
          lat        = EXCLUDED.lat,
          lng        = EXCLUDED.lng,
          is_deleted = EXCLUDED.is_deleted,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);

      written += chunk.length;
      await this.updateBatchProgress(progressSyncLogId, 'parties', Math.floor(i / batchSize) + 1, chunk.length);
    }

    const elapsedMs = Date.now() - startedAt;
    if (prepared.length >= 1000 || elapsedMs > 5000) {
      this.logger.log(
        `Marg syncParties bulk-upserted ${written} rows in ${elapsedMs}ms ` +
        `(${Math.ceil(prepared.length / batchSize)} batches of up to ${batchSize})`,
      );
    }

    return written;
  }

  private async syncTransactions(tenantId: string, details: any[], dateWindow: DateWindow | null, progressSyncLogId?: string | null): Promise<number> {
    // Previously this method awaited a Prisma `upsert` per row. A single Marg
    // page can contain 100k+ Detail rows; sequential upserts at ~10-30ms each
    // turned a single sync into a multi-hour job. Now we prepare the rows in
    // memory and execute a batched `INSERT ... ON CONFLICT DO UPDATE` against
    // Postgres, which is typically 30-100x faster.
    const prepared: Array<{
      margId: bigint;
      companyId: number;
      sourceKey: string;
      voucher: string;
      type: string;
      vcn: string | null;
      date: Date;
      cid: string | null;
      pid: string | null;
      gCode: string | null;
      batch: string | null;
      batDet: string | null;
      qty: number | null;
      free: number | null;
      mrp: number | null;
      rate: number | null;
      discount: number | null;
      amount: number | null;
      gst: number | null;
      gstAmount: number | null;
      addField: string | null;
      rawData: unknown;
    }> = [];

    // De-duplicate by unique key in case the same row appears twice in a page.
    // Without this, a single statement would hit "ON CONFLICT DO UPDATE command
    // cannot affect row a second time" from Postgres.
    const seen = new Set<string>();

    for (const d of details) {
      const companyId = this.toInt32(d.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(d.ID);
      if (margId <= BigInt(0)) continue;

      const voucher = String(d.Voucher || '').trim();
      if (!voucher) continue;

      const parsedDate = this.parseMargDate(d.Date);
      if (!parsedDate) continue;

      if (!this.isWithinDateWindow(parsedDate, dateWindow)) continue;

      const sourceKey = this.buildSourceKey(d);
      const dedupKey = `${companyId} ${sourceKey}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      prepared.push({
        margId,
        companyId,
        sourceKey,
        voucher,
        type: String(d.Type || '').trim(),
        vcn: String(d.VCN || d.Vcn || '').trim() || null,
        date: parsedDate,
        cid: String(d.CID || '').trim() || null,
        pid: String(d.PID || '').trim() || null,
        gCode: String(d.GCode || d.Gcode || '').trim() || null,
        batch: String(d.Batch || '').trim() || null,
        batDet: String(d.BatDet || '').trim() || null,
        qty: d.Qty != null ? Number(d.Qty) : null,
        free: d.Free != null ? Number(d.Free) : null,
        mrp: d.MRP != null ? Number(d.MRP) : null,
        rate: d.Rate != null ? Number(d.Rate) : null,
        discount: d.Discount != null ? Number(d.Discount) : null,
        amount: d.Amount != null ? Number(d.Amount) : null,
        gst: d.GST != null ? Number(d.GST) : null,
        gstAmount: d.GSTAmount != null ? Number(d.GSTAmount) : null,
        addField: String(d.AddField || '').trim() || null,
        rawData: d,
      });
    }

    if (prepared.length === 0) return 0;

    // 23 bind variables per row × BATCH_SIZE must stay under Postgres'
    // 32_767 prepared-statement parameter cap. The helper clamps for us so
    // raising MARG_STAGING_BATCH_SIZE in env never trips the cap.
    const BATCH_SIZE = this.computeSafeBatchSize(this.stagingBatchSize, 23, 'syncTransactions');
    let written = 0;
    const startedAt = Date.now();

    for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
      const chunk = prepared.slice(i, i + BATCH_SIZE);

      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${tenantId}::uuid,
          ${r.margId}::bigint,
          ${r.companyId}::integer,
          ${r.sourceKey},
          ${r.voucher},
          ${r.type},
          ${r.vcn},
          ${r.date}::date,
          ${r.cid},
          ${r.pid},
          ${r.gCode},
          ${r.batch},
          ${r.batDet},
          ${r.qty},
          ${r.free},
          ${r.mrp},
          ${r.rate},
          ${r.discount},
          ${r.amount},
          ${r.gst},
          ${r.gstAmount},
          ${r.addField},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );

      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_transactions (
          tenant_id, marg_id, company_id, source_key,
          voucher, type, vcn, date,
          cid, pid, g_code, batch, bat_det,
          qty, free, mrp, rate, discount,
          amount, gst, gst_amount, add_field,
          raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, source_key) DO UPDATE SET
          marg_id    = EXCLUDED.marg_id,
          type       = EXCLUDED.type,
          vcn        = EXCLUDED.vcn,
          date       = EXCLUDED.date,
          cid        = EXCLUDED.cid,
          pid        = EXCLUDED.pid,
          g_code     = EXCLUDED.g_code,
          batch      = EXCLUDED.batch,
          bat_det    = EXCLUDED.bat_det,
          qty        = EXCLUDED.qty,
          free       = EXCLUDED.free,
          mrp        = EXCLUDED.mrp,
          rate       = EXCLUDED.rate,
          discount   = EXCLUDED.discount,
          amount     = EXCLUDED.amount,
          gst        = EXCLUDED.gst,
          gst_amount = EXCLUDED.gst_amount,
          add_field  = EXCLUDED.add_field,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);

      written += chunk.length;
      await this.updateBatchProgress(progressSyncLogId, 'transactions', Math.floor(i / BATCH_SIZE) + 1, chunk.length);
    }

    const elapsedMs = Date.now() - startedAt;
    if (prepared.length >= 1000 || elapsedMs > 5000) {
      this.logger.log(
        `Marg syncTransactions bulk-upserted ${written} rows in ${elapsedMs}ms ` +
        `(${Math.ceil(prepared.length / BATCH_SIZE)} batches of up to ${BATCH_SIZE})`,
      );
    }

    return written;
  }

  private async syncStockData(tenantId: string, stockItems: any[], syncLogId: string): Promise<number> {
    // Bulk upsert via INSERT ... ON CONFLICT DO UPDATE. Was per-row Prisma
    // upsert which for million-batch clients costs ~30 minutes per page;
    // the batched form does the same work in seconds. Matches the proven
    // syncTransactions pattern.
    interface PreparedStock {
      tenantId: string;
      margId: number;
      companyId: number;
      pid: string;
      gCode: string | null;
      batch: string;
      batDate: Date | null;
      batDet: string | null;
      expiry: Date | null;
      supInvo: string | null;
      supDate: Date | null;
      supCode: string | null;
      opening: number | null;
      stock: number | null;
      brkStock: number | null;
      lpRate: number | null;
      pRate: number | null;
      mrp: number | null;
      rateA: number | null;
      rateB: number | null;
      rateC: number | null;
      addField: string | null;
      lastSeenSyncLogId: string;
      rawData: unknown;
    }

    const prepared: PreparedStock[] = [];
    // De-dup by unique key: ON CONFLICT DO UPDATE refuses to update the same
    // row twice in one statement (Postgres "command cannot affect row a
    // second time"). Last write wins.
    const seen = new Map<string, number>();

    for (const s of stockItems) {
      const companyId = this.toInt32(s.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(s.ID || s.Id, 0);
      const pid = String(s.PID || '').trim();
      const batch = String(s.Batch || '').trim() || '_default';
      if (!pid) continue;

      const dedupKey = `${companyId}:${pid}:${batch}`;
      const row: PreparedStock = {
        tenantId,
        margId,
        companyId,
        pid,
        gCode: String(s.GCode || '').trim() || null,
        batch,
        batDate: s.BatDate ? this.parseMargDate(s.BatDate) : null,
        batDet: String(s.BatDet || '').trim() || null,
        expiry: s.Expiry ? this.parseMargDate(s.Expiry) : null,
        supInvo: String(s.SupInvo || '').trim() || null,
        supDate: s.SupDate ? this.parseMargDate(s.SupDate) : null,
        supCode: String(s.SupCode || '').trim() || null,
        opening: s.Opening != null ? Number(s.Opening) : null,
        stock: s.Stock != null ? Number(s.Stock) : null,
        brkStock: s.BrkStock != null ? Number(s.BrkStock) : null,
        lpRate: s.LPRate != null ? Number(s.LPRate) : null,
        pRate: s.PRate != null ? Number(s.PRate) : null,
        mrp: s.MRP != null ? Number(s.MRP) : null,
        rateA: s.RateA != null ? Number(s.RateA) : null,
        rateB: s.RateB != null ? Number(s.RateB) : null,
        rateC: s.RateC != null ? Number(s.RateC) : null,
        addField: String(s.AddField || '').trim() || null,
        lastSeenSyncLogId: syncLogId,
        rawData: s,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 24, 'syncStockData');
    let written = 0;
    const startedAt = Date.now();

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);

      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::integer,
          ${r.companyId}::integer,
          ${r.pid},
          ${r.gCode},
          ${r.batch},
          ${r.batDate},
          ${r.batDet},
          ${r.expiry},
          ${r.supInvo},
          ${r.supDate},
          ${r.supCode},
          ${r.opening},
          ${r.stock},
          ${r.brkStock},
          ${r.lpRate},
          ${r.pRate},
          ${r.mrp},
          ${r.rateA},
          ${r.rateB},
          ${r.rateC},
          ${r.addField},
          FALSE,
          ${r.lastSeenSyncLogId}::uuid,
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );

      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_stocks (
          tenant_id, marg_id, company_id, pid, g_code, batch,
          bat_date, bat_det, expiry, sup_invo, sup_date, sup_code,
          opening, stock, brk_stock, lp_rate, p_rate, mrp,
          rate_a, rate_b, rate_c, add_field,
          source_deleted, last_seen_sync_log_id,
          raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, pid, batch) DO UPDATE SET
          marg_id              = EXCLUDED.marg_id,
          g_code               = EXCLUDED.g_code,
          bat_date             = EXCLUDED.bat_date,
          bat_det              = EXCLUDED.bat_det,
          expiry               = EXCLUDED.expiry,
          sup_invo             = EXCLUDED.sup_invo,
          sup_date             = EXCLUDED.sup_date,
          sup_code             = EXCLUDED.sup_code,
          opening              = EXCLUDED.opening,
          stock                = EXCLUDED.stock,
          brk_stock            = EXCLUDED.brk_stock,
          lp_rate              = EXCLUDED.lp_rate,
          p_rate               = EXCLUDED.p_rate,
          mrp                  = EXCLUDED.mrp,
          rate_a               = EXCLUDED.rate_a,
          rate_b               = EXCLUDED.rate_b,
          rate_c               = EXCLUDED.rate_c,
          add_field            = EXCLUDED.add_field,
          source_deleted       = FALSE,
          last_seen_sync_log_id = EXCLUDED.last_seen_sync_log_id,
          raw_data             = EXCLUDED.raw_data,
          updated_at           = NOW()
      `);

      written += chunk.length;
      // syncStockData already takes syncLogId; reuse it as the progress
      // identity so the bulk loop heartbeats during long stock pages.
      await this.updateBatchProgress(syncLogId, 'stock', Math.floor(i / batchSize) + 1, chunk.length);
    }

    const elapsedMs = Date.now() - startedAt;
    if (prepared.length >= 1000 || elapsedMs > 5000) {
      this.logger.log(
        `Marg syncStockData bulk-upserted ${written} rows in ${elapsedMs}ms ` +
        `(${Math.ceil(prepared.length / batchSize)} batches of up to ${batchSize})`,
      );
    }

    return written;
  }

  private async syncVouchers(tenantId: string, mdis: any[], dateWindow: DateWindow | null, progressSyncLogId?: string | null): Promise<number> {
    interface PreparedVoucher {
      tenantId: string;
      margId: bigint;
      companyId: number;
      voucher: string;
      type: string;
      vcn: string | null;
      date: Date;
      cid: string | null;
      finalAmt: number | null;
      cash: number | null;
      others: number | null;
      salesman: string | null;
      mr: string | null;
      route: string | null;
      area: string | null;
      orn: string | null;
      addField: string | null;
      oDate: Date | null;
      rawData: unknown;
    }

    const prepared: PreparedVoucher[] = [];
    const seen = new Map<string, number>();

    for (const m of mdis) {
      const companyId = this.toInt32(m.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(m.ID);
      const voucher = String(m.Voucher || '').trim();
      if (!voucher) continue;

      const parsedDate = this.parseMargDate(m.Date);
      if (!parsedDate) continue;
      if (!this.isWithinDateWindow(parsedDate, dateWindow)) continue;

      const type = String(m.Type || '').trim();

      const dedupKey = `${companyId}:${voucher}:${type}`;
      const row: PreparedVoucher = {
        tenantId,
        margId,
        companyId,
        voucher,
        type,
        vcn: String(m.VCN || m.Vcn || '').trim() || null,
        date: parsedDate,
        cid: String(m.CID || '').trim() || null,
        finalAmt: m.Final != null ? Number(m.Final) : null,
        cash: m.Cash != null ? Number(m.Cash) : null,
        others: m.Others != null ? Number(m.Others) : null,
        salesman: String(m.Salun || '').trim() || null,
        mr: String(m.MR || '').trim() || null,
        route: String(m.Rout || '').trim() || null,
        area: String(m.Area || '').trim() || null,
        orn: String(m.ORN || '').trim() || null,
        addField: String(m.AddField || '').trim() || null,
        oDate: m.ODate ? this.parseMargDate(m.ODate) : null,
        rawData: m,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 19, 'syncVouchers');
    let written = 0;
    const startedAt = Date.now();

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::bigint,
          ${r.companyId}::integer,
          ${r.voucher},
          ${r.type},
          ${r.vcn},
          ${r.date}::date,
          ${r.cid},
          ${r.finalAmt},
          ${r.cash},
          ${r.others},
          ${r.salesman},
          ${r.mr},
          ${r.route},
          ${r.area},
          ${r.orn},
          ${r.addField},
          ${r.oDate},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );

      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_vouchers (
          tenant_id, marg_id, company_id, voucher, type, vcn, date,
          cid, final_amt, cash, others, salesman, mr, route, area, orn,
          add_field, o_date, raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, voucher, type) DO UPDATE SET
          marg_id    = EXCLUDED.marg_id,
          vcn        = EXCLUDED.vcn,
          date       = EXCLUDED.date,
          cid        = EXCLUDED.cid,
          final_amt  = EXCLUDED.final_amt,
          cash       = EXCLUDED.cash,
          others     = EXCLUDED.others,
          salesman   = EXCLUDED.salesman,
          mr         = EXCLUDED.mr,
          route      = EXCLUDED.route,
          area       = EXCLUDED.area,
          orn        = EXCLUDED.orn,
          add_field  = EXCLUDED.add_field,
          o_date     = EXCLUDED.o_date,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);

      written += chunk.length;
      await this.updateBatchProgress(progressSyncLogId, 'vouchers', Math.floor(i / batchSize) + 1, chunk.length);
    }

    const elapsedMs = Date.now() - startedAt;
    if (prepared.length >= 1000 || elapsedMs > 5000) {
      this.logger.log(
        `Marg syncVouchers bulk-upserted ${written} rows in ${elapsedMs}ms ` +
        `(${Math.ceil(prepared.length / batchSize)} batches of up to ${batchSize})`,
      );
    }

    return written;
  }

  private async syncAccountGroups(tenantId: string, accountGroups: any[]): Promise<number> {
    interface PreparedAccountGroup {
      tenantId: string;
      margId: bigint;
      companyId: number;
      aid: string;
      name: string;
      under: string | null;
      addField: string | null;
      rawData: unknown;
    }

    const prepared: PreparedAccountGroup[] = [];
    const seen = new Map<string, number>();

    for (const group of accountGroups) {
      const companyId = this.toInt32(group.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(group.ID);
      if (margId <= BigInt(0)) continue;

      const aid = this.normalizeMargCode(group.AID);
      if (!aid) continue;

      const dedupKey = `${companyId}:${aid}`;
      const row: PreparedAccountGroup = {
        tenantId,
        margId,
        companyId,
        aid,
        name: String(group.Name || '').trim(),
        under: this.normalizeMargCode(group.Under) || null,
        addField: String(group.AddField || '').trim() || null,
        rawData: group,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 8, 'syncAccountGroups');
    let written = 0;

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::bigint,
          ${r.companyId}::integer,
          ${r.aid},
          ${r.name},
          ${r.under},
          ${r.addField},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_account_groups (
          tenant_id, marg_id, company_id, aid, name, "under",
          add_field, raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, aid) DO UPDATE SET
          marg_id    = EXCLUDED.marg_id,
          name       = EXCLUDED.name,
          "under"    = EXCLUDED."under",
          add_field  = EXCLUDED.add_field,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);
      written += chunk.length;
    }
    return written;
  }

  private async syncAccountPostings(
    tenantId: string,
    postings: any[],
    dateWindow: DateWindow | null,
    progressSyncLogId?: string | null,
  ): Promise<number> {
    interface PreparedPosting {
      tenantId: string;
      margId: bigint;
      companyId: number;
      voucher: string | null;
      date: Date;
      code: string | null;
      amount: number;
      book: string;
      code1: string | null;
      gCode: string | null;
      remark: string | null;
      addField: string | null;
      rawData: unknown;
    }

    const prepared: PreparedPosting[] = [];
    const seen = new Map<string, number>();

    for (const posting of postings) {
      const companyId = this.toInt32(posting.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(posting.ID);
      if (margId <= BigInt(0)) continue;

      const parsedDate = this.parseMargDate(posting.Date);
      if (!parsedDate) continue;
      if (!this.isWithinDateWindow(parsedDate, dateWindow)) continue;

      const book = String(posting.Book || '').trim() || 'UNKNOWN';
      const code = this.normalizeMargCode(posting.Code) || null;
      const code1 = this.normalizeMargCode(posting.Code1) || null;
      const gCode = this.normalizeMargCode(posting.GCode) || null;

      const dedupKey = `${companyId}:${margId.toString()}`;
      const row: PreparedPosting = {
        tenantId,
        margId,
        companyId,
        voucher: String(posting.Voucher || '').trim() || null,
        date: parsedDate,
        code,
        amount: posting.Amount != null ? Number(posting.Amount) : 0,
        book,
        code1,
        gCode,
        remark: String(posting.Remark || '').trim() || null,
        addField: String(posting.AddField || '').trim() || null,
        rawData: posting,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 13, 'syncAccountPostings');
    let written = 0;
    const startedAt = Date.now();

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::bigint,
          ${r.companyId}::integer,
          ${r.voucher},
          ${r.date}::date,
          ${r.code},
          ${r.amount},
          ${r.book},
          ${r.code1},
          ${r.gCode},
          ${r.remark},
          ${r.addField},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );

      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_account_postings (
          tenant_id, marg_id, company_id, voucher, date,
          code, amount, book, code1, g_code,
          remark, add_field, raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, marg_id) DO UPDATE SET
          voucher    = EXCLUDED.voucher,
          date       = EXCLUDED.date,
          code       = EXCLUDED.code,
          amount     = EXCLUDED.amount,
          book       = EXCLUDED.book,
          code1      = EXCLUDED.code1,
          g_code     = EXCLUDED.g_code,
          remark     = EXCLUDED.remark,
          add_field  = EXCLUDED.add_field,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);

      written += chunk.length;
      await this.updateBatchProgress(progressSyncLogId, 'account_postings', Math.floor(i / batchSize) + 1, chunk.length);
    }

    const elapsedMs = Date.now() - startedAt;
    if (prepared.length >= 1000 || elapsedMs > 5000) {
      this.logger.log(
        `Marg syncAccountPostings bulk-upserted ${written} rows in ${elapsedMs}ms ` +
        `(${Math.ceil(prepared.length / batchSize)} batches of up to ${batchSize})`,
      );
    }

    return written;
  }

  private async syncAccountGroupBalances(tenantId: string, balances: any[]): Promise<number> {
    interface PreparedAccountGroupBalance {
      tenantId: string;
      margId: bigint;
      companyId: number;
      aid: string;
      opening: number | null;
      balance: number | null;
      rawData: unknown;
    }

    const prepared: PreparedAccountGroupBalance[] = [];
    const seen = new Map<string, number>();

    for (const balance of balances) {
      const companyId = this.toInt32(balance.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(balance.ID);
      if (margId <= BigInt(0)) continue;

      const aid = this.normalizeMargCode(balance.AID);
      if (!aid) continue;

      const dedupKey = `${companyId}:${aid}`;
      const row: PreparedAccountGroupBalance = {
        tenantId,
        margId,
        companyId,
        aid,
        opening: balance.Opening != null ? Number(balance.Opening) : null,
        balance: balance.Balance != null ? Number(balance.Balance) : null,
        rawData: balance,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 7, 'syncAccountGroupBalances');
    let written = 0;

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::bigint,
          ${r.companyId}::integer,
          ${r.aid},
          ${r.opening},
          ${r.balance},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_account_group_balances (
          tenant_id, marg_id, company_id, aid, opening, balance,
          raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, aid) DO UPDATE SET
          marg_id    = EXCLUDED.marg_id,
          opening    = EXCLUDED.opening,
          balance    = EXCLUDED.balance,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);
      written += chunk.length;
    }
    return written;
  }

  private async syncPartyBalances(tenantId: string, balances: any[]): Promise<number> {
    interface PreparedPartyBalance {
      tenantId: string;
      margId: bigint;
      companyId: number;
      cid: string;
      opening: number | null;
      balance: number | null;
      rawData: unknown;
    }

    const prepared: PreparedPartyBalance[] = [];
    const seen = new Map<string, number>();

    for (const balance of balances) {
      const companyId = this.toInt32(balance.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(balance.ID);
      if (margId <= BigInt(0)) continue;

      const cid = this.normalizeMargCode(balance.CID);
      if (!cid) continue;

      const dedupKey = `${companyId}:${cid}`;
      const row: PreparedPartyBalance = {
        tenantId,
        margId,
        companyId,
        cid,
        opening: balance.Opening != null ? Number(balance.Opening) : null,
        balance: balance.Balance != null ? Number(balance.Balance) : null,
        rawData: balance,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 7, 'syncPartyBalances');
    let written = 0;

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::bigint,
          ${r.companyId}::integer,
          ${r.cid},
          ${r.opening},
          ${r.balance},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_party_balances (
          tenant_id, marg_id, company_id, cid, opening, balance,
          raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, cid) DO UPDATE SET
          marg_id    = EXCLUDED.marg_id,
          opening    = EXCLUDED.opening,
          balance    = EXCLUDED.balance,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);
      written += chunk.length;
    }
    return written;
  }

  private async syncOutstandings(
    tenantId: string,
    outstandings: any[],
    dateWindow: DateWindow | null,
    progressSyncLogId?: string | null,
  ): Promise<number> {
    interface PreparedOutstanding {
      tenantId: string;
      margId: bigint;
      companyId: number;
      ord: string;
      date: Date;
      vcn: string | null;
      days: number;
      finalAmt: number | null;
      balance: number | null;
      pdLess: number | null;
      groupCode: string | null;
      voucher: string | null;
      sVoucher: string | null;
      addField: string | null;
      rawData: unknown;
    }

    const prepared: PreparedOutstanding[] = [];
    const seen = new Map<string, number>();

    for (const outstanding of outstandings) {
      const companyId = this.toInt32(outstanding.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(outstanding.ID);
      if (margId <= BigInt(0)) continue;

      const ord = this.normalizeMargCode(outstanding.ORD);
      if (!ord) continue;

      const parsedDate = this.parseMargDate(outstanding.Date);
      if (!parsedDate) continue;
      if (!this.isWithinDateWindow(parsedDate, dateWindow)) continue;

      const dedupKey = `${companyId}:${margId.toString()}`;
      const row: PreparedOutstanding = {
        tenantId,
        margId,
        companyId,
        ord,
        date: parsedDate,
        vcn: String(outstanding.VCN || outstanding.Vcn || '').trim() || null,
        days: this.toInt32(outstanding.Days, 0),
        finalAmt: outstanding.Final != null ? Number(outstanding.Final) : null,
        balance: outstanding.Balance != null ? Number(outstanding.Balance) : null,
        pdLess: outstanding.PdLess != null ? Number(outstanding.PdLess) : null,
        groupCode: this.normalizeMargCode(outstanding.Group) || null,
        voucher: String(outstanding.Voucher || '').trim() || null,
        sVoucher: String(outstanding.SVoucher || '').trim() || null,
        addField: String(outstanding.AddField || '').trim() || null,
        rawData: outstanding,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 15, 'syncOutstandings');
    let written = 0;
    const startedAt = Date.now();

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::bigint,
          ${r.companyId}::integer,
          ${r.ord},
          ${r.date}::date,
          ${r.vcn},
          ${r.days}::integer,
          ${r.finalAmt},
          ${r.balance},
          ${r.pdLess},
          ${r.groupCode},
          ${r.voucher},
          ${r.sVoucher},
          ${r.addField},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );

      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_outstandings (
          tenant_id, marg_id, company_id, ord, date, vcn, days,
          final_amt, balance, pd_less, group_code,
          voucher, s_voucher, add_field, raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, marg_id) DO UPDATE SET
          ord        = EXCLUDED.ord,
          date       = EXCLUDED.date,
          vcn        = EXCLUDED.vcn,
          days       = EXCLUDED.days,
          final_amt  = EXCLUDED.final_amt,
          balance    = EXCLUDED.balance,
          pd_less    = EXCLUDED.pd_less,
          group_code = EXCLUDED.group_code,
          voucher    = EXCLUDED.voucher,
          s_voucher  = EXCLUDED.s_voucher,
          add_field  = EXCLUDED.add_field,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);

      written += chunk.length;
      await this.updateBatchProgress(progressSyncLogId, 'outstandings', Math.floor(i / batchSize) + 1, chunk.length);
    }

    const elapsedMs = Date.now() - startedAt;
    if (prepared.length >= 1000 || elapsedMs > 5000) {
      this.logger.log(
        `Marg syncOutstandings bulk-upserted ${written} rows in ${elapsedMs}ms ` +
        `(${Math.ceil(prepared.length / batchSize)} batches of up to ${batchSize})`,
      );
    }

    return written;
  }

  private async syncSaleTypes(tenantId: string, saleTypes: any[]): Promise<number> {
    interface PreparedSaleType {
      tenantId: string;
      margId: number;
      companyId: number;
      sgCode: string;
      sCode: string;
      name: string;
      main: string | null;
      margCode: string | null;
      addField: string | null;
      rawData: unknown;
    }

    const prepared: PreparedSaleType[] = [];
    const seen = new Map<string, number>();

    for (const st of saleTypes) {
      const companyId = this.toInt32(st.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(st.ID, 0);
      const sgCode = String(st.SGCode || '').trim();
      const sCode = String(st.SCode || '').trim();
      if (!sgCode || !sCode) continue;

      const dedupKey = `${companyId}:${sgCode}:${sCode}`;
      const row: PreparedSaleType = {
        tenantId,
        margId,
        companyId,
        sgCode,
        sCode,
        name: String(st.Name || '').trim(),
        main: String(st.Main || '').trim() || null,
        margCode: String(st.MargCode || '').trim() || null,
        addField: String(st.AddField || '').trim() || null,
        rawData: st,
      };
      const existingIdx = seen.get(dedupKey);
      if (existingIdx !== undefined) {
        prepared[existingIdx] = row;
      } else {
        seen.set(dedupKey, prepared.length);
        prepared.push(row);
      }
    }

    if (prepared.length === 0) return 0;

    const batchSize = this.computeSafeBatchSize(this.stagingBatchSize, 10, 'syncSaleTypes');
    let written = 0;

    for (let i = 0; i < prepared.length; i += batchSize) {
      const chunk = prepared.slice(i, i + batchSize);
      const values = Prisma.join(
        chunk.map((r) => Prisma.sql`(
          ${r.tenantId}::uuid,
          ${r.margId}::integer,
          ${r.companyId}::integer,
          ${r.sgCode},
          ${r.sCode},
          ${r.name},
          ${r.main},
          ${r.margCode},
          ${r.addField},
          ${JSON.stringify(r.rawData)}::jsonb,
          NOW(),
          NOW()
        )`),
        ',',
      );
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO marg_sale_types (
          tenant_id, marg_id, company_id, sg_code, s_code, name, main,
          marg_code, add_field, raw_data, created_at, updated_at
        )
        VALUES ${values}
        ON CONFLICT (tenant_id, company_id, sg_code, s_code) DO UPDATE SET
          marg_id    = EXCLUDED.marg_id,
          name       = EXCLUDED.name,
          main       = EXCLUDED.main,
          marg_code  = EXCLUDED.marg_code,
          add_field  = EXCLUDED.add_field,
          raw_data   = EXCLUDED.raw_data,
          updated_at = NOW()
      `);
      written += chunk.length;
    }
    return written;
  }

  // ===================== TRANSFORM → CORE TABLES =====================

  /** Transform staged Marg branches → Location table */
  private async transformMargNamedMasters(tenantId: string): Promise<void> {
    await Promise.all([
      this.transformMargProductCompanies(tenantId),
      this.transformMargProductSalts(tenantId),
      this.transformMargProductGroups(tenantId),
      this.transformMargUoms(tenantId),
      this.transformMargSalesmen(tenantId),
    ]);
  }

  private async findSaleTypeName(
    tenantId: string,
    companyId: number | null,
    code: string | null | undefined,
    sgCodes: string[],
  ): Promise<{ name: string | null; rawData: unknown | null }> {
    const normalizedCode = this.normalizeMargCode(code, 50);
    if (!normalizedCode) return { name: null, rawData: null };

    const row = await this.margPrisma.margSaleType.findFirst({
      where: {
        tenantId,
        ...(companyId && companyId > 0 ? { companyId } : {}),
        sCode: normalizedCode,
        sgCode: { in: sgCodes },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const name = this.cleanMargMasterName(row?.name);
    return { name: name || null, rawData: row?.rawData ?? null };
  }

  private masterFallbackName(label: string, code: string): string {
    return `Unknown ${label} (${code})`;
  }

  private cleanMargMasterName(value: unknown): string {
    return String(value || '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private truncateMasterName(name: string, maxLength: number): string {
    return name.length > maxLength ? name.substring(0, maxLength) : name;
  }

  private async transformMargProductCompanies(tenantId: string): Promise<void> {
    const rows = await this.margPrisma.margProduct.findMany({
      where: { tenantId, gCode: { not: null } },
      distinct: ['companyId', 'gCode'],
      select: { companyId: true, gCode: true, rawData: true },
    });

    for (const row of rows) {
      const code = this.normalizeMargCode(row.gCode, 50);
      if (!code) continue;
      const master = await this.findSaleTypeName(tenantId, row.companyId, code, ['ZZZZZZ', 'COMPANY', 'MFR', 'MANUF']);
      const name = this.truncateMasterName(master.name || this.masterFallbackName('company', code), 100);
      await this.margPrisma.productCompany.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: {
          tenantId,
          code,
          name,
          sourceSystem: MARG_SOURCE_SYSTEM,
          rawData: master.rawData || row.rawData,
        },
        update: {
          ...(master.name ? { name } : {}),
          sourceSystem: MARG_SOURCE_SYSTEM,
          rawData: master.rawData || row.rawData,
          isActive: true,
        },
      });

    }
  }

  private async transformMargProductSalts(tenantId: string): Promise<void> {
    const saleTypes = await this.margPrisma.margSaleType.findMany({
      where: { tenantId, sgCode: 'SALT' },
    });

    for (const row of saleTypes) {
      const code = this.normalizeMargCode(row.sCode, 50);
      if (!code) continue;
      const name = this.truncateMasterName(this.cleanMargMasterName(row.name) || this.masterFallbackName('salt', code), 255);
      await this.margPrisma.productSalt.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: { tenantId, code, name, sourceSystem: MARG_SOURCE_SYSTEM, rawData: row.rawData },
        update: { name, sourceSystem: MARG_SOURCE_SYSTEM, rawData: row.rawData, isActive: true },
      });
    }

    const productRows = await this.margPrisma.margProduct.findMany({
      where: { tenantId, gCode3: { not: null } },
      distinct: ['gCode3'],
      select: { gCode3: true, rawData: true },
    });
    for (const row of productRows) {
      const code = this.normalizeMargCode(row.gCode3, 50);
      if (!code) continue;
      await this.margPrisma.productSalt.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: {
          tenantId,
          code,
          name: this.truncateMasterName(this.masterFallbackName('salt', code), 255),
          sourceSystem: MARG_SOURCE_SYSTEM,
          rawData: row.rawData,
        },
        update: { isActive: true },
      });
    }
  }

  private async transformMargProductGroups(tenantId: string): Promise<void> {
    const saleTypes = await this.margPrisma.margSaleType.findMany({
      where: { tenantId, sgCode: { in: ['CATEGO', 'GROUP', 'PRODUCTGROUP'] } },
    });

    for (const row of saleTypes) {
      const code = this.normalizeMargCode(row.sCode, 50);
      if (!code) continue;
      const name = this.truncateMasterName(this.cleanMargMasterName(row.name) || this.masterFallbackName('product group', code), 100);
      await this.prisma.productCategory.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: { tenantId, code, name, description: 'Marg product group/category' },
        update: { name, description: 'Marg product group/category', isActive: true },
      });
    }

    const productRows = await this.margPrisma.margProduct.findMany({
      where: { tenantId, gCode5: { not: null } },
      distinct: ['companyId', 'gCode5'],
      select: { gCode5: true, companyId: true },
    });
    for (const row of productRows) {
      const code = this.normalizeMargCode(row.gCode5, 50);
      if (!code) continue;
      const master = await this.findSaleTypeName(tenantId, row.companyId, code, ['CATEGO', 'GROUP', 'PRODUCTGROUP']);
      const name = this.truncateMasterName(master.name || this.masterFallbackName('product group', code), 100);
      await this.prisma.productCategory.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: { tenantId, code, name, description: 'Marg product group/category' },
        update: { ...(master.name ? { name } : {}), description: 'Marg product group/category', isActive: true },
      });
    }
  }

  private async transformMargUoms(tenantId: string): Promise<void> {
    const rows = await this.margPrisma.margProduct.findMany({
      where: { tenantId, unit: { not: null } },
      distinct: ['unit'],
      select: { unit: true },
    });

    for (const row of rows) {
      const code = this.normalizeMargCode(row.unit, 20);
      if (!code) continue;
      await this.prisma.unitOfMeasure.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: {
          tenantId,
          code,
          name: code,
          symbol: code.substring(0, 10),
          category: 'OTHER' as any,
          description: 'Marg unit of measure',
        },
        update: { name: code, symbol: code.substring(0, 10), isActive: true },
      });
    }
  }

  private async transformMargSalesmen(tenantId: string): Promise<void> {
    const voucherRows = await this.margPrisma.margVoucher.findMany({
      where: { tenantId, OR: [{ salesman: { not: null } }, { mr: { not: null } }] },
      distinct: ['salesman', 'mr'],
      select: { salesman: true, mr: true, rawData: true },
    });
    const partyRows = await this.margPrisma.margParty.findMany({
      where: { tenantId, mr: { not: null } },
      distinct: ['mr'],
      select: { mr: true, rawData: true },
    });

    const candidates = new Map<string, unknown>();
    for (const row of voucherRows) {
      for (const value of [row.salesman, row.mr]) {
        const code = this.normalizeMargCode(value, 50);
        if (code) candidates.set(code, row.rawData);
      }
    }
    for (const row of partyRows) {
      const code = this.normalizeMargCode(row.mr, 50);
      if (code) candidates.set(code, row.rawData);
    }

    const salesmanPartyRows = candidates.size > 0
      ? await this.margPrisma.margParty.findMany({
        where: {
          tenantId,
          cid: { in: Array.from(candidates.keys()) },
          isDeleted: false,
        },
        select: { cid: true, parName: true, rawData: true },
      })
      : [];
    const partyNameByCode = new Map<string, { name: string; rawData: unknown }>();
    for (const row of salesmanPartyRows) {
      const code = this.normalizeMargCode(row.cid, 50);
      const name = this.cleanMargMasterName(row.parName);
      if (code && name) partyNameByCode.set(code, { name, rawData: row.rawData });
    }

    for (const [code, rawData] of candidates) {
      const master = await this.findSaleTypeName(tenantId, null, code, ['SALESMAN', 'MR', 'USER']);
      const partyMaster = partyNameByCode.get(code);
      const resolvedName = partyMaster?.name || master.name;
      const name = this.truncateMasterName(resolvedName || this.masterFallbackName('salesman', code), 255);
      await this.margPrisma.salesman.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: { tenantId, code, name, sourceSystem: MARG_SOURCE_SYSTEM, rawData: partyMaster?.rawData || master.rawData || rawData },
        update: {
          ...(resolvedName ? { name } : {}),
          sourceSystem: MARG_SOURCE_SYSTEM,
          rawData: partyMaster?.rawData || master.rawData || rawData,
          isActive: true,
        },
      });
    }
  }

  private async transformBranches(tenantId: string): Promise<void> {
    const branches = await this.margPrisma.margBranch.findMany({
      where: { tenantId, locationId: null },
    });

    for (const mb of branches) {
      const code = `MARG-BR-${mb.companyId}`.substring(0, 50);
      const location = await this.prisma.location.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: {
          tenantId,
          code,
          name: mb.name || code,
          type: LocationType.STORE,
          status: DimensionStatus.ACTIVE,
          externalId: `marg:branch:${mb.companyId}`,
          attributes: {
            margCompanyId: mb.companyId,
            margBranchName: mb.branch,
            margStoreId: mb.storeId,
            margLicence: mb.licence,
          },
        },
        update: {
          name: mb.name || code,
          externalId: `marg:branch:${mb.companyId}`,
        },
      });

      await this.margPrisma.margBranch.update({
        where: { id: mb.id },
        data: { locationId: location.id },
      });
    }
  }

  /** Resolve the core Location ID for a Marg companyId (branch) */
  private async resolveLocationId(tenantId: string, companyId: number): Promise<string | null> {
    if (!companyId || companyId <= 0) return null;

    const branch = await this.margPrisma.margBranch.findFirst({
      where: { tenantId, companyId },
      select: { locationId: true },
    });

    return branch?.locationId || null;
  }

  /** Transform staged Marg products → Product table */
  private buildMargProductProjectionData(mp: any, code: string): {
    create: Record<string, unknown>;
    update: Prisma.ProductUpdateInput;
  } {
    const name = mp.name || code;
    const unitOfMeasure = mp.unit || 'PCS';
    const externalId = `marg:${mp.companyId}:${mp.pid}`;
    const productCompany = mp.gCode ?? null;
    const salt = mp.gCode3 ?? null;
    const productGroup = mp.gCode5 ?? null;
    const hsnCode = mp.gCode6 ?? null;

    return {
      create: {
        code,
        name,
        unitOfMeasure,
        category: productGroup || undefined,
        productCompany,
        salt,
        productGroup,
        hsnCode,
        status: DimensionStatus.ACTIVE,
        externalId,
        attributes: {
          margPid: mp.pid,
          margCompanyId: mp.companyId,
          margGCode: productCompany,
          margGCode3: salt,
          margGCode5: productGroup,
          margGCode6: hsnCode,
          margGst: mp.gst ? Number(mp.gst) : null,
          margHsn: hsnCode,
        },
      },
      update: {
        name,
        unitOfMeasure,
        productCompany,
        salt,
        productGroup,
        hsnCode,
        externalId,
      },
    };
  }

  private async transformProducts(tenantId: string): Promise<void> {
    let cursor: string | null = null;

    while (true) {
      const staged = await this.margPrisma.margProduct.findMany({
        where: {
          tenantId,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (staged.length === 0) break;

      for (const mp of staged) {
        const code = `MARG-${mp.code}`.substring(0, 50);
        const productData = this.buildMargProductProjectionData(mp, code);
        const linkedProduct = mp.productId
          ? await this.prisma.product.findFirst({
            where: { id: mp.productId, tenantId },
            select: { id: true },
          })
          : null;

        const product = linkedProduct
          ? await this.prisma.product.update({
            where: { id: linkedProduct.id },
            data: productData.update,
          })
          : await this.prisma.product.upsert({
            where: { tenantId_code: { tenantId, code } },
            create: {
              tenantId,
              code,
              ...productData.create,
            } as Prisma.ProductUncheckedCreateInput,
            update: productData.update as Prisma.ProductUncheckedUpdateInput,
          });

        await this.margPrisma.margProduct.update({
          where: { id: mp.id },
          data: { productId: product.id },
        });

        // Sweep up any stock/actuals that earlier landed under the legacy
        // `MARG-{pid}` placeholder product (created when stock pages arrived
        // before product pages on the very first sync).
        await this.mergeMargLegacyPidProduct(tenantId, mp.pid, product.id);
      }

      cursor = staged[staged.length - 1].id;
    }
  }

  /** Transform staged Marg parties → Customer table */
  private async transformParties(tenantId: string): Promise<void> {
    let cursor: string | null = null;

    while (true) {
      const staged = await this.margPrisma.margParty.findMany({
        where: {
          tenantId,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (staged.length === 0) break;

      for (const mp of staged) {
        if (!this.isProjectableCustomerParty(mp)) {
          if (mp.customerId) {
            await this.margPrisma.margParty.update({
              where: { id: mp.id },
              data: { customerId: null },
            });
          }
          continue;
        }

        const code = `MARG-${mp.cid}`.substring(0, 50);
        const customer = await this.prisma.customer.upsert({
          where: { tenantId_code: { tenantId, code } },
          create: {
            tenantId,
            code,
            name: mp.parName || code,
            type: CustomerType.DIRECT,
            region: mp.area || undefined,
            creditLimit: mp.credit ? new Prisma.Decimal(mp.credit) : undefined,
            paymentTerms: mp.crDays ? `NET ${mp.crDays}` : undefined,
            status: DimensionStatus.ACTIVE,
            externalId: `marg:${mp.companyId}:${mp.cid}`,
            attributes: {
              margCid: mp.cid,
              margCompanyId: mp.companyId,
              gstn: mp.gstNo,
              address1: mp.parAdd1,
              address2: mp.parAdd2,
              phone1: mp.phone1,
              phone2: mp.phone2,
              route: mp.route,
              area: mp.area,
              pin: mp.pin,
              lat: mp.lat,
              lng: mp.lng,
            },
          },
          update: {
            name: mp.parName || code,
            externalId: `marg:${mp.companyId}:${mp.cid}`,
          },
        });

        await this.margPrisma.margParty.update({
          where: { id: mp.id },
          data: { customerId: customer.id },
        });
      }

      cursor = staged[staged.length - 1].id;
    }
  }

  /** Project purchase-facing Marg parties into explicit supplier crosswalk rows. */
  private async transformSuppliers(tenantId: string): Promise<number> {
    const purchaseVouchers = await this.margPrisma.margVoucher.findMany({
      where: {
        tenantId,
        type: { in: ['P', 'X', 'B'] },
        cid: { not: null },
      },
      select: {
        companyId: true,
        cid: true,
        voucher: true,
      },
    });

    const purchaseVoucherKeys = new Set(
      purchaseVouchers
        .map((voucher: { companyId: number; voucher: string }) => `${voucher.companyId}|${voucher.voucher}`),
    );
    const purchaseVoucherNumbers = Array.from(new Set(
      purchaseVouchers
        .map((voucher: { voucher: string | null }) => String(voucher.voucher || '').trim())
        .filter(Boolean),
    ));

    const linkedOutstandings = purchaseVoucherNumbers.length > 0
      ? await this.margPrisma.margOutstanding.findMany({
        where: {
          tenantId,
          OR: [
            { voucher: { in: purchaseVoucherNumbers } },
            { sVoucher: { in: purchaseVoucherNumbers } },
          ],
        },
        select: {
          companyId: true,
          ord: true,
          voucher: true,
          sVoucher: true,
        },
      })
      : [];

    const candidateKeys = new Set<string>();
    for (const voucher of purchaseVouchers) {
      const cid = String(voucher.cid || '').trim();
      if (!cid || this.isMargPlaceholderPartyCode(cid)) continue;
      candidateKeys.add(`${voucher.companyId}|${cid.toUpperCase()}`);
    }

    for (const outstanding of linkedOutstandings) {
      const voucherKey = outstanding.voucher ? `${outstanding.companyId}|${outstanding.voucher}` : null;
      const sVoucherKey = outstanding.sVoucher ? `${outstanding.companyId}|${outstanding.sVoucher}` : null;
      if (
        (!voucherKey || !purchaseVoucherKeys.has(voucherKey)) &&
        (!sVoucherKey || !purchaseVoucherKeys.has(sVoucherKey))
      ) {
        continue;
      }

      const ord = this.normalizeMargCode(outstanding.ord, 50);
      if (!ord || this.isMargPlaceholderPartyCode(ord)) continue;
      candidateKeys.add(`${outstanding.companyId}|${ord}`);
    }

    let projectedCount = 0;

    for (const candidateKey of candidateKeys) {
      const [companyIdRaw, cid] = candidateKey.split('|');
      const companyId = Number(companyIdRaw);
      if (!companyId || !cid) continue;

      const party = await this.margPrisma.margParty.findFirst({
        where: { tenantId, companyId, cid },
        orderBy: { updatedAt: 'desc' },
      });

      if (party && !this.isProjectableSupplierParty(party)) {
        continue;
      }

      const supplierName = String(party?.parName || cid).trim();
      if (!supplierName || this.isMargPlaceholderPartyCode(cid)) {
        continue;
      }

      const externalId = `marg:${companyId}:${cid}`;
      const supplierCode = `MARG-SUP-${companyId}-${cid}`.substring(0, 50);
      const address = this.buildMargPartyAddress(party);
      const existingSupplier = await this.prisma.$queryRaw<Array<{ id: string; code: string; attributes: Prisma.JsonValue | null }>>(
        Prisma.sql`
          SELECT id, code, attributes
          FROM suppliers
          WHERE tenant_id = ${tenantId}::uuid
            AND (
              external_id = ${externalId}
              OR (
                COALESCE(attributes->>'margCid', '') = ${cid}
                AND (
                  COALESCE(attributes->>'margCompanyId', '') = ''
                  OR COALESCE(attributes->>'margCompanyId', '') = ${String(companyId)}
                )
              )
            )
          ORDER BY
            CASE WHEN external_id = ${externalId} THEN 1 ELSE 2 END,
            created_at ASC
          LIMIT 1
        `,
      );

      const mergedAttributes = {
        ...(this.toRecord(existingSupplier[0]?.attributes) ?? {}),
        margCid: cid,
        margCompanyId: companyId,
        margSource: 'PURCHASE',
        margPartyId: party?.id ?? null,
        gstn: party?.gstNo ?? null,
        route: party?.route ?? null,
        area: party?.area ?? null,
        pin: party?.pin ?? null,
        dlNo: party?.dlNo ?? null,
      };

      if (existingSupplier[0]?.id) {
        await this.prisma.supplier.update({
          where: { id: existingSupplier[0].id },
          data: {
            name: supplierName,
            phone: party?.phone1 || party?.phone2 || null,
            address,
            paymentTerms: party?.crDays ? `NET ${party.crDays}` : null,
            currency: 'INR',
            externalId,
            attributes: mergedAttributes,
          },
        });
      } else {
        await this.prisma.supplier.upsert({
          where: { tenantId_code: { tenantId, code: supplierCode } },
          create: {
            tenantId,
            code: supplierCode,
            name: supplierName,
            phone: party?.phone1 || party?.phone2 || null,
            address,
            paymentTerms: party?.crDays ? `NET ${party.crDays}` : null,
            currency: 'INR',
            status: DimensionStatus.ACTIVE,
            externalId,
            attributes: mergedAttributes,
          },
          update: {
            name: supplierName,
            phone: party?.phone1 || party?.phone2 || null,
            address,
            paymentTerms: party?.crDays ? `NET ${party.crDays}` : null,
            currency: 'INR',
            externalId,
            attributes: mergedAttributes,
          },
        });
      }

      projectedCount += 1;
    }

    return projectedCount;
  }

  private buildMargVoucherLookupKey(companyId: number, voucher: string | null | undefined): string {
    return `${companyId}|${String(voucher || '').trim()}`;
  }

  private extractMargAddFieldLeadToken(addField: string | null | undefined): string | null {
    const normalized = String(addField || '').trim();
    if (!normalized) return null;

    const [leadToken] = normalized.split(';');
    const token = leadToken?.trim().toUpperCase();
    return token || null;
  }

  private normalizeMargDocumentNumber(value: string | null | undefined): string | null {
    const normalized = String(value || '').trim().toUpperCase().replace(/^[^A-Z0-9]+/, '');
    return normalized || null;
  }

  private resolveMargVcnPrefix(value: string | null | undefined): string | null {
    const normalized = this.normalizeMargDocumentNumber(value);
    if (!normalized) return null;

    const match = normalized.match(/^[A-Z-]+/);
    return match ? match[0] : normalized;
  }

  private matchesMargVcnPrefix(prefix: string | null, candidates: string[]): boolean {
    if (!prefix) return false;
    return candidates.some((candidate) => prefix === candidate || prefix.startsWith(candidate));
  }

  private async loadMargVoucherContexts(
    tenantId: string,
    staged: Array<{ companyId: number; voucher: string | null | undefined }>,
  ): Promise<Map<string, MargVoucherContext[]>> {
    const companyIds = Array.from(
      new Set(
        staged
          .map((row) => row.companyId)
          .filter((companyId) => Number.isInteger(companyId) && companyId > 0),
      ),
    );
    const vouchers = Array.from(
      new Set(
        staged
          .map((row) => String(row.voucher || '').trim())
          .filter(Boolean),
      ),
    );
    const contextMap = new Map<string, MargVoucherContext[]>();

    if (companyIds.length === 0 || vouchers.length === 0) {
      return contextMap;
    }

    const vouchersInScope = await this.margPrisma.margVoucher.findMany({
      where: {
        tenantId,
        companyId: { in: companyIds },
        voucher: { in: vouchers },
      },
      select: {
        companyId: true,
        voucher: true,
        type: true,
        vcn: true,
        addField: true,
      },
    });

    for (const voucher of vouchersInScope) {
      const key = this.buildMargVoucherLookupKey(voucher.companyId, voucher.voucher);
      const existing = contextMap.get(key) ?? [];
      existing.push({
        companyId: voucher.companyId,
        voucher: voucher.voucher,
        type: voucher.type,
        vcn: voucher.vcn,
        addField: voucher.addField,
      });
      contextMap.set(key, existing);
    }

    return contextMap;
  }

  private selectMargVoucherContextForTransaction(
    transaction: { companyId: number; voucher: string; type: string | null; vcn?: string | null },
    contexts: MargVoucherContext[] | undefined,
  ): MargVoucherContext | null {
    if (!contexts || contexts.length === 0) return null;
    if (contexts.length === 1) return contexts[0];

    const lineType = String(transaction.type || '').trim().toUpperCase();
    const prefix = this.resolveMargVcnPrefix(transaction.vcn ?? null);
    const preferredTypes: string[] = [];

    if (['G', 'S', 'O'].includes(lineType)) {
      preferredTypes.push('S');
    } else if (lineType === 'P') {
      preferredTypes.push('P');
    } else if (lineType === 'R') {
      preferredTypes.push('R');
    } else if (lineType === 'B') {
      preferredTypes.push('B');
    } else if (lineType === 'V') {
      preferredTypes.push('V');
    } else if (lineType === 'D') {
      preferredTypes.push('D');
    } else if (['L', 'W', 'Q'].includes(lineType)) {
      preferredTypes.push('L');
    } else if (lineType === 'X') {
      if (this.matchesMargVcnPrefix(prefix, ['SC'])) {
        preferredTypes.push('T');
      } else if (this.matchesMargVcnPrefix(prefix, ['AD'])) {
        preferredTypes.push('D');
      } else if (this.matchesMargVcnPrefix(prefix, ['PO-'])) {
        preferredTypes.push('X');
      }
      preferredTypes.push('T', 'D', 'X');
    }

    for (const preferredType of preferredTypes) {
      const match = contexts.find((context) => String(context.type || '').trim().toUpperCase() === preferredType);
      if (match) {
        return match;
      }
    }

    return contexts[0];
  }

  private resolveMargType2ProjectionDecision(input: MargType2ProjectionInput): MargType2ProjectionDecision {
    const lineType = String(input.transactionType || '').trim().toUpperCase() || null;
    const headerType = String(input.voucherType || '').trim().toUpperCase() || null;
    const addFieldTag =
      this.extractMargAddFieldLeadToken(input.voucherAddField) ??
      this.extractMargAddFieldLeadToken(input.transactionAddField);
    const vcnPrefix =
      this.resolveMargVcnPrefix(input.voucherVcn) ??
      this.resolveMargVcnPrefix(input.transactionVcn);
    const effectiveQty = Number.isFinite(input.effectiveQty) ? input.effectiveQty : 0;
    const absQty = Math.abs(effectiveQty);
    const numericAmount = input.amount != null ? Number(input.amount) : null;
    const amount = numericAmount != null && Number.isFinite(numericAmount) ? numericAmount : null;
    const absAmount = amount != null ? Math.abs(amount) : null;

    let family: MargType2DocumentFamily = 'UNKNOWN';

    if (headerType === 'S') {
      if (lineType === 'O') {
        family = 'REPLACEMENT_ISSUE';
      } else if (addFieldTag === 'C' || this.matchesMargVcnPrefix(vcnPrefix, ['CHAL'])) {
        family = 'SALES_CHALLAN';
      } else {
        family = 'SALES_INVOICE';
      }
    } else if (headerType === 'P') {
      family = 'PURCHASE_INVOICE';
    } else if (headerType === 'R') {
      family = 'SALES_RETURN';
    } else if (headerType === 'B') {
      family = 'PURCHASE_RETURN';
    } else if (headerType === 'V') {
      family = 'SALES_ORDER';
    } else if (headerType === 'X') {
      family = 'PURCHASE_ORDER';
    } else if (headerType === 'T') {
      family = 'SALES_RETURN_ADJUSTMENT';
    } else if (headerType === 'D') {
      family = 'STOCK_RECEIVE';
    } else if (headerType === 'L') {
      family = 'STOCK_ISSUE';
    }

    if (family === 'UNKNOWN') {
      if (lineType === 'O') {
        family = 'REPLACEMENT_ISSUE';
      } else if (['G', 'S'].includes(lineType || '')) {
        family = addFieldTag === 'C' || this.matchesMargVcnPrefix(vcnPrefix, ['CHAL'])
          ? 'SALES_CHALLAN'
          : 'SALES_INVOICE';
      } else if (lineType === 'P') {
        family = 'PURCHASE_INVOICE';
      } else if (lineType === 'R') {
        family = 'SALES_RETURN';
      } else if (lineType === 'B') {
        family = 'PURCHASE_RETURN';
      } else if (lineType === 'V') {
        family = 'SALES_ORDER';
      } else if (lineType === 'D') {
        family = 'STOCK_RECEIVE';
      } else if (['L', 'W', 'Q'].includes(lineType || '')) {
        family = 'STOCK_ISSUE';
      } else if (lineType === 'X') {
        if (this.matchesMargVcnPrefix(vcnPrefix, ['SC'])) {
          family = 'SALES_RETURN_ADJUSTMENT';
        } else if (this.matchesMargVcnPrefix(vcnPrefix, ['AD'])) {
          family = 'STOCK_RECEIVE';
        } else {
          family = 'PURCHASE_ORDER';
        }
      }
    }

    const baseDecision = {
      family,
      headerType,
      lineType,
      addFieldTag,
      vcnPrefix,
      customerFacing: false,
      supplierFacing: false,
    };

    switch (family) {
      case 'SALES_INVOICE':
        return {
          ...baseDecision,
          shouldProjectActual: true,
          actualType: ActualType.SALES,
          actualQuantity: effectiveQty !== 0 ? effectiveQty : null,
          actualAmount: amount,
          shouldProjectInventory: absQty > 0,
          inventoryTransactionType: absQty > 0 ? InventoryTransactionType.ISSUE : null,
          inventoryQuantity: absQty,
          ledgerEntryType: absQty > 0 ? LedgerEntryType.LEDGER_ISSUE : null,
          ledgerQuantity: absQty > 0 ? -absQty : 0,
          customerFacing: true,
          supplierFacing: false,
        };
      case 'SALES_CHALLAN':
        return {
          ...baseDecision,
          shouldProjectActual: false,
          actualType: null,
          actualQuantity: null,
          actualAmount: null,
          shouldProjectInventory: absQty > 0,
          inventoryTransactionType: absQty > 0 ? InventoryTransactionType.ISSUE : null,
          inventoryQuantity: absQty,
          ledgerEntryType: absQty > 0 ? LedgerEntryType.LEDGER_ISSUE : null,
          ledgerQuantity: absQty > 0 ? -absQty : 0,
          customerFacing: true,
          supplierFacing: false,
        };
      case 'SALES_ORDER':
        return {
          ...baseDecision,
          shouldProjectActual: false,
          actualType: null,
          actualQuantity: null,
          actualAmount: null,
          shouldProjectInventory: false,
          inventoryTransactionType: null,
          inventoryQuantity: 0,
          ledgerEntryType: null,
          ledgerQuantity: 0,
          customerFacing: true,
          supplierFacing: false,
        };
      case 'PURCHASE_INVOICE':
        return {
          ...baseDecision,
          shouldProjectActual: true,
          actualType: ActualType.PURCHASES,
          actualQuantity: effectiveQty !== 0 ? effectiveQty : null,
          actualAmount: amount,
          shouldProjectInventory: absQty > 0,
          inventoryTransactionType: absQty > 0 ? InventoryTransactionType.RECEIPT : null,
          inventoryQuantity: absQty,
          ledgerEntryType: absQty > 0 ? LedgerEntryType.LEDGER_RECEIPT : null,
          ledgerQuantity: absQty > 0 ? absQty : 0,
          customerFacing: false,
          supplierFacing: true,
        };
      case 'PURCHASE_ORDER':
        return {
          ...baseDecision,
          shouldProjectActual: false,
          actualType: null,
          actualQuantity: null,
          actualAmount: null,
          shouldProjectInventory: false,
          inventoryTransactionType: null,
          inventoryQuantity: 0,
          ledgerEntryType: null,
          ledgerQuantity: 0,
          customerFacing: false,
          supplierFacing: true,
        };
      case 'SALES_RETURN':
      case 'SALES_RETURN_ADJUSTMENT':
        return {
          ...baseDecision,
          shouldProjectActual: true,
          actualType: ActualType.SALES,
          actualQuantity: absQty > 0 ? -absQty : null,
          actualAmount: absAmount != null ? -absAmount : null,
          shouldProjectInventory: absQty > 0,
          inventoryTransactionType: absQty > 0 ? InventoryTransactionType.RETURN : null,
          inventoryQuantity: absQty,
          ledgerEntryType: absQty > 0 ? LedgerEntryType.LEDGER_RETURN : null,
          ledgerQuantity: absQty > 0 ? absQty : 0,
          customerFacing: true,
          supplierFacing: false,
        };
      case 'PURCHASE_RETURN':
        return {
          ...baseDecision,
          shouldProjectActual: true,
          actualType: ActualType.PURCHASES,
          actualQuantity: absQty > 0 ? -absQty : null,
          actualAmount: absAmount != null ? -absAmount : null,
          shouldProjectInventory: absQty > 0,
          inventoryTransactionType: absQty > 0 ? InventoryTransactionType.ADJUSTMENT_OUT : null,
          inventoryQuantity: absQty,
          ledgerEntryType: absQty > 0 ? LedgerEntryType.LEDGER_RETURN : null,
          ledgerQuantity: absQty > 0 ? -absQty : 0,
          customerFacing: false,
          supplierFacing: true,
        };
      case 'STOCK_RECEIVE':
        return {
          ...baseDecision,
          shouldProjectActual: true,
          actualType: ActualType.INVENTORY,
          actualQuantity: effectiveQty !== 0 ? effectiveQty : null,
          actualAmount: amount,
          shouldProjectInventory: absQty > 0,
          inventoryTransactionType:
            absQty > 0
              ? (effectiveQty >= 0 ? InventoryTransactionType.ADJUSTMENT_IN : InventoryTransactionType.ADJUSTMENT_OUT)
              : null,
          inventoryQuantity: absQty,
          ledgerEntryType: absQty > 0 ? LedgerEntryType.LEDGER_ADJUSTMENT : null,
          ledgerQuantity: effectiveQty,
          customerFacing: false,
          supplierFacing: false,
        };
      case 'STOCK_ISSUE':
        return {
          ...baseDecision,
          shouldProjectActual: true,
          actualType: ActualType.INVENTORY,
          actualQuantity: effectiveQty !== 0 ? effectiveQty : null,
          actualAmount: amount,
          shouldProjectInventory: absQty > 0,
          inventoryTransactionType:
            absQty > 0
              ? (effectiveQty >= 0 ? InventoryTransactionType.ADJUSTMENT_IN : InventoryTransactionType.SCRAP)
              : null,
          inventoryQuantity: absQty,
          ledgerEntryType:
            absQty > 0
              ? (effectiveQty >= 0 ? LedgerEntryType.LEDGER_ADJUSTMENT : LedgerEntryType.LEDGER_SCRAP)
              : null,
          ledgerQuantity: effectiveQty,
          customerFacing: false,
          supplierFacing: false,
        };
      case 'REPLACEMENT_ISSUE':
        return {
          ...baseDecision,
          shouldProjectActual: false,
          actualType: null,
          actualQuantity: null,
          actualAmount: null,
          shouldProjectInventory: absQty > 0,
          inventoryTransactionType: absQty > 0 ? InventoryTransactionType.ISSUE : null,
          inventoryQuantity: absQty,
          ledgerEntryType: absQty > 0 ? LedgerEntryType.LEDGER_ISSUE : null,
          ledgerQuantity: absQty > 0 ? -absQty : 0,
          customerFacing: true,
          supplierFacing: false,
        };
      default:
        return {
          ...baseDecision,
          shouldProjectActual: false,
          actualType: null,
          actualQuantity: null,
          actualAmount: null,
          shouldProjectInventory: false,
          inventoryTransactionType: null,
          inventoryQuantity: 0,
          ledgerEntryType: null,
          ledgerQuantity: 0,
          customerFacing: false,
          supplierFacing: false,
        };
    }
  }

  private async clearMargActualProjection(tenantId: string, transactionId: string, sourceKey: string): Promise<void> {
    await this.margPrisma.margTransaction.update({
      where: { id: transactionId },
      data: { actualId: null },
    });

    await this.prisma.actual.deleteMany({
      where: {
        tenantId,
        sourceSystem: MARG_SOURCE_SYSTEM,
        sourceReference: sourceKey,
      },
    });
  }

  private async clearMargInventoryTransactionProjection(tenantId: string, sourceKey: string): Promise<void> {
    await this.prisma.inventoryTransaction.deleteMany({
      where: {
        tenantId,
        idempotencyKey: this.buildMargInventoryTransactionIdempotencyKey(sourceKey),
      },
    });
  }

  private async clearMargInventoryLedgerProjection(tenantId: string, sourceKey: string): Promise<void> {
    await this.prisma.inventoryLedger.deleteMany({
      where: {
        tenantId,
        idempotencyKey: this.buildMargInventoryLedgerIdempotencyKey(sourceKey),
      },
    });
  }

  private async resetMargInventoryProjectionWindow(
    tenantId: string,
    dateWindow: DateWindow | null,
  ): Promise<MargInventoryProjectionResetResult> {
    const dateWhere = this.buildDateWhere(dateWindow);
    const ledgerRows = await this.prisma.inventoryLedger.findMany({
      where: {
        tenantId,
        referenceType: MARG_SOURCE_SYSTEM,
        ...(dateWhere ? { transactionDate: dateWhere } : {}),
      },
      select: {
        productId: true,
        locationId: true,
      },
    });

    const affectedLedgerScopes = new Set<string>();
    for (const row of ledgerRows) {
      affectedLedgerScopes.add(this.buildInventoryScopeKey(row.productId, row.locationId));
    }

    await this.margPrisma.margTransaction.updateMany({
      where: {
        tenantId,
        actualId: { not: null },
        ...(dateWhere ? { date: dateWhere } : {}),
      },
      data: { actualId: null },
    });

    await Promise.all([
      this.prisma.actual.deleteMany({
        where: {
          tenantId,
          sourceSystem: MARG_SOURCE_SYSTEM,
          ...(dateWhere ? { periodDate: dateWhere } : {}),
        },
      }),
      this.prisma.inventoryTransaction.deleteMany({
        where: {
          tenantId,
          referenceType: MARG_SOURCE_SYSTEM,
          ...(dateWhere ? { transactionDate: dateWhere } : {}),
        },
      }),
      this.prisma.inventoryLedger.deleteMany({
        where: {
          tenantId,
          referenceType: MARG_SOURCE_SYSTEM,
          ...(dateWhere ? { transactionDate: dateWhere } : {}),
        },
      }),
    ]);

    return { affectedLedgerScopes };
  }

  private async resetMargProcurementProjectionWindow(
    tenantId: string,
    dateWindow: DateWindow | null,
  ): Promise<void> {
    if (!dateWindow) {
      await this.prisma.$transaction([
        this.prisma.goodsReceipt.deleteMany({
          where: {
            tenantId,
            receiptNumber: { startsWith: MARG_GOODS_RECEIPT_PREFIX },
          },
        }),
        this.prisma.purchaseOrder.deleteMany({
          where: {
            tenantId,
            OR: [
              { orderNumber: { startsWith: MARG_PURCHASE_ORDER_PREFIX } },
              { orderNumber: { startsWith: MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX } },
            ],
          },
        }),
      ]);
      return;
    }

    const dateWhere = this.buildDateWhere(dateWindow);
    if (!dateWhere) return;

    const stagedPurchaseInvoices = await this.margPrisma.margVoucher.findMany({
      where: {
        tenantId,
        type: 'P',
        date: dateWhere,
      },
      select: {
        companyId: true,
        voucher: true,
        vcn: true,
        orn: true,
      },
    });

    if (stagedPurchaseInvoices.length === 0) {
      return;
    }

    const receiptNumbers = stagedPurchaseInvoices.map((voucher) =>
      this.buildMargGoodsReceiptNumber(voucher.companyId, voucher.voucher),
    );
    const affectedReceipts = await this.prisma.goodsReceipt.findMany({
      where: {
        tenantId,
        receiptNumber: { in: receiptNumbers },
      },
      select: {
        purchaseOrderId: true,
      },
    });

    await this.prisma.goodsReceipt.deleteMany({
      where: {
        tenantId,
        receiptNumber: { in: receiptNumbers },
      },
    });

    const affectedPurchaseOrderIds = Array.from(
      new Set(
        affectedReceipts
          .map((receipt) => receipt.purchaseOrderId)
          .filter((purchaseOrderId): purchaseOrderId is string => Boolean(purchaseOrderId)),
      ),
    );

    for (const purchaseOrderId of affectedPurchaseOrderIds) {
      const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        select: {
          id: true,
          orderNumber: true,
          receipts: {
            take: 1,
            select: { id: true },
          },
        },
      });

      if (!purchaseOrder) {
        continue;
      }

      if (
        purchaseOrder.orderNumber.startsWith(MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX)
        && purchaseOrder.receipts.length === 0
      ) {
        await this.prisma.purchaseOrder.delete({
          where: { id: purchaseOrderId },
        });
        continue;
      }

      await this.recalculateMargPurchaseOrderReceiptState(purchaseOrderId);
    }
  }

  private async transformMargProcurementDocuments(
    tenantId: string,
    dateWindow: DateWindow | null,
    projectionWindowReset = false,
  ): Promise<void> {
    const systemUserId = await this.resolveMargSystemUserId(tenantId);
    if (!systemUserId) {
      this.logger.warn('No user found for tenant — skipping Marg procurement document projection');
      return;
    }

    if (projectionWindowReset) {
      await this.resetMargProcurementProjectionWindow(tenantId, dateWindow);
    }

    const productIdCache = new Map<string, string | null>();
    const supplierIdCache = new Map<string, string | null>();
    const locationIdCache = new Map<number, string | null>();
    const batchIdCache = new Map<string, string | null>();
    const purchaseOrderIdsByOrderNumber = new Map<string, string>();
    const fallbackPurchaseOrderDrafts = new Map<string, {
      companyId: number;
      orderNumber: string;
      supplierId: string;
      locationId: string;
      orderDate: Date;
      orderDateKnown: boolean;
      totalAmount: number;
      sampleVoucher: string;
      sampleVcn: string | null;
      sampleOrn: string | null;
      linesByProductId: Map<string, {
        productId: string;
        quantity: number;
        totalValue: number;
      }>;
    }>();
    const goodsReceiptDrafts: Array<{
      receiptNumber: string;
      purchaseOrderId: string | null;
      purchaseOrderOrderNumber: string | null;
      obsoleteFallbackOrderNumber: string | null;
      locationId: string;
      receiptDate: Date;
      notes: string;
      lines: Array<{
        lineNumber: number;
        productId: string;
        quantity: number;
        uom: string;
        lotNumber: string | null;
        batchId: string | null;
      }>;
    }> = [];

    const getProductId = async (companyId: number, pid: string | null): Promise<string | null> => {
      if (!pid) return null;
      const cacheKey = `${companyId}:${pid}`;
      if (!productIdCache.has(cacheKey)) {
        productIdCache.set(cacheKey, await this.resolveProductId(tenantId, companyId, pid));
      }
      return productIdCache.get(cacheKey) ?? null;
    };

    const getSupplierId = async (companyId: number, cid: string | null): Promise<string | null> => {
      if (!cid) return null;
      const cacheKey = `${companyId}:${cid}`;
      if (!supplierIdCache.has(cacheKey)) {
        supplierIdCache.set(cacheKey, await this.resolveSupplierId(tenantId, companyId, cid));
      }
      return supplierIdCache.get(cacheKey) ?? null;
    };

    const getLocationId = async (companyId: number): Promise<string | null> => {
      if (!locationIdCache.has(companyId)) {
        locationIdCache.set(companyId, await this.resolveLocationId(tenantId, companyId));
      }
      return locationIdCache.get(companyId) ?? null;
    };

    const getBatchId = async (
      productId: string,
      locationId: string,
      batchNumber: string | null,
    ): Promise<string | null> => {
      if (!batchNumber) return null;
      const cacheKey = `${productId}:${locationId}:${batchNumber}`;
      if (!batchIdCache.has(cacheKey)) {
        batchIdCache.set(cacheKey, await this.resolveBatchId(tenantId, productId, locationId, batchNumber));
      }
      return batchIdCache.get(cacheKey) ?? null;
    };

    let purchaseOrderCursor: string | null = null;
    while (true) {
      const stagedPurchaseOrders = await this.margPrisma.margVoucher.findMany({
        where: {
          tenantId,
          type: 'X',
          ...(dateWindow ? { date: this.buildDateWhere(dateWindow)! } : {}),
          ...(purchaseOrderCursor ? { id: { gt: purchaseOrderCursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
        select: {
          id: true,
          companyId: true,
          voucher: true,
          vcn: true,
          cid: true,
          date: true,
          orn: true,
          finalAmt: true,
        },
      });

      if (stagedPurchaseOrders.length === 0) break;

      const lineMap = await this.loadMargProcurementVoucherLines(
        tenantId,
        stagedPurchaseOrders.map((voucher) => ({
          companyId: voucher.companyId,
          voucher: voucher.voucher,
          type: 'X',
        })),
      );

      for (const voucher of stagedPurchaseOrders) {
        const supplierId = await getSupplierId(voucher.companyId, voucher.cid);
        const locationId = await getLocationId(voucher.companyId);
        if (!supplierId || !locationId) continue;

        const orderNumber = this.buildMargPurchaseOrderNumber(
          voucher.companyId,
          this.resolveMargPurchaseOrderDocumentNumber(voucher.orn, voucher.vcn, voucher.voucher),
          voucher.voucher,
        );
        const orderDate = voucher.date;
        const lineRows = lineMap.get(this.buildMargProcurementVoucherLookupKey(voucher.companyId, voucher.voucher, 'X')) ?? [];
        const purchaseOrderLines: Array<{
          lineNumber: number;
          productId: string;
          quantity: number;
          unitPrice: number;
          uom: string;
          expectedDate: Date;
        }> = [];

        for (const line of lineRows) {
          const effectiveQty = Math.abs(this.resolveMargEffectiveQuantity(line.qty, line.free));
          if (!line.pid || effectiveQty <= 0) continue;

          const productId = await getProductId(line.companyId, line.pid);
          if (!productId) continue;

          purchaseOrderLines.push({
            lineNumber: purchaseOrderLines.length + 1,
            productId,
            quantity: effectiveQty,
            unitPrice: this.resolveMargProcurementUnitPrice(line.rate, line.amount, effectiveQty),
            uom: 'PCS',
            expectedDate: orderDate,
          });
        }

        const purchaseOrderId = await this.upsertMargPurchaseOrder({
          tenantId,
          orderNumber,
          supplierId,
          locationId,
          createdById: systemUserId,
          orderDate,
          expectedDate: orderDate,
          totalAmount: this.resolveMargProcurementDocumentTotal(voucher.finalAmt, purchaseOrderLines),
          notes: this.buildMargPurchaseOrderNotes({
            companyId: voucher.companyId,
            voucher: voucher.voucher,
            vcn: voucher.vcn,
            orn: voucher.orn,
            fallbackFromInvoice: false,
            orderDateKnown: true,
            expectedDateKnown: false,
          }),
          lines: purchaseOrderLines,
        });

        purchaseOrderIdsByOrderNumber.set(orderNumber, purchaseOrderId);

        await this.recalculateMargPurchaseOrderReceiptState(purchaseOrderId);
      }

      purchaseOrderCursor = stagedPurchaseOrders[stagedPurchaseOrders.length - 1].id;
    }

    let purchaseInvoiceCursor: string | null = null;
    while (true) {
      const stagedPurchaseInvoices = await this.margPrisma.margVoucher.findMany({
        where: {
          tenantId,
          type: 'P',
          ...(dateWindow ? { date: this.buildDateWhere(dateWindow)! } : {}),
          ...(purchaseInvoiceCursor ? { id: { gt: purchaseInvoiceCursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
        select: {
          id: true,
          companyId: true,
          voucher: true,
          vcn: true,
          cid: true,
          date: true,
          oDate: true,
          orn: true,
          finalAmt: true,
        },
      });

      if (stagedPurchaseInvoices.length === 0) break;

      const lineMap = await this.loadMargProcurementVoucherLines(
        tenantId,
        stagedPurchaseInvoices.map((voucher) => ({
          companyId: voucher.companyId,
          voucher: voucher.voucher,
          type: 'P',
        })),
      );

      for (const voucher of stagedPurchaseInvoices) {
        const supplierId = await getSupplierId(voucher.companyId, voucher.cid);
        const locationId = await getLocationId(voucher.companyId);
        if (!supplierId || !locationId) continue;

        const linkedPurchaseOrderDocumentNumber = this.resolveMargLinkedPurchaseOrderDocumentNumber(voucher.orn);
        const directPurchaseOrderNumber = linkedPurchaseOrderDocumentNumber
          ? this.buildMargPurchaseOrderNumber(voucher.companyId, linkedPurchaseOrderDocumentNumber, voucher.voucher)
          : null;

        let purchaseOrderId = directPurchaseOrderNumber
          ? purchaseOrderIdsByOrderNumber.get(directPurchaseOrderNumber) ?? null
          : null;

        if (!purchaseOrderId && directPurchaseOrderNumber) {
          purchaseOrderId = (await this.prisma.purchaseOrder.findUnique({
            where: {
              tenantId_orderNumber: {
                tenantId,
                orderNumber: directPurchaseOrderNumber,
              },
            },
            select: { id: true },
          }))?.id ?? null;

          if (purchaseOrderId) {
            purchaseOrderIdsByOrderNumber.set(directPurchaseOrderNumber, purchaseOrderId);
          }
        }

        const fallbackOrderNumber = this.buildMargFallbackPurchaseOrderNumber(
          voucher.companyId,
          linkedPurchaseOrderDocumentNumber,
          voucher.voucher,
          voucher.vcn,
        );
        const validOrderDate = this.normalizeValidMargBusinessDate(voucher.oDate);
        const invoiceDate = voucher.date;
        const receiptLineRows = lineMap.get(this.buildMargProcurementVoucherLookupKey(voucher.companyId, voucher.voucher, 'P')) ?? [];
        const goodsReceiptLines: Array<{
          lineNumber: number;
          productId: string;
          quantity: number;
          uom: string;
          lotNumber: string | null;
          batchId: string | null;
        }> = [];
        const invoiceFallbackLines: Array<{
          productId: string;
          quantity: number;
          totalValue: number;
        }> = [];

        for (const line of receiptLineRows) {
          const effectiveQty = Math.abs(this.resolveMargEffectiveQuantity(line.qty, line.free));
          if (!line.pid || effectiveQty <= 0) continue;

          const productId = await getProductId(line.companyId, line.pid);
          if (!productId) continue;

          const batchNumber = this.normalizeOptionalText(line.batch, 50);
          const batchId = batchNumber ? await getBatchId(productId, locationId, batchNumber) : null;
          const unitPrice = this.resolveMargProcurementUnitPrice(line.rate, line.amount, effectiveQty);

          goodsReceiptLines.push({
            lineNumber: goodsReceiptLines.length + 1,
            productId,
            quantity: effectiveQty,
            uom: 'PCS',
            lotNumber: batchNumber,
            batchId,
          });

          invoiceFallbackLines.push({
            productId,
            quantity: effectiveQty,
            totalValue: unitPrice * effectiveQty,
          });
        }

        if (!purchaseOrderId) {
          const fallbackDraft = fallbackPurchaseOrderDrafts.get(fallbackOrderNumber) ?? {
            companyId: voucher.companyId,
            orderNumber: fallbackOrderNumber,
            supplierId,
            locationId,
            orderDate: validOrderDate ?? invoiceDate,
            orderDateKnown: Boolean(validOrderDate),
            totalAmount: 0,
            sampleVoucher: voucher.voucher,
            sampleVcn: voucher.vcn,
            sampleOrn: voucher.orn,
            linesByProductId: new Map<string, { productId: string; quantity: number; totalValue: number }>(),
          };

          if (validOrderDate) {
            if (!fallbackDraft.orderDateKnown || validOrderDate < fallbackDraft.orderDate) {
              fallbackDraft.orderDate = validOrderDate;
            }
            fallbackDraft.orderDateKnown = true;
          } else if (!fallbackDraft.orderDateKnown && invoiceDate < fallbackDraft.orderDate) {
            fallbackDraft.orderDate = invoiceDate;
          }

          fallbackDraft.totalAmount += this.resolveMargProcurementDocumentTotal(voucher.finalAmt, invoiceFallbackLines.map((line) => ({
            quantity: line.quantity,
            unitPrice: line.quantity > 0 ? line.totalValue / line.quantity : 0,
          })));

          for (const line of invoiceFallbackLines) {
            const existingLine = fallbackDraft.linesByProductId.get(line.productId);
            if (existingLine) {
              existingLine.quantity += line.quantity;
              existingLine.totalValue += line.totalValue;
            } else {
              fallbackDraft.linesByProductId.set(line.productId, {
                productId: line.productId,
                quantity: line.quantity,
                totalValue: line.totalValue,
              });
            }
          }

          fallbackPurchaseOrderDrafts.set(fallbackOrderNumber, fallbackDraft);
        }

        goodsReceiptDrafts.push({
          receiptNumber: this.buildMargGoodsReceiptNumber(voucher.companyId, voucher.voucher),
          purchaseOrderId,
          purchaseOrderOrderNumber: purchaseOrderId ? null : fallbackOrderNumber,
          obsoleteFallbackOrderNumber: purchaseOrderId ? fallbackOrderNumber : null,
          locationId,
          receiptDate: invoiceDate,
          notes: this.buildMargGoodsReceiptNotes({
            companyId: voucher.companyId,
            voucher: voucher.voucher,
            vcn: voucher.vcn,
            orn: voucher.orn,
          }),
          lines: goodsReceiptLines,
        });
      }

      purchaseInvoiceCursor = stagedPurchaseInvoices[stagedPurchaseInvoices.length - 1].id;
    }

    for (const fallbackDraft of fallbackPurchaseOrderDrafts.values()) {
      const aggregatedLines = Array.from(fallbackDraft.linesByProductId.values())
        .sort((left, right) => left.productId.localeCompare(right.productId))
        .map((line, index) => ({
          lineNumber: index + 1,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.quantity > 0 ? line.totalValue / line.quantity : 0,
          uom: 'PCS',
          expectedDate: fallbackDraft.orderDate,
        }));

      const fallbackPurchaseOrderId = await this.upsertMargPurchaseOrder({
        tenantId,
        orderNumber: fallbackDraft.orderNumber,
        supplierId: fallbackDraft.supplierId,
        locationId: fallbackDraft.locationId,
        createdById: systemUserId,
        orderDate: fallbackDraft.orderDate,
        expectedDate: fallbackDraft.orderDate,
        totalAmount: fallbackDraft.totalAmount,
        notes: this.buildMargPurchaseOrderNotes({
          companyId: fallbackDraft.companyId,
          voucher: fallbackDraft.sampleVoucher,
          vcn: fallbackDraft.sampleVcn,
          orn: fallbackDraft.sampleOrn,
          fallbackFromInvoice: true,
          orderDateKnown: fallbackDraft.orderDateKnown,
          expectedDateKnown: false,
        }),
        lines: aggregatedLines,
      });

      purchaseOrderIdsByOrderNumber.set(fallbackDraft.orderNumber, fallbackPurchaseOrderId);
    }

    for (const receiptDraft of goodsReceiptDrafts) {
      const purchaseOrderId = receiptDraft.purchaseOrderId
        ?? (receiptDraft.purchaseOrderOrderNumber
          ? purchaseOrderIdsByOrderNumber.get(receiptDraft.purchaseOrderOrderNumber) ?? null
          : null);
      if (!purchaseOrderId) continue;

      const existingReceipt = await this.prisma.goodsReceipt.findUnique({
        where: {
          tenantId_receiptNumber: {
            tenantId,
            receiptNumber: receiptDraft.receiptNumber,
          },
        },
        select: {
          purchaseOrderId: true,
        },
      });

      await this.upsertMargGoodsReceipt({
        tenantId,
        receiptNumber: receiptDraft.receiptNumber,
        purchaseOrderId,
        locationId: receiptDraft.locationId,
        receiptDate: receiptDraft.receiptDate,
        receivedById: systemUserId,
        notes: receiptDraft.notes,
        lines: receiptDraft.lines,
      });

      if (existingReceipt?.purchaseOrderId && existingReceipt.purchaseOrderId !== purchaseOrderId) {
        await this.recalculateMargPurchaseOrderReceiptState(existingReceipt.purchaseOrderId);
      }

      await this.recalculateMargPurchaseOrderReceiptState(purchaseOrderId);

      if (receiptDraft.purchaseOrderOrderNumber) {
        await this.cleanupUnusedMargFallbackPurchaseOrder(tenantId, receiptDraft.purchaseOrderOrderNumber);
      }

      if (receiptDraft.obsoleteFallbackOrderNumber) {
        await this.cleanupUnusedMargFallbackPurchaseOrder(tenantId, receiptDraft.obsoleteFallbackOrderNumber);
      }
    }
  }

  /** Resolve or create a core Product for a Marg PID */
  private async resolveProductId(tenantId: string, companyId: number, pid: string): Promise<string | null> {
    if (!pid) return null;

    // 1) Try staged product → core product link
    const margProduct = await this.margPrisma.margProduct.findFirst({
      where: { tenantId, companyId, pid },
      select: {
        productId: true,
        name: true,
        unit: true,
        code: true,
        pid: true,
        companyId: true,
        gCode: true,
        gCode3: true,
        gCode5: true,
        gCode6: true,
        gst: true,
      },
    });
    if (margProduct?.productId) return margProduct.productId;

    if (!margProduct) {
      this.logger.warn(
        `Marg product mapping missing during transform: tenant=${tenantId}, companyId=${companyId}, pid=${pid}`,
      );
      return null;
    }

    // 2) Build the same product code that `transformProducts` would use, so both
    //    paths converge on a single Product row. Previously this fell back to
    //    `MARG-{pid}` while `transformProducts` used `MARG-{code}`, which split
    //    inventory across two duplicate Product records (e.g. MARG-1003232
    //    vs MARG-A00002 for the same item).
    const margCode = String(margProduct?.code || '').trim();
    const code = (margCode ? `MARG-${margCode}` : `MARG-${pid}`).substring(0, 50);
    const productData = this.buildMargProductProjectionData(margProduct, code);
    const product = await this.prisma.product.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: {
        tenantId,
        code,
        ...productData.create,
      } as Prisma.ProductUncheckedCreateInput,
      update: productData.update as Prisma.ProductUncheckedUpdateInput,
    });

    // Back-link the staged product if it exists. We also adopt any inventory
    // that was previously written against the legacy `MARG-{pid}` placeholder
    // code so a subsequent transform run recovers split stock without manual
    // reconciliation.
    await this.margPrisma.margProduct.updateMany({
      where: { tenantId, companyId, pid, productId: null },
      data: { productId: product.id },
    });

    if (margCode) {
      await this.mergeMargLegacyPidProduct(tenantId, pid, product.id);
    }

    return product.id;
  }

  /**
   * Migrate inventory data away from a legacy `MARG-{pid}` Product that was
   * created before the Marg product master row was synced, onto the canonical
   * `MARG-{code}` Product. Idempotent — safe to call repeatedly. Without this,
   * stock totals appear split (the `MARG-{pid}` row keeps a stale balance the
   * UI never re-aggregates) when a sync's stock page lands before its product
   * page.
   */
  private async mergeMargLegacyPidProduct(tenantId: string, pid: string, canonicalProductId: string): Promise<void> {
    const legacyCode = `MARG-${pid}`.substring(0, 50);
    const legacy = await this.prisma.product.findUnique({
      where: { tenantId_code: { tenantId, code: legacyCode } },
      select: { id: true },
    });
    if (!legacy || legacy.id === canonicalProductId) return;

    // Re-point dependent rows to the canonical product. We use `updateMany`
    // with conflict avoidance (skipping rows where the canonical already has a
    // value) so we never violate composite uniques on inventory_levels /
    // batches.
    await this.prisma.inventoryLevel.deleteMany({
      where: { tenantId, productId: legacy.id },
    });
    await this.prisma.batch.updateMany({
      where: { tenantId, productId: legacy.id },
      data: { productId: canonicalProductId },
    }).catch(() => {/* batch unique conflicts get swept on next sync */});
    await this.prisma.actual.updateMany({
      where: { tenantId, productId: legacy.id },
      data: { productId: canonicalProductId },
    });
    await this.prisma.inventoryTransaction.updateMany({
      where: { tenantId, productId: legacy.id },
      data: { productId: canonicalProductId },
    });
    await this.prisma.inventoryLedger.updateMany({
      where: { tenantId, productId: legacy.id },
      data: { productId: canonicalProductId },
    });
  }

  /** Resolve or create a core Customer for a Marg CID */
  private async resolveCustomerId(tenantId: string, companyId: number, cid: string): Promise<string | null> {
    if (!cid) return null;

    // 1) Try staged party → core customer link
    const margParty = await this.margPrisma.margParty.findFirst({
      where: { tenantId, companyId, cid },
      select: {
        customerId: true,
        parName: true,
        area: true,
        gstNo: true,
        phone1: true,
        phone2: true,
        phone3: true,
        phone4: true,
        parAddr: true,
        parAdd1: true,
        parAdd2: true,
        route: true,
        credit: true,
        crDays: true,
        isDeleted: true,
        cid: true,
      },
    });
    if (margParty && !this.isProjectableCustomerParty(margParty)) {
      return null;
    }
    if (margParty?.customerId) return margParty.customerId;

    // 2) Create or find a core customer directly from the CID
    const code = `MARG-${cid}`.substring(0, 50);
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: {
        tenantId,
        code,
        name: margParty?.parName || `Marg Customer ${cid}`,
        type: CustomerType.DIRECT,
        region: margParty?.area || undefined,
        status: DimensionStatus.ACTIVE,
        externalId: `marg:${companyId}:${cid}`,
        attributes: { margCid: cid, margCompanyId: companyId },
      },
      update: {},
    });

    // Back-link the staged party if it exists
    if (margParty) {
      await this.margPrisma.margParty.updateMany({
        where: { tenantId, companyId, cid, customerId: null },
        data: { customerId: customer.id },
      });
    }

    return customer.id;
  }

  private async resolveSupplierId(tenantId: string, companyId: number, cid: string): Promise<string | null> {
    if (!cid) return null;

    const externalId = `marg:${companyId}:${cid}`;
    const existing = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id
        FROM suppliers
        WHERE tenant_id = ${tenantId}::uuid
          AND (
            external_id = ${externalId}
            OR (
              COALESCE(attributes->>'margCid', '') = ${cid}
              AND (
                COALESCE(attributes->>'margCompanyId', '') = ''
                OR COALESCE(attributes->>'margCompanyId', '') = ${String(companyId)}
              )
            )
          )
        ORDER BY
          CASE WHEN external_id = ${externalId} THEN 1 ELSE 2 END,
          created_at ASC
        LIMIT 1
      `,
    );

    if (existing[0]?.id) {
      return existing[0].id;
    }

    const party = await this.margPrisma.margParty.findFirst({
      where: { tenantId, companyId, cid },
      select: {
        cid: true,
        parName: true,
        parAddr: true,
        parAdd1: true,
        parAdd2: true,
        gstNo: true,
        phone1: true,
        phone2: true,
        route: true,
        area: true,
        credit: true,
        crDays: true,
        dlNo: true,
        pin: true,
        isDeleted: true,
      },
    });

    if (party && !this.isProjectableSupplierParty(party)) {
      return null;
    }

    const supplierCode = `MARG-SUP-${companyId}-${cid}`.substring(0, 50);
    const supplier = await this.prisma.supplier.upsert({
      where: { tenantId_code: { tenantId, code: supplierCode } },
      create: {
        tenantId,
        code: supplierCode,
        name: party?.parName || `Marg Supplier ${cid}`,
        phone: party?.phone1 || party?.phone2 || null,
        address: this.buildMargPartyAddress(party),
        paymentTerms: party?.crDays ? `NET ${party.crDays}` : null,
        currency: 'INR',
        status: DimensionStatus.ACTIVE,
        externalId,
        attributes: {
          margCid: cid,
          margCompanyId: companyId,
          margSource: 'PURCHASE',
          gstn: party?.gstNo ?? null,
          route: party?.route ?? null,
          area: party?.area ?? null,
          pin: party?.pin ?? null,
          dlNo: party?.dlNo ?? null,
        },
      },
      update: {
        name: party?.parName || `Marg Supplier ${cid}`,
        phone: party?.phone1 || party?.phone2 || null,
        address: this.buildMargPartyAddress(party),
        paymentTerms: party?.crDays ? `NET ${party.crDays}` : null,
        currency: 'INR',
        externalId,
      },
      select: { id: true },
    });

    return supplier.id;
  }

  private async resolveMargSystemUserId(tenantId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { tenantId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    return user?.id ?? null;
  }

  private buildMargProcurementVoucherLookupKey(
    companyId: number,
    voucher: string | null | undefined,
    type: string | null | undefined,
  ): string {
    return `${companyId}|${String(voucher || '').trim()}|${String(type || '').trim().toUpperCase()}`;
  }

  private async loadMargProcurementVoucherLines(
    tenantId: string,
    vouchers: Array<{ companyId: number; voucher: string; type: string }>,
  ): Promise<
    Map<
      string,
      Array<{
        companyId: number;
        voucher: string;
        type: string;
        pid: string | null;
        qty: Prisma.Decimal | null;
        free: Prisma.Decimal | null;
        rate: Prisma.Decimal | null;
        amount: Prisma.Decimal | null;
        batch: string | null;
      }>
    >
  > {
    const lineMap = new Map<
      string,
      Array<{
        companyId: number;
        voucher: string;
        type: string;
        pid: string | null;
        qty: Prisma.Decimal | null;
        free: Prisma.Decimal | null;
        rate: Prisma.Decimal | null;
        amount: Prisma.Decimal | null;
        batch: string | null;
      }>
    >();

    if (vouchers.length === 0) {
      return lineMap;
    }

    const rows = await this.margPrisma.margTransaction.findMany({
      where: {
        tenantId,
        OR: vouchers.map((voucher) => ({
          companyId: voucher.companyId,
          voucher: voucher.voucher,
          type: voucher.type,
        })),
      },
      orderBy: [{ companyId: 'asc' }, { voucher: 'asc' }, { id: 'asc' }],
      select: {
        companyId: true,
        voucher: true,
        type: true,
        pid: true,
        qty: true,
        free: true,
        rate: true,
        amount: true,
        batch: true,
      },
    });

    for (const row of rows) {
      const key = this.buildMargProcurementVoucherLookupKey(row.companyId, row.voucher, row.type);
      const existing = lineMap.get(key) ?? [];
      existing.push(row);
      lineMap.set(key, existing);
    }

    return lineMap;
  }

  private resolveMargPurchaseOrderDocumentNumber(
    orn: string | null | undefined,
    vcn: string | null | undefined,
    voucher: string | null | undefined,
  ): string {
    return this.normalizeOptionalText(orn, 50)
      || this.normalizeOptionalText(vcn, 50)
      || this.normalizeOptionalText(voucher, 50)
      || 'UNKNOWN';
  }

  private resolveMargLinkedPurchaseOrderDocumentNumber(orn: string | null | undefined): string | null {
    return this.normalizeOptionalText(orn, 50);
  }

  private normalizeValidMargBusinessDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() <= 1901) {
      return null;
    }

    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  private sanitizeMargProcurementIdentifier(value: string | null | undefined, maxLength: number): string {
    const normalized = this.normalizeMargDocumentNumber(value)
      || this.normalizeMargCode(value, maxLength)
      || 'UNKNOWN';

    const sanitized = normalized
      .replace(/[^A-Z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return (sanitized || 'UNKNOWN').substring(0, maxLength);
  }

  private buildMargPurchaseOrderNumber(
    companyId: number,
    documentNumber: string | null | undefined,
    fallbackVoucher: string | null | undefined,
  ): string {
    const documentPart = this.sanitizeMargProcurementIdentifier(documentNumber || fallbackVoucher, 30);
    return `${MARG_PURCHASE_ORDER_PREFIX}${companyId}-${documentPart}`.slice(0, 50);
  }

  private buildMargFallbackPurchaseOrderNumber(
    companyId: number,
    linkedPurchaseOrderDocumentNumber: string | null | undefined,
    voucher: string | null | undefined,
    vcn: string | null | undefined,
  ): string {
    const linkedOrderPart = this.sanitizeMargProcurementIdentifier(linkedPurchaseOrderDocumentNumber, 30);
    if (linkedOrderPart && linkedOrderPart !== 'UNKNOWN') {
      return `${MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX}${companyId}-${linkedOrderPart}`.slice(0, 50);
    }

    const invoicePart = this.sanitizeMargProcurementIdentifier(vcn || voucher, 18);
    const voucherPart = this.sanitizeMargProcurementIdentifier(voucher, 16);
    return `${MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX}${companyId}-${invoicePart}-${voucherPart}`.slice(0, 50);
  }

  private buildMargGoodsReceiptNumber(companyId: number, voucher: string | null | undefined): string {
    const voucherPart = this.sanitizeMargProcurementIdentifier(voucher, 28);
    return `${MARG_GOODS_RECEIPT_PREFIX}${companyId}-${voucherPart}`.slice(0, 50);
  }

  private resolveMargProcurementUnitPrice(
    rate: Prisma.Decimal | number | null | undefined,
    amount: Prisma.Decimal | number | null | undefined,
    quantity: number,
  ): number {
    const numericRate = rate != null ? Number(rate) : null;
    if (numericRate != null && Number.isFinite(numericRate) && numericRate !== 0) {
      return Math.abs(numericRate);
    }

    const numericAmount = amount != null ? Number(amount) : null;
    if (numericAmount != null && Number.isFinite(numericAmount) && quantity > 0) {
      return Math.abs(numericAmount) / quantity;
    }

    return 0;
  }

  private resolveMargProcurementDocumentTotal(
    headerAmount: Prisma.Decimal | number | null | undefined,
    lines: Array<{ quantity: number; unitPrice: number }>,
  ): number {
    const numericHeaderAmount = headerAmount != null ? Number(headerAmount) : null;
    if (numericHeaderAmount != null && Number.isFinite(numericHeaderAmount)) {
      return Math.abs(numericHeaderAmount);
    }

    return lines.reduce((total, line) => total + (line.quantity * line.unitPrice), 0);
  }

  private buildMargPurchaseOrderNotes(input: {
    companyId: number;
    voucher: string;
    vcn: string | null | undefined;
    orn: string | null | undefined;
    fallbackFromInvoice: boolean;
    orderDateKnown: boolean;
    expectedDateKnown: boolean;
  }): string {
    const markers = [
      input.fallbackFromInvoice ? MARG_SYNC_FALLBACK_PURCHASE_ORDER_MARKER : MARG_SYNC_PURCHASE_ORDER_MARKER,
      input.expectedDateKnown ? null : MARG_EXPECTED_DATE_UNKNOWN_MARKER,
      input.orderDateKnown ? null : MARG_ORDER_DATE_UNKNOWN_MARKER,
    ].filter(Boolean);

    const details = [
      `company=${input.companyId}`,
      `voucher=${this.normalizeOptionalText(input.voucher, 50)}`,
      input.vcn ? `vcn=${this.normalizeOptionalText(input.vcn, 50)}` : null,
      input.orn ? `orn=${this.normalizeOptionalText(input.orn, 50)}` : null,
    ].filter(Boolean);

    return [...markers, ...details].join(' ');
  }

  private buildMargGoodsReceiptNotes(input: {
    companyId: number;
    voucher: string;
    vcn: string | null | undefined;
    orn: string | null | undefined;
  }): string {
    const details = [
      MARG_SYNC_GOODS_RECEIPT_MARKER,
      `company=${input.companyId}`,
      `voucher=${this.normalizeOptionalText(input.voucher, 50)}`,
      input.vcn ? `vcn=${this.normalizeOptionalText(input.vcn, 50)}` : null,
      input.orn ? `orn=${this.normalizeOptionalText(input.orn, 50)}` : null,
    ].filter(Boolean);

    return details.join(' ');
  }

  private async upsertMargPurchaseOrder(input: {
    tenantId: string;
    orderNumber: string;
    supplierId: string;
    locationId: string;
    createdById: string;
    orderDate: Date;
    expectedDate: Date;
    totalAmount: number;
    notes: string;
    lines: Array<{
      lineNumber: number;
      productId: string;
      quantity: number;
      unitPrice: number;
      uom: string;
      expectedDate: Date;
    }>;
  }): Promise<string> {
    const purchaseOrder = await this.prisma.purchaseOrder.upsert({
      where: {
        tenantId_orderNumber: {
          tenantId: input.tenantId,
          orderNumber: input.orderNumber,
        },
      },
      create: {
        tenantId: input.tenantId,
        orderNumber: input.orderNumber,
        supplierId: input.supplierId,
        locationId: input.locationId,
        createdById: input.createdById,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate,
        status: PurchaseOrderStatus.SENT,
        totalAmount: input.totalAmount,
        notes: input.notes,
        currency: 'INR',
      },
      update: {
        supplierId: input.supplierId,
        locationId: input.locationId,
        createdById: input.createdById,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate,
        status: PurchaseOrderStatus.SENT,
        totalAmount: input.totalAmount,
        notes: input.notes,
        currency: 'INR',
      },
      select: { id: true },
    });

    await this.prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: purchaseOrder.id },
    });

    if (input.lines.length > 0) {
      await this.prisma.purchaseOrderLine.createMany({
        data: input.lines.map((line) => ({
          purchaseOrderId: purchaseOrder.id,
          lineNumber: line.lineNumber,
          productId: line.productId,
          quantity: line.quantity,
          receivedQty: 0,
          unitPrice: line.unitPrice,
          uom: line.uom,
          expectedDate: line.expectedDate,
        })),
      });
    }

    return purchaseOrder.id;
  }

  private async upsertMargGoodsReceipt(input: {
    tenantId: string;
    receiptNumber: string;
    purchaseOrderId: string;
    locationId: string;
    receiptDate: Date;
    receivedById: string;
    notes: string;
    lines: Array<{
      lineNumber: number;
      productId: string;
      quantity: number;
      uom: string;
      lotNumber: string | null;
      batchId: string | null;
    }>;
  }): Promise<string> {
    const goodsReceipt = await this.prisma.goodsReceipt.upsert({
      where: {
        tenantId_receiptNumber: {
          tenantId: input.tenantId,
          receiptNumber: input.receiptNumber,
        },
      },
      create: {
        tenantId: input.tenantId,
        receiptNumber: input.receiptNumber,
        purchaseOrderId: input.purchaseOrderId,
        locationId: input.locationId,
        receiptDate: input.receiptDate,
        status: GoodsReceiptStatus.POSTED,
        receivedById: input.receivedById,
        notes: input.notes,
      },
      update: {
        purchaseOrderId: input.purchaseOrderId,
        locationId: input.locationId,
        receiptDate: input.receiptDate,
        status: GoodsReceiptStatus.POSTED,
        receivedById: input.receivedById,
        notes: input.notes,
      },
      select: { id: true },
    });

    await this.prisma.goodsReceiptLine.deleteMany({
      where: { goodsReceiptId: goodsReceipt.id },
    });

    if (input.lines.length > 0) {
      await this.prisma.goodsReceiptLine.createMany({
        data: input.lines.map((line) => ({
          goodsReceiptId: goodsReceipt.id,
          lineNumber: line.lineNumber,
          productId: line.productId,
          quantity: line.quantity,
          uom: line.uom,
          lotNumber: line.lotNumber,
          batchId: line.batchId,
        })),
      });
    }

    return goodsReceipt.id;
  }

  private async recalculateMargPurchaseOrderReceiptState(purchaseOrderId: string): Promise<void> {
    const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        id: true,
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: {
            id: true,
            lineNumber: true,
            productId: true,
            quantity: true,
          },
        },
        receipts: {
          where: { status: GoodsReceiptStatus.POSTED },
          orderBy: { receiptDate: 'asc' },
          select: {
            receiptDate: true,
            lines: {
              select: {
                productId: true,
                quantity: true,
              },
            },
          },
        },
      },
    });

    if (!purchaseOrder) {
      return;
    }

    const receivedByProduct = new Map<string, number>();
    let latestReceiptDate: Date | null = null;
    let totalReceivedQty = 0;

    for (const receipt of purchaseOrder.receipts) {
      latestReceiptDate = receipt.receiptDate;
      for (const line of receipt.lines) {
        const quantity = line.quantity != null ? Number(line.quantity) : 0;
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        receivedByProduct.set(line.productId, (receivedByProduct.get(line.productId) ?? 0) + quantity);
        totalReceivedQty += quantity;
      }
    }

    let totalOrderedQty = 0;
    const lineUpdates: Array<ReturnType<typeof this.prisma.purchaseOrderLine.update>> = [];
    for (const line of purchaseOrder.lines) {
      const orderedQty = line.quantity != null ? Number(line.quantity) : 0;
      totalOrderedQty += orderedQty;

      const remainingReceivedQty = receivedByProduct.get(line.productId) ?? 0;
      const allocatedReceivedQty = Math.max(0, Math.min(orderedQty, remainingReceivedQty));
      receivedByProduct.set(line.productId, Math.max(0, remainingReceivedQty - allocatedReceivedQty));

      lineUpdates.push(this.prisma.purchaseOrderLine.update({
        where: { id: line.id },
        data: { receivedQty: allocatedReceivedQty },
      }));
    }

    const hasReceipts = totalReceivedQty > STOCK_RECONCILIATION_TOLERANCE;
    const nextStatus = !hasReceipts
      ? PurchaseOrderStatus.SENT
      : (totalOrderedQty <= STOCK_RECONCILIATION_TOLERANCE || totalReceivedQty + STOCK_RECONCILIATION_TOLERANCE >= totalOrderedQty)
        ? PurchaseOrderStatus.RECEIVED
        : PurchaseOrderStatus.PARTIALLY_RECEIVED;

    await this.prisma.$transaction([
      ...lineUpdates,
      this.prisma.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          status: nextStatus,
          receivedDate: hasReceipts ? latestReceiptDate : null,
        },
      }),
    ]);
  }

  private async cleanupUnusedMargFallbackPurchaseOrder(tenantId: string, orderNumber: string): Promise<void> {
    if (!orderNumber.startsWith(MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX)) {
      return;
    }

    const fallbackPurchaseOrder = await this.prisma.purchaseOrder.findUnique({
      where: {
        tenantId_orderNumber: {
          tenantId,
          orderNumber,
        },
      },
      select: {
        id: true,
        receipts: {
          take: 1,
          select: { id: true },
        },
      },
    });

    if (!fallbackPurchaseOrder || fallbackPurchaseOrder.receipts.length > 0) {
      return;
    }

    await this.prisma.purchaseOrder.delete({
      where: { id: fallbackPurchaseOrder.id },
    });
  }

  /** Transform staged Marg transactions → Actual records (SALES type) */
  private async transformTransactionsToActuals(
    tenantId: string,
    dateWindow: DateWindow | null,
    projectionWindowReset = false,
  ): Promise<void> {
    // Step A: Re-link orphaned actuals that were created before their product/customer
    await this.relinkOrphanedActuals(tenantId, dateWindow);

    // Step B: Transform new (unlinked) staged transactions
    let cursor: string | null = null;
    const productIdCache = new Map<string, string | null>();
    const customerIdCache = new Map<string, string | null>();
    const locationIdCache = new Map<number, string | null>();

    const getProductId = async (companyId: number, pid: string | null): Promise<string | null> => {
      if (!pid) return null;
      const cacheKey = `${companyId}:${pid}`;
      if (!productIdCache.has(cacheKey)) {
        productIdCache.set(cacheKey, await this.resolveProductId(tenantId, companyId, pid));
      }
      return productIdCache.get(cacheKey) ?? null;
    };

    const getCustomerId = async (companyId: number, cid: string | null): Promise<string | null> => {
      if (!cid) return null;
      const cacheKey = `${companyId}:${cid}`;
      if (!customerIdCache.has(cacheKey)) {
        customerIdCache.set(cacheKey, await this.resolveCustomerId(tenantId, companyId, cid));
      }
      return customerIdCache.get(cacheKey) ?? null;
    };

    const getLocationId = async (companyId: number): Promise<string | null> => {
      if (!locationIdCache.has(companyId)) {
        locationIdCache.set(companyId, await this.resolveLocationId(tenantId, companyId));
      }
      return locationIdCache.get(companyId) ?? null;
    };

    while (true) {
      const staged = await this.margPrisma.margTransaction.findMany({
        where: {
          tenantId,
          amount: { not: null },
          ...(dateWindow ? { date: this.buildDateWhere(dateWindow)! } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (staged.length === 0) break;

      const voucherContexts = await this.loadMargVoucherContexts(
        tenantId,
        staged.map((mt) => ({ companyId: mt.companyId, voucher: mt.voucher })),
      );

      for (const mt of staged) {
        const effectiveQty = this.resolveMargEffectiveQuantity(mt.qty, mt.free);
        const voucherContext = this.selectMargVoucherContextForTransaction(
          mt,
          voucherContexts.get(this.buildMargVoucherLookupKey(mt.companyId, mt.voucher)),
        );
        // Marg's MDis.Final (voucher total) reconciles to Σ(Dis.Amount + Dis.GSTAmount).
        // Project the post-tax line value so report aggregates match the invoice totals
        // the user sees in Marg. Inventory/cost paths still use the raw pre-tax amount.
        const taxInclusiveAmount = this.resolveMargLineTaxInclusiveAmount(mt.amount, mt.gstAmount);
        const decision = this.resolveMargType2ProjectionDecision({
          transactionType: mt.type,
          transactionVcn: mt.vcn,
          transactionAddField: mt.addField,
          voucherType: voucherContext?.type ?? null,
          voucherVcn: voucherContext?.vcn ?? null,
          voucherAddField: voucherContext?.addField ?? null,
          effectiveQty,
          amount: taxInclusiveAmount,
        });

        if (!decision.shouldProjectActual || decision.actualType == null || decision.actualAmount == null || decision.actualAmount === 0) {
          if (!projectionWindowReset) {
            await this.clearMargActualProjection(tenantId, mt.id, mt.sourceKey);
          }
          continue;
        }

        const productId = await getProductId(mt.companyId, mt.pid);
        if (!productId) {
          this.logger.warn(
            `Skipping Marg actual projection because product mapping is unresolved: tenant=${tenantId}, companyId=${mt.companyId}, pid=${mt.pid ?? 'NULL'}, voucher=${mt.voucher}, sourceKey=${mt.sourceKey}, family=${decision.family}`,
          );
          if (!projectionWindowReset) {
            await this.clearMargActualProjection(tenantId, mt.id, mt.sourceKey);
          }
          continue;
        }

        const customerId = decision.customerFacing
          ? await getCustomerId(mt.companyId, mt.cid)
          : null;
        const locationId = await getLocationId(mt.companyId);

        const baseAmount = mt.amount != null ? Number(mt.amount) : null;
        const gstLineAmount = mt.gstAmount != null ? Number(mt.gstAmount) : null;
        const attributes = {
          margVoucher: mt.voucher,
          margVcn: mt.vcn,
          margType: mt.type,
          margHeaderType: decision.headerType,
          margDocumentFamily: decision.family,
          margAddFieldTag: decision.addFieldTag,
          margVcnPrefix: decision.vcnPrefix,
          margCustomerFacing: decision.customerFacing,
          margSupplierFacing: decision.supplierFacing,
          margGst: mt.gst ? Number(mt.gst) : null,
          margGstAmount: gstLineAmount,
          margMrp: mt.mrp ? Number(mt.mrp) : null,
          margRate: mt.rate ? Number(mt.rate) : null,
          margDiscount: mt.discount ? Number(mt.discount) : null,
          margFreeQty: mt.free ? Number(mt.free) : null,
          margBatch: mt.batch,
          margBaseAmount: baseAmount,
          margTaxInclusiveAmount: taxInclusiveAmount,
        };

        const actual = await this.prisma.actual.upsert({
          where: {
            tenantId_sourceSystem_sourceReference: {
              tenantId,
              sourceSystem: MARG_SOURCE_SYSTEM,
              sourceReference: mt.sourceKey,
            },
          },
          create: {
            tenantId,
            actualType: decision.actualType,
            periodDate: mt.date,
            periodType: PeriodType.DAILY,
            productId,
            customerId,
            locationId,
            quantity: decision.actualQuantity != null && decision.actualQuantity !== 0 ? decision.actualQuantity : null,
            amount: decision.actualAmount,
            currency: 'INR',
            sourceSystem: MARG_SOURCE_SYSTEM,
            sourceReference: mt.sourceKey,
            attributes,
          },
          update: {
            actualType: decision.actualType,
            periodDate: mt.date,
            periodType: PeriodType.DAILY,
            productId,
            customerId,
            locationId,
            quantity: decision.actualQuantity != null && decision.actualQuantity !== 0 ? decision.actualQuantity : null,
            amount: decision.actualAmount,
            currency: 'INR',
            attributes,
          },
        });

        await this.margPrisma.margTransaction.update({
          where: { id: mt.id },
          data: { actualId: actual.id },
        });
      }

      cursor = staged[staged.length - 1].id;
    }

    // Step C: Project per-voucher adjustments (round-off, freight, surcharge, etc.)
    // captured in MDis.Final but absent from individual Dis lines, so dashboards match
    // Marg's invoice totals exactly.
    await this.transformVoucherAdjustmentsToActuals(tenantId, dateWindow, projectionWindowReset);
  }

  /** Project the residual (MDis.Final − Σ(Dis.Amount+GST)) per voucher as a single Actual */
  private async transformVoucherAdjustmentsToActuals(
    tenantId: string,
    dateWindow: DateWindow | null,
    projectionWindowReset = false,
  ): Promise<void> {
    let cursor: string | null = null;
    const locationIdCache = new Map<number, string | null>();
    const customerIdCache = new Map<string, string | null>();

    const getLocationId = async (companyId: number): Promise<string | null> => {
      if (!locationIdCache.has(companyId)) {
        locationIdCache.set(companyId, await this.resolveLocationId(tenantId, companyId));
      }
      return locationIdCache.get(companyId) ?? null;
    };

    const getCustomerId = async (companyId: number, cid: string | null): Promise<string | null> => {
      if (!cid) return null;
      const cacheKey = `${companyId}:${cid}`;
      if (!customerIdCache.has(cacheKey)) {
        customerIdCache.set(cacheKey, await this.resolveCustomerId(tenantId, companyId, cid));
      }
      return customerIdCache.get(cacheKey) ?? null;
    };

    while (true) {
      const vouchers = await this.margPrisma.margVoucher.findMany({
        where: {
          tenantId,
          finalAmt: { not: null },
          ...(dateWindow ? { date: this.buildDateWhere(dateWindow)! } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (vouchers.length === 0) break;

      for (const voucher of vouchers) {
        const adjustmentSourceKey = `marg:adj:${voucher.companyId}:${voucher.voucher}:${voucher.type}`;
        const decision = this.resolveMargVoucherActualDecision(voucher.type);
        if (!decision) {
          if (!projectionWindowReset) {
            await this.clearMargAdjustmentActual(tenantId, adjustmentSourceKey);
          }
          continue;
        }

        const finalAmt = voucher.finalAmt != null ? Number(voucher.finalAmt) : 0;
        if (!Number.isFinite(finalAmt) || finalAmt === 0) {
          if (!projectionWindowReset) {
            await this.clearMargAdjustmentActual(tenantId, adjustmentSourceKey);
          }
          continue;
        }

        const lineAggregate = await this.margPrisma.margTransaction.aggregate({
          where: { tenantId, companyId: voucher.companyId, voucher: voucher.voucher },
          _sum: { amount: true, gstAmount: true },
        });
        const lineSum = lineAggregate._sum.amount != null ? Number(lineAggregate._sum.amount) : 0;
        const gstSum = lineAggregate._sum.gstAmount != null ? Number(lineAggregate._sum.gstAmount) : 0;

        // Marg sometimes records Final and Dis lines with opposite sign for returns; use
        // signed deltas so adjustments cancel correctly.
        const expected = lineSum + gstSum;
        const adjustment = finalAmt - expected;
        const adjustmentSigned = decision.signMultiplier * adjustment;

        if (Math.abs(adjustmentSigned) < 0.5) {
          if (!projectionWindowReset) {
            await this.clearMargAdjustmentActual(tenantId, adjustmentSourceKey);
          }
          continue;
        }

        const customerId = decision.customerFacing
          ? await getCustomerId(voucher.companyId, voucher.cid)
          : null;
        const locationId = await getLocationId(voucher.companyId);

        await this.prisma.actual.upsert({
          where: {
            tenantId_sourceSystem_sourceReference: {
              tenantId,
              sourceSystem: MARG_SOURCE_SYSTEM,
              sourceReference: adjustmentSourceKey,
            },
          },
          create: {
            tenantId,
            actualType: decision.actualType,
            periodDate: voucher.date,
            periodType: PeriodType.DAILY,
            productId: null,
            customerId,
            locationId,
            quantity: null,
            amount: adjustmentSigned,
            currency: 'INR',
            sourceSystem: MARG_SOURCE_SYSTEM,
            sourceReference: adjustmentSourceKey,
            attributes: {
              margVoucher: voucher.voucher,
              margVcn: voucher.vcn,
              margType: voucher.type,
              margFinalAmt: finalAmt,
              margLineAmount: lineSum,
              margLineGstAmount: gstSum,
              margAdjustmentReason: 'voucher_total_adjustment',
              margIsAdjustment: true,
            },
          },
          update: {
            actualType: decision.actualType,
            periodDate: voucher.date,
            periodType: PeriodType.DAILY,
            customerId,
            locationId,
            amount: adjustmentSigned,
            currency: 'INR',
            attributes: {
              margVoucher: voucher.voucher,
              margVcn: voucher.vcn,
              margType: voucher.type,
              margFinalAmt: finalAmt,
              margLineAmount: lineSum,
              margLineGstAmount: gstSum,
              margAdjustmentReason: 'voucher_total_adjustment',
              margIsAdjustment: true,
            },
          },
        });
      }

      cursor = vouchers[vouchers.length - 1].id;
    }
  }

  private resolveMargVoucherActualDecision(voucherType: string | null): {
    actualType: ActualType;
    signMultiplier: number;
    customerFacing: boolean;
  } | null {
    const type = String(voucherType || '').trim().toUpperCase();
    switch (type) {
      case 'S':
        return { actualType: ActualType.SALES, signMultiplier: 1, customerFacing: true };
      case 'R':
      case 'T':
        return { actualType: ActualType.SALES, signMultiplier: -1, customerFacing: true };
      case 'P':
        return { actualType: ActualType.PURCHASES, signMultiplier: 1, customerFacing: false };
      case 'B':
        return { actualType: ActualType.PURCHASES, signMultiplier: -1, customerFacing: false };
      default:
        return null;
    }
  }

  private async clearMargAdjustmentActual(tenantId: string, sourceKey: string): Promise<void> {
    await this.prisma.actual.deleteMany({
      where: {
        tenantId,
        sourceSystem: MARG_SOURCE_SYSTEM,
        sourceReference: sourceKey,
      },
    });
  }

  /** Sum line amount + GST while preserving sign and handling null/undefined inputs */
  private resolveMargLineTaxInclusiveAmount(
    amount: Prisma.Decimal | number | null | undefined,
    gstAmount: Prisma.Decimal | number | null | undefined,
  ): number | null {
    if (amount == null) return null;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return null;
    const numericGst = gstAmount != null ? Number(gstAmount) : 0;
    const safeGst = Number.isFinite(numericGst) ? numericGst : 0;
    // GST sign in Marg always matches the line amount sign for returns/refunds.
    // Use signed sum directly; absent or zero-GST rows just pass through unchanged.
    if (safeGst === 0) return numericAmount;
    const sign = numericAmount < 0 ? -1 : 1;
    return numericAmount + sign * Math.abs(safeGst);
  }

  /**
   * Re-link actuals that were created in a previous sync cycle without
   * product/customer associations (the staged product/party may have arrived
   * in a later sync page).
   */
  private async relinkOrphanedActuals(tenantId: string, dateWindow: DateWindow | null = null): Promise<void> {
    let cursor: string | null = null;

    while (true) {
      // Paginated fetch of orphaned actuals to avoid memory pressure
      const orphans = await this.prisma.actual.findMany({
        where: {
          tenantId,
          sourceSystem: 'MARG_EDE',
          OR: [{ productId: null }, { customerId: null }, { locationId: null }],
          ...(dateWindow ? { periodDate: this.buildDateWhere(dateWindow)! } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
        select: { id: true, productId: true, customerId: true, locationId: true, sourceReference: true },
      });

      if (orphans.length === 0) break;

      this.logger.log(`Re-linking batch of ${orphans.length} orphaned Marg EDE actuals`);

      // Build sourceKey → actual mapping
      const sourceKeys = orphans.map((o) => o.sourceReference).filter(Boolean) as string[];
      if (sourceKeys.length > 0) {
        // Look up the staged transactions for the source keys
        const stagedTxns = await this.margPrisma.margTransaction.findMany({
          where: { tenantId, sourceKey: { in: sourceKeys } },
          select: { sourceKey: true, pid: true, cid: true, companyId: true },
        });

        const txnBySourceKey = new Map<string, { sourceKey: string; pid: string; cid: string; companyId: number }>(
          stagedTxns.map((t: any) => [t.sourceKey, t]),
        );

        for (const orphan of orphans) {
          const txn = txnBySourceKey.get(orphan.sourceReference!);
          if (!txn) continue;

          const updates: Record<string, unknown> = {};

          if (!orphan.productId && txn.pid) {
            const productId = await this.resolveProductId(tenantId, txn.companyId, txn.pid);
            if (productId) updates.productId = productId;
          }

          if (!orphan.customerId && txn.cid) {
            const customerId = await this.resolveCustomerId(tenantId, txn.companyId, txn.cid);
            if (customerId) updates.customerId = customerId;
          }

          if (!orphan.locationId) {
            const locationId = await this.resolveLocationId(tenantId, txn.companyId);
            if (locationId) updates.locationId = locationId;
          }

          if (Object.keys(updates).length > 0) {
            await this.prisma.actual.update({
              where: { id: orphan.id },
              data: updates,
            });
          }
        }
      }

      cursor = orphans[orphans.length - 1].id;
    }
  }

  /**
   * Normalize the stock_projection_mode column value to one of the supported
   * modes. Falls back to 'STOCK' for any unknown / null value so a malformed
   * config never silently zeroes out inventory.
   */
  private resolveStockProjectionMode(value: string | null | undefined): 'STOCK' | 'OPENING' | 'COMPUTED' {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'OPENING' || normalized === 'COMPUTED') return normalized;
    return 'STOCK';
  }

  /**
   * Transform staged Marg stock → InventoryLevel records (aggregated per
   * product+location). Which Marg metric becomes on_hand_qty depends on the
   * caller-supplied projection mode:
   *   STOCK    – Marg's `Stock` field (current physical, net of period
   *              movements). Default; matches the API contract.
   *   OPENING  – Marg's `Opening` field (start-of-fiscal-year balance). Use
   *              this when reports must mirror the value Marg ERP F8 displays
   *              for a product (Marg ERP's items-selection screen shows
   *              Opening, not current physical).
   *   COMPUTED – Opening + Σ(InventoryLedger movements). Most accurate live
   *              stock — combines start-of-year balance with every Marg
   *              movement we've ledgered. Requires inventory ledger projection
   *              to have run first.
   * Available_qty always reflects the same source so saleable / on-hand stay
   * coherent. Inventory value uses pRate × on-hand-qty for valuation parity.
   */
  private async transformStockToInventoryLevels(
    tenantId: string,
    mode: 'STOCK' | 'OPENING' | 'COMPUTED' = 'STOCK',
  ): Promise<void> {
    // Aggregate all marg_stocks rows per (pid, companyId) to get correct totals.
    // Multiple batches of the same product exist; the old row-by-row approach
    // would overwrite with the last batch's individual stock, producing wrong totals.
    const aggregated = await this.margPrisma.margStock.groupBy({
      by: ['companyId', 'pid'],
      where: { tenantId, sourceDeleted: false },
      _sum: { stock: true, opening: true },
      _count: true,
    });

    const activeInventoryKeys = new Set<string>();

    for (const agg of aggregated) {
      const productId = await this.resolveProductId(tenantId, agg.companyId, agg.pid);
      const locationId = await this.resolveLocationId(tenantId, agg.companyId);
      if (!productId || !locationId) continue;

      activeInventoryKeys.add(this.buildInventoryScopeKey(productId, locationId));

      const sumStock = agg._sum.stock != null ? Number(agg._sum.stock) : 0;
      const sumOpening = agg._sum.opening != null ? Number(agg._sum.opening) : 0;

      let totalQty: number;
      switch (mode) {
        case 'OPENING':
          totalQty = sumOpening;
          break;
        case 'COMPUTED': {
          const ledgerSum = await this.prisma.inventoryLedger.aggregate({
            where: { tenantId, productId, locationId, referenceType: MARG_SOURCE_SYSTEM },
            _sum: { quantity: true },
          });
          const movementsTotal = ledgerSum._sum.quantity != null ? Number(ledgerSum._sum.quantity) : 0;
          totalQty = sumOpening + movementsTotal;
          break;
        }
        case 'STOCK':
        default:
          totalQty = sumStock;
          break;
      }

      // Compute weighted average cost from individual batch rows
      const batchRows = await this.margPrisma.margStock.findMany({
        where: { tenantId, companyId: agg.companyId, pid: agg.pid, sourceDeleted: false },
        select: { stock: true, pRate: true },
      });

      let totalValue = 0;
      let totalQtyForAvg = 0;
      for (const br of batchRows) {
        const q = br.stock != null ? Number(br.stock) : 0;
        const r = br.pRate != null ? Number(br.pRate) : 0;
        if (q > 0 && r > 0) {
          totalValue += q * r;
          totalQtyForAvg += q;
        }
      }
      const avgCost = totalQtyForAvg > 0 ? totalValue / totalQtyForAvg : null;

      await this.prisma.inventoryLevel.upsert({
        where: {
          tenantId_productId_locationId: { tenantId, productId, locationId },
        },
        create: {
          tenantId,
          productId,
          locationId,
          onHandQty: totalQty,
          availableQty: totalQty,
          averageCost: avgCost != null ? new Prisma.Decimal(avgCost) : null,
          inventoryValue: avgCost != null ? new Prisma.Decimal(totalQty * avgCost) : null,
        },
        update: {
          onHandQty: totalQty,
          availableQty: totalQty,
          averageCost: avgCost != null ? new Prisma.Decimal(avgCost) : null,
          inventoryValue: avgCost != null ? new Prisma.Decimal(totalQty * avgCost) : null,
        },
      });
    }

    await this.zeroOutMissingMargInventoryLevels(tenantId, activeInventoryKeys);
  }

  // ===================== PHARMA REPORTING TRANSFORMS =====================

  /** Transform staged Marg stock rows → Batch records (pharma batch tracking) */
  private async transformStockToBatches(tenantId: string): Promise<void> {
    let cursor: string | null = null;
    const activeBatchKeys = new Set<string>();

    while (true) {
      const staged = await this.margPrisma.margStock.findMany({
        where: {
          tenantId,
          sourceDeleted: false,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (staged.length === 0) break;

      for (const ms of staged) {
        const productId = await this.resolveProductId(tenantId, ms.companyId, ms.pid);
        const locationId = await this.resolveLocationId(tenantId, ms.companyId);
        if (!productId || !locationId) continue;

        const qty = ms.stock != null ? Number(ms.stock) : 0;
        // Skip stock rows with no batch number AND no quantity — Marg often emits
        // these as placeholder masters; creating a Batch with batchNumber='_default'
        // for empty-quantity placeholders would pollute pharma reports.
        const rawBatch = String(ms.batch || '').trim();
        const isPlaceholderBatch = !rawBatch || rawBatch === '_default';
        if (isPlaceholderBatch && qty === 0) continue;

        const costPerUnit = ms.pRate != null ? new Prisma.Decimal(Number(ms.pRate)) : null;
        const batchNumber = (isPlaceholderBatch
          ? `NOBATCH-${ms.pid}`
          : rawBatch
        ).substring(0, 50);
        activeBatchKeys.add(this.buildMargBatchScopeKey(productId, locationId, batchNumber));

        // Determine status based on expiry and quantity
        let status: BatchStatus = BatchStatus.AVAILABLE;
        if (qty <= 0) {
          status = BatchStatus.CONSUMED;
        } else if (ms.expiry && new Date(ms.expiry) < new Date()) {
          status = BatchStatus.EXPIRED;
        }

        try {
          await this.prisma.batch.upsert({
            where: {
              tenantId_productId_locationId_batchNumber: {
                tenantId,
                productId,
                locationId,
                batchNumber,
              },
            },
            create: {
              tenantId,
              batchNumber,
              productId,
              locationId,
              quantity: qty,
              availableQty: qty,
              uom: 'PCS',
              status,
              manufacturingDate: ms.batDate ?? null,
              expiryDate: ms.expiry ?? null,
              costPerUnit,
              notes: 'Synced from Marg EDE',
            },
            update: {
              quantity: qty,
              availableQty: qty,
              status,
              manufacturingDate: ms.batDate ?? null,
              expiryDate: ms.expiry ?? null,
              costPerUnit,
              notes: 'Synced from Marg EDE',
            },
          });
        } catch (err) {
          this.logger.warn(`Batch upsert failed for ${batchNumber}: ${String(err)}`);
        }
      }

      cursor = staged[staged.length - 1].id;
    }

    await this.closeMissingMargBatches(tenantId, activeBatchKeys);
  }

  /** Transform staged Marg transactions → InventoryTransaction records */
  private async transformTransactionsToInventoryTransactions(
    tenantId: string,
    dateWindow: DateWindow | null,
    projectionWindowReset = false,
  ): Promise<void> {
    // Resolve a system user for createdById (required FK)
    const systemUser = await this.prisma.user.findFirst({
      where: { tenantId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!systemUser) {
      this.logger.warn('No user found for tenant — skipping inventory transaction transform');
      return;
    }

    let cursor: string | null = null;
    const productIdCache = new Map<string, string | null>();
    const locationIdCache = new Map<number, string | null>();
    const batchIdCache = new Map<string, string | null>();

    const getProductId = async (companyId: number, pid: string | null): Promise<string | null> => {
      if (!pid) return null;
      const cacheKey = `${companyId}:${pid}`;
      if (!productIdCache.has(cacheKey)) {
        productIdCache.set(cacheKey, await this.resolveProductId(tenantId, companyId, pid));
      }
      return productIdCache.get(cacheKey) ?? null;
    };

    const getLocationId = async (companyId: number): Promise<string | null> => {
      if (!locationIdCache.has(companyId)) {
        locationIdCache.set(companyId, await this.resolveLocationId(tenantId, companyId));
      }
      return locationIdCache.get(companyId) ?? null;
    };

    const getBatchId = async (
      productId: string,
      locationId: string,
      batch: string | null,
    ): Promise<string | null> => {
      if (!batch) return null;
      const cacheKey = `${productId}:${locationId}:${batch}`;
      if (!batchIdCache.has(cacheKey)) {
        batchIdCache.set(cacheKey, await this.resolveBatchId(tenantId, productId, locationId, batch));
      }
      return batchIdCache.get(cacheKey) ?? null;
    };

    while (true) {
      const staged = await this.margPrisma.margTransaction.findMany({
        where: {
          tenantId,
          OR: [
            { qty: { not: null } },
            { free: { not: null } },
          ],
          ...(dateWindow ? { date: this.buildDateWhere(dateWindow)! } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (staged.length === 0) break;

      const voucherContexts = await this.loadMargVoucherContexts(
        tenantId,
        staged.map((mt) => ({ companyId: mt.companyId, voucher: mt.voucher })),
      );

      for (const mt of staged) {
        const effectiveQty = this.resolveMargEffectiveQuantity(mt.qty, mt.free);
        const voucherContext = this.selectMargVoucherContextForTransaction(
          mt,
          voucherContexts.get(this.buildMargVoucherLookupKey(mt.companyId, mt.voucher)),
        );
        const decision = this.resolveMargType2ProjectionDecision({
          transactionType: mt.type,
          transactionVcn: mt.vcn,
          transactionAddField: mt.addField,
          voucherType: voucherContext?.type ?? null,
          voucherVcn: voucherContext?.vcn ?? null,
          voucherAddField: voucherContext?.addField ?? null,
          effectiveQty,
          amount: mt.amount,
        });
        if (!mt.pid) {
          if (!projectionWindowReset) {
            await this.clearMargInventoryTransactionProjection(tenantId, mt.sourceKey);
          }
          continue;
        }
        if (!decision.shouldProjectInventory || decision.inventoryTransactionType == null || decision.inventoryQuantity === 0) {
          if (!projectionWindowReset) {
            await this.clearMargInventoryTransactionProjection(tenantId, mt.sourceKey);
          }
          continue;
        }

        const productId = await getProductId(mt.companyId, mt.pid);
        const locationId = await getLocationId(mt.companyId);
        if (!productId || !locationId) continue;

        const { unitCost, totalCost } = this.resolveMargEffectiveCostMetrics(mt.amount, effectiveQty);
        const referenceNumber = this.buildMargReferenceNumber(mt.sourceKey);
        const idempotencyKey = this.buildMargInventoryTransactionIdempotencyKey(mt.sourceKey);

        // Resolve batch if present
        const batchId = await getBatchId(productId, locationId, mt.batch);

        try {
          await this.prisma.inventoryTransaction.upsert({
            where: {
              tenantId_idempotencyKey: {
                tenantId,
                idempotencyKey,
              },
            },
            create: {
              tenantId,
              transactionType: decision.inventoryTransactionType,
              productId,
              locationId,
              quantity: decision.inventoryQuantity,
              uom: 'PCS',
              transactionDate: mt.date,
              referenceType: MARG_SOURCE_SYSTEM,
              referenceNumber,
              idempotencyKey,
              batchId,
              unitCost,
              totalCost,
              lotNumber: mt.batch?.substring(0, 50) ?? null,
              reason: decision.family,
              notes: `Marg ${decision.family} voucher ${mt.voucher} (${mt.type}${decision.headerType ? `/${decision.headerType}` : ''})`,
              createdById: systemUser.id,
            },
            update: {
              transactionType: decision.inventoryTransactionType,
              productId,
              locationId,
              quantity: decision.inventoryQuantity,
              uom: 'PCS',
              transactionDate: mt.date,
              referenceType: MARG_SOURCE_SYSTEM,
              referenceNumber,
              batchId,
              unitCost,
              totalCost,
              lotNumber: mt.batch?.substring(0, 50) ?? null,
              reason: decision.family,
              notes: `Marg ${decision.family} voucher ${mt.voucher} (${mt.type}${decision.headerType ? `/${decision.headerType}` : ''})`,
              createdById: systemUser.id,
            },
          });
        } catch (err) {
          this.logger.warn(`Inventory transaction upsert failed for ${referenceNumber}: ${String(err)}`);
        }
      }

      cursor = staged[staged.length - 1].id;
    }
  }

  /** Transform staged Marg transactions → InventoryLedger entries (movement log with running balance) */
  private async transformTransactionsToInventoryLedger(
    tenantId: string,
    dateWindow: DateWindow | null,
    projectionWindowReset = false,
    preAffectedInventoryScopes?: Iterable<string>,
  ): Promise<void> {
    const systemUser = await this.prisma.user.findFirst({
      where: { tenantId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    let cursor: string | null = null;
    const affectedInventoryScopes = new Set<string>(preAffectedInventoryScopes ?? []);
    const productIdCache = new Map<string, string | null>();
    const locationIdCache = new Map<number, string | null>();

    const getProductId = async (companyId: number, pid: string | null): Promise<string | null> => {
      if (!pid) return null;
      const cacheKey = `${companyId}:${pid}`;
      if (!productIdCache.has(cacheKey)) {
        productIdCache.set(cacheKey, await this.resolveProductId(tenantId, companyId, pid));
      }
      return productIdCache.get(cacheKey) ?? null;
    };

    const getLocationId = async (companyId: number): Promise<string | null> => {
      if (!locationIdCache.has(companyId)) {
        locationIdCache.set(companyId, await this.resolveLocationId(tenantId, companyId));
      }
      return locationIdCache.get(companyId) ?? null;
    };

    while (true) {
      const staged = await this.margPrisma.margTransaction.findMany({
        where: {
          tenantId,
          OR: [
            { qty: { not: null } },
            { free: { not: null } },
          ],
          ...(dateWindow ? { date: this.buildDateWhere(dateWindow)! } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (staged.length === 0) break;

      const voucherContexts = await this.loadMargVoucherContexts(
        tenantId,
        staged.map((mt) => ({ companyId: mt.companyId, voucher: mt.voucher })),
      );

      for (const mt of staged) {
        const effectiveQty = this.resolveMargEffectiveQuantity(mt.qty, mt.free);
        const voucherContext = this.selectMargVoucherContextForTransaction(
          mt,
          voucherContexts.get(this.buildMargVoucherLookupKey(mt.companyId, mt.voucher)),
        );
        const decision = this.resolveMargType2ProjectionDecision({
          transactionType: mt.type,
          transactionVcn: mt.vcn,
          transactionAddField: mt.addField,
          voucherType: voucherContext?.type ?? null,
          voucherVcn: voucherContext?.vcn ?? null,
          voucherAddField: voucherContext?.addField ?? null,
          effectiveQty,
          amount: mt.amount,
        });
        if (!mt.pid) {
          if (!projectionWindowReset) {
            await this.clearMargInventoryLedgerProjection(tenantId, mt.sourceKey);
          }
          continue;
        }

        const productId = await getProductId(mt.companyId, mt.pid);
        const locationId = await getLocationId(mt.companyId);
        if (!productId || !locationId) continue;

        const scopeKey = this.buildInventoryScopeKey(productId, locationId);
        if (!decision.shouldProjectInventory || decision.ledgerEntryType == null || decision.ledgerQuantity === 0) {
          if (!projectionWindowReset) {
            await this.clearMargInventoryLedgerProjection(tenantId, mt.sourceKey);
          }
          affectedInventoryScopes.add(scopeKey);
          continue;
        }

        const costMetrics = this.resolveMargEffectiveCostMetrics(mt.amount, effectiveQty);
        const unitCost = costMetrics.unitCost != null ? Number(costMetrics.unitCost) : 0;
        const totalCost = costMetrics.totalCost != null ? Number(costMetrics.totalCost) : 0;
        const referenceNumber = this.buildMargReferenceNumber(mt.sourceKey);
        const idempotencyKey = this.buildMargInventoryLedgerIdempotencyKey(mt.sourceKey);

        // Resolve batch if present
        const batchId = await this.resolveBatchId(tenantId, productId, locationId, mt.batch);

        try {
          await this.prisma.inventoryLedger.upsert({
            where: {
              tenantId_idempotencyKey: {
                tenantId,
                idempotencyKey,
              },
            },
            create: {
              tenantId,
              transactionDate: mt.date,
              productId,
              locationId,
              batchId,
              entryType: decision.ledgerEntryType,
              quantity: new Prisma.Decimal(decision.ledgerQuantity),
              uom: 'PCS',
              unitCost: new Prisma.Decimal(unitCost),
              totalCost: new Prisma.Decimal(totalCost),
              referenceType: MARG_SOURCE_SYSTEM,
              referenceNumber,
              idempotencyKey,
              lotNumber: mt.batch?.substring(0, 50) ?? null,
              createdById: systemUser?.id ?? null,
              notes: `Marg ${decision.family} voucher ${mt.voucher} (${mt.type}${decision.headerType ? `/${decision.headerType}` : ''})`,
            },
            update: {
              transactionDate: mt.date,
              productId,
              locationId,
              batchId,
              entryType: decision.ledgerEntryType,
              quantity: new Prisma.Decimal(decision.ledgerQuantity),
              uom: 'PCS',
              unitCost: new Prisma.Decimal(unitCost),
              totalCost: new Prisma.Decimal(totalCost),
              referenceType: MARG_SOURCE_SYSTEM,
              referenceNumber,
              lotNumber: mt.batch?.substring(0, 50) ?? null,
              createdById: systemUser?.id ?? null,
              notes: `Marg ${decision.family} voucher ${mt.voucher} (${mt.type}${decision.headerType ? `/${decision.headerType}` : ''})`,
            },
          });
          affectedInventoryScopes.add(scopeKey);
        } catch (err) {
          this.logger.warn(`Inventory ledger upsert failed for ${referenceNumber}: ${String(err)}`);
        }
      }

      cursor = staged[staged.length - 1].id;
    }

    await this.rebuildMargLedgerRunningBalances(tenantId, affectedInventoryScopes);
  }

  // ===================== ACCOUNTING PROJECTION =====================

  private async transformAccountPostingsToJournalEntries(
    tenantId: string,
    syncRun: MargSyncRunContext,
    dateWindow: DateWindow | null,
    triggeredBy?: string,
  ): Promise<MargAccountingProjectionSummary> {
    await this.ensureMargAccountingBootstrap(tenantId);

    const rules = await this.margPrisma.margGLMappingRule.findMany({
      where: { tenantId, isActive: true },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    if (rules.length === 0) {
      return {
        journalEntriesSynced: 0,
        skippedGroups: [{
          groupKey: 'GLOBAL',
          reason: 'No active Marg GL mapping rules configured',
        }],
        diagnostics: {
          duplicateFingerprintCount: 0,
          duplicateRowCount: 0,
          skippedByReason: {
            'No active Marg GL mapping rules configured': 1,
          },
        },
      };
    }

    const postingUserId = await this.resolveJournalPostingUserId(tenantId, triggeredBy);
    const postingRows = await this.margPrisma.margAccountPosting.findMany({
      where: {
        tenantId,
        ...this.buildMargChangedSinceWhere(syncRun),
        ...(dateWindow ? { date: this.buildDateWhere(dateWindow)! } : {}),
      },
      select: {
        margId: true,
        companyId: true,
        voucher: true,
        date: true,
        book: true,
        amount: true,
        code: true,
        code1: true,
        gCode: true,
        remark: true,
      },
      orderBy: [
        { date: 'asc' },
        { companyId: 'asc' },
        { book: 'asc' },
        { voucher: 'asc' },
        { margId: 'asc' },
      ],
    });

    if (postingRows.length === 0) {
      return {
        journalEntriesSynced: 0,
        skippedGroups: [],
        diagnostics: {
          duplicateFingerprintCount: 0,
          duplicateRowCount: 0,
          skippedByReason: {},
        },
      };
    }

    const groups = new Map<string, { group: MargAccountPostingGroup; rows: MargAccountPostingProjectionRow[] }>();
    for (const row of postingRows as MargAccountPostingProjectionRow[]) {
      const groupKey = this.buildMargAccountJournalGroupKey(row);
      const existingGroup = groups.get(groupKey);
      if (existingGroup) {
        existingGroup.rows.push(row);
      } else {
        groups.set(groupKey, {
          group: this.buildMargAccountPostingGroup(row),
          rows: [row],
        });
      }
    }

    let journalEntriesSynced = 0;
    const skippedGroups: MargAccountingProjectionIssue[] = [];
    const skippedByReason: Record<string, number> = {};
    let duplicateFingerprintCount = 0;
    let duplicateRowCount = 0;

    for (const [groupKey, groupedRows] of groups) {
      const group = groupedRows.group;
      const rows = groupedRows.rows;

      const duplicateSummary = this.summarizeMargAccountPostingDuplicates(rows);
      if (duplicateSummary.duplicateFingerprintCount > 0) {
        duplicateFingerprintCount += duplicateSummary.duplicateFingerprintCount;
        duplicateRowCount += duplicateSummary.duplicateRowCount;
        const reason = 'Duplicate account postings detected';
        skippedGroups.push({
          groupKey,
          companyId: group.companyId,
          voucher: group.voucher,
          bookCode: group.book,
          entryDate: group.date.toISOString().slice(0, 10),
          reason,
          details: duplicateSummary,
        });
        this.incrementReasonCount(skippedByReason, reason);
        continue;
      }

      const unresolvedRows: Array<Record<string, unknown>> = [];
      const lineMap = new Map<string, MargJournalLineDraft>();
      let stagedDebit = 0;
      let stagedCredit = 0;

      for (const row of rows) {
        const amount = this.normalizeMargAccountingAmount(Number(row.amount ?? 0));
        if (!Number.isFinite(amount) || amount === 0) {
          continue;
        }

        const rule = this.resolveMargGlMappingRule(row, rules);
        if (!rule) {
          unresolvedRows.push({
            margId: row.margId.toString(),
            code: row.code,
            code1: row.code1,
            gCode: row.gCode,
            book: row.book,
            voucher: row.voucher,
            amount,
          });
          continue;
        }

        const side = amount > 0 ? 'DEBIT' : 'CREDIT';
        const amountAbs = this.normalizeMargAccountingAmount(Math.abs(amount));
        const lineKey = `${rule.glAccountId}|${side}`;
        const existing = lineMap.get(lineKey);
        if (existing) {
          if (side === 'DEBIT') {
            existing.debitAmount = this.normalizeMargAccountingAmount(existing.debitAmount + amountAbs);
          } else {
            existing.creditAmount = this.normalizeMargAccountingAmount(existing.creditAmount + amountAbs);
          }
        } else {
          lineMap.set(lineKey, {
            glAccountId: rule.glAccountId,
            debitAmount: side === 'DEBIT' ? amountAbs : 0,
            creditAmount: side === 'CREDIT' ? amountAbs : 0,
            description: this.buildMargJournalLineDescription(row),
          });
        }

        if (side === 'DEBIT') {
          stagedDebit = this.normalizeMargAccountingAmount(stagedDebit + amountAbs);
        } else {
          stagedCredit = this.normalizeMargAccountingAmount(stagedCredit + amountAbs);
        }
      }

      if (unresolvedRows.length > 0) {
        const reason = 'Unmapped account postings';
        skippedGroups.push({
          groupKey,
          companyId: group.companyId,
          voucher: group.voucher,
          bookCode: group.book,
          entryDate: group.date.toISOString().slice(0, 10),
          reason,
          details: {
            unresolvedCount: unresolvedRows.length,
            sample: unresolvedRows.slice(0, 5),
          },
        });
        this.incrementReasonCount(skippedByReason, reason);
        continue;
      }

      const lines = this.normalizeMargJournalLines(Array.from(lineMap.values())
        .filter((line) => line.debitAmount > 0 || line.creditAmount > 0)
        .sort((left, right) => left.glAccountId.localeCompare(right.glAccountId)));

      if (lines.length < 2) {
        const reason = 'Insufficient mapped lines to create a journal entry';
        skippedGroups.push({
          groupKey,
          companyId: group.companyId,
          voucher: group.voucher,
          bookCode: group.book,
          entryDate: group.date.toISOString().slice(0, 10),
          reason,
        });
        this.incrementReasonCount(skippedByReason, reason);
        continue;
      }

      if (!this.isWithinTolerance(stagedDebit, stagedCredit, ACCOUNTING_RECONCILIATION_TOLERANCE)) {
        const reason = 'Source account postings are not balanced';
        skippedGroups.push({
          groupKey,
          companyId: group.companyId,
          voucher: group.voucher,
          bookCode: group.book,
          entryDate: group.date.toISOString().slice(0, 10),
          reason,
          details: {
            stagedDebit,
            stagedCredit,
            delta: stagedDebit - stagedCredit,
          },
        });
        this.incrementReasonCount(skippedByReason, reason);
        continue;
      }

      const contentHash = this.buildMargAccountJournalContentHash(groupKey, group, lines);
      const posted = await this.prisma.$transaction(async (tx) => {
        let projection = await tx.margAccountJournalProjection.findUnique({
          where: {
            tenantId_groupKey: { tenantId, groupKey },
          },
        });

        if (projection?.contentHash === contentHash && projection.journalEntryId) {
          await tx.margAccountJournalProjection.update({
            where: { id: projection.id },
            data: {
              companyId: group.companyId,
              bookCode: group.book,
              voucher: group.voucher,
              entryDate: group.date,
              lastSyncLogId: syncRun.id,
              lastProjectedAt: new Date(),
            },
          });
          return false;
        }

        if (!projection) {
          projection = await tx.margAccountJournalProjection.create({
            data: {
              tenantId,
              companyId: group.companyId,
              groupKey,
              bookCode: group.book,
              voucher: group.voucher,
              entryDate: group.date,
              contentHash,
              lastSyncLogId: syncRun.id,
              lastProjectedAt: new Date(),
            },
          });
        } else if (projection.journalEntryId) {
          const existingJournal = await tx.journalEntry.findFirst({
            where: {
              id: projection.journalEntryId,
              tenantId,
            },
            select: {
              id: true,
              status: true,
              isReversed: true,
            },
          });

          if (existingJournal && !existingJournal.isReversed && existingJournal.status !== JournalEntryStatus.REVERSED) {
            await this.accountingService.reverseJournalEntry(tx, {
              tenantId,
              journalEntryId: existingJournal.id,
              postedById: postingUserId,
              reason: `Marg account projection refreshed for ${groupKey}`,
            });
          }
        }

        const journal = await this.accountingService.createJournalEntry(tx, {
          tenantId,
          entryDate: group.date,
          referenceType: MARG_ACCOUNTING_REFERENCE_TYPE,
          referenceId: projection.id,
          description: this.buildMargAccountJournalDescription(group),
          postedById: postingUserId,
          idempotencyKey: this.buildMargAccountJournalIdempotencyKey(groupKey, contentHash),
          currency: 'INR',
          lines,
        });

        await tx.margAccountJournalProjection.update({
          where: { id: projection.id },
          data: {
            companyId: group.companyId,
            bookCode: group.book,
            voucher: group.voucher,
            entryDate: group.date,
            contentHash,
            journalEntryId: journal.id,
            lastSyncLogId: syncRun.id,
            lastProjectedAt: new Date(),
          },
        });

        return true;
      }, {
        maxWait: MARG_ACCOUNTING_PROJECTION_TX_MAX_WAIT_MS,
        timeout: MARG_ACCOUNTING_PROJECTION_TX_TIMEOUT_MS,
      });

      if (posted) {
        journalEntriesSynced += 1;
      }
    }

    return {
      journalEntriesSynced,
      skippedGroups,
      diagnostics: {
        duplicateFingerprintCount,
        duplicateRowCount,
        skippedByReason,
      },
    };
  }

  private async runPostSyncReconciliations(
    tenantId: string,
    syncRun: MargSyncRunContext,
    dateWindow: DateWindow | null,
    skippedGroups: MargAccountingProjectionIssue[],
    scope: MargSyncScope,
  ): Promise<MargReconciliationExecutionSummary> {
    const tasks: Array<Promise<{ status: MargReconciliationStatus; issueCount: number }>> = [];
    if (scope === MARG_SYNC_SCOPE.FULL) {
      tasks.push(this.runStockReconciliation(tenantId, syncRun));
    }
    tasks.push(this.runARAgingReconciliation(tenantId, syncRun));
    tasks.push(this.runAccountingBalanceReconciliation(tenantId, syncRun, dateWindow, skippedGroups));

    const results = await Promise.all(tasks);

    return results.reduce<MargReconciliationExecutionSummary>((summary, result) => ({
      totalIssues: summary.totalIssues + result.issueCount,
      warningCount: summary.warningCount + (result.status === MargReconciliationStatus.WARNING ? 1 : 0),
      failureCount: summary.failureCount + (result.status === MargReconciliationStatus.FAILED ? 1 : 0),
    }), {
      totalIssues: 0,
      warningCount: 0,
      failureCount: 0,
    });
  }

  private async runStockReconciliation(tenantId: string, syncRun: MargSyncRunContext) {
    const touchedStocks = await this.margPrisma.margStock.findMany({
      where: {
        tenantId,
        OR: [
          { lastSeenSyncLogId: syncRun.id },
          { updatedAt: { gte: syncRun.startedAt } },
        ],
      },
      select: {
        companyId: true,
        pid: true,
      },
      distinct: ['companyId', 'pid'],
    });

    const issues: Array<Record<string, unknown>> = [];
    let checkedInventoryScopes = 0;
    let checkedBatchScopes = 0;
    let totalStageOnHand = 0;
    let totalProjectedOnHand = 0;

    for (const scope of touchedStocks) {
      const productId = await this.resolveProductId(tenantId, scope.companyId, scope.pid);
      const locationId = await this.resolveLocationId(tenantId, scope.companyId);
      if (!productId || !locationId) {
        issues.push({
          type: 'UNRESOLVED_SCOPE',
          companyId: scope.companyId,
          pid: scope.pid,
        });
        continue;
      }

      checkedInventoryScopes += 1;
      const stagedRows = await this.margPrisma.margStock.findMany({
        where: {
          tenantId,
          companyId: scope.companyId,
          pid: scope.pid,
        },
        select: {
          batch: true,
          stock: true,
          sourceDeleted: true,
        },
      });

      const expectedInventoryQty = stagedRows
        .filter((row: any) => !row.sourceDeleted)
        .reduce((sum: number, row: any) => sum + Number(row.stock ?? 0), 0);
      totalStageOnHand += expectedInventoryQty;

      const inventoryLevel = await this.prisma.inventoryLevel.findUnique({
        where: {
          tenantId_productId_locationId: { tenantId, productId, locationId },
        },
        select: {
          onHandQty: true,
        },
      });
      const actualInventoryQty = Number(inventoryLevel?.onHandQty ?? 0);
      totalProjectedOnHand += actualInventoryQty;

      if (!this.isWithinTolerance(expectedInventoryQty, actualInventoryQty, STOCK_RECONCILIATION_TOLERANCE)) {
        issues.push({
          type: 'INVENTORY_LEVEL_MISMATCH',
          companyId: scope.companyId,
          pid: scope.pid,
          expectedInventoryQty,
          actualInventoryQty,
        });
      }

      const batchQuantities = new Map<string, number>();
      for (const row of stagedRows) {
        if (!row.batch || row.batch === '_default') {
          continue;
        }

        const current = batchQuantities.get(row.batch) ?? 0;
        batchQuantities.set(row.batch, current + (row.sourceDeleted ? 0 : Number(row.stock ?? 0)));
      }

      for (const [batchNumber, expectedBatchQty] of batchQuantities) {
        checkedBatchScopes += 1;
        const batch = await this.prisma.batch.findFirst({
          where: {
            tenantId,
            productId,
            locationId,
            batchNumber: batchNumber.substring(0, 50),
          },
          select: {
            quantity: true,
            status: true,
          },
        });

        const actualBatchQty = Number(batch?.quantity ?? 0);
        if (!this.isWithinTolerance(expectedBatchQty, actualBatchQty, STOCK_RECONCILIATION_TOLERANCE)) {
          issues.push({
            type: 'BATCH_QTY_MISMATCH',
            companyId: scope.companyId,
            pid: scope.pid,
            batchNumber,
            expectedBatchQty,
            actualBatchQty,
          });
        }

        if (
          this.isWithinTolerance(expectedBatchQty, 0, STOCK_RECONCILIATION_TOLERANCE) &&
          batch &&
          batch.status !== BatchStatus.CONSUMED
        ) {
          issues.push({
            type: 'BATCH_STATUS_MISMATCH',
            companyId: scope.companyId,
            pid: scope.pid,
            batchNumber,
            expectedStatus: BatchStatus.CONSUMED,
            actualStatus: batch.status,
          });
        }
      }
    }

    const issueCount = issues.length;
    const status: MargReconciliationStatus = issueCount === 0
      ? MargReconciliationStatus.PASSED
      : MargReconciliationStatus.WARNING;
    await this.upsertMargReconciliationResult(tenantId, syncRun.id, MargReconciliationType.STOCK, {
      status,
      issueCount,
      summary: {
        checkedInventoryScopes,
        checkedBatchScopes,
        totalStageOnHand,
        totalProjectedOnHand,
      },
      issues,
    });

    return { status, issueCount };
  }

  private async runARAgingReconciliation(tenantId: string, syncRun: MargSyncRunContext) {
    const touchedBalances = await Promise.all([
      this.margPrisma.margOutstanding.findMany({
        where: {
          tenantId,
          ...this.buildMargChangedSinceWhere(syncRun),
        },
        select: {
          companyId: true,
          ord: true,
        },
        distinct: ['companyId', 'ord'],
      }),
      this.margPrisma.margPartyBalance.findMany({
        where: {
          tenantId,
          ...this.buildMargChangedSinceWhere(syncRun),
        },
        select: {
          companyId: true,
          cid: true,
        },
        distinct: ['companyId', 'cid'],
      }),
    ]);

    const keys = new Set<string>();
    for (const row of touchedBalances[0]) {
      keys.add(`${row.companyId}|${row.ord}`);
    }
    for (const row of touchedBalances[1]) {
      keys.add(`${row.companyId}|${row.cid}`);
    }

    const issues: Array<Record<string, unknown>> = [];
    const agingBuckets = {
      current: 0,
      days31To60: 0,
      days61To90: 0,
      days91Plus: 0,
    };
    let totalOutstanding = 0;
    let totalPartyBalance = 0;

    for (const key of keys) {
      const [companyIdRaw, partyCode] = key.split('|');
      const companyId = Number(companyIdRaw);
      if (!companyId || !partyCode) {
        continue;
      }

      const outstandings = await this.margPrisma.margOutstanding.findMany({
        where: {
          tenantId,
          companyId,
          ord: partyCode,
        },
        select: {
          balance: true,
          days: true,
        },
      });

      const partyBalance = await this.margPrisma.margPartyBalance.findFirst({
        where: {
          tenantId,
          companyId,
          cid: partyCode,
        },
        select: {
          balance: true,
        },
      });

      const outstandingTotal = outstandings.reduce((sum: number, item: any) => {
        const amount = Number(item.balance ?? 0);
        const days = Number(item.days ?? 0);
        if (days <= 30) {
          agingBuckets.current += amount;
        } else if (days <= 60) {
          agingBuckets.days31To60 += amount;
        } else if (days <= 90) {
          agingBuckets.days61To90 += amount;
        } else {
          agingBuckets.days91Plus += amount;
        }
        return sum + amount;
      }, 0);

      const balanceTotal = Number(partyBalance?.balance ?? 0);
      totalOutstanding += outstandingTotal;
      totalPartyBalance += balanceTotal;

      // PartyBalance is the running ledger balance for the party (opening + all
      // postings net of receipts), while Outstanding only sums currently-open
      // invoices for that party. They diverge legitimately when (a) the party
      // has an opening balance carried from a prior period, (b) journal-only
      // adjustments hit the ledger but do not generate an outstanding row, or
      // (c) advances/on-account receipts produce a credit balance with no
      // matching outstanding. Only flag when both are debit balances and the
      // outstanding undershoots the ledger by a material amount, which is the
      // signal pattern that indicates a missed open invoice.
      if (balanceTotal > 0 && outstandingTotal >= 0) {
        const undershoot = balanceTotal - outstandingTotal;
        const materialityThreshold = Math.max(balanceTotal * 0.05, 100);
        if (undershoot > materialityThreshold) {
          issues.push({
            type: 'AR_OUTSTANDING_UNDERSHOOT',
            companyId,
            partyCode,
            outstandingTotal,
            partyBalance: balanceTotal,
            variance: undershoot,
          });
        }
      }
    }

    const issueCount = issues.length;
    const status: MargReconciliationStatus = issueCount === 0
      ? MargReconciliationStatus.PASSED
      : MargReconciliationStatus.WARNING;
    await this.upsertMargReconciliationResult(tenantId, syncRun.id, MargReconciliationType.AR_AGING, {
      status,
      issueCount,
      summary: {
        touchedPartyScopes: keys.size,
        totalOutstanding,
        totalPartyBalance,
        variance: totalOutstanding - totalPartyBalance,
        agingBuckets,
      },
      issues,
    });

    return { status, issueCount };
  }

  private async runAccountingBalanceReconciliation(
    tenantId: string,
    syncRun: MargSyncRunContext,
    dateWindow: DateWindow | null,
    skippedGroups: MargAccountingProjectionIssue[],
  ) {
    const changedRows = await this.margPrisma.margAccountPosting.findMany({
      where: {
        tenantId,
        ...this.buildMargChangedSinceWhere(syncRun),
        ...(dateWindow ? { date: this.buildDateWhere(dateWindow)! } : {}),
      },
      select: {
        margId: true,
        companyId: true,
        voucher: true,
        date: true,
        book: true,
      },
    });

    const issues: Array<Record<string, unknown>> = skippedGroups.map((group) => ({
      type: 'SKIPPED_ACCOUNTING_GROUP',
      ...group,
    }));
    const skippedGroupKeys = new Set(skippedGroups.map((group) => group.groupKey));
    const groups = new Map<string, MargAccountPostingGroup>();

    for (const row of changedRows) {
      const groupKey = this.buildMargAccountJournalGroupKey(row);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, this.buildMargAccountPostingGroup(row));
      }
    }

    let stagedDebitTotal = 0;
    let stagedCreditTotal = 0;
    let journalDebitTotal = 0;
    let journalCreditTotal = 0;
    let projectedGroupCount = 0;
    let unbalancedGroupCount = 0;

    for (const [groupKey, group] of groups) {
      const rows = await this.margPrisma.margAccountPosting.findMany({
        where: this.buildMargAccountPostingGroupWhere(tenantId, group),
        select: {
          amount: true,
        },
      });

      const stagedDebit = rows.reduce((sum: number, row: any) => sum + Math.max(Number(row.amount ?? 0), 0), 0);
      const stagedCredit = rows.reduce((sum: number, row: any) => sum + Math.abs(Math.min(Number(row.amount ?? 0), 0)), 0);
      stagedDebitTotal += stagedDebit;
      stagedCreditTotal += stagedCredit;

      if (!this.isWithinTolerance(stagedDebit, stagedCredit, ACCOUNTING_RECONCILIATION_TOLERANCE)) {
        unbalancedGroupCount += 1;
        issues.push({
          type: 'UNBALANCED_SOURCE_GROUP',
          groupKey,
          companyId: group.companyId,
          voucher: group.voucher,
          bookCode: group.book,
          entryDate: group.date.toISOString().slice(0, 10),
          stagedDebit,
          stagedCredit,
          delta: stagedDebit - stagedCredit,
        });
      }

      const projection = await this.margPrisma.margAccountJournalProjection.findUnique({
        where: {
          tenantId_groupKey: { tenantId, groupKey },
        },
      });

      if (!projection?.journalEntryId) {
        if (!skippedGroupKeys.has(groupKey)) {
          issues.push({
            type: 'UNPROJECTED_GROUP',
            groupKey,
            companyId: group.companyId,
            voucher: group.voucher,
            bookCode: group.book,
            entryDate: group.date.toISOString().slice(0, 10),
          });
        }
        continue;
      }

      const journal = await this.prisma.journalEntry.findFirst({
        where: {
          id: projection.journalEntryId,
          tenantId,
        },
        select: {
          totalDebit: true,
          totalCredit: true,
          status: true,
          isReversed: true,
        },
      });

      if (!journal || journal.isReversed || journal.status === JournalEntryStatus.REVERSED) {
        issues.push({
          type: 'MISSING_ACTIVE_JOURNAL',
          groupKey,
          companyId: group.companyId,
          voucher: group.voucher,
          bookCode: group.book,
          entryDate: group.date.toISOString().slice(0, 10),
        });
        continue;
      }

      projectedGroupCount += 1;
      const journalDebit = Number(journal.totalDebit ?? 0);
      const journalCredit = Number(journal.totalCredit ?? 0);
      journalDebitTotal += journalDebit;
      journalCreditTotal += journalCredit;

      if (
        !this.isWithinTolerance(stagedDebit, journalDebit, ACCOUNTING_RECONCILIATION_TOLERANCE) ||
        !this.isWithinTolerance(stagedCredit, journalCredit, ACCOUNTING_RECONCILIATION_TOLERANCE)
      ) {
        issues.push({
          type: 'JOURNAL_TOTAL_MISMATCH',
          groupKey,
          companyId: group.companyId,
          voucher: group.voucher,
          bookCode: group.book,
          entryDate: group.date.toISOString().slice(0, 10),
          stagedDebit,
          stagedCredit,
          journalDebit,
          journalCredit,
        });
      }
    }

    const issueCount = issues.length;
    const status: MargReconciliationStatus = issueCount === 0
      ? MargReconciliationStatus.PASSED
      : MargReconciliationStatus.WARNING;
    await this.upsertMargReconciliationResult(tenantId, syncRun.id, MargReconciliationType.ACCOUNTING_BALANCE, {
      status,
      issueCount,
      summary: {
        touchedGroups: groups.size,
        projectedGroups: projectedGroupCount,
        skippedGroups: skippedGroups.length,
        unbalancedSourceGroups: unbalancedGroupCount,
        stagedDebitTotal,
        stagedCreditTotal,
        journalDebitTotal,
        journalCreditTotal,
        trialBalanceDelta: journalDebitTotal - journalCreditTotal,
      },
      issues,
    });

    return { status, issueCount };
  }

  // ===================== HELPERS =====================

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private toArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }

  private toEntityArray(value: unknown): any[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
    return [];
  }

  private readFirstDefined(
    sources: Array<Record<string, unknown> | null | undefined>,
    keys: string[],
  ): unknown {
    for (const source of sources) {
      if (!source) continue;
      for (const key of keys) {
        const value = source[key];
        if (value !== undefined && value !== null) {
          return value;
        }
      }
    }
    return undefined;
  }

  private readMargString(source: Record<string, unknown>, keys: string[], maxLength?: number): string | null {
    const value = this.readFirstDefined([source], keys);
    if (value === undefined || value === null) return null;

    const normalized = String(value).trim();
    if (!normalized) return null;

    return maxLength && normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
  }

  private tryParseJsonRecord(input: string): Record<string, unknown> | null {
    let current: unknown = input;

    for (let depth = 0; depth < 4; depth++) {
      if (typeof current !== 'string') break;

      const trimmed = current.replace(/^\uFEFF/, '').trim();
      if (!trimmed) return null;

      // First parse is mandatory; further parses happen only if value still looks like JSON.
      const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"');
      if (depth > 0 && !looksLikeJson) break;

      try {
        current = JSON.parse(trimmed);
      } catch {
        return null;
      }
    }

    return this.toRecord(current);
  }

  private parseMargStringPayload(payload: string, decryptionKey: string): Record<string, unknown> {
    const normalizedPayload = String(payload || '').trim();
    if (!normalizedPayload) {
      throw new BadRequestException('Marg API returned empty payload');
    }

    // Some tenants return plain JSON string without encryption.
    const direct = this.tryParseJsonRecord(normalizedPayload);
    if (direct) return direct;

    const decodeAttempts = [
      () => decryptMargPayload(normalizedPayload, decryptionKey),
      () => decryptMargCompressedPayload(normalizedPayload, decryptionKey),
      () => inflateRawSync(Buffer.from(normalizedPayload, 'base64')).toString('utf8').replace(/^\uFEFF/, ''),
    ];

    for (const decode of decodeAttempts) {
      try {
        const decoded = decode();
        const parsed = this.tryParseJsonRecord(decoded);
        if (parsed) return parsed;

        const terminalPayload = this.tryParseMargTerminalMarker(decoded);
        if (terminalPayload) return terminalPayload;
      } catch {
        // try next decoder strategy
      }
    }

    throw new BadRequestException('Failed to decrypt Marg EDE response. Verify decryption key and APIType.');
  }

  private tryParseMargTerminalMarker(decoded: string): Record<string, unknown> | null {
    const normalized = String(decoded || '').replace(/^\uFEFF/, '').trim();

    // Some tenants return a tiny compressed sentinel on terminal page: {"Details":{
    // Treat this as completion with no additional rows.
    if (normalized === '{"Details":{') {
      return {
        Details: {
          Dis: [],
          Masters: [],
          MDis: [],
          Party: [],
          Product: [],
          SaleType: [],
          Stock: [],
          Index: 0,
          Datastatus: COMPLETE_DATA_STATUS,
          DateTime: '',
        },
      };
    }

    return null;
  }

  private parseMargDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

    const str = String(value).trim();
    if (!str) return null;

    const normalized = str.replace(/\./g, '/').replace(/-/g, '/');
    const parts = normalized.split('/');
    if (parts.length === 3 && parts[0].length <= 2) {
      const day = Number(parts[0]);
      const month = Number(parts[1]);
      const year = Number(parts[2]);
      if (
        Number.isInteger(day) &&
        Number.isInteger(month) &&
        Number.isInteger(year) &&
        day >= 1 &&
        day <= 31 &&
        month >= 1 &&
        month <= 12 &&
        year >= 1900
      ) {
        const date = new Date(Date.UTC(year, month - 1, day));
        return Number.isNaN(date.getTime()) ? null : date;
      }
    }

    const isoDateMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/);
    if (isoDateMatch) {
      const [, yearRaw, monthRaw, dayRaw, hourRaw = '0', minuteRaw = '0', secondRaw = '0'] = isoDateMatch;
      const year = Number(yearRaw);
      const month = Number(monthRaw);
      const day = Number(dayRaw);
      const hour = Number(hourRaw);
      const minute = Number(minuteRaw);
      const second = Number(secondRaw);
      const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(str);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toInt32(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;

    const truncated = Math.trunc(numeric);
    if (truncated < INT32_MIN || truncated > INT32_MAX) {
      return fallback;
    }

    return truncated;
  }

  /** Convert Marg IDs that can exceed INT32 to BigInt for Prisma */
  private toBigInt(value: unknown): bigint {
    if (value == null) return BigInt(0);
    try {
      return BigInt(Math.trunc(Number(value)));
    } catch {
      return BigInt(0);
    }
  }

  /**
   * Normalize Marg DataStatus which can be numeric (10) or string ("Completed").
   * Returns COMPLETE_DATA_STATUS (10) for completion, 0 otherwise.
   */
  private normalizeDataStatus(value: unknown): number {
    if (value == null) return 0;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
    const str = String(value).trim().toUpperCase();
    if (str === 'COMPLETED' || str === 'COMPLETE') return COMPLETE_DATA_STATUS;
    return 0;
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  private normalizeString(value: string, maxLength: number, required = false): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      if (required) {
        throw new BadRequestException('Required value cannot be empty');
      }
      return '';
    }
    return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
  }

  private normalizeBaseUrl(value?: string): string {
    const normalized = (value || DEFAULT_API_BASE_URL).trim();
    return this.resolveMargOrigin(normalized);
  }

  private resolveMargOrigin(value: string): string {
    const normalized = (value || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '');

    try {
      const parsed = new URL(normalized);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      try {
        const parsed = new URL(`https://${normalized.replace(/^\/+/, '')}`);
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        this.logger.warn(`Invalid Marg apiBaseUrl received, falling back to default: ${value}`);
        return DEFAULT_API_BASE_URL;
      }
    }
  }

  private normalizeSyncFrequency(value?: string): string {
    const normalized = (value || DEFAULT_SYNC_FREQUENCY).trim().toUpperCase();
    if (!ALLOWED_SYNC_FREQUENCIES.has(normalized)) {
      throw new BadRequestException('syncFrequency must be one of HOURLY, DAILY, WEEKLY');
    }
    return normalized;
  }

  private buildSourceKey(row: Record<string, unknown>): string {
    const sourceRowId = String(row.ID || '').trim();
    const companyId = String(row.CompanyID || '').trim();
    return `marg:${companyId}:${sourceRowId}`;
  }

  private buildDateWindow(fromDate?: string, endDate?: string): DateWindow | null {
    const from = fromDate ? this.parseMargDate(fromDate) : null;
    const to = endDate ? this.parseMargDate(endDate) : null;

    if (fromDate && !from) {
      throw new BadRequestException('fromDate must be a valid date (YYYY-MM-DD)');
    }
    if (endDate && !to) {
      throw new BadRequestException('endDate must be a valid date (YYYY-MM-DD)');
    }
    if (from && to && to.getTime() < from.getTime()) {
      throw new BadRequestException('endDate must be on or after fromDate');
    }
    if (!from && !to) return null;

    return { from, to };
  }

  private buildDateWhere(dateWindow: DateWindow | null): Prisma.DateTimeFilter | undefined {
    if (!dateWindow) return undefined;

    return {
      ...(dateWindow.from ? { gte: dateWindow.from } : {}),
      ...(dateWindow.to ? { lte: dateWindow.to } : {}),
    };
  }

  private buildMargChangedSinceWhere(syncRun: MargSyncRunContext): { updatedAt?: Prisma.DateTimeFilter } {
    if (syncRun.mode === MARG_SYNC_MODE.REPROJECT) {
      return {};
    }

    return {
      updatedAt: { gte: syncRun.startedAt },
    };
  }

  private isWithinDateWindow(date: Date, dateWindow: DateWindow | null): boolean {
    if (!dateWindow) return true;
    if (dateWindow.from && date.getTime() < dateWindow.from.getTime()) return false;
    if (dateWindow.to && date.getTime() > dateWindow.to.getTime()) return false;
    return true;
  }

  private async touchSyncHeartbeat(configId: string, includeInventoryStatus: boolean): Promise<void> {
    await this.margPrisma.margSyncConfig.update({
      where: { id: configId },
      data: includeInventoryStatus
        ? {
          lastSyncStatus: MARG_SYNC_STATUS.RUNNING,
          lastAccountingSyncStatus: MARG_SYNC_STATUS.RUNNING,
        }
        : {
          lastAccountingSyncStatus: MARG_SYNC_STATUS.RUNNING,
        },
    });
  }

  // ===================== RESUMABLE PIPELINE: STAGE / RAW PAGE / ERROR HELPERS =====================

  /**
   * Update the stage-machine columns on the sync log. Updates last_heartbeat_at
   * on every call so the scheduler's stale-running detector sees fresh
   * activity even when no row counts move (e.g. inside a long projection).
   *
   * Best-effort: a missing margSyncLog table or a write failure must not
   * abort the sync — observability is not load-bearing.
   */
  private async updateSyncStage(
    syncLogId: string,
    stage: MargSyncStage,
    extras: {
      apiType?: string;
      requestIndex?: number | null;
      responseIndex?: number | null;
      entityType?: string | null;
      batchNumber?: number | null;
      rowsProcessed?: number;
      totalRowsDiscovered?: number | null;
    } = {},
  ): Promise<void> {
    if (typeof this.margPrisma.margSyncLog?.update !== 'function') return;
    try {
      const data: Record<string, unknown> = {
        currentStage: stage,
        lastHeartbeatAt: new Date(),
      };
      if (extras.apiType !== undefined) data.currentApiType = extras.apiType;
      if (extras.requestIndex !== undefined) data.currentRequestIndex = extras.requestIndex;
      if (extras.responseIndex !== undefined) data.currentResponseIndex = extras.responseIndex;
      if (extras.entityType !== undefined) data.currentEntityType = extras.entityType;
      if (extras.batchNumber !== undefined) data.currentBatchNumber = extras.batchNumber;
      if (extras.rowsProcessed !== undefined) data.rowsProcessed = BigInt(extras.rowsProcessed);
      if (extras.totalRowsDiscovered !== undefined) {
        data.totalRowsDiscovered = extras.totalRowsDiscovered === null ? null : BigInt(extras.totalRowsDiscovered);
      }
      await this.margPrisma.margSyncLog.update({ where: { id: syncLogId }, data });
    } catch (err) {
      this.logger.warn(`updateSyncStage failed for syncLog=${syncLogId} stage=${stage}: ${(err as Error).message}`);
    }
  }

  /**
   * Clamp the requested staging batch size to a value that stays under
   * PostgreSQL's prepared-statement bind-variable limit.
   *
   * Postgres packs the parameter count into a 16-bit integer in the wire
   * protocol, so each `$executeRaw` INSERT can carry at most 32_767 bind
   * variables across all its VALUES tuples. Each row uses one bind per
   * placeholder; a 16-column row at batch=5000 sends 80_000 binds and the
   * server rejects the statement with:
   *   "too many bind variables in prepared statement, expected maximum of
   *   32767, received N"
   *
   * Headroom: leave ~770 binds free so a future-added column does not
   * silently push us over. Floor at 1 — a misconfigured env (e.g.
   * MARG_STAGING_BATCH_SIZE=0) must not divide by zero or skip rows.
   *
   * If the env-requested batch was clamped down, emit one warn-level log
   * so the operator knows their setting is not being honored. We log once
   * per call rather than throwing because the bulk write still functions
   * correctly with a smaller batch — it's a configuration nudge, not a
   * crash condition.
   */
  private computeSafeBatchSize(requested: number, columnsPerRow: number, methodName: string): number {
    const POSTGRES_BIND_LIMIT = 32_767;
    const SAFETY = 767;
    const cols = Math.max(1, columnsPerRow);
    const maxByBinds = Math.floor((POSTGRES_BIND_LIMIT - SAFETY) / cols);
    const effective = Math.max(1, Math.min(Math.max(1, requested), maxByBinds));
    if (effective < requested) {
      this.logger.warn(
        `${methodName}: requested batch=${requested} would emit ${requested * cols} bind variables ` +
        `(>${POSTGRES_BIND_LIMIT} Postgres cap). Clamped to ${effective} (${cols} cols/row). ` +
        `Lower MARG_STAGING_BATCH_SIZE to silence this warning.`,
      );
    }
    return effective;
  }

  /**
   * Per-batch progress heartbeat for the bulk staging methods. Sets the
   * current entity and batch number and increments rows_processed by the
   * batch size. Does NOT change current_stage — that is owned by the
   * page-level orchestrator in runSync / resumeSync.
   *
   * Best-effort: a failed write must not abort the staging batch. If we
   * cannot update the heartbeat, the worst case is the scheduler's stale
   * recovery wakes up earlier than necessary, which is recoverable.
   */
  private async updateBatchProgress(
    syncLogId: string | null | undefined,
    entityType: string,
    batchNumber: number,
    rowsProcessedDelta: number,
  ): Promise<void> {
    if (!syncLogId) return;
    if (typeof this.margPrisma.margSyncLog?.update !== 'function') return;
    if (!Number.isFinite(rowsProcessedDelta) || rowsProcessedDelta < 0) return;
    try {
      await this.margPrisma.margSyncLog.update({
        where: { id: syncLogId },
        data: {
          currentEntityType: entityType,
          currentBatchNumber: batchNumber,
          rowsProcessed: { increment: BigInt(Math.floor(rowsProcessedDelta)) },
          lastHeartbeatAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `updateBatchProgress failed for syncLog=${syncLogId} entity=${entityType} batch=${batchNumber}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Operator-triggered retention sweep on the raw-page storage backend.
   * Thin pass-through so the controller does not have to inject the storage
   * service directly. No-op (returns zeros) when storage is not wired —
   * preserves the test-fixture pattern.
   */
  async cleanupRawPageStorage(maxAgeMs: number): Promise<{ syncDirsRemoved: number; bytesFreed: number; errors: string[] }> {
    if (!this.rawPageStorage) {
      return { syncDirsRemoved: 0, bytesFreed: 0, errors: [] };
    }
    return this.rawPageStorage.cleanupOldSyncDirectories(maxAgeMs);
  }

  /**
   * Operator-callable stale-sync recovery. Marks a RUNNING sync log as
   * FAILED_RETRYABLE if its lastHeartbeatAt is older than staleSyncAfterMs.
   *
   * Releases the config lock so a fresh sync (or a resume) can be started.
   * Does NOT auto-trigger resume — the operator decides whether to retry,
   * start fresh, or investigate.
   *
   * Returns the recovery outcome so the calling endpoint can report what
   * actually happened (recovered / not-stale / not-running).
   */
  async recoverStaleSyncLog(
    configId: string,
    tenantId: string,
    syncLogId: string,
  ): Promise<{
    syncLogId: string;
    outcome: 'recovered' | 'not_stale' | 'not_running' | 'not_found';
    previousStatus: string | null;
    heartbeatAgeMs: number | null;
  }> {
    const log = await this.margPrisma.margSyncLog.findFirst({
      where: { id: syncLogId, tenantId, configId },
    });
    if (!log) {
      return { syncLogId, outcome: 'not_found', previousStatus: null, heartbeatAgeMs: null };
    }
    if (log.status !== MARG_SYNC_STATUS.RUNNING) {
      return {
        syncLogId,
        outcome: 'not_running',
        previousStatus: log.status,
        heartbeatAgeMs: null,
      };
    }
    const heartbeatAt = log.lastHeartbeatAt ? new Date(log.lastHeartbeatAt) : null;
    const heartbeatAgeMs = heartbeatAt ? Date.now() - heartbeatAt.getTime() : null;
    // No heartbeat at all → also treat as stale, since the run cannot have
    // been making progress for the full duration since startedAt.
    const startedAt = log.startedAt ? new Date(log.startedAt).getTime() : Date.now();
    const ageReference = heartbeatAgeMs !== null ? heartbeatAgeMs : Date.now() - startedAt;
    if (ageReference < this.staleSyncAfterMs) {
      return {
        syncLogId,
        outcome: 'not_stale',
        previousStatus: log.status,
        heartbeatAgeMs,
      };
    }

    await this.margPrisma.margSyncLog.update({
      where: { id: syncLogId },
      data: {
        status: MARG_SYNC_STATUS.FAILED,
        currentStage: MARG_SYNC_STAGE.FAILED_RETRYABLE,
        failureType: MARG_FAILURE_TYPE.RETRYABLE,
        completedAt: new Date(),
        lastHeartbeatAt: new Date(),
        errors: [
          ...((Array.isArray(log.errors) ? log.errors : []) as unknown[]),
          {
            step: 'stale_recovery',
            message: `Heartbeat age ${ageReference}ms exceeded stale threshold ${this.staleSyncAfterMs}ms`,
            recoveredAt: new Date().toISOString(),
          },
        ] as any,
      },
    });

    // Release the config lock so a follow-up resume/sync can be triggered.
    await this.margPrisma.margSyncConfig.updateMany({
      where: { id: configId, tenantId },
      data: {
        lastSyncStatus: MARG_SYNC_STATUS.FAILED,
        lastAccountingSyncStatus: MARG_SYNC_STATUS.FAILED,
      },
    });

    return {
      syncLogId,
      outcome: 'recovered',
      previousStatus: MARG_SYNC_STATUS.RUNNING,
      heartbeatAgeMs,
    };
  }

  /**
   * Persist a Marg API page's payload to the raw-page storage backend and
   * record the metadata row in marg_raw_sync_pages with status=PENDING_STAGE.
   *
   * If the optional MargRawPageStorage dependency is not wired (tests / older
   * deployments), persistence is skipped silently and the function returns
   * null. Callers must treat null as "no resume safety net for this page" —
   * the sync continues, but a staging failure forces a full refetch on the
   * next run.
   *
   * If storage write fails (disk full, permissions), we log a warning, push
   * a non-fatal error onto the sync's errors array (caller responsibility:
   * pass a mutable errors[] reference), and return null. Refusing to stage
   * just because we cannot persist a recovery snapshot would be worse than
   * staging without one.
   */
  private async persistMargRawPage(args: {
    syncLogId: string;
    tenantId: string;
    configId: string;
    apiType: '1' | '2';
    companyId: number;
    requestIndex: number;
    payload: MargParsedPayload;
    encryptedSize?: number;
    errors?: Array<Record<string, unknown>>;
  }): Promise<string | null> {
    if (!this.rawPageStorage) return null;
    if (typeof this.margPrisma.margRawSyncPage?.upsert !== 'function') return null;

    const rowCounts: Record<string, number> = {
      Details: args.payload.Details.length,
      Masters: args.payload.Masters.length,
      MDis: args.payload.MDis.length,
      Party: args.payload.Party.length,
      Product: args.payload.Product.length,
      SaleType: args.payload.SaleType.length,
      Stock: args.payload.Stock.length,
      ACGroup: args.payload.ACGroup.length,
      Account: args.payload.Account.length,
      AcBal: args.payload.AcBal.length,
      PBal: args.payload.PBal.length,
      Outstanding: args.payload.Outstanding.length,
    };

    let descriptor: { storagePath: string; payloadHash: string; decryptedSize: number };
    try {
      descriptor = await this.rawPageStorage.save({
        tenantId: args.tenantId,
        configId: args.configId,
        syncLogId: args.syncLogId,
        apiType: args.apiType,
        companyId: args.companyId,
        requestIndex: args.requestIndex,
        parsedPayload: args.payload,
      });
    } catch (err) {
      this.logger.warn(
        `Marg raw-page storage write failed for syncLog=${args.syncLogId} apiType=${args.apiType} index=${args.requestIndex}: ${(err as Error).message}. ` +
        `Continuing sync without resume snapshot for this page.`,
      );
      args.errors?.push({
        step: 'raw_page_persist',
        apiType: args.apiType,
        requestIndex: args.requestIndex,
        error: (err as Error).message,
      });
      return null;
    }

    try {
      const row = await this.margPrisma.margRawSyncPage.upsert({
        where: {
          syncLogId_apiType_requestIndex: {
            syncLogId: args.syncLogId,
            apiType: args.apiType,
            requestIndex: args.requestIndex,
          },
        },
        create: {
          tenantId: args.tenantId,
          configId: args.configId,
          syncLogId: args.syncLogId,
          apiType: args.apiType,
          companyId: args.companyId,
          requestIndex: args.requestIndex,
          responseIndex: args.payload.Index,
          requestDateTime: null,
          responseDateTime: args.payload.DateTime || null,
          dataStatus: args.payload.DataStatus,
          encryptedSize: args.encryptedSize ?? null,
          decryptedSize: descriptor.decryptedSize,
          rowCounts,
          storagePath: descriptor.storagePath,
          payloadHash: descriptor.payloadHash,
          status: MARG_RAW_PAGE_STATUS.PENDING_STAGE,
          error: null as any,
        },
        update: {
          responseIndex: args.payload.Index,
          responseDateTime: args.payload.DateTime || null,
          dataStatus: args.payload.DataStatus,
          encryptedSize: args.encryptedSize ?? null,
          decryptedSize: descriptor.decryptedSize,
          rowCounts,
          storagePath: descriptor.storagePath,
          payloadHash: descriptor.payloadHash,
          status: MARG_RAW_PAGE_STATUS.PENDING_STAGE,
          error: null as any,
          stagedAt: null,
        },
        select: { id: true },
      });

      await this.updateSyncStage(args.syncLogId, MARG_SYNC_STAGE.RAW_PAGE_SAVED, {
        apiType: args.apiType,
        requestIndex: args.requestIndex,
        responseIndex: args.payload.Index,
      });

      return row.id as string;
    } catch (err) {
      // Storage succeeded but DB row write failed. Best-effort delete to avoid
      // orphaned files, then log and continue.
      this.logger.warn(
        `Marg raw-page row insert failed for syncLog=${args.syncLogId} apiType=${args.apiType} index=${args.requestIndex}: ${(err as Error).message}. ` +
        `Cleaning up orphaned storage file.`,
      );
      await this.rawPageStorage.delete({ storagePath: descriptor.storagePath }).catch(() => {/* best-effort */});
      args.errors?.push({
        step: 'raw_page_row',
        apiType: args.apiType,
        requestIndex: args.requestIndex,
        error: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * Mark a previously-persisted raw page as STAGED. Called only after every
   * staging method for that page has returned successfully. Failure to update
   * is non-fatal (the row remains PENDING_STAGE; the resume scan would
   * re-stage it next time, which is idempotent given upsert-only staging).
   */
  private async markRawPageStaged(rawPageRowId: string | null): Promise<void> {
    if (!rawPageRowId) return;
    if (typeof this.margPrisma.margRawSyncPage?.update !== 'function') return;
    try {
      await this.margPrisma.margRawSyncPage.update({
        where: { id: rawPageRowId },
        data: {
          status: MARG_RAW_PAGE_STATUS.STAGED,
          stagedAt: new Date(),
          error: null as any,
        },
      });
    } catch (err) {
      this.logger.warn(`markRawPageStaged failed for ${rawPageRowId}: ${(err as Error).message}`);
    }
  }

  /**
   * Mark a raw page as STAGING_FAILED with the classified error attached.
   * The classification feeds the resume endpoint's decision about whether
   * to offer retry — STAGING_FAILED rows whose error is FATAL are surfaced
   * to operators; RETRYABLE ones are picked up automatically on resume.
   */
  private async markRawPageStagingFailed(rawPageRowId: string | null, err: unknown): Promise<void> {
    if (!rawPageRowId) return;
    if (typeof this.margPrisma.margRawSyncPage?.update !== 'function') return;
    try {
      const classification = classifyMargSyncError(err);
      await this.margPrisma.margRawSyncPage.update({
        where: { id: rawPageRowId },
        data: {
          status: MARG_RAW_PAGE_STATUS.STAGING_FAILED,
          // Trim stack to a sane size so a single page error does not bloat
          // the row to MB. 4 KB of stack is enough to find the broken frame.
          error: {
            type: classification.type,
            errorCode: classification.errorCode,
            message: classification.message,
            stack: classification.stack ? classification.stack.slice(0, 4000) : undefined,
            failedAt: new Date().toISOString(),
          } as any,
        },
      });
    } catch (innerErr) {
      this.logger.warn(`markRawPageStagingFailed failed for ${rawPageRowId}: ${(innerErr as Error).message}`);
    }
  }

  /**
   * Finalize a sync log on failure with the proper failure classification
   * and structured error payload. Called from runSync's outer catch.
   *
   * The existing log already carries an `errors: []` JSON column; we append
   * the classified terminal error there in addition to setting the new
   * failureType column so old log readers still see the error and new ones
   * can branch on retryable vs fatal.
   */
  private classifyAndRecordSyncFailure(
    err: unknown,
    syncLogId: string,
    stage: MargSyncStage | null,
    apiType: string | null,
    requestIndex: number | null,
    entityType: string | null,
    batchNumber: number | null,
  ): {
    classification: ReturnType<typeof classifyMargSyncError>;
    structuredError: Record<string, unknown>;
  } {
    const classification = classifyMargSyncError(err);
    const structuredError: Record<string, unknown> = {
      step: 'fatal',
      classification: classification.type,
      errorCode: classification.errorCode,
      message: classification.message,
      stage,
      apiType,
      requestIndex,
      entityType,
      batchNumber,
      occurredAt: new Date().toISOString(),
    };
    if (classification.stack) {
      structuredError.stack = classification.stack.slice(0, 4000);
    }
    // Heartbeat one final time with the failed stage so observers see where
    // we stopped without having to wait for the next scheduled poll.
    void this.updateSyncStage(syncLogId, classification.type === 'FATAL'
      ? MARG_SYNC_STAGE.FAILED_FATAL
      : MARG_SYNC_STAGE.FAILED_RETRYABLE,
      { apiType: apiType ?? undefined, requestIndex, entityType, batchNumber },
    ).catch(() => {/* best-effort */});
    return { classification, structuredError };
  }


  private async markMissingStockAsDeleted(tenantId: string, syncLogId: string): Promise<void> {
    await this.margPrisma.margStock.updateMany({
      where: {
        tenantId,
        sourceDeleted: false,
        OR: [
          { lastSeenSyncLogId: null },
          { lastSeenSyncLogId: { not: syncLogId } },
        ],
      },
      data: { sourceDeleted: true },
    });
  }

  private async zeroOutMissingMargInventoryLevels(tenantId: string, activeInventoryKeys: Set<string>): Promise<void> {
    const historicalScopes = await this.margPrisma.margStock.findMany({
      where: { tenantId },
      select: { companyId: true, pid: true },
      distinct: ['companyId', 'pid'],
    });

    for (const scope of historicalScopes) {
      const productId = await this.resolveProductId(tenantId, scope.companyId, scope.pid);
      const locationId = await this.resolveLocationId(tenantId, scope.companyId);
      if (!productId || !locationId) continue;

      const inventoryKey = this.buildInventoryScopeKey(productId, locationId);
      if (activeInventoryKeys.has(inventoryKey)) continue;

      await this.prisma.inventoryLevel.upsert({
        where: {
          tenantId_productId_locationId: { tenantId, productId, locationId },
        },
        create: {
          tenantId,
          productId,
          locationId,
          onHandQty: new Prisma.Decimal(0),
          availableQty: new Prisma.Decimal(0),
          averageCost: null,
          inventoryValue: new Prisma.Decimal(0),
        },
        update: {
          onHandQty: new Prisma.Decimal(0),
          availableQty: new Prisma.Decimal(0),
          averageCost: null,
          inventoryValue: new Prisma.Decimal(0),
        },
      });
    }
  }

  private async closeMissingMargBatches(tenantId: string, activeBatchKeys: Set<string>): Promise<void> {
    const historicalBatches = await this.margPrisma.margStock.findMany({
      where: {
        tenantId,
        batch: { not: '_default' },
      },
      select: { companyId: true, pid: true, batch: true },
      distinct: ['companyId', 'pid', 'batch'],
    });

    for (const scope of historicalBatches) {
      const productId = await this.resolveProductId(tenantId, scope.companyId, scope.pid);
      const locationId = await this.resolveLocationId(tenantId, scope.companyId);
      if (!productId || !locationId) continue;

      const batchNumber = scope.batch.substring(0, 50);
      const batchKey = this.buildMargBatchScopeKey(productId, locationId, batchNumber);
      if (activeBatchKeys.has(batchKey)) continue;

      const existing = await this.prisma.batch.findFirst({
        where: { tenantId, productId, locationId, batchNumber },
        select: { id: true },
      });
      if (!existing) continue;

      await this.prisma.batch.update({
        where: { id: existing.id },
        data: {
          quantity: new Prisma.Decimal(0),
          availableQty: new Prisma.Decimal(0),
          status: BatchStatus.CONSUMED,
          notes: 'Synced from Marg EDE',
        },
      });
    }
  }

  private async resolveBatchId(
    tenantId: string,
    productId: string,
    locationId: string,
    batchNumber?: string | null,
  ): Promise<string | null> {
    const normalizedBatch = String(batchNumber || '').trim().substring(0, 50);
    if (!normalizedBatch) return null;

    const batch = await this.prisma.batch.findFirst({
      where: { tenantId, productId, locationId, batchNumber: normalizedBatch },
      select: { id: true },
    });

    return batch?.id ?? null;
  }

  private isProjectableCustomerParty(party: {
    cid?: string | null;
    parName?: string | null;
    parAddr?: string | null;
    parAdd1?: string | null;
    parAdd2?: string | null;
    gstNo?: string | null;
    phone1?: string | null;
    phone2?: string | null;
    phone3?: string | null;
    phone4?: string | null;
    route?: string | null;
    area?: string | null;
    credit?: number | Prisma.Decimal | null;
    crDays?: number | null;
    isDeleted?: boolean | null;
  }): boolean {
    const cid = String(party.cid || '').trim();
    const name = this.normalizePartyName(party.parName);
    if (!cid || !name || party.isDeleted) return false;
    if (name.includes('SUSPENSE')) return false;
    if (PSEUDO_PARTY_NAME_PATTERN.test(name) && !this.hasCustomerSignals(party)) {
      return false;
    }
    return true;
  }

  private hasCustomerSignals(party: {
    parAddr?: string | null;
    parAdd1?: string | null;
    parAdd2?: string | null;
    gstNo?: string | null;
    phone1?: string | null;
    phone2?: string | null;
    phone3?: string | null;
    phone4?: string | null;
    route?: string | null;
    area?: string | null;
    credit?: number | Prisma.Decimal | null;
    crDays?: number | null;
  }): boolean {
    return Boolean(
      String(party.parAddr || '').trim() ||
      String(party.parAdd1 || '').trim() ||
      String(party.parAdd2 || '').trim() ||
      String(party.gstNo || '').trim() ||
      String(party.phone1 || '').trim() ||
      String(party.phone2 || '').trim() ||
      String(party.phone3 || '').trim() ||
      String(party.phone4 || '').trim() ||
      String(party.route || '').trim() ||
      String(party.area || '').trim() ||
      party.credit != null ||
      party.crDays != null
    );
  }

  private normalizePartyName(value: string | null | undefined): string {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  private normalizeMargCode(value: unknown, maxLength = 20): string {
    return String(value || '').trim().toUpperCase().substring(0, maxLength);
  }

  private normalizeOptionalMargCode(value: unknown, maxLength = 20): string | null {
    const normalized = this.normalizeMargCode(value, maxLength);
    return normalized || null;
  }

  private normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
    const normalized = String(value || '').trim();
    return normalized ? normalized.substring(0, maxLength) : null;
  }

  private normalizeOptionalSearchText(value: string | null | undefined, maxLength: number): string | null {
    const normalized = this.normalizeOptionalText(value, maxLength);
    return normalized ? normalized.toUpperCase() : null;
  }

  private resolveMargEffectiveQuantity(
    qty: Prisma.Decimal | number | null | undefined,
    free: Prisma.Decimal | number | null | undefined,
  ): number {
    const numericQty = qty != null ? Number(qty) : 0;
    const numericFree = free != null ? Number(free) : 0;
    const safeQty = Number.isFinite(numericQty) ? numericQty : 0;
    const safeFree = Number.isFinite(numericFree) ? numericFree : 0;

    if (safeQty === 0 && safeFree === 0) {
      return 0;
    }

    const direction = safeQty < 0 ? -1 : 1;
    return safeQty + (direction * Math.abs(safeFree));
  }

  private resolveMargEffectiveCostMetrics(
    amount: Prisma.Decimal | number | null | undefined,
    effectiveQty: number,
  ): { unitCost: Prisma.Decimal | null; totalCost: Prisma.Decimal | null } {
    const numericAmount = amount != null ? Number(amount) : null;
    if (numericAmount == null || !Number.isFinite(numericAmount)) {
      return { unitCost: null, totalCost: null };
    }

    const totalCost = Math.abs(numericAmount);
    const absQty = Math.abs(effectiveQty);
    const unitCost = absQty > 0 ? totalCost / absQty : null;

    return {
      unitCost: unitCost != null ? new Prisma.Decimal(unitCost) : null,
      totalCost: new Prisma.Decimal(totalCost),
    };
  }

  private isMargPlaceholderPartyCode(value: unknown): boolean {
    const normalized = this.normalizeMargCode(value, 50);
    return ['0', '0.', '0.0', '0.00', 'N-1', 'NA', 'N/A', 'UNKNOWN'].includes(normalized);
  }

  private countTruthyPartySignals(party: {
    parAddr?: string | null;
    parAdd1?: string | null;
    parAdd2?: string | null;
    gstNo?: string | null;
    phone1?: string | null;
    phone2?: string | null;
    phone3?: string | null;
    phone4?: string | null;
    route?: string | null;
    area?: string | null;
    credit?: number | Prisma.Decimal | null;
    crDays?: number | null;
    dlNo?: string | null;
    pin?: string | null;
    lat?: string | null;
    lng?: string | null;
  }): number {
    return [
      party.parAddr,
      party.parAdd1,
      party.parAdd2,
      party.gstNo,
      party.phone1,
      party.phone2,
      party.phone3,
      party.phone4,
      party.route,
      party.area,
      party.dlNo,
      party.pin,
      party.lat,
      party.lng,
    ].filter((value) => String(value || '').trim()).length +
      (party.credit != null ? 1 : 0) +
      (party.crDays != null ? 1 : 0);
  }

  private buildMargPartyAddress(party?: {
    parAddr?: string | null;
    parAdd1?: string | null;
    parAdd2?: string | null;
  } | null): string | null {
    if (!party) return null;

    const address = [party.parAddr, party.parAdd1, party.parAdd2]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(', ')
      .substring(0, 1000);

    return address || null;
  }

  private selectCanonicalMargPartyRow<T extends {
    ID?: unknown;
    CID?: string | null;
    ParNam?: string | null;
    PARADD?: string | null;
    ParAdd1?: string | null;
    ParAdd2?: string | null;
    GSTNo?: string | null;
    Phone1?: string | null;
    Phone2?: string | null;
    Phone3?: string | null;
    Phone4?: string | null;
    Rout?: string | null;
    Area?: string | null;
    Credit?: number | null;
    CRDays?: number | null;
    DlNo?: string | null;
    Pin?: string | null;
    Lat?: string | null;
    Lng?: string | null;
    Is_Deleted?: string | boolean | null;
  }>(rows: T[]): T {
    return [...rows].sort((left, right) => {
      const leftProjectable = this.isProjectableCustomerParty({
        cid: left.CID,
        parName: left.ParNam,
        parAddr: left.PARADD,
        parAdd1: left.ParAdd1,
        parAdd2: left.ParAdd2,
        gstNo: left.GSTNo,
        phone1: left.Phone1,
        phone2: left.Phone2,
        phone3: left.Phone3,
        phone4: left.Phone4,
        route: left.Rout,
        area: left.Area,
        credit: left.Credit,
        crDays: left.CRDays,
        isDeleted: String(left.Is_Deleted) === '1' || left.Is_Deleted === true,
      }) ? 1 : 0;
      const rightProjectable = this.isProjectableCustomerParty({
        cid: right.CID,
        parName: right.ParNam,
        parAddr: right.PARADD,
        parAdd1: right.ParAdd1,
        parAdd2: right.ParAdd2,
        gstNo: right.GSTNo,
        phone1: right.Phone1,
        phone2: right.Phone2,
        phone3: right.Phone3,
        phone4: right.Phone4,
        route: right.Rout,
        area: right.Area,
        credit: right.Credit,
        crDays: right.CRDays,
        isDeleted: String(right.Is_Deleted) === '1' || right.Is_Deleted === true,
      }) ? 1 : 0;
      if (leftProjectable !== rightProjectable) {
        return rightProjectable - leftProjectable;
      }

      const leftSignals = this.countTruthyPartySignals({
        parAddr: left.PARADD,
        parAdd1: left.ParAdd1,
        parAdd2: left.ParAdd2,
        gstNo: left.GSTNo,
        phone1: left.Phone1,
        phone2: left.Phone2,
        phone3: left.Phone3,
        phone4: left.Phone4,
        route: left.Rout,
        area: left.Area,
        credit: left.Credit,
        crDays: left.CRDays,
        dlNo: left.DlNo,
        pin: left.Pin,
        lat: left.Lat,
        lng: left.Lng,
      });
      const rightSignals = this.countTruthyPartySignals({
        parAddr: right.PARADD,
        parAdd1: right.ParAdd1,
        parAdd2: right.ParAdd2,
        gstNo: right.GSTNo,
        phone1: right.Phone1,
        phone2: right.Phone2,
        phone3: right.Phone3,
        phone4: right.Phone4,
        route: right.Rout,
        area: right.Area,
        credit: right.Credit,
        crDays: right.CRDays,
        dlNo: right.DlNo,
        pin: right.Pin,
        lat: right.Lat,
        lng: right.Lng,
      });
      if (leftSignals !== rightSignals) {
        return rightSignals - leftSignals;
      }

      return this.toInt32(right.ID, 0) - this.toInt32(left.ID, 0);
    })[0];
  }

  private isProjectableSupplierParty(party: {
    cid?: string | null;
    parName?: string | null;
    parAddr?: string | null;
    parAdd1?: string | null;
    parAdd2?: string | null;
    gstNo?: string | null;
    phone1?: string | null;
    phone2?: string | null;
    phone3?: string | null;
    phone4?: string | null;
    route?: string | null;
    area?: string | null;
    credit?: number | Prisma.Decimal | null;
    crDays?: number | null;
    isDeleted?: boolean | null;
  }): boolean {
    const cid = String(party.cid || '').trim();
    const name = this.normalizePartyName(party.parName);
    if (!cid || !name || party.isDeleted || this.isMargPlaceholderPartyCode(cid)) return false;
    if (name.includes('SUSPENSE')) return false;
    if (PSEUDO_PARTY_NAME_PATTERN.test(name) && !this.hasCustomerSignals(party)) {
      return false;
    }
    return true;
  }

  private selectCanonicalMargPartyBalanceRow<T extends {
    ID?: unknown;
    Opening?: number | string | null;
    Balance?: number | string | null;
  }>(rows: T[]): T {
    return [...rows].sort((left, right) => {
      const leftMagnitude = Math.abs(Number(left.Opening ?? 0)) + Math.abs(Number(left.Balance ?? 0));
      const rightMagnitude = Math.abs(Number(right.Opening ?? 0)) + Math.abs(Number(right.Balance ?? 0));
      if (leftMagnitude !== rightMagnitude) {
        return rightMagnitude - leftMagnitude;
      }
      return this.toInt32(right.ID, 0) - this.toInt32(left.ID, 0);
    })[0];
  }

  private summarizeMargAccountPostingDuplicates(
    rows: Array<{
      companyId: number;
      voucher?: string | null;
      date: Date;
      book?: string | null;
      code?: string | null;
      code1?: string | null;
      gCode?: string | null;
      amount: Prisma.Decimal | number;
      remark?: string | null;
      margId?: bigint | number | string;
    }>,
  ): {
    duplicateFingerprintCount: number;
    duplicateRowCount: number;
    sample: Array<Record<string, unknown>>;
  } {
    const groups = new Map<string, Array<typeof rows[number]>>();

    for (const row of rows) {
      const fingerprint = [
        row.companyId,
        this.normalizeOptionalText(row.voucher, 50) || '',
        row.date.toISOString().slice(0, 10),
        this.normalizeOptionalText(row.book, 20) || '',
        this.normalizeMargCode(row.code),
        this.normalizeMargCode(row.code1),
        this.normalizeMargCode(row.gCode),
        Number(row.amount ?? 0).toFixed(4),
        this.normalizeOptionalSearchText(row.remark, 255) || '',
      ].join('|');

      const existing = groups.get(fingerprint);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(fingerprint, [row]);
      }
    }

    const duplicates = Array.from(groups.entries())
      .filter(([, groupedRows]) => groupedRows.length > 1)
      .map(([fingerprint, groupedRows]) => ({
        fingerprint,
        count: groupedRows.length,
        companyId: groupedRows[0].companyId,
        voucher: groupedRows[0].voucher || null,
        book: groupedRows[0].book || null,
        amount: Number(groupedRows[0].amount ?? 0),
        sampleMargIds: groupedRows.slice(0, 5).map((row) => String(row.margId ?? '')),
      }));

    return {
      duplicateFingerprintCount: duplicates.length,
      duplicateRowCount: duplicates.reduce((sum, duplicate) => sum + (duplicate.count - 1), 0),
      sample: duplicates.slice(0, 5),
    };
  }

  private createMargSyncDiagnostics(): MargSyncDiagnostics {
    return {
      freeQuantityRowCount: 0,
      freeOnlyRowCount: 0,
      freeQuantityUnits: 0,
      branchPayloadRowCount: 0,
      branchPayloadFallbackCount: 0,
      duplicatePartyKeyCount: 0,
      duplicatePartyRowCount: 0,
      duplicatePartyBalanceKeyCount: 0,
      duplicatePartyBalanceRowCount: 0,
      supplierCandidates: 0,
      suppliersProjected: 0,
      duplicateAccountPostingFingerprintCount: 0,
      duplicateAccountPostingRowCount: 0,
      skippedAccountingGroupsByReason: {},
    };
  }

  private takeUnseenMargBranchRows(rows: any[], seenCompanyIds: Set<string>): any[] {
    const nextRows: any[] = [];
    for (const row of rows) {
      const companyId = this.toInt32(row?.CompanyID, 0);
      if (companyId <= 0) continue;

      const companyKey = String(companyId);
      if (seenCompanyIds.has(companyKey)) continue;

      seenCompanyIds.add(companyKey);
      nextRows.push(row);
    }
    return nextRows;
  }

  private canonicalizeMargParties(rows: any[]): {
    rows: any[];
    duplicateKeyCount: number;
    duplicateRowCount: number;
  } {
    const grouped = new Map<string, any[]>();

    for (const row of rows) {
      const companyId = this.toInt32(row?.CompanyID, 0);
      const cid = String(row?.CID || '').trim();
      if (companyId <= 0 || !cid) {
        continue;
      }

      const key = `${companyId}|${cid.toUpperCase()}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.push(row);
      } else {
        grouped.set(key, [row]);
      }
    }

    const canonicalRows: any[] = [];
    let duplicateKeyCount = 0;
    let duplicateRowCount = 0;
    for (const groupedRows of grouped.values()) {
      if (groupedRows.length > 1) {
        duplicateKeyCount += 1;
        duplicateRowCount += groupedRows.length - 1;
      }
      canonicalRows.push(this.selectCanonicalMargPartyRow(groupedRows));
    }

    return { rows: canonicalRows, duplicateKeyCount, duplicateRowCount };
  }

  private canonicalizeMargPartyBalances(rows: any[]): {
    rows: any[];
    duplicateKeyCount: number;
    duplicateRowCount: number;
  } {
    const grouped = new Map<string, any[]>();

    for (const row of rows) {
      const companyId = this.toInt32(row?.CompanyID, 0);
      const cid = this.normalizeMargCode(row?.CID);
      if (companyId <= 0 || !cid) {
        continue;
      }

      const key = `${companyId}|${cid}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.push(row);
      } else {
        grouped.set(key, [row]);
      }
    }

    const canonicalRows: any[] = [];
    let duplicateKeyCount = 0;
    let duplicateRowCount = 0;
    for (const groupedRows of grouped.values()) {
      if (groupedRows.length > 1) {
        duplicateKeyCount += 1;
        duplicateRowCount += groupedRows.length - 1;
      }
      canonicalRows.push(this.selectCanonicalMargPartyBalanceRow(groupedRows));
    }

    return { rows: canonicalRows, duplicateKeyCount, duplicateRowCount };
  }

  private incrementReasonCount(counter: Record<string, number>, reason: string, value = 1): void {
    counter[reason] = (counter[reason] ?? 0) + value;
  }

  private buildMargSyncDiagnosticsErrorStep(diagnostics: MargSyncDiagnostics) {
    return {
      step: 'sync_diagnostics',
      diagnostics,
    };
  }

  private extractMargSyncErrorSteps(errors: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(errors)) {
      return [];
    }

    return errors
      .map((entry) => this.toRecord(entry))
      .filter((entry): entry is Record<string, unknown> => !!entry);
  }

  private extractMargSyncDiagnostics(errors: unknown): Record<string, unknown> | null {
    for (const step of this.extractMargSyncErrorSteps(errors)) {
      if (String(step.step ?? '') !== 'sync_diagnostics') {
        continue;
      }

      return this.toRecord(step.diagnostics) ?? null;
    }

    return null;
  }

  private toFiniteNumberOrNull(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private summarizeMargSyncIssues(errors: unknown) {
    return this.extractMargSyncErrorSteps(errors)
      .filter((step) => String(step.step ?? '') !== 'sync_diagnostics')
      .map((step) => ({
        step: String(step.step ?? 'unknown'),
        error: typeof step.error === 'string' ? step.error : null,
        skippedCount: this.toFiniteNumberOrNull(step.skippedCount),
        issueCount: this.toFiniteNumberOrNull(step.issueCount),
        warningCount: this.toFiniteNumberOrNull(step.warningCount),
        failureCount: this.toFiniteNumberOrNull(step.failureCount),
      }))
      .filter((step) => (
        step.error ||
        step.skippedCount !== null ||
        step.issueCount !== null ||
        step.warningCount !== null ||
        step.failureCount !== null
      ));
  }

  private async assertGlAccountExists(tenantId: string, glAccountId: string): Promise<void> {
    const glAccount = await this.prisma.gLAccount.findFirst({
      where: { id: glAccountId, tenantId },
      select: { id: true },
    });

    if (!glAccount) {
      throw new BadRequestException('GL account not found for this tenant');
    }
  }

  private looksLikeUuid(value: string | null | undefined): value is string {
    return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async resolveJournalPostingUserId(tenantId: string, triggeredBy?: string): Promise<string> {
    if (this.looksLikeUuid(triggeredBy)) {
      const user = await this.prisma.user.findFirst({
        where: { id: triggeredBy, tenantId },
        select: { id: true },
      });
      if (user) {
        return user.id;
      }
    }

    const fallbackUser = await this.prisma.user.findFirst({
      where: { tenantId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!fallbackUser) {
      throw new BadRequestException('Cannot post Marg accounting journals without a tenant user');
    }

    return fallbackUser.id;
  }

  private buildMargAccountJournalGroupKey(posting: {
    companyId: number;
    voucher?: string | null;
    date: Date;
    book?: string | null;
    margId?: bigint | number | string;
  }): string {
    const normalizedVoucher = this.normalizeOptionalText(posting.voucher, 50);
    const voucherPart = this.sanitizeMargGroupPart(
      String(normalizedVoucher || `ROW-${String(posting.margId ?? 'UNKNOWN')}`),
      80,
    );
    const bookPart = this.sanitizeMargGroupPart(this.normalizeMargCode(posting.book), 30);
    return `acct:${posting.companyId}:${posting.date.toISOString().slice(0, 10)}:${bookPart}:${voucherPart}`;
  }

  private buildMargAccountPostingGroup(posting: {
    companyId: number;
    voucher?: string | null;
    date: Date;
    book?: string | null;
    margId?: bigint | number | string;
  }): MargAccountPostingGroup {
    const voucher = this.normalizeOptionalText(posting.voucher, 50);
    return {
      companyId: posting.companyId,
      voucher,
      date: posting.date,
      book: this.normalizeOptionalText(posting.book, 20),
      sourceMargId: voucher ? null : this.toBigInt(posting.margId),
    };
  }

  private buildMargAccountPostingGroupWhere(
    tenantId: string,
    group: MargAccountPostingGroup,
  ): Prisma.MargAccountPostingWhereInput {
    if (!group.voucher && group.sourceMargId && group.sourceMargId > BigInt(0)) {
      return {
        tenantId,
        companyId: group.companyId,
        margId: group.sourceMargId,
      };
    }

    return {
      tenantId,
      companyId: group.companyId,
      date: group.date,
      book: group.book,
      voucher: group.voucher,
    };
  }

  private summarizeMargProbe(apiType: '1' | '2', payload: MargParsedPayload): MargConnectionProbeSummary {
    return {
      apiType,
      index: payload.Index,
      dataStatus: payload.DataStatus,
      dateTime: payload.DateTime,
      rowCounts: {
        details: payload.Details.length,
        masters: payload.Masters.length,
        vouchers: payload.MDis.length,
        parties: payload.Party.length,
        products: payload.Product.length,
        saleTypes: payload.SaleType.length,
        stock: payload.Stock.length,
        accountGroups: payload.ACGroup.length,
        accounts: payload.Account.length,
        accountGroupBalances: payload.AcBal.length,
        partyBalances: payload.PBal.length,
        outstandings: payload.Outstanding.length,
      },
    };
  }

  private sanitizeMargGroupPart(value: string, maxLength: number): string {
    const normalized = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_');
    return (normalized || 'NA').substring(0, maxLength);
  }

  private buildMargAccountGroupLookupKey(companyId: number, aid: string): string {
    return `${companyId}:${aid}`;
  }

  private buildAutoMargBootstrapHash(companyId: number, aid: string): string {
    return createHash('sha1').update(`${companyId}:${aid}`).digest('hex').slice(0, 4).toUpperCase();
  }

  private buildAutoMargGlAccountNumber(companyId: number, aid: string): string {
    const safeAid = this.sanitizeMargGroupPart(aid, 7).toUpperCase();
    const hash = this.buildAutoMargBootstrapHash(companyId, aid);
    return `M${companyId}-${safeAid}-${hash}`.substring(0, 20);
  }

  private buildAutoMargGlRuleName(companyId: number, aid: string): string {
    const safeAid = this.sanitizeMargGroupPart(aid, 48).toUpperCase();
    const hash = this.buildAutoMargBootstrapHash(companyId, aid);
    return `AUTO_MARG_${companyId}_${safeAid}_${hash}`.substring(0, 100);
  }

  private buildMargAccountGroupLineage(
    group: MargBootstrapAccountGroup,
    groupsByKey: Map<string, MargBootstrapAccountGroup>,
  ): MargBootstrapAccountGroup[] {
    const lineage: MargBootstrapAccountGroup[] = [];
    const visited = new Set<string>();
    let current: MargBootstrapAccountGroup | undefined = group;

    while (current) {
      const currentKey = this.buildMargAccountGroupLookupKey(current.companyId, current.aid);
      if (visited.has(currentKey)) {
        break;
      }

      visited.add(currentKey);
      lineage.unshift(current);

      if (!current.under) {
        break;
      }

      current = groupsByKey.get(this.buildMargAccountGroupLookupKey(current.companyId, current.under));
    }

    return lineage;
  }

  private buildMargAccountGroupHintText(
    group: MargBootstrapAccountGroup,
    groupsByKey: Map<string, MargBootstrapAccountGroup>,
  ): string {
    return this.buildMargAccountGroupLineage(group, groupsByKey)
      .map((item) => `${item.aid} ${item.name} ${item.addField ?? ''}`.trim().toUpperCase())
      .join(' | ');
  }

  private inferMargGlAccountClassification(
    group: MargBootstrapAccountGroup,
    groupsByKey: Map<string, MargBootstrapAccountGroup>,
  ): { accountType: GLAccountType; normalBalance: NormalBalance } {
    const hintText = this.buildMargAccountGroupHintText(group, groupsByKey);
    const rootAid = this.buildMargAccountGroupLineage(group, groupsByKey)[0]?.aid?.charAt(0).toUpperCase();

    if (/(ACCUMULATED DEPRECIATION|DEPRECIATION RESERVE|ALLOWANCE FOR BAD DEBTS|PROVISION FOR BAD DEBTS)/.test(hintText)) {
      return { accountType: GLAccountType.CONTRA_ASSET, normalBalance: NormalBalance.CREDIT };
    }

    if (/(\bASSET\b|BANK\b|CASH\b|DEBTOR|RECEIVABLE|STOCK|INVENTORY|DEPOSIT|ADVANCE.*ASSET)/.test(hintText)) {
      return { accountType: GLAccountType.ASSET, normalBalance: NormalBalance.DEBIT };
    }

    if (/(\bCAPITAL\b|\bEQUITY\b|RESERVES?\b|SURPLUS\b|SHARE\b)/.test(hintText)) {
      return { accountType: GLAccountType.EQUITY, normalBalance: NormalBalance.CREDIT };
    }

    if (/(\bLIABIL|PAYABLE|CREDITOR|OUTPUT TAX|GST PAYABLE|TAX PAYABLE|PROVISION\b|LOAN.*LIABIL)/.test(hintText)) {
      return { accountType: GLAccountType.LIABILITY, normalBalance: NormalBalance.CREDIT };
    }

    if (/(\bINCOME\b|\bSALES\b|\bREVENUE\b|DISCOUNT RECEIVED|INTEREST RECEIVED|COMMISSION RECEIVED)/.test(hintText)) {
      return { accountType: GLAccountType.REVENUE, normalBalance: NormalBalance.CREDIT };
    }

    if (/(\bEXPENSE\b|PURCHASE\b|COST OF GOODS|INPUT TAX|DISCOUNT ALLOWED|FREIGHT|SALARY|WAGES)/.test(hintText)) {
      return { accountType: GLAccountType.EXPENSE, normalBalance: NormalBalance.DEBIT };
    }

    switch (rootAid) {
      case 'B':
        return { accountType: GLAccountType.EQUITY, normalBalance: NormalBalance.CREDIT };
      case 'D':
      case 'F':
        return { accountType: GLAccountType.LIABILITY, normalBalance: NormalBalance.CREDIT };
      case 'H':
      case 'I':
        return { accountType: GLAccountType.EXPENSE, normalBalance: NormalBalance.DEBIT };
      case 'J':
      case 'K':
        return { accountType: GLAccountType.REVENUE, normalBalance: NormalBalance.CREDIT };
      case 'C':
      case 'E':
      default:
        return { accountType: GLAccountType.ASSET, normalBalance: NormalBalance.DEBIT };
    }
  }

  private isMargInventoryAssetGroup(
    group: MargBootstrapAccountGroup,
    groupsByKey: Map<string, MargBootstrapAccountGroup>,
  ): boolean {
    return /(\bSTOCK\b|\bINVENTORY\b)/.test(this.buildMargAccountGroupHintText(group, groupsByKey));
  }

  private isMargReceivableGroup(
    group: MargBootstrapAccountGroup,
    groupsByKey: Map<string, MargBootstrapAccountGroup>,
  ): boolean {
    return /(DEBTOR|RECEIVABLE)/.test(this.buildMargAccountGroupHintText(group, groupsByKey));
  }

  private async ensureMargAccountingBootstrap(tenantId: string): Promise<void> {
    const glAccountDelegate = this.prisma?.gLAccount;
    const mappingRuleDelegate = this.margPrisma?.margGLMappingRule;
    const accountGroupDelegate = this.margPrisma?.margAccountGroup;

    if (!glAccountDelegate?.count || !mappingRuleDelegate?.count || !accountGroupDelegate?.findMany || !this.prisma?.$transaction) {
      return;
    }

    const [glAccountCount, activeRuleCount] = await Promise.all([
      glAccountDelegate.count({ where: { tenantId } }),
      mappingRuleDelegate.count({ where: { tenantId, isActive: true } }),
    ]);

    if (glAccountCount > 0 || activeRuleCount > 0) {
      return;
    }

    const accountGroups = await accountGroupDelegate.findMany({
      where: { tenantId },
      orderBy: [{ companyId: 'asc' }, { aid: 'asc' }],
      select: {
        companyId: true,
        aid: true,
        name: true,
        under: true,
        addField: true,
      },
    });

    if (accountGroups.length === 0) {
      return;
    }

    const groupsByKey = new Map<string, MargBootstrapAccountGroup>(
      accountGroups.map((group: MargBootstrapAccountGroup) => [
        this.buildMargAccountGroupLookupKey(group.companyId, group.aid),
        group,
      ]),
    );

    await this.prisma.$transaction(async (tx: any) => {
      const provisionedAccounts = new Map<string, { id: string; parentId: string | null }>();

      for (const group of accountGroups as MargBootstrapAccountGroup[]) {
        const key = this.buildMargAccountGroupLookupKey(group.companyId, group.aid);
        const accountNumber = this.buildAutoMargGlAccountNumber(group.companyId, group.aid);
        const classification = this.inferMargGlAccountClassification(group, groupsByKey);
        const account = await tx.gLAccount.upsert({
          where: {
            tenantId_accountNumber: { tenantId, accountNumber },
          },
          create: {
            tenantId,
            accountNumber,
            name: group.name,
            accountType: classification.accountType,
            normalBalance: classification.normalBalance,
            isSystem: true,
            isActive: true,
            isInventoryAsset: this.isMargInventoryAssetGroup(group, groupsByKey),
            description: `Auto-provisioned from Marg account group ${group.companyId}:${group.aid}`,
          },
          update: {
            name: group.name,
            accountType: classification.accountType,
            normalBalance: classification.normalBalance,
            isSystem: true,
            isActive: true,
            isInventoryAsset: this.isMargInventoryAssetGroup(group, groupsByKey),
            description: `Auto-provisioned from Marg account group ${group.companyId}:${group.aid}`,
          },
        });

        provisionedAccounts.set(key, {
          id: account.id,
          parentId: account.parentId ?? null,
        });
      }

      for (const group of accountGroups as MargBootstrapAccountGroup[]) {
        if (!group.under) {
          continue;
        }

        const childKey = this.buildMargAccountGroupLookupKey(group.companyId, group.aid);
        const parentKey = this.buildMargAccountGroupLookupKey(group.companyId, group.under);
        const child = provisionedAccounts.get(childKey);
        const parent = provisionedAccounts.get(parentKey);

        if (!child || !parent || child.parentId === parent.id) {
          continue;
        }

        await tx.gLAccount.update({
          where: { id: child.id },
          data: { parentId: parent.id },
        });
      }

      for (const group of accountGroups as MargBootstrapAccountGroup[]) {
        const account = provisionedAccounts.get(this.buildMargAccountGroupLookupKey(group.companyId, group.aid));
        if (!account) {
          continue;
        }

        await tx.margGLMappingRule.create({
          data: {
            tenantId,
            ruleName: this.buildAutoMargGlRuleName(group.companyId, group.aid),
            companyId: group.companyId,
            groupCode: group.aid,
            glAccountId: account.id,
            priority: -100,
            isActive: true,
            isReceivableControl: this.isMargReceivableGroup(group, groupsByKey),
            description: `Auto-generated fallback mapping for Marg group ${group.aid}`,
          },
        });
      }
    }, {
      maxWait: 10000,
      timeout: 60000,
    });

    this.logger.log(
      `Auto-provisioned ${accountGroups.length} Marg GL accounts and fallback mapping rules for tenant ${tenantId}`,
    );
  }

  private resolveMargGlMappingRule(
    posting: {
      companyId: number;
      book?: string | null;
      gCode?: string | null;
      code?: string | null;
      code1?: string | null;
      remark?: string | null;
    },
    rules: Array<{
      id: string;
      companyId: number | null;
      bookCode: string | null;
      groupCode: string | null;
      partyCode: string | null;
      counterpartyCode: string | null;
      remarkContains: string | null;
      glAccountId: string;
      priority: number;
    }>,
  ) {
    const bookCode = this.normalizeOptionalMargCode(posting.book);
    const groupCode = this.normalizeOptionalMargCode(posting.gCode);
    const partyCode = this.normalizeOptionalMargCode(posting.code);
    const counterpartyCode = this.normalizeOptionalMargCode(posting.code1);
    const remark = this.normalizeOptionalSearchText(posting.remark, 255);
    let bestMatch: (typeof rules)[number] | null = null;
    let bestSpecificity = Number.NEGATIVE_INFINITY;
    let bestPriority = Number.NEGATIVE_INFINITY;

    for (const rule of rules) {
      if (rule.companyId != null && rule.companyId !== posting.companyId) {
        continue;
      }
      if (rule.bookCode && rule.bookCode !== bookCode) {
        continue;
      }
      if (rule.groupCode && rule.groupCode !== groupCode) {
        continue;
      }
      if (rule.partyCode && rule.partyCode !== partyCode) {
        continue;
      }
      if (rule.counterpartyCode && rule.counterpartyCode !== counterpartyCode) {
        continue;
      }
      if (rule.remarkContains && !remark?.includes(rule.remarkContains)) {
        continue;
      }

      const specificity =
        (rule.companyId != null ? 8 : 0) +
        (rule.bookCode ? 4 : 0) +
        (rule.groupCode ? 4 : 0) +
        (rule.partyCode ? 3 : 0) +
        (rule.counterpartyCode ? 3 : 0) +
        (rule.remarkContains ? 1 : 0);

      if (specificity > bestSpecificity || (specificity === bestSpecificity && rule.priority > bestPriority)) {
        bestMatch = rule;
        bestSpecificity = specificity;
        bestPriority = rule.priority;
      }
    }

    return bestMatch;
  }

  private buildMargJournalLineDescription(posting: {
    book?: string | null;
    voucher?: string | null;
    remark?: string | null;
    code?: string | null;
    code1?: string | null;
  }): string {
    const components = [
      posting.book ? `Book ${posting.book}` : null,
      posting.voucher ? `Voucher ${posting.voucher}` : null,
      posting.code ? `Code ${posting.code}` : null,
      posting.code1 ? `Code1 ${posting.code1}` : null,
      posting.remark ? posting.remark : null,
    ].filter(Boolean);
    return components.join(' | ').substring(0, 255) || 'Marg account posting';
  }

  private buildMargAccountJournalDescription(group: { voucher: string | null; book: string | null; date: Date }): string {
    const voucher = group.voucher ? `Voucher ${group.voucher}` : 'Voucherless posting group';
    const book = group.book ? `Book ${group.book}` : 'Book NA';
    return `Marg accounting journal - ${voucher} - ${book} - ${group.date.toISOString().slice(0, 10)}`.substring(0, 255);
  }

  private buildMargAccountJournalIdempotencyKey(groupKey: string, contentHash: string): string {
    return `MARG_JE:${groupKey}:${contentHash}`.substring(0, 100);
  }

  private buildMargAccountJournalContentHash(
    groupKey: string,
    group: { voucher: string | null; book: string | null; date: Date },
    lines: MargJournalLineDraft[],
  ): string {
    const payload = {
      groupKey,
      voucher: group.voucher || null,
      book: group.book || null,
      entryDate: group.date.toISOString().slice(0, 10),
      lines: lines
        .map((line) => ({
          glAccountId: line.glAccountId,
          debitAmount: Number(line.debitAmount.toFixed(4)),
          creditAmount: Number(line.creditAmount.toFixed(4)),
        }))
        .sort((left, right) => `${left.glAccountId}:${left.debitAmount}:${left.creditAmount}`
          .localeCompare(`${right.glAccountId}:${right.debitAmount}:${right.creditAmount}`)),
    };

    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private normalizeMargAccountingAmount(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    const normalized = Number(value.toFixed(4));
    return Object.is(normalized, -0) ? 0 : normalized;
  }

  private normalizeMargJournalLines(lines: MargJournalLineDraft[]): MargJournalLineDraft[] {
    const normalizedLines = lines.map((line) => ({
      ...line,
      debitAmount: this.normalizeMargAccountingAmount(line.debitAmount),
      creditAmount: this.normalizeMargAccountingAmount(line.creditAmount),
    }));

    let debitTotal = normalizedLines.reduce(
      (total, line) => this.normalizeMargAccountingAmount(total + line.debitAmount),
      0,
    );
    let creditTotal = normalizedLines.reduce(
      (total, line) => this.normalizeMargAccountingAmount(total + line.creditAmount),
      0,
    );

    if (debitTotal === creditTotal || !this.isWithinTolerance(debitTotal, creditTotal, ACCOUNTING_RECONCILIATION_TOLERANCE)) {
      return normalizedLines;
    }

    const debitShortfall = creditTotal > debitTotal;
    const delta = this.normalizeMargAccountingAmount(Math.abs(debitTotal - creditTotal));
    if (delta === 0) {
      return normalizedLines;
    }

    const candidate = normalizedLines
      .filter((line) => (debitShortfall ? line.debitAmount : line.creditAmount) > 0)
      .sort((left, right) =>
        debitShortfall
          ? right.debitAmount - left.debitAmount
          : right.creditAmount - left.creditAmount,
      )[0];

    if (!candidate) {
      return normalizedLines;
    }

    if (debitShortfall) {
      candidate.debitAmount = this.normalizeMargAccountingAmount(candidate.debitAmount + delta);
      debitTotal = this.normalizeMargAccountingAmount(debitTotal + delta);
    } else {
      candidate.creditAmount = this.normalizeMargAccountingAmount(candidate.creditAmount + delta);
      creditTotal = this.normalizeMargAccountingAmount(creditTotal + delta);
    }

    if (debitTotal !== creditTotal) {
      return normalizedLines;
    }

    return normalizedLines;
  }

  private isWithinTolerance(left: number, right: number, tolerance: number): boolean {
    return Math.abs(left - right) <= tolerance;
  }

  private async upsertMargReconciliationResult(
    tenantId: string,
    syncLogId: string,
    reconciliationType: MargReconciliationType,
    params: {
      status: MargReconciliationStatus;
      issueCount: number;
      summary: Record<string, unknown>;
      issues: Array<Record<string, unknown>>;
    },
  ): Promise<void> {
    await this.margPrisma.margReconciliationResult.upsert({
      where: {
        syncLogId_reconciliationType: {
          syncLogId,
          reconciliationType,
        },
      },
      create: {
        tenantId,
        syncLogId,
        reconciliationType,
        status: params.status,
        issueCount: params.issueCount,
        summary: params.summary,
        issues: params.issues.slice(0, MAX_RECONCILIATION_ISSUES),
        completedAt: new Date(),
      },
      update: {
        status: params.status,
        issueCount: params.issueCount,
        summary: params.summary,
        issues: params.issues.slice(0, MAX_RECONCILIATION_ISSUES),
        completedAt: new Date(),
      },
    });
  }

  private resolveMargLedgerEntryType(type: string): LedgerEntryType {
    const normalized = String(type || '').trim().toUpperCase();
    const ledgerMap: Record<string, LedgerEntryType> = {
      G: LedgerEntryType.LEDGER_ISSUE,
      S: LedgerEntryType.LEDGER_ISSUE,
      D: LedgerEntryType.LEDGER_ISSUE,
      P: LedgerEntryType.LEDGER_RECEIPT,
      R: LedgerEntryType.LEDGER_RETURN,
      X: LedgerEntryType.LEDGER_ADJUSTMENT,
      L: LedgerEntryType.LEDGER_SCRAP,
      B: LedgerEntryType.LEDGER_TRANSFER_OUT,
      V: LedgerEntryType.LEDGER_ADJUSTMENT,
      W: LedgerEntryType.LEDGER_SCRAP,
      O: LedgerEntryType.LEDGER_ADJUSTMENT,
    };
    return ledgerMap[normalized] ?? LedgerEntryType.LEDGER_ADJUSTMENT;
  }

  private resolveMargLedgerQuantity(type: string, qty: Prisma.Decimal | number | null): number {
    if (qty == null) return 0;
    const numericQty = Number(qty);
    if (!Number.isFinite(numericQty) || numericQty === 0) return 0;

    const normalized = String(type || '').trim().toUpperCase();
    const inboundTypes = new Set(['P', 'R', 'O']);
    const outboundTypes = new Set(['G', 'S', 'D', 'X', 'L', 'B', 'V', 'W']);

    if (inboundTypes.has(normalized)) return Math.abs(numericQty);
    if (outboundTypes.has(normalized)) return -Math.abs(numericQty);
    return numericQty;
  }

  private buildMargReferenceNumber(sourceKey: string): string {
    return `${MARG_REFERENCE_PREFIX}${sourceKey}`.slice(0, 50);
  }

  private buildMargInventoryTransactionIdempotencyKey(sourceKey: string): string {
    return `MARG_TX:${sourceKey}`.slice(0, 100);
  }

  private buildMargInventoryLedgerIdempotencyKey(sourceKey: string): string {
    return `MARG_LEDGER:${sourceKey}`.slice(0, 100);
  }

  private buildInventoryScopeKey(productId: string, locationId: string): string {
    return `${productId}|${locationId}`;
  }

  private buildMargBatchScopeKey(productId: string, locationId: string, batchNumber: string): string {
    return `${productId}|${locationId}|${batchNumber}`;
  }

  private async rebuildMargLedgerRunningBalances(tenantId: string, scopes: Set<string>): Promise<void> {
    const scopePairs = Array.from(scopes)
      .map((scope) => {
        const [productId, locationId] = scope.split('|');
        return productId && locationId ? { productId, locationId } : null;
      })
      .filter((scope): scope is { productId: string; locationId: string } => Boolean(scope));

    if (scopePairs.length === 0) return;

    const chunkSize = 100;
    this.logger.log(`Rebuilding Marg inventory ledger running balances for ${scopePairs.length} scope(s)`);

    for (let index = 0; index < scopePairs.length; index += chunkSize) {
      const chunk = scopePairs.slice(index, index + chunkSize);
      const values = Prisma.join(
        chunk.map((scope) => Prisma.sql`(${scope.productId}::uuid, ${scope.locationId}::uuid)`),
        ',',
      );

      await this.prisma.$executeRaw(Prisma.sql`
        WITH affected(product_id, location_id) AS (
          VALUES ${values}
        ),
        ranked AS (
          SELECT
            il.id,
            SUM(il.quantity) OVER (
              PARTITION BY il.product_id, il.location_id
              ORDER BY il.transaction_date ASC, il.sequence_number ASC, il.id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS running_balance
          FROM inventory_ledger il
          JOIN affected a
            ON a.product_id = il.product_id
           AND a.location_id = il.location_id
          WHERE il.tenant_id = ${tenantId}::uuid
        )
        UPDATE inventory_ledger target
           SET running_balance = ranked.running_balance
          FROM ranked
         WHERE target.id = ranked.id
           AND target.tenant_id = ${tenantId}::uuid
      `);
    }
  }

  /**
   * Extract a human-readable description of a fetch failure, including the
   * underlying `error.cause` chain that Node's `undici`-backed `fetch` hides
   * behind the generic "TypeError: fetch failed" wrapper.
   */
  private describeFetchError(error: unknown): { message: string; code: string | null; retryable: boolean } {
    const seen = new Set<unknown>();
    const parts: string[] = [];
    let code: string | null = null;
    let cur: unknown = error;
    let depth = 0;

    while (cur && !seen.has(cur) && depth < 8) {
      seen.add(cur);
      depth += 1;
      if (cur instanceof Error) {
        const name = cur.name || 'Error';
        const msg = cur.message || '';
        parts.push(`${name}: ${msg}`);
        const c = (cur as NodeJS.ErrnoException).code;
        if (c && !code) code = c;
        cur = (cur as { cause?: unknown }).cause;
      } else {
        parts.push(String(cur));
        break;
      }
    }

    const message = parts.join(' <- ') || String(error);
    // Codes that are worth retrying: server reset us mid-stream, transient
    // network blips, socket hangups during long downloads.
    const retryableCodes = new Set([
      'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND',
      'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
      'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT', 'UND_ERR_RESPONSE_STATUS_CODE',
      'UND_ERR_REQ_RETRY',
    ]);
    const retryable =
      (code !== null && retryableCodes.has(code)) ||
      /fetch failed|socket hang up|other side closed|premature close/i.test(message);

    return { message, code, retryable };
  }

  private async fetchJsonWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<unknown> {
    // The Marg API is an external service over the public internet streaming
    // hundreds of MB per page. Transient `ECONNRESET` / `socket hang up`
    // mid-stream is normal noise; without retry, one blip throws away an
    // entire 30-minute fetch and the sync stays in RUNNING for hours.
    const maxAttempts = this.parsePositiveInt(process.env.MARG_HTTP_MAX_ATTEMPTS, 3);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.fetchJsonOnce(url, init, timeoutMs);
      } catch (error) {
        lastError = error;

        // Application-level failures (BadRequestException) are not retryable —
        // those come from the Marg server explicitly telling us something
        // about the request (invalid JSON, FAILURE envelope, HTTP 4xx, etc.).
        if (error instanceof BadRequestException) {
          throw error;
        }

        const { message, code, retryable } = this.describeFetchError(error);
        if (!retryable || attempt >= maxAttempts) {
          this.logger.warn(
            `Marg API request to ${url} failed after attempt ${attempt}/${maxAttempts} ` +
            `[code=${code ?? 'n/a'}]: ${message}`,
          );
          throw new BadRequestException(`Marg API request error: ${message} [code=${code ?? 'n/a'}]`);
        }

        // Exponential backoff with jitter: 1s, 3s, 7s, ... capped at 30s.
        const backoff = Math.min(30000, 1000 * (2 ** (attempt - 1) + 1));
        const jitter = Math.floor(Math.random() * 500);
        const delay = backoff + jitter;
        this.logger.warn(
          `Marg API transient failure on attempt ${attempt}/${maxAttempts} ` +
          `[code=${code ?? 'n/a'}]: ${message}. Retrying in ${delay}ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Shouldn't reach here — the loop either returns or throws — but TypeScript
    // can't see that, so re-throw the last captured error.
    throw lastError instanceof Error
      ? lastError
      : new BadRequestException(`Marg API request error: ${String(lastError)}`);
  }

  private async fetchJsonOnce(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<unknown> {
    // We use `timeoutMs` as an *idle* timeout, not a total wall-clock deadline.
    // Marg responses for inventory/accounting pages can be hundreds of MB; the
    // server keeps streaming bytes for many minutes. A single hard deadline
    // aborts healthy long downloads. Resetting the timer whenever the headers
    // arrive or a body chunk lands aborts only when the connection truly stalls.
    const controller = new AbortController();
    let idleTimer: NodeJS.Timeout | null = null;
    let timedOut = false;
    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    };
    armIdleTimer();

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      armIdleTimer();

      let text = '';
      let receivedBytes = 0;
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              receivedBytes += value.byteLength;
              text += decoder.decode(value, { stream: true });
              armIdleTimer();
            }
          }
        } finally {
          text += decoder.decode();
          try { reader.releaseLock(); } catch { /* noop */ }
        }
      } else {
        text = await response.text();
        receivedBytes = text.length;
      }

      if (receivedBytes > 25 * 1024 * 1024) {
        this.logger.log(
          `Marg API streamed large response: ${(receivedBytes / (1024 * 1024)).toFixed(1)} MB from ${url}`,
        );
      }

      let parsed: unknown = {};
      if (text.trim()) {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new BadRequestException(`Marg API returned invalid JSON (HTTP ${response.status})`);
        }
      }

      if (!response.ok) {
        const message =
          typeof parsed === 'object' && parsed && 'Message' in parsed
            ? String((parsed as { Message?: unknown }).Message || response.statusText)
            : response.statusText;
        throw new BadRequestException(`Marg API request failed: ${message}`);
      }

      return parsed;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
        throw new BadRequestException(
          `Marg API request timed out after ${timeoutMs}ms of inactivity ` +
          `(no bytes received within the idle window). ` +
          `Increase MARG_DATA_HTTP_TIMEOUT_MS if Marg is genuinely this slow between chunks.`,
        );
      }

      // Re-throw the raw network/fetch error so the retry layer in
      // `fetchJsonWithTimeout` can inspect `error.cause` and decide whether
      // it's transient enough to retry.
      throw error;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  }

  private resolveEncryptionKey(): Buffer | null {
    const raw = (process.env.ENCRYPTION_KEY || '').trim();
    if (!raw) return null;

    if (/^[0-9a-fA-F]+$/.test(raw) && (raw.length === 32 || raw.length === 64)) {
      return Buffer.from(raw, 'hex');
    }

    if (raw.length === 16 || raw.length === 32) {
      return Buffer.from(raw, 'utf8');
    }

    this.logger.warn('ENCRYPTION_KEY format is invalid; storing Marg keys as plain text');
    return null;
  }

  private encryptSecret(value: string): string {
    if (!this.encryptionKey) return value;

    const algorithm = this.encryptionKey.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm';
    const iv = randomBytes(12);
    const cipher = createCipheriv(algorithm, this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `enc:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  private decryptSecret(value: string): string {
    if (!value.startsWith('enc:')) return value;
    if (!this.encryptionKey) {
      throw new BadRequestException('Encrypted Marg secret cannot be decrypted without ENCRYPTION_KEY');
    }

    const parts = value.split(':');
    if (parts.length !== 4) {
      throw new BadRequestException('Stored Marg secret has invalid format');
    }

    const [, ivB64, tagB64, cipherB64] = parts;
    const algorithm = this.encryptionKey.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm';
    const decipher = createDecipheriv(algorithm, this.encryptionKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherB64, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private maskSecret(value: string): string {
    if (!value) return '';
    if (value.length <= 6) return '*'.repeat(value.length);
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  private maskConfigSecrets<T extends { margKey: string; decryptionKey: string }>(config: T) {
    const { margKey, decryptionKey, ...rest } = config;
    return {
      ...rest,
      margKeyMasked: this.maskSecret(margKey.startsWith('enc:') ? 'encrypted' : margKey),
      decryptionKeyMasked: this.maskSecret(decryptionKey.startsWith('enc:') ? 'encrypted' : decryptionKey),
    };
  }

  // ===================== TEST CONNECTION =====================

  async testConnection(configId: string, user: AuthUser) {
    const config = await this.margPrisma.margSyncConfig.findFirst({
      where: { id: configId, tenantId: user.tenantId },
    });
    if (!config) throw new NotFoundException('Config not found');

    let result: {
      success: boolean;
      message: string;
      branches: any[];
      inventoryProbe?: MargConnectionProbeSummary;
      accountingProbe?: MargConnectionProbeSummary;
    };
    try {
      const margKey = this.decryptSecret(config.margKey);
      const decryptionKey = this.decryptSecret(config.decryptionKey);
      const branches = await this.fetchBranches({
        apiBaseUrl: config.apiBaseUrl,
        companyCode: config.companyCode,
      });

      const inventoryPayload = await this.fetchData({
        apiBaseUrl: config.apiBaseUrl,
        companyCode: config.companyCode,
        margKey,
        decryptionKey,
        companyId: config.companyId,
        index: 0,
        datetime: '',
        apiType: '2',
      });

      const accountingPayload = await this.fetchData({
        apiBaseUrl: config.apiBaseUrl,
        companyCode: config.companyCode,
        margKey,
        decryptionKey,
        companyId: config.companyId,
        index: 0,
        datetime: '',
        apiType: '1',
      });

      const inventoryProbe = this.summarizeMargProbe('2', inventoryPayload);
      const accountingProbe = this.summarizeMargProbe('1', accountingPayload);
      result = {
        success: true,
        message:
          `Connection successful. Found ${branches.length} branch(es). ` +
          `Inventory probe status=${inventoryProbe.dataStatus}. ` +
          `Accounting probe status=${accountingProbe.dataStatus}.`,
        branches,
        inventoryProbe,
        accountingProbe,
      };
    } catch (err) {
      result = {
        success: false,
        message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
        branches: [],
      };
    }

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.VIEW,
      'MargSyncConfig',
      configId,
      null,
      null,
      [],
      { action: 'test_connection', success: result.success, branchCount: result.branches.length, message: result.message },
    ).catch(() => {/* best-effort */});

    return result;
  }

  // ===================== DATA VIEW =====================

  async getStagedBranches(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margBranch.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.margPrisma.margBranch.count({ where: { tenantId } }),
    ]);
    return { items, total, page: safePage, pageSize: safePageSize };
  }

  async getStagedProducts(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margProduct.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.margPrisma.margProduct.count({ where: { tenantId } }),
    ]);
    return { items, total, page: safePage, pageSize: safePageSize };
  }

  async getStagedParties(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margParty.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.margPrisma.margParty.count({ where: { tenantId } }),
    ]);
    return { items, total, page: safePage, pageSize: safePageSize };
  }

  async getStagedTransactions(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margTransaction.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: { date: 'desc' },
      }),
      this.margPrisma.margTransaction.count({ where: { tenantId } }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        margId: item.margId.toString(),
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  async getStagedStock(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margStock.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.margPrisma.margStock.count({ where: { tenantId } }),
    ]);
    return { items, total, page: safePage, pageSize: safePageSize };
  }

  async getStagedAccountPostings(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margAccountPosting.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: [
          { date: 'desc' },
          { margId: 'desc' },
        ],
      }),
      this.margPrisma.margAccountPosting.count({ where: { tenantId } }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        margId: item.margId.toString(),
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  async getStagedAccountGroups(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margAccountGroup.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.margPrisma.margAccountGroup.count({ where: { tenantId } }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        margId: item.margId.toString(),
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  async getStagedAccountGroupBalances(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margAccountGroupBalance.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.margPrisma.margAccountGroupBalance.count({ where: { tenantId } }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        margId: item.margId.toString(),
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  async getStagedPartyBalances(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margPartyBalance.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.margPrisma.margPartyBalance.count({ where: { tenantId } }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        margId: item.margId.toString(),
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  async getStagedOutstandings(tenantId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(500, Math.max(1, pageSize));
    const skip = (safePage - 1) * safePageSize;
    const [items, total] = await Promise.all([
      this.margPrisma.margOutstanding.findMany({
        where: { tenantId },
        skip,
        take: safePageSize,
        orderBy: [
          { date: 'desc' },
          { margId: 'desc' },
        ],
      }),
      this.margPrisma.margOutstanding.count({ where: { tenantId } }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        margId: item.margId.toString(),
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  // ===================== SYNC OVERVIEW =====================

  async getSyncOverview(tenantId: string) {
    const [
      configs,
      branchCount,
      productCount,
      partyCount,
      txnCount,
      stockCount,
      deletedStockCount,
      accountGroupCount,
      accountPostingCount,
      accountGroupBalanceCount,
      partyBalanceCount,
      outstandingCount,
      projectedActualCount,
      projectedInventoryTransactionCount,
      projectedJournalEntryCount,
      mappingRuleCount,
      reconciliationCount,
      recentSyncLogs,
      recentReconciliationIssues,
    ] = await Promise.all([
      this.margPrisma.margSyncConfig.findMany({
        where: { tenantId },
        select: {
          id: true,
          companyCode: true,
          isActive: true,
          lastSyncAt: true,
          lastSyncStatus: true,
          lastAccountingSyncAt: true,
          lastAccountingSyncStatus: true,
          syncFrequency: true,
        },
      }),
      this.margPrisma.margBranch.count({ where: { tenantId } }),
      this.margPrisma.margProduct.count({ where: { tenantId } }),
      this.margPrisma.margParty.count({ where: { tenantId } }),
      this.margPrisma.margTransaction.count({ where: { tenantId } }),
      this.margPrisma.margStock.count({ where: { tenantId, sourceDeleted: false } }),
      this.margPrisma.margStock.count({ where: { tenantId, sourceDeleted: true } }),
      this.margPrisma.margAccountGroup.count({ where: { tenantId } }),
      this.margPrisma.margAccountPosting.count({ where: { tenantId } }),
      this.margPrisma.margAccountGroupBalance.count({ where: { tenantId } }),
      this.margPrisma.margPartyBalance.count({ where: { tenantId } }),
      this.margPrisma.margOutstanding.count({ where: { tenantId } }),
      this.prisma.actual.count({
        where: {
          tenantId,
          sourceSystem: MARG_SOURCE_SYSTEM,
        },
      }),
      this.prisma.inventoryTransaction.count({
        where: {
          tenantId,
          referenceType: MARG_SOURCE_SYSTEM,
        },
      }),
      this.prisma.journalEntry.count({
        where: {
          tenantId,
          referenceType: MARG_ACCOUNTING_REFERENCE_TYPE,
        },
      }),
      this.margPrisma.margGLMappingRule.count({ where: { tenantId, isActive: true } }),
      this.margPrisma.margReconciliationResult.count({ where: { tenantId } }),
      this.margPrisma.margSyncLog.findMany({
        where: { tenantId },
        select: {
          id: true,
          configId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          errors: true,
        },
        orderBy: { startedAt: 'desc' },
        take: 10,
      }),
      this.margPrisma.margReconciliationResult.findMany({
        where: {
          tenantId,
          status: { not: MargReconciliationStatus.PASSED },
        },
        select: {
          id: true,
          syncLogId: true,
          reconciliationType: true,
          status: true,
          issueCount: true,
          startedAt: true,
          completedAt: true,
          summary: true,
        },
        orderBy: [
          { createdAt: 'desc' },
          { reconciliationType: 'asc' },
        ],
        take: 10,
      }),
    ]);

    const recentSyncDiagnostics = recentSyncLogs
      .map((syncLog) => {
        const diagnostics = this.extractMargSyncDiagnostics(syncLog.errors);
        const issueSteps = this.summarizeMargSyncIssues(syncLog.errors);
        if (!diagnostics && issueSteps.length === 0) {
          return null;
        }

        return {
          syncLogId: syncLog.id,
          configId: syncLog.configId,
          status: syncLog.status,
          startedAt: syncLog.startedAt,
          completedAt: syncLog.completedAt,
          diagnostics,
          issueSteps,
        };
      })
      .filter((syncLog): syncLog is NonNullable<typeof syncLog> => !!syncLog);

    return {
      configs,
      stagedData: {
        branches: branchCount,
        products: productCount,
        parties: partyCount,
        transactions: txnCount,
        stock: stockCount,
        deletedStock: deletedStockCount,
        accountGroups: accountGroupCount,
        accountPostings: accountPostingCount,
        accountGroupBalances: accountGroupBalanceCount,
        partyBalances: partyBalanceCount,
        outstandings: outstandingCount,
        glMappingRules: mappingRuleCount,
        reconciliationResults: reconciliationCount,
      },
      projectedData: {
        actuals: projectedActualCount,
        inventoryTransactions: projectedInventoryTransactionCount,
        journalEntries: projectedJournalEntryCount,
      },
      diagnostics: {
        recentSyncDiagnostics,
        recentReconciliationIssues,
      },
    };
  }
}
