import type {
  Forecast,
  ForecastModel,
  ForecastModelInfo,
  PaginatedResponse,
  QueryParams,
} from '@/types';
import { apiClient } from './client';

// DTO aligned with backend CreateForecastDto
export interface CreateForecastDto {
  planVersionId: string;
  scenarioId: string;
  forecastModel: ForecastModel;
  periodDate: string;
  periodType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  forecastAmount?: number;
  forecastQuantity?: number;
  currency?: string;
  productId?: string;
  locationId?: string;
  customerId?: string;
  accountId?: string;
  costCenterId?: string;
  parameters?: Record<string, unknown>;
  autoRun?: boolean;
}

// DTO for generating forecasts dynamically from historical data
export interface GenerateForecastDto {
  planVersionId: string;
  scenarioId: string;
  models: ForecastModel[];
  startDate?: string;
  endDate?: string;
  periods?: number;
  periodType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  productIds?: string[];
  locationIds?: string[];
  customerIds?: string[];
  dimensions?: string[];
  parameters?: Record<string, unknown>;
  persist?: boolean;
  historyMonths?: number;
  rolling?: boolean;
  ensembleWeights?: Record<string, number>;
  externalSignals?: Array<{ name: string; factor: number; startDate?: string; endDate?: string }>;
  snapshotLabel?: string;
}

// Generated forecast response (synchronous results)
export interface GenerateForecastResponse {
  status: 'completed';
  runs: Array<{ model: ForecastModel; runId: string; status: string; resultCount: number }>;
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  startDate: string;
  endDate: string;
  forecasts: Array<{
    forecastModel: ForecastModel;
    periodDate: string;
    periodType: string;
    forecastAmount: number;
    forecastQuantity?: number;
    confidenceLower?: number;
    confidenceUpper?: number;
    productId?: string;
    locationId?: string;
  }>;
}

// DTO aligned with backend RunForecastDto
export interface RunForecastDto {
  parameters?: Record<string, unknown>;
  forceRefresh?: boolean;
  priority?: number;
}

// Query params for forecast list
export interface ForecastQueryParams extends QueryParams {
  planVersionId?: string;
  scenarioId?: string;
  forecastModel?: ForecastModel;
}

// Forecast job result
export interface ForecastJobResult {
  jobId: string;
  status: 'queued' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress?: number;
  results?: Forecast[];
  error?: string;
}

export interface ForecastOverride {
  id: string;
  forecastRunId: string;
  periodDate: string;
  periodType: string;
  overrideAmount: number;
  overrideQuantity?: number;
  originalAmount: number;
  originalQuantity?: number;
  currency: string;
  reason: string;
  status: string;
  requestedById: string;
  requestedAt: string;
  approvedById?: string;
  approvedAt?: string;
  approvalNotes?: string;
}

const normalizeForecastResult = (forecast: Forecast): Forecast => {
  const run = forecast.forecastRun;
  return {
    ...forecast,
    forecastRunId: forecast.forecastRunId ?? run?.id,
    planVersionId: forecast.planVersionId ?? run?.planVersionId,
    scenarioId: forecast.scenarioId ?? run?.scenarioId,
    forecastModel: forecast.forecastModel ?? run?.forecastModel,
  };
};

export const forecastService = {
  // Generate forecasts dynamically from historical data (POST /forecasts/generate)
  // This runs forecast models against actual data in real-time
  generate: async (dto: GenerateForecastDto): Promise<GenerateForecastResponse> => {
    const { data } = await apiClient.post<GenerateForecastResponse>('/forecasts/generate', dto);
    return data;
  },

  // Create a new forecast (POST /forecasts)
  // Backend returns entity directly
  create: async (dto: CreateForecastDto): Promise<Forecast> => {
    const { data } = await apiClient.post<Forecast>('/forecasts', dto);
    return normalizeForecastResult(data);
  },

  // Get all forecasts with optional filters (GET /forecasts)
  // Backend returns { data: [], meta: {} }
  getAll: async (params?: ForecastQueryParams): Promise<PaginatedResponse<Forecast>> => {
    const { data } = await apiClient.get<{ data: Forecast[]; meta: { total: number; page: number; pageSize: number; totalPages: number } }>(
      '/forecasts',
      { params }
    );
    return {
      data: data.data.map(normalizeForecastResult),
      meta: data.meta,
    };
  },

  // Get forecast by ID (GET /forecasts/:id)
  // Backend returns entity directly
  getById: async (id: string): Promise<Forecast> => {
    const { data } = await apiClient.get<Forecast>(`/forecasts/${id}`);
    return normalizeForecastResult(data);
  },

  // Update forecast (PATCH /forecasts/:id)
  // Backend returns entity directly
  update: async (
    id: string,
    dto: Partial<CreateForecastDto>
  ): Promise<ForecastOverride> => {
    const { data } = await apiClient.patch<ForecastOverride>(`/forecasts/${id}`, dto);
    return data;
  },

  // Delete forecast (DELETE /forecasts/:id)
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/forecasts/${id}`);
  },

  // Get available forecast models (GET /forecasts/models)
  // Backend returns array directly
  getModels: async (): Promise<ForecastModelInfo[]> => {
    const { data } = await apiClient.get<ForecastModelInfo[]>('/forecasts/models');
    return data;
  },

  // Get forecasts by plan version (GET /forecasts/plan-version/:planVersionId)
  // Backend returns array directly
  getByPlanVersion: async (planVersionId: string): Promise<Forecast[]> => {
    const { data } = await apiClient.get<Forecast[]>(
      `/forecasts/plan-version/${planVersionId}`
    );
    return data;
  },

  // Get forecast data for plan version and scenario 
  // (GET /forecasts/data/:planVersionId/:scenarioId)
  // Backend returns array directly
  getForecastData: async (
    planVersionId: string,
    scenarioId: string,
    startDate?: string,
    endDate?: string
  ): Promise<Forecast[]> => {
    const { data } = await apiClient.get<Forecast[]>(
      `/forecasts/data/${planVersionId}/${scenarioId}`,
      { params: { startDate, endDate } }
    );
    return data.map(normalizeForecastResult);
  },

  // Run/re-run a forecast (POST /forecasts/:id/run)
  // Backend returns { jobId, status, forecastId }
  run: async (id: string, dto?: RunForecastDto): Promise<ForecastJobResult> => {
    const { data } = await apiClient.post<ForecastJobResult>(
      `/forecasts/${id}/run`,
      dto || {}
    );
    return data;
  },

  // Compare multiple forecasts (GET /forecasts/compare?ids=id1,id2,id3)
  // Backend returns { forecasts: [], data: [] }
  compare: async (
    forecastIds: string[]
  ): Promise<{
    forecasts: Array<{
      id: string;
      model: string;
      planVersion: { id: string; name: string };
      scenario: { id: string; name: string };
    }>;
    data: Array<{ period: Date; [key: string]: unknown }>;
  }> => {
    const { data } = await apiClient.get<{
      forecasts: Array<{
        id: string;
        model: string;
        planVersion: { id: string; name: string };
        scenario: { id: string; name: string };
      }>;
      data: Array<{ period: Date; [key: string]: unknown }>;
    }>('/forecasts/compare', { params: { ids: forecastIds.join(',') } });
    return data;
  },

  // Get accuracy metrics (GET /forecasts/accuracy/:planVersionId/:scenarioId)
  // Backend returns accuracy object directly
  getAccuracy: async (
    planVersionId: string,
    scenarioId: string
  ): Promise<{
    mape: number;
    rmse: number;
    mae: number;
    bias: number;
  }> => {
    const { data } = await apiClient.get<{
      mape: number;
      rmse: number;
      mae: number;
      bias: number;
    }>(`/forecasts/accuracy/${planVersionId}/${scenarioId}`);
    return data;
  },

  // ============================================================================
  // ENHANCED FORECAST ANALYTICS (Additive - new functionality)
  // ============================================================================

  // Get aggregated chart data for all models
  // (GET /forecasts/chart-data/:planVersionId/:scenarioId)
  getChartData: async (
    planVersionId: string,
    scenarioId: string
  ): Promise<{ data: Array<Record<string, unknown>>; models: string[] }> => {
    const { data } = await apiClient.get<{ data: Array<Record<string, unknown>>; models: string[] }>(
      `/forecasts/chart-data/${planVersionId}/${scenarioId}`
    );
    return data;
  },

  // Get enhanced accuracy metrics with per-model breakdown
  // (GET /forecasts/accuracy-detailed/:planVersionId/:scenarioId)
  getEnhancedAccuracy: async (
    planVersionId: string,
    scenarioId: string
  ): Promise<EnhancedAccuracyResponse> => {
    const { data } = await apiClient.get<EnhancedAccuracyResponse>(
      `/forecasts/accuracy-detailed/${planVersionId}/${scenarioId}`
    );
    return data;
  },

  // Run backtesting (GET /forecasts/backtest/:planVersionId/:scenarioId)
  runBacktest: async (
    planVersionId: string,
    scenarioId: string,
    options?: { holdoutPeriods?: number; models?: string[] }
  ): Promise<BacktestResponse> => {
    const params: Record<string, string> = {};
    if (options?.holdoutPeriods) params.holdoutPeriods = String(options.holdoutPeriods);
    if (options?.models?.length) params.models = options.models.join(',');
    
    const { data } = await apiClient.get<BacktestResponse>(
      `/forecasts/backtest/${planVersionId}/${scenarioId}`,
      { params }
    );
    return data;
  },

  // Get model explainability information (GET /forecasts/models/explainability)
  getModelExplainability: async (): Promise<ModelExplainability[]> => {
    const { data } = await apiClient.get<ModelExplainability[]>(
      '/forecasts/models/explainability'
    );
    return data;
  },

  // Get primary forecast model (GET /forecasts/primary/:planVersionId/:scenarioId)
  getPrimaryForecast: async (
    planVersionId: string,
    scenarioId: string
  ): Promise<PrimaryForecastResponse> => {
    const { data } = await apiClient.get<PrimaryForecastResponse>(
      `/forecasts/primary/${planVersionId}/${scenarioId}`
    );
    return data;
  },

  // Set primary forecast model (POST /forecasts/primary)
  setPrimaryForecast: async (
    planVersionId: string,
    scenarioId: string,
    modelName: string
  ): Promise<{ planVersionId: string; scenarioId: string; primaryModel: string; message: string }> => {
    const { data } = await apiClient.post<{
      planVersionId: string;
      scenarioId: string;
      primaryModel: string;
      message: string;
    }>('/forecasts/primary', {
      planVersionId,
      scenarioId,
      modelName,
    });
    return data;
  },

  getActualsForChart: async (
    planVersionId: string,
    scenarioId: string
  ): Promise<Array<{ period: string; sortDate: string; actual: number }>> => {
    const { data } = await apiClient.get<Array<{ period: string; sortDate: string; actual: number }>>(
      `/forecasts/actuals-chart/${planVersionId}/${scenarioId}`
    );
    return data;
  },

  exportForecasts: async (
    planVersionId: string,
    scenarioId: string,
    format: 'csv' | 'json' = 'csv'
  ): Promise<string | Array<Record<string, unknown>>> => {
    const { data } = await apiClient.get(
      `/forecasts/export/${planVersionId}/${scenarioId}`,
      { params: { format } }
    );
    return data;
  },

  getForecastVersions: async (
    planVersionId: string,
    scenarioId: string
  ): Promise<Array<{ id: string; model: string; status: string; createdAt: string; snapshotLabel?: string; resultCount: number }>> => {
    const { data } = await apiClient.get(
      `/forecasts/versions/${planVersionId}/${scenarioId}`
    );
    return data;
  },

  compareVersions: async (
    runIds: string[]
  ): Promise<{ runs: Array<{ id: string; model: string; snapshotLabel?: string }>; periods: Array<Record<string, unknown>> }> => {
    const { data } = await apiClient.get(
      '/forecasts/compare-versions',
      { params: { runIds: runIds.join(',') } }
    );
    return data;
  },

  getAccuracyAlerts: async (
    planVersionId: string,
    scenarioId: string,
    threshold?: number
  ): Promise<Array<{ model: string; mape: number; level: 'critical' | 'warning' | 'info'; message: string }>> => {
    const { data } = await apiClient.get(
      `/forecasts/alerts/${planVersionId}/${scenarioId}`,
      { params: threshold ? { threshold: String(threshold) } : {} }
    );
    return data;
  },

  getDimensionBreakdown: async (
    planVersionId: string,
    scenarioId: string,
    dimensionType: 'product' | 'location' | 'customer' = 'product'
  ): Promise<Array<{ dimensionId: string; dimensionName: string; total: number; periods: Array<{ period: string; amount: number }> }>> => {
    const { data } = await apiClient.get(
      `/forecasts/dimensions/${planVersionId}/${scenarioId}`,
      { params: { type: dimensionType } }
    );
    return data;
  },

  snapshotForecast: async (
    planVersionId: string,
    scenarioId: string,
    label: string
  ): Promise<{ message: string; label: string; updatedRuns: number }> => {
    const { data } = await apiClient.post('/forecasts/snapshot', {
      planVersionId,
      scenarioId,
      label,
    });
    return data;
  },

  getDashboardSummary: async (): Promise<{
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    totalForecasts: number;
    totalForecastValue: number;
    modelsUsed: string[];
    lastForecastDate: string | null;
    recentRuns: Array<Record<string, unknown>>;
  }> => {
    const { data } = await apiClient.get('/forecasts/dashboard-summary');
    return data;
  },
};

// ============================================================================
// NEW TYPES FOR ENHANCED ANALYTICS
// ============================================================================

// Per-model accuracy metrics
export interface ModelAccuracy {
  modelName: string;
  displayName: string;
  mape: number | null;
  rmse: number | null;
  mae: number | null;
  bias: number | null;
  accuracy: number | null;
  dataPoints: number;
}

// Enhanced accuracy response
export interface EnhancedAccuracyResponse {
  planVersionId: string;
  scenarioId: string;
  overall: {
    mape: number | null;
    rmse: number | null;
    mae: number | null;
    bias: number | null;
    accuracy: number | null;
  };
  byModel: ModelAccuracy[];
  totalDataPoints: number;
  actualsAvailable: number;
  bestModel: string | null;
  recommendation: string | null;
}

// Backtest model result
export interface BacktestModelResult {
  modelName: string;
  displayName: string;
  data: Array<{
    period: string;
    periodLabel: string;
    forecast: number;
    actual: number | null;
    error: number | null;
    percentError: number | null;
  }>;
  metrics: {
    mape: number | null;
    rmse: number | null;
    mae: number | null;
    bias: number | null;
  };
}

// Complete backtest response
export interface BacktestResponse {
  planVersionId: string;
  scenarioId: string;
  holdoutPeriods: number;
  trainingRange: { start: string; end: string };
  holdoutRange: { start: string; end: string };
  results: BacktestModelResult[];
  bestModel: string | null;
}

// Model explainability
export interface ModelExplainability {
  name: string;
  displayName: string;
  description: string;
  minDataPoints: number;
  supportsSeasonality: boolean;
  defaultParameters: Record<string, unknown>;
  methodology: string;
  bestFor: string[];
  limitations: string[];
  interpretability: 'high' | 'medium' | 'low';
}

// Primary forecast response
export interface PrimaryForecastResponse {
  planVersionId: string;
  scenarioId: string;
  primaryModel: string | null;
}
