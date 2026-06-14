import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AiAccessStatus } from '@prisma/client';
import { TenantCacheService } from '../../core/cache/tenant-cache.service';
import { PrismaService } from '../../core/database/prisma.service';
import { AiAccessService } from '../ai-billing/access.service';
import { AiProviderService } from '../ai-reporting/ai-provider.service';
import { AiReportingService } from '../ai-reporting/ai-reporting.service';
import { SemanticReportQuery } from '../ai-reporting/semantic-query.types';
import {
  IInsightProvider,
  INSIGHT_PROVIDERS,
  InsightCandidate,
  InsightProviderContext,
} from './insight-provider.interface';
import { buildInsightNarrativePrompt } from './prompts/insight-narrative.prompt';

const INSIGHTS_CACHE_NAMESPACE = 'ai-dashboard:insights';
/** Synthetic identity used for tenant-level (not user-level) insight queries */
const INSIGHT_SYSTEM_USER_ID = '00000000-0000-0000-0000-00000000a11e';
/** A NEW insight that keeps being re-detected becomes ACTIVE after this long */
const NEW_TO_ACTIVE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Upper bound on LLM narration calls per provider run — a safety cap so a
 *  provider that emits many candidates (e.g. pinned reports) cannot trigger an
 *  unbounded burst of billed calls in a single cycle. */
const MAX_NARRATIONS_PER_PROVIDER_RUN = 10;
/** Mirrors ResultSummarizerService: metric keys matching this are dropped
 *  before the candidate is sent to the LLM when the tenant masks sensitive
 *  fields. */
const SENSITIVE_KEY = /(pan|vat|gst|phone|address|email|license|secret|token)/i;

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
    // Insight narratives are rewritten by the LLM and billed on real token
    // usage through the same prepare/settle pipeline as AI reporting.
    @Optional() private readonly aiProvider?: AiProviderService,
  ) {}

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

  /**
   * Active tenants with AI reporting enabled — the set that gets insights.
   * Shared by the inline cycle and the queue fan-out so both target exactly
   * the same tenants.
   */
  async listGeneratableTenantIds(): Promise<string[]> {
    const [tenants, disabledModules] = await Promise.all([
      this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
      this.prisma.tenantModule.findMany({ where: { module: 'ai-reporting', enabled: false }, select: { tenantId: true } }),
    ]);
    const disabled = new Set(disabledModules.map((row) => row.tenantId));
    return tenants.map((tenant) => tenant.id).filter((id) => !disabled.has(id));
  }

  /**
   * Runs all enabled providers for every active tenant, sequentially, in this
   * process. Used as the no-queue fallback; when Redis is configured the
   * scheduler fans out one queue job per tenant instead (see
   * InsightQueueService) so the work is bounded, retried, and spread across
   * workers rather than serialized in the API process.
   */
  async generateForAllTenants(): Promise<TenantGenerationResult[]> {
    if (this.running) {
      this.logger.warn('Insight generation already running in this process; skipping cycle');
      return [];
    }
    this.running = true;
    try {
      const tenantIds = await this.listGeneratableTenantIds();
      const results: TenantGenerationResult[] = [];
      for (const tenantId of tenantIds) {
        try {
          results.push(await this.generateForTenant(tenantId));
        } catch (error: any) {
          // AI reporting disabled for tenant, missing data, etc. — never abort the cycle.
          this.logger.warn(`Insight generation skipped for tenant ${tenantId}: ${String(error?.message ?? error).slice(0, 300)}`);
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

    // Which providers will actually run.
    const runnable = this.providers.filter((provider) => {
      if (providerFilter && !providerFilter.has(provider.providerId)) return false;
      const config = configById.get(provider.providerId);
      return config ? config.enabled : provider.defaultEnabled;
    });

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
        await this.narrateCandidates(tenantId, provider, candidates);
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

    await this.cache.invalidateNamespace(tenantId, INSIGHTS_CACHE_NAMESPACE);
    this.logger.log(
      `Insight generation finished: tenantId=${tenantId}, providers=${providersRun}, failed=${providersFailed}, upserted=${insightsUpserted}, archived=${insightsArchived}`,
    );
    return { tenantId, providersRun, providersFailed, insightsUpserted, insightsArchived };
  }

  /**
   * Rewrites candidate summaries in natural business language via the LLM,
   * billed on real token usage through the same prepare/settle pipeline as AI
   * reporting (AiChargeService, callType 'summary').
   *
   * Only NEW or CHANGED candidates are narrated: a candidate whose title and
   * metrics match the stored insight (and which was already narrated) reuses
   * the stored summary, so unchanged insights are not re-billed or made to
   * flicker (the LLM is non-deterministic) on every cycle. One LLM call per
   * candidate keeps each completion bounded (no truncation) and prevents
   * mapping a narrative onto the wrong insight.
   *
   * Respects the tenant's `summariesEnabled` preference and sensitive-field
   * masking, matching ResultSummarizerService. Best-effort: if AI is
   * unavailable, unconfigured, the tenant disabled summaries, or it has
   * insufficient credits, the deterministic template summary is kept, nothing
   * is charged, and the insight is still recorded.
   */
  private async narrateCandidates(tenantId: string, provider: IInsightProvider, candidates: InsightCandidate[]): Promise<void> {
    if (!this.aiProvider || candidates.length === 0) return;

    const opConfig = await this.aiProvider.getTenantOperationalConfig(tenantId);
    if (!opConfig.summariesEnabled) return;

    const stored = await this.prisma.aiInsight.findMany({
      where: { tenantId, providerId: provider.providerId, dedupeKey: { in: candidates.map((c) => c.dedupeKey) } },
      select: { dedupeKey: true, title: true, metrics: true, summary: true },
    });
    const storedByKey = new Map(stored.map((row) => [row.dedupeKey, row]));

    let narrated = 0;
    for (const candidate of candidates) {
      const prior = storedByKey.get(candidate.dedupeKey);
      // Unchanged AND already narrated last cycle (its stored summary differs
      // from the freshly regenerated template) → reuse it, skip the LLM. We
      // MUST copy it onto the candidate or upsertInsight would overwrite the
      // stored AI summary with the template.
      if (prior && this.candidateUnchanged(candidate, prior) && prior.summary && prior.summary !== candidate.summary) {
        candidate.summary = prior.summary;
        continue;
      }
      if (narrated >= MAX_NARRATIONS_PER_PROVIDER_RUN) continue;
      const narrative = await this.narrateOne(tenantId, provider, candidate, opConfig.maskSensitiveFields);
      if (narrative) {
        candidate.summary = narrative;
        narrated += 1;
      }
    }
  }

  /** True when the candidate's title and metrics match the stored insight —
   *  i.e. nothing the narrative depends on has moved since last cycle. */
  private candidateUnchanged(candidate: InsightCandidate, prior: { title: string; metrics: unknown }): boolean {
    if (candidate.title.slice(0, 300) !== prior.title) return false;
    return this.stableStringify(candidate.metrics ?? null) === this.stableStringify(prior.metrics ?? null);
  }

  /** Narrates a single candidate. Returns null (caller keeps the template) on
   *  any failure — AI unavailable, insufficient credits, bad JSON, etc. */
  private async narrateOne(
    tenantId: string,
    provider: IInsightProvider,
    candidate: InsightCandidate,
    maskSensitiveFields: boolean,
  ): Promise<string | null> {
    const prompt = buildInsightNarrativePrompt({
      providerName: provider.displayName,
      title: candidate.title,
      severity: candidate.severity,
      draftSummary: candidate.summary,
      metricsJson: JSON.stringify(this.maskMetrics(candidate.metrics ?? null, maskSensitiveFields)),
      evidenceJson: JSON.stringify(candidate.evidence ?? []),
    });

    try {
      const response = await this.aiProvider!.generateJson([
        {
          role: 'system',
          content: 'Return valid JSON only. Rewrite the insight summary in clear business language using only the supplied data. Do not invent numbers.',
        },
        { role: 'user', content: prompt },
      ], {
        tenantId,
        callType: 'summary',
        maxTokens: 220,
      });
      const summary = typeof (response as any)?.summary === 'string' ? (response as any).summary.trim() : '';
      return summary ? summary.slice(0, 1500) : null;
    } catch (error: any) {
      this.logger.warn(`Insight narrative generation skipped for ${provider.providerId}/${candidate.dedupeKey} (tenant ${tenantId}): ${String(error?.message ?? error).slice(0, 200)}`);
      return null;
    }
  }

  /** Drops metric keys matching the sensitive-field pattern when the tenant
   *  masks sensitive fields, mirroring ResultSummarizerService.maskRow. */
  private maskMetrics(metrics: Record<string, unknown> | null, mask: boolean): Record<string, unknown> | null {
    if (!metrics || !mask) return metrics;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metrics)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = value;
    }
    return out;
  }

  /** Key-sorted JSON so two equal objects with different key order compare
   *  equal (the stored metrics JSON may not preserve provider key order). */
  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    const entries = Object.keys(value as Record<string, unknown>).sort();
    return `{${entries.map((key) => `${JSON.stringify(key)}:${this.stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
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
