import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantCacheService } from '../../core/cache/tenant-cache.service';
import { PrismaService } from '../../core/database/prisma.service';
import { DashboardService } from './dashboard.service';
import { InsightSeverity, InsightStatus } from './insight-provider.interface';

const CACHE_NAMESPACE = 'ai-dashboard:insights';
const SUMMARY_CACHE_TTL_SECONDS = 60;
const MAX_PAGE_SIZE = 100;

const SEVERITIES: InsightSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
const STATUSES: InsightStatus[] = ['NEW', 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'ARCHIVED'];

interface UserContext {
  id: string;
  tenantId: string;
  role?: string;
  permissions?: string[];
}

export interface InsightListFilters {
  status?: string[];
  severity?: string[];
  category?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TenantCacheService,
    private readonly dashboardService: DashboardService,
  ) {}

  async list(user: UserContext, filters: InsightListFilters) {
    this.dashboardService.assertViewPermission(user);
    const statuses = (filters.status ?? ['NEW', 'ACTIVE', 'ACKNOWLEDGED']).filter((status) =>
      STATUSES.includes(status as InsightStatus),
    );
    const severities = (filters.severity ?? []).filter((severity) => SEVERITIES.includes(severity as InsightSeverity));
    const page = Math.max(1, Math.trunc(filters.page ?? 1));
    const pageSize = Math.min(Math.max(1, Math.trunc(filters.pageSize ?? 20)), MAX_PAGE_SIZE);

    const where = {
      tenantId: user.tenantId,
      ...(statuses.length ? { status: { in: statuses } } : {}),
      ...(severities.length ? { severity: { in: severities } } : {}),
      ...(filters.category ? { category: filters.category } : {}),
    };

    const [total, insights] = await Promise.all([
      this.prisma.aiInsight.count({ where }),
      this.prisma.aiInsight.findMany({
        where,
        orderBy: [{ lastEvaluatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      insights: insights.map((insight) => this.toDto(insight)),
    };
  }

  async summary(user: UserContext) {
    this.dashboardService.assertViewPermission(user);
    return this.cache.getOrSet(
      user.tenantId,
      CACHE_NAMESPACE,
      'summary',
      async () => {
        const grouped = await this.prisma.aiInsight.groupBy({
          by: ['severity'],
          where: { tenantId: user.tenantId, status: { in: ['NEW', 'ACTIVE', 'ACKNOWLEDGED'] } },
          _count: { _all: true },
        });
        const bySeverity: Record<string, number> = {};
        for (const severity of SEVERITIES) bySeverity[severity] = 0;
        let openTotal = 0;
        for (const row of grouped) {
          bySeverity[row.severity] = row._count._all;
          openTotal += row._count._all;
        }
        const newCount = await this.prisma.aiInsight.count({
          where: { tenantId: user.tenantId, status: 'NEW' },
        });
        const lastGenerated = await this.prisma.aiInsight.findFirst({
          where: { tenantId: user.tenantId },
          orderBy: { lastEvaluatedAt: 'desc' },
          select: { lastEvaluatedAt: true },
        });
        return {
          openTotal,
          newCount,
          bySeverity,
          lastGeneratedAt: lastGenerated?.lastEvaluatedAt?.toISOString() ?? null,
        };
      },
      SUMMARY_CACHE_TTL_SECONDS,
    );
  }

  async acknowledge(user: UserContext, insightId: string, note?: string) {
    return this.transition(user, insightId, 'ACKNOWLEDGED', 'acknowledged', note, {
      from: ['NEW', 'ACTIVE'],
      set: { acknowledgedBy: user.id, acknowledgedAt: new Date() },
    });
  }

  async resolve(user: UserContext, insightId: string, note?: string) {
    return this.transition(user, insightId, 'RESOLVED', 'resolved', note, {
      from: ['NEW', 'ACTIVE', 'ACKNOWLEDGED'],
      set: { resolvedBy: user.id, resolvedAt: new Date() },
    });
  }

  async archive(user: UserContext, insightId: string, note?: string) {
    return this.transition(user, insightId, 'ARCHIVED', 'archived', note, {
      from: ['NEW', 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'],
      set: {},
    });
  }

  async reopen(user: UserContext, insightId: string, note?: string) {
    return this.transition(user, insightId, 'ACTIVE', 'reopened', note, {
      from: ['ACKNOWLEDGED', 'RESOLVED', 'ARCHIVED'],
      set: { acknowledgedBy: null, acknowledgedAt: null, resolvedBy: null, resolvedAt: null },
    });
  }

  private async transition(
    user: UserContext,
    insightId: string,
    toStatus: InsightStatus,
    action: string,
    note: string | undefined,
    rule: { from: InsightStatus[]; set: Record<string, unknown> },
  ) {
    this.dashboardService.assertViewPermission(user);
    const insight = await this.prisma.aiInsight.findFirst({
      where: { id: insightId, tenantId: user.tenantId },
    });
    if (!insight) throw new NotFoundException('Insight not found');
    if (!rule.from.includes(insight.status as InsightStatus)) {
      throw new BadRequestException(`Cannot mark a ${insight.status.toLowerCase()} insight as ${toStatus.toLowerCase()}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.aiInsight.update({
        where: { id: insight.id },
        data: { status: toStatus, ...rule.set },
      });
      await tx.aiInsightEvent.create({
        data: {
          tenantId: user.tenantId,
          insightId: insight.id,
          userId: user.id,
          action,
          note: note?.slice(0, 1000) ?? null,
        },
      });
      return result;
    });
    await this.cache.invalidateNamespace(user.tenantId, CACHE_NAMESPACE);
    return this.toDto(updated);
  }

  private toDto(insight: {
    id: string;
    providerId: string;
    category: string;
    severity: string;
    status: string;
    title: string;
    summary: string;
    confidence: unknown;
    metrics: unknown;
    evidence: unknown;
    actions: unknown;
    drillDownQuestion: string | null;
    firstDetectedAt: Date;
    lastEvaluatedAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: insight.id,
      providerId: insight.providerId,
      category: insight.category,
      severity: insight.severity,
      status: insight.status,
      title: insight.title,
      summary: insight.summary,
      confidence: insight.confidence === null || insight.confidence === undefined ? null : Number(insight.confidence),
      metrics: (insight.metrics ?? null) as Record<string, unknown> | null,
      evidence: (insight.evidence ?? []) as string[],
      actions: (insight.actions ?? []) as string[],
      drillDownQuestion: insight.drillDownQuestion,
      firstDetectedAt: insight.firstDetectedAt.toISOString(),
      lastEvaluatedAt: insight.lastEvaluatedAt.toISOString(),
      acknowledgedAt: insight.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: insight.resolvedAt?.toISOString() ?? null,
      createdAt: insight.createdAt.toISOString(),
      updatedAt: insight.updatedAt.toISOString(),
    };
  }
}
