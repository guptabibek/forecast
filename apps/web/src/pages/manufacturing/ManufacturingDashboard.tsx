import { QueryErrorBanner } from '@components/ui';
import { useQuery } from '@tanstack/react-query';
import {
    Activity,
    AlertTriangle,
    Archive,
    ArrowRight,
    BarChart3,
    Calculator,
    Calendar,
    CheckCircle,
    Clock,
    Factory,
    GitBranch,
    Megaphone,
    Package,
    Rocket,
    Settings2,
    TrendingUp,
    Truck,
    Warehouse,
} from 'lucide-react';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    useCapacityBottlenecks,
    useMRPExceptions,
    useMyPendingApprovals,
    usePlannedOrders,
} from '../../hooks';
import { batchService, manufacturingService } from '../../services/api';
import type { MRPException } from '../../services/api/mrp.service';
import type { WorkflowInstance } from '../../services/api/workflow.service';

// ============================================================================
// Types
// ============================================================================

interface ModuleCard {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  color: string;
  metrics?: {
    label: string;
    value: string | number;
    trend?: 'up' | 'down' | 'neutral';
  }[];
}

// ============================================================================
// Manufacturing Dashboard Component
// ============================================================================

export function ManufacturingDashboard() {
  const navigate = useNavigate();
  const [selectedPeriod, setSelectedPeriod] = useState('week');

  // Fetch dashboard metrics from API
  const { data: dashboardMetrics, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'dashboard'],
    queryFn: () => manufacturingService.getDashboard(),
  });

  const { data: batchOverview } = useQuery({
    queryKey: ['manufacturing', 'dashboard', 'batches', 'overview'],
    queryFn: () => batchService.getAll({ page: 1, pageSize: 5 }),
    staleTime: 60_000,
  });

  // Fetch key metrics
  const { data: exceptions } = useMRPExceptions({ status: 'OPEN' });
  const { data: pendingApprovals } = useMyPendingApprovals();
  const { data: plannedOrders } = usePlannedOrders({ status: 'PLANNED' });
  const { data: bottlenecks } = useCapacityBottlenecks({
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    threshold: 90,
  });

  const exceptionList = (Array.isArray(exceptions) ? exceptions : (exceptions as any)?.items ?? []) as MRPException[];
  const approvalList = (Array.isArray(pendingApprovals) ? pendingApprovals : (pendingApprovals as any)?.items ?? []) as WorkflowInstance[];
  const plannedOrderList = Array.isArray(plannedOrders) ? plannedOrders : (plannedOrders as any)?.items ?? [];
  const bottleneckList = Array.isArray(bottlenecks) ? bottlenecks : (bottlenecks as any)?.items ?? [];
  const batchSummary = batchOverview?.summary;
  const fefoQueue = (batchOverview?.items ?? []).filter((batch) => Number(batch.availableQty) > 0 && !!batch.expiryDate).slice(0, 4);

  const modules: ModuleCard[] = [
    {
      id: 'bom',
      title: 'Bill of Materials',
      description: 'Manage product structures, components, and cost rollups',
      icon: <Package className="w-6 h-6" />,
      path: '/manufacturing/bom',
      color: 'bg-blue-500',
      metrics: [
        { label: 'Active BOMs', value: dashboardMetrics?.boms?.total ?? '—' },
        { label: 'Pending Approval', value: dashboardMetrics?.boms?.pendingApproval ?? '—' },
      ],
    },
    {
      id: 'mrp',
      title: 'MRP',
      description: 'Material requirements planning and planned orders',
      icon: <Calculator className="w-6 h-6" />,
      path: '/manufacturing/mrp',
      color: 'bg-purple-500',
      metrics: [
        { label: 'Planned Orders', value: plannedOrderList.length },
        { label: 'Open Exceptions', value: exceptionList.length, trend: exceptionList.length > 10 ? 'down' : 'neutral' },
      ],
    },
    {
      id: 'capacity',
      title: 'Capacity Planning',
      description: 'Work centers, shifts, and capacity utilization',
      icon: <Factory className="w-6 h-6" />,
      path: '/manufacturing/capacity',
      color: 'bg-orange-500',
      metrics: [
        { label: 'Work Centers', value: dashboardMetrics?.workCenters?.active ?? '—' },
        { label: 'Bottlenecks', value: bottleneckList.length, trend: bottleneckList.length > 0 ? 'down' : 'up' },
      ],
    },
    {
      id: 'inventory',
      title: 'Inventory',
      description: 'Policies, levels, safety stock, and ABC analysis',
      icon: <Warehouse className="w-6 h-6" />,
      path: '/manufacturing/inventory',
      color: 'bg-green-500',
      metrics: [
        { label: 'Below Safety Stock', value: dashboardMetrics?.inventoryPolicies?.belowSafetyStock ?? '—', trend: (dashboardMetrics?.inventoryPolicies?.belowSafetyStock ?? 0) > 0 ? 'down' : 'neutral' },
        { label: 'Total Policies', value: dashboardMetrics?.inventoryPolicies?.total ?? '—' },
      ],
    },
    {
      id: 'batches',
      title: 'Batch Intelligence',
      description: 'Batch-wise stock, near-expiry, expired lots, ageing, and FEFO rotation.',
      icon: <Archive className="w-6 h-6" />,
      path: '/manufacturing/batches',
      color: 'bg-slate-700',
      metrics: [
        { label: 'Tracked Batches', value: batchSummary?.totalBatches ?? '—' },
        {
          label: 'Near Expiry 90d',
          value: batchSummary?.nearExpiry90Qty ?? '—',
          trend: (batchSummary?.nearExpiry90Qty ?? 0) > 0 ? 'down' : 'neutral',
        },
      ],
    },
    {
      id: 'workflow',
      title: 'Workflow & Approvals',
      description: 'Approval chains and workflow management',
      icon: <GitBranch className="w-6 h-6" />,
      path: '/manufacturing/workflow',
      color: 'bg-indigo-500',
      metrics: [
        { label: 'Pending Approvals', value: approvalList.length, trend: approvalList.length > 5 ? 'down' : 'neutral' },
        { label: 'Active Workflows', value: dashboardMetrics?.activeWorkflows ?? '—' },
      ],
    },
    {
      id: 'supplier',
      title: 'Suppliers',
      description: 'Supplier management and sourcing decisions',
      icon: <Truck className="w-6 h-6" />,
      path: '/manufacturing/suppliers',
      color: 'bg-cyan-500',
      metrics: [
        { label: 'Active Suppliers', value: dashboardMetrics?.suppliers?.active ?? '—' },
        { label: 'Avg Lead Time', value: dashboardMetrics?.suppliers?.avgLeadTimeDays != null ? `${dashboardMetrics.suppliers.avgLeadTimeDays} days` : '—' },
      ],
    },
    {
      id: 'sop',
      title: 'S&OP',
      description: 'Sales & Operations Planning cycles',
      icon: <TrendingUp className="w-6 h-6" />,
      path: '/manufacturing/sop',
      color: 'bg-pink-500',
      metrics: [
        { label: 'Current Cycle', value: dashboardMetrics?.sopCycles?.currentCycle || '—' },
        { label: 'Status', value: dashboardMetrics?.sopCycles?.currentStatus?.replace(/_/g, ' ') || '—' },
      ],
    },
    {
      id: 'npi',
      title: 'New Products (NPI)',
      description: 'New product introduction and launch planning',
      icon: <Rocket className="w-6 h-6" />,
      path: '/manufacturing/npi',
      color: 'bg-amber-500',
      metrics: [
        { label: 'In Development', value: dashboardMetrics?.npi?.inDevelopment ?? '—' },
        { label: 'Pre-Launch', value: dashboardMetrics?.npi?.preLaunch ?? '—' },
      ],
    },
    {
      id: 'promotions',
      title: 'Promotions',
      description: 'Promotional events and forecast overlays',
      icon: <Megaphone className="w-6 h-6" />,
      path: '/manufacturing/promotions',
      color: 'bg-rose-500',
      metrics: [
        { label: 'Active Promos', value: dashboardMetrics?.promotions?.active ?? '—' },
        { label: 'Upcoming', value: dashboardMetrics?.promotions?.upcoming ?? '—' },
      ],
    },
    {
      id: 'fiscal-calendar',
      title: 'Fiscal Calendar',
      description: 'Fiscal periods and time hierarchy',
      icon: <Calendar className="w-6 h-6" />,
      path: '/manufacturing/fiscal-calendar',
      color: 'bg-teal-500',
      metrics: [
        { label: 'Calendar Type', value: dashboardMetrics?.fiscalCalendar?.type || '—' },
        { label: 'Active Cycles', value: dashboardMetrics?.sopCycles?.active ?? '—' },
      ],
    },
  ];

  const getTrendIcon = (trend?: 'up' | 'down' | 'neutral') => {
    switch (trend) {
      case 'up':
        return <span className="text-green-500">↑</span>;
      case 'down':
        return <span className="text-red-500">↓</span>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Manufacturing Hub
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Enterprise manufacturing planning and operations
              </p>
            </div>
            <div className="flex items-center gap-4">
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
              >
                <option value="day">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="quarter">This Quarter</option>
              </select>
              <button onClick={() => navigate('/settings')} className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                <Settings2 className="w-4 h-4" />
                Settings
              </button>
            </div>
          </div>
        </div>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      {/* Alert Banner */}
      {(exceptionList.length > 0 || bottleneckList.length > 0) && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <span className="text-sm text-amber-800 dark:text-amber-200">
                {exceptionList.length > 0 && `${exceptionList.length} MRP exceptions require attention. `}
                {bottleneckList.length > 0 && `${bottleneckList.length} capacity bottlenecks detected.`}
              </span>
              <button onClick={() => navigate('/manufacturing/mrp')} className="ml-auto text-sm font-medium text-amber-700 dark:text-amber-300 hover:underline">
                View Details →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Quick Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Pending Actions</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {approvalList.length + exceptionList.length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Active Suppliers</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{dashboardMetrics?.suppliers?.active ?? '—'}</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <BarChart3 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Active S&OP Cycles</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{dashboardMetrics?.sopCycles?.active ?? '—'}</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Avg Lead Time</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{dashboardMetrics?.suppliers?.avgLeadTimeDays != null ? `${dashboardMetrics.suppliers.avgLeadTimeDays}d` : '—'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Module Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {modules.map((module) => (
            <div
              key={module.id}
              onClick={() => navigate(module.path)}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 ${module.color} rounded-xl text-white`}>
                  {module.icon}
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                {module.title}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {module.description}
              </p>
              {module.metrics && (
                <div className="flex gap-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                  {module.metrics.map((metric, idx) => (
                    <div key={idx} className="flex-1">
                      <p className="text-xs text-gray-500 dark:text-gray-400">{metric.label}</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1">
                        {metric.value}
                        {getTrendIcon(metric.trend)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 bg-slate-950 rounded-2xl border border-slate-800 p-6 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">
                Phase 1 live
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">Batch stock, expiry, and ageing are now live in UI</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Use Batch Intelligence for batch-wise stock, near-expiry, expired, ageing, and FEFO views powered by the live Marg-backed inventory sync.
              </p>
            </div>
            <button
              onClick={() => navigate('/manufacturing/batches')}
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              Open Batch Intelligence
            </button>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Tracked Batches</p>
              <p className="mt-3 text-3xl font-semibold">{batchSummary?.totalBatches ?? '—'}</p>
              <p className="mt-2 text-sm text-slate-300">Total quantity {batchSummary?.totalQty ?? '—'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Near Expiry 30d</p>
              <p className="mt-3 text-3xl font-semibold">{batchSummary?.nearExpiry30Qty ?? '—'}</p>
              <p className="mt-2 text-sm text-slate-300">Value at risk {batchSummary?.nearExpiry30Value ?? '—'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Near Expiry 90d</p>
              <p className="mt-3 text-3xl font-semibold">{batchSummary?.nearExpiry90Qty ?? '—'}</p>
              <p className="mt-2 text-sm text-slate-300">Use this for replenishment and FEFO planning</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Expired Qty</p>
              <p className="mt-3 text-3xl font-semibold">{batchSummary?.expiredQty ?? '—'}</p>
              <p className="mt-2 text-sm text-slate-300">Blocked value {batchSummary?.expiredValue ?? '—'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">FEFO Queue</p>
              <p className="mt-3 text-3xl font-semibold">{fefoQueue.length}</p>
              <p className="mt-2 text-sm text-slate-300">Priority lots ready for earliest-expiry consumption</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">What Changed</h3>
                <button
                  onClick={() => navigate('/manufacturing/batches')}
                  className="text-sm font-medium text-sky-300 hover:text-sky-200"
                >
                  View screen
                </button>
              </div>
              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                <li>Batch-wise stock list with value, availability, and status.</li>
                <li>Near-expiry and expired filters backed by live API data.</li>
                <li>Ageing buckets driven by manufacturing date.</li>
                <li>FEFO queue seeded from earliest-expiry available lots.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">FEFO Candidates</h3>
                <button
                  onClick={() => navigate('/manufacturing/batches')}
                  className="text-sm font-medium text-sky-300 hover:text-sky-200"
                >
                  Open queue
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {fefoQueue.length > 0 ? fefoQueue.map((batch) => (
                  <div key={batch.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{batch.batchNumber}</p>
                        <p className="text-xs text-slate-400">{batch.product?.name || batch.productId}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-white">{batch.availableQty} {batch.uom}</p>
                        <p className="text-xs text-slate-400">Exp {batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : '—'}</p>
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-slate-400">No FEFO candidates are currently available.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity Section */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent MRP Exceptions */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Recent MRP Exceptions
              </h3>
              <button
                onClick={() => navigate('/manufacturing/mrp')}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View All
              </button>
            </div>
            <div className="space-y-3">
              {exceptionList.slice(0, 5).map((exception) => (
                <div
                  key={exception.id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      exception.severity === 'CRITICAL' ? 'bg-red-500' :
                      exception.severity === 'HIGH' ? 'bg-orange-500' :
                      exception.severity === 'MEDIUM' ? 'bg-yellow-500' : 'bg-blue-500'
                    }`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {exception.exceptionType}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {exception.product?.sku || 'Unknown product'}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    exception.severity === 'CRITICAL' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    exception.severity === 'HIGH' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                    'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-300'
                  }`}>
                    {exception.severity}
                  </span>
                </div>
              )) || (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                  No open exceptions
                </p>
              )}
            </div>
          </div>

          {/* Pending Approvals */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Pending Approvals
              </h3>
              <button
                onClick={() => navigate('/manufacturing/workflow')}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View All
              </button>
            </div>
            <div className="space-y-3">
              {approvalList.slice(0, 5).map((approval) => (
                <div
                  key={approval.id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded">
                      <GitBranch className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {approval.template?.name || 'Workflow Approval'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Submitted {new Date(approval.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => navigate('/manufacturing/workflow')} className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    Review
                  </button>
                </div>
              )) || (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                  No pending approvals
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ManufacturingDashboard;
