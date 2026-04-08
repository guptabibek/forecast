import type { ForecastModel, Scenario } from '@/types';
import {
    AdjustmentsHorizontalIcon,
    ArrowDownTrayIcon,
    ArrowPathIcon,
    BellAlertIcon,
    BookmarkIcon,
    CalendarIcon,
    ChartBarIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    ClockIcon,
    EyeIcon,
    EyeSlashIcon,
    FunnelIcon,
    InformationCircleIcon,
    LightBulbIcon,
    PlayIcon,
    StarIcon
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { forecastService, planService, scenarioService } from '@services/api';
import type {
    GenerateForecastResponse
} from '@services/api/forecast.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { format } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import {
    Area,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

const modelColors: Record<string, string> = {
  MOVING_AVERAGE: '#3b82f6',
  WEIGHTED_AVERAGE: '#8b5cf6',
  LINEAR_REGRESSION: '#ec4899',
  HOLT_WINTERS: '#f59e0b',
  SEASONAL_NAIVE: '#10b981',
  YOY_GROWTH: '#06b6d4',
  TREND_PERCENT: '#6366f1',
  AI_HYBRID: '#ef4444',
  ARIMA: '#14b8a6',
  PROPHET: '#f97316',
  MANUAL: '#64748b',
};

// Accuracy badge component
const AccuracyBadge = ({ value, type }: { value: number | null; type: 'mape' | 'accuracy' }) => {
  if (value === null) return <span className="text-secondary-400">N/A</span>;
  
  let colorClass = '';
  if (type === 'mape') {
    // Lower is better for MAPE
    if (value < 10) colorClass = 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400';
    else if (value < 20) colorClass = 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400';
    else colorClass = 'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-400';
  } else {
    // Higher is better for accuracy
    if (value > 90) colorClass = 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400';
    else if (value > 80) colorClass = 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400';
    else colorClass = 'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-400';
  }
  
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', colorClass)}>
      {value.toFixed(1)}%
    </span>
  );
};

export default function Forecasts() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPlanId, setSelectedPlanId] = useState<string>(searchParams.get('plan') || '');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(searchParams.get('scenario') || '');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set(['MOVING_AVERAGE']),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [queuedRuns, setQueuedRuns] = useState<GenerateForecastResponse | null>(null);
  
  const autoGenerateAttemptedRef = useRef<string | null>(null);
  const generateLockRef = useRef(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [showConfirmGenerate, setShowConfirmGenerate] = useState(false);

  // Sync URL search params when plan/scenario change
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedPlanId) next.set('plan', selectedPlanId); else next.delete('plan');
    if (selectedScenarioId) next.set('scenario', selectedScenarioId); else next.delete('scenario');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [selectedPlanId, selectedScenarioId, searchParams, setSearchParams]);

  // Close export menu on outside click
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportMenuOpen]);

  // New state for enhanced features
  const [showConfidenceBands, setShowConfidenceBands] = useState(false);
  const [showBacktestView, setShowBacktestView] = useState(false);
  const [showModelExplainability, setShowModelExplainability] = useState(false);
  const [expandedExplainModel, setExpandedExplainModel] = useState<string | null>(null);

  const [forecastHorizon, setForecastHorizon] = useState<string>('12');
  const [periodType, setPeriodType] = useState<string>('');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [isRolling, setIsRolling] = useState(false);
  const [historyMonths, setHistoryMonths] = useState<string>('');
  const [showActuals, setShowActuals] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [dimensionType, setDimensionType] = useState<'product' | 'location' | 'customer'>('product');
  const [showVersions, setShowVersions] = useState(false);
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);
  const [showAlerts, setShowAlerts] = useState(true);
  const [alertThreshold, setAlertThreshold] = useState(25);
  const [showDimensionBreakdown, setShowDimensionBreakdown] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [ensembleWeights, setEnsembleWeights] = useState<Record<string, string>>({});
  const [externalSignals, setExternalSignals] = useState<Array<{ name: string; factor: string; startDate: string; endDate: string }>>([]);

  // Fetch plans (all statuses for flexibility)
  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ['plans', 'all'],
    queryFn: () =>
      planService.getAll({
        pageSize: 50,
      }),
    staleTime: 30000, // Cache plans for 30 seconds
  });

  // Fetch the selected plan to get scenarios (scenarios are included in plan response)
  const { data: selectedPlan, isLoading: selectedPlanLoading } = useQuery({
    queryKey: ['plan', selectedPlanId],
    queryFn: () => planService.getById(selectedPlanId),
    enabled: !!selectedPlanId,
    staleTime: 0, // Always fetch fresh to get latest scenarios
  });

  // Also fetch scenarios via dedicated endpoint as fallback
  const { data: scenariosFromApi, isLoading: scenariosLoading } = useQuery({
    queryKey: ['scenarios', selectedPlanId],
    queryFn: () => scenarioService.getAll({ planVersionId: selectedPlanId }),
    enabled: !!selectedPlanId,
    staleTime: 0, // Always fetch fresh
  });

  // Derive scenarios - prefer plan.scenarios if available, fallback to dedicated API
  const scenarios: Scenario[] = useMemo(() => {
    // First try scenarios from the plan object
    if (selectedPlan?.scenarios && Array.isArray(selectedPlan.scenarios) && selectedPlan.scenarios.length > 0) {
      return selectedPlan.scenarios;
    }
    // Fallback to scenarios from dedicated API call
    if (scenariosFromApi && Array.isArray(scenariosFromApi) && scenariosFromApi.length > 0) {
      return scenariosFromApi;
    }
    return [];
  }, [selectedPlan?.scenarios, scenariosFromApi]);

  // Auto-select baseline scenario when scenarios are loaded or plan changes
  useEffect(() => {
    if (scenarios.length > 0) {
      // Check if selected scenario is still valid for current scenarios
      const currentScenarioValid = selectedScenarioId && scenarios.some(s => s.id === selectedScenarioId);
      
      if (!currentScenarioValid) {
        // If no valid selection, auto-select baseline or first scenario
        const baseline = scenarios.find(s => s.isBaseline);
        const firstScenario = scenarios[0];
        setSelectedScenarioId(baseline?.id || firstScenario?.id || '');
      }
    } else if (scenarios.length === 0 && selectedScenarioId) {
      // No scenarios available, clear selection
      setSelectedScenarioId('');
    }
  }, [scenarios, selectedScenarioId]);

  // Fetch forecast models
  const { data: models } = useQuery({
    queryKey: ['forecast-models'],
    queryFn: forecastService.getModels,
  });

  // Fetch existing forecasts for selected plan (persisted forecasts)
  const { data: forecastsData, isLoading, refetch } = useQuery({
    queryKey: ['forecasts', selectedPlanId, selectedScenarioId],
    queryFn: () => forecastService.getAll({
      planVersionId: selectedPlanId,
      scenarioId: selectedScenarioId || undefined,
      pageSize: 1000
    }),
    enabled: !!selectedPlanId,
    refetchOnWindowFocus: true,
    staleTime: 15000,
  });

  // Fetch aggregated chart data for all models (use this for the chart)
  const { data: aggregatedChartData, refetch: refetchChart } = useQuery({
    queryKey: ['forecast-chart-data', selectedPlanId, selectedScenarioId],
    queryFn: () => forecastService.getChartData(selectedPlanId, selectedScenarioId),
    enabled: !!selectedPlanId && !!selectedScenarioId,
  });

  // Fetch accuracy metrics
  const { data: accuracyData } = useQuery({
    queryKey: ['forecast-accuracy', selectedPlanId, selectedScenarioId],
    queryFn: () => forecastService.getAccuracy(selectedPlanId, selectedScenarioId),
    enabled: !!selectedPlanId && !!selectedScenarioId,
  });

  // ============================================================================
  // ENHANCED FORECAST ANALYTICS QUERIES (Additive - new functionality)
  // ============================================================================

  // Fetch enhanced accuracy metrics with per-model breakdown
  const { data: enhancedAccuracyData } = useQuery({
    queryKey: ['forecast-enhanced-accuracy', selectedPlanId, selectedScenarioId],
    queryFn: () => forecastService.getEnhancedAccuracy(selectedPlanId, selectedScenarioId),
    enabled: !!selectedPlanId && !!selectedScenarioId,
  });

  // Fetch backtest data (only when backtest view is enabled)
  const { data: backtestData, isLoading: backtestLoading, refetch: refetchBacktest } = useQuery({
    queryKey: ['forecast-backtest', selectedPlanId, selectedScenarioId],
    queryFn: () => forecastService.runBacktest(selectedPlanId, selectedScenarioId, { holdoutPeriods: 6 }),
    enabled: showBacktestView && !!selectedPlanId && !!selectedScenarioId,
  });

  // Fetch model explainability information
  const { data: modelExplainability } = useQuery({
    queryKey: ['forecast-model-explainability'],
    queryFn: () => forecastService.getModelExplainability(),
    staleTime: Infinity,
  });

  // Fetch primary forecast model
  const { data: primaryForecastData } = useQuery({
    queryKey: ['forecast-primary', selectedPlanId, selectedScenarioId],
    queryFn: () => forecastService.getPrimaryForecast(selectedPlanId, selectedScenarioId),
    enabled: !!selectedPlanId && !!selectedScenarioId,
  });

  const { data: actualsData } = useQuery({
    queryKey: ['forecast-actuals', selectedPlanId, selectedScenarioId],
    queryFn: () => forecastService.getActualsForChart(selectedPlanId, selectedScenarioId),
    enabled: showActuals && !!selectedPlanId && !!selectedScenarioId,
  });

  const { data: alertsData } = useQuery({
    queryKey: ['forecast-alerts', selectedPlanId, selectedScenarioId, alertThreshold],
    queryFn: () => forecastService.getAccuracyAlerts(selectedPlanId, selectedScenarioId, alertThreshold),
    enabled: showAlerts && !!selectedPlanId && !!selectedScenarioId,
  });

  const { data: versionsData, refetch: refetchVersions } = useQuery({
    queryKey: ['forecast-versions', selectedPlanId, selectedScenarioId],
    queryFn: () => forecastService.getForecastVersions(selectedPlanId, selectedScenarioId),
    enabled: showVersions && !!selectedPlanId && !!selectedScenarioId,
  });

  const { data: versionComparisonData } = useQuery({
    queryKey: ['forecast-version-compare', selectedVersionIds],
    queryFn: () => forecastService.compareVersions(selectedVersionIds),
    enabled: selectedVersionIds.length >= 2,
  });

  const { data: dimensionData } = useQuery({
    queryKey: ['forecast-dimensions', selectedPlanId, selectedScenarioId, dimensionType],
    queryFn: () => forecastService.getDimensionBreakdown(selectedPlanId, selectedScenarioId, dimensionType),
    enabled: showDimensionBreakdown && !!selectedPlanId && !!selectedScenarioId,
  });

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error && typeof error === 'object') {
      const maybeResponse = error as { response?: { data?: { message?: string } } };
      return maybeResponse.response?.data?.message || fallback;
    }
    return fallback;
  };

  // Mutation for setting primary forecast
  const setPrimaryMutation = useMutation({
    mutationFn: ({ modelName }: { modelName: string }) => 
      forecastService.setPrimaryForecast(selectedPlanId, selectedScenarioId, modelName),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['forecast-primary', selectedPlanId, selectedScenarioId] });
      toast.success(data.message);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to set primary forecast'));
    },
  });

  const snapshotMutation = useMutation({
    mutationFn: ({ label }: { label: string }) =>
      forecastService.snapshotForecast(selectedPlanId, selectedScenarioId, label),
    onSuccess: (data) => {
      toast.success(`Snapshot "${data.label}" saved (${data.updatedRuns} runs)`);
      setSnapshotLabel('');
      refetchVersions();
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to create snapshot'));
    },
  });

  const handleExport = useCallback(async (fmt: 'csv' | 'json') => {
    if (!selectedPlanId || !selectedScenarioId) return;
    try {
      const result = await forecastService.exportForecasts(selectedPlanId, selectedScenarioId, fmt);
      if (fmt === 'csv' && typeof result === 'string') {
        const blob = new Blob([result], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `forecast-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `forecast-export-${format(new Date(), 'yyyy-MM-dd')}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast.success(`Exported as ${fmt.toUpperCase()}`);
    } catch {
      toast.error('Export failed');
    }
  }, [selectedPlanId, selectedScenarioId]);

  // Mutation for generating forecasts dynamically
  const generateMutation = useMutation({
    mutationFn: forecastService.generate,
    onSuccess: (data) => {
      setQueuedRuns(data);
      const completed = data.runs.filter(r => r.status === 'completed');
      const total = completed.reduce((sum, r) => sum + r.resultCount, 0);
      toast.success(`Generated ${total} forecast results across ${completed.length} model${completed.length === 1 ? '' : 's'}`);
      // Refetch ALL dependent queries so UI reflects fresh data
      queryClient.invalidateQueries({ queryKey: ['forecasts', selectedPlanId, selectedScenarioId] });
      queryClient.invalidateQueries({ queryKey: ['forecast-chart-data', selectedPlanId, selectedScenarioId] });
      queryClient.invalidateQueries({ queryKey: ['forecast-accuracy', selectedPlanId, selectedScenarioId] });
      queryClient.invalidateQueries({ queryKey: ['forecast-enhanced-accuracy', selectedPlanId, selectedScenarioId] });
      queryClient.invalidateQueries({ queryKey: ['forecast-alerts', selectedPlanId, selectedScenarioId] });
      queryClient.invalidateQueries({ queryKey: ['forecast-versions', selectedPlanId, selectedScenarioId] });
      queryClient.invalidateQueries({ queryKey: ['forecast-actuals', selectedPlanId, selectedScenarioId] });
      queryClient.invalidateQueries({ queryKey: ['forecast-dimensions', selectedPlanId, selectedScenarioId] });
      queryClient.invalidateQueries({ queryKey: ['forecast-primary', selectedPlanId, selectedScenarioId] });
      refetch();
      refetchChart();
      generateLockRef.current = false;
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to generate forecasts'));
      generateLockRef.current = false;
    },
  });

  const plans = plansData?.data || [];
  const forecasts = useMemo(() => forecastsData?.data ?? [], [forecastsData?.data]);

  // Handle generating forecasts from historical data
  const handleGenerateForecasts = useCallback(async () => {
    if (!selectedPlanId || !selectedScenarioId) {
      toast.error('Please select a plan and scenario first');
      return;
    }

    if (selectedModels.size === 0) {
      toast.error('Please select at least one model');
      return;
    }

    // Input validation: date range
    if (customStartDate && customEndDate && customStartDate >= customEndDate) {
      toast.error('Start date must be before end date');
      return;
    }

    // Input validation: history months
    const hm = parseInt(historyMonths);
    if (historyMonths && (isNaN(hm) || hm < 1 || hm > 120)) {
      toast.error('History window must be between 1 and 120');
      return;
    }

    // Input validation: ensemble weights sum
    const weightValues = Object.values(ensembleWeights).map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
    if (weightValues.length > 0) {
      const sum = weightValues.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1.0) > 0.05) {
        toast.error(`Ensemble weights should sum to 1.0 (current: ${sum.toFixed(2)})`);
        return;
      }
    }

    // Prevent duplicate generate requests
    if (generateLockRef.current) return;
    generateLockRef.current = true;

    const dto: import('@services/api/forecast.service').GenerateForecastDto = {
      planVersionId: selectedPlanId,
      scenarioId: selectedScenarioId,
      models: Array.from(selectedModels) as ForecastModel[],
      periods: parseInt(forecastHorizon) || 12,
      persist: true,
      rolling: isRolling || undefined,
    };

    if (periodType) dto.periodType = periodType as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
    if (customStartDate) dto.startDate = customStartDate;
    if (customEndDate) dto.endDate = customEndDate;
    if (historyMonths && parseInt(historyMonths) > 0) dto.historyMonths = parseInt(historyMonths);
    if (snapshotLabel.trim()) dto.snapshotLabel = snapshotLabel.trim();

    const parsedWeights: Record<string, number> = {};
    let hasWeights = false;
    for (const [k, v] of Object.entries(ensembleWeights)) {
      const n = parseFloat(v);
      if (!isNaN(n) && n > 0) {
        parsedWeights[k] = n;
        hasWeights = true;
      }
    }
    if (hasWeights) dto.ensembleWeights = parsedWeights;

    const parsedSignals = externalSignals
      .filter(s => s.name.trim() && parseFloat(s.factor) > 0)
      .map(s => ({
        name: s.name.trim(),
        factor: parseFloat(s.factor),
        startDate: s.startDate || undefined,
        endDate: s.endDate || undefined,
      }));
    if (parsedSignals.length > 0) dto.externalSignals = parsedSignals;

    generateMutation.mutate(dto);
  }, [selectedPlanId, selectedScenarioId, selectedModels, generateMutation, forecastHorizon, periodType, customStartDate, customEndDate, isRolling, historyMonths, snapshotLabel, ensembleWeights, externalSignals]);

  // Wrapped handler that shows confirmation for expensive multi-model runs
  const handleGenerateWithConfirm = useCallback(() => {
    if (selectedModels.size >= 5) {
      setShowConfirmGenerate(true);
    } else {
      handleGenerateForecasts();
    }
  }, [selectedModels.size, handleGenerateForecasts]);

  // Handle refresh with feedback
  const handleRefresh = useCallback(async () => {
    if (!selectedPlanId) {
      toast.error('Please select a plan first');
      return;
    }

    setIsRefreshing(true);
    try {
      // Invalidate and refetch all related queries (include scenario ID in keys)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plan', selectedPlanId] }),
        queryClient.invalidateQueries({ queryKey: ['scenarios', selectedPlanId] }),
        queryClient.invalidateQueries({ queryKey: ['forecasts', selectedPlanId, selectedScenarioId] }),
        queryClient.invalidateQueries({ queryKey: ['forecast-chart-data', selectedPlanId, selectedScenarioId] }),
        queryClient.invalidateQueries({ queryKey: ['forecast-accuracy', selectedPlanId, selectedScenarioId] }),
        queryClient.invalidateQueries({ queryKey: ['forecast-enhanced-accuracy', selectedPlanId, selectedScenarioId] }),
        queryClient.invalidateQueries({ queryKey: ['forecast-primary', selectedPlanId, selectedScenarioId] }),
      ]);
      setQueuedRuns(null);
      await Promise.all([refetch(), refetchChart()]);
      toast.success('Data refreshed successfully');
    } catch {
      toast.error('Failed to refresh data');
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedPlanId, selectedScenarioId, queryClient, refetch, refetchChart]);

  // Select all models for comparison
  const handleSelectAllModels = useCallback(() => {
    if (models) {
      const allModelNames = models.map(m => m.name);
      setSelectedModels(new Set(allModelNames));
      toast.success(`Selected all ${allModelNames.length} models`);
    }
  }, [models]);

  // Clear all model selections
  const handleClearModels = useCallback(() => {
    setSelectedModels(new Set());
    toast('Cleared all model selections', { icon: 'ℹ️' });
  }, []);

  // Auto-generate forecasts when plan and scenario are selected but no persisted data exists
  // This ensures consistent behavior - always shows forecast curves instead of empty charts
  useEffect(() => {
    // Skip if missing required selections or already loading/generating/locked
    if (!selectedPlanId || !selectedScenarioId || selectedModels.size === 0) return;
    if (generateMutation.isPending || isLoading || generateLockRef.current) return;
    
    // Create a unique key for this plan+scenario combo to track auto-generation attempts
    const comboKey = `${selectedPlanId}:${selectedScenarioId}`;
    
    // Skip if we already attempted auto-generation for this combo
    if (autoGenerateAttemptedRef.current === comboKey) return;
    
    // Skip if we already have generated data for this combo
    if (queuedRuns?.runs && queuedRuns.runs.length > 0) return;
    
    // Check if we have persisted forecasts - if not, auto-generate
    const hasPersistedForecasts = forecasts && forecasts.length > 0;
    
    if (!hasPersistedForecasts) {
      // Mark this combo as attempted
      autoGenerateAttemptedRef.current = comboKey;
      
      // Auto-generate forecasts in the background without showing toast
      generateMutation.mutate({
        planVersionId: selectedPlanId,
        scenarioId: selectedScenarioId,
        models: Array.from(selectedModels) as ForecastModel[],
        periods: 12,
        persist: true,
      }, {
        onSuccess: () => {
          // Silently succeeded - refetch will populate the chart
          refetch();
        },
        onError: () => {
          // Silently fail - user can manually click Run Models
        }
      });
    }
  }, [selectedPlanId, selectedScenarioId, selectedModels, forecasts, queuedRuns, isLoading, generateMutation, refetch]);

  // Reset auto-generation tracking when plan or scenario changes
  useEffect(() => {
    const comboKey = `${selectedPlanId}:${selectedScenarioId}`;
    if (autoGenerateAttemptedRef.current !== comboKey) {
      autoGenerateAttemptedRef.current = null;
    }
  }, [selectedPlanId, selectedScenarioId]);

  // Chart data: use aggregated data from API (preferred) or fallback to local aggregation
  const chartData = useMemo(() => {
    let data: Array<Record<string, unknown>>;

    if (aggregatedChartData?.data && aggregatedChartData.data.length > 0) {
      data = [...aggregatedChartData.data];
    } else {
      type ChartRow = { period: string; sortDate: number } & Record<string, number | string>;
      const grouped = forecasts.reduce<ChartRow[]>((acc, forecast) => {
        const period = format(new Date(forecast.periodDate), 'MMM yyyy');
        let existing = acc.find((d) => d.period === period);
        if (!existing) {
          existing = { period, sortDate: new Date(forecast.periodDate).getTime() };
          acc.push(existing);
        }
        const forecastModel = forecast.forecastRun?.forecastModel || forecast.forecastModel;
        if (forecastModel) {
          const currentValue = typeof existing[forecastModel] === 'number' ? existing[forecastModel] as number : 0;
          existing[forecastModel] = currentValue + Number(forecast.forecastAmount);
          if (forecast.confidenceLower) {
            const currentLower = typeof existing[`${forecastModel}_lower`] === 'number' ? existing[`${forecastModel}_lower`] as number : 0;
            const currentUpper = typeof existing[`${forecastModel}_upper`] === 'number' ? existing[`${forecastModel}_upper`] as number : 0;
            existing[`${forecastModel}_lower`] = currentLower + Number(forecast.confidenceLower);
            existing[`${forecastModel}_upper`] = currentUpper + Number(forecast.confidenceUpper);
          }
        }
        return acc;
      }, []);
      data = grouped.sort((a, b) => a.sortDate - b.sortDate);
    }

    if (showActuals && actualsData && actualsData.length > 0) {
      const actualsMap = new Map<string, number>();
      for (const a of actualsData) {
        actualsMap.set(a.period, a.actual);
      }

      for (const a of actualsData) {
        const existing = data.find(d => d.period === a.period);
        if (existing) {
          existing.Actuals = a.actual;
        } else {
          data.push({ period: a.period, sortDate: new Date(a.sortDate).getTime(), Actuals: a.actual });
        }
      }

      for (const row of data) {
        if (actualsMap.has(row.period as string) && row.Actuals === undefined) {
          row.Actuals = actualsMap.get(row.period as string);
        }
      }

      data.sort((a, b) => (a.sortDate as number) - (b.sortDate as number));
    }

    return data;
  }, [aggregatedChartData, forecasts, showActuals, actualsData]);

  // Models that have data in the chart
  const availableModelsInChart = useMemo(() => {
    // Use models from API if available
    if (aggregatedChartData?.models && aggregatedChartData.models.length > 0) {
      return new Set<string>(aggregatedChartData.models);
    }
    
    // Fallback: derive from chartData
    if (!chartData.length) return new Set<string>();
    const modelSet = new Set<string>();
    chartData.forEach(d => {
      Object.keys(d).forEach(key => {
        if (key !== 'period' && key !== 'sortDate' && key !== 'periodLabel' && !key.endsWith('_lower') && !key.endsWith('_upper') && !key.endsWith('_count')) {
          modelSet.add(key);
        }
      });
    });
    return modelSet;
  }, [aggregatedChartData, chartData]);

  const toggleModel = (model: string) => {
    const newSet = new Set(selectedModels);
    if (newSet.has(model)) {
      newSet.delete(model);
    } else {
      newSet.add(model);
    }
    setSelectedModels(newSet);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Forecasts</h1>
          <p className="text-secondary-500 mt-1">
            Analyze and compare forecast models across plans
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="card p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1">
            <label className="label">Select Plan</label>
            <select
              value={selectedPlanId}
              onChange={(e) => {
                setSelectedPlanId(e.target.value);
                setSelectedScenarioId(''); // Reset scenario when plan changes
                setQueuedRuns(null);
              }}
              className="input"
            >
              <option value="">Select a plan...</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} (FY {plan.fiscalYear})
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="label">Select Scenario</label>
            <select
              value={selectedScenarioId}
              onChange={(e) => {
                setSelectedScenarioId(e.target.value);
                setQueuedRuns(null);
              }}
              className="input"
              disabled={!selectedPlanId || scenariosLoading || selectedPlanLoading}
            >
              <option value="">All scenarios</option>
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name} {scenario.isBaseline && '(Baseline)'} - {scenario.scenarioType}
                </option>
              ))}
            </select>
            {selectedPlanId && scenarios.length === 0 && !scenariosLoading && !selectedPlanLoading && (
              <p className="text-xs text-warning-600 mt-1">
                No scenarios found for this plan
              </p>
            )}
            {(scenariosLoading || selectedPlanLoading) && selectedPlanId && (
              <p className="text-xs text-secondary-500 mt-1">Loading scenarios...</p>
            )}
            {/* Show scenario adjustment preview */}
            {selectedScenarioId && (() => {
              const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);
              const adjustments: Record<string, { label: string; color: string }> = {
                BASE: { label: 'No adjustment (base forecast)', color: 'text-secondary-600' },
                OPTIMISTIC: { label: '+15% uplift applied', color: 'text-success-600' },
                PESSIMISTIC: { label: '-15% reduction applied', color: 'text-error-600' },
                STRETCH: { label: '+25% stretch target applied', color: 'text-success-700' },
                CONSERVATIVE: { label: '-8% conservative estimate applied', color: 'text-warning-600' },
                CUSTOM: { label: 'Custom scenario (no auto-adjustment)', color: 'text-primary-600' },
              };
              const adj = adjustments[selectedScenario?.scenarioType || 'BASE'];
              return (
                <p className={`text-xs mt-1 ${adj?.color || 'text-secondary-500'}`}>
                  ℹ️ {adj?.label}
                </p>
              );
            })()}
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={handleGenerateWithConfirm}
              disabled={!selectedPlanId || !selectedScenarioId || selectedModels.size === 0 || generateMutation.isPending}
              className={clsx(
                'btn-primary',
                generateMutation.isPending && 'opacity-70',
              )}
              title="Generate forecasts from historical data using selected models"
            >
              {generateMutation.isPending ? (
                <ArrowPathIcon className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <PlayIcon className="w-5 h-5 mr-2" />
              )}
              Run Models ({selectedModels.size})
            </button>
            <button
              onClick={handleRefresh}
              disabled={!selectedPlanId || isRefreshing}
              className={clsx(
                'btn-secondary',
                isRefreshing && 'opacity-70',
              )}
              title="Refresh forecast data"
            >
              <ArrowPathIcon className={clsx('w-5 h-5', isRefreshing && 'animate-spin')} />
            </button>
            <button
              onClick={() => handleExport('csv')}
              disabled={!selectedPlanId || !selectedScenarioId}
              className="btn-secondary"
              title="Export as CSV"
            >
              <ArrowDownTrayIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 mt-4">
          <div className="flex-1">
            <label className="label">Horizon (Periods)</label>
            <select
              value={forecastHorizon}
              onChange={(e) => setForecastHorizon(e.target.value)}
              className="input"
            >
              <option value="3">3 Periods</option>
              <option value="6">6 Periods</option>
              <option value="12">12 Periods</option>
              <option value="18">18 Periods</option>
              <option value="24">24 Periods</option>
              <option value="36">36 Periods</option>
            </select>
          </div>

          <div className="flex-1">
            <label className="label">Period Type</label>
            <select
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value)}
              className="input"
            >
              <option value="">Plan Default</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </div>

          <div className="flex-1">
            <label className="label">History Window</label>
            <input
              type="number"
              min={1}
              max={120}
              value={historyMonths}
              onChange={(e) => setHistoryMonths(e.target.value)}
              placeholder="Auto"
              className="input"
            />
          </div>

          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={isRolling}
                onChange={(e) => setIsRolling(e.target.checked)}
                className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm flex items-center gap-1">
                <ClockIcon className="w-4 h-4" />
                Rolling
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 mt-4">
          <div className="flex-1">
            <label className="label flex items-center gap-1">
              <CalendarIcon className="w-4 h-4" />
              Custom Start
            </label>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="input"
            />
          </div>
          <div className="flex-1">
            <label className="label flex items-center gap-1">
              <CalendarIcon className="w-4 h-4" />
              Custom End
            </label>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="input"
            />
          </div>
          <div className="flex-1">
            <label className="label flex items-center gap-1">
              <BookmarkIcon className="w-4 h-4" />
              Snapshot Label
            </label>
            <input
              type="text"
              value={snapshotLabel}
              onChange={(e) => setSnapshotLabel(e.target.value)}
              placeholder="e.g., Q2 Baseline"
              className="input"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setShowAdvancedControls(!showAdvancedControls)}
              className={clsx(
                'btn-secondary text-sm flex items-center gap-1',
                showAdvancedControls && 'ring-2 ring-primary-500'
              )}
            >
              <AdjustmentsHorizontalIcon className="w-4 h-4" />
              Advanced
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showAdvancedControls && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 p-4 bg-secondary-50 dark:bg-secondary-900/30 rounded-lg space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">Ensemble Weights (AI Hybrid components)</p>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {['MOVING_AVERAGE', 'LINEAR_REGRESSION', 'SEASONAL_NAIVE', 'HOLT_WINTERS'].map((model) => (
                      <div key={model}>
                        <label className="text-xs text-secondary-500">{model.replace(/_/g, ' ')}</label>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={ensembleWeights[model] || ''}
                          onChange={(e) => setEnsembleWeights(prev => ({ ...prev, [model]: e.target.value }))}
                          placeholder="Auto"
                          className="input text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">External Signals</p>
                    <button
                      onClick={() => setExternalSignals(prev => [...prev, { name: '', factor: '1.0', startDate: '', endDate: '' }])}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                    >
                      + Add Signal
                    </button>
                  </div>
                  {externalSignals.map((signal, idx) => (
                    <div key={idx} className="flex gap-2 mb-2">
                      <input
                        type="text"
                        value={signal.name}
                        onChange={(e) => {
                          const updated = [...externalSignals];
                          updated[idx] = { ...updated[idx], name: e.target.value };
                          setExternalSignals(updated);
                        }}
                        placeholder="Signal name"
                        className="input text-sm flex-1"
                      />
                      <input
                        type="number"
                        step={0.01}
                        value={signal.factor}
                        onChange={(e) => {
                          const updated = [...externalSignals];
                          updated[idx] = { ...updated[idx], factor: e.target.value };
                          setExternalSignals(updated);
                        }}
                        placeholder="Factor"
                        className="input text-sm w-24"
                      />
                      <input
                        type="date"
                        value={signal.startDate}
                        onChange={(e) => {
                          const updated = [...externalSignals];
                          updated[idx] = { ...updated[idx], startDate: e.target.value };
                          setExternalSignals(updated);
                        }}
                        className="input text-sm"
                      />
                      <input
                        type="date"
                        value={signal.endDate}
                        onChange={(e) => {
                          const updated = [...externalSignals];
                          updated[idx] = { ...updated[idx], endDate: e.target.value };
                          setExternalSignals(updated);
                        }}
                        className="input text-sm"
                      />
                      <button
                        onClick={() => setExternalSignals(prev => prev.filter((_, i) => i !== idx))}
                        className="text-error-500 hover:text-error-700 px-2"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Generation Status */}
      {queuedRuns && (
        <div className="card p-4 bg-success-50 dark:bg-success-900/20 border-success-200 dark:border-success-800">
          <div className="flex items-center gap-2 text-success-700 dark:text-success-300">
            <ChartBarIcon className="w-5 h-5" />
            <span className="font-medium">
              Queued {queuedRuns.runs.length} forecast run{queuedRuns.runs.length === 1 ? '' : 's'} for processing
            </span>
          </div>
        </div>
      )}

      {!selectedPlanId ? (
        <div className="card p-12 text-center">
          <ChartBarIcon className="w-16 h-16 text-secondary-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Select a Plan</h3>
          <p className="text-secondary-500">
            Choose a plan above to view and analyze its forecasts
          </p>
        </div>
      ) : isLoading || plansLoading ? (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card p-4 space-y-3">
                <div className="h-4 w-20 bg-secondary-200 dark:bg-secondary-700 rounded" />
                <div className="h-8 w-24 bg-secondary-200 dark:bg-secondary-700 rounded" />
                <div className="h-3 w-32 bg-secondary-200 dark:bg-secondary-700 rounded" />
              </div>
            ))}
          </div>
          <div className="card p-6 h-[400px] bg-secondary-100 dark:bg-secondary-800 rounded" />
        </div>
      ) : !selectedScenarioId ? (
        <div className="card p-12 text-center">
          <ChartBarIcon className="w-16 h-16 text-secondary-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Select a Scenario</h3>
          <p className="text-secondary-500">
            Choose a scenario to generate and view forecasts
          </p>
        </div>
      ) : chartData.length === 0 && !generateMutation.isPending ? (
        <div className="card p-12 text-center">
          <PlayIcon className="w-16 h-16 text-secondary-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Ready to Generate Forecasts</h3>
          <p className="text-secondary-500 mb-6">
            Select the models you want to use, then click "Run Models" to generate forecasts from historical data
          </p>
          <button
            onClick={handleGenerateForecasts}
            disabled={selectedModels.size === 0}
            className="btn-primary inline-flex"
          >
            <PlayIcon className="w-5 h-5 mr-2" />
            Run Models Now
          </button>
        </div>
      ) : generateMutation.isPending ? (
        <div className="card p-12 text-center">
          <ArrowPathIcon className="w-16 h-16 text-primary-500 mx-auto mb-4 animate-spin" />
          <h3 className="text-lg font-semibold mb-2">Generating Forecasts...</h3>
          <p className="text-secondary-500">
            Running {Array.from(selectedModels).join(', ')} models on historical data
          </p>
        </div>
      ) : (
        <>
          {/* Accuracy Metrics */}
          {accuracyData && (accuracyData.mape != null || accuracyData.rmse != null || accuracyData.mae != null || accuracyData.bias != null) && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="card p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-secondary-500">MAPE</p>
                  <InformationCircleIcon className="w-4 h-4 text-secondary-400" />
                </div>
                <p className="text-2xl font-bold mt-1">{(accuracyData.mape ?? 0).toFixed(2)}%</p>
                <p className="text-xs text-secondary-500">Mean Absolute % Error</p>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="card p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-secondary-500">RMSE</p>
                  <InformationCircleIcon className="w-4 h-4 text-secondary-400" />
                </div>
                <p className="text-2xl font-bold mt-1">
                  ${(accuracyData.rmse ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-secondary-500">Root Mean Square Error</p>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="card p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-secondary-500">MAE</p>
                  <InformationCircleIcon className="w-4 h-4 text-secondary-400" />
                </div>
                <p className="text-2xl font-bold mt-1">
                  ${(accuracyData.mae ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-secondary-500">Mean Absolute Error</p>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="card p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-secondary-500">Bias</p>
                  <InformationCircleIcon className="w-4 h-4 text-secondary-400" />
                </div>
                <p
                  className={clsx(
                    'text-2xl font-bold mt-1',
                    (accuracyData.bias ?? 0) > 0 ? 'text-success-600' : 'text-error-600',
                  )}
                >
                  {(accuracyData.bias ?? 0) > 0 ? '+' : ''}
                  {(accuracyData.bias ?? 0).toFixed(2)}%
                </p>
                <p className="text-xs text-secondary-500">Forecast Bias</p>
              </motion.div>
            </div>
          )}

          {/* ============================================================================
              ENHANCED FORECAST ANALYTICS UI (Additive - new functionality)
              ============================================================================ */}

          {/* Per-Model Accuracy Breakdown */}
          {enhancedAccuracyData && enhancedAccuracyData.byModel && enhancedAccuracyData.byModel.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="card p-4"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ChartBarIcon className="w-5 h-5 text-secondary-400" />
                  <h3 className="font-semibold">Per-Model Accuracy Breakdown</h3>
                </div>
                {enhancedAccuracyData.bestModel && (
                  <span className="badge badge-success">
                    Best: {enhancedAccuracyData.byModel.find(m => m.modelName === enhancedAccuracyData.bestModel)?.displayName}
                  </span>
                )}
              </div>

              {/* Info banner explaining N/A metrics */}
              {enhancedAccuracyData.byModel.every(m => m.mape === null) && (
                <div className="mb-4 p-3 bg-secondary-50 dark:bg-secondary-900/20 rounded-lg border border-secondary-200 dark:border-secondary-800">
                  <div className="flex items-start gap-2">
                    <InformationCircleIcon className="w-5 h-5 text-secondary-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-secondary-600 dark:text-secondary-400">
                      Accuracy metrics require sufficient historical data for cross-validation (at least 6 data points). 
                      Import more historical actuals to see model accuracy comparisons.
                    </p>
                  </div>
                </div>
              )}

              {/* Recommendation Banner */}
              {enhancedAccuracyData.recommendation && (
                <div className="mb-4 p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-200 dark:border-primary-800">
                  <div className="flex items-start gap-2">
                    <LightBulbIcon className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-primary-700 dark:text-primary-300">
                      {enhancedAccuracyData.recommendation}
                    </p>
                  </div>
                </div>
              )}

              {/* Accuracy Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-secondary-200 dark:border-secondary-700">
                      <th className="text-left py-2 px-3 font-medium text-secondary-600">Model</th>
                      <th className="text-center py-2 px-3 font-medium text-secondary-600">MAPE</th>
                      <th className="text-center py-2 px-3 font-medium text-secondary-600">Accuracy</th>
                      <th className="text-center py-2 px-3 font-medium text-secondary-600">MAE</th>
                      <th className="text-center py-2 px-3 font-medium text-secondary-600">Bias</th>
                      <th className="text-center py-2 px-3 font-medium text-secondary-600">Data Points</th>
                      <th className="text-center py-2 px-3 font-medium text-secondary-600">Primary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enhancedAccuracyData.byModel.map((model, index) => (
                      <tr 
                        key={`${model.modelName}-${index}`}
                        className={clsx(
                          'border-b border-secondary-100 dark:border-secondary-800',
                          index === 0 && 'bg-success-50/50 dark:bg-success-900/10',
                        )}
                      >
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: modelColors[model.modelName] }}
                            />
                            <span className="font-medium">{model.displayName}</span>
                            {index === 0 && (
                              <span className="text-xs text-success-600">★ Best</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <AccuracyBadge value={model.mape} type="mape" />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <AccuracyBadge value={model.accuracy} type="accuracy" />
                        </td>
                        <td className="py-2 px-3 text-center text-secondary-600">
                          {model.mae !== null ? `$${model.mae.toLocaleString()}` : 'N/A'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {model.bias !== null ? (
                            <span className={model.bias > 0 ? 'text-success-600' : 'text-error-600'}>
                              {model.bias > 0 ? '+' : ''}{model.bias.toFixed(1)}%
                            </span>
                          ) : 'N/A'}
                        </td>
                        <td className="py-2 px-3 text-center text-secondary-500">
                          {model.dataPoints}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => setPrimaryMutation.mutate({ modelName: model.modelName })}
                            disabled={setPrimaryMutation.isPending}
                            className={clsx(
                              'p-1 rounded hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors',
                              primaryForecastData?.primaryModel === model.modelName 
                                ? 'text-warning-500' 
                                : 'text-secondary-400 hover:text-warning-500'
                            )}
                            title={primaryForecastData?.primaryModel === model.modelName 
                              ? 'Primary forecast model' 
                              : 'Set as primary forecast'}
                          >
                            {primaryForecastData?.primaryModel === model.modelName ? (
                              <StarIconSolid className="w-5 h-5" />
                            ) : (
                              <StarIcon className="w-5 h-5" />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {alertsData && alertsData.length > 0 && showAlerts && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2"
            >
              {alertsData.map((alert, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    'p-3 rounded-lg border flex items-center gap-2',
                    alert.level === 'critical' && 'bg-error-50 border-error-200 text-error-700 dark:bg-error-900/20 dark:border-error-800 dark:text-error-300',
                    alert.level === 'warning' && 'bg-warning-50 border-warning-200 text-warning-700 dark:bg-warning-900/20 dark:border-warning-800 dark:text-warning-300',
                    alert.level === 'info' && 'bg-primary-50 border-primary-200 text-primary-700 dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-300',
                  )}
                >
                  <BellAlertIcon className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">{alert.message}</span>
                  <AccuracyBadge value={alert.mape} type="mape" />
                </div>
              ))}
            </motion.div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowActuals(!showActuals)}
              className={clsx(
                'btn-secondary text-sm flex items-center gap-2',
                showActuals && 'ring-2 ring-primary-500'
              )}
            >
              <ChartBarIcon className="w-4 h-4" />
              {showActuals ? 'Hide' : 'Show'} Actuals
            </button>
            <button
              onClick={() => setShowConfidenceBands(!showConfidenceBands)}
              className={clsx(
                'btn-secondary text-sm flex items-center gap-2',
                showConfidenceBands && 'ring-2 ring-primary-500'
              )}
            >
              {showConfidenceBands ? (
                <EyeSlashIcon className="w-4 h-4" />
              ) : (
                <EyeIcon className="w-4 h-4" />
              )}
              {showConfidenceBands ? 'Hide' : 'Show'} Confidence Bands
            </button>
            <button
              onClick={() => {
                setShowBacktestView(!showBacktestView);
                if (!showBacktestView && !backtestData) {
                  refetchBacktest();
                }
              }}
              className={clsx(
                'btn-secondary text-sm flex items-center gap-2',
                showBacktestView && 'ring-2 ring-primary-500'
              )}
            >
              <ArrowPathIcon className={clsx('w-4 h-4', backtestLoading && 'animate-spin')} />
              {showBacktestView ? 'Hide' : 'Show'} Backtest View
            </button>
            <button
              onClick={() => setShowModelExplainability(!showModelExplainability)}
              className={clsx(
                'btn-secondary text-sm flex items-center gap-2',
                showModelExplainability && 'ring-2 ring-primary-500'
              )}
            >
              <LightBulbIcon className="w-4 h-4" />
              {showModelExplainability ? 'Hide' : 'Show'} Model Info
            </button>
            <button
              onClick={() => { setShowVersions(!showVersions); if (!showVersions) refetchVersions(); }}
              className={clsx(
                'btn-secondary text-sm flex items-center gap-2',
                showVersions && 'ring-2 ring-primary-500'
              )}
            >
              <ClockIcon className="w-4 h-4" />
              Versions
            </button>
            <button
              onClick={() => setShowDimensionBreakdown(!showDimensionBreakdown)}
              className={clsx(
                'btn-secondary text-sm flex items-center gap-2',
                showDimensionBreakdown && 'ring-2 ring-primary-500'
              )}
            >
              <FunnelIcon className="w-4 h-4" />
              Dimensions
            </button>
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className={clsx(
                'btn-secondary text-sm flex items-center gap-2',
                showAlerts && 'ring-2 ring-primary-500'
              )}
            >
              <BellAlertIcon className="w-4 h-4" />
              Alerts
            </button>
            {showAlerts && (
              <select
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(Number(e.target.value))}
                className="input text-sm w-28"
                title="Alert threshold (MAPE %)"
              >
                <option value={10}>{'>'} 10%</option>
                <option value={15}>{'>'} 15%</option>
                <option value={25}>{'>'} 25%</option>
                <option value={50}>{'>'} 50%</option>
              </select>
            )}
            <button
              onClick={() => snapshotMutation.mutate({ label: snapshotLabel || `Snapshot ${format(new Date(), 'yyyy-MM-dd HH:mm')}` })}
              disabled={!selectedPlanId || !selectedScenarioId || snapshotMutation.isPending}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <BookmarkIcon className="w-4 h-4" />
              Snapshot
            </button>
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setExportMenuOpen(prev => !prev)}
                aria-haspopup="true"
                aria-expanded={exportMenuOpen}
                className="btn-secondary text-sm flex items-center gap-2"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setExportMenuOpen(false);
                }}
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
                Export
                <ChevronDownIcon className="w-3 h-3" />
              </button>
              {exportMenuOpen && (
                <div
                  role="menu"
                  className="absolute top-full left-0 mt-1 bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg shadow-lg z-10 min-w-[120px]"
                >
                  <button
                    role="menuitem"
                    onClick={() => { handleExport('csv'); setExportMenuOpen(false); }}
                    onKeyDown={(e) => { if (e.key === 'Escape') setExportMenuOpen(false); }}
                    className="block w-full text-left px-4 py-2 text-sm hover:bg-secondary-50 dark:hover:bg-secondary-700 rounded-t-lg"
                  >
                    Export as CSV
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { handleExport('json'); setExportMenuOpen(false); }}
                    onKeyDown={(e) => { if (e.key === 'Escape') setExportMenuOpen(false); }}
                    className="block w-full text-left px-4 py-2 text-sm hover:bg-secondary-50 dark:hover:bg-secondary-700 rounded-b-lg"
                  >
                    Export as JSON
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Backtest Results Panel */}
          <AnimatePresence>
            {showBacktestView && backtestData && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="card p-4 overflow-hidden"
              >
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold flex items-center gap-2">
                      <ArrowPathIcon className="w-5 h-5 text-secondary-400" />
                      Historical Backtest Results
                    </h3>
                    <p className="text-xs text-secondary-500 mt-1">
                      Training: {backtestData.trainingRange.start} to {backtestData.trainingRange.end} | 
                      Holdout: {backtestData.holdoutRange.start} to {backtestData.holdoutRange.end}
                    </p>
                  </div>
                  {backtestData.bestModel && (
                    <span className="badge badge-primary">
                      Best in Backtest: {backtestData.results.find(r => r.modelName === backtestData.bestModel)?.displayName}
                    </span>
                  )}
                </div>

                {/* Backtest Chart */}
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={backtestData.results?.[0]?.data ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="periodLabel" stroke="#94a3b8" fontSize={11} />
                    <YAxis 
                      stroke="#94a3b8" 
                      fontSize={11}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#f8fafc',
                        fontSize: '12px',
                      }}
                      formatter={(value: number, name: string) => [
                        `$${value.toLocaleString()}`,
                        name
                      ]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      stroke="#10b981"
                      strokeWidth={3}
                      dot={{ fill: '#10b981', strokeWidth: 2 }}
                      name="Actual"
                    />
                    {(backtestData.results ?? []).slice(0, 4).map((result) => (
                      <Line
                        key={result.modelName}
                        type="monotone"
                        dataKey="forecast"
                        data={result.data}
                        stroke={modelColors[result.modelName] || '#888888'}
                        strokeWidth={1.5}
                        strokeDasharray="5 5"
                        dot={{ fill: modelColors[result.modelName] || '#888888', r: 3 }}
                        name={result.displayName}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>

                {/* Backtest Metrics Table */}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-secondary-200 dark:border-secondary-700">
                        <th className="text-left py-2 px-2 font-medium text-secondary-600">Model</th>
                        <th className="text-center py-2 px-2 font-medium text-secondary-600">Backtest MAPE</th>
                        <th className="text-center py-2 px-2 font-medium text-secondary-600">Backtest MAE</th>
                        <th className="text-center py-2 px-2 font-medium text-secondary-600">Bias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtestData.results.map((result, index) => (
                        <tr 
                          key={`${result.modelName}-${index}`}
                          className={clsx(
                            'border-b border-secondary-100 dark:border-secondary-800',
                            index === 0 && 'bg-primary-50/50 dark:bg-primary-900/10',
                          )}
                        >
                          <td className="py-2 px-2 font-medium">{result.displayName}</td>
                          <td className="py-2 px-2 text-center">
                            <AccuracyBadge value={result.metrics.mape} type="mape" />
                          </td>
                          <td className="py-2 px-2 text-center text-secondary-600">
                            {result.metrics.mae !== null ? `$${result.metrics.mae.toLocaleString()}` : 'N/A'}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {result.metrics.bias !== null ? (
                              <span className={result.metrics.bias > 0 ? 'text-success-600' : 'text-error-600'}>
                                {result.metrics.bias > 0 ? '+' : ''}{result.metrics.bias.toFixed(1)}%
                              </span>
                            ) : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Model Explainability Panel */}
          <AnimatePresence>
            {showModelExplainability && modelExplainability && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="card p-4 overflow-hidden"
              >
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <LightBulbIcon className="w-5 h-5 text-secondary-400" />
                  Model Explainability
                </h3>
                <div className="space-y-2">
                  {modelExplainability.map((model) => (
                    <div
                      key={model.name}
                      className="border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden"
                    >
                      <button
                        onClick={() => setExpandedExplainModel(
                          expandedExplainModel === model.name ? null : model.name
                        )}
                        className="w-full p-3 flex items-center justify-between hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: modelColors[model.name] }}
                          />
                          <span className="font-medium">{model.displayName}</span>
                          <span className={clsx(
                            'text-xs px-2 py-0.5 rounded-full',
                            model.interpretability === 'high' && 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
                            model.interpretability === 'medium' && 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
                            model.interpretability === 'low' && 'bg-secondary-100 text-secondary-700 dark:bg-secondary-900/30 dark:text-secondary-400',
                          )}>
                            {model.interpretability} interpretability
                          </span>
                        </div>
                        {expandedExplainModel === model.name ? (
                          <ChevronUpIcon className="w-5 h-5 text-secondary-400" />
                        ) : (
                          <ChevronDownIcon className="w-5 h-5 text-secondary-400" />
                        )}
                      </button>
                      <AnimatePresence>
                        {expandedExplainModel === model.name && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-4 pt-0 space-y-3 text-sm">
                              <div>
                                <p className="font-medium text-secondary-600 mb-1">How it works:</p>
                                <p className="text-secondary-500">{model.methodology}</p>
                              </div>
                              <div>
                                <p className="font-medium text-secondary-600 mb-1">Best for:</p>
                                <div className="flex flex-wrap gap-1">
                                  {model.bestFor.map((use, i) => (
                                    <span key={i} className="badge badge-success text-xs">{use}</span>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="font-medium text-secondary-600 mb-1">Limitations:</p>
                                <div className="flex flex-wrap gap-1">
                                  {model.limitations.map((lim, i) => (
                                    <span key={i} className="badge badge-secondary text-xs">{lim}</span>
                                  ))}
                                </div>
                              </div>
                              <div className="flex gap-4 text-xs text-secondary-500">
                                <span>Min data points: {model.minDataPoints}</span>
                                {model.supportsSeasonality && (
                                  <span className="text-primary-600">✓ Supports seasonality</span>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showVersions && versionsData && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="card p-4 overflow-hidden"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <ClockIcon className="w-5 h-5 text-secondary-400" />
                    Forecast Versions
                  </h3>
                  <p className="text-xs text-secondary-500">Select 2+ to compare</p>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {versionsData.map((version) => (
                    <label key={version.id} className="flex items-center gap-3 p-2 rounded hover:bg-secondary-50 dark:hover:bg-secondary-800/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedVersionIds.includes(version.id)}
                        onChange={(e) => {
                          setSelectedVersionIds(prev =>
                            e.target.checked
                              ? [...prev, version.id]
                              : prev.filter(id => id !== version.id)
                          );
                        }}
                        className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                      />
                      <div className="flex-1 flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: modelColors[version.model] }}
                        />
                        <span className="text-sm font-medium">{version.model.replace(/_/g, ' ')}</span>
                        {version.snapshotLabel && (
                          <span className="badge badge-primary text-xs">{version.snapshotLabel}</span>
                        )}
                      </div>
                      <span className="text-xs text-secondary-500">{version.resultCount} results</span>
                      <span className="text-xs text-secondary-400">{format(new Date(version.createdAt), 'MMM dd HH:mm')}</span>
                    </label>
                  ))}
                </div>
                {versionComparisonData && selectedVersionIds.length >= 2 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium mb-2">Version Comparison</h4>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={versionComparisonData.periods}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="period" stroke="#94a3b8" fontSize={10} />
                        <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc', fontSize: '11px' }}
                          formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name]}
                        />
                        <Legend />
                        {versionComparisonData.runs.map((run, i) => (
                          <Line
                            key={run.id}
                            type="monotone"
                            dataKey={run.id}
                            stroke={Object.values(modelColors)[i % Object.values(modelColors).length]}
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            name={`${run.model.replace(/_/g, ' ')}${run.snapshotLabel ? ` (${run.snapshotLabel})` : ''}`}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showDimensionBreakdown && dimensionData && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="card p-4 overflow-hidden"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <FunnelIcon className="w-5 h-5 text-secondary-400" />
                    Dimension Breakdown
                  </h3>
                  <select
                    value={dimensionType}
                    onChange={(e) => setDimensionType(e.target.value as 'product' | 'location' | 'customer')}
                    className="input text-sm w-40"
                  >
                    <option value="product">By Product</option>
                    <option value="location">By Location</option>
                    <option value="customer">By Customer</option>
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-secondary-200 dark:border-secondary-700">
                        <th className="text-left py-2 px-3 font-medium text-secondary-600">{dimensionType.charAt(0).toUpperCase() + dimensionType.slice(1)}</th>
                        <th className="text-right py-2 px-3 font-medium text-secondary-600">Total Forecast</th>
                        <th className="text-right py-2 px-3 font-medium text-secondary-600">% of Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const items = Array.isArray(dimensionData) ? dimensionData : (dimensionData as any)?.items || [];
                        const grandTotal = items.reduce((sum: number, d: any) => sum + (d.totalAmount ?? d.total ?? 0), 0);
                        return items.slice(0, 20).map((dim: any, idx: number) => (
                          <tr key={dim.id || dim.dimensionId || idx} className="border-b border-secondary-100 dark:border-secondary-800">
                            <td className="py-2 px-3">{dim.name || dim.dimensionName || 'Unknown'}</td>
                            <td className="py-2 px-3 text-right font-medium">${(dim.totalAmount ?? dim.total ?? 0).toLocaleString()}</td>
                            <td className="py-2 px-3 text-right text-secondary-500">
                              {grandTotal > 0 ? (((dim.totalAmount ?? dim.total ?? 0) / grandTotal) * 100).toFixed(1) : 0}%
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Model Selection */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FunnelIcon className="w-5 h-5 text-secondary-400" />
                <span className="font-medium">Select Models to Run</span>
                <span className="text-sm text-secondary-500">
                  ({selectedModels.size} selected)
                </span>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={handleSelectAllModels}
                  className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  Select All
                </button>
                <span className="text-secondary-300">|</span>
                <button 
                  onClick={handleClearModels}
                  className="text-xs text-secondary-500 hover:text-secondary-700 font-medium"
                >
                  Clear
                </button>
              </div>
            </div>
            <p className="text-xs text-secondary-500 mb-3">
              Click models below to select them, then click "Run Models" to generate forecasts from historical data.
              <br />
              <span className="text-warning-600">Note: Holt-Winters requires 24+ data points per dimension. Moving Average works with fewer points.</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {models?.map((model) => {
                const hasData = availableModelsInChart.has(model.name);
                return (
                  <button
                    key={model.name}
                    onClick={() => toggleModel(model.name)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border-2 relative',
                      selectedModels.has(model.name)
                        ? 'border-transparent'
                        : 'border-secondary-200 bg-transparent text-secondary-500 hover:border-secondary-300',
                    )}
                    style={
                      selectedModels.has(model.name)
                        ? {
                            backgroundColor: `${modelColors[model.name]}20`,
                            color: modelColors[model.name],
                            borderColor: modelColors[model.name],
                          }
                        : undefined
                    }
                  >
                    {model.displayName}
                    {hasData && (
                      <span className="ml-1 inline-flex items-center justify-center w-2 h-2 rounded-full bg-success-500" title="Has data in chart" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold">Forecast Comparison</h3>
                {showConfidenceBands && (
                  <span className="text-xs badge badge-primary">Confidence Bands Enabled</span>
                )}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" stroke="#94a3b8" fontSize={12} />
                <YAxis 
                  stroke="#94a3b8" 
                  fontSize={12}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#f8fafc',
                  }}
                  formatter={(value: number, name: string) => [
                    `$${value.toLocaleString()}`,
                    name.replace(/_/g, ' ').replace(' lower', ' (Lower)').replace(' upper', ' (Upper)')
                  ]}
                />
                <Legend />
                {/* Confidence Bands (rendered first so they appear behind lines) */}
                {showConfidenceBands && Array.from(availableModelsInChart).map((model) => {
                  if (!selectedModels.has(model)) return null;
                  const hasConfidenceBands = chartData.some(d => d[`${model}_lower`] != null && d[`${model}_upper`] != null);
                  if (!hasConfidenceBands) return null;
                  return (
                    <Area
                      key={`${model}_band`}
                      type="monotone"
                      dataKey={`${model}_upper`}
                      stroke="none"
                      fill={modelColors[model] || '#888888'}
                      fillOpacity={0.1}
                      name={`${model.replace(/_/g, ' ')} (Upper)`}
                      connectNulls
                    />
                  );
                })}
                {showConfidenceBands && Array.from(availableModelsInChart).map((model) => {
                  if (!selectedModels.has(model)) return null;
                  const hasConfidenceBands = chartData.some(d => d[`${model}_lower`] != null);
                  if (!hasConfidenceBands) return null;
                  return (
                    <Area
                      key={`${model}_lower`}
                      type="monotone"
                      dataKey={`${model}_lower`}
                      stroke="none"
                      fill="white"
                      fillOpacity={1}
                      name={`${model.replace(/_/g, ' ')} (Lower)`}
                      legendType="none"
                      connectNulls
                    />
                  );
                })}
                {/* Main forecast lines */}
                {Array.from(availableModelsInChart).map((model) => {
                  if (!selectedModels.has(model)) return null;
                  const isPrimary = primaryForecastData?.primaryModel === model;
                  return (
                    <Line
                      key={model}
                      type="monotone"
                      dataKey={model}
                      stroke={modelColors[model] || '#888888'}
                      strokeWidth={isPrimary ? 3 : 2}
                      strokeDasharray={isPrimary ? undefined : undefined}
                      dot={{ 
                        fill: modelColors[model] || '#888888', 
                        strokeWidth: isPrimary ? 3 : 2,
                        r: isPrimary ? 5 : 4,
                      }}
                      name={`${model.replace(/_/g, ' ')}${isPrimary ? ' ★' : ''}`}
                      connectNulls
                    />
                  );
                })}
                {showActuals && chartData.some(d => d.Actuals != null) && (
                  <Line
                    type="monotone"
                    dataKey="Actuals"
                    stroke="#10b981"
                    strokeWidth={3}
                    strokeDasharray="8 4"
                    dot={{ fill: '#10b981', strokeWidth: 2, r: 5 }}
                    name="Actuals"
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            {availableModelsInChart.size === 0 && (
              <div className="text-center py-8 text-secondary-500">
                <p>No forecast data to display. Click "Run Models" to generate forecasts.</p>
              </div>
            )}
          </motion.div>

          {/* Confirmation Dialog for Expensive Operations */}
          {showConfirmGenerate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfirmGenerate(false)}>
              <div className="bg-white dark:bg-secondary-800 rounded-xl shadow-xl p-6 max-w-md mx-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold mb-2">Run {selectedModels.size} Models?</h3>
                <p className="text-sm text-secondary-500 mb-4">
                  You are about to run {selectedModels.size} forecast models across {forecastHorizon} periods.
                  This may take a moment to process.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowConfirmGenerate(false)}
                    className="btn-secondary text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { setShowConfirmGenerate(false); handleGenerateForecasts(); }}
                    className="btn-primary text-sm"
                  >
                    Run Models
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Model Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {models
              ?.filter((m) => selectedModels.has(m.name))
              .map((model, index) => {
                const hasData = availableModelsInChart.has(model.name);
                return (
                  <motion.div
                    key={model.name}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={clsx('card p-4', !hasData && 'opacity-60')}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: modelColors[model.name] }}
                      />
                      <h4 className="font-semibold">{model.displayName}</h4>
                      {hasData ? (
                        <span className="badge badge-success text-xs">Active</span>
                      ) : (
                        <span className="badge badge-secondary text-xs">Not Run</span>
                      )}
                    </div>
                    <p className="text-sm text-secondary-500 mb-3">{model.description}</p>
                    <div className="flex items-center gap-4 text-xs text-secondary-500">
                      <span>Min data: {model.minDataPoints} points</span>
                      {model.supportsSeasonality && (
                        <span className="badge badge-primary">Seasonal</span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}
