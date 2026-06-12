import { PrismaService } from './prisma.service';

/**
 * Regression for the "No active pricing for model X" production bug: the
 * tenant-scoping middleware auto-injects the CLS tenantId into every model
 * that has a `tenantId` field. AiModelPricing/AiAccessPolicy use tenantId as
 * an OPTIONAL scope override (GLOBAL/PLAN rows have tenant_id NULL) — under a
 * tenant request the injected filter made global pricing invisible and every
 * billable AI call failed. These catalogs must be exempt from auto-scoping;
 * genuinely tenant-owned billing data must stay scoped.
 */
describe('PrismaService tenant scoping exemptions', () => {
  function scopedModels(): Set<string> {
    const cls = { isActive: () => false, get: () => undefined } as any;
    const service = new PrismaService(cls);
    return (service as any).tenantScopedModels as Set<string>;
  }

  it('exempts the platform-governance catalogs (nullable scope-override tenantId)', () => {
    const scoped = scopedModels();
    expect(scoped.has('AiModelPricing')).toBe(false);
    expect(scoped.has('AiAccessPolicy')).toBe(false);
  });

  it('keeps tenant-owned billing data scoped', () => {
    const scoped = scopedModels();
    for (const model of ['AiWallet', 'AiWalletTransaction', 'AiCreditPurchase', 'AiUsageLog', 'AiDispute', 'AiRefund']) {
      expect(scoped.has(model)).toBe(true);
    }
  });
});
