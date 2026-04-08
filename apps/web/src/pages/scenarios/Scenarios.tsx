import type { PlanVersion, Scenario } from '@/types';
import { Dialog, Listbox, Transition } from '@headlessui/react';
import {
    BeakerIcon,
    ChartBarSquareIcon,
    CheckIcon,
    ChevronUpDownIcon,
    PencilSquareIcon,
    PlusIcon,
    TrashIcon,
    XMarkIcon
} from '@heroicons/react/24/outline';
import { zodResolver } from '@hookform/resolvers/zod';
import { planService, scenarioService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { z } from 'zod';

const scenarioSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters'),
  description: z.string().optional(),
  scenarioType: z.enum(['BASE', 'OPTIMISTIC', 'PESSIMISTIC', 'STRETCH', 'CONSERVATIVE', 'CUSTOM']),
  planVersionId: z.string().min(1, 'Plan is required'),
  color: z.string().optional(),
});

type ScenarioFormData = z.infer<typeof scenarioSchema>;

const scenarioTypeConfig: Record<
  string,
  { label: string; color: string; description: string }
> = {
  BASE: {
    label: 'Base Case',
    color: 'bg-primary-100 text-primary-700',
    description: 'Primary planning scenario',
  },
  OPTIMISTIC: {
    label: 'Optimistic',
    color: 'bg-success-50 text-success-600',
    description: 'Optimistic assumptions',
  },
  PESSIMISTIC: {
    label: 'Pessimistic',
    color: 'bg-error-50 text-error-600',
    description: 'Conservative assumptions',
  },
  STRETCH: {
    label: 'Stretch',
    color: 'bg-warning-50 text-warning-600',
    description: 'Ambitious growth targets',
  },
  CONSERVATIVE: {
    label: 'Conservative',
    color: 'bg-secondary-100 text-secondary-700',
    description: 'Risk-averse assumptions',
  },
  CUSTOM: {
    label: 'Custom',
    color: 'bg-purple-50 text-purple-600',
    description: 'Custom scenario',
  },
};

export default function Scenarios() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(new Set());
  const [selectedPlan, setSelectedPlan] = useState<PlanVersion | null>(null);
  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error && typeof error === 'object') {
      const maybeResponse = error as { response?: { data?: { message?: string } } };
      return maybeResponse.response?.data?.message || fallback;
    }
    return fallback;
  };

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ScenarioFormData>({
    resolver: zodResolver(scenarioSchema),
    defaultValues: {
      scenarioType: 'CUSTOM',
    },
  });

  // Fetch plans for dropdown
  const { data: plansData } = useQuery({
    queryKey: ['plans'],
    queryFn: () => planService.getAll({ page: 1, pageSize: 100 }),
  });

  const plans = plansData?.data || [];

  // Fetch scenarios
  const { data: scenarios, isLoading } = useQuery({
    queryKey: ['scenarios'],
    queryFn: () => scenarioService.getAll(),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: ScenarioFormData) => scenarioService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      toast.success('Scenario created');
      closeModal();
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to create scenario'));
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ScenarioFormData> }) =>
      scenarioService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      toast.success('Scenario updated');
      closeModal();
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to update scenario'));
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => scenarioService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      toast.success('Scenario deleted');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to delete scenario'));
    },
  });

  const openModal = (scenario?: Scenario) => {
    if (scenario) {
      setEditingScenario(scenario);
      const plan = plans.find(p => p.id === scenario.planVersionId);
      setSelectedPlan(plan || null);
      reset({
        name: scenario.name,
        description: scenario.description || '',
        scenarioType: scenario.scenarioType || 'CUSTOM',
        planVersionId: scenario.planVersionId,
        color: scenario.color || '',
      });
    } else {
      setEditingScenario(null);
      setSelectedPlan(plans[0] || null);
      reset({ 
        scenarioType: 'CUSTOM',
        planVersionId: plans[0]?.id || '',
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingScenario(null);
    setSelectedPlan(null);
    reset();
  };

  const onSubmit = (data: ScenarioFormData) => {
    if (editingScenario) {
      // Don't send planVersionId on update
      const { planVersionId, ...updateData } = data;
      void planVersionId;
      updateMutation.mutate({ id: editingScenario.id, data: updateData });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this scenario?')) {
      deleteMutation.mutate(id);
    }
  };

  const toggleScenarioSelection = (id: string) => {
    const newSet = new Set(selectedScenarios);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else if (newSet.size < 4) {
      newSet.add(id);
    } else {
      toast.error('You can compare up to 4 scenarios');
    }
    setSelectedScenarios(newSet);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Scenarios</h1>
          <p className="text-secondary-500 mt-1">
            Create and manage planning scenarios for what-if analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedScenarios.size >= 2 && (
            <button className="btn-secondary">
              <ChartBarSquareIcon className="w-5 h-5 mr-2" />
              Compare ({selectedScenarios.size})
            </button>
          )}
          <button onClick={() => openModal()} className="btn-primary">
            <PlusIcon className="w-5 h-5 mr-2" />
            New Scenario
          </button>
        </div>
      </div>

      {/* Scenarios Grid */}
      {isLoading ? (
        <div className="card p-12 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
        </div>
      ) : !scenarios || scenarios.length === 0 ? (
        <div className="card p-12 text-center">
          <BeakerIcon className="w-16 h-16 text-secondary-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Scenarios Yet</h3>
          <p className="text-secondary-500 mb-6">
            Create scenarios to explore different planning assumptions
          </p>
          <button onClick={() => openModal()} className="btn-primary">
            <PlusIcon className="w-5 h-5 mr-2" />
            Create First Scenario
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {scenarios.map((scenario, index) => {
            const config = scenarioTypeConfig[scenario.scenarioType] || {
              label: scenario.scenarioType,
              color: 'bg-secondary-100 text-secondary-700',
              description: 'Unknown scenario type',
            };
            const isSelected = selectedScenarios.has(scenario.id);

            return (
              <motion.div
                key={scenario.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={clsx(
                  'card p-5 cursor-pointer transition-all hover:shadow-md',
                  isSelected && 'ring-2 ring-primary-500',
                )}
                onClick={() => toggleScenarioSelection(scenario.id)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleScenarioSelection(scenario.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded"
                    />
                    <span className={clsx('badge', config.color)}>{config.label}</span>
                    {scenario.isBaseline && (
                      <span className="badge bg-primary-100 text-primary-700">Baseline</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openModal(scenario);
                      }}
                      className="p-1.5 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700"
                    >
                      <PencilSquareIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(scenario.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-error-50 text-error-600"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <h3 className="font-semibold mb-1">{scenario.name}</h3>
                {scenario.description && (
                  <p className="text-sm text-secondary-500 mb-3 line-clamp-2">
                    {scenario.description}
                  </p>
                )}

                {scenario.planVersion && (
                  <div className="text-xs text-secondary-500 mb-2">
                    Plan: {scenario.planVersion.name} (v{scenario.planVersion.version})
                  </div>
                )}

                <div className="text-xs text-secondary-400">
                  Created {format(new Date(scenario.createdAt), 'MMM d, yyyy')}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Transition appear show={isModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={closeModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/50" />
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
                  <div className="flex items-center justify-between mb-6">
                    <Dialog.Title className="text-lg font-semibold">
                      {editingScenario ? 'Edit Scenario' : 'Create Scenario'}
                    </Dialog.Title>
                    <button
                      onClick={closeModal}
                      className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700"
                    >
                      <XMarkIcon className="w-5 h-5" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div>
                      <label className="label">Scenario Name</label>
                      <input
                        type="text"
                        className={`input ${errors.name ? 'input-error' : ''}`}
                        placeholder="e.g., Q2 Growth Scenario"
                        {...register('name')}
                      />
                      {errors.name && (
                        <p className="text-sm text-error-500 mt-1">
                          {errors.name.message}
                        </p>
                      )}
                    </div>

                    {/* Plan Selection - Only for new scenarios */}
                    {!editingScenario && (
                      <div>
                        <label className="label">Plan *</label>
                        <Listbox
                          value={selectedPlan}
                          onChange={(plan) => {
                            setSelectedPlan(plan);
                            setValue('planVersionId', plan?.id || '');
                          }}
                        >
                          <div className="relative">
                            <Listbox.Button className="input w-full text-left flex items-center justify-between">
                              <span>{selectedPlan?.name || 'Select a plan'}</span>
                              <ChevronUpDownIcon className="w-5 h-5 text-secondary-400" />
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="absolute z-10 mt-1 w-full bg-white dark:bg-secondary-700 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-600 max-h-60 overflow-auto">
                                {plans.map((plan) => (
                                  <Listbox.Option
                                    key={plan.id}
                                    value={plan}
                                    className={({ active }) =>
                                      clsx(
                                        'px-4 py-2 cursor-pointer flex items-center justify-between',
                                        active && 'bg-primary-50 dark:bg-primary-900/30'
                                      )
                                    }
                                  >
                                    {({ selected }) => (
                                      <>
                                        <span>{plan.name}</span>
                                        {selected && <CheckIcon className="w-5 h-5 text-primary-500" />}
                                      </>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                        {errors.planVersionId && (
                          <p className="text-sm text-error-500 mt-1">
                            {errors.planVersionId.message}
                          </p>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="label">Scenario Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(scenarioTypeConfig).map(([type, config]) => (
                          <label
                            key={type}
                            className="flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors hover:border-secondary-300 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50"
                          >
                            <input
                              type="radio"
                              value={type}
                              {...register('scenarioType')}
                              className="sr-only"
                            />
                            <div>
                              <p className="font-medium text-sm">{config.label}</p>
                              <p className="text-xs text-secondary-500">
                                {config.description}
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="label">Description (optional)</label>
                      <textarea
                        rows={3}
                        className="input"
                        placeholder="Describe this scenario's assumptions..."
                        {...register('description')}
                      />
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                      <button type="button" onClick={closeModal} className="btn-secondary">
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={createMutation.isPending || updateMutation.isPending}
                        className="btn-primary"
                      >
                        {createMutation.isPending || updateMutation.isPending
                          ? 'Saving...'
                          : editingScenario
                          ? 'Save Changes'
                          : 'Create Scenario'}
                      </button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
