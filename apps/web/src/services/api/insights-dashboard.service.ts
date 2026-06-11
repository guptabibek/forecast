import { apiClient } from './client';
import type {
  AiReportChart,
  AiReportColumn,
  AiReportGrid,
  AiReportKpi,
  AiReportMetadata,
  AiReportRow,
  AiReportVisualization,
} from './ai-reporting.service';

const WIDGET_EXECUTE_TIMEOUT_MS = 120000;

export type WidgetSize = 'small' | 'medium' | 'large' | 'full';
export type InsightSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type InsightStatus = 'NEW' | 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'ARCHIVED';

export interface DashboardSummary {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  widgetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardWidget {
  id: string;
  dashboardId: string;
  widgetType: string;
  title: string;
  question: string | null;
  vizType: string | null;
  size: WidgetSize;
  position: number;
  refreshIntervalSec: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardWithWidgets {
  dashboard: DashboardSummary;
  widgets: DashboardWidget[];
}

export interface WidgetExecutionResult {
  widgetId: string;
  status: 'success' | 'unsupported';
  title: string;
  mode?: string;
  metadata?: AiReportMetadata;
  kpis: AiReportKpi[];
  grid: AiReportGrid;
  chart: AiReportChart;
  visualization: AiReportVisualization;
  columns: AiReportColumn[];
  rows: AiReportRow[];
  rowCount: number;
  executionTimeMs: number;
  unsupportedReason: string | null;
  cached: boolean;
  cachedAt: string;
}

export interface Insight {
  id: string;
  providerId: string;
  category: string;
  severity: InsightSeverity;
  status: InsightStatus;
  title: string;
  summary: string;
  confidence: number | null;
  metrics: Record<string, unknown> | null;
  evidence: string[];
  actions: string[];
  drillDownQuestion: string | null;
  firstDetectedAt: string;
  lastEvaluatedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsightListResponse {
  page: number;
  pageSize: number;
  total: number;
  insights: Insight[];
}

export interface InsightSummary {
  openTotal: number;
  newCount: number;
  bySeverity: Record<InsightSeverity, number>;
  lastGeneratedAt: string | null;
}

export interface InsightProviderConfig {
  providerId: string;
  displayName: string;
  category: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface PinReportRequest {
  requestId: string;
  dashboardId?: string;
  title?: string;
  size?: WidgetSize;
  refreshIntervalSec?: number;
}

export interface LayoutItem {
  widgetId: string;
  position: number;
  size?: WidgetSize;
}

export const insightsDashboardService = {
  async listDashboards(): Promise<DashboardSummary[]> {
    const { data } = await apiClient.get<DashboardSummary[]>('/ai-dashboard');
    return data;
  },

  async createDashboard(input: { name: string; description?: string }): Promise<DashboardSummary> {
    const { data } = await apiClient.post<DashboardSummary>('/ai-dashboard', input);
    return data;
  },

  async updateDashboard(dashboardId: string, input: { name?: string; description?: string | null; isDefault?: boolean }): Promise<DashboardSummary> {
    const { data } = await apiClient.patch<DashboardSummary>(`/ai-dashboard/${dashboardId}`, input);
    return data;
  },

  async deleteDashboard(dashboardId: string): Promise<{ deleted: boolean }> {
    const { data } = await apiClient.delete<{ deleted: boolean }>(`/ai-dashboard/${dashboardId}`);
    return data;
  },

  async cloneDashboard(dashboardId: string, name?: string): Promise<DashboardSummary> {
    const { data } = await apiClient.post<DashboardSummary>(`/ai-dashboard/${dashboardId}/clone`, { name });
    return data;
  },

  async getWidgets(dashboardId: string): Promise<DashboardWithWidgets> {
    const { data } = await apiClient.get<DashboardWithWidgets>(`/ai-dashboard/${dashboardId}/widgets`);
    return data;
  },

  async updateLayout(dashboardId: string, items: LayoutItem[]): Promise<DashboardWithWidgets> {
    const { data } = await apiClient.patch<DashboardWithWidgets>(`/ai-dashboard/${dashboardId}/layout`, { items });
    return data;
  },

  async pinReport(input: PinReportRequest): Promise<DashboardWidget> {
    const { data } = await apiClient.post<DashboardWidget>('/ai-dashboard/widgets/pin', input);
    return data;
  },

  async updateWidget(
    widgetId: string,
    input: { title?: string; size?: WidgetSize; vizType?: string | null; refreshIntervalSec?: number | null },
  ): Promise<DashboardWidget> {
    const { data } = await apiClient.patch<DashboardWidget>(`/ai-dashboard/widgets/${widgetId}`, input);
    return data;
  },

  async duplicateWidget(widgetId: string): Promise<DashboardWidget> {
    const { data } = await apiClient.post<DashboardWidget>(`/ai-dashboard/widgets/${widgetId}/duplicate`);
    return data;
  },

  async unpinWidget(widgetId: string): Promise<{ deleted: boolean }> {
    const { data } = await apiClient.delete<{ deleted: boolean }>(`/ai-dashboard/widgets/${widgetId}`);
    return data;
  },

  async executeWidget(widgetId: string, force = false): Promise<WidgetExecutionResult> {
    const { data } = await apiClient.post<WidgetExecutionResult>(
      `/ai-dashboard/widgets/${widgetId}/execute`,
      { force },
      { timeout: WIDGET_EXECUTE_TIMEOUT_MS },
    );
    return data;
  },

  async listInsights(params: {
    status?: string[];
    severity?: string[];
    category?: string;
    page?: number;
    pageSize?: number;
  }): Promise<InsightListResponse> {
    const { data } = await apiClient.get<InsightListResponse>('/ai-insights', {
      params: {
        status: params.status?.join(','),
        severity: params.severity?.join(','),
        category: params.category,
        page: params.page,
        pageSize: params.pageSize,
      },
    });
    return data;
  },

  async insightSummary(): Promise<InsightSummary> {
    const { data } = await apiClient.get<InsightSummary>('/ai-insights/summary');
    return data;
  },

  async acknowledgeInsight(insightId: string, note?: string): Promise<Insight> {
    const { data } = await apiClient.post<Insight>(`/ai-insights/${insightId}/acknowledge`, { note });
    return data;
  },

  async resolveInsight(insightId: string, note?: string): Promise<Insight> {
    const { data } = await apiClient.post<Insight>(`/ai-insights/${insightId}/resolve`, { note });
    return data;
  },

  async archiveInsight(insightId: string, note?: string): Promise<Insight> {
    const { data } = await apiClient.post<Insight>(`/ai-insights/${insightId}/archive`, { note });
    return data;
  },

  async reopenInsight(insightId: string, note?: string): Promise<Insight> {
    const { data } = await apiClient.post<Insight>(`/ai-insights/${insightId}/reopen`, { note });
    return data;
  },

  async generateInsights(): Promise<unknown> {
    const { data } = await apiClient.post('/ai-insights/generate', {}, { timeout: WIDGET_EXECUTE_TIMEOUT_MS });
    return data;
  },

  async listProviders(): Promise<InsightProviderConfig[]> {
    const { data } = await apiClient.get<InsightProviderConfig[]>('/ai-insights/providers');
    return data;
  },

  async updateProvider(providerId: string, enabled: boolean): Promise<InsightProviderConfig[]> {
    const { data } = await apiClient.patch<InsightProviderConfig[]>(`/ai-insights/providers/${providerId}`, { enabled });
    return data;
  },
};
