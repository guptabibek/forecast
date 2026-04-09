import type { Forecast, ForecastModel, Scenario, ScenarioType } from '@/types';
import { Dialog, Listbox, Tab, Transition } from '@headlessui/react';
import {
    ArrowDownTrayIcon,
    ArrowLeftIcon,
    ArrowPathIcon,
    ChartBarIcon,
    CheckIcon,
    ChevronUpDownIcon,
    Cog6ToothIcon,
    ExclamationTriangleIcon,
    LockClosedIcon,
    LockOpenIcon,
    PaperAirplaneIcon,
    PlayIcon,
    PlusIcon,
    TableCellsIcon
} from '@heroicons/react/24/outline';
import { forecastService, planService, scenarioService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { format } from 'date-fns';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

const modelColors: Record<ForecastModel, string> = {
  MOVING_AVERAGE: '#3b82f6',
  WEIGHTED_AVERAGE: '#8b5cf6',
  LINEAR_REGRESSION: '#ec4899',
  HOLT_WINTERS: '#f59e0b',
  SEASONAL_NAIVE: '#10b981',
  YOY_GROWTH: '#06b6d4',
  TREND_PERCENT: '#6366f1',
  AI_HYBRID: '#ef4444',
  ARIMA: '#a855f7',
  PROPHET: '#14b8a6',
  MANUAL: '#64748b',
};

const scenarioTypeOptions = [
  { value: 'BASE', label: 'Base Case', description: 'Primary planning scenario' },
  { value: 'OPTIMISTIC', label: 'Optimistic', description: 'Optimistic assumptions' },
  { value: 'PESSIMISTIC', label: 'Pessimistic', description: 'Conservative assumptions' },
  { value: 'STRETCH', label: 'Stretch', description: 'Ambitious growth targets' },
  { value: 'CONSERVATIVE', label: 'Conservative', description: 'Risk-averse assumptions' },
  { value: 'CUSTOM', label: 'Custom', description: 'Custom scenario' },
];

export default function PlanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const getErrorMessage = useCallback((error: unknown, fallback: string) => {
    if (error && typeof error === 'object') {
      const maybeResponse = error as { response?: { data?: { message?: string } } };
      return maybeResponse.response?.data?.message || fallback;
    }
    return fallback;
  }, []);
  const queryClient = useQueryClient();
  const [selectedModel, setSelectedModel] = useState<ForecastModel>('AI_HYBRID');
  const [forecastPeriods, setForecastPeriods] = useState(12);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreateScenarioModalOpen, setIsCreateScenarioModalOpen] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [newScenarioType, setNewScenarioType] = useState<ScenarioType>('CUSTOM');

  // Plan settings edit state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');

  // Fetch plan details - this now includes scenarios, forecasts, and assumptions
  const { data: plan, isLoading: planLoading, error: planError, refetch: refetchPlan } = useQuery({
    queryKey: ['plan', id],
    queryFn: () => planService.getById(id!),
    enabled: !!id,
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true,
  });

  // Fallback: Fetch scenarios separately if not included in plan
  const { data: scenariosFromApi, isLoading: scenariosLoading, refetch: refetchScenarios } = useQuery({
    queryKey: ['scenarios', id],
    queryFn: () => scenarioService.getAll({ planVersionId: id! }),
    enabled: !!id,
    staleTime: 0,
  });

  // Derive scenarios - MERGE both sources and deduplicate by ID
  // This ensures we show ALL scenarios for the plan, whether from plan object or API
  const scenarios: Scenario[] = useMemo(() => {
    const scenarioMap = new Map<string, Scenario>();
    
    // First add scenarios from plan object (if any)
    if (plan?.scenarios && Array.isArray(plan.scenarios)) {
      plan.scenarios.forEach((s: Scenario) => {
        scenarioMap.set(s.id, s);
      });
    }
    
    // Then add/update with scenarios from dedicated API (these may be more up-to-date)
    if (scenariosFromApi && Array.isArray(scenariosFromApi)) {
      scenariosFromApi.forEach((s: Scenario) => {
        scenarioMap.set(s.id, s);
      });
    }
    
    const mergedScenarios = Array.from(scenarioMap.values());
    
    // Sort: baseline first, then by creation date or name
    mergedScenarios.sort((a, b) => {
      if (a.isBaseline && !b.isBaseline) return -1;
      if (!a.isBaseline && b.isBaseline) return 1;
      return a.name.localeCompare(b.name);
    });
    
    return mergedScenarios;
  }, [plan?.scenarios, scenariosFromApi]);

  // Combined loading state for scenarios
  const isScenariosLoading = planLoading || (scenariosLoading && scenarios.length === 0);

  // Derive forecasts from plan data (now included in plan response)  
  const forecasts: Forecast[] = useMemo(() => {
    if (!plan?.forecasts) return [];
    return plan.forecasts;
  }, [plan?.forecasts]);

  // Initialize selected scenario once scenarios are loaded
  useEffect(() => {
    if (scenarios.length > 0 && !isInitialized) {
      // Prefer baseline scenario, otherwise first scenario
      const baselineScenario = scenarios.find(s => s.isBaseline);
      const defaultScenario = baselineScenario || scenarios[0];
      if (defaultScenario) {
        setSelectedScenarioId(defaultScenario.id);
        setIsInitialized(true);
      }
    }
  }, [scenarios, isInitialized]);

  // Reset initialization when plan ID changes
  useEffect(() => {
    setIsInitialized(false);
    setSelectedScenarioId('');
  }, [id]);

  // Sync plan settings into edit state
  useEffect(() => {
    if (plan) {
      setEditName(plan.name || '');
      setEditDescription(plan.description || '');
      setEditStartDate(plan.startDate ? plan.startDate.split('T')[0] : '');
      setEditEndDate(plan.endDate ? plan.endDate.split('T')[0] : '');
    }
  }, [plan]);

  // Handle manual refresh with toast feedback
  const handleRefresh = useCallback(async () => {
    if (!id) return;
    
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plan', id] }),
        queryClient.invalidateQueries({ queryKey: ['scenarios', id] }),
      ]);
      await Promise.all([refetchPlan(), refetchScenarios()]);
      toast.success('Data refreshed successfully');
    } catch {
      toast.error('Failed to refresh data');
    } finally {
      setIsRefreshing(false);
    }
  }, [id, queryClient, refetchPlan, refetchScenarios]);

  // Fetch available models
  const { data: models } = useQuery({
    queryKey: ['forecast-models'],
    queryFn: forecastService.getModels,
  });

  // Generate forecast mutation - uses the generate method which runs models on historical Actuals data
  const generateMutation = useMutation({
    mutationFn: async (params: { planVersionId: string; scenarioId: string; model: ForecastModel; periods: number }) => {
      // Generate forecasts using historical Actuals data and persist to database
      return forecastService.generate({
        planVersionId: params.planVersionId,
        scenarioId: params.scenarioId,
        models: [params.model], // Array of models to run
        periods: params.periods,
        persist: true, // Save generated forecasts to database
      });
    },
    onSuccess: (data) => {
      // Refetch plan to get updated forecasts (now available synchronously)
      refetchPlan();
      const completed = data.runs.filter(r => r.status === 'completed');
      const total = completed.reduce((sum, r) => sum + r.resultCount, 0);
      toast.success(`Generated ${total} forecast results`);
    },
    onError: (error: unknown) => {
      const message = getErrorMessage(error, 'Failed to generate forecast');
      // Provide helpful message if insufficient historical data
      if (message.includes('Insufficient historical data')) {
        toast.error('Not enough historical sales data. Please import at least 6 months of Actuals data first.');
      } else {
        toast.error(message);
      }
    },
  });

  // Create scenario mutation
  const createScenarioMutation = useMutation({
    mutationFn: (data: { name: string; scenarioType: ScenarioType }) => scenarioService.create({
      name: data.name,
      planVersionId: id!,
      scenarioType: data.scenarioType,
    }),
    onSuccess: (newScenario) => {
      // Refetch both plan and scenarios to ensure we have all data
      queryClient.invalidateQueries({ queryKey: ['scenarios', id] });
      refetchPlan();
      refetchScenarios();
      setSelectedScenarioId(newScenario.id);
      setIsCreateScenarioModalOpen(false);
      setNewScenarioName('');
      setNewScenarioType('CUSTOM');
      toast.success('Scenario created');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to create scenario'));
    },
  });

  // Handle creating new scenario from modal
  const handleCreateScenario = () => {
    if (!newScenarioName.trim()) {
      toast.error('Please enter a scenario name');
      return;
    }
    createScenarioMutation.mutate({ name: newScenarioName.trim(), scenarioType: newScenarioType });
  };

  // Submit for review mutation
  const submitMutation = useMutation({
    mutationFn: () => planService.submitForReview(id!),
    onSuccess: () => {
      refetchPlan();
      toast.success('Plan submitted for review');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to submit plan'));
    },
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: () => planService.approve(id!),
    onSuccess: () => {
      refetchPlan();
      toast.success('Plan approved');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to approve plan'));
    },
  });

  // Lock/unlock mutation
  const lockMutation = useMutation({
    mutationFn: async (lock: boolean) => {
      if (lock) {
        return planService.lock(id!, 'Locked by user');
      } else {
        return planService.unlock(id!);
      }
    },
    onSuccess: (_data, lock) => {
      refetchPlan();
      setSelectedRows(new Set());
      toast.success(lock ? 'Plan locked' : 'Plan unlocked');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to update plan lock status'));
    },
  });

  // Update plan settings mutation
  const updatePlanMutation = useMutation({
    mutationFn: () =>
      planService.update(id!, {
        name: editName,
        description: editDescription,
        startDate: editStartDate,
        endDate: editEndDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      toast.success('Plan settings saved');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to save plan settings'));
    },
  });

  // Export plan handler
  const handleExport = useCallback(async () => {
    if (!id) return;
    try {
      const blob = await planService.export(id, 'csv');
      const url = window.URL.createObjectURL(new Blob([blob as unknown as BlobPart]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `plan-${plan?.name || id}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Plan exported successfully');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to export plan'));
    }
  }, [id, plan?.name, getErrorMessage]);

  // Memoized handler for generating forecasts with validation
  const handleGenerateForecast = useCallback(() => {
    if (!id) {
      toast.error('Plan ID is missing');
      return;
    }
    
    if (!selectedScenarioId) {
      toast.error('Please select a scenario first');
      return;
    }

    // Validate scenario exists in the list
    const scenarioExists = scenarios.some(s => s.id === selectedScenarioId);
    if (!scenarioExists) {
      toast.error('Selected scenario is invalid. Please select a valid scenario.');
      setSelectedScenarioId(scenarios[0]?.id || '');
      return;
    }
    
    generateMutation.mutate({
      planVersionId: id,
      scenarioId: selectedScenarioId,
      model: selectedModel,
      periods: forecastPeriods,
    });
  }, [id, selectedScenarioId, scenarios, selectedModel, forecastPeriods, generateMutation]);

  // Transform data for chart - memoized to prevent unnecessary recalculation
  // Filter by selected scenario so the chart only shows forecasts for the active scenario
  const chartData = useMemo(() => {
    if (!forecasts || forecasts.length === 0) return [];

    const scenarioForecasts = selectedScenarioId
      ? forecasts.filter((f) => f.scenarioId === selectedScenarioId)
      : forecasts;

    if (scenarioForecasts.length === 0) return [];
    
    type ChartRow = { period: string } & Record<string, number | null | string>;
    return scenarioForecasts.reduce<ChartRow[]>((acc, forecast) => {
      const period = format(new Date(forecast.periodDate), 'MMM yyyy');
      let existing = acc.find((d) => d.period === period);
      if (!existing) {
        existing = { period };
        acc.push(existing);
      }
      const model = forecast.forecastModel ?? 'UNKNOWN';
      existing[model] = Number(forecast.forecastAmount);
      existing[`${model}_lower`] = forecast.confidenceLower ? Number(forecast.confidenceLower) : null;
      existing[`${model}_upper`] = forecast.confidenceUpper ? Number(forecast.confidenceUpper) : null;
      return acc;
    }, []);
  }, [forecasts, selectedScenarioId]);

  // Loading state
  if (planLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
      </div>
    );
  }

  // Error state
  if (planError) {
    return (
      <div className="text-center py-12">
        <ExclamationTriangleIcon className="w-12 h-12 text-error-500 mx-auto mb-4" />
        <p className="text-error-500 mb-2">Failed to load plan</p>
        <p className="text-secondary-500 text-sm mb-4">
          {getErrorMessage(planError, 'An unexpected error occurred')}
        </p>
        <div className="flex gap-2 justify-center">
          <button onClick={() => refetchPlan()} className="btn-secondary">
            Retry
          </button>
          <Link to="/plans" className="btn-primary">
            Back to Plans
          </Link>
        </div>
      </div>
    );
  }

  // Not found state
  if (!plan) {
    return (
      <div className="text-center py-12">
        <p className="text-secondary-500">Plan not found</p>
        <Link to="/plans" className="btn-primary mt-4">
          Back to Plans
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/plans')}
            className="flex items-center gap-2 text-secondary-500 hover:text-secondary-700 mb-2"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to Plans
          </button>
          <h1 className="text-2xl font-bold">{plan.name}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span
              className={clsx(
                'px-2.5 py-0.5 rounded-full text-xs font-medium',
                plan.status === 'DRAFT' && 'bg-secondary-100 text-secondary-700',
                plan.status === 'IN_REVIEW' && 'bg-warning-50 text-warning-600',
                plan.status === 'APPROVED' && 'bg-success-50 text-success-600',
                plan.status === 'ARCHIVED' && 'bg-secondary-100 text-secondary-500',
              )}
            >
              {plan.status.replace('_', ' ')}
            </span>
            <span className="text-secondary-500 text-sm">
              FY {plan.fiscalYear} • {format(new Date(plan.startDate), 'MMM yyyy')} -{' '}
              {format(new Date(plan.endDate), 'MMM yyyy')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-secondary">
            <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
            Export
          </button>
          {plan.status === 'DRAFT' && (
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="btn-primary"
            >
              <PaperAirplaneIcon className="w-5 h-5 mr-2" />
              Submit for Review
            </button>
          )}
          {plan.status === 'IN_REVIEW' && (
            <>
              <button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="btn-primary"
              >
                <CheckIcon className="w-5 h-5 mr-2" />
                Approve
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tab.Group>
        <Tab.List className="flex space-x-1 rounded-xl bg-secondary-100 dark:bg-secondary-800 p-1">
          <Tab
            className={({ selected }) =>
              clsx(
                'w-full rounded-lg py-2.5 text-sm font-medium leading-5 transition-colors',
                'ring-white/60 ring-offset-2 ring-offset-primary-400 focus:outline-none focus:ring-2',
                selected
                  ? 'bg-white dark:bg-secondary-700 shadow text-primary-700 dark:text-primary-300'
                  : 'text-secondary-600 hover:bg-white/[0.12] hover:text-secondary-800',
              )
            }
          >
            <span className="flex items-center justify-center gap-2">
              <ChartBarIcon className="w-5 h-5" />
              Forecast
            </span>
          </Tab>
          <Tab
            className={({ selected }) =>
              clsx(
                'w-full rounded-lg py-2.5 text-sm font-medium leading-5 transition-colors',
                'ring-white/60 ring-offset-2 ring-offset-primary-400 focus:outline-none focus:ring-2',
                selected
                  ? 'bg-white dark:bg-secondary-700 shadow text-primary-700 dark:text-primary-300'
                  : 'text-secondary-600 hover:bg-white/[0.12] hover:text-secondary-800',
              )
            }
          >
            <span className="flex items-center justify-center gap-2">
              <TableCellsIcon className="w-5 h-5" />
              Data Grid
            </span>
          </Tab>
          <Tab
            className={({ selected }) =>
              clsx(
                'w-full rounded-lg py-2.5 text-sm font-medium leading-5 transition-colors',
                'ring-white/60 ring-offset-2 ring-offset-primary-400 focus:outline-none focus:ring-2',
                selected
                  ? 'bg-white dark:bg-secondary-700 shadow text-primary-700 dark:text-primary-300'
                  : 'text-secondary-600 hover:bg-white/[0.12] hover:text-secondary-800',
              )
            }
          >
            <span className="flex items-center justify-center gap-2">
              <Cog6ToothIcon className="w-5 h-5" />
              Settings
            </span>
          </Tab>
        </Tab.List>

        <Tab.Panels className="mt-4">
          {/* Forecast Tab */}
          <Tab.Panel>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Forecast Controls */}
              <div className="card p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Generate Forecast</h3>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="p-1.5 rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-700 transition-colors"
                    title="Refresh data"
                  >
                    <ArrowPathIcon className={clsx('w-4 h-4', isRefreshing && 'animate-spin')} />
                  </button>
                </div>

                {/* Scenario Selection */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label mb-0">Scenario</label>
                    {plan.status !== 'APPROVED' && (
                      <button
                        onClick={() => setIsCreateScenarioModalOpen(true)}
                        className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                      >
                        <PlusIcon className="w-3 h-3" />
                        New
                      </button>
                    )}
                  </div>
                  {isScenariosLoading ? (
                    <div className="flex items-center gap-2 text-sm text-secondary-500 py-2">
                      <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      Loading scenarios...
                    </div>
                  ) : scenarios.length > 0 ? (
                    <select
                      value={selectedScenarioId}
                      onChange={(e) => setSelectedScenarioId(e.target.value)}
                      className="input"
                    >
                      <option value="">Select a scenario...</option>
                      {scenarios.map((scenario) => (
                        <option key={scenario.id} value={scenario.id}>
                          {scenario.name} {scenario.isBaseline ? '(Baseline)' : ''} - {scenario.scenarioType}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-secondary-500">No scenarios available</p>
                      <button
                        onClick={() => setIsCreateScenarioModalOpen(true)}
                        disabled={createScenarioMutation.isPending}
                        className="btn-secondary w-full text-sm"
                      >
                        <PlusIcon className="w-4 h-4 mr-1" />
                        Create Scenario
                      </button>
                    </div>
                  )}
                  {scenarios.length > 0 && !selectedScenarioId && !isScenariosLoading && (
                    <p className="text-xs text-warning-600 mt-1">
                      Please select a scenario to generate forecasts
                    </p>
                  )}
                  {scenarios.length === 1 && (
                    <p className="text-xs text-secondary-500 mt-1">
                      Only 1 scenario available. Click "+ New" to add more.
                    </p>
                  )}
                  {/* Show scenario adjustment preview */}
                  {selectedScenarioId && (() => {
                    const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);
                    const adjustments: Record<string, { label: string; color: string }> = {
                      BASE: { label: 'No adjustment', color: 'text-secondary-600' },
                      OPTIMISTIC: { label: '+15% uplift', color: 'text-success-600' },
                      PESSIMISTIC: { label: '-15% reduction', color: 'text-error-600' },
                      STRETCH: { label: '+25% stretch', color: 'text-success-700' },
                      CONSERVATIVE: { label: '-8% conservative', color: 'text-warning-600' },
                      CUSTOM: { label: 'Custom scenario', color: 'text-primary-600' },
                    };
                    const adj = adjustments[selectedScenario?.scenarioType || 'BASE'];
                    return selectedScenario?.scenarioType && selectedScenario.scenarioType !== 'BASE' ? (
                      <p className={`text-xs mt-1 ${adj?.color || 'text-secondary-500'}`}>
                        ℹ️ Forecast will be adjusted: {adj?.label}
                      </p>
                    ) : null;
                  })()}
                </div>

                <div>
                  <label className="label">Forecast Model</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value as ForecastModel)}
                    className="input"
                  >
                    {models?.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.displayName}
                      </option>
                    ))}
                  </select>
                  {models?.find((m) => m.name === selectedModel) && (
                    <p className="text-xs text-secondary-500 mt-1">
                      {models.find((m) => m.name === selectedModel)?.description}
                    </p>
                  )}
                </div>

                <div>
                  <label className="label">Forecast Periods</label>
                  <select
                    value={forecastPeriods}
                    onChange={(e) => setForecastPeriods(Number(e.target.value))}
                    className="input"
                  >
                    <option value={3}>3 months</option>
                    <option value={6}>6 months</option>
                    <option value={12}>12 months</option>
                    <option value={18}>18 months</option>
                    <option value={24}>24 months</option>
                  </select>
                </div>

                <button
                  onClick={handleGenerateForecast}
                  disabled={generateMutation.isPending || !selectedScenarioId}
                  className="btn-primary w-full"
                >
                  <PlayIcon className="w-5 h-5 mr-2" />
                  {generateMutation.isPending ? 'Generating...' : 'Generate Forecast'}
                </button>

                {!selectedScenarioId && scenarios.length > 0 && (
                  <p className="text-xs text-error-500 text-center">
                    Select a scenario to generate forecasts
                  </p>
                )}

                {plan.status === 'APPROVED' && (
                  <p className="text-xs text-info-600 text-center">
                    Plan is approved. You can still generate forecasts for analysis.
                  </p>
                )}
              </div>

              {/* Chart */}
              <div className="lg:col-span-3 card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">Forecast Visualization</h3>
                  {forecasts.length > 0 && (
                    <span className="text-sm text-secondary-500">
                      {forecasts.length} forecast records
                    </span>
                  )}
                </div>
                {chartData.length === 0 ? (
                  <div className="h-80 flex flex-col items-center justify-center text-secondary-500">
                    <ChartBarIcon className="w-12 h-12 mb-4 text-secondary-300" />
                    <p className="font-medium">No forecast data yet</p>
                    <p className="text-sm mt-1 text-center max-w-md">
                      Select a scenario and model, then click <strong>"Generate Forecast"</strong> to predict future values based on your historical sales data.
                    </p>
                    <p className="text-xs mt-2 text-secondary-400">
                      Forecasts are generated using 24 months of historical Actuals data
                    </p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="period" stroke="#94a3b8" fontSize={12} />
                      <YAxis stroke="#94a3b8" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1e293b',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#f8fafc',
                        }}
                      />
                      <Legend />
                      {Object.entries(modelColors).map(([model, color]) => {
                        if (!chartData.some((d) => d[model])) return null;
                        return (
                          <Line
                            key={model}
                            type="monotone"
                            dataKey={model}
                            stroke={color}
                            strokeWidth={2}
                            dot={{ fill: color }}
                            name={model.replace('_', ' ')}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </Tab.Panel>

          {/* Data Grid Tab */}
          <Tab.Panel>
            <div className="card">
              <div className="p-4 border-b border-secondary-200 dark:border-secondary-700 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h3 className="font-semibold">Forecast Data</h3>
                  {selectedRows.size > 0 && (
                    <span className="text-sm text-secondary-500">
                      {selectedRows.size} selected
                    </span>
                  )}
                </div>
                {selectedRows.size > 0 && plan.status !== 'APPROVED' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => lockMutation.mutate(true)}
                      className="btn-secondary btn-sm"
                    >
                      <LockClosedIcon className="w-4 h-4 mr-1" />
                      Lock
                    </button>
                    <button
                      onClick={() => lockMutation.mutate(false)}
                      className="btn-secondary btn-sm"
                    >
                      <LockOpenIcon className="w-4 h-4 mr-1" />
                      Unlock
                    </button>
                  </div>
                )}
              </div>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-12">
                        <input
                          type="checkbox"
                          checked={
                            selectedRows.size === forecasts.length && forecasts.length > 0
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRows(new Set(forecasts.map((f) => f.id)));
                            } else {
                              setSelectedRows(new Set());
                            }
                          }}
                          className="rounded"
                        />
                      </th>
                      <th>Period</th>
                      <th>Model</th>
                      <th className="text-right">Value</th>
                      <th className="text-right">Quantity</th>
                      <th className="text-right">Confidence</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecasts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-secondary-500">
                          <div className="flex flex-col items-center">
                            <p className="font-medium">No forecast data available</p>
                            <p className="text-sm mt-1">
                              Click "Generate Forecast" in the sidebar to create forecasts from historical sales data
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      forecasts.map((forecast) => (
                        <tr key={forecast.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedRows.has(forecast.id)}
                              onChange={(e) => {
                                const newSet = new Set(selectedRows);
                                if (e.target.checked) {
                                  newSet.add(forecast.id);
                                } else {
                                  newSet.delete(forecast.id);
                                }
                                setSelectedRows(newSet);
                              }}
                              className="rounded"
                            />
                          </td>
                          <td>{format(new Date(forecast.periodDate), 'MMM yyyy')}</td>
                          <td>
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                              style={{
                                backgroundColor: `${modelColors[forecast.forecastModel as ForecastModel] || '#64748b'}20`,
                                color: modelColors[forecast.forecastModel as ForecastModel] || '#64748b',
                              }}
                            >
                              {(forecast.forecastModel ?? 'UNKNOWN').replace('_', ' ')}
                            </span>
                          </td>
                          <td className="text-right font-mono">
                            ${Number(forecast.forecastAmount).toLocaleString()}
                          </td>
                          <td className="text-right font-mono">
                            {forecast.forecastQuantity ? Number(forecast.forecastQuantity).toLocaleString() : '-'}
                          </td>
                          <td className="text-right text-xs text-secondary-500">
                            {forecast.confidenceLower && forecast.confidenceUpper
                              ? `$${Number(forecast.confidenceLower).toLocaleString()} - $${Number(forecast.confidenceUpper).toLocaleString()}`
                              : '-'}
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              {forecast.isOverride && (
                                <span className="badge badge-warning">Override</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Tab.Panel>

          {/* Settings Tab */}
          <Tab.Panel>
            <div className="card p-6 space-y-6">
              <h3 className="font-semibold">Plan Settings</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="label">Plan Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={plan.status === 'APPROVED'}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Fiscal Year</label>
                  <input
                    type="text"
                    value={`FY ${plan.fiscalYear}`}
                    disabled
                    className="input bg-secondary-50"
                  />
                </div>
                <div>
                  <label className="label">Start Date</label>
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    disabled={plan.status === 'APPROVED'}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">End Date</label>
                  <input
                    type="date"
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    disabled={plan.status === 'APPROVED'}
                    className="input"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Description</label>
                  <textarea
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    disabled={plan.status === 'APPROVED'}
                    className="input"
                  />
                </div>
              </div>

              {plan.status !== 'APPROVED' && (
                <div className="flex justify-end">
                  <button
                    onClick={() => updatePlanMutation.mutate()}
                    disabled={updatePlanMutation.isPending}
                    className="btn-primary"
                  >
                    {updatePlanMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}
            </div>
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

      {/* Create Scenario Modal */}
      <Transition appear show={isCreateScenarioModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsCreateScenarioModalOpen(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-secondary-800 p-6 shadow-xl transition-all">
                  <Dialog.Title as="h3" className="text-lg font-semibold mb-4">
                    Create New Scenario
                  </Dialog.Title>

                  <div className="space-y-4">
                    <div>
                      <label className="label">Scenario Name *</label>
                      <input
                        type="text"
                        value={newScenarioName}
                        onChange={(e) => setNewScenarioName(e.target.value)}
                        placeholder="e.g., Optimistic Growth"
                        className="input"
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="label">Scenario Type *</label>
                      <Listbox value={newScenarioType} onChange={setNewScenarioType}>
                        <div className="relative">
                          <Listbox.Button className="input text-left flex items-center justify-between">
                            <span>{scenarioTypeOptions.find(o => o.value === newScenarioType)?.label}</span>
                            <ChevronUpDownIcon className="w-5 h-5 text-secondary-400" />
                          </Listbox.Button>
                          <Transition
                            as={Fragment}
                            leave="transition ease-in duration-100"
                            leaveFrom="opacity-100"
                            leaveTo="opacity-0"
                          >
                            <Listbox.Options className="absolute z-10 mt-1 w-full bg-white dark:bg-secondary-800 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-700 py-1 max-h-60 overflow-auto">
                              {scenarioTypeOptions.map((option) => (
                                <Listbox.Option
                                  key={option.value}
                                  value={option.value}
                                  className={({ active }) =>
                                    clsx(
                                      'cursor-pointer select-none px-4 py-2',
                                      active && 'bg-primary-50 dark:bg-primary-900/30'
                                    )
                                  }
                                >
                                  {({ selected }) => (
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className={clsx('font-medium', selected && 'text-primary-600')}>
                                          {option.label}
                                        </p>
                                        <p className="text-xs text-secondary-500">{option.description}</p>
                                      </div>
                                      {selected && <CheckIcon className="w-5 h-5 text-primary-600" />}
                                    </div>
                                  )}
                                </Listbox.Option>
                              ))}
                            </Listbox.Options>
                          </Transition>
                        </div>
                      </Listbox>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreateScenarioModalOpen(false);
                        setNewScenarioName('');
                        setNewScenarioType('CUSTOM');
                      }}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateScenario}
                      disabled={createScenarioMutation.isPending || !newScenarioName.trim()}
                      className="btn-primary"
                    >
                      {createScenarioMutation.isPending ? 'Creating...' : 'Create Scenario'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}

