import { Injectable, Logger } from '@nestjs/common';
import { TenantCacheService } from '../../core/cache/tenant-cache.service';
import { AiReportingService, StoredReportExecutionResult } from '../ai-reporting/ai-reporting.service';
import { SemanticReportQuery } from '../ai-reporting/semantic-query.types';
import { DashboardService } from './dashboard.service';
import { applyRollingWindow } from './rolling-window.util';
import {
  analyzeReportResult,
  buildPreviousPeriodQuery,
  sumPrimaryMetric,
  WidgetAnalytics,
} from './result-analytics.util';

const CACHE_NAMESPACE = 'ai-dashboard:widget';
const DEFAULT_CACHE_TTL_SECONDS = 300;
const MAX_CACHE_TTL_SECONDS = 3600;

export interface WidgetExecutionResult extends StoredReportExecutionResult {
  widgetId: string;
  cached: boolean;
  cachedAt: string;
  /** Deterministic analysis of the result (KPIs, growth, distribution, trend). */
  analytics: WidgetAnalytics | null;
}

@Injectable()
export class WidgetExecutorService {
  private readonly logger = new Logger(WidgetExecutorService.name);

  constructor(
    private readonly dashboardService: DashboardService,
    private readonly aiReporting: AiReportingService,
    private readonly cache: TenantCacheService,
  ) {}

  /**
   * Executes a pinned widget under the CURRENT user's security context.
   * Results are cached per widget (widgets are user-owned, so the cache key
   * never spans users). No LLM call is made on this path.
   */
  async execute(user: any, widgetId: string, options?: { force?: boolean }): Promise<WidgetExecutionResult> {
    const widget = await this.dashboardService.requireWidget(user, widgetId);

    if (!options?.force) {
      const cached = await this.cache.get<WidgetExecutionResult>(user.tenantId, CACHE_NAMESPACE, widget.id);
      if (cached) return { ...cached, cached: true };
    }

    const storedQuery = applyRollingWindow(
      widget.semanticQuery as unknown as SemanticReportQuery,
      widget.createdAt,
    );
    const semanticQuery = this.applyVizOverride(storedQuery, widget.vizType);
    const filters = (widget.filters ?? {}) as { companyId?: number; branchIds?: string[] };

    const result = await this.aiReporting.executeStoredReport(user, {
      semanticQuery,
      companyId: filters.companyId,
      branchIds: filters.branchIds,
    });

    const payload: WidgetExecutionResult = {
      ...result,
      title: widget.title || result.title,
      widgetId: widget.id,
      cached: false,
      cachedAt: new Date().toISOString(),
      analytics: await this.buildAnalytics(user, semanticQuery, filters, result),
    };

    const ttl = Math.min(widget.refreshIntervalSec ?? DEFAULT_CACHE_TTL_SECONDS, MAX_CACHE_TTL_SECONDS);
    await this.cache.set(user.tenantId, CACHE_NAMESPACE, widget.id, payload, ttl);
    this.logger.log(
      `Widget executed: widgetId=${widget.id}, tenantId=${user.tenantId}, rows=${result.rowCount}, durationMs=${result.executionTimeMs}`,
    );
    return payload;
  }

  async invalidate(tenantId: string, widgetId: string) {
    await this.cache.del(tenantId, CACHE_NAMESPACE, widgetId);
  }

  /**
   * Computes the analytics block for a successful widget execution. At most
   * ONE extra query (the previous period, only for past-facing custom
   * windows), cached together with the payload. Analytics are best-effort —
   * a failure here never fails the widget itself.
   */
  private async buildAnalytics(
    user: any,
    semanticQuery: SemanticReportQuery,
    filters: { companyId?: number; branchIds?: string[] },
    result: StoredReportExecutionResult,
  ): Promise<WidgetAnalytics | null> {
    if (result.status !== 'success' || !result.rowCount) return null;
    try {
      const reportRows = { columns: result.columns, rows: result.rows, rowCount: result.rowCount };
      const currentTotal = sumPrimaryMetric(reportRows, semanticQuery);

      let previousTotal: number | null = null;
      const previousQuery = buildPreviousPeriodQuery(semanticQuery, new Date());
      if (previousQuery && currentTotal !== null) {
        const previous = await this.aiReporting.executeStoredReport(user, {
          semanticQuery: previousQuery,
          companyId: filters.companyId,
          branchIds: filters.branchIds,
        });
        if (previous.status === 'success') {
          previousTotal = sumPrimaryMetric(
            { columns: previous.columns, rows: previous.rows, rowCount: previous.rowCount },
            previousQuery,
          );
        }
      }

      return analyzeReportResult({ query: semanticQuery, result: reportRows, currentTotal, previousTotal });
    } catch (error: any) {
      this.logger.warn(`Widget analytics skipped: ${String(error?.message ?? error).slice(0, 200)}`);
      return null;
    }
  }

  private applyVizOverride(query: SemanticReportQuery, vizType: string | null): SemanticReportQuery {
    if (!vizType || vizType === 'auto') return query;
    if (vizType === 'table') {
      return { ...query, output: { ...(query.output ?? { showGrid: true }), showGrid: true, showChart: false, chartType: 'none' } };
    }
    if (['bar', 'line', 'pie', 'kpi'].includes(vizType)) {
      return {
        ...query,
        output: {
          showGrid: query.output?.showGrid ?? true,
          showChart: true,
          chartType: vizType as 'bar' | 'line' | 'pie' | 'kpi',
          xField: query.output?.xField ?? null,
          yField: query.output?.yField ?? null,
        },
      };
    }
    return query;
  }
}
