import { apiClient } from './client';

const AI_REPORTING_REQUEST_TIMEOUT_MS = 600000;

export type AiReportStatus = 'success' | 'clarification_required' | 'unsupported' | 'error';
export type AiVisualizationType = 'table' | 'kpi' | 'bar' | 'line' | 'pie' | 'dashboard';

export interface AiReportColumn {
  key?: string;
  field?: string;
  label: string;
  dataType?: string;
}

export interface AiReportVisualization {
  type: AiVisualizationType;
  x?: string;
  y?: string;
}

export type AiReportRow = Record<string, unknown>;

export interface AiReportMetadata {
  metricLabel: string;
  groupedBy: string;
  periodLabel: string;
}

export interface AiReportKpi {
  label: string;
  value: unknown;
  dataType?: string;
  hint?: string;
}

export interface AiReportGrid {
  columns: AiReportColumn[];
  rows: AiReportRow[];
  totals?: Record<string, number>;
}

export interface AiReportChart {
  enabled: boolean;
  type: 'bar' | 'line' | 'pie' | 'kpi' | 'none';
  xField: string | null;
  yField: string | null;
  data: AiReportRow[];
}

export interface AiReportInterpretationMetric {
  metricId: string;
  label: string;
  dataType: string;
}

export interface AiReportInterpretationDimension {
  dimensionId: string;
  label: string;
}

export interface AiReportInterpretationTimeRange {
  type: string;
  startDate?: string | null;
  endDate?: string | null;
  fieldId?: string | null;
}

export interface AiReportInterpretation {
  datasetId: string;
  datasetLabel: string;
  mode?: string;
  analysisType?: string;
  metrics: AiReportInterpretationMetric[];
  dimensions: AiReportInterpretationDimension[];
  timeRange: AiReportInterpretationTimeRange | null;
  limit?: number;
  sort: Array<{
    metricId?: string;
    dimensionId?: string;
    columnId?: string;
    direction: 'asc' | 'desc';
  }>;
}

export interface AiReportWidget {
  widgetId: string;
  title: string;
  mode?: string;
  metadata?: AiReportMetadata;
  kpis?: AiReportKpi[];
  grid?: AiReportGrid;
  chart?: AiReportChart;
  visualization?: AiReportVisualization;
  columns: AiReportColumn[];
  rows: AiReportRow[];
  summary?: string | null;
  assumptions?: string[];
  interpretation?: AiReportInterpretation;
}

export interface AiReportResponse {
  requestId: string;
  status: AiReportStatus;
  title: string;
  queryKind: 'single_report' | 'dashboard' | 'clarification' | 'unsupported';
  mode?: string;
  metadata?: AiReportMetadata;
  kpis?: AiReportKpi[];
  grid?: AiReportGrid;
  chart?: AiReportChart;
  visualization?: AiReportVisualization;
  columns?: AiReportColumn[];
  rows?: AiReportRow[];
  summary?: string | null;
  assumptions?: string[];
  followUpQuestions?: string[];
  clarification?: string | null;
  unsupportedReason?: string | null;
  errorCode?: string | null;
  availableAlternatives?: string[];
  missingCapabilities?: string[];
  recommendedSchemaFix?: string | null;
  widgets?: AiReportWidget[];
  interpretation?: AiReportInterpretation;
}

export interface AiReportRequest {
  question: string;
  outputMode?: 'auto' | 'table' | 'chart';
  includeSummary?: boolean;
  companyId?: number;
  branchIds?: string[];
}

export interface AiCatalogMetadata {
  catalogVersion: string;
  feature?: {
    enabled: boolean;
    summariesEnabled: boolean;
    maxRows: number;
  };
  datasets: Array<{ datasetId: string; domain: string; grain: string; description: string }>;
  metrics: Array<{ metricId: string; displayName: string; datasetId: string; dataType?: string; synonyms?: string[] }>;
  dimensions: Array<{ dimensionId: string; displayName: string; datasetId: string; synonyms?: string[] }>;
  displayColumns?: Array<{ columnId: string; datasetId: string; label: string; dataType?: string; defaultForDetail?: boolean; synonyms?: string[] }>;
  reportTemplates: Array<{ templateId: string; displayName: string; analysisType?: string; synonyms?: string[] }>;
  dashboardTemplates: Array<{ dashboardId: string; displayName: string; description?: string; synonyms?: string[] }>;
  reportAreas?: string[];
  suggestedQuestions?: string[];
}

export interface AiReportHistoryItem {
  requestId: string;
  question: string;
  outputMode?: string | null;
  queryKind?: string | null;
  rowCount?: number | null;
  status: 'success' | 'error';
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

export interface AiTenantUsageSummary {
  periodStart: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostCents: number | null;
  byModel: Array<{
    provider: string;
    model: string | null;
    calls: number;
    totalTokens: number;
    estimatedCostCents: number | null;
  }>;
}

export interface AiProviderSettings {
  configured: boolean;
  enabled: boolean;
  provider: string;
  model: string;
  summaryModel: string | null;
  apiKeyConfigured: boolean;
  apiKeyLast4: string | null;
  endpointUrl: string | null;
  organizationId: string | null;
  maxTokens: number | null;
  temperature: number | null;
  monthlyTokenLimit: number | null;
  monthlyCostLimitCents: number | null;
  inputTokenCostPer1mCents: number | null;
  outputTokenCostPer1mCents: number | null;
  timeoutMs: number;
  maxResultRows: number;
  maxSummaryRows: number;
  dailyUserCallLimit: number;
  dailyTenantCallLimit: number;
  monthlyCompanyCallLimit: number;
  maskSensitiveFields: boolean;
  summariesEnabled: boolean;
  ratePerUserPerMinute: number;
  ratePerTenantPerHour: number;
  maxConcurrentPerUser: number;
  maxConcurrentPerTenant: number;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  updatedAt: string | null;
  usage: AiTenantUsageSummary;
}

export interface AiProviderSettingsUpdate {
  enabled?: boolean;
  provider?: string;
  model?: string;
  summaryModel?: string | null;
  apiKey?: string | null;
  clearApiKey?: boolean;
  endpointUrl?: string | null;
  organizationId?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  monthlyTokenLimit?: number | null;
  monthlyCostLimitCents?: number | null;
  inputTokenCostPer1mCents?: number | null;
  outputTokenCostPer1mCents?: number | null;
  timeoutMs?: number | null;
  maxResultRows?: number | null;
  maxSummaryRows?: number | null;
  dailyUserCallLimit?: number | null;
  dailyTenantCallLimit?: number | null;
  monthlyCompanyCallLimit?: number | null;
  maskSensitiveFields?: boolean | null;
  summariesEnabled?: boolean | null;
  ratePerUserPerMinute?: number | null;
  ratePerTenantPerHour?: number | null;
  maxConcurrentPerUser?: number | null;
  maxConcurrentPerTenant?: number | null;
}

export interface AiProviderTestResult {
  success: boolean;
  message: string;
  testedAt: string;
}

export const aiReportingService = {
  async query(request: AiReportRequest): Promise<AiReportResponse> {
    const { data } = await apiClient.post<AiReportResponse>('/ai-reporting/query', request, {
      timeout: AI_REPORTING_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  async dashboard(request: AiReportRequest): Promise<AiReportResponse> {
    const { data } = await apiClient.post<AiReportResponse>('/ai-reporting/dashboard', request, {
      timeout: AI_REPORTING_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  async catalog(): Promise<AiCatalogMetadata> {
    const { data } = await apiClient.get<AiCatalogMetadata>('/ai-reporting/catalog');
    return data;
  },

  async history(limit = 25): Promise<AiReportHistoryItem[]> {
    const { data } = await apiClient.get<AiReportHistoryItem[]>('/ai-reporting/history', { params: { limit } });
    return data;
  },

  async settings(): Promise<AiProviderSettings> {
    const { data } = await apiClient.get<AiProviderSettings>('/ai-reporting/settings');
    return data;
  },

  async updateSettings(request: AiProviderSettingsUpdate): Promise<AiProviderSettings> {
    const { data } = await apiClient.patch<AiProviderSettings>('/ai-reporting/settings', request);
    return data;
  },

  async testSettings(): Promise<AiProviderTestResult> {
    const { data } = await apiClient.post<AiProviderTestResult>('/ai-reporting/settings/test');
    return data;
  },

  async usage(): Promise<AiTenantUsageSummary> {
    const { data } = await apiClient.get<AiTenantUsageSummary>('/ai-reporting/usage');
    return data;
  },
};
