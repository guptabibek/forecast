import type { ScenarioType } from '@/types';
import { ArrowLeftIcon, ExclamationCircleIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { zodResolver } from '@hookform/resolvers/zod';
import { planService, scenarioService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addMonths, endOfYear, format, isAfter, parseISO, startOfYear } from 'date-fns';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

// Scenario type options
const scenarioTypeOptions = [
  { value: 'BASE', label: 'Base Case', description: 'Primary planning scenario' },
  { value: 'OPTIMISTIC', label: 'Optimistic', description: 'Best case assumptions' },
  { value: 'PESSIMISTIC', label: 'Pessimistic', description: 'Worst case assumptions' },
  { value: 'STRETCH', label: 'Stretch', description: 'Ambitious growth targets' },
  { value: 'CONSERVATIVE', label: 'Conservative', description: 'Risk-averse assumptions' },
  { value: 'CUSTOM', label: 'Custom', description: 'Custom scenario' },
];

// Type for additional scenarios to create
interface AdditionalScenario {
  id: string;
  name: string;
  type: ScenarioType;
}

const createPlanSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(255, 'Name must be less than 255 characters'),
  description: z.string().optional(),
  fiscalYear: z.number().min(2020, 'Fiscal year must be 2020 or later').max(2050, 'Fiscal year must be 2050 or earlier'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  planType: z.enum(['BUDGET', 'FORECAST', 'STRATEGIC', 'WHAT_IF']).optional(),
  periodType: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  copyFromId: z.string().optional().default(''), // Default to empty string for "Start Fresh"
}).refine((data) => {
  if (!data.startDate || !data.endDate) return true;
  return !isAfter(parseISO(data.startDate), parseISO(data.endDate));
}, {
  message: 'End date must be after start date',
  path: ['endDate'],
});

type CreatePlanFormData = z.infer<typeof createPlanSchema>;

export default function CreatePlan() {
    const getErrorMessage = (error: unknown, fallback: string) => {
      if (error && typeof error === 'object') {
        const maybeResponse = error as { response?: { data?: { message?: string } } };
        return maybeResponse.response?.data?.message || fallback;
      }
      return fallback;
    };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [additionalScenarios, setAdditionalScenarios] = useState<AdditionalScenario[]>([]);
  const [isCreatingScenarios, setIsCreatingScenarios] = useState(false);

  const currentYear = new Date().getFullYear();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<CreatePlanFormData>({
    resolver: zodResolver(createPlanSchema),
    mode: 'onChange',
    defaultValues: {
      fiscalYear: currentYear,
      startDate: format(startOfYear(new Date()), 'yyyy-MM-dd'),
      endDate: format(endOfYear(new Date()), 'yyyy-MM-dd'),
      planType: 'FORECAST',
      periodType: 'MONTHLY',
      copyFromId: '', // Explicitly set empty string for "Start Fresh" default
    },
  });

  const fiscalYear = watch('fiscalYear');
  const copyFromId = watch('copyFromId');
  const name = watch('name');

  // Get existing plans for copying
  const { data: existingPlans, isLoading: plansLoading } = useQuery({
    queryKey: ['plans', 'approved'],
    queryFn: () =>
      planService.getAll({
        filters: { status: 'APPROVED' },
        pageSize: 100,
      }),
  });

  const createMutation = useMutation({
    mutationFn: planService.create,
    onSuccess: async (plan) => {
      // Create additional scenarios if any were defined
      if (additionalScenarios.length > 0) {
        setIsCreatingScenarios(true);
        try {
          await Promise.all(
            additionalScenarios.map((scenario) =>
                scenarioService.create({
                name: scenario.name,
                planVersionId: plan.id,
                scenarioType: scenario.type,
              })
            )
          );
          toast.success(`Plan created with ${additionalScenarios.length + 1} scenarios`);
        } catch {
          toast.success('Plan created, but some scenarios failed to create');
        } finally {
          setIsCreatingScenarios(false);
        }
      } else {
        toast.success('Plan created successfully');
      }
      
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      navigate(`/plans/${plan.id}`);
    },
    onError: (error: unknown) => {
      const errorMessage = getErrorMessage(error, 'Failed to create plan');
      setSubmitError(errorMessage);
      toast.error(errorMessage);
    },
  });

  const onSubmit = (data: CreatePlanFormData) => {
    // SAFETY: Only allow submission from Step 4
    if (step !== 4) {
      return;
    }
    
    setSubmitError(null);
    createMutation.mutate({
      name: data.name.trim(),
      description: data.description?.trim(),
      fiscalYear: data.fiscalYear,
      startDate: data.startDate,
      endDate: data.endDate,
      planType: data.planType,
      periodType: data.periodType,
      copyFromId: data.copyFromId || undefined,
    });
  };

  // Step validation before proceeding
  const canProceedToStep = async (nextStep: number): Promise<boolean> => {
    if (nextStep === 2) {
      // Validate step 1 fields
      const isNameValid = await trigger('name');
      const isFiscalYearValid = await trigger('fiscalYear');
      return isNameValid && isFiscalYearValid;
    }
    if (nextStep === 3) {
      // Validate step 2 fields
      const isStartDateValid = await trigger('startDate');
      const isEndDateValid = await trigger('endDate');
      return isStartDateValid && isEndDateValid;
    }
    // Step 3 to 4 doesn't require validation
    return true;
  };

  const handleNextStep = async (e?: React.MouseEvent) => {
    e?.preventDefault(); // Prevent any form submission
    const canProceed = await canProceedToStep(step + 1);
    if (canProceed) {
      setStep(s => s + 1);
    }
  };

  // Prevent Enter key from submitting the form on steps 1-3
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && step < 4) {
      e.preventDefault();
    }
  };

  // Add a new additional scenario
  const addScenario = () => {
    setAdditionalScenarios(prev => [
      ...prev,
      { id: crypto.randomUUID(), name: '', type: 'CUSTOM' }
    ]);
  };

  // Remove an additional scenario
  const removeScenario = (id: string) => {
    setAdditionalScenarios(prev => prev.filter(s => s.id !== id));
  };

  // Update an additional scenario
  const updateScenario = (id: string, field: 'name' | 'type', value: string) => {
    setAdditionalScenarios(prev =>
      prev.map(s => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const handleFiscalYearChange = (year: number) => {
    setValue('fiscalYear', year);
    setValue('startDate', format(new Date(year, 0, 1), 'yyyy-MM-dd'));
    setValue('endDate', format(new Date(year, 11, 31), 'yyyy-MM-dd'));
    trigger(['startDate', 'endDate']); // Re-validate dates
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/plans')}
          className="flex items-center gap-2 text-secondary-500 hover:text-secondary-700 mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to Plans
        </button>
        <h1 className="text-2xl font-bold">Create New Plan</h1>
        <p className="text-secondary-500 mt-1">
          Set up a new planning version for forecasting
        </p>
      </div>

      {/* Progress steps */}
      <div className="flex items-center justify-center mb-8">
        <div className="flex items-center">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-medium ${
              step >= 1
                ? 'bg-primary-600 text-white'
                : 'bg-secondary-200 text-secondary-500'
            }`}
          >
            1
          </div>
          <div
            className={`w-16 h-1 ${
              step >= 2 ? 'bg-primary-600' : 'bg-secondary-200'
            }`}
          />
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-medium ${
              step >= 2
                ? 'bg-primary-600 text-white'
                : 'bg-secondary-200 text-secondary-500'
            }`}
          >
            2
          </div>
          <div
            className={`w-16 h-1 ${
              step >= 3 ? 'bg-primary-600' : 'bg-secondary-200'
            }`}
          />
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-medium ${
              step >= 3
                ? 'bg-primary-600 text-white'
                : 'bg-secondary-200 text-secondary-500'
            }`}
          >
            3
          </div>
          <div
            className={`w-16 h-1 ${
              step >= 4 ? 'bg-primary-600' : 'bg-secondary-200'
            }`}
          />
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-medium ${
              step >= 4
                ? 'bg-primary-600 text-white'
                : 'bg-secondary-200 text-secondary-500'
            }`}
          >
            4
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} onKeyDown={handleKeyDown}>
        <div className="card">
          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="p-6 space-y-6">
              <h2 className="text-lg font-semibold">Basic Information</h2>

              <div>
                <label htmlFor="name" className="label">
                  Plan Name *
                </label>
                <input
                  id="name"
                  type="text"
                  className={`input ${errors.name ? 'input-error' : ''}`}
                  placeholder="e.g., FY2024 Annual Budget"
                  {...register('name')}
                />
                {errors.name && (
                  <p className="text-sm text-error-500 mt-1">{errors.name.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="description" className="label">
                  Description
                </label>
                <textarea
                  id="description"
                  rows={3}
                  className="input"
                  placeholder="Optional description of this planning version..."
                  {...register('description')}
                />
              </div>

              <div>
                <label className="label">Fiscal Year *</label>
                <div className="grid grid-cols-4 gap-2">
                  {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map(
                    (year) => (
                      <button
                        key={year}
                        type="button"
                        onClick={() => handleFiscalYearChange(year)}
                        className={`py-3 px-4 rounded-lg border-2 font-medium transition-colors ${
                          fiscalYear === year
                            ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30'
                            : 'border-secondary-200 hover:border-secondary-300 dark:border-secondary-700'
                        }`}
                      >
                        FY {year}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Date Range */}
          {step === 2 && (
            <div className="p-6 space-y-6">
              <h2 className="text-lg font-semibold">Planning Period</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="startDate" className="label">
                    Start Date *
                  </label>
                  <input
                    id="startDate"
                    type="date"
                    className={`input ${errors.startDate ? 'input-error' : ''}`}
                    {...register('startDate')}
                  />
                  {errors.startDate && (
                    <p className="text-sm text-error-500 mt-1">
                      {errors.startDate.message}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="endDate" className="label">
                    End Date *
                  </label>
                  <input
                    id="endDate"
                    type="date"
                    className={`input ${errors.endDate ? 'input-error' : ''}`}
                    {...register('endDate')}
                  />
                  {errors.endDate && (
                    <p className="text-sm text-error-500 mt-1">
                      {errors.endDate.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-secondary-50 dark:bg-secondary-800/50 rounded-lg p-4">
                <h3 className="font-medium mb-3">Quick Select</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setValue(
                        'startDate',
                        format(new Date(fiscalYear, 0, 1), 'yyyy-MM-dd'),
                      );
                      setValue(
                        'endDate',
                        format(new Date(fiscalYear, 11, 31), 'yyyy-MM-dd'),
                      );
                    }}
                    className="btn-secondary btn-sm"
                  >
                    Full Year
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setValue(
                        'startDate',
                        format(new Date(fiscalYear, 0, 1), 'yyyy-MM-dd'),
                      );
                      setValue(
                        'endDate',
                        format(new Date(fiscalYear, 5, 30), 'yyyy-MM-dd'),
                      );
                    }}
                    className="btn-secondary btn-sm"
                  >
                    H1
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setValue(
                        'startDate',
                        format(new Date(fiscalYear, 6, 1), 'yyyy-MM-dd'),
                      );
                      setValue(
                        'endDate',
                        format(new Date(fiscalYear, 11, 31), 'yyyy-MM-dd'),
                      );
                    }}
                    className="btn-secondary btn-sm"
                  >
                    H2
                  </button>
                  {[1, 2, 3, 4].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        const startMonth = (q - 1) * 3;
                        setValue(
                          'startDate',
                          format(new Date(fiscalYear, startMonth, 1), 'yyyy-MM-dd'),
                        );
                        setValue(
                          'endDate',
                          format(
                            addMonths(new Date(fiscalYear, startMonth, 1), 3),
                            'yyyy-MM-dd',
                          ),
                        );
                      }}
                      className="btn-secondary btn-sm"
                    >
                      Q{q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Copy From */}
          {step === 3 && (
            <div className="p-6 space-y-6">
              <h2 className="text-lg font-semibold">Initialize Plan Data</h2>
              <p className="text-secondary-500">
                Optionally copy data from an existing approved plan as a starting point.
              </p>

              <div className="space-y-3">
                {/* Start Fresh Option */}
                <label className="flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors hover:border-secondary-300 dark:hover:border-secondary-600 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50 dark:has-[:checked]:bg-primary-900/30">
                  <input
                    type="radio"
                    value=""
                    checked={copyFromId === '' || copyFromId === undefined}
                    onChange={() => setValue('copyFromId', '')}
                    className="sr-only"
                    name="copyFromId"
                  />
                  <div className="flex-1">
                    <p className="font-medium">Start Fresh</p>
                    <p className="text-sm text-secondary-500">
                      Create an empty plan with no initial data
                    </p>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      copyFromId === '' || copyFromId === undefined
                        ? 'border-primary-500 bg-primary-500'
                        : 'border-secondary-300'
                    }`}
                  >
                    {(copyFromId === '' || copyFromId === undefined) && (
                      <svg
                        className="w-full h-full text-white p-0.5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <circle cx="10" cy="10" r="5" />
                      </svg>
                    )}
                  </div>
                </label>

                {/* Loading state for existing plans */}
                {plansLoading && (
                  <div className="flex items-center justify-center p-4 text-secondary-500">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary-500 mr-2" />
                    Loading existing plans...
                  </div>
                )}

                {/* Existing approved plans */}
                {existingPlans?.data?.map((plan) => (
                  <label
                    key={plan.id}
                    className="flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors hover:border-secondary-300 dark:hover:border-secondary-600 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50 dark:has-[:checked]:bg-primary-900/30"
                  >
                    <input
                      type="radio"
                      value={plan.id}
                      checked={copyFromId === plan.id}
                      onChange={() => setValue('copyFromId', plan.id)}
                      className="sr-only"
                      name="copyFromId"
                    />
                    <div className="flex-1">
                      <p className="font-medium">{plan.name}</p>
                      <p className="text-sm text-secondary-500">
                        FY {plan.fiscalYear} • {format(new Date(plan.startDate), 'MMM yyyy')} -{' '}
                        {format(new Date(plan.endDate), 'MMM yyyy')}
                      </p>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        copyFromId === plan.id
                          ? 'border-primary-500 bg-primary-500'
                          : 'border-secondary-300'
                      }`}
                    >
                      {copyFromId === plan.id && (
                        <svg
                          className="w-full h-full text-white p-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <circle cx="10" cy="10" r="5" />
                        </svg>
                      )}
                    </div>
                  </label>
                ))}

                {/* No approved plans message */}
                {!plansLoading && (!existingPlans?.data || existingPlans.data.length === 0) && (
                  <p className="text-sm text-secondary-500 text-center py-2">
                    No approved plans available to copy from.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Scenarios */}
          {step === 4 && (
            <div className="p-6 space-y-6">
              <h2 className="text-lg font-semibold">Define Scenarios</h2>
              <p className="text-secondary-500">
                A "Base Scenario" will be created automatically. Add more scenarios below if needed.
              </p>

              {/* Default Base Scenario (always created) */}
              <div className="p-4 border-2 border-primary-200 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-primary-700 dark:text-primary-300">Base Scenario</p>
                    <p className="text-sm text-primary-600 dark:text-primary-400">
                      Default baseline scenario (created automatically)
                    </p>
                  </div>
                  <span className="text-xs bg-primary-100 text-primary-700 px-2 py-1 rounded-full">
                    Required
                  </span>
                </div>
              </div>

              {/* Additional Scenarios */}
              <div className="space-y-3">
                {additionalScenarios.map((scenario, index) => (
                  <div
                    key={scenario.id}
                    className="p-4 border-2 rounded-lg border-secondary-200 dark:border-secondary-700"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 grid grid-cols-2 gap-3">
                        <div>
                          <label className="label text-sm">Scenario Name</label>
                          <input
                            type="text"
                            value={scenario.name}
                            onChange={(e) => updateScenario(scenario.id, 'name', e.target.value)}
                            placeholder={`Scenario ${index + 2}`}
                            className="input"
                          />
                        </div>
                        <div>
                          <label className="label text-sm">Type</label>
                          <select
                            value={scenario.type}
                            onChange={(e) => updateScenario(scenario.id, 'type', e.target.value)}
                            className="input"
                          >
                            {scenarioTypeOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeScenario(scenario.id)}
                        className="mt-6 p-2 text-error-500 hover:bg-error-50 rounded-lg transition-colors"
                        title="Remove scenario"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Scenario Button */}
              <button
                type="button"
                onClick={addScenario}
                className="w-full p-4 border-2 border-dashed border-secondary-300 dark:border-secondary-600 rounded-lg text-secondary-600 dark:text-secondary-400 hover:border-primary-400 hover:text-primary-600 transition-colors flex items-center justify-center gap-2"
              >
                <PlusIcon className="w-5 h-5" />
                Add Another Scenario
              </button>

              {/* Quick Add Options */}
              <div className="bg-secondary-50 dark:bg-secondary-800/50 rounded-lg p-4">
                <h3 className="font-medium mb-3 text-sm">Quick Add Common Scenarios</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdditionalScenarios(prev => [
                        ...prev,
                        { id: crypto.randomUUID(), name: 'Optimistic', type: 'OPTIMISTIC' }
                      ]);
                    }}
                    className="btn-secondary btn-sm"
                  >
                    + Optimistic
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdditionalScenarios(prev => [
                        ...prev,
                        { id: crypto.randomUUID(), name: 'Pessimistic', type: 'PESSIMISTIC' }
                      ]);
                    }}
                    className="btn-secondary btn-sm"
                  >
                    + Pessimistic
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdditionalScenarios(prev => [
                        ...prev,
                        { id: crypto.randomUUID(), name: 'Conservative', type: 'CONSERVATIVE' }
                      ]);
                    }}
                    className="btn-secondary btn-sm"
                  >
                    + Conservative
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdditionalScenarios(prev => [
                        ...prev,
                        { id: crypto.randomUUID(), name: 'Stretch Target', type: 'STRETCH' }
                      ]);
                    }}
                    className="btn-secondary btn-sm"
                  >
                    + Stretch
                  </button>
                </div>
              </div>

              {/* Summary */}
              <div className="text-sm text-secondary-500 text-center">
                {additionalScenarios.length === 0 ? (
                  <p>Your plan will be created with 1 scenario (Base Scenario).</p>
                ) : (
                  <p>
                    Your plan will be created with{' '}
                    <strong className="text-secondary-700 dark:text-secondary-300">
                      {additionalScenarios.length + 1} scenarios
                    </strong>{' '}
                    (Base Scenario + {additionalScenarios.length} additional).
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-b-xl border-t border-secondary-200 dark:border-secondary-700">
            {/* Error message */}
            {submitError && (
              <div className="mb-4 p-3 bg-error-50 border border-error-200 rounded-lg flex items-start gap-2">
                <ExclamationCircleIcon className="w-5 h-5 text-error-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-error-700">{submitError}</p>
              </div>
            )}
            
            <div className="flex justify-between">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className="btn-secondary"
                >
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate('/plans')}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              )}

              {step < 4 ? (
                <button
                  type="button"
                  onClick={(e) => handleNextStep(e)}
                  className="btn-primary"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={createMutation.isPending || isCreatingScenarios || !name?.trim()}
                  className="btn-primary"
                >
                  {createMutation.isPending || isCreatingScenarios ? (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />
                      {isCreatingScenarios ? 'Creating Scenarios...' : 'Creating Plan...'}
                    </div>
                  ) : additionalScenarios.length > 0 ? (
                    `Create Plan with ${additionalScenarios.length + 1} Scenarios`
                  ) : (
                    'Create Plan'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

