import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { AiChargeService, ChargeTicket } from '../ai-billing/charge.service';
import { AiRegistryService } from '../ai-billing/registry.service';
import { AiReportingUnavailable } from './ai-reporting.errors';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

type AiProviderCallType = 'semantic_parse' | 'summary' | 'config_test' | 'text';

const LEGACY_DEFAULT_TIMEOUT_MS = 30000;

interface ProviderConfigRow {
  id: string;
  tenant_id: string;
  provider: string;
  model: string | null;
  summary_model: string | null;
  api_key_encrypted: string | null;
  api_key_last4: string | null;
  api_key_fingerprint: string | null;
  endpoint_url: string | null;
  organization_id: string | null;
  enabled: boolean;
  max_tokens: number | null;
  temperature: string | number | null;
  monthly_token_limit: number | null;
  monthly_cost_limit_cents: number | null;
  input_token_cost_per_1m_cents: number | null;
  output_token_cost_per_1m_cents: number | null;
  timeout_ms: number;
  max_result_rows: number;
  max_summary_rows: number;
  daily_user_call_limit: number;
  daily_tenant_call_limit: number;
  monthly_company_call_limit: number;
  mask_sensitive_fields: boolean;
  summaries_enabled: boolean;
  rate_per_user_per_minute: number;
  rate_per_tenant_per_hour: number;
  max_concurrent_per_user: number;
  max_concurrent_per_tenant: number;
  last_tested_at: Date | string | null;
  last_test_status: string | null;
  last_test_error: string | null;
  updated_at: Date | string | null;
}

export interface AiTenantOperationalConfig {
  enabled: boolean;
  timeoutMs: number;
  maxResultRows: number;
  maxSummaryRows: number;
  dailyUserCallLimit: number;
  dailyTenantCallLimit: number;
  monthlyCompanyCallLimit: number;
  maskSensitiveFields: boolean;
  summariesEnabled: boolean;
  ratePerUserPerMinute: number;
  ratePerTenantPerHour: number;
  maxConcurrentPerUser: number;
  maxConcurrentPerTenant: number;
}

export const AI_OPERATIONAL_DEFAULTS: AiTenantOperationalConfig = {
  enabled: false,
  timeoutMs: 120000,
  maxResultRows: 500,
  maxSummaryRows: 50,
  dailyUserCallLimit: 100,
  dailyTenantCallLimit: 2000,
  monthlyCompanyCallLimit: 5000,
  maskSensitiveFields: true,
  summariesEnabled: true,
  ratePerUserPerMinute: 20,
  ratePerTenantPerHour: 500,
  maxConcurrentPerUser: 2,
  maxConcurrentPerTenant: 20,
};

function effectiveTimeoutMs(timeoutMs: number | null | undefined): number {
  return timeoutMs && timeoutMs !== LEGACY_DEFAULT_TIMEOUT_MS
    ? timeoutMs
    : AI_OPERATIONAL_DEFAULTS.timeoutMs;
}

interface ResolvedProviderConfig {
  provider: 'openai';
  model: string;
  summaryModel?: string | null;
  apiKey: string;
  endpointUrl?: string | null;
  organizationId?: string | null;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  monthlyTokenLimit?: number | null;
  monthlyCostLimitCents?: number | null;
  inputTokenCostPer1mCents?: number | null;
  outputTokenCostPer1mCents?: number | null;
  /** Set when resolved from the centralized AI billing registry. */
  central?: { providerId: string; providerName: string; modelId: string } | null;
}

export interface AiTenantProviderSettingsUpdate {
  enabled?: boolean;
  provider?: string;
  model?: string;
  summaryModel?: string | null;
  apiKey?: string | null;
  clearApiKey?: boolean;
  endpointUrl?: string | null;
  organizationId?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  monthlyTokenLimit?: number | null;
  monthlyCostLimitCents?: number | null;
  inputTokenCostPer1mCents?: number | null;
  outputTokenCostPer1mCents?: number | null;
  timeoutMs?: number | null;
  maxResultRows?: number | null;
  maxSummaryRows?: number | null;
  dailyUserCallLimit?: number | null;
  dailyTenantCallLimit?: number | null;
  monthlyCompanyCallLimit?: number | null;
  maskSensitiveFields?: boolean | null;
  summariesEnabled?: boolean | null;
  ratePerUserPerMinute?: number | null;
  ratePerTenantPerHour?: number | null;
  maxConcurrentPerUser?: number | null;
  maxConcurrentPerTenant?: number | null;
}

export interface AiTenantUsageSummary {
  periodStart: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostCents: number | null;
  byModel: Array<{
    provider: string;
    model: string | null;
    calls: number;
    totalTokens: number;
    estimatedCostCents: number | null;
  }>;
}

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
    // Centralized AI billing platform (optional so bare unit-spec construction
    // keeps working). When present, keys/models come from the super-admin
    // registry and every call runs the reserve→execute→settle lifecycle.
    @Optional() private readonly billingRegistry?: AiRegistryService,
    @Optional() private readonly billingCharge?: AiChargeService,
  ) {}

  async generateJson(
    messages: ChatMessage[],
    options?: { model?: string; maxTokens?: number; tenantId?: string; userId?: string; requestId?: string; callType?: AiProviderCallType },
  ): Promise<unknown> {
    const text = await this.callProvider(messages, {
      model: options?.model,
      maxTokens: options?.maxTokens,
      jsonMode: true,
      tenantId: options?.tenantId,
      userId: options?.userId,
      requestId: options?.requestId,
      callType: options?.callType ?? 'semantic_parse',
    });
    try {
      return JSON.parse(text);
    } catch {
      throw new AiReportingUnavailable('AI provider returned invalid JSON');
    }
  }

  async generateText(
    messages: ChatMessage[],
    options?: { model?: string; maxTokens?: number; tenantId?: string; userId?: string; requestId?: string; callType?: AiProviderCallType },
  ): Promise<string> {
    return this.callProvider(messages, {
      model: options?.model,
      maxTokens: options?.maxTokens,
      jsonMode: false,
      tenantId: options?.tenantId,
      userId: options?.userId,
      requestId: options?.requestId,
      callType: options?.callType ?? 'text',
    });
  }

  async getPublicTenantProviderSettings(tenantId: string) {
    const row = await this.readTenantProviderConfig(tenantId);
    const usage = await this.getTenantUsageSummary(tenantId);

    if (row) {
      return {
        configured: true as const,
        enabled: row.enabled,
        provider: row.provider,
        model: row.model ?? '',
        summaryModel: row.summary_model,
        apiKeyConfigured: Boolean(row.api_key_encrypted),
        apiKeyLast4: row.api_key_last4,
        endpointUrl: row.endpoint_url,
        organizationId: row.organization_id,
        maxTokens: row.max_tokens,
        temperature: this.numberOrNull(row.temperature),
        monthlyTokenLimit: row.monthly_token_limit,
        monthlyCostLimitCents: row.monthly_cost_limit_cents,
        inputTokenCostPer1mCents: row.input_token_cost_per_1m_cents,
        outputTokenCostPer1mCents: row.output_token_cost_per_1m_cents,
        timeoutMs: effectiveTimeoutMs(row.timeout_ms),
        maxResultRows: row.max_result_rows ?? AI_OPERATIONAL_DEFAULTS.maxResultRows,
        maxSummaryRows: row.max_summary_rows ?? AI_OPERATIONAL_DEFAULTS.maxSummaryRows,
        dailyUserCallLimit: row.daily_user_call_limit ?? AI_OPERATIONAL_DEFAULTS.dailyUserCallLimit,
        dailyTenantCallLimit: row.daily_tenant_call_limit ?? AI_OPERATIONAL_DEFAULTS.dailyTenantCallLimit,
        monthlyCompanyCallLimit: row.monthly_company_call_limit ?? AI_OPERATIONAL_DEFAULTS.monthlyCompanyCallLimit,
        maskSensitiveFields: row.mask_sensitive_fields ?? AI_OPERATIONAL_DEFAULTS.maskSensitiveFields,
        summariesEnabled: row.summaries_enabled ?? AI_OPERATIONAL_DEFAULTS.summariesEnabled,
        ratePerUserPerMinute: row.rate_per_user_per_minute ?? AI_OPERATIONAL_DEFAULTS.ratePerUserPerMinute,
        ratePerTenantPerHour: row.rate_per_tenant_per_hour ?? AI_OPERATIONAL_DEFAULTS.ratePerTenantPerHour,
        maxConcurrentPerUser: row.max_concurrent_per_user ?? AI_OPERATIONAL_DEFAULTS.maxConcurrentPerUser,
        maxConcurrentPerTenant: row.max_concurrent_per_tenant ?? AI_OPERATIONAL_DEFAULTS.maxConcurrentPerTenant,
        lastTestedAt: this.isoOrNull(row.last_tested_at),
        lastTestStatus: row.last_test_status,
        lastTestError: row.last_test_error,
        updatedAt: this.isoOrNull(row.updated_at),
        usage,
      };
    }

    return {
      configured: false as const,
      enabled: false,
      provider: 'openai',
      model: '',
      summaryModel: null,
      apiKeyConfigured: false,
      apiKeyLast4: null,
      endpointUrl: null,
      organizationId: null,
      maxTokens: null,
      temperature: null,
      monthlyTokenLimit: null,
      monthlyCostLimitCents: null,
      inputTokenCostPer1mCents: null,
      outputTokenCostPer1mCents: null,
      timeoutMs: AI_OPERATIONAL_DEFAULTS.timeoutMs,
      maxResultRows: AI_OPERATIONAL_DEFAULTS.maxResultRows,
      maxSummaryRows: AI_OPERATIONAL_DEFAULTS.maxSummaryRows,
      dailyUserCallLimit: AI_OPERATIONAL_DEFAULTS.dailyUserCallLimit,
      dailyTenantCallLimit: AI_OPERATIONAL_DEFAULTS.dailyTenantCallLimit,
      monthlyCompanyCallLimit: AI_OPERATIONAL_DEFAULTS.monthlyCompanyCallLimit,
      maskSensitiveFields: AI_OPERATIONAL_DEFAULTS.maskSensitiveFields,
      summariesEnabled: AI_OPERATIONAL_DEFAULTS.summariesEnabled,
      ratePerUserPerMinute: AI_OPERATIONAL_DEFAULTS.ratePerUserPerMinute,
      ratePerTenantPerHour: AI_OPERATIONAL_DEFAULTS.ratePerTenantPerHour,
      maxConcurrentPerUser: AI_OPERATIONAL_DEFAULTS.maxConcurrentPerUser,
      maxConcurrentPerTenant: AI_OPERATIONAL_DEFAULTS.maxConcurrentPerTenant,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      updatedAt: null,
      usage,
    };
  }

  /**
   * Returns the per-tenant operational config. Falls back to defaults when no row exists.
   * Used by services to read timeouts/limits/feature flags without touching env.
   */
  async getTenantOperationalConfig(tenantId: string | undefined | null): Promise<AiTenantOperationalConfig> {
    if (!tenantId) return AI_OPERATIONAL_DEFAULTS;
    const row = await this.readTenantProviderConfig(tenantId);
    if (!row) return AI_OPERATIONAL_DEFAULTS;
    return {
      enabled: row.enabled,
      timeoutMs: effectiveTimeoutMs(row.timeout_ms),
      maxResultRows: row.max_result_rows ?? AI_OPERATIONAL_DEFAULTS.maxResultRows,
      maxSummaryRows: row.max_summary_rows ?? AI_OPERATIONAL_DEFAULTS.maxSummaryRows,
      dailyUserCallLimit: row.daily_user_call_limit ?? AI_OPERATIONAL_DEFAULTS.dailyUserCallLimit,
      dailyTenantCallLimit: row.daily_tenant_call_limit ?? AI_OPERATIONAL_DEFAULTS.dailyTenantCallLimit,
      monthlyCompanyCallLimit: row.monthly_company_call_limit ?? AI_OPERATIONAL_DEFAULTS.monthlyCompanyCallLimit,
      maskSensitiveFields: row.mask_sensitive_fields ?? AI_OPERATIONAL_DEFAULTS.maskSensitiveFields,
      summariesEnabled: row.summaries_enabled ?? AI_OPERATIONAL_DEFAULTS.summariesEnabled,
      ratePerUserPerMinute: row.rate_per_user_per_minute ?? AI_OPERATIONAL_DEFAULTS.ratePerUserPerMinute,
      ratePerTenantPerHour: row.rate_per_tenant_per_hour ?? AI_OPERATIONAL_DEFAULTS.ratePerTenantPerHour,
      maxConcurrentPerUser: row.max_concurrent_per_user ?? AI_OPERATIONAL_DEFAULTS.maxConcurrentPerUser,
      maxConcurrentPerTenant: row.max_concurrent_per_tenant ?? AI_OPERATIONAL_DEFAULTS.maxConcurrentPerTenant,
    };
  }

  async saveTenantProviderSettings(tenantId: string, configuredById: string | null, input: AiTenantProviderSettingsUpdate) {
    const prisma = this.requirePrisma();
    const current = await this.readTenantProviderConfig(tenantId);
    const provider = this.normalizeProvider(input.provider ?? current?.provider ?? 'openai');
    const model = this.cleanString(input.model) ?? current?.model;
    if (!model) {
      throw new BadRequestException({ code: 'AI_PROVIDER_MODEL_REQUIRED', message: 'AI model is required' });
    }

    const summaryModel = input.summaryModel === undefined
      ? current?.summary_model ?? null
      : this.cleanString(input.summaryModel);
    const endpointUrl = input.endpointUrl === undefined
      ? current?.endpoint_url ?? null
      : this.normalizeEndpointUrl(input.endpointUrl);
    const organizationId = input.organizationId === undefined
      ? current?.organization_id ?? null
      : this.cleanString(input.organizationId);
    const enabled = input.enabled === undefined ? current?.enabled ?? true : Boolean(input.enabled);
    const maxTokens = this.optionalInt(input.maxTokens, current?.max_tokens ?? null, 1, 200000);
    const temperature = this.optionalNumber(input.temperature, this.numberOrNull(current?.temperature), 0, 2);
    const monthlyTokenLimit = this.optionalInt(input.monthlyTokenLimit, current?.monthly_token_limit ?? null, 1, 2_000_000_000);
    const monthlyCostLimitCents = this.optionalInt(input.monthlyCostLimitCents, current?.monthly_cost_limit_cents ?? null, 1, 2_000_000_000);
    const inputCost = this.optionalInt(input.inputTokenCostPer1mCents, current?.input_token_cost_per_1m_cents ?? null, 0, 2_000_000_000);
    const outputCost = this.optionalInt(input.outputTokenCostPer1mCents, current?.output_token_cost_per_1m_cents ?? null, 0, 2_000_000_000);
    const timeoutMs = this.requiredInt(input.timeoutMs, current?.timeout_ms ?? AI_OPERATIONAL_DEFAULTS.timeoutMs, 1000, 600000);
    const maxResultRows = this.requiredInt(input.maxResultRows, current?.max_result_rows ?? AI_OPERATIONAL_DEFAULTS.maxResultRows, 1, 10000);
    const maxSummaryRows = this.requiredInt(input.maxSummaryRows, current?.max_summary_rows ?? AI_OPERATIONAL_DEFAULTS.maxSummaryRows, 1, 500);
    const dailyUserCallLimit = this.requiredInt(input.dailyUserCallLimit, current?.daily_user_call_limit ?? AI_OPERATIONAL_DEFAULTS.dailyUserCallLimit, 1, 100000);
    const dailyTenantCallLimit = this.requiredInt(input.dailyTenantCallLimit, current?.daily_tenant_call_limit ?? AI_OPERATIONAL_DEFAULTS.dailyTenantCallLimit, 1, 1000000);
    const monthlyCompanyCallLimit = this.requiredInt(input.monthlyCompanyCallLimit, current?.monthly_company_call_limit ?? AI_OPERATIONAL_DEFAULTS.monthlyCompanyCallLimit, 1, 10000000);
    const maskSensitiveFields = input.maskSensitiveFields === undefined || input.maskSensitiveFields === null
      ? current?.mask_sensitive_fields ?? AI_OPERATIONAL_DEFAULTS.maskSensitiveFields
      : Boolean(input.maskSensitiveFields);
    const summariesEnabled = input.summariesEnabled === undefined || input.summariesEnabled === null
      ? current?.summaries_enabled ?? AI_OPERATIONAL_DEFAULTS.summariesEnabled
      : Boolean(input.summariesEnabled);
    const ratePerUserPerMinute = this.requiredInt(input.ratePerUserPerMinute, current?.rate_per_user_per_minute ?? AI_OPERATIONAL_DEFAULTS.ratePerUserPerMinute, 1, 10000);
    const ratePerTenantPerHour = this.requiredInt(input.ratePerTenantPerHour, current?.rate_per_tenant_per_hour ?? AI_OPERATIONAL_DEFAULTS.ratePerTenantPerHour, 1, 1000000);
    const maxConcurrentPerUser = this.requiredInt(input.maxConcurrentPerUser, current?.max_concurrent_per_user ?? AI_OPERATIONAL_DEFAULTS.maxConcurrentPerUser, 1, 100);
    const maxConcurrentPerTenant = this.requiredInt(input.maxConcurrentPerTenant, current?.max_concurrent_per_tenant ?? AI_OPERATIONAL_DEFAULTS.maxConcurrentPerTenant, 1, 1000);

    let apiKeyEncrypted = current?.api_key_encrypted ?? null;
    let apiKeyLast4 = current?.api_key_last4 ?? null;
    let apiKeyFingerprint = current?.api_key_fingerprint ?? null;
    if (input.clearApiKey) {
      apiKeyEncrypted = null;
      apiKeyLast4 = null;
      apiKeyFingerprint = null;
    }
    const cleanApiKey = this.cleanString(input.apiKey);
    if (cleanApiKey) {
      apiKeyEncrypted = this.encryptSecret(cleanApiKey);
      apiKeyLast4 = cleanApiKey.slice(-4);
      apiKeyFingerprint = createHash('sha256').update(cleanApiKey).digest('hex');
    }

    await prisma.$executeRawUnsafe(
      `
        INSERT INTO ai_tenant_provider_configs (
          tenant_id, provider, model, summary_model, api_key_encrypted,
          api_key_last4, api_key_fingerprint, endpoint_url, organization_id,
          enabled, max_tokens, temperature, monthly_token_limit,
          monthly_cost_limit_cents, input_token_cost_per_1m_cents,
          output_token_cost_per_1m_cents, configured_by_id,
          timeout_ms, max_result_rows, max_summary_rows,
          daily_user_call_limit, daily_tenant_call_limit, monthly_company_call_limit,
          mask_sensitive_fields, summaries_enabled,
          rate_per_user_per_minute, rate_per_tenant_per_hour,
          max_concurrent_per_user, max_concurrent_per_tenant,
          updated_at
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9,
          $10::boolean, $11::int, $12::numeric, $13::int,
          $14::int, $15::int, $16::int, $17::uuid,
          $18::int, $19::int, $20::int,
          $21::int, $22::int, $23::int,
          $24::boolean, $25::boolean,
          $26::int, $27::int,
          $28::int, $29::int,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
          provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          summary_model = EXCLUDED.summary_model,
          api_key_encrypted = EXCLUDED.api_key_encrypted,
          api_key_last4 = EXCLUDED.api_key_last4,
          api_key_fingerprint = EXCLUDED.api_key_fingerprint,
          endpoint_url = EXCLUDED.endpoint_url,
          organization_id = EXCLUDED.organization_id,
          enabled = EXCLUDED.enabled,
          max_tokens = EXCLUDED.max_tokens,
          temperature = EXCLUDED.temperature,
          monthly_token_limit = EXCLUDED.monthly_token_limit,
          monthly_cost_limit_cents = EXCLUDED.monthly_cost_limit_cents,
          input_token_cost_per_1m_cents = EXCLUDED.input_token_cost_per_1m_cents,
          output_token_cost_per_1m_cents = EXCLUDED.output_token_cost_per_1m_cents,
          configured_by_id = EXCLUDED.configured_by_id,
          timeout_ms = EXCLUDED.timeout_ms,
          max_result_rows = EXCLUDED.max_result_rows,
          max_summary_rows = EXCLUDED.max_summary_rows,
          daily_user_call_limit = EXCLUDED.daily_user_call_limit,
          daily_tenant_call_limit = EXCLUDED.daily_tenant_call_limit,
          monthly_company_call_limit = EXCLUDED.monthly_company_call_limit,
          mask_sensitive_fields = EXCLUDED.mask_sensitive_fields,
          summaries_enabled = EXCLUDED.summaries_enabled,
          rate_per_user_per_minute = EXCLUDED.rate_per_user_per_minute,
          rate_per_tenant_per_hour = EXCLUDED.rate_per_tenant_per_hour,
          max_concurrent_per_user = EXCLUDED.max_concurrent_per_user,
          max_concurrent_per_tenant = EXCLUDED.max_concurrent_per_tenant,
          updated_at = CURRENT_TIMESTAMP
      `,
      tenantId,
      provider,
      model,
      summaryModel,
      apiKeyEncrypted,
      apiKeyLast4,
      apiKeyFingerprint,
      endpointUrl,
      organizationId,
      enabled,
      maxTokens,
      temperature,
      monthlyTokenLimit,
      monthlyCostLimitCents,
      inputCost,
      outputCost,
      configuredById,
      timeoutMs,
      maxResultRows,
      maxSummaryRows,
      dailyUserCallLimit,
      dailyTenantCallLimit,
      monthlyCompanyCallLimit,
      maskSensitiveFields,
      summariesEnabled,
      ratePerUserPerMinute,
      ratePerTenantPerHour,
      maxConcurrentPerUser,
      maxConcurrentPerTenant,
    );

    return this.getPublicTenantProviderSettings(tenantId);
  }

  async testTenantProviderSettings(tenantId: string, userId: string) {
    try {
      const response = await this.generateJson(
        [
          { role: 'system', content: 'Return valid JSON only.' },
          { role: 'user', content: 'Return {"ok":true,"message":"connected"} to confirm this AI provider connection.' },
        ],
        { tenantId, userId, callType: 'config_test', maxTokens: 80 },
      );
      await this.updateTestStatus(tenantId, 'success', null);
      return {
        success: true,
        message: typeof (response as any)?.message === 'string' ? (response as any).message : 'AI provider connection verified',
        testedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      const message = this.safeMessage(error);
      await this.updateTestStatus(tenantId, 'error', message);
      throw error;
    }
  }

  async getTenantUsageSummary(tenantId: string): Promise<AiTenantUsageSummary> {
    if (!this.prisma) {
      return this.emptyUsageSummary();
    }

    const [summaryRows, modelRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{
        total_calls: bigint | number | string;
        successful_calls: bigint | number | string;
        failed_calls: bigint | number | string;
        prompt_tokens: bigint | number | string | null;
        completion_tokens: bigint | number | string | null;
        total_tokens: bigint | number | string | null;
        estimated_cost_cents: string | number | null;
        period_start: Date | string;
      }>>(
        `
          SELECT
            date_trunc('month', now()) AS period_start,
            COUNT(*) AS total_calls,
            COUNT(*) FILTER (WHERE status = 'success') AS successful_calls,
            COUNT(*) FILTER (WHERE status = 'error') AS failed_calls,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            SUM(estimated_cost_cents) AS estimated_cost_cents
          FROM ai_report_usage_events
          WHERE tenant_id = $1::uuid
            AND created_at >= date_trunc('month', now())
        `,
        tenantId,
      ),
      this.prisma.$queryRawUnsafe<Array<{
        provider: string;
        model: string | null;
        calls: bigint | number | string;
        total_tokens: bigint | number | string | null;
        estimated_cost_cents: string | number | null;
      }>>(
        `
          SELECT provider, model, COUNT(*) AS calls,
                 COALESCE(SUM(total_tokens), 0) AS total_tokens,
                 SUM(estimated_cost_cents) AS estimated_cost_cents
          FROM ai_report_usage_events
          WHERE tenant_id = $1::uuid
            AND created_at >= date_trunc('month', now())
          GROUP BY provider, model
          ORDER BY calls DESC
        `,
        tenantId,
      ),
    ]);

    const summary = summaryRows[0];
    return {
      periodStart: this.isoOrNull(summary?.period_start) ?? new Date().toISOString(),
      totalCalls: this.numberValue(summary?.total_calls),
      successfulCalls: this.numberValue(summary?.successful_calls),
      failedCalls: this.numberValue(summary?.failed_calls),
      promptTokens: this.numberValue(summary?.prompt_tokens),
      completionTokens: this.numberValue(summary?.completion_tokens),
      totalTokens: this.numberValue(summary?.total_tokens),
      estimatedCostCents: this.numberOrNull(summary?.estimated_cost_cents),
      byModel: modelRows.map((row) => ({
        provider: row.provider,
        model: row.model,
        calls: this.numberValue(row.calls),
        totalTokens: this.numberValue(row.total_tokens),
        estimatedCostCents: this.numberOrNull(row.estimated_cost_cents),
      })),
    };
  }

  private async callProvider(
    messages: ChatMessage[],
    options: {
      model?: string;
      maxTokens?: number;
      jsonMode: boolean;
      tenantId?: string;
      userId?: string;
      requestId?: string;
      callType: AiProviderCallType;
    },
  ): Promise<string> {
    const resolved = await this.resolveProviderConfig(options.tenantId, options.callType, options.model, options.maxTokens);
    if (resolved.provider !== 'openai') {
      throw new AiReportingUnavailable('Configured AI provider is not supported for AI reporting');
    }

    await this.assertProviderBudget(options.tenantId, resolved);

    const timeoutMs = resolved.timeoutMs;
    const maxTokens = options.maxTokens ?? resolved.maxTokens;

    // Billing lifecycle: validate access, resolve pricing, reserve credits
    // BEFORE the provider call. Throws 402/403 when the tenant must not run
    // this request (insufficient credits, suspended access, spend limits).
    let chargeTicket: ChargeTicket | null = null;
    if (this.billingCharge && options.tenantId && resolved.central) {
      chargeTicket = await this.billingCharge.prepare({
        tenantId: options.tenantId,
        userId: options.userId ?? null,
        providerId: resolved.central.providerId,
        providerName: resolved.central.providerName,
        modelId: resolved.central.modelId,
        modelCode: resolved.model,
        callType: options.callType,
        estimatedPromptTokens: Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4),
        maxCompletionTokens: maxTokens,
      });
    }
    const body: Record<string, unknown> = {
      model: resolved.model,
      messages,
      max_completion_tokens: maxTokens,
    };
    if (Number.isFinite(resolved.temperature) && this.supportsTemperature(resolved.model)) {
      body.temperature = resolved.temperature;
    }
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const started = Date.now();
    try {
      const attempts = 2;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(this.resolveOpenAiEndpoint(resolved.endpointUrl), {
            method: 'POST',
            headers: this.openAiHeaders(resolved),
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            const detail = await response.text().catch(() => '');
            this.logger.warn(`AI provider request failed: status=${response.status}, retryable=${retryable}, attempt=${attempt}, providerError=${this.safeLogProviderError(detail)}`);
            if (retryable && attempt < attempts) continue;
            throw new AiReportingUnavailable(this.safeProviderError(response.status, detail));
          }

          const payload = await response.json() as any;
          const content = payload?.choices?.[0]?.message?.content;
          if (typeof content !== 'string' || !content.trim()) {
            throw new AiReportingUnavailable('AI provider returned an empty response');
          }

          await this.recordUsage({
            tenantId: options.tenantId,
            userId: options.userId,
            requestId: options.requestId,
            resolved,
            callType: options.callType,
            status: 'success',
            latencyMs: Date.now() - started,
            usage: payload?.usage,
          });
          if (chargeTicket) {
            await this.billingCharge?.settle(chargeTicket, {
              success: true,
              executionMs: Date.now() - started,
              requestId: options.requestId ?? null,
              usage: {
                promptTokens: this.optionalUsageInt(payload?.usage?.prompt_tokens) ?? 0,
                completionTokens: this.optionalUsageInt(payload?.usage?.completion_tokens) ?? 0,
                cachedTokens: this.optionalUsageInt(payload?.usage?.prompt_tokens_details?.cached_tokens) ?? 0,
                reasoningTokens: this.optionalUsageInt(payload?.usage?.completion_tokens_details?.reasoning_tokens) ?? 0,
                totalTokens: this.optionalUsageInt(payload?.usage?.total_tokens) ?? undefined,
              },
            });
          }
          return content.trim();
        } catch (error: any) {
          if (error instanceof AiReportingUnavailable) throw error;
          const aborted = error?.name === 'AbortError';
          this.logger.warn(`AI provider request ${aborted ? 'timed out' : 'failed'} on attempt ${attempt}`);
          if (attempt >= attempts || !aborted) {
            throw new AiReportingUnavailable(aborted ? 'AI provider request timed out' : 'AI provider request failed');
          }
        } finally {
          clearTimeout(timeout);
        }
      }
      throw new AiReportingUnavailable();
    } catch (error: any) {
      await this.recordUsage({
        tenantId: options.tenantId,
        userId: options.userId,
        requestId: options.requestId,
        resolved,
        callType: options.callType,
        status: 'error',
        latencyMs: Date.now() - started,
        errorCode: error?.response?.code ?? error?.response?.error ?? error?.name ?? 'AI_PROVIDER_ERROR',
        errorMessage: error?.response?.message ?? error?.message ?? 'AI provider request failed',
      });
      if (chargeTicket) {
        // Failed request: release the credit hold, log usage as FAILED, no charge.
        await this.billingCharge?.settle(chargeTicket, {
          success: false,
          executionMs: Date.now() - started,
          requestId: options.requestId ?? null,
        });
      }
      throw error;
    }
  }

  private async resolveProviderConfig(
    tenantId: string | undefined,
    callType: AiProviderCallType,
    modelOverride?: string,
    maxTokensOverride?: number,
  ): Promise<ResolvedProviderConfig> {
    if (!tenantId) {
      throw new AiReportingUnavailable('AI reporting requires a tenant context');
    }

    // Centralized AI platform first: providers/models/keys are super-admin
    // managed in the billing registry, with priority-ordered failover.
    if (this.billingRegistry) {
      const target = await this.billingRegistry.resolveExecutionTarget(this.cleanString(modelOverride) ?? null);
      if (target) {
        return {
          provider: 'openai',
          model: target.model.modelCode,
          summaryModel: null,
          apiKey: target.provider.apiKey,
          endpointUrl: target.provider.endpointUrl,
          organizationId: target.provider.organizationId,
          maxTokens: maxTokensOverride ?? 1500,
          temperature: 0,
          timeoutMs: AI_OPERATIONAL_DEFAULTS.timeoutMs,
          central: {
            providerId: target.provider.id,
            providerName: target.provider.name,
            modelId: target.model.id,
          },
        };
      }
      // With billing enforcement ON there is NO legacy fallback: an AI call
      // that bypassed the central registry would run unmetered and unbilled.
      // Enforcement OFF keeps the legacy per-tenant config as a transition
      // path for deployments still seeding the registry.
      if (this.billingCharge?.enforcementEnabled()) {
        throw new AiReportingUnavailable(
          'AI is not available: no active centrally configured provider/model. Ask the platform administrator to configure Administration → AI Management.',
        );
      }
    }

    const row = await this.readTenantProviderConfig(tenantId);
    if (!row) {
      throw new AiReportingUnavailable('AI provider is not configured — ask the platform administrator to configure AI Management');
    }
    if (!row.enabled) {
      throw new AiReportingUnavailable('Tenant AI provider configuration is disabled');
    }
    if (!row.api_key_encrypted) {
      throw new AiReportingUnavailable('Tenant AI provider API key is not configured');
    }
    const model = this.cleanString(modelOverride)
      ?? (callType === 'summary' ? this.cleanString(row.summary_model) : null)
      ?? this.cleanString(row.model);
    if (!model) {
      throw new AiReportingUnavailable('Tenant AI provider model is not configured');
    }
    return {
      provider: this.normalizeProvider(row.provider),
      model,
      summaryModel: row.summary_model,
      apiKey: this.decryptSecret(row.api_key_encrypted),
      endpointUrl: row.endpoint_url,
      organizationId: row.organization_id,
      maxTokens: maxTokensOverride ?? row.max_tokens ?? 1500,
      temperature: this.numberOrNull(row.temperature) ?? 0,
      timeoutMs: effectiveTimeoutMs(row.timeout_ms),
      monthlyTokenLimit: row.monthly_token_limit,
      monthlyCostLimitCents: row.monthly_cost_limit_cents,
      inputTokenCostPer1mCents: row.input_token_cost_per_1m_cents,
      outputTokenCostPer1mCents: row.output_token_cost_per_1m_cents,
    };
  }

  private async assertProviderBudget(tenantId: string | undefined, resolved: ResolvedProviderConfig) {
    if (!tenantId || !this.prisma) return;
    if (!resolved.monthlyTokenLimit && !resolved.monthlyCostLimitCents) return;

    const rows = await this.prisma.$queryRawUnsafe<Array<{
      total_tokens: bigint | number | string | null;
      estimated_cost_cents: string | number | null;
    }>>(
      `
        SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens,
               COALESCE(SUM(estimated_cost_cents), 0) AS estimated_cost_cents
        FROM ai_report_usage_events
        WHERE tenant_id = $1::uuid
          AND created_at >= date_trunc('month', now())
      `,
      tenantId,
    );

    const currentTokens = this.numberValue(rows[0]?.total_tokens);
    const currentCost = this.numberOrNull(rows[0]?.estimated_cost_cents) ?? 0;
    if (resolved.monthlyTokenLimit && currentTokens >= resolved.monthlyTokenLimit) {
      throw new HttpException(
        { code: 'AI_BILLING_LIMIT_EXCEEDED', message: 'Monthly AI token limit exceeded for this tenant' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    if (resolved.monthlyCostLimitCents && currentCost >= resolved.monthlyCostLimitCents) {
      throw new HttpException(
        { code: 'AI_BILLING_LIMIT_EXCEEDED', message: 'Monthly AI cost limit exceeded for this tenant' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  private async recordUsage(input: {
    tenantId?: string;
    userId?: string;
    requestId?: string;
    resolved: ResolvedProviderConfig;
    callType: AiProviderCallType;
    status: 'success' | 'error';
    latencyMs: number;
    usage?: any;
    errorCode?: string;
    errorMessage?: string;
  }) {
    if (!input.tenantId || !this.prisma) return;

    const promptTokens = this.optionalUsageInt(input.usage?.prompt_tokens);
    const completionTokens = this.optionalUsageInt(input.usage?.completion_tokens);
    const totalTokens = this.optionalUsageInt(input.usage?.total_tokens)
      ?? ((promptTokens ?? 0) + (completionTokens ?? 0) || null);
    const estimatedCostCents = this.estimateCostCents(input.resolved, promptTokens, completionTokens);

    try {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO ai_report_usage_events (
            tenant_id, user_id, request_id, provider, model, call_type, status,
            prompt_tokens, completion_tokens, total_tokens, estimated_cost_cents,
            latency_ms, error_code, error_message
          )
          VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
            $8::int, $9::int, $10::int, $11::numeric,
            $12::int, $13, $14
          )
        `,
        input.tenantId,
        input.userId ?? null,
        input.requestId ?? null,
        input.resolved.provider,
        input.resolved.model,
        input.callType,
        input.status,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostCents,
        input.latencyMs,
        input.errorCode ?? null,
        input.errorMessage ? input.errorMessage.slice(0, 500) : null,
      );
    } catch (error: any) {
      this.logger.warn(`Failed to write AI provider usage event: ${String(error?.message ?? error).slice(0, 300)}`);
    }
  }

  private async readTenantProviderConfig(tenantId: string): Promise<ProviderConfigRow | null> {
    if (!this.prisma) return null;
    const rows = await this.prisma.$queryRawUnsafe<ProviderConfigRow[]>(
      `
        SELECT id, tenant_id, provider, model, summary_model, api_key_encrypted,
               api_key_last4, api_key_fingerprint, endpoint_url, organization_id,
               enabled, max_tokens, temperature, monthly_token_limit,
               monthly_cost_limit_cents, input_token_cost_per_1m_cents,
               output_token_cost_per_1m_cents,
               timeout_ms, max_result_rows, max_summary_rows,
               daily_user_call_limit, daily_tenant_call_limit, monthly_company_call_limit,
               mask_sensitive_fields, summaries_enabled,
               rate_per_user_per_minute, rate_per_tenant_per_hour,
               max_concurrent_per_user, max_concurrent_per_tenant,
               last_tested_at, last_test_status, last_test_error, updated_at
        FROM ai_tenant_provider_configs
        WHERE tenant_id = $1::uuid
        LIMIT 1
      `,
      tenantId,
    );
    return rows[0] ?? null;
  }

  private async updateTestStatus(tenantId: string, status: 'success' | 'error', error: string | null) {
    if (!this.prisma) return;
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE ai_tenant_provider_configs
        SET last_tested_at = CURRENT_TIMESTAMP,
            last_test_status = $2,
            last_test_error = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1::uuid
      `,
      tenantId,
      status,
      error ? error.slice(0, 500) : null,
    );
  }

  private requirePrisma(): PrismaService {
    if (!this.prisma) {
      throw new AiReportingUnavailable('AI provider settings database is not available');
    }
    return this.prisma;
  }

  private normalizeProvider(value: unknown): 'openai' {
    const provider = String(value ?? '').trim().toLowerCase();
    if (provider !== 'openai') {
      throw new BadRequestException({ code: 'AI_PROVIDER_UNSUPPORTED', message: 'Only the openai provider is currently supported' });
    }
    return 'openai';
  }

  private normalizeEndpointUrl(value: unknown): string | null {
    const url = this.cleanString(value);
    if (!url) return null;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException({ code: 'AI_PROVIDER_ENDPOINT_INVALID', message: 'AI provider endpoint URL is invalid' });
    }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new BadRequestException({ code: 'AI_PROVIDER_ENDPOINT_INVALID', message: 'AI provider endpoint must use HTTPS' });
    }
    return parsed.toString().replace(/\/$/, '');
  }

  private resolveOpenAiEndpoint(endpointUrl?: string | null): string {
    const endpoint = this.cleanString(endpointUrl);
    if (!endpoint) return DEFAULT_OPENAI_CHAT_COMPLETIONS_URL;
    if (endpoint.endsWith('/chat/completions')) return endpoint;
    return `${endpoint.replace(/\/$/, '')}/chat/completions`;
  }

  private openAiHeaders(resolved: ResolvedProviderConfig): HeadersInit {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${resolved.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (resolved.organizationId) {
      headers['OpenAI-Organization'] = resolved.organizationId;
    }
    return headers;
  }

  private estimateCostCents(
    config: ResolvedProviderConfig,
    promptTokens?: number | null,
    completionTokens?: number | null,
  ): string | null {
    const inputRate = config.inputTokenCostPer1mCents;
    const outputRate = config.outputTokenCostPer1mCents;
    if (inputRate == null && outputRate == null) return null;
    const inputCost = ((promptTokens ?? 0) * (inputRate ?? 0)) / 1_000_000;
    const outputCost = ((completionTokens ?? 0) * (outputRate ?? 0)) / 1_000_000;
    return (inputCost + outputCost).toFixed(4);
  }

  private encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  private decryptSecret(payload: string): string {
    const [version, ivRaw, tagRaw, encryptedRaw] = payload.split(':');
    if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) {
      throw new AiReportingUnavailable('Tenant AI provider API key cannot be decrypted');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(ivRaw, 'base64'));
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, 'base64')),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      throw new AiReportingUnavailable('Tenant AI provider API key cannot be decrypted');
    }
  }

  private encryptionKey(): Buffer {
    const secret = this.config.get<string>('AI_CONFIG_ENCRYPTION_KEY')
      || this.config.get<string>('JWT_SECRET')
      || this.config.get<string>('JWT_REFRESH_SECRET')
      || '';
    if (secret.length < 32) {
      throw new AiReportingUnavailable('AI_CONFIG_ENCRYPTION_KEY or JWT_SECRET must be configured for tenant AI provider secrets');
    }
    return createHash('sha256').update(`ai-provider-config:${secret}`).digest();
  }

  private positiveInt(value: string | number | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private requiredInt(value: unknown, fallback: number, min: number, max: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException({ code: 'AI_PROVIDER_INVALID_LIMIT', message: `Value must be an integer between ${min} and ${max}` });
    }
    return parsed;
  }

  private optionalInt(value: unknown, fallback: number | null, min: number, max: number): number | null {
    if (value === undefined) return fallback;
    if (value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException({ code: 'AI_PROVIDER_INVALID_LIMIT', message: `Value must be an integer between ${min} and ${max}` });
    }
    return parsed;
  }

  private optionalNumber(value: unknown, fallback: number | null, min: number, max: number): number | null {
    if (value === undefined) return fallback;
    if (value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException({ code: 'AI_PROVIDER_INVALID_NUMBER', message: `Value must be between ${min} and ${max}` });
    }
    return parsed;
  }

  private supportsTemperature(model: string): boolean {
    return !/^(o\d|o-|gpt-5)/i.test(model);
  }

  private safeProviderError(status: number, detail: string): string {
    const providerMessage = this.providerMessage(detail).toLowerCase();
    if (status === 401 || status === 403) return 'AI provider authentication failed';
    if (status === 429) return 'AI provider rate limit exceeded';
    if (status >= 500) return 'AI provider is temporarily unavailable';
    if (providerMessage.includes('model') || providerMessage.includes('does not exist')) {
      return 'Configured AI model was rejected by the AI provider';
    }
    if (providerMessage.includes('unsupported') || providerMessage.includes('unknown parameter') || providerMessage.includes('max_tokens') || providerMessage.includes('temperature')) {
      return 'AI provider rejected an unsupported request parameter for the configured model';
    }
    if (providerMessage.includes('context')) return 'AI request is too large for the configured model';
    return 'AI provider rejected the request';
  }

  private safeLogProviderError(detail: string): string {
    const parsed = this.providerError(detail);
    if (!parsed) return 'unavailable';
    return JSON.stringify({
      type: parsed.type,
      code: parsed.code,
      message: parsed.message?.slice(0, 300),
    });
  }

  private providerMessage(detail: string): string {
    return this.providerError(detail)?.message ?? detail;
  }

  private providerError(detail: string): { message?: string; type?: string; code?: string } | null {
    try {
      const parsed = JSON.parse(detail);
      const error = parsed?.error;
      if (!error || typeof error !== 'object') return null;
      return {
        message: typeof error.message === 'string' ? error.message : undefined,
        type: typeof error.type === 'string' ? error.type : undefined,
        code: typeof error.code === 'string' ? error.code : undefined,
      };
    } catch {
      return detail ? { message: detail } : null;
    }
  }

  private emptyUsageSummary(): AiTenantUsageSummary {
    return {
      periodStart: new Date().toISOString(),
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostCents: null,
      byModel: [],
    };
  }

  private cleanString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private optionalUsageInt(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  private numberValue(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private numberOrNull(value: unknown): number | null {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isoOrNull(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  private safeMessage(error: any): string {
    const response = error?.response;
    if (response?.message) return String(response.message);
    if (error?.message) return String(error.message);
    return 'AI provider connection test failed';
  }
}
