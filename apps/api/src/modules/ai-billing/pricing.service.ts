import { Injectable } from '@nestjs/common';
import { AiModelPricing, AiPricingScope, AiPricingStatus, Prisma, TenantTier } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { BillingAuditService } from './billing-audit.service';
import { BillingNotFoundError, BillingValidationError } from './billing.errors';

const D = (value: Prisma.Decimal | number | string): Prisma.Decimal => new Prisma.Decimal(value);
const MILLION = new Prisma.Decimal(1_000_000);

export interface TokenUsageInput {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  embeddingTokens?: number;
  images?: number;
}

export interface CostBreakdown {
  providerCost: Prisma.Decimal;
  customerCharge: Prisma.Decimal;
  margin: Prisma.Decimal;
  marginPct: number | null;
  pricingId: string;
  scope: AiPricingScope;
  currency: string;
}

export interface PricingUpsertInput {
  modelId: string;
  scope: AiPricingScope;
  planTier?: TenantTier | null;
  tenantId?: string | null;
  currency?: string;
  status?: AiPricingStatus;
  effectiveFrom: string | Date;
  effectiveTo?: string | Date | null;
  providerInputCost?: number;
  providerOutputCost?: number;
  providerCachedInputCost?: number;
  providerReasoningCost?: number;
  providerEmbeddingCost?: number;
  providerImageCost?: number;
  customerInputPrice?: number;
  customerOutputPrice?: number;
  customerCachedInputPrice?: number;
  customerReasoningPrice?: number;
  customerEmbeddingPrice?: number;
  customerImagePrice?: number;
}

/**
 * Pricing engine. Provider COSTS (what the AI vendor charges us) and customer
 * PRICES (what we charge the tenant) are independent columns, both expressed
 * per 1M tokens (images per unit), giving configurable margins. Resolution
 * precedence: TENANT override > PLAN (tier) > GLOBAL — most-recent effective
 * row wins inside a scope. Nothing is hardcoded.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: BillingAuditService,
  ) {}

  async resolvePricing(
    modelId: string,
    context: { tenantId?: string | null; planTier?: TenantTier | null },
    at: Date = new Date(),
  ): Promise<AiModelPricing | null> {
    const candidates = await this.prisma.aiModelPricing.findMany({
      where: {
        modelId,
        status: AiPricingStatus.ACTIVE,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const tenantRow = context.tenantId
      ? candidates.find((row) => row.scope === AiPricingScope.TENANT && row.tenantId === context.tenantId)
      : undefined;
    if (tenantRow) return tenantRow;
    const planRow = context.planTier
      ? candidates.find((row) => row.scope === AiPricingScope.PLAN && row.planTier === context.planTier)
      : undefined;
    if (planRow) return planRow;
    return candidates.find((row) => row.scope === AiPricingScope.GLOBAL) ?? null;
  }

  computeCost(pricing: AiModelPricing, usage: TokenUsageInput): CostBreakdown {
    const perMillion = (tokens: number | undefined, rate: Prisma.Decimal) =>
      D(tokens ?? 0).times(D(rate)).dividedBy(MILLION);
    const perUnit = (units: number | undefined, rate: Prisma.Decimal) => D(units ?? 0).times(D(rate));

    const providerCost = perMillion(usage.promptTokens, pricing.providerInputCost)
      .plus(perMillion(usage.completionTokens, pricing.providerOutputCost))
      .plus(perMillion(usage.cachedTokens, pricing.providerCachedInputCost))
      .plus(perMillion(usage.reasoningTokens, pricing.providerReasoningCost))
      .plus(perMillion(usage.embeddingTokens, pricing.providerEmbeddingCost))
      .plus(perUnit(usage.images, pricing.providerImageCost));

    const customerCharge = perMillion(usage.promptTokens, pricing.customerInputPrice)
      .plus(perMillion(usage.completionTokens, pricing.customerOutputPrice))
      .plus(perMillion(usage.cachedTokens, pricing.customerCachedInputPrice))
      .plus(perMillion(usage.reasoningTokens, pricing.customerReasoningPrice))
      .plus(perMillion(usage.embeddingTokens, pricing.customerEmbeddingPrice))
      .plus(perUnit(usage.images, pricing.customerImagePrice));

    const margin = customerCharge.minus(providerCost);
    return {
      providerCost,
      customerCharge,
      margin,
      marginPct: customerCharge.isZero() ? null : Number(margin.dividedBy(customerCharge).times(100).toFixed(2)),
      pricingId: pricing.id,
      scope: pricing.scope,
      currency: pricing.currency,
    };
  }

  /**
   * Worst-case customer charge used for credit reservation: full prompt
   * estimate + the completion budget, priced at the customer rate.
   */
  estimateCharge(pricing: AiModelPricing, estimate: { promptTokens: number; maxCompletionTokens: number }): Prisma.Decimal {
    return this.computeCost(pricing, {
      promptTokens: estimate.promptTokens,
      completionTokens: estimate.maxCompletionTokens,
    }).customerCharge;
  }

  /** Super-admin "what would this cost" simulator. */
  async simulate(input: {
    modelId: string;
    tenantId?: string | null;
    planTier?: TenantTier | null;
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  }) {
    const pricing = await this.resolvePricing(input.modelId, { tenantId: input.tenantId, planTier: input.planTier });
    if (!pricing) throw new BillingNotFoundError('No active pricing found for this model/scope');
    const breakdown = this.computeCost(pricing, input);
    return {
      pricing: { id: pricing.id, scope: pricing.scope, effectiveFrom: pricing.effectiveFrom, currency: pricing.currency },
      providerCost: breakdown.providerCost.toFixed(6),
      customerCharge: breakdown.customerCharge.toFixed(6),
      margin: breakdown.margin.toFixed(6),
      marginPct: breakdown.marginPct,
    };
  }

  async list(filter: { modelId?: string; scope?: AiPricingScope; tenantId?: string }) {
    return this.prisma.aiModelPricing.findMany({
      where: {
        ...(filter.modelId ? { modelId: filter.modelId } : {}),
        ...(filter.scope ? { scope: filter.scope } : {}),
        ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      },
      orderBy: [{ scope: 'asc' }, { effectiveFrom: 'desc' }],
      include: { model: { select: { modelCode: true, displayName: true, providerId: true } } },
    });
  }

  async create(input: PricingUpsertInput, actor: { id?: string; email?: string; role?: string; ip?: string }) {
    this.validateScope(input);
    const model = await this.prisma.aiBillingModel.findUnique({ where: { id: input.modelId } });
    if (!model) throw new BillingNotFoundError('Model not found');

    const created = await this.prisma.aiModelPricing.create({
      data: {
        modelId: input.modelId,
        scope: input.scope,
        planTier: input.scope === AiPricingScope.PLAN ? input.planTier : null,
        tenantId: input.scope === AiPricingScope.TENANT ? input.tenantId : null,
        currency: input.currency ?? 'USD',
        status: input.status ?? AiPricingStatus.ACTIVE,
        effectiveFrom: new Date(input.effectiveFrom),
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
        providerInputCost: input.providerInputCost ?? 0,
        providerOutputCost: input.providerOutputCost ?? 0,
        providerCachedInputCost: input.providerCachedInputCost ?? 0,
        providerReasoningCost: input.providerReasoningCost ?? 0,
        providerEmbeddingCost: input.providerEmbeddingCost ?? 0,
        providerImageCost: input.providerImageCost ?? 0,
        customerInputPrice: input.customerInputPrice ?? 0,
        customerOutputPrice: input.customerOutputPrice ?? 0,
        customerCachedInputPrice: input.customerCachedInputPrice ?? 0,
        customerReasoningPrice: input.customerReasoningPrice ?? 0,
        customerEmbeddingPrice: input.customerEmbeddingPrice ?? 0,
        customerImagePrice: input.customerImagePrice ?? 0,
        createdById: actor.id ?? null,
      },
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      tenantId: created.tenantId,
      action: 'PRICING_CREATED',
      entityType: 'ai_model_pricing',
      entityId: created.id,
      afterState: created,
    });
    return created;
  }

  async update(
    id: string,
    input: Partial<PricingUpsertInput>,
    actor: { id?: string; email?: string; role?: string; ip?: string },
  ) {
    const before = await this.prisma.aiModelPricing.findUnique({ where: { id } });
    if (!before) throw new BillingNotFoundError('Pricing row not found');
    const updated = await this.prisma.aiModelPricing.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.effectiveFrom !== undefined ? { effectiveFrom: new Date(input.effectiveFrom) } : {}),
        ...(input.effectiveTo !== undefined ? { effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null } : {}),
        ...this.numericPatch(input),
      },
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      tenantId: updated.tenantId,
      action: 'PRICING_UPDATED',
      entityType: 'ai_model_pricing',
      entityId: id,
      beforeState: before,
      afterState: updated,
    });
    return updated;
  }

  private numericPatch(input: Partial<PricingUpsertInput>) {
    const keys = [
      'providerInputCost', 'providerOutputCost', 'providerCachedInputCost', 'providerReasoningCost',
      'providerEmbeddingCost', 'providerImageCost', 'customerInputPrice', 'customerOutputPrice',
      'customerCachedInputPrice', 'customerReasoningPrice', 'customerEmbeddingPrice', 'customerImagePrice',
    ] as const;
    const patch: Record<string, number> = {};
    for (const key of keys) {
      const value = input[key];
      if (value !== undefined) {
        if (typeof value !== 'number' || value < 0) throw new BillingValidationError(`${key} must be a non-negative number`);
        patch[key] = value;
      }
    }
    return patch;
  }

  private validateScope(input: PricingUpsertInput) {
    if (input.scope === AiPricingScope.PLAN && !input.planTier) {
      throw new BillingValidationError('PLAN-scope pricing requires planTier');
    }
    if (input.scope === AiPricingScope.TENANT && !input.tenantId) {
      throw new BillingValidationError('TENANT-scope pricing requires tenantId');
    }
  }
}
