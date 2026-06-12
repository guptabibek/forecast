import { Injectable } from '@nestjs/common';
import { AiAccessScope, AiAccessStatus, AiUsageBillingStatus, Prisma, TenantTier } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { BillingAuditService } from './billing-audit.service';
import { AiAccessDeniedError, BillingValidationError, SpendLimitExceededError } from './billing.errors';

const D = (value: Prisma.Decimal | number | string): Prisma.Decimal => new Prisma.Decimal(value);

export interface EffectivePolicy {
  status: AiAccessStatus;
  allowedModelCodes: string[] | null;
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  maxQueryCost: Prisma.Decimal | null;
  maxDailySpend: Prisma.Decimal | null;
  maxMonthlySpend: Prisma.Decimal | null;
  /** Which scope decided each constraint (for admin UIs / debugging). */
  sources: Partial<Record<keyof Omit<EffectivePolicy, 'sources'>, AiAccessScope>>;
}

export interface AccessPolicyUpsert {
  scope: AiAccessScope;
  tenantId?: string | null;
  userId?: string | null;
  planTier?: TenantTier | null;
  status?: AiAccessStatus;
  allowedModelCodes?: string[] | null;
  dailyRequestLimit?: number | null;
  monthlyRequestLimit?: number | null;
  maxQueryCost?: number | null;
  maxDailySpend?: number | null;
  maxMonthlySpend?: number | null;
  notes?: string | null;
}

/**
 * AI access governance: ENABLED / DISABLED / SUSPENDED plus model allowlists
 * and request/spend limits, controllable per USER, per TENANT, and per PLAN.
 * Precedence per field: USER > TENANT > PLAN > default (ENABLED, unlimited).
 */
@Injectable()
export class AiAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: BillingAuditService,
  ) {}

  async getEffectivePolicy(context: { tenantId: string; userId?: string | null; planTier?: TenantTier | null }): Promise<EffectivePolicy> {
    const [userRow, tenantRow, planRow] = await Promise.all([
      context.userId
        ? this.prisma.aiAccessPolicy.findFirst({ where: { scope: AiAccessScope.USER, userId: context.userId } })
        : null,
      this.prisma.aiAccessPolicy.findFirst({ where: { scope: AiAccessScope.TENANT, tenantId: context.tenantId } }),
      context.planTier
        ? this.prisma.aiAccessPolicy.findFirst({ where: { scope: AiAccessScope.PLAN, planTier: context.planTier } })
        : null,
    ]);

    const chain: Array<{ scope: AiAccessScope; row: typeof userRow }> = [
      { scope: AiAccessScope.USER, row: userRow },
      { scope: AiAccessScope.TENANT, row: tenantRow },
      { scope: AiAccessScope.PLAN, row: planRow },
    ];

    const effective: EffectivePolicy = {
      status: AiAccessStatus.ENABLED,
      allowedModelCodes: null,
      dailyRequestLimit: null,
      monthlyRequestLimit: null,
      maxQueryCost: null,
      maxDailySpend: null,
      maxMonthlySpend: null,
      sources: {},
    };

    const pick = <K extends keyof EffectivePolicy>(field: K, read: (row: NonNullable<typeof userRow>) => EffectivePolicy[K] | null | undefined) => {
      for (const { scope, row } of chain) {
        if (!row) continue;
        const value = read(row);
        if (value !== null && value !== undefined) {
          effective[field] = value as EffectivePolicy[K];
          effective.sources[field as keyof EffectivePolicy['sources']] = scope;
          return;
        }
      }
    };

    // Status: the most specific scope that EXISTS decides, even when ENABLED
    // (a USER-level ENABLED row deliberately overrides a TENANT suspension).
    for (const { scope, row } of chain) {
      if (row) {
        effective.status = row.status;
        effective.sources.status = scope;
        break;
      }
    }
    pick('allowedModelCodes', (row) => (Array.isArray(row.allowedModelCodes) ? (row.allowedModelCodes as string[]) : null));
    pick('dailyRequestLimit', (row) => row.dailyRequestLimit);
    pick('monthlyRequestLimit', (row) => row.monthlyRequestLimit);
    pick('maxQueryCost', (row) => row.maxQueryCost);
    pick('maxDailySpend', (row) => row.maxDailySpend);
    pick('maxMonthlySpend', (row) => row.maxMonthlySpend);
    return effective;
  }

  /**
   * Gate an AI request BEFORE reserving credits. Throws machine-coded 402/403
   * errors when the request must not run.
   */
  async assertAccess(input: {
    tenantId: string;
    userId?: string | null;
    planTier?: TenantTier | null;
    modelCode: string;
    estimatedCharge: Prisma.Decimal;
  }): Promise<EffectivePolicy> {
    const policy = await this.getEffectivePolicy(input);
    if (policy.status === AiAccessStatus.DISABLED) {
      throw new AiAccessDeniedError('AI_ACCESS_DISABLED', 'AI access is disabled for this account');
    }
    if (policy.status === AiAccessStatus.SUSPENDED) {
      throw new AiAccessDeniedError('AI_ACCESS_SUSPENDED', 'AI access is suspended for this account');
    }
    if (policy.allowedModelCodes && !policy.allowedModelCodes.includes(input.modelCode)) {
      throw new AiAccessDeniedError('AI_MODEL_NOT_ALLOWED', `Model ${input.modelCode} is not allowed for this account`);
    }
    if (policy.maxQueryCost && input.estimatedCharge.greaterThan(D(policy.maxQueryCost))) {
      throw new SpendLimitExceededError(
        `Estimated cost ${input.estimatedCharge.toFixed(4)} exceeds the per-query limit ${D(policy.maxQueryCost).toFixed(4)}`,
      );
    }

    const needsDaily = policy.dailyRequestLimit !== null || policy.maxDailySpend !== null;
    const needsMonthly = policy.monthlyRequestLimit !== null || policy.maxMonthlySpend !== null;
    if (needsDaily || needsMonthly) {
      const [daily, monthly] = await Promise.all([
        needsDaily ? this.usageSince(input.tenantId, input.userId, this.startOfDay()) : null,
        needsMonthly ? this.usageSince(input.tenantId, input.userId, this.startOfMonth()) : null,
      ]);
      if (policy.dailyRequestLimit !== null && daily && daily.requests >= policy.dailyRequestLimit) {
        throw new SpendLimitExceededError(`Daily AI request limit (${policy.dailyRequestLimit}) reached`);
      }
      if (policy.monthlyRequestLimit !== null && monthly && monthly.requests >= policy.monthlyRequestLimit) {
        throw new SpendLimitExceededError(`Monthly AI request limit (${policy.monthlyRequestLimit}) reached`);
      }
      if (policy.maxDailySpend !== null && daily && daily.spend.plus(input.estimatedCharge).greaterThan(D(policy.maxDailySpend))) {
        throw new SpendLimitExceededError(`Maximum daily AI spend (${D(policy.maxDailySpend).toFixed(2)}) would be exceeded`);
      }
      if (policy.maxMonthlySpend !== null && monthly && monthly.spend.plus(input.estimatedCharge).greaterThan(D(policy.maxMonthlySpend))) {
        throw new SpendLimitExceededError(`Maximum monthly AI spend (${D(policy.maxMonthlySpend).toFixed(2)}) would be exceeded`);
      }
    }
    return policy;
  }

  /** Convenience for surfaces that don't already know the tenant's plan tier. */
  async getEffectivePolicyForUser(tenantId: string, userId?: string | null): Promise<EffectivePolicy> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { tier: true } });
    return this.getEffectivePolicy({ tenantId, userId, planTier: tenant?.tier ?? null });
  }

  /** Month-to-date billable spend for budget displays. */
  async monthToDateSpend(tenantId: string): Promise<Prisma.Decimal> {
    const usage = await this.usageSince(tenantId, null, this.startOfMonth());
    return usage.spend;
  }

  async listPolicies(filter?: { scope?: AiAccessScope; tenantId?: string }) {
    return this.prisma.aiAccessPolicy.findMany({
      where: {
        ...(filter?.scope ? { scope: filter.scope } : {}),
        ...(filter?.tenantId ? { tenantId: filter.tenantId } : {}),
      },
      orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  /** Create-or-update the single policy row for a scope key. */
  async upsertPolicy(input: AccessPolicyUpsert, actor: { id?: string; email?: string; role?: string; ip?: string }) {
    this.validateScopeKey(input);
    const where = this.scopeWhere(input);
    const before = await this.prisma.aiAccessPolicy.findFirst({ where });
    const data = {
      status: input.status ?? AiAccessStatus.ENABLED,
      allowedModelCodes: input.allowedModelCodes === undefined ? before?.allowedModelCodes ?? Prisma.DbNull : input.allowedModelCodes ?? Prisma.DbNull,
      dailyRequestLimit: input.dailyRequestLimit !== undefined ? input.dailyRequestLimit : before?.dailyRequestLimit ?? null,
      monthlyRequestLimit: input.monthlyRequestLimit !== undefined ? input.monthlyRequestLimit : before?.monthlyRequestLimit ?? null,
      maxQueryCost: input.maxQueryCost !== undefined ? input.maxQueryCost : before?.maxQueryCost ?? null,
      maxDailySpend: input.maxDailySpend !== undefined ? input.maxDailySpend : before?.maxDailySpend ?? null,
      maxMonthlySpend: input.maxMonthlySpend !== undefined ? input.maxMonthlySpend : before?.maxMonthlySpend ?? null,
      notes: input.notes !== undefined ? input.notes : before?.notes ?? null,
    };
    const saved = before
      ? await this.prisma.aiAccessPolicy.update({ where: { id: before.id }, data })
      : await this.prisma.aiAccessPolicy.create({
          data: {
            scope: input.scope,
            tenantId: input.scope !== AiAccessScope.PLAN ? input.tenantId ?? null : null,
            userId: input.scope === AiAccessScope.USER ? input.userId ?? null : null,
            planTier: input.scope === AiAccessScope.PLAN ? input.planTier ?? null : null,
            createdById: actor.id ?? null,
            ...data,
          },
        });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      tenantId: saved.tenantId,
      action: before ? 'ACCESS_POLICY_UPDATED' : 'ACCESS_POLICY_CREATED',
      entityType: 'ai_access_policy',
      entityId: saved.id,
      beforeState: before ?? undefined,
      afterState: saved,
    });
    return saved;
  }

  async deletePolicy(id: string, actor: { id?: string; email?: string; role?: string; ip?: string }) {
    const before = await this.prisma.aiAccessPolicy.findUnique({ where: { id } });
    if (!before) return { deleted: false };
    await this.prisma.aiAccessPolicy.delete({ where: { id } });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, ipAddress: actor.ip,
      tenantId: before.tenantId,
      action: 'ACCESS_POLICY_DELETED', entityType: 'ai_access_policy', entityId: id, beforeState: before,
    });
    return { deleted: true };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async usageSince(tenantId: string, userId: string | null | undefined, since: Date) {
    const where = {
      tenantId,
      createdAt: { gte: since },
      status: { not: AiUsageBillingStatus.UNBILLED },
      ...(userId ? { userId } : {}),
    };
    const [requests, sum] = await Promise.all([
      this.prisma.aiUsageLog.count({ where }),
      this.prisma.aiUsageLog.aggregate({ where, _sum: { customerCharge: true } }),
    ]);
    return { requests, spend: D(sum._sum.customerCharge ?? 0) };
  }

  private validateScopeKey(input: AccessPolicyUpsert) {
    if (input.scope === AiAccessScope.USER && !input.userId) throw new BillingValidationError('USER scope requires userId');
    if (input.scope === AiAccessScope.TENANT && !input.tenantId) throw new BillingValidationError('TENANT scope requires tenantId');
    if (input.scope === AiAccessScope.PLAN && !input.planTier) throw new BillingValidationError('PLAN scope requires planTier');
  }

  private scopeWhere(input: AccessPolicyUpsert) {
    if (input.scope === AiAccessScope.USER) return { scope: AiAccessScope.USER, userId: input.userId };
    if (input.scope === AiAccessScope.TENANT) return { scope: AiAccessScope.TENANT, tenantId: input.tenantId };
    return { scope: AiAccessScope.PLAN, planTier: input.planTier };
  }

  private startOfDay(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  private startOfMonth(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
}
