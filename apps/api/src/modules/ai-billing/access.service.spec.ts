import { AiAccessScope, AiAccessStatus, Prisma } from '@prisma/client';
import { AiAccessService } from './access.service';
import { AiAccessDeniedError, SpendLimitExceededError } from './billing.errors';

const D = (value: number | string) => new Prisma.Decimal(value);

function policyRow(scope: AiAccessScope, overrides: Partial<any> = {}) {
  return {
    id: `policy-${scope}`,
    scope,
    tenantId: scope === AiAccessScope.TENANT ? 'tenant-1' : null,
    userId: scope === AiAccessScope.USER ? 'user-1' : null,
    planTier: scope === AiAccessScope.PLAN ? 'STARTER' : null,
    status: AiAccessStatus.ENABLED,
    allowedModelCodes: null,
    dailyRequestLimit: null,
    monthlyRequestLimit: null,
    maxQueryCost: null,
    maxDailySpend: null,
    maxMonthlySpend: null,
    ...overrides,
  };
}

function buildService(policies: any[], usage: { requests?: number; spend?: number } = {}) {
  const prisma = {
    aiAccessPolicy: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
          policies.find((p) =>
            p.scope === where.scope &&
            (where.userId === undefined || p.userId === where.userId) &&
            (where.tenantId === undefined || p.tenantId === where.tenantId) &&
            (where.planTier === undefined || p.planTier === where.planTier),
          ) ?? null,
        ),
      ),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    aiUsageLog: {
      count: jest.fn().mockResolvedValue(usage.requests ?? 0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { customerCharge: D(usage.spend ?? 0) } }),
    },
  } as any;
  const audit = { record: jest.fn() } as any;
  return { service: new AiAccessService(prisma, audit), prisma };
}

const context = { tenantId: 'tenant-1', userId: 'user-1', planTier: 'STARTER' as any };

describe('AiAccessService', () => {
  it('defaults to ENABLED with no limits when no policies exist', async () => {
    const { service } = buildService([]);
    const policy = await service.getEffectivePolicy(context);
    expect(policy.status).toBe(AiAccessStatus.ENABLED);
    expect(policy.allowedModelCodes).toBeNull();
    await expect(
      service.assertAccess({ ...context, modelCode: 'gpt-4o', estimatedCharge: D(1) }),
    ).resolves.toBeDefined();
  });

  it('USER policy overrides TENANT which overrides PLAN', async () => {
    const { service } = buildService([
      policyRow(AiAccessScope.PLAN, { status: AiAccessStatus.DISABLED }),
      policyRow(AiAccessScope.TENANT, { status: AiAccessStatus.SUSPENDED, maxQueryCost: D(5) }),
      policyRow(AiAccessScope.USER, { status: AiAccessStatus.ENABLED }),
    ]);
    const policy = await service.getEffectivePolicy(context);
    expect(policy.status).toBe(AiAccessStatus.ENABLED);
    expect(policy.sources.status).toBe(AiAccessScope.USER);
    // Non-status fields fall through to the tenant row.
    expect(policy.maxQueryCost?.toString()).toBe('5');
  });

  it('blocks DISABLED and SUSPENDED with distinct codes', async () => {
    const disabled = buildService([policyRow(AiAccessScope.TENANT, { status: AiAccessStatus.DISABLED })]);
    await expect(
      disabled.service.assertAccess({ ...context, modelCode: 'gpt-4o', estimatedCharge: D(1) }),
    ).rejects.toBeInstanceOf(AiAccessDeniedError);

    const suspended = buildService([policyRow(AiAccessScope.TENANT, { status: AiAccessStatus.SUSPENDED })]);
    await expect(
      suspended.service.assertAccess({ ...context, modelCode: 'gpt-4o', estimatedCharge: D(1) }),
    ).rejects.toMatchObject({ response: { code: 'AI_ACCESS_SUSPENDED' } });
  });

  it('enforces the model allowlist', async () => {
    const { service } = buildService([policyRow(AiAccessScope.TENANT, { allowedModelCodes: ['gpt-4o-mini'] })]);
    await expect(
      service.assertAccess({ ...context, modelCode: 'gpt-4o', estimatedCharge: D(0.01) }),
    ).rejects.toMatchObject({ response: { code: 'AI_MODEL_NOT_ALLOWED' } });
    await expect(
      service.assertAccess({ ...context, modelCode: 'gpt-4o-mini', estimatedCharge: D(0.01) }),
    ).resolves.toBeDefined();
  });

  it('enforces max query cost and daily/monthly request and spend limits', async () => {
    const overCost = buildService([policyRow(AiAccessScope.TENANT, { maxQueryCost: D('0.05') })]);
    await expect(
      overCost.service.assertAccess({ ...context, modelCode: 'gpt-4o', estimatedCharge: D('0.06') }),
    ).rejects.toBeInstanceOf(SpendLimitExceededError);

    const overRequests = buildService(
      [policyRow(AiAccessScope.TENANT, { dailyRequestLimit: 10 })],
      { requests: 10 },
    );
    await expect(
      overRequests.service.assertAccess({ ...context, modelCode: 'gpt-4o', estimatedCharge: D('0.01') }),
    ).rejects.toThrow(/Daily AI request limit/);

    const overSpend = buildService(
      [policyRow(AiAccessScope.TENANT, { maxMonthlySpend: D(100) })],
      { spend: 99.995 },
    );
    await expect(
      overSpend.service.assertAccess({ ...context, modelCode: 'gpt-4o', estimatedCharge: D('0.01') }),
    ).rejects.toThrow(/monthly AI spend/);
  });
});
