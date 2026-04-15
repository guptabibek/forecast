import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActualType,
  AuditAction,
  CustomerType,
  DimensionStatus,
  LocationType,
  PeriodType,
  Prisma,
} from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { inflateRawSync } from 'zlib';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateMargConfigDto, UpdateMargConfigDto } from './dto';
import { decryptMargCompressedPayload, decryptMargPayload } from './marg-decrypt.util';

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
  Index: number;
  DataStatus: number;
  DateTime: string;
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
const MARG_SYNC_STATUS = {
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

@Injectable()
export class MargEdeService {
  private readonly logger = new Logger(MargEdeService.name);
  private readonly requestTimeoutMs = this.parsePositiveInt(process.env.MARG_HTTP_TIMEOUT_MS, 30000);
  private readonly maxPagesPerSync = this.parsePositiveInt(process.env.MARG_SYNC_MAX_PAGES, 500);
  private readonly encryptionKey = this.resolveEncryptionKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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

    await this.margPrisma.margSyncConfig.delete({ where: { id } });
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
  }): Promise<MargParsedPayload> {
    const margOrigin = this.resolveMargOrigin(config.apiBaseUrl);
    const url = `${margOrigin}/api/eOnlineData/MargCorporateEDE`;

    const body = {
      CompanyCode: config.companyCode,
      Datetime: config.datetime || '',
      MargKey: config.margKey,
      Index: String(config.index),
      CompanyID: String(config.companyId),
      APIType: '2',
    };

    this.logger.log(`Fetching Marg EDE data: index=${config.index}, datetime=${config.datetime || '(all)'}`);

    const rawResponse = await this.fetchJsonWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

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
    const parsedDataStatus = Number(
      this.readFirstDefined([dataSection, parsedPayload, rawEnvelope], ['DataStatus', 'Datastatus']) ?? 0,
    );
    const parsedDateTime = String(
      this.readFirstDefined([dataSection, parsedPayload, rawEnvelope], ['DateTime', 'Datetime']) ?? '',
    ).trim();

    return {
      Details: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Details', 'Dis'])),
      Masters: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Masters'])),
      MDis: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['MDis'])),
      Party: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Party'])),
      Product: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Product'])),
      SaleType: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['SaleType'])),
      Stock: this.toArray(this.readFirstDefined([dataSection, parsedPayload], ['Stock'])),
      Index: Number.isFinite(parsedIndex) ? parsedIndex : 0,
      DataStatus: Number.isFinite(parsedDataStatus) ? parsedDataStatus : 0,
      DateTime: parsedDateTime,
    };
  }

  // ===================== FULL SYNC ORCHESTRATOR =====================

  async runSync(configId: string, tenantId: string, triggeredBy?: string): Promise<string> {
    const config = await this.margPrisma.margSyncConfig.findFirst({
      where: { id: configId, tenantId },
    });

    if (!config) throw new NotFoundException('Marg config not found');
    if (!config.isActive) throw new BadRequestException('Marg sync config is disabled');

    const lock = await this.margPrisma.margSyncConfig.updateMany({
      where: {
        id: configId,
        tenantId,
        lastSyncStatus: { not: MARG_SYNC_STATUS.RUNNING },
      },
      data: { lastSyncStatus: MARG_SYNC_STATUS.RUNNING },
    });

    if (lock.count === 0) {
      throw new BadRequestException('Sync is already running for this configuration');
    }

    let margKey = '';
    let decryptionKey = '';

    let currentIndex = config.lastSyncIndex;
    let lastDatetime = config.lastSyncDatetime || '';

    // Create sync log
    const syncLog = await this.margPrisma.margSyncLog.create({
      data: {
        tenantId,
        configId,
        status: MARG_SYNC_STATUS.RUNNING,
        syncIndex: currentIndex,
        syncDatetime: config.lastSyncDatetime,
      },
    });

    const errors: any[] = [];
    let productsCount = 0;
    let partiesCount = 0;
    let transactionsCount = 0;
    let stockCount = 0;
    let branchesCount = 0;

    try {
      margKey = this.decryptSecret(config.margKey);
      decryptionKey = this.decryptSecret(config.decryptionKey);

      // Step 1: Fetch and sync branches
      try {
        const branches = await this.fetchBranches({
          apiBaseUrl: config.apiBaseUrl,
          companyCode: config.companyCode,
        });
        branchesCount = await this.syncBranches(tenantId, branches);
      } catch (err) {
        errors.push({ step: 'branches', error: String(err) });
        this.logger.warn('Branch sync failed (non-fatal)', err);
      }

      // Step 2: Paginated data fetch
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
        });

        // Process each data section
        if (payload.Product.length > 0) {
          const count = await this.syncProducts(tenantId, payload.Product);
          productsCount += count;
        }

        if (payload.Party.length > 0) {
          const count = await this.syncParties(tenantId, payload.Party);
          partiesCount += count;
        }

        if (payload.Details.length > 0) {
          const count = await this.syncTransactions(tenantId, payload.Details);
          transactionsCount += count;
        }

        if (payload.Stock.length > 0) {
          const count = await this.syncStockData(tenantId, payload.Stock);
          stockCount += count;
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

        // DataStatus=10 means server cursor has reached sync completion.
        if (payload.DataStatus === COMPLETE_DATA_STATUS) {
          completed = true;
          break;
        }

        // Some Marg tenants return stable Index=0 for full snapshots. In that case,
        // treat the current response as a terminal page instead of hard-failing.
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

      // Step 3: Transform staged data → core tables
      await this.transformBranches(tenantId);
      await this.transformProducts(tenantId);
      await this.transformParties(tenantId);
      await this.transformTransactionsToActuals(tenantId);
      await this.transformStockToInventoryLevels(tenantId);

      // Update sync config with latest cursor
      await this.margPrisma.margSyncConfig.update({
        where: { id: configId },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: MARG_SYNC_STATUS.COMPLETED,
          lastSyncIndex: currentIndex,
          lastSyncDatetime: lastDatetime || new Date().toISOString(),
        },
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
          errors: errors as any,
          syncIndex: currentIndex,
          syncDatetime: lastDatetime || null,
        },
      });

      this.logger.log(
        `Marg sync completed: products=${productsCount}, parties=${partiesCount}, ` +
        `transactions=${transactionsCount}, stock=${stockCount}, branches=${branchesCount}`,
      );

      await this.auditService.log(
        tenantId,
        triggeredBy ?? null,
        AuditAction.IMPORT,
        'MargSyncLog',
        syncLog.id,
        null,
        { status: 'COMPLETED', products: productsCount, parties: partiesCount, transactions: transactionsCount, stock: stockCount, branches: branchesCount },
        [],
        { configId, triggeredBy, action: 'marg_sync_completed' },
      ).catch(() => {/* best-effort */});
    } catch (err) {
      this.logger.error('Marg sync failed', err);
      errors.push({ step: 'fatal', error: String(err) });

      await this.margPrisma.margSyncConfig.update({
        where: { id: configId },
        data: { lastSyncStatus: MARG_SYNC_STATUS.FAILED },
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
          errors: errors as any,
          syncIndex: currentIndex,
          syncDatetime: lastDatetime || null,
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
        { configId, triggeredBy, action: 'marg_sync_failed' },
      ).catch(() => {/* best-effort */});

      throw err;
    }

    return syncLog.id;
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
          name: String(b.Name || '').trim(),
          storeId: String(b.StoreID || '').trim() || null,
          licence: String(b.Licence || '').trim() || null,
          branch: String(b.Branch || '').trim() || null,
          rawData: b,
        },
        update: {
          margId,
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
          parAdd1: String(p.ParAdd1 || '').trim() || null,
          parAdd2: String(p.ParAdd2 || '').trim() || null,
          gstnNo: String(p['GSTNNo.'] || p.GSTNNo || '').trim() || null,
          phone1: String(p.Phone1 || '').trim() || null,
          phone2: String(p.Phone2 || '').trim() || null,
          phone3: String(p.Phone3 || '').trim() || null,
          phone4: String(p.Phone4 || '').trim() || null,
          route: String(p.Rout || '').trim() || null,
          area: String(p.Area || '').trim() || null,
          sCode: String(p.SCode || '').trim() || null,
          credit: p.Credit != null ? Number(p.Credit) : null,
          crDays: p.CRDays != null ? Number(p.CRDays) : null,
          crBills: p.CRBills != null ? Number(p.CRBills) : null,
          pin: String(p.Pin || '').trim() || null,
          lat: String(p.Lat || '').trim() || null,
          lng: String(p.Lng || '').trim() || null,
          rawData: p,
        },
        update: {
          margId,
          parName: String(p.ParNam || '').trim(),
          parAdd1: String(p.ParAdd1 || '').trim() || null,
          parAdd2: String(p.ParAdd2 || '').trim() || null,
          gstnNo: String(p['GSTNNo.'] || p.GSTNNo || '').trim() || null,
          phone1: String(p.Phone1 || '').trim() || null,
          phone2: String(p.Phone2 || '').trim() || null,
          phone3: String(p.Phone3 || '').trim() || null,
          phone4: String(p.Phone4 || '').trim() || null,
          route: String(p.Rout || '').trim() || null,
          area: String(p.Area || '').trim() || null,
          sCode: String(p.SCode || '').trim() || null,
          credit: p.Credit != null ? Number(p.Credit) : null,
          crDays: p.CRDays != null ? Number(p.CRDays) : null,
          crBills: p.CRBills != null ? Number(p.CRBills) : null,
          pin: String(p.Pin || '').trim() || null,
          lat: String(p.Lat || '').trim() || null,
          lng: String(p.Lng || '').trim() || null,
          rawData: p,
        },
      });
      count++;
    }
    return count;
  }

  private async syncTransactions(tenantId: string, details: any[]): Promise<number> {
    let count = 0;
    for (const d of details) {
      const companyId = this.toInt32(d.CompanyID, 0);
      if (companyId <= 0) continue;

      const margId = this.toInt32(d.ID, 0);
      const voucher = String(d.Voucher || '').trim();
      if (!voucher) continue;

      const parsedDate = this.parseMargDate(d.Date);
      if (!parsedDate) continue;

      const sourceKey = this.buildSourceKey(d, parsedDate);

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
          vcn: String(d.Vcn || d.VCN || '').trim() || null,
          date: parsedDate,
          cid: String(d.CID || '').trim() || null,
          pid: String(d.PID || '').trim() || null,
          gCode: String(d.Gcode || d.GCode || '').trim() || null,
          batch: String(d.Batch || '').trim() || null,
          qty: d.Qty != null ? Number(d.Qty) : null,
          free: d.Free != null ? Number(d.Free) : null,
          mrp: d.MRP != null ? Number(d.MRP) : null,
          rate: d.Rate != null ? Number(d.Rate) : null,
          discount: d.Discount != null ? Number(d.Discount) : null,
          amount: d.Amount != null ? Number(d.Amount) : null,
          gst: d.GST != null ? Number(d.GST) : null,
          gstAmount: d.GSTamount != null ? Number(d.GSTamount) : null,
          addFields: String(d.AddFields || '').trim() || null,
          rawData: d,
        },
        update: {
          margId,
          type: String(d.Type || '').trim(),
          vcn: String(d.Vcn || d.VCN || '').trim() || null,
          date: parsedDate,
          cid: String(d.CID || '').trim() || null,
          pid: String(d.PID || '').trim() || null,
          gCode: String(d.Gcode || d.GCode || '').trim() || null,
          batch: String(d.Batch || '').trim() || null,
          qty: d.Qty != null ? Number(d.Qty) : null,
          free: d.Free != null ? Number(d.Free) : null,
          mrp: d.MRP != null ? Number(d.MRP) : null,
          rate: d.Rate != null ? Number(d.Rate) : null,
          discount: d.Discount != null ? Number(d.Discount) : null,
          amount: d.Amount != null ? Number(d.Amount) : null,
          gst: d.GST != null ? Number(d.GST) : null,
          gstAmount: d.GSTamount != null ? Number(d.GSTamount) : null,
          addFields: String(d.AddFields || '').trim() || null,
          rawData: d,
        },
      });
      count++;
    }
    return count;
  }

  private async syncStockData(tenantId: string, stockItems: any[]): Promise<number> {
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
          pRate: s.Prate != null ? Number(s.Prate) : null,
          mrp: s.MRP != null ? Number(s.MRP) : null,
          rateA: s.RateA != null ? Number(s.RateA) : null,
          rateB: s.RateB != null ? Number(s.RateB) : null,
          rateC: s.RateC != null ? Number(s.RateC) : null,
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
          pRate: s.Prate != null ? Number(s.Prate) : null,
          mrp: s.MRP != null ? Number(s.MRP) : null,
          rateA: s.RateA != null ? Number(s.RateA) : null,
          rateB: s.RateB != null ? Number(s.RateB) : null,
          rateC: s.RateC != null ? Number(s.RateC) : null,
          rawData: s,
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
          customerId: null,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (staged.length === 0) break;

      for (const mp of staged) {
        if (mp.parName.toUpperCase().includes('SUSPENSE') || !mp.cid.trim()) continue;

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
              gstn: mp.gstnNo,
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
      select: { customerId: true, parName: true, area: true },
    });
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
  private async transformTransactionsToActuals(tenantId: string): Promise<void> {
    // Step A: Re-link orphaned actuals that were created before their product/customer
    await this.relinkOrphanedActuals(tenantId);

    // Step B: Transform new (unlinked) staged transactions
    let cursor: string | null = null;

    while (true) {
      const staged = await this.margPrisma.margTransaction.findMany({
        where: {
          tenantId,
          actualId: null,
          amount: { not: null },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: TRANSFORM_BATCH_SIZE,
      });

      if (staged.length === 0) break;

      for (const mt of staged) {
        if (!mt.amount || Number(mt.amount) === 0) continue;

        const productId = await this.resolveProductId(tenantId, mt.companyId, mt.pid);
        const customerId = await this.resolveCustomerId(tenantId, mt.companyId, mt.cid);
        const locationId = await this.resolveLocationId(tenantId, mt.companyId);

        // Determine transaction type: G=Sales, P=Purchase, etc.
        const isSale = ['G', 'S'].includes(mt.type.toUpperCase());
        const actualType = isSale ? ActualType.SALES : ActualType.PURCHASES;

        const actual = await this.prisma.actual.create({
          data: {
            tenantId,
            actualType,
            periodDate: mt.date,
            periodType: PeriodType.DAILY,
            productId,
            customerId,
            locationId,
            quantity: mt.qty,
            amount: mt.amount!,
            currency: 'INR',
            sourceSystem: 'MARG_EDE',
            sourceReference: mt.sourceKey,
            attributes: {
              margVoucher: mt.voucher,
              margVcn: mt.vcn,
              margType: mt.type,
              margGst: mt.gst ? Number(mt.gst) : null,
              margGstAmount: mt.gstAmount ? Number(mt.gstAmount) : null,
              margRate: mt.rate ? Number(mt.rate) : null,
              margDiscount: mt.discount ? Number(mt.discount) : null,
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
    // Find MARG_EDE actuals missing product, customer, or location links
    const orphans = await this.prisma.actual.findMany({
      where: {
        tenantId,
        sourceSystem: 'MARG_EDE',
        OR: [{ productId: null }, { customerId: null }, { locationId: null }],
      },
      select: { id: true, productId: true, customerId: true, locationId: true, sourceReference: true },
    });

    if (orphans.length === 0) return;

    this.logger.log(`Re-linking ${orphans.length} orphaned Marg EDE actuals`);

    // Build sourceKey → actual mapping
    const sourceKeys = orphans.map((o) => o.sourceReference).filter(Boolean) as string[];
    if (sourceKeys.length === 0) return;

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

  /** Transform staged Marg stock → InventoryLevel records */
  private async transformStockToInventoryLevels(tenantId: string): Promise<void> {
    let cursor: string | null = null;

    while (true) {
      const staged = await this.margPrisma.margStock.findMany({
        where: {
          tenantId,
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

        const onHandQty = ms.stock != null ? Number(ms.stock) : 0;
        const averageCost = ms.pRate != null ? Number(ms.pRate) : null;

        await this.prisma.inventoryLevel.upsert({
          where: {
            tenantId_productId_locationId: { tenantId, productId, locationId },
          },
          create: {
            tenantId,
            productId,
            locationId,
            onHandQty,
            availableQty: onHandQty,
            averageCost: averageCost != null ? new Prisma.Decimal(averageCost) : null,
            inventoryValue: averageCost != null ? new Prisma.Decimal(onHandQty * averageCost) : null,
          },
          update: {
            onHandQty,
            availableQty: onHandQty,
            averageCost: averageCost != null ? new Prisma.Decimal(averageCost) : null,
            inventoryValue: averageCost != null ? new Prisma.Decimal(onHandQty * averageCost) : null,
          },
        });
      }

      cursor = staged[staged.length - 1].id;
    }
  }

  // ===================== HELPERS =====================

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private toArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
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

  private buildSourceKey(row: Record<string, unknown>, parsedDate: Date): string {
    const raw = [
      String(row.Voucher || '').trim(),
      String(row.Vcn || row.VCN || '').trim(),
      String(row.PID || '').trim(),
      String(row.Batch || '').trim(),
      String(row.Type || '').trim(),
      parsedDate.toISOString().slice(0, 10),
      String(row.Qty || ''),
      String(row.Amount || ''),
      String(row.Rate || ''),
    ].join('|');

    return createHash('sha256').update(raw).digest('hex');
  }

  private async fetchJsonWithTimeout(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

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
        throw new BadRequestException(`Marg API request timed out after ${this.requestTimeoutMs}ms`);
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

    let result: { success: boolean; message: string; branches: any[] };
    try {
      const branches = await this.fetchBranches({
        apiBaseUrl: config.apiBaseUrl,
        companyCode: config.companyCode,
      });
      result = {
        success: true,
        message: `Connection successful. Found ${branches.length} branch(es).`,
        branches,
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
    return { items, total, page: safePage, pageSize: safePageSize };
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

  // ===================== SYNC OVERVIEW =====================

  async getSyncOverview(tenantId: string) {
    const [configs, branchCount, productCount, partyCount, txnCount, stockCount] = await Promise.all([
      this.margPrisma.margSyncConfig.findMany({
        where: { tenantId },
        select: {
          id: true,
          companyCode: true,
          isActive: true,
          lastSyncAt: true,
          lastSyncStatus: true,
          syncFrequency: true,
        },
      }),
      this.margPrisma.margBranch.count({ where: { tenantId } }),
      this.margPrisma.margProduct.count({ where: { tenantId } }),
      this.margPrisma.margParty.count({ where: { tenantId } }),
      this.margPrisma.margTransaction.count({ where: { tenantId } }),
      this.margPrisma.margStock.count({ where: { tenantId } }),
    ]);

    return {
      configs,
      stagedData: {
        branches: branchCount,
        products: productCount,
        parties: partyCount,
        transactions: txnCount,
        stock: stockCount,
      },
    };
  }
}
