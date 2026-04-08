import type { PlanStatus, PlanVersion } from '@/types';
import { Menu, Transition } from '@headlessui/react';
import {
    ArchiveBoxIcon,
    CheckCircleIcon,
    ClockIcon,
    DocumentDuplicateIcon,
    EllipsisVerticalIcon,
    FunnelIcon,
    MagnifyingGlassIcon,
    PencilSquareIcon,
    PlusIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import { planService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { Fragment, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';

const statusConfig: Record<
  PlanStatus,
  { label: string; color: string; icon: React.ElementType }
> = {
  DRAFT: {
    label: 'Draft',
    color: 'bg-secondary-100 text-secondary-700',
    icon: PencilSquareIcon,
  },
  IN_REVIEW: {
    label: 'In Review',
    color: 'bg-warning-50 text-warning-600',
    icon: ClockIcon,
  },
  APPROVED: {
    label: 'Approved',
    color: 'bg-success-50 text-success-600',
    icon: CheckCircleIcon,
  },
  LOCKED: {
    label: 'Locked',
    color: 'bg-primary-50 text-primary-600',
    icon: CheckCircleIcon,
  },
  ARCHIVED: {
    label: 'Archived',
    color: 'bg-secondary-100 text-secondary-500',
    icon: ArchiveBoxIcon,
  },
};

export default function Plans() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PlanStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data, isLoading, error } = useQuery({
    queryKey: ['plans', { page, search, status: statusFilter }],
    queryFn: () =>
      planService.getAll({
        page,
        pageSize,
        search: search || undefined,
        filters: statusFilter !== 'ALL' ? { status: statusFilter } : undefined,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: planService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Plan deleted successfully');
    },
    onError: () => {
      toast.error('Failed to delete plan');
    },
  });

  const cloneMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      planService.clone(id, name),
    onSuccess: (newPlan) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Plan cloned successfully');
      navigate(`/plans/${newPlan.id}`);
    },
    onError: () => {
      toast.error('Failed to clone plan');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: planService.archive,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Plan archived');
    },
    onError: () => {
      toast.error('Failed to archive plan');
    },
  });

  const handleClone = (plan: PlanVersion) => {
    const newName = `${plan.name} (Copy)`;
    cloneMutation.mutate({ id: plan.id, name: newName });
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this plan?')) {
      deleteMutation.mutate(id);
    }
  };

  const plans = data?.data || [];
  const totalPages = data?.meta?.totalPages || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Plans</h1>
          <p className="text-secondary-500 mt-1">
            Manage your planning versions and forecasts
          </p>
        </div>
        <Link to="/plans/new" className="btn-primary">
          <PlusIcon className="w-5 h-5 mr-2" />
          Create Plan
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
          <input
            type="text"
            placeholder="Search plans..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10 w-full"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PlanStatus | 'ALL')}
            className="input w-40"
          >
            <option value="ALL">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="IN_REVIEW">In Review</option>
            <option value="APPROVED">Approved</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <button className="btn-secondary">
            <FunnelIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Plans list */}
      {isLoading ? (
        <div className="card p-12 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
        </div>
      ) : error ? (
        <div className="card p-12 text-center">
          <p className="text-error-500">Failed to load plans</p>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['plans'] })}
            className="btn-secondary mt-4"
          >
            Retry
          </button>
        </div>
      ) : plans.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 bg-secondary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <DocumentDuplicateIcon className="w-8 h-8 text-secondary-400" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No plans found</h3>
          <p className="text-secondary-500 mb-6">
            Get started by creating your first planning version
          </p>
          <Link to="/plans/new" className="btn-primary">
            <PlusIcon className="w-5 h-5 mr-2" />
            Create Plan
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map((plan, index) => {
            const status = statusConfig[plan.status];
            const StatusIcon = status.icon;

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="card hover:shadow-md transition-shadow"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <Link
                          to={`/plans/${plan.id}`}
                          className="text-lg font-semibold hover:text-primary-600 transition-colors"
                        >
                          {plan.name}
                        </Link>
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium',
                            status.color,
                          )}
                        >
                          <StatusIcon className="w-3.5 h-3.5" />
                          {status.label}
                        </span>
                      </div>
                      {plan.description && (
                        <p className="text-secondary-500 text-sm mt-1 line-clamp-1">
                          {plan.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-3 text-sm text-secondary-500">
                        <span>FY {plan.fiscalYear}</span>
                        <span>•</span>
                        <span>
                          {format(new Date(plan.startDate), 'MMM yyyy')} -{' '}
                          {format(new Date(plan.endDate), 'MMM yyyy')}
                        </span>
                        <span>•</span>
                        <span>
                          Updated {format(new Date(plan.updatedAt), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>

                    <Menu as="div" className="relative">
                      <Menu.Button className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700">
                        <EllipsisVerticalIcon className="w-5 h-5" />
                      </Menu.Button>
                      <Transition
                        as={Fragment}
                        enter="transition ease-out duration-100"
                        enterFrom="transform opacity-0 scale-95"
                        enterTo="transform opacity-100 scale-100"
                        leave="transition ease-in duration-75"
                        leaveFrom="transform opacity-100 scale-100"
                        leaveTo="transform opacity-0 scale-95"
                      >
                        <Menu.Items className="absolute right-0 mt-2 w-48 bg-white dark:bg-secondary-800 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-700 focus:outline-none z-10">
                          <div className="p-1">
                            <Menu.Item>
                              {({ active }) => (
                                <button
                                  onClick={() => navigate(`/plans/${plan.id}`)}
                                  className={clsx(
                                    'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg',
                                    active && 'bg-secondary-100 dark:bg-secondary-700',
                                  )}
                                >
                                  <PencilSquareIcon className="w-4 h-4" />
                                  Edit
                                </button>
                              )}
                            </Menu.Item>
                            <Menu.Item>
                              {({ active }) => (
                                <button
                                  onClick={() => handleClone(plan)}
                                  className={clsx(
                                    'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg',
                                    active && 'bg-secondary-100 dark:bg-secondary-700',
                                  )}
                                >
                                  <DocumentDuplicateIcon className="w-4 h-4" />
                                  Clone
                                </button>
                              )}
                            </Menu.Item>
                            {plan.status !== 'ARCHIVED' && (
                              <Menu.Item>
                                {({ active }) => (
                                  <button
                                    onClick={() => archiveMutation.mutate(plan.id)}
                                    className={clsx(
                                      'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg',
                                      active && 'bg-secondary-100 dark:bg-secondary-700',
                                    )}
                                  >
                                    <ArchiveBoxIcon className="w-4 h-4" />
                                    Archive
                                  </button>
                                )}
                              </Menu.Item>
                            )}
                            <div className="border-t border-secondary-200 dark:border-secondary-700 my-1" />
                            <Menu.Item>
                              {({ active }) => (
                                <button
                                  onClick={() => handleDelete(plan.id)}
                                  className={clsx(
                                    'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg text-error-600',
                                    active && 'bg-error-50 dark:bg-error-900/20',
                                  )}
                                >
                                  <TrashIcon className="w-4 h-4" />
                                  Delete
                                </button>
                              )}
                            </Menu.Item>
                          </div>
                        </Menu.Items>
                      </Transition>
                    </Menu>
                  </div>
                </div>
              </motion.div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-secondary-500">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-secondary btn-sm"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="btn-secondary btn-sm"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
