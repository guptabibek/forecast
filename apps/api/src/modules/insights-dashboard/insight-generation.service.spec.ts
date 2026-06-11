import { InsightGenerationService } from './insight-generation.service';
import { IInsightProvider, InsightCandidate } from './insight-provider.interface';

describe('InsightGenerationService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  function buildPrismaMock(existingInsight: any = null) {
    return {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: tenantId }]) },
      tenantModule: { findMany: jest.fn().mockResolvedValue([]) },
      aiInsightProviderConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      aiInsight: {
        findUnique: jest.fn().mockResolvedValue(existingInsight),
        create: jest.fn().mockResolvedValue({ id: 'insight-1' }),
        update: jest.fn().mockResolvedValue({ id: 'insight-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      aiInsightEvent: { create: jest.fn().mockResolvedValue({}) },
    } as any;
  }

  const cacheMock = { invalidateNamespace: jest.fn().mockResolvedValue(undefined) } as any;

  function buildProvider(candidates: InsightCandidate[]): IInsightProvider {
    return {
      providerId: 'test-provider',
      displayName: 'Test Provider',
      category: 'test',
      defaultEnabled: true,
      generate: jest.fn().mockResolvedValue(candidates),
    };
  }

  const candidate: InsightCandidate = {
    dedupeKey: 'k1',
    severity: 'high',
    title: 'Something happened',
    summary: 'Details',
    confidence: 0.9,
  };

  it('creates a NEW insight with a generated event on first detection', async () => {
    const prisma = buildPrismaMock(null);
    const aiReporting = { executeStoredReport: jest.fn() } as any;
    const service = new InsightGenerationService(prisma, aiReporting, cacheMock, [buildProvider([candidate])]);

    const result = await service.generateForTenant(tenantId);

    expect(result.insightsUpserted).toBe(1);
    expect(prisma.aiInsight.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'NEW', dedupeKey: 'k1', providerId: 'test-provider' }) }),
    );
    expect(prisma.aiInsightEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'generated' }) }),
    );
  });

  it('reactivates a resolved insight when the condition recurs', async () => {
    const prisma = buildPrismaMock({
      id: 'insight-1',
      status: 'RESOLVED',
      firstDetectedAt: new Date('2026-01-01'),
    });
    const aiReporting = { executeStoredReport: jest.fn() } as any;
    const service = new InsightGenerationService(prisma, aiReporting, cacheMock, [buildProvider([candidate])]);

    await service.generateForTenant(tenantId);

    expect(prisma.aiInsight.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', resolvedBy: null }) }),
    );
    expect(prisma.aiInsightEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'redetected' }) }),
    );
  });

  it('promotes a NEW insight to ACTIVE after 24 hours of re-detection', async () => {
    const prisma = buildPrismaMock({
      id: 'insight-1',
      status: 'NEW',
      firstDetectedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    const aiReporting = { executeStoredReport: jest.fn() } as any;
    const service = new InsightGenerationService(prisma, aiReporting, cacheMock, [buildProvider([candidate])]);

    await service.generateForTenant(tenantId);

    expect(prisma.aiInsight.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });

  it('archives open insights that were not re-detected and records provider failures without aborting', async () => {
    const prisma = buildPrismaMock(null);
    prisma.aiInsight.updateMany.mockResolvedValue({ count: 2 });
    const failingProvider: IInsightProvider = {
      providerId: 'failing',
      displayName: 'Failing',
      category: 'test',
      defaultEnabled: true,
      generate: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const aiReporting = { executeStoredReport: jest.fn() } as any;
    const service = new InsightGenerationService(prisma, aiReporting, cacheMock, [
      buildProvider([candidate]),
      failingProvider,
    ]);

    const result = await service.generateForTenant(tenantId);

    expect(result.providersRun).toBe(1);
    expect(result.providersFailed).toBe(1);
    expect(result.insightsArchived).toBe(2);
    expect(prisma.aiInsightProviderConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_providerId: { tenantId, providerId: 'failing' } },
        update: expect.objectContaining({ lastStatus: 'error' }),
      }),
    );
  });

  it('skips providers disabled in tenant config', async () => {
    const prisma = buildPrismaMock(null);
    prisma.aiInsightProviderConfig.findMany.mockResolvedValue([
      { providerId: 'test-provider', enabled: false, config: {} },
    ]);
    const provider = buildProvider([candidate]);
    const aiReporting = { executeStoredReport: jest.fn() } as any;
    const service = new InsightGenerationService(prisma, aiReporting, cacheMock, [provider]);

    const result = await service.generateForTenant(tenantId);

    expect(provider.generate).not.toHaveBeenCalled();
    expect(result.providersRun).toBe(0);
  });
});
