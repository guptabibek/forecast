import {
    ArrowPathIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ClockIcon,
    DocumentMagnifyingGlassIcon,
    FunnelIcon,
    ShieldCheckIcon,
    UserIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { format } from 'date-fns';
import { useState } from 'react';
import { useAuditTrail, useAuditTrailStats } from '../../hooks/useAuditNotifications';

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  UPDATE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  VIEW: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300',
  EXPORT: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  IMPORT: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  LOGIN: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  LOGOUT: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  APPROVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  LOCK: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  UNLOCK: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
};

const ENTITY_TYPES = [
  '', 'User', 'Plan', 'Forecast', 'Scenario', 'BOM', 'MRP', 'WorkOrder',
  'PurchaseOrder', 'Inventory', 'Supplier', 'Promotion', 'NPI', 'SOP',
  'Workflow', 'FiscalCalendar', 'Settings', 'Report',
];

const ACTIONS = [
  '', 'CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT', 'IMPORT',
  'LOGIN', 'LOGOUT', 'APPROVE', 'LOCK', 'UNLOCK',
];

function safeFormat(dateStr: string | null | undefined, fmt: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return format(d, fmt);
  } catch {
    return '—';
  }
}

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const params = {
    page,
    pageSize,
    ...(entityType && { entityType }),
    ...(action && { action }),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };

  const { data: logsData, isLoading, refetch } = useAuditTrail(params);
  const { data: stats } = useAuditTrailStats(30);

  const logs = logsData?.data ?? [];
  const total = logsData?.total ?? 0;
  const totalPages = logsData?.totalPages ?? 1;

  const statCards = [
    {
      label: 'Total Actions (30d)',
      value: stats?.totalActions ?? 0,
      icon: ShieldCheckIcon,
      color: 'text-primary-600',
      bg: 'bg-primary-50 dark:bg-primary-900/30',
    },
    {
      label: 'Unique Users',
      value: stats?.topUsers?.length ?? 0,
      icon: UserIcon,
      color: 'text-blue-600',
      bg: 'bg-blue-50 dark:bg-blue-900/30',
    },
    {
      label: 'Entity Types',
      value: stats?.topEntities?.length ?? 0,
      icon: DocumentMagnifyingGlassIcon,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    },
    {
      label: 'Most Common',
      value: stats?.actionBreakdown?.[0]?.action ?? '—',
      icon: ClockIcon,
      color: 'text-purple-600',
      bg: 'bg-purple-50 dark:bg-purple-900/30',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">
            Audit Log
          </h1>
          <p className="text-secondary-500 mt-1">
            Track all system activity and changes across your organization
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="btn btn-secondary flex items-center gap-2"
        >
          <ArrowPathIcon className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-4"
          >
            <div className="flex items-center gap-3">
              <div className={clsx('p-2 rounded-lg', card.bg)}>
                <card.icon className={clsx('w-5 h-5', card.color)} />
              </div>
              <div>
                <p className="text-xs text-secondary-500">{card.label}</p>
                <p className="text-lg font-semibold text-secondary-900 dark:text-white">
                  {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700">
        <div className="p-4 border-b border-secondary-200 dark:border-secondary-700 flex items-center justify-between">
          <h2 className="font-semibold text-secondary-900 dark:text-white">
            Activity Log ({total.toLocaleString()} entries)
          </h2>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'btn btn-sm flex items-center gap-1',
              showFilters ? 'btn-primary' : 'btn-secondary',
            )}
          >
            <FunnelIcon className="w-4 h-4" />
            Filters
          </button>
        </div>

        {showFilters && (
          <div className="p-4 border-b border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-800/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1">
                Entity Type
              </label>
              <select
                value={entityType}
                onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
                className="input text-sm w-full"
              >
                <option value="">All Types</option>
                {ENTITY_TYPES.filter(Boolean).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1">
                Action
              </label>
              <select
                value={action}
                onChange={(e) => { setAction(e.target.value); setPage(1); }}
                className="input text-sm w-full"
              >
                <option value="">All Actions</option>
                {ACTIONS.filter(Boolean).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="input text-sm w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="input text-sm w-full"
              />
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 dark:border-secondary-700">
                <th className="text-left p-3 text-xs font-semibold text-secondary-500 uppercase">Timestamp</th>
                <th className="text-left p-3 text-xs font-semibold text-secondary-500 uppercase">User</th>
                <th className="text-left p-3 text-xs font-semibold text-secondary-500 uppercase">Action</th>
                <th className="text-left p-3 text-xs font-semibold text-secondary-500 uppercase">Entity</th>
                <th className="text-left p-3 text-xs font-semibold text-secondary-500 uppercase">Entity ID</th>
                <th className="text-left p-3 text-xs font-semibold text-secondary-500 uppercase">IP Address</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-secondary-500">
                    <div className="flex items-center justify-center gap-2">
                      <ArrowPathIcon className="w-5 h-5 animate-spin" />
                      Loading audit logs...
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-secondary-500">
                    <ShieldCheckIcon className="w-12 h-12 mx-auto mb-2 text-secondary-300" />
                    <p>No audit log entries found</p>
                    <p className="text-xs mt-1">Activity will appear here as users interact with the system</p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-secondary-100 dark:border-secondary-700/50 hover:bg-secondary-50 dark:hover:bg-secondary-700/30"
                  >
                    <td className="p-3 whitespace-nowrap text-secondary-600 dark:text-secondary-400">
                      {safeFormat(log.createdAt, 'MMM d, yyyy HH:mm:ss')}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center">
                          <span className="text-[10px] font-medium text-primary-700 dark:text-primary-300">
                            {log.user?.firstName?.[0]}{log.user?.lastName?.[0]}
                          </span>
                        </div>
                        <span className="text-secondary-900 dark:text-white">
                          {log.user ? `${log.user.firstName} ${log.user.lastName}` : log.userId?.slice(0, 8)}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                        ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-700',
                      )}>
                        {log.action}
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap text-secondary-900 dark:text-white font-medium">
                      {log.entityType}
                    </td>
                    <td className="p-3 whitespace-nowrap text-secondary-500 font-mono text-xs">
                      {log.entityId?.slice(0, 12)}...
                    </td>
                    <td className="p-3 whitespace-nowrap text-secondary-500 text-xs">
                      {log.ipAddress ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-secondary-200 dark:border-secondary-700 flex items-center justify-between">
            <p className="text-sm text-secondary-500">
              Page {page} of {totalPages} ({total.toLocaleString()} total)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="btn btn-sm btn-secondary"
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
                const p = startPage + i;
                if (p > totalPages) return null;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={clsx(
                      'btn btn-sm',
                      p === page ? 'btn-primary' : 'btn-secondary',
                    )}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="btn btn-sm btn-secondary"
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
