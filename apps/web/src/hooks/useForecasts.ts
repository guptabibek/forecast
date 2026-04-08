import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { forecastService } from '../services/api';
import type { CreateForecastDto } from '../services/api/forecast.service';

// UpdateForecastDto is a partial of CreateForecastDto
type UpdateForecastDto = Partial<CreateForecastDto>;

export const forecastKeys = {
  all: ['forecasts'] as const,
  lists: () => [...forecastKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...forecastKeys.lists(), filters] as const,
  details: () => [...forecastKeys.all, 'detail'] as const,
  detail: (id: string) => [...forecastKeys.details(), id] as const,
  models: () => [...forecastKeys.all, 'models'] as const,
  modelsExplainability: () => [...forecastKeys.all, 'models-explainability'] as const,
  compare: (ids: string[]) => [...forecastKeys.all, 'compare', ids] as const,
  accuracy: (planVersionId: string, scenarioId: string) => 
    [...forecastKeys.all, 'accuracy', planVersionId, scenarioId] as const,
  enhancedAccuracy: (planVersionId: string, scenarioId: string) => 
    [...forecastKeys.all, 'enhanced-accuracy', planVersionId, scenarioId] as const,
  backtest: (planVersionId: string, scenarioId: string, holdoutPeriods?: number) => 
    [...forecastKeys.all, 'backtest', planVersionId, scenarioId, holdoutPeriods] as const,
  primary: (planVersionId: string, scenarioId: string) => 
    [...forecastKeys.all, 'primary', planVersionId, scenarioId] as const,
};

export function useForecasts(params?: { planId?: string; status?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: forecastKeys.list(params || {}),
    queryFn: () => forecastService.getAll(params),
  });
}

export function useForecast(id: string) {
  return useQuery({
    queryKey: forecastKeys.detail(id),
    queryFn: () => forecastService.getById(id),
    enabled: !!id,
  });
}

export function useForecastModels() {
  return useQuery({
    queryKey: forecastKeys.models(),
    queryFn: () => forecastService.getModels(),
    staleTime: Infinity,
  });
}

export function useCompareForecasts(ids: string[]) {
  return useQuery({
    queryKey: forecastKeys.compare(ids),
    queryFn: () => forecastService.compare(ids),
    enabled: ids.length >= 2,
  });
}

export function useCreateForecast() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateForecastDto) => forecastService.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: forecastKeys.lists() });
    },
  });
}

export function useUpdateForecast() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateForecastDto }) =>
      forecastService.update(id, dto),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: forecastKeys.lists() });
      queryClient.invalidateQueries({ queryKey: forecastKeys.detail(id) });
    },
  });
}

export function useDeleteForecast() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => forecastService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: forecastKeys.lists() });
    },
  });
}

export function useRunForecast() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => forecastService.run(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: forecastKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: forecastKeys.lists() });
    },
  });
}

export function useForecastAccuracy(planVersionId: string, scenarioId: string) {
  return useQuery({
    queryKey: [...forecastKeys.all, 'accuracy', planVersionId, scenarioId] as const,
    queryFn: () => forecastService.getAccuracy(planVersionId, scenarioId),
    enabled: !!planVersionId && !!scenarioId,
  });
}

export function useForecastData(
  planVersionId: string, 
  scenarioId: string, 
  params?: { startDate?: string; endDate?: string }
) {
  return useQuery({
    queryKey: [...forecastKeys.all, 'data', planVersionId, scenarioId, params] as const,
    queryFn: () => forecastService.getForecastData(
      planVersionId, 
      scenarioId, 
      params?.startDate, 
      params?.endDate
    ),
    enabled: !!planVersionId && !!scenarioId,
  });
}

// ============================================================================
// ENHANCED FORECAST ANALYTICS HOOKS (Additive - new functionality)
// ============================================================================

/**
 * Get enhanced accuracy metrics with per-model breakdown
 */
export function useEnhancedForecastAccuracy(planVersionId: string, scenarioId: string) {
  return useQuery({
    queryKey: forecastKeys.enhancedAccuracy(planVersionId, scenarioId),
    queryFn: () => forecastService.getEnhancedAccuracy(planVersionId, scenarioId),
    enabled: !!planVersionId && !!scenarioId,
  });
}

/**
 * Run backtesting on historical data
 */
export function useForecastBacktest(
  planVersionId: string,
  scenarioId: string,
  options?: { holdoutPeriods?: number; models?: string[]; enabled?: boolean }
) {
  return useQuery({
    queryKey: forecastKeys.backtest(planVersionId, scenarioId, options?.holdoutPeriods),
    queryFn: () => forecastService.runBacktest(planVersionId, scenarioId, {
      holdoutPeriods: options?.holdoutPeriods,
      models: options?.models,
    }),
    enabled: (options?.enabled ?? true) && !!planVersionId && !!scenarioId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes (backtesting is compute-intensive)
  });
}

/**
 * Get model explainability information
 */
export function useModelExplainability() {
  return useQuery({
    queryKey: forecastKeys.modelsExplainability(),
    queryFn: () => forecastService.getModelExplainability(),
    staleTime: Infinity, // Model explanations don't change
  });
}

/**
 * Get primary forecast model for a plan/scenario
 */
export function usePrimaryForecast(planVersionId: string, scenarioId: string) {
  return useQuery({
    queryKey: forecastKeys.primary(planVersionId, scenarioId),
    queryFn: () => forecastService.getPrimaryForecast(planVersionId, scenarioId),
    enabled: !!planVersionId && !!scenarioId,
  });
}

/**
 * Set primary forecast model for a plan/scenario
 */
export function useSetPrimaryForecast() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ planVersionId, scenarioId, modelName }: {
      planVersionId: string;
      scenarioId: string;
      modelName: string;
    }) => forecastService.setPrimaryForecast(planVersionId, scenarioId, modelName),
    onSuccess: (_, { planVersionId, scenarioId }) => {
      // Invalidate primary forecast query to refresh
      queryClient.invalidateQueries({ 
        queryKey: forecastKeys.primary(planVersionId, scenarioId) 
      });
    },
  });
}
