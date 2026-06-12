import { AiPricingScope, Prisma } from '@prisma/client';
import { PricingService } from './pricing.service';

const D = (value: number | string) => new Prisma.Decimal(value);

function pricingRow(overrides: Partial<any> = {}) {
  return {
    id: 'pricing-1',
    modelId: 'model-1',
    scope: AiPricingScope.GLOBAL,
    planTier: null,
    tenantId: null,
    currency: 'USD',
    status: 'ACTIVE',
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    providerInputCost: D('2.50'),
    providerOutputCost: D('10.00'),
    providerCachedInputCost: D('1.25'),
    providerReasoningCost: D('10.00'),
    providerEmbeddingCost: D('0.10'),
    providerImageCost: D('0.02'),
    customerInputPrice: D('5.00'),
    customerOutputPrice: D('20.00'),
    customerCachedInputPrice: D('2.50'),
    customerReasoningPrice: D('20.00'),
    customerEmbeddingPrice: D('0.20'),
    customerImagePrice: D('0.05'),
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(rows: any[] = []) {
  const prisma = {
    aiModelPricing: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    aiBillingModel: { findUnique: jest.fn().mockResolvedValue({ id: 'model-1' }) },
  } as any;
  const audit = { record: jest.fn() } as any;
  return { service: new PricingService(prisma, audit), prisma };
}

describe('PricingService', () => {
  describe('computeCost', () => {
    it('computes provider cost vs customer charge per 1M tokens with margin', () => {
      const { service } = buildService();
      // 1M prompt + 0.5M completion at the configured per-1M rates.
      const result = service.computeCost(pricingRow() as any, { promptTokens: 1_000_000, completionTokens: 500_000 });
      expect(result.providerCost.toFixed(2)).toBe('7.50');   // 2.50 + 5.00
      expect(result.customerCharge.toFixed(2)).toBe('15.00'); // 5.00 + 10.00
      expect(result.margin.toFixed(2)).toBe('7.50');
      expect(result.marginPct).toBe(50);
    });

    it('handles small token counts without floating point drift', () => {
      const { service } = buildService();
      const result = service.computeCost(pricingRow() as any, { promptTokens: 1234, completionTokens: 567 });
      // 1234/1M*5 + 567/1M*20 = 0.006170 + 0.011340 = 0.017510
      expect(result.customerCharge.toFixed(6)).toBe('0.017510');
    });

    it('includes cached, reasoning, and image components', () => {
      const { service } = buildService();
      const result = service.computeCost(pricingRow() as any, {
        promptTokens: 0, completionTokens: 0, cachedTokens: 1_000_000, reasoningTokens: 1_000_000, images: 2,
      });
      expect(result.customerCharge.toFixed(2)).toBe('22.60'); // 2.50 + 20.00 + 2*0.05
    });
  });

  describe('resolvePricing precedence', () => {
    it('TENANT beats PLAN beats GLOBAL', async () => {
      const rows = [
        pricingRow({ id: 'global', scope: AiPricingScope.GLOBAL }),
        pricingRow({ id: 'plan', scope: AiPricingScope.PLAN, planTier: 'ENTERPRISE' }),
        pricingRow({ id: 'tenant', scope: AiPricingScope.TENANT, tenantId: 'tenant-1' }),
      ];
      const { service } = buildService(rows);
      const tenantHit = await service.resolvePricing('model-1', { tenantId: 'tenant-1', planTier: 'ENTERPRISE' as any });
      expect(tenantHit?.id).toBe('tenant');
      const planHit = await service.resolvePricing('model-1', { tenantId: 'other', planTier: 'ENTERPRISE' as any });
      expect(planHit?.id).toBe('plan');
      const globalHit = await service.resolvePricing('model-1', { tenantId: 'other', planTier: 'STARTER' as any });
      expect(globalHit?.id).toBe('global');
    });

    it('returns null when nothing is configured', async () => {
      const { service } = buildService([]);
      await expect(service.resolvePricing('model-1', {})).resolves.toBeNull();
    });
  });

  it('estimateCharge prices the worst case (full completion budget)', () => {
    const { service } = buildService();
    const estimate = service.estimateCharge(pricingRow() as any, { promptTokens: 10_000, maxCompletionTokens: 2_000 });
    // 10k/1M*5 + 2k/1M*20 = 0.05 + 0.04
    expect(estimate.toFixed(2)).toBe('0.09');
  });
});
