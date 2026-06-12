import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiAccessStatus, AiUsageBillingStatus, Prisma } from '@prisma/client';
import { TenantCacheService } from '../../core/cache/tenant-cache.service';
import { PrismaService } from '../../core/database/prisma.service';
import { AiAccessService } from '../ai-billing/access.service';
import { WalletService } from '../ai-billing/wallet.service';
import { AiReportingService } from '../ai-reporting/ai-reporting.service';
import { SemanticReportQuery } from '../ai-reporting/semantic-query.types';
import {
  IInsightProvider,
  INSIGHT_PROVIDERS,
  InsightCandidate,
  InsightProviderContext,
} from './insight-provider.interface';

const INSIGHTS_CACHE_NAMESPACE = 'ai-dashboard:insights';
/** Synthetic identity used for tenant-level (not user-level) insight queries */
const INSIGHT_SYSTEM_USER_ID = '00000000-0000-0000-0000-00000000a11e';
/** A NEW insight that keeps being re-detected becomes ACTIVE after this long */
const NEW_TO_ACTIVE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface TenantGenerationResult {
  tenantId: string;
  providersRun: number;
  providersFailed: number;
  insightsUpserted: number;
  insightsArchived: number;
}

@Injectable()
export class InsightGenerationService {
  private readonly logger = new Logger(InsightGenerationService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiReporting: AiReportingService,
    private readonly cache: TenantCacheService,
    @Inject(INSIGHT_PROVIDERS) private readonly providers: IInsightProvider[],
    // AI governance: suspended/disabled tenants get no fresh insights.
    @Optional() private readonly billingAccess?: AiAccessService,
    // Insight generation is metered: a flat per-provider-run fee is reserved
    // before the cycle and settled for the providers that actually ran.
    @Optional() private readonly billingWallet?: WalletService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** Credits charged per insight provider run (no LLM tokens are involved —
   *  this prices the platform compute). 0 disables insight metering. */
  private providerRunFee(): Prisma.Decimal {
    const raw = Number(this.config?.get('AI_INSIGHTS_PROVIDER_RUN_FEE') ?? 0.01);
    return new Prisma.Decimal(Number.isFinite(raw) && raw >= 0 ? raw : 0.01);
  }

  private billingEnforced(): boolean {
    const raw = String(this.config?.get('AI_BILLING_ENFORCEMENT') ?? 'true').trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(raw);
  }

  listRegisteredProviders(): Array<{ providerId: string; displayName: string; category: string; defaultEnabled: boolean }> {
    return this.providers.map((provider) => ({
      providerId: provider.providerId,
      displayName: provider.displayName,
      category: provider.category,
      defaultEnabled: provider.defaultEnabled,
    }));
  }

  async listProviderConfigs(tenantId: string) {
    const configs = await this.prisma.aiInsightProviderConfig.findMany({ where: { tenantId } });
    const byId = new Map(configs.map((config) => [config.providerId, config]));
    return this.providers.map((provider) => {
      const config = byId.get(provider.providerId);
      return {
        providerId: provider.providerId,
        displayName: provider.displayName,
        category: provider.category,
        enabled: config ? config.enabled : provider.defaultEnabled,
        lastRunAt: config?.lastRunAt?.toISOString() ?? null,
        lastStatus: config?.lastStatus ?? null,
        lastError: config?.lastError ?? null,
      };
    });
  }

  async setProviderEnabled(tenantId: string, providerId: string, enabled: boolean) {
    const provider = this.providers.find((candidate) => candidate.providerId === providerId);
    if (!provider) throw new NotFoundException(`Unknown insight provider: ${providerId}`);
    await this.prisma.aiInsightProviderConfig.upsert({
      where: { tenantId_providerId: { tenantId, providerId } },
      create: { tenantId, providerId, enabled },
      update: { enabled },
    });
    return this.listProviderConfigs(tenantId);
  }

  /** Runs all enabled providers for every active tenant (scheduler entry point). */
  async generateForAllTenants(): Promise<TenantGenerationResult[]> {
    if (this.running) {
      this.logger.warn('Insight generation already running in this process; skipping cycle');
      return [];
    }
    this.running = true;
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });
      const disabledModules = await this.prisma.tenantModule.findMany({
        where: { module: 'ai-reporting', enabled: false },
        select: { tenantId: true },
      });
      const disabled = new Set(disabledModules.map((row) => row.tenantId));

      const results: TenantGenerationResult[] = [];
      for (const tenant of tenants) {
        if (disabled.has(tenant.id)) continue;
        try {
          results.push(await this.generateForTenant(tenant.id));
        } catch (error: any) {
          // AI reporting disabled for tenant, missing data, etc. — never abort the cycle.
          this.logger.warn(`Insight generation skipped for tenant ${tenant.id}: ${String(error?.message ?? error).slice(0, 300)}`);
        }
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  /**
   * Runs enabled providers for one tenant. `options.providerIds` restricts the
   * run to specific providers — used to refresh just the pinned-report
   * analysis right after a pin/unpin instead of waiting for the next cycle
   * (archival of non-redetected insights is per-provider, so a partial run
   * never archives other providers' insights).
   */
  async generateForTenant(tenantId: string, options?: { providerIds?: string[] }): Promise<TenantGenerationResult> {
    // AI access governance applies to insight computation too — a tenant
    // whose AI is disabled or suspended gets no fresh insights.
    if (this.billingAccess) {
      const policy = await this.billingAccess.getEffectivePolicyForUser(tenantId);
      if (policy.status !== AiAccessStatus.ENABLED) {
        this.logger.log(`Insight generation skipped for tenant ${tenantId}: AI access ${policy.status}`);
        return { tenantId, providersRun: 0, providersFailed: 0, insightsUpserted: 0, insightsArchived: 0 };
      }
    }
    const runStarted = new Date();
    const configs = await this.prisma.aiInsightProviderConfig.findMany({ where: { tenantId } });
    const configById = new Map(configs.map((config) => [config.providerId, config]));
    const providerFilter = options?.providerIds?.length ? new Set(options.providerIds) : null;

    // Which providers will actually run (for the credit reservation).
    const runnable = this.providers.filter((provider) => {
      if (providerFilter && !providerFilter.has(provider.providerId)) return false;
      const config = configById.get(provider.providerId);
      return config ? config.enabled : provider.defaultEnabled;
    });

    // Metering: reserve fee × planned providers up front (insufficient
    // credits = no insights, like every other AI surface), settle for the
    // providers that actually ran. Throws 402 to manual/pin callers; the
    // cron's per-tenant try/catch absorbs it for scheduled cycles.
    const fee = this.providerRunFee();
    let reservationId: string | null = null;
    const metered = Boolean(this.billingWallet) && this.billingEnforced() && fee.greaterThan(0) && runnable.length > 0;
    if (metered) {
      const reservation = await this.billingWallet!.reserveCredits({
        tenantId,
        userId: null,
        amount: fee.times(runnable.length),
      });
      reservationId = reservation.id;
    }

    const systemUser = {
      id: INSIGHT_SYSTEM_USER_ID,
      tenantId,
      role: 'SUPER_ADMIN',
      permissions: [],
    };
    const runReport = async (query: SemanticReportQuery) => {
      const result = await this.aiReporting.executeStoredReport(systemUser, { semanticQuery: query });
      if (result.status !== 'success') {
        throw new Error(`Insight query unsupported: ${result.unsupportedReason ?? query.title}`);
      }
      return { columns: result.columns, rows: result.rows, rowCount: result.rowCount };
    };

    let providersRun = 0;
    let providersFailed = 0;
    let insightsUpserted = 0;
    let insightsArchived = 0;

    try {
    for (const provider of runnable) {
      const config = configById.get(provider.providerId);

      const ctx: InsightProviderContext = {
        tenantId,
        now: runStarted,
        config: (config?.config as Record<string, unknown>) ?? {},
        runReport,
      };

      try {
        const candidates = await provider.generate(ctx);
        for (const candidate of candidates) {
          await this.upsertInsight(tenantId, provider, candidate, runStarted);
          insightsUpserted += 1;
        }
        // Open insights from this provider that were NOT re-detected this
        // cycle have cleared — archive them (acknowledged ones stay put).
        const archived = await this.prisma.aiInsight.updateMany({
          where: {
            tenantId,
            providerId: provider.providerId,
            status: { in: ['NEW', 'ACTIVE'] },
            lastEvaluatedAt: { lt: runStarted },
          },
          data: { status: 'ARCHIVED' },
        });
        insightsArchived += archived.count;
        providersRun += 1;
        await this.recordProviderRun(tenantId, provider.providerId, 'success', null);
      } catch (error: any) {
        providersFailed += 1;
        const message = String(error?.message ?? error).slice(0, 1000);
        this.logger.warn(`Insight provider ${provider.providerId} failed for tenant ${tenantId}: ${message}`);
        await this.recordProviderRun(tenantId, provider.providerId, 'error', message);
      }
    }
    } finally {
      // Settle the metering hold: charge for the providers that actually ran
      // (zero charge just releases the hold). Crash-safe via finally.
      if (reservationId) {
        await this.settleGenerationCharge(tenantId, reservationId, fee, providersRun);
      }
    }

    await this.cache.invalidateNamespace(tenantId, INSIGHTS_CACHE_NAMESPACE);
    this.logger.log(
      `Insight generation finished: tenantId=${tenantId}, providers=${providersRun}, failed=${providersFailed}, upserted=${insightsUpserted}, archived=${insightsArchived}`,
    );
    return { tenantId, providersRun, providersFailed, insightsUpserted, insightsArchived };
  }

  /**
   * Charge the insight-generation fee through the standard ledger lifecycle
   * and record a token-less usage log row so the spend shows up in customer
   * usage history and platform reporting.
   */
  private async settleGenerationCharge(tenantId: string, reservationId: string, fee: Prisma.Decimal, providersRun: number) {
    try {
      const charge = fee.times(providersRun);
      const result = await this.billingWallet!.finalizeReservation(reservationId, charge, {
        createdById: null,
        notes: `AI insights generation (${providersRun} provider run${providersRun === 1 ? '' : 's'})`,
      });
      if (charge.greaterThan(0)) {
        await this.prisma.aiUsageLog.create({
          data: {
            tenantId,
            userId: null,
            providerName: 'platform',
            modelCode: 'insights-generation',
            callType: 'insights_generation',
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            providerCost: new Prisma.Decimal(0),
            customerCharge: charge,
            margin: charge,
            reservationId,
            transactionId: result.transaction?.id ?? null,
            status: AiUsageBillingStatus.CHARGED,
            metadata: { providersRun },
          },
        });
      }
    } catch (error: any) {
      this.logger.error(`Insight generation charge settle failed for tenant ${tenantId}: ${String(error?.message ?? error)}`);
    }
  }

  private async upsertInsight(tenantId: string, provider: IInsightProvider, candidate: InsightCandidate, runStarted: Date) {
    const existing = await this.prisma.aiInsight.findUnique({
      where: {
        tenantId_providerId_dedupeKey: { tenantId, providerId: provider.providerId, dedupeKey: candidate.dedupeKey },
      },
    });

    const content = {
      category: provider.category,
      severity: candidate.severity,
      title: candidate.title.slice(0, 300),
      summary: candidate.summary,
      confidence: Math.min(Math.max(candidate.confidence, 0), 1),
      metrics: (candidate.metrics ?? null) as object | null,
      evidence: (candidate.evidence ?? []) as unknown as object,
      actions: (candidate.actions ?? []) as unknown as object,
      drillDownQuestion: candidate.drillDownQuestion?.slice(0, 1000) ?? null,
      lastEvaluatedAt: runStarted,
    };

    if (!existing) {
      const created = await this.prisma.aiInsight.create({
        data: {
          tenantId,
          providerId: provider.providerId,
          dedupeKey: candidate.dedupeKey,
          status: 'NEW',
          firstDetectedAt: runStarted,
          ...content,
        },
      });
      await this.prisma.aiInsightEvent.create({
        data: { tenantId, insightId: created.id, action: 'generated' },
      });
      return;
    }

    let nextStatus = existing.status;
    let event: string | null = null;
    if (existing.status === 'RESOLVED' || existing.status === 'ARCHIVED') {
      // The condition recurred after being closed — surface it again.
      nextStatus = 'ACTIVE';
      event = 'redetected';
    } else if (existing.status === 'NEW' && runStarted.getTime() - existing.firstDetectedAt.getTime() >= NEW_TO_ACTIVE_AFTER_MS) {
      nextStatus = 'ACTIVE';
    }

    await this.prisma.aiInsight.update({
      where: { id: existing.id },
      data: {
        ...content,
        status: nextStatus,
        ...(event === 'redetected'
          ? { acknowledgedBy: null, acknowledgedAt: null, resolvedBy: null, resolvedAt: null, firstDetectedAt: runStarted }
          : {}),
      },
    });
    if (event) {
      await this.prisma.aiInsightEvent.create({
        data: { tenantId, insightId: existing.id, action: event },
      });
    }
  }

  private async recordProviderRun(tenantId: string, providerId: string, status: 'success' | 'error', error: string | null) {
    try {
      await this.prisma.aiInsightProviderConfig.upsert({
        where: { tenantId_providerId: { tenantId, providerId } },
        create: { tenantId, providerId, lastRunAt: new Date(), lastStatus: status, lastError: error },
        update: { lastRunAt: new Date(), lastStatus: status, lastError: error },
      });
    } catch {
      // Bookkeeping failure must never fail the run.
    }
  }
}
