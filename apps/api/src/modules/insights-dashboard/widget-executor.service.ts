import { Injectable, Logger } from '@nestjs/common';
import { TenantCacheService } from '../../core/cache/tenant-cache.service';
import { AiReportingService, StoredReportExecutionResult } from '../ai-reporting/ai-reporting.service';
import { SemanticReportQuery } from '../ai-reporting/semantic-query.types';
import { DashboardService } from './dashboard.service';

const CACHE_NAMESPACE = 'ai-dashboard:widget';
const DEFAULT_CACHE_TTL_SECONDS = 300;
const MAX_CACHE_TTL_SECONDS = 3600;

export interface WidgetExecutionResult extends StoredReportExecutionResult {
  widgetId: string;
  cached: boolean;
  cachedAt: string;
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

    const semanticQuery = this.applyVizOverride(widget.semanticQuery as unknown as SemanticReportQuery, widget.vizType);
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
