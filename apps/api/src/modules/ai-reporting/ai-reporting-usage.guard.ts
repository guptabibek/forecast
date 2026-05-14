import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { AiProviderService } from './ai-provider.service';
import { ReportingSecurityContext } from './semantic-query.types';

interface UsageLease {
  release: () => void;
}

@Injectable()
export class AiReportingUsageGuard {
  private readonly activeByUser = new Map<string, number>();
  private readonly activeByTenant = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
  ) {}

  async acquire(security: ReportingSecurityContext, companyId?: number | null): Promise<UsageLease> {
    const config = await this.aiProvider.getTenantOperationalConfig(security.tenantId);

    await this.assertRateLimits(security, companyId ?? null, config);

    const userKey = `${security.tenantId}:${security.userId}`;
    const userActive = this.activeByUser.get(userKey) ?? 0;
    const tenantActive = this.activeByTenant.get(security.tenantId) ?? 0;
    if (userActive >= config.maxConcurrentPerUser || tenantActive >= config.maxConcurrentPerTenant) {
      this.rateLimit('Too many AI reporting queries are already running');
    }

    this.activeByUser.set(userKey, userActive + 1);
    this.activeByTenant.set(security.tenantId, tenantActive + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.decrement(this.activeByUser, userKey);
        this.decrement(this.activeByTenant, security.tenantId);
      },
    };
  }

  private async assertRateLimits(
    security: ReportingSecurityContext,
    companyId: number | null,
    config: { ratePerUserPerMinute: number; ratePerTenantPerHour: number; dailyTenantCallLimit: number; dailyUserCallLimit: number; monthlyCompanyCallLimit: number },
  ) {
    const [userMinuteCount, tenantHourCount, tenantDailyCalls, userDailyCalls, companyMonthlyCalls] = await Promise.all([
      this.countAudit(
        `tenant_id = $1::uuid AND user_id = $2::uuid AND created_at >= now() - interval '1 minute'`,
        [security.tenantId, security.userId],
      ),
      this.countAudit(
        companyId == null
          ? `tenant_id = $1::uuid AND created_at >= now() - interval '1 hour'`
          : `tenant_id = $1::uuid AND company_id = $2::int AND created_at >= now() - interval '1 hour'`,
        companyId == null ? [security.tenantId] : [security.tenantId, companyId],
      ),
      this.sumAuditCalls(security.tenantId),
      this.sumAuditCalls(security.tenantId, security.userId),
      companyId == null ? Promise.resolve(0) : this.sumAuditCalls(security.tenantId, null, companyId),
    ]);

    if (userMinuteCount >= config.ratePerUserPerMinute) {
      this.rateLimit('AI reporting rate limit exceeded for this user');
    }
    if (tenantHourCount >= config.ratePerTenantPerHour) {
      this.rateLimit('AI reporting hourly limit exceeded for this company or tenant');
    }
    if (tenantDailyCalls >= config.dailyTenantCallLimit) {
      this.rateLimit('AI reporting daily AI call limit exceeded for this tenant');
    }
    if (userDailyCalls >= config.dailyUserCallLimit) {
      this.rateLimit('AI reporting daily AI call limit exceeded for this user');
    }
    if (companyId != null && companyMonthlyCalls >= config.monthlyCompanyCallLimit) {
      this.rateLimit('AI reporting monthly AI call limit exceeded for this company');
    }
  }

  private rateLimit(message: string): never {
    throw new HttpException({ code: 'RATE_LIMIT_EXCEEDED', message }, HttpStatus.TOO_MANY_REQUESTS);
  }

  private async countAudit(whereSql: string, params: unknown[]): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
      `SELECT COUNT(*) AS count FROM ai_report_query_audits WHERE ${whereSql}`,
      ...params,
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async sumAuditCalls(tenantId: string, userId?: string | null, companyId?: number | null): Promise<number> {
    const predicates = [`tenant_id = $1::uuid`];
    const params: unknown[] = [tenantId];
    if (userId) {
      params.push(userId);
      predicates.push(`user_id = $${params.length}::uuid`);
      predicates.push(`created_at >= date_trunc('day', now())`);
    } else if (companyId != null) {
      params.push(companyId);
      predicates.push(`company_id = $${params.length}::int`);
      predicates.push(`created_at >= date_trunc('month', now())`);
    } else {
      predicates.push(`created_at >= date_trunc('day', now())`);
    }

    const rows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number | string | null }>>(
      `
        SELECT COALESCE(SUM(ai_call_count + summary_call_count), 0) AS total
        FROM ai_report_query_audits
        WHERE ${predicates.join(' AND ')}
      `,
      ...params,
    );
    return Number(rows[0]?.total ?? 0);
  }

  private decrement(map: Map<string, number>, key: string) {
    const current = map.get(key) ?? 0;
    if (current <= 1) map.delete(key);
    else map.set(key, current - 1);
  }
}
