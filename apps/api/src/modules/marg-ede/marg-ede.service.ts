import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    ActualType,
    AuditAction,
    BatchStatus,
    CustomerType,
    DimensionStatus,
    GLAccountType,
    InventoryTransactionType,
    JournalEntryStatus,
    LedgerEntryType,
    LocationType,
    MargReconciliationStatus,
    MargReconciliationType,
    NormalBalance,
    PeriodType,
    Prisma,
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
import { decryptMargCompressedPayload, decryptMargPayload } from './marg-decrypt.util';
import { MARG_SYNC_MODE, MARG_SYNC_SCOPE, MargSyncMode, MargSyncScope } from './marg-sync.types';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly accountingService: AccountingService,
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

  async getSyncLogs(configId: string, user: AuthUser) {
    return this.margPrisma.margSyncLog.findMany({
      where: { configId, tenantId: user.tenantId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
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

  /** Fetch main data (POST, encrypted response) */
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
    const margOrigin = this.resolveMargOrigin(config.apiBaseUrl);
    const url = `${margOrigin}/api/eOnlineData/MargCorporateEDE`;
    const apiType = config.apiType ?? '2';

    const body = {
      CompanyCode: config.companyCode,
      Datetime: config.datetime || '',
      MargKey: config.margKey,
      Index: String(config.index),
      CompanyID: String(config.companyId),
      APIType: apiType,
    };

    this.logger.log(`Fetching Marg EDE data: apiType=${apiType}, index=${config.index}, datetime=${config.datetime || '(all)'}`);

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

    // Marg returns different response shapes by tenant/APIType:
    // 1) JSON envelope with Data field
    // 2) raw encrypted string (response body itself)
    let parsedPayload: Record<string, unknown>;
    if (typeof rawResponse === 'string') {
      parsedPayload = this.parseMargStringPayload(rawResponse, config.decryptionKey);
    } else if (rawEnvelope) {
      if (typeof rawEnvelope.Data === 'string' && rawEnvelope.Data.trim().length > 0) {
        parsedPayload = this.parseMargStringPayload(rawEnvelope.Data, config.decryptionKey);
      } else if (rawEnvelope.Data && typeof rawEnvelope.Data === 'object') {
        parsedPayload = rawEnvelope.Data as Record<string, unknown>;
      } else {
        parsedPayload = rawEnvelope;
      }
    } else {
      throw new BadRequestException('Marg API returned unexpected response shape');
    }

    const detailsContainer = this.toRecord(parsedPayload.Details);
    const dataSection = detailsContainer ?? parsedPayload;

    const payloadStatus = String(
      this.readFirstDefined([dataSection, parsedPayload], ['Status', 'status']) ?? '',
    ).trim().toUpperCase();
    if (payloadStatus === 'FAILURE') {
      const failureMessage = String(
        this.readFirstDefined([dataSection, parsedPayload, rawEnvelope], ['Message', 'message']) ?? 'Unknown error',
      );
      throw new BadRequestException(`Marg API failure: ${failureMessage}`);
    }

    const parsedIndex = Number(
      this.readFirstDefined([dataSection, parsedPayload, rawEnvelope], ['Index']) ?? 0,
    );
    const rawDataStatus = this.readFirstDefined(
      [dataSection, parsedPayload, rawEnvelope],
      ['DataStatus', 'Datastatus'],
    );
    // Marg returns DataStatus as numeric 10 or string "Completed" depending on tenant/version
    const parsedDataStatus = this.normalizeDataStatus(rawDataStatus);
    const parsedDateTime = String(
      this.readFirstDefined([dataSection, parsedPayload, rawEnvelope], ['DateTime', 'Datetime']) ?? '',
    ).trim();

    return {
      Details: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Details', 'Dis'])),
      Masters: this.toEntityArray(this.readFirstDefined([dataSection, parsedPayload], ['Masters'])),
      MDis: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['MDis'])),
      Party: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Party'])),
      Product: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Product'])),
      SaleType: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['SaleType'])),
      Stock: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Stock'])),
      ACGroup: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['ACGroup'])),
      Account: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Account'])),
      AcBal: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['AcBal'])),
      PBal: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['PBal'])),
      Outstanding: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Outstanding'])),
      Index: Number.isFinite(parsedIndex) ? parsedIndex : 0,
      DataStatus: Number.isFinite(parsedDataStatus) ? parsedDataStatus : 0,
      DateTime: parsedDateTime,
    };
  }

  // ===================== FULL SYNC ORCHESTRATOR =====================

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
    const shouldCommitCursor = shouldFetchFromMarg && !fromDate && !endDate;
    const shouldProcessStockSnapshot = !endDate;

    // When fromDate is provided, override the stored cursor to fetch from that date.
    // Index resets to 0 so the Marg API returns data starting from the specified date.
    let currentIndex = shouldFetchFromMarg && fromDate ? 0 : config.lastSyncIndex;
    let lastDatetime = shouldFetchFromMarg && fromDate ? fromDate : config.lastSyncDatetime || '';
    let accountingIndex = shouldFetchFromMarg && fromDate ? 0 : (config.lastAccountingSyncIndex ?? 0);
    let accountingDatetime = shouldFetchFromMarg && fromDate ? fromDate : config.lastAccountingSyncDatetime || '';
    const getActiveCursor = () => ({
      syncIndex: shouldRunInventory ? currentIndex : accountingIndex,
      syncDatetime: (shouldRunInventory ? lastDatetime : accountingDatetime) || null,
    });

    // Create sync log
    const syncLog = await this.margPrisma.margSyncLog.create({
      data: {
        tenantId,
        configId,
        status: MARG_SYNC_STATUS.RUNNING,
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
            const count = await this.syncProducts(tenantId, payloadProducts);
            productsCount += count;
          }

          if (payloadParties.length > 0) {
            const canonicalParties = this.canonicalizeMargParties(payloadParties);
            diagnostics.duplicatePartyKeyCount += canonicalParties.duplicateKeyCount;
            diagnostics.duplicatePartyRowCount += canonicalParties.duplicateRowCount;
            const count = await this.syncParties(tenantId, canonicalParties.rows);
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
            const count = await this.syncTransactions(tenantId, payloadDetails, dateWindow);
            transactionsCount += count;
          }

          if (shouldProcessStockSnapshot && payloadStock.length > 0) {
            receivedStockSnapshot = true;
            const count = await this.syncStockData(tenantId, payloadStock, syncLog.id);
            stockCount += count;
          }

          if (payloadVouchers.length > 0) {
            const count = await this.syncVouchers(tenantId, payloadVouchers, dateWindow);
            vouchersCount += count;
          }

          if (payloadSaleTypes.length > 0) {
            const count = await this.syncSaleTypes(tenantId, payloadSaleTypes);
            saleTypesCount += count;
          }

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

        const payloadAccountingVouchers = Array.isArray(payload.MDis) ? payload.MDis : [];
        const payloadAccountGroups = Array.isArray(payload.ACGroup) ? payload.ACGroup : [];
        const payloadAccountRows = Array.isArray(payload.Account) ? payload.Account : [];
        const payloadAccountBalances = Array.isArray(payload.AcBal) ? payload.AcBal : [];
        const payloadPartyBalances = Array.isArray(payload.PBal) ? payload.PBal : [];
        const payloadOutstandings = Array.isArray(payload.Outstanding) ? payload.Outstanding : [];

        if (!shouldRunInventory && payloadAccountingVouchers.length > 0) {
          const count = await this.syncVouchers(tenantId, payloadAccountingVouchers, dateWindow);
          vouchersCount += count;
        }

        if (payloadAccountGroups.length > 0) {
          const count = await this.syncAccountGroups(tenantId, payloadAccountGroups);
          accountGroupsCount += count;
        }

        if (payloadAccountRows.length > 0) {
          const count = await this.syncAccountPostings(tenantId, payloadAccountRows, dateWindow);
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
          const count = await this.syncOutstandings(tenantId, payloadOutstandings, dateWindow);
          outstandingsCount += count;
        }

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

      if (shouldFetchFromMarg && shouldRunInventory && shouldProcessStockSnapshot && receivedStockSnapshot) {
        await this.markMissingStockAsDeleted(tenantId, syncLog.id);
      } else if (shouldFetchFromMarg && shouldRunInventory && shouldProcessStockSnapshot && !receivedStockSnapshot) {
        this.logger.warn(
          'Marg sync received no stock snapshot rows; preserving previously staged stock and skipping stock-derived projections for this run',
        );
      }

      // Step 3: Transform staged data → core tables
      const shouldResetInventoryProjection = shouldRunInventory && (mode === MARG_SYNC_MODE.REPROJECT || Boolean(dateWindow));
      const shouldApplyStockProjection = shouldProcessStockSnapshot && (!shouldFetchFromMarg || receivedStockSnapshot);
      let inventoryProjectionReset: MargInventoryProjectionResetResult | null = null;
      if (shouldRunInventory) {
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        await this.transformBranches(tenantId);
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
        await this.touchSyncHeartbeat(configId, shouldRunInventory);
        if (shouldResetInventoryProjection) {
          inventoryProjectionReset = await this.resetMargInventoryProjectionWindow(tenantId, dateWindow);
          await this.touchSyncHeartbeat(configId, shouldRunInventory);
        }
        await this.transformTransactionsToActuals(tenantId, dateWindow, shouldResetInventoryProjection);
        if (shouldApplyStockProjection) {
          await this.touchSyncHeartbeat(configId, shouldRunInventory);
          await this.transformStockToInventoryLevels(tenantId);
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

      if (accountingProjection) {
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
      errors.push({ step: 'fatal', error: String(err) });

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
        { status: 'FAILED', error: String(err), products: productsCount, parties: partiesCount, transactions: transactionsCount },
        [],
        { configId, triggeredBy, action: shouldFetchFromMarg ? 'marg_sync_failed' : 'marg_reprojection_failed', scope, mode },
      ).catch(() => {/* best-effort */});

      throw err;
    }

    return syncLog.id;
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

  // ===================== STAGING: UPSERT RAW DATA =====================

  private async syncBranches(tenantId: string, branches: any[]): Promise<number> {
    let count = 0;
    for (const b of branches) {
      const companyId = this.toInt32(b.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(b.ID, 0);

      await this.margPrisma.margBranch.upsert({
        where: {
          tenantId_companyId: { tenantId, companyId },
        },
        create: {
          tenantId,
          margId,
          companyId,
          code: String(b.Code || '').trim() || null,
          name: String(b.Name || '').trim(),
          storeId: String(b.StoreID || '').trim() || null,
          licence: String(b.Licence || '').trim() || null,
          branch: String(b.Branch || '').trim() || null,
          rawData: b,
        },
        update: {
          margId,
          code: String(b.Code || '').trim() || null,
          name: String(b.Name || '').trim(),
          storeId: String(b.StoreID || '').trim() || null,
          licence: String(b.Licence || '').trim() || null,
          branch: String(b.Branch || '').trim() || null,
          rawData: b,
        },
      });
      count++;
    }
    return count;
  }

  private async syncProducts(tenantId: string, products: any[]): Promise<number> {
    let count = 0;
    for (const p of products) {
      const companyId = this.toInt32(p.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(p.ID, 0);
      const pid = String(p.PID || p.Code || '').trim();
      if (!pid) continue;

      await this.margPrisma.margProduct.upsert({
        where: {
          tenantId_companyId_pid: { tenantId, companyId, pid },
        },
        create: {
          tenantId,
          margId,
          companyId,
          pid,
          code: String(p.Code || pid).trim(),
          name: String(p.Name || '').trim(),
          unit: String(p.Unit || '').trim() || null,
          pack: p.Pack != null ? Number(p.Pack) : null,
          gCode: String(p.GCode || '').trim() || null,
          gCode3: String(p.GCode3 || '').trim() || null,
          gCode5: String(p.GCode5 || '').trim() || null,
          gCode6: String(p.GCode6 || '').trim() || null,
          gst: p.GST != null ? Number(p.GST) : null,
          margCode: String(p.MargCode || '').trim() || null,
          addField: String(p.AddField || '').trim() || null,
          rawData: p,
        },
        update: {
          margId,
          code: String(p.Code || pid).trim(),
          name: String(p.Name || '').trim(),
          unit: String(p.Unit || '').trim() || null,
          pack: p.Pack != null ? Number(p.Pack) : null,
          gCode: String(p.GCode || '').trim() || null,
          gCode3: String(p.GCode3 || '').trim() || null,
          gCode5: String(p.GCode5 || '').trim() || null,
          gCode6: String(p.GCode6 || '').trim() || null,
          gst: p.GST != null ? Number(p.GST) : null,
          margCode: String(p.MargCode || '').trim() || null,
          addField: String(p.AddField || '').trim() || null,
          rawData: p,
        },
      });
      count++;
    }
    return count;
  }

  private async syncParties(tenantId: string, parties: any[]): Promise<number> {
    let count = 0;
    for (const p of parties) {
      const companyId = this.toInt32(p.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(p.ID, 0);
      const cid = String(p.CID || '').trim();
      if (!cid) continue;

      await this.margPrisma.margParty.upsert({
        where: {
          tenantId_companyId_cid: { tenantId, companyId, cid },
        },
        create: {
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
        },
        update: {
          margId,
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
        },
      });
      count++;
    }
    return count;
  }

  private async syncTransactions(tenantId: string, details: any[], dateWindow: DateWindow | null): Promise<number> {
    let count = 0;
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

      await this.margPrisma.margTransaction.upsert({
        where: {
          tenantId_companyId_sourceKey: { tenantId, companyId, sourceKey },
        },
        create: {
          tenantId,
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
        },
        update: {
          margId,
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
        },
      });
      count++;
    }
    return count;
  }

  private async syncStockData(tenantId: string, stockItems: any[], syncLogId: string): Promise<number> {
    let count = 0;
    for (const s of stockItems) {
      const companyId = this.toInt32(s.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(s.ID || s.Id, 0);
      const pid = String(s.PID || '').trim();
      const batch = String(s.Batch || '').trim() || '_default';
      if (!pid) continue;

      await this.margPrisma.margStock.upsert({
        where: {
          tenantId_companyId_pid_batch: { tenantId, companyId, pid, batch },
        },
        create: {
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
          sourceDeleted: false,
          lastSeenSyncLogId: syncLogId,
          rawData: s,
        },
        update: {
          margId,
          gCode: String(s.GCode || '').trim() || null,
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
          sourceDeleted: false,
          lastSeenSyncLogId: syncLogId,
          rawData: s,
        },
      });
      count++;
    }
    return count;
  }

  private async syncVouchers(tenantId: string, mdis: any[], dateWindow: DateWindow | null): Promise<number> {
    let count = 0;
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

      await this.margPrisma.margVoucher.upsert({
        where: {
          tenantId_companyId_voucher_type: { tenantId, companyId, voucher, type },
        },
        create: {
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
        },
        update: {
          margId,
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
        },
      });
      count++;
    }
    return count;
  }

  private async syncAccountGroups(tenantId: string, accountGroups: any[]): Promise<number> {
    let count = 0;
    for (const group of accountGroups) {
      const companyId = this.toInt32(group.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(group.ID);
      if (margId <= BigInt(0)) continue;

      const aid = this.normalizeMargCode(group.AID);
      if (!aid) continue;

      await this.margPrisma.margAccountGroup.upsert({
        where: {
          tenantId_companyId_aid: { tenantId, companyId, aid },
        },
        create: {
          tenantId,
          margId,
          companyId,
          aid,
          name: String(group.Name || '').trim(),
          under: this.normalizeMargCode(group.Under) || null,
          addField: String(group.AddField || '').trim() || null,
          rawData: group,
        },
        update: {
          margId,
          name: String(group.Name || '').trim(),
          under: this.normalizeMargCode(group.Under) || null,
          addField: String(group.AddField || '').trim() || null,
          rawData: group,
        },
      });
      count++;
    }

    return count;
  }

  private async syncAccountPostings(
    tenantId: string,
    postings: any[],
    dateWindow: DateWindow | null,
  ): Promise<number> {
    let count = 0;
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

      await this.margPrisma.margAccountPosting.upsert({
        where: {
          tenantId_companyId_margId: { tenantId, companyId, margId },
        },
        create: {
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
        },
        update: {
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
        },
      });
      count++;
    }

    return count;
  }

  private async syncAccountGroupBalances(tenantId: string, balances: any[]): Promise<number> {
    let count = 0;
    for (const balance of balances) {
      const companyId = this.toInt32(balance.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(balance.ID);
      if (margId <= BigInt(0)) continue;

      const aid = this.normalizeMargCode(balance.AID);
      if (!aid) continue;

      await this.margPrisma.margAccountGroupBalance.upsert({
        where: {
          tenantId_companyId_aid: { tenantId, companyId, aid },
        },
        create: {
          tenantId,
          margId,
          companyId,
          aid,
          opening: balance.Opening != null ? Number(balance.Opening) : null,
          balance: balance.Balance != null ? Number(balance.Balance) : null,
          rawData: balance,
        },
        update: {
          margId,
          opening: balance.Opening != null ? Number(balance.Opening) : null,
          balance: balance.Balance != null ? Number(balance.Balance) : null,
          rawData: balance,
        },
      });
      count++;
    }

    return count;
  }

  private async syncPartyBalances(tenantId: string, balances: any[]): Promise<number> {
    let count = 0;
    for (const balance of balances) {
      const companyId = this.toInt32(balance.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toBigInt(balance.ID);
      if (margId <= BigInt(0)) continue;

      const cid = this.normalizeMargCode(balance.CID);
      if (!cid) continue;

      await this.margPrisma.margPartyBalance.upsert({
        where: {
          tenantId_companyId_cid: { tenantId, companyId, cid },
        },
        create: {
          tenantId,
          margId,
          companyId,
          cid,
          opening: balance.Opening != null ? Number(balance.Opening) : null,
          balance: balance.Balance != null ? Number(balance.Balance) : null,
          rawData: balance,
        },
        update: {
          margId,
          opening: balance.Opening != null ? Number(balance.Opening) : null,
          balance: balance.Balance != null ? Number(balance.Balance) : null,
          rawData: balance,
        },
      });
      count++;
    }

    return count;
  }

  private async syncOutstandings(
    tenantId: string,
    outstandings: any[],
    dateWindow: DateWindow | null,
  ): Promise<number> {
    let count = 0;
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

      await this.margPrisma.margOutstanding.upsert({
        where: {
          tenantId_companyId_margId: { tenantId, companyId, margId },
        },
        create: {
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
        },
        update: {
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
        },
      });
      count++;
    }

    return count;
  }

  private async syncSaleTypes(tenantId: string, saleTypes: any[]): Promise<number> {
    let count = 0;
    for (const st of saleTypes) {
      const companyId = this.toInt32(st.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(st.ID, 0);
      const sgCode = String(st.SGCode || '').trim();
      const sCode = String(st.SCode || '').trim();
      if (!sgCode || !sCode) continue;

      await this.margPrisma.margSaleType.upsert({
        where: {
          tenantId_companyId_sgCode_sCode: { tenantId, companyId, sgCode, sCode },
        },
        create: {
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
        },
        update: {
          margId,
          name: String(st.Name || '').trim(),
          main: String(st.Main || '').trim() || null,
          margCode: String(st.MargCode || '').trim() || null,
          addField: String(st.AddField || '').trim() || null,
          rawData: st,
        },
      });
      count++;
    }
    return count;
  }

  // ===================== TRANSFORM → CORE TABLES =====================

  /** Transform staged Marg branches → Location table */
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
  private async transformProducts(tenantId: string): Promise<void> {
    let cursor: string | null = null;

    while (true) {
      const staged = await this.margPrisma.margProduct.findMany({
        where: {
          tenantId,
          productId: null,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (staged.length === 0) break;

      for (const mp of staged) {
        const code = `MARG-${mp.code}`.substring(0, 50);
        const product = await this.prisma.product.upsert({
          where: { tenantId_code: { tenantId, code } },
          create: {
            tenantId,
            code,
            name: mp.name || code,
            unitOfMeasure: mp.unit || 'PCS',
            category: mp.gCode5 || undefined,
            status: DimensionStatus.ACTIVE,
            externalId: `marg:${mp.companyId}:${mp.pid}`,
            attributes: {
              margPid: mp.pid,
              margCompanyId: mp.companyId,
              margGCode: mp.gCode,
              margGst: mp.gst ? Number(mp.gst) : null,
              margHsn: mp.gCode6,
            },
          },
          update: {
            name: mp.name || code,
            unitOfMeasure: mp.unit || 'PCS',
            externalId: `marg:${mp.companyId}:${mp.pid}`,
          },
        });

        await this.margPrisma.margProduct.update({
          where: { id: mp.id },
          data: { productId: product.id },
        });
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

  /** Resolve or create a core Product for a Marg PID */
  private async resolveProductId(tenantId: string, companyId: number, pid: string): Promise<string | null> {
    if (!pid) return null;

    // 1) Try staged product → core product link
    const margProduct = await this.margPrisma.margProduct.findFirst({
      where: { tenantId, companyId, pid },
      select: { productId: true, name: true, unit: true },
    });
    if (margProduct?.productId) return margProduct.productId;

    // 2) Create or find a core product directly from the PID
    const code = `MARG-${pid}`.substring(0, 50);
    const product = await this.prisma.product.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: {
        tenantId,
        code,
        name: margProduct?.name || `Marg Product ${pid}`,
        unitOfMeasure: margProduct?.unit || 'PCS',
        status: DimensionStatus.ACTIVE,
        externalId: `marg:${companyId}:${pid}`,
        attributes: { margPid: pid, margCompanyId: companyId },
      },
      update: {},
    });

    // Back-link the staged product if it exists
    if (margProduct) {
      await this.margPrisma.margProduct.updateMany({
        where: { tenantId, companyId, pid, productId: null },
        data: { productId: product.id },
      });
    }

    return product.id;
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

  /** Transform staged Marg transactions → Actual records (SALES type) */
  private async transformTransactionsToActuals(
    tenantId: string,
    dateWindow: DateWindow | null,
    projectionWindowReset = false,
  ): Promise<void> {
    // Step A: Re-link orphaned actuals that were created before their product/customer
    if (!dateWindow) {
      await this.relinkOrphanedActuals(tenantId);
    }

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

        if (!decision.shouldProjectActual || decision.actualType == null || decision.actualAmount == null || decision.actualAmount === 0) {
          if (!projectionWindowReset) {
            await this.clearMargActualProjection(tenantId, mt.id, mt.sourceKey);
          }
          continue;
        }

        const productId = await getProductId(mt.companyId, mt.pid);
        const customerId = decision.customerFacing
          ? await getCustomerId(mt.companyId, mt.cid)
          : null;
        const locationId = await getLocationId(mt.companyId);

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
            attributes: {
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
              margGstAmount: mt.gstAmount ? Number(mt.gstAmount) : null,
              margMrp: mt.mrp ? Number(mt.mrp) : null,
              margRate: mt.rate ? Number(mt.rate) : null,
              margDiscount: mt.discount ? Number(mt.discount) : null,
              margFreeQty: mt.free ? Number(mt.free) : null,
              margBatch: mt.batch,
            },
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
            attributes: {
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
              margGstAmount: mt.gstAmount ? Number(mt.gstAmount) : null,
              margMrp: mt.mrp ? Number(mt.mrp) : null,
              margRate: mt.rate ? Number(mt.rate) : null,
              margDiscount: mt.discount ? Number(mt.discount) : null,
              margFreeQty: mt.free ? Number(mt.free) : null,
              margBatch: mt.batch,
            },
          },
        });

        await this.margPrisma.margTransaction.update({
          where: { id: mt.id },
          data: { actualId: actual.id },
        });
      }

      cursor = staged[staged.length - 1].id;
    }
  }

  /**
   * Re-link actuals that were created in a previous sync cycle without
   * product/customer associations (the staged product/party may have arrived
   * in a later sync page).
   */
  private async relinkOrphanedActuals(tenantId: string): Promise<void> {
    let cursor: string | null = null;

    while (true) {
      // Paginated fetch of orphaned actuals to avoid memory pressure
      const orphans = await this.prisma.actual.findMany({
        where: {
          tenantId,
          sourceSystem: 'MARG_EDE',
          OR: [{ productId: null }, { customerId: null }, { locationId: null }],
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

  /** Transform staged Marg stock → InventoryLevel records (aggregated per product+location) */
  private async transformStockToInventoryLevels(tenantId: string): Promise<void> {
    // Aggregate all marg_stocks rows per (pid, companyId) to get correct totals.
    // Multiple batches of the same product exist; the old row-by-row approach
    // would overwrite with the last batch's individual stock, producing wrong totals.
    const aggregated = await this.margPrisma.margStock.groupBy({
      by: ['companyId', 'pid'],
      where: { tenantId, sourceDeleted: false },
      _sum: { stock: true },
      _count: true,
    });

    const activeInventoryKeys = new Set<string>();

    for (const agg of aggregated) {
      const productId = await this.resolveProductId(tenantId, agg.companyId, agg.pid);
      const locationId = await this.resolveLocationId(tenantId, agg.companyId);
      if (!productId || !locationId) continue;

      activeInventoryKeys.add(this.buildInventoryScopeKey(productId, locationId));

      const totalQty = agg._sum.stock != null ? Number(agg._sum.stock) : 0;

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
          batch: { not: '_default' },
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
        const costPerUnit = ms.pRate != null ? new Prisma.Decimal(Number(ms.pRate)) : null;
        const batchNumber = ms.batch.substring(0, 50);
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

      if (!this.isWithinTolerance(outstandingTotal, balanceTotal, ACCOUNTING_RECONCILIATION_TOLERANCE)) {
        issues.push({
          type: 'AR_BALANCE_MISMATCH',
          companyId,
          partyCode,
          outstandingTotal,
          partyBalance: balanceTotal,
          variance: outstandingTotal - balanceTotal,
        });
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
    for (const scope of scopes) {
      const [productId, locationId] = scope.split('|');
      if (!productId || !locationId) continue;

      const ledgerRows = await this.prisma.inventoryLedger.findMany({
        where: { tenantId, productId, locationId },
        orderBy: [
          { transactionDate: 'asc' },
          { sequenceNumber: 'asc' },
        ],
        select: { id: true, quantity: true },
      });

      let runningBalance = new Prisma.Decimal(0);
      for (const ledgerRow of ledgerRows) {
        runningBalance = runningBalance.add(ledgerRow.quantity);
        await this.prisma.inventoryLedger.update({
          where: { id: ledgerRow.id },
          data: { runningBalance },
        });
      }
    }
  }

  private async fetchJsonWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
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

      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadRequestException(`Marg API request timed out after ${timeoutMs}ms`);
      }

      throw new BadRequestException(`Marg API request error: ${String(error)}`);
    } finally {
      clearTimeout(timeout);
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
