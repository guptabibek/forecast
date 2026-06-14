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

describe('InsightGenerationService metering (credits per provider run)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const candidate = { dedupeKey: 'k1', severity: 'high' as const, title: 'T', summary: 'S', confidence: 0.9 };

  function harness(options: { fee?: string; enforcement?: string; reserveFails?: boolean } = {}) {
    const prisma: any = {
      aiInsightProviderConfig: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({}) },
      aiInsight: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'insight-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      aiInsightEvent: { create: jest.fn().mockResolvedValue({}) },
      aiUsageLog: { create: jest.fn().mockResolvedValue({ id: 'usage-1' }) },
    };
    const cache = { invalidateNamespace: jest.fn().mockResolvedValue(undefined) } as any;
    const aiReporting = { executeStoredReport: jest.fn() } as any;
    const provider = {
      providerId: 'p1', displayName: 'P1', category: 'test', defaultEnabled: true,
      generate: jest.fn().mockResolvedValue([candidate]),
    };
    const failingProvider = {
      providerId: 'p2', displayName: 'P2', category: 'test', defaultEnabled: true,
      generate: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const wallet = {
      reserveCredits: options.reserveFails
        ? jest.fn().mockRejectedValue(Object.assign(new Error('Insufficient AI credits'), { name: 'InsufficientCreditsError' }))
        : jest.fn().mockResolvedValue({ id: 'res-1' }),
      finalizeReservation: jest.fn().mockResolvedValue({ transaction: { id: 'txn-1' } }),
    } as any;
    const access = { getEffectivePolicyForUser: jest.fn().mockResolvedValue({ status: 'ENABLED' }) } as any;
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AI_INSIGHTS_PROVIDER_RUN_FEE') return options.fee ?? '0.01';
        if (key === 'AI_BILLING_ENFORCEMENT') return options.enforcement ?? 'true';
        return undefined;
      }),
    } as any;
    const service = new InsightGenerationService(prisma, aiReporting, cache, [provider, failingProvider] as any, access, wallet, config);
    return { service, prisma, wallet, provider, failingProvider };
  }

  it('reserves fee × planned providers, settles for the providers that RAN, and writes a usage log', async () => {
    const { service, prisma, wallet } = harness();
    const result = await service.generateForTenant(tenantId);

    // 2 planned providers reserved...
    expect(wallet.reserveCredits).toHaveBeenCalledWith(expect.objectContaining({ tenantId }));
    expect(String(wallet.reserveCredits.mock.calls[0][0].amount)).toBe('0.02');
    // ...but p2 failed, so only 1 run is charged.
    expect(result.providersRun).toBe(1);
    expect(String(wallet.finalizeReservation.mock.calls[0][1])).toBe('0.01');
    expect(prisma.aiUsageLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId,
        modelCode: 'insights-generation',
        callType: 'insights_generation',
        status: 'CHARGED',
        transactionId: 'txn-1',
      }),
    }));
  });

  it('insufficient credits blocks the whole cycle (402 propagates to manual callers)', async () => {
    const { service, provider } = harness({ reserveFails: true });
    await expect(service.generateForTenant(tenantId)).rejects.toThrow(/Insufficient/);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('does not meter when enforcement is off or the fee is zero', async () => {
    const off = harness({ enforcement: 'false' });
    await off.service.generateForTenant(tenantId);
    expect(off.wallet.reserveCredits).not.toHaveBeenCalled();

    const free = harness({ fee: '0' });
    await free.service.generateForTenant(tenantId);
    expect(free.wallet.reserveCredits).not.toHaveBeenCalled();
  });
});
