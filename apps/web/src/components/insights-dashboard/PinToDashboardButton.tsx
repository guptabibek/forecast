import { useState } from 'react';
import { Menu } from '@headlessui/react';
import { BookmarkIcon, CheckIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useDashboards, usePinReport } from '../../hooks/useInsightsDashboard';
import type { AiReportResponse } from '../../services/api/ai-reporting.service';

interface PinToDashboardButtonProps {
  result: AiReportResponse | null;
}

/**
 * Shown next to a successful single-report AI answer. Pins the report to one
 * of the user's dashboards by request id — the server copies the validated
 * semantic query from its own audit trail.
 */
export function PinToDashboardButton({ result }: PinToDashboardButtonProps) {
  const [pinned, setPinned] = useState<string | null>(null);
  const dashboards = useDashboards(Boolean(result));
  const pin = usePinReport();

  if (!result || result.status !== 'success' || result.queryKind !== 'single_report' || !result.requestId) {
    return null;
  }

  const pinTo = (dashboardId?: string) => {
    // No title sent — the server picks the best one (semantic title when
    // meaningful, otherwise the original question).
    pin.mutate(
      { requestId: result.requestId, dashboardId },
      {
        onSuccess: () => {
          setPinned(result.requestId);
          toast.success('Report pinned to dashboard');
        },
        onError: (error: unknown) => {
          const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
          toast.error(message ?? 'Could not pin this report');
        },
      },
    );
  };

  if (pinned === result.requestId) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
        <CheckIcon className="h-4 w-4" /> Pinned
      </span>
    );
  }

  const list = dashboards.data ?? [];
  if (list.length <= 1) {
    return (
      <button
        type="button"
        disabled={pin.isPending}
        onClick={() => pinTo(list[0]?.id)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
      >
        <BookmarkIcon className="h-4 w-4" /> Pin to Dashboard
      </button>
    );
  }

  return (
    <Menu as="div" className="relative inline-block">
      <Menu.Button
        disabled={pin.isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
      >
        <BookmarkIcon className="h-4 w-4" /> Pin to Dashboard
      </Menu.Button>
      <Menu.Items className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
        {list.map((dashboard) => (
          <Menu.Item key={dashboard.id}>
            {({ active }) => (
              <button
                type="button"
                onClick={() => pinTo(dashboard.id)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-gray-700 ${active ? 'bg-gray-50' : ''}`}
              >
                <span className="truncate">{dashboard.name}</span>
                {dashboard.isDefault && <span className="ml-2 text-[10px] uppercase text-gray-400">default</span>}
              </button>
            )}
          </Menu.Item>
        ))}
      </Menu.Items>
    </Menu>
  );
}
