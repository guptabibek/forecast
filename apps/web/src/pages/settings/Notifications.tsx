import {
    BellIcon,
    CheckCircleIcon,
    CheckIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ExclamationCircleIcon,
    ExclamationTriangleIcon,
    InformationCircleIcon,
    TrashIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { format } from 'date-fns';
import { useState } from 'react';
import {
    useClearReadNotifications,
    useDeleteNotification,
    useMarkAllNotificationsRead,
    useMarkNotificationRead,
    useNotifications,
} from '../../hooks/useAuditNotifications';
import type { NotificationPriority, NotificationType } from '../../services/api/notification.service';

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  INFO: { icon: InformationCircleIcon, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/30' },
  WARNING: { icon: ExclamationTriangleIcon, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/30' },
  ERROR: { icon: ExclamationCircleIcon, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/30' },
  SUCCESS: { icon: CheckCircleIcon, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/30' },
  APPROVAL_REQUIRED: { icon: ExclamationTriangleIcon, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/30' },
  APPROVAL_COMPLETED: { icon: CheckCircleIcon, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
  INVENTORY_LOW: { icon: ExclamationTriangleIcon, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/30' },
  MRP_EXCEPTION: { icon: ExclamationCircleIcon, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/30' },
  WORK_ORDER_DELAY: { icon: ExclamationTriangleIcon, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/30' },
  PO_DUE: { icon: InformationCircleIcon, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/30' },
  IMPORT_COMPLETE: { icon: CheckCircleIcon, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-900/30' },
  FORECAST_COMPLETE: { icon: CheckCircleIcon, color: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-900/30' },
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  NORMAL: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
  HIGH: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300',
  URGENT: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
};

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

function timeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const secs = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
    return safeFormat(dateStr, 'MMM d, yyyy');
  } catch {
    return '—';
  }
}

export default function Notifications() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [typeFilter, setTypeFilter] = useState<NotificationType | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<NotificationPriority | ''>('');

  const params = {
    page,
    pageSize: 20,
    ...(filter === 'unread' && { isRead: false }),
    ...(filter === 'read' && { isRead: true }),
    ...(typeFilter && { type: typeFilter }),
    ...(priorityFilter && { priority: priorityFilter }),
  };

  const { data, isLoading } = useNotifications(params);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotification = useDeleteNotification();
  const clearRead = useClearReadNotifications();

  const notifications = data?.data ?? [];
  const total = data?.total ?? 0;
  const unreadCount = data?.unreadCount ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">
            Notifications
          </h1>
          <p className="text-secondary-500 mt-1">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up!'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="btn btn-secondary flex items-center gap-2"
            >
              <CheckIcon className="w-4 h-4" />
              Mark all read
            </button>
          )}
          <button
            onClick={() => {
              if (confirm('Delete all read notifications?')) {
                clearRead.mutate();
              }
            }}
            disabled={clearRead.isPending}
            className="btn btn-secondary flex items-center gap-2 text-error-600"
          >
            <TrashIcon className="w-4 h-4" />
            Clear read
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Read status filter */}
          <div className="flex items-center rounded-lg border border-secondary-200 dark:border-secondary-700 overflow-hidden">
            {(['all', 'unread', 'read'] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(1); }}
                className={clsx(
                  'px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                  filter === f
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-secondary-800 text-secondary-600 dark:text-secondary-400 hover:bg-secondary-50 dark:hover:bg-secondary-700',
                )}
              >
                {f}
                {f === 'unread' && unreadCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-error-500 text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value as NotificationType | ''); setPage(1); }}
            className="input text-sm"
          >
            <option value="">All Types</option>
            {Object.keys(TYPE_CONFIG).map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => { setPriorityFilter(e.target.value as NotificationPriority | ''); setPage(1); }}
            className="input text-sm"
          >
            <option value="">All Priorities</option>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
      </div>

      {/* Notification List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-12 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-secondary-500">Loading notifications...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-12 text-center">
            <BellIcon className="w-16 h-16 mx-auto mb-3 text-secondary-300" />
            <h3 className="text-lg font-semibold text-secondary-700 dark:text-secondary-300 mb-1">
              No notifications
            </h3>
            <p className="text-secondary-500 text-sm">
              {filter === 'unread' ? "You're all caught up!" : 'No notifications match your filters'}
            </p>
          </div>
        ) : (
          notifications.map((notification) => {
            const typeConf = TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.INFO;
            const Icon = typeConf.icon;

            return (
              <div
                key={notification.id}
                className={clsx(
                  'bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-4 transition-colors',
                  !notification.isRead && 'border-l-4 border-l-primary-500',
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={clsx('p-2 rounded-lg flex-shrink-0', typeConf.bg)}>
                    <Icon className={clsx('w-5 h-5', typeConf.color)} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className={clsx(
                          'text-sm',
                          notification.isRead
                            ? 'text-secondary-700 dark:text-secondary-300'
                            : 'font-semibold text-secondary-900 dark:text-white',
                        )}>
                          {notification.title}
                        </h4>
                        <p className="text-sm text-secondary-500 mt-0.5">
                          {notification.message}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className={clsx(
                          'inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium',
                          PRIORITY_COLORS[notification.priority] ?? PRIORITY_COLORS.NORMAL,
                        )}>
                          {notification.priority}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-secondary-400">
                        {timeAgo(notification.createdAt)}
                      </span>
                      {notification.entityType && (
                        <span className="text-xs text-secondary-400">
                          {notification.entityType}
                          {notification.entityId && ` #${notification.entityId.slice(0, 8)}`}
                        </span>
                      )}
                      <div className="flex-1" />
                      {!notification.isRead && (
                        <button
                          onClick={() => markRead.mutate(notification.id)}
                          className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
                        >
                          <CheckIcon className="w-3 h-3" />
                          Mark read
                        </button>
                      )}
                      <button
                        onClick={() => deleteNotification.mutate(notification.id)}
                        className="text-xs text-secondary-400 hover:text-error-600 flex items-center gap-1"
                      >
                        <XMarkIcon className="w-3 h-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-secondary-500">
            Page {page} of {totalPages} ({total} total)
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
  );
}
