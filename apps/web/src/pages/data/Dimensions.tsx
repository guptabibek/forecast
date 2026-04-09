import type { Dimension, DimensionType, User } from '@/types';
import { Dialog, Listbox, Tab, Transition } from '@headlessui/react';
import {
    BuildingOffice2Icon,
    CheckIcon,
    ChevronUpDownIcon,
    CurrencyDollarIcon,
    MagnifyingGlassIcon,
    MapPinIcon,
    PencilIcon,
    PlusIcon,
    TrashIcon,
    UserGroupIcon,
} from '@heroicons/react/24/outline';
import { zodResolver } from '@hookform/resolvers/zod';
import { dataService, userService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { z } from 'zod';

const dimensionTypes: { value: DimensionType; label: string; singularLabel: string; icon: React.ReactNode }[] = [
  { value: 'location', label: 'Locations', singularLabel: 'Location', icon: <MapPinIcon className="w-5 h-5" /> },
  { value: 'customer', label: 'Customers', singularLabel: 'Customer', icon: <UserGroupIcon className="w-5 h-5" /> },
  { value: 'account', label: 'Accounts', singularLabel: 'Account', icon: <CurrencyDollarIcon className="w-5 h-5" /> },
  { value: 'cost_center', label: 'Cost Centers', singularLabel: 'Cost Center', icon: <BuildingOffice2Icon className="w-5 h-5" /> },
];

const dimensionSchema = z.object({
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().optional(),
  parentId: z.string().optional(),
  managerId: z.string().uuid('Select a valid manager').nullable().optional(),
  attributes: z.record(z.any()).optional(),
  isActive: z.boolean().default(true),
  // Account-specific
  type: z.string().optional(),
  category: z.string().optional(),
  // Product-specific
  subcategory: z.string().optional(),
  brand: z.string().optional(),
  unitOfMeasure: z.string().optional(),
  listPrice: z.number().optional(),
  standardCost: z.number().optional(),
  // Location-specific
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  // Customer-specific
  segment: z.string().optional(),
  industry: z.string().optional(),
});

const accountTypes = [
  { value: 'REVENUE', label: 'Revenue' },
  { value: 'COST_OF_GOODS', label: 'Cost of Goods' },
  { value: 'OPERATING_EXPENSE', label: 'Operating Expense' },
  { value: 'OTHER_INCOME', label: 'Other Income' },
  { value: 'OTHER_EXPENSE', label: 'Other Expense' },
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
];

const locationTypes = [
  { value: 'WAREHOUSE', label: 'Warehouse' },
  { value: 'STORE', label: 'Store' },
  { value: 'DISTRIBUTION_CENTER', label: 'Distribution Center' },
  { value: 'PLANT', label: 'Plant' },
  { value: 'OFFICE', label: 'Office' },
  { value: 'VIRTUAL', label: 'Virtual' },
];

const customerTypes = [
  { value: 'DIRECT', label: 'Direct' },
  { value: 'DISTRIBUTOR', label: 'Distributor' },
  { value: 'RETAILER', label: 'Retailer' },
  { value: 'WHOLESALE', label: 'Wholesale' },
  { value: 'ECOMMERCE', label: 'E-Commerce' },
  { value: 'INTERNAL', label: 'Internal' },
];

type DimensionFormData = z.infer<typeof dimensionSchema>;

export default function Dimensions() {
  const queryClient = useQueryClient();
  const [activeType, setActiveType] = useState<DimensionType>('location');
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDimension, setEditingDimension] = useState<Dimension | null>(null);
  const [selectedParent, setSelectedParent] = useState<Dimension | null>(null);
  const [selectedManager, setSelectedManager] = useState<User | null>(null);
  const [managerSelectionTouched, setManagerSelectionTouched] = useState(false);
  const activeTypeConfig = dimensionTypes.find((type) => type.value === activeType) || dimensionTypes[0];

  // Fetch dimensions
  const { data: dimensions, isLoading } = useQuery({
    queryKey: ['dimensions', activeType, search],
    queryFn: () =>
      dataService.getDimensions(activeType, { search: search || undefined }),
  });

  // Fetch dimension hierarchy for parent selection
  const { data: hierarchy } = useQuery({
    queryKey: ['dimension-hierarchy', activeType],
    queryFn: () => dataService.getDimensionHierarchy(activeType),
  });

  const { data: managerUsersResult } = useQuery({
    queryKey: ['dimension-manager-users'],
    queryFn: () => userService.getAll({ limit: 200, status: 'ACTIVE' }),
    staleTime: 5 * 60 * 1000,
  });
  const managerUsers = managerUsersResult?.data ?? [];

  const getUserLabel = (user: User) => {
    const fullName = `${user.firstName} ${user.lastName}`.trim();
    return fullName || user.email;
  };

  const findManagerUser = (managerId?: string | null, managerName?: string) => {
    const normalizedManagerName = managerName?.trim().toLowerCase();

    return managerUsers.find((user) => {
      if (managerId && user.id === managerId) {
        return true;
      }

      if (!normalizedManagerName) {
        return false;
      }

      return (
        getUserLabel(user).toLowerCase() === normalizedManagerName ||
        user.email.toLowerCase() === normalizedManagerName
      );
    }) || null;
  };

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: DimensionFormData) =>
      dataService.createDimension(activeType, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dimensions', activeType] });
      queryClient.invalidateQueries({ queryKey: ['dimension-hierarchy', activeType] });
      toast.success('Dimension created successfully');
      handleCloseModal();
    },
    onError: () => {
      toast.error('Failed to create dimension');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DimensionFormData }) =>
      dataService.updateDimension(activeType, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dimensions', activeType] });
      queryClient.invalidateQueries({ queryKey: ['dimension-hierarchy', activeType] });
      toast.success('Dimension updated successfully');
      handleCloseModal();
    },
    onError: () => {
      toast.error('Failed to update dimension');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => dataService.deleteDimension(activeType, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dimensions', activeType] });
      queryClient.invalidateQueries({ queryKey: ['dimension-hierarchy', activeType] });
      toast.success('Dimension deleted successfully');
    },
    onError: () => {
      toast.error('Failed to delete dimension');
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DimensionFormData>({
    resolver: zodResolver(dimensionSchema),
    defaultValues: {
      isActive: true,
    },
  });

  const handleOpenModal = (dimension?: Dimension) => {
    if (dimension) {
      const dimensionDetails = dimension as Dimension & Partial<DimensionFormData>;
      const manager = findManagerUser(dimensionDetails.managerId, dimensionDetails.manager);
      setEditingDimension(dimension);
      reset({
        code: dimension.code,
        name: dimension.name,
        description: dimension.description || '',
        parentId: dimension.parentId || undefined,
        managerId: dimensionDetails.managerId ?? null,
        attributes: dimension.attributes || {},
        isActive: dimension.isActive,
        type: dimensionDetails.type || '',
        category: dimensionDetails.category || '',
        subcategory: dimensionDetails.subcategory || '',
        brand: dimensionDetails.brand || '',
        unitOfMeasure: dimensionDetails.unitOfMeasure || '',
        listPrice: dimensionDetails.listPrice ?? undefined,
        standardCost: dimensionDetails.standardCost ?? undefined,
        address: dimensionDetails.address || '',
        city: dimensionDetails.city || '',
        state: dimensionDetails.state || '',
        country: dimensionDetails.country || '',
        region: dimensionDetails.region || '',
        segment: dimensionDetails.segment || '',
        industry: dimensionDetails.industry || '',
      });
      setSelectedParent(
        hierarchy?.find((d) => d.id === dimension.parentId) || null,
      );
      setSelectedManager(manager);
      setManagerSelectionTouched(false);
    } else {
      setEditingDimension(null);
      reset({
        code: '',
        name: '',
        description: '',
        managerId: null,
        isActive: true,
        type: activeType === 'account' ? 'REVENUE' : activeType === 'location' ? 'WAREHOUSE' : activeType === 'customer' ? 'DIRECT' : '',
        category: '',
        subcategory: '',
        brand: '',
        unitOfMeasure: '',
        listPrice: undefined,
        standardCost: undefined,
        address: '',
        city: '',
        state: '',
        country: '',
        region: '',
        segment: '',
        industry: '',
      });
      setSelectedParent(null);
      setSelectedManager(null);
      setManagerSelectionTouched(false);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingDimension(null);
    setSelectedParent(null);
    setSelectedManager(null);
    setManagerSelectionTouched(false);
    reset();
  };

  const onSubmit = (data: DimensionFormData) => {
    // Clean up empty strings and undefined values
    const cleanedData: Record<string, unknown> = {};
    
    Object.entries(data).forEach(([key, value]) => {
      // Keep required fields
      if (key === 'code' || key === 'name') {
        cleanedData[key] = value;
        return;
      }
      // Skip empty strings
      if (value === '' || value === undefined || value === null) {
        return;
      }
      // Skip NaN numbers
      if (typeof value === 'number' && isNaN(value)) {
        return;
      }
      cleanedData[key] = value;
    });

    // Add parent if selected
    if (activeType === 'account' || activeType === 'cost_center') {
      cleanedData.parentId = selectedParent?.id ?? null;
    }

    if (activeType === 'cost_center' && (!editingDimension || managerSelectionTouched)) {
      cleanedData.managerId = selectedManager?.id ?? null;
    }

    if (editingDimension) {
      updateMutation.mutate({ id: editingDimension.id, data: cleanedData as DimensionFormData });
    } else {
      createMutation.mutate(cleanedData as DimensionFormData);
    }
  };

  const handleDelete = (dimension: Dimension) => {
    if (confirm(`Are you sure you want to delete "${dimension.name}"?`)) {
      deleteMutation.mutate(dimension.id);
    }
  };

  const flatDimensions = hierarchy || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dimensions</h1>
          <p className="text-secondary-500 mt-1">
            Manage operational master data across locations, customers, accounts, and cost centers
          </p>
        </div>
        <button className="btn-primary" onClick={() => handleOpenModal()}>
          <PlusIcon className="w-5 h-5 mr-2" />
          Add Dimension
        </button>
      </div>

      {/* Tabs */}
      <Tab.Group
        selectedIndex={dimensionTypes.findIndex((t) => t.value === activeType)}
        onChange={(index) => setActiveType(dimensionTypes[index].value)}
      >
        <Tab.List className="flex space-x-2 bg-secondary-100 dark:bg-secondary-800 rounded-lg p-1">
          {dimensionTypes.map((type) => (
            <Tab
              key={type.value}
              className={({ selected }) =>
                clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-1 justify-center',
                  selected
                    ? 'bg-white dark:bg-secondary-700 text-primary-600 shadow'
                    : 'text-secondary-600 hover:bg-white/50 dark:hover:bg-secondary-700/50',
                )
              }
            >
              {type.icon}
              {type.label}
            </Tab>
          ))}
        </Tab.List>
      </Tab.Group>

      {/* Search */}
      <div className="relative">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
        <input
          type="text"
          placeholder={`Search ${activeType}s...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-10 w-full max-w-md"
        />
      </div>

      {/* Dimensions List */}
      <div className="card">
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
          </div>
        ) : !dimensions || dimensions.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-secondary-100 dark:bg-secondary-800 flex items-center justify-center mb-4">
              {activeTypeConfig.icon}
            </div>
            <h3 className="text-lg font-medium">No {activeTypeConfig.label.toLowerCase()} found</h3>
            <p className="text-secondary-500 mt-1">
              Get started by adding your first {activeTypeConfig.singularLabel.toLowerCase()}.
            </p>
            <button
              className="btn-primary mt-4"
              onClick={() => handleOpenModal()}
            >
              <PlusIcon className="w-5 h-5 mr-2" />
              Add {activeTypeConfig.singularLabel}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-secondary-200 dark:divide-secondary-700">
            {dimensions.map((dimension) => (
              <div
                key={dimension.id}
                className="p-4 flex items-center justify-between hover:bg-secondary-50 dark:hover:bg-secondary-800/50"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={clsx(
                      'w-10 h-10 rounded-lg flex items-center justify-center',
                      dimension.isActive
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600'
                        : 'bg-secondary-100 dark:bg-secondary-800 text-secondary-400',
                    )}
                  >
                    {activeTypeConfig.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{dimension.name}</span>
                      <span className="text-sm text-secondary-500">
                        ({dimension.code})
                      </span>
                      {!dimension.isActive && (
                        <span className="badge badge-secondary">Inactive</span>
                      )}
                    </div>
                    {dimension.description && (
                      <p className="text-sm text-secondary-500 mt-0.5">
                        {dimension.description}
                      </p>
                    )}
                    {dimension.parentId && (
                      <p className="text-xs text-secondary-400 mt-1">
                        Parent:{' '}
                        {flatDimensions.find((d) => d.id === dimension.parentId)
                          ?.name || 'Unknown'}
                      </p>
                    )}
                    {activeType === 'cost_center' && dimension.manager && (
                      <p className="text-xs text-secondary-400 mt-1">
                        Manager: {dimension.manager}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenModal(dimension)}
                    className="p-2 hover:bg-secondary-100 dark:hover:bg-secondary-700 rounded-lg transition-colors"
                  >
                    <PencilIcon className="w-5 h-5 text-secondary-500" />
                  </button>
                  <button
                    onClick={() => handleDelete(dimension)}
                    className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                  >
                    <TrashIcon className="w-5 h-5 text-red-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      <Transition appear show={isModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={handleCloseModal}>
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
                    {editingDimension ? 'Edit' : 'Add'}{' '}
                    {activeTypeConfig.singularLabel}
                  </Dialog.Title>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div>
                      <label className="label">Code</label>
                      <input
                        type="text"
                        {...register('code')}
                        className="input w-full"
                        placeholder="e.g., PROD-001"
                      />
                      {errors.code && (
                        <p className="text-sm text-red-500 mt-1">
                          {errors.code.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="label">Name</label>
                      <input
                        type="text"
                        {...register('name')}
                        className="input w-full"
                        placeholder={`${activeTypeConfig.singularLabel} name`}
                      />
                      {errors.name && (
                        <p className="text-sm text-red-500 mt-1">
                          {errors.name.message}
                        </p>
                      )}
                    </div>

                    {/* Account Type - Required for accounts */}
                    {activeType === 'account' && (
                      <div>
                        <label className="label">Account Type *</label>
                        <select {...register('type')} className="input w-full">
                          {accountTypes.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Location Type */}
                    {activeType === 'location' && (
                      <div>
                        <label className="label">Location Type</label>
                        <select {...register('type')} className="input w-full">
                          {locationTypes.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Customer Type */}
                    {activeType === 'customer' && (
                      <div>
                        <label className="label">Customer Type</label>
                        <select {...register('type')} className="input w-full">
                          {customerTypes.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {activeType === 'cost_center' && (
                      <div>
                        <label className="label">Manager</label>
                        <Listbox
                          value={selectedManager}
                          onChange={(manager) => {
                            setSelectedManager(manager);
                            setManagerSelectionTouched(true);
                          }}
                        >
                          <div className="relative">
                            <Listbox.Button className="input w-full text-left flex items-center justify-between">
                              <span>{selectedManager ? getUserLabel(selectedManager) : 'None'}</span>
                              <ChevronUpDownIcon className="w-5 h-5 text-secondary-400" />
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="absolute z-10 mt-1 w-full bg-white dark:bg-secondary-700 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-600 max-h-60 overflow-auto">
                                <Listbox.Option
                                  value={null}
                                  className={({ active }) =>
                                    clsx(
                                      'px-4 py-2 cursor-pointer',
                                      active && 'bg-primary-50 dark:bg-primary-900/30',
                                    )
                                  }
                                >
                                  None
                                </Listbox.Option>
                                {managerUsers.map((manager) => (
                                  <Listbox.Option
                                    key={manager.id}
                                    value={manager}
                                    className={({ active }) =>
                                      clsx(
                                        'px-4 py-2 cursor-pointer flex items-center justify-between',
                                        active && 'bg-primary-50 dark:bg-primary-900/30',
                                      )
                                    }
                                  >
                                    {({ selected }) => (
                                      <>
                                        <span>{getUserLabel(manager)}</span>
                                        {selected && (
                                          <CheckIcon className="w-5 h-5 text-primary-500" />
                                        )}
                                      </>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                        {editingDimension?.manager && !selectedManager && (
                          <p className="text-xs text-secondary-500 mt-1">
                            Current manager: {editingDimension.manager}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Category - for accounts */}
                    {activeType === 'account' && (
                      <div>
                        <label className="label">Category</label>
                        <input
                          type="text"
                          {...register('category')}
                          className="input w-full"
                          placeholder="e.g., Sales"
                        />
                      </div>
                    )}

                    {/* Location-specific fields */}
                    {activeType === 'location' && (
                      <>
                        <div>
                          <label className="label">Address</label>
                          <input
                            type="text"
                            {...register('address')}
                            className="input w-full"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="label">City</label>
                            <input
                              type="text"
                              {...register('city')}
                              className="input w-full"
                            />
                          </div>
                          <div>
                            <label className="label">State</label>
                            <input
                              type="text"
                              {...register('state')}
                              className="input w-full"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="label">Country</label>
                            <input
                              type="text"
                              {...register('country')}
                              className="input w-full"
                            />
                          </div>
                          <div>
                            <label className="label">Region</label>
                            <input
                              type="text"
                              {...register('region')}
                              className="input w-full"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {/* Customer-specific fields */}
                    {activeType === 'customer' && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="label">Segment</label>
                            <input
                              type="text"
                              {...register('segment')}
                              className="input w-full"
                              placeholder="e.g., Enterprise"
                            />
                          </div>
                          <div>
                            <label className="label">Industry</label>
                            <input
                              type="text"
                              {...register('industry')}
                              className="input w-full"
                              placeholder="e.g., Technology"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="label">Country</label>
                            <input
                              type="text"
                              {...register('country')}
                              className="input w-full"
                            />
                          </div>
                          <div>
                            <label className="label">Region</label>
                            <input
                              type="text"
                              {...register('region')}
                              className="input w-full"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    <div>
                      <label className="label">Parent (optional)</label>
                      <Listbox value={selectedParent} onChange={setSelectedParent}>
                        <div className="relative">
                          <Listbox.Button className="input w-full text-left flex items-center justify-between">
                            <span>
                              {selectedParent ? selectedParent.name : 'None'}
                            </span>
                            <ChevronUpDownIcon className="w-5 h-5 text-secondary-400" />
                          </Listbox.Button>
                          <Transition
                            as={Fragment}
                            leave="transition ease-in duration-100"
                            leaveFrom="opacity-100"
                            leaveTo="opacity-0"
                          >
                            <Listbox.Options className="absolute z-10 mt-1 w-full bg-white dark:bg-secondary-700 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-600 max-h-60 overflow-auto">
                              <Listbox.Option
                                value={null}
                                className={({ active }) =>
                                  clsx(
                                    'px-4 py-2 cursor-pointer',
                                    active && 'bg-primary-50 dark:bg-primary-900/30',
                                  )
                                }
                              >
                                None
                              </Listbox.Option>
                              {flatDimensions
                                .filter((d) => d.id !== editingDimension?.id)
                                .map((dimension) => (
                                  <Listbox.Option
                                    key={dimension.id}
                                    value={dimension}
                                    className={({ active }) =>
                                      clsx(
                                        'px-4 py-2 cursor-pointer flex items-center justify-between',
                                        active &&
                                          'bg-primary-50 dark:bg-primary-900/30',
                                      )
                                    }
                                  >
                                    {({ selected }) => (
                                      <>
                                        <span>{dimension.name}</span>
                                        {selected && (
                                          <CheckIcon className="w-5 h-5 text-primary-500" />
                                        )}
                                      </>
                                    )}
                                  </Listbox.Option>
                                ))}
                            </Listbox.Options>
                          </Transition>
                        </div>
                      </Listbox>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        {...register('isActive')}
                        id="isActive"
                        className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                      />
                      <label htmlFor="isActive" className="ml-2 text-sm">
                        Active
                      </label>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                      <button
                        type="button"
                        onClick={handleCloseModal}
                        className="btn-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={createMutation.isPending || updateMutation.isPending}
                        className="btn-primary"
                      >
                        {createMutation.isPending || updateMutation.isPending
                          ? 'Saving...'
                          : editingDimension
                            ? 'Update'
                            : 'Create'}
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
