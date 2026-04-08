import { QueryErrorBanner } from '@components/ui';
import { useQuery } from '@tanstack/react-query';
import {
    Activity,
    AlertTriangle,
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
import { manufacturingService } from '../../services/api';
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
