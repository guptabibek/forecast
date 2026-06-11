import { useState } from 'react';
import { Menu } from '@headlessui/react';
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  Bars3Icon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { Card, EmptyState } from '../ui';
import { AiChartRenderer } from '../reports/AiChartRenderer';
import { AiKpiCard } from '../reports/AiKpiCard';
import { AiReportTable } from '../reports/AiReportTable';
import {
  useDuplicateWidget,
  useRefreshWidget,
  useUnpinWidget,
  useUpdateWidget,
  useWidgetData,
} from '../../hooks/useInsightsDashboard';
import type { DashboardWidget, WidgetSize } from '../../services/api/insights-dashboard.service';

const SIZE_LABELS: Record<WidgetSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  full: 'Full Width',
};

interface WidgetCardProps {
  widget: DashboardWidget;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: () => void;
}

export function WidgetCard({ widget, onDragStart, onDragOver, onDrop }: WidgetCardProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = useWidgetData(widget.id, widget.refreshIntervalSec);
  const refresh = useRefreshWidget();
  const unpin = useUnpinWidget();
  const duplicate = useDuplicateWidget();
  const update = useUpdateWidget();

  const result = data.data;
  const isLoading = data.isLoading || refresh.isPending;

  const body = isLoading ? (
    <WidgetSkeleton />
  ) : data.isError ? (
    <EmptyState
      title="Widget failed to load"
      description="The report could not be executed. Try refreshing, or unpin the widget if the problem persists."
    />
  ) : !result ? null : result.status === 'unsupported' ? (
    <EmptyState
      title="Report no longer supported"
      description={result.unsupportedReason ?? 'The reporting catalog changed since this report was pinned.'}
    />
  ) : (
    <div className="space-y-3">
      {result.kpis.length > 0 && (
        <div className={`grid gap-2 ${widget.size === 'small' ? 'grid-cols-1' : 'grid-cols-2 xl:grid-cols-4'}`}>
          {result.kpis.slice(0, widget.size === 'small' ? 2 : 4).map((kpi) => (
            <AiKpiCard
              key={kpi.label}
              label={kpi.label}
              value={kpi.value}
              hint={kpi.hint}
              column={{ key: kpi.label, label: kpi.label, dataType: kpi.dataType }}
            />
          ))}
        </div>
      )}
      {result.chart?.enabled && result.chart.type !== 'none' && result.chart.type !== 'kpi' ? (
        <AiChartRenderer chart={result.chart} visualization={result.visualization} columns={result.columns} rows={result.rows} />
      ) : (
        <AiReportTable title={widget.title} columns={result.columns} rows={result.rows} totals={result.grid?.totals} />
      )}
    </div>
  );

  const card = (
    <Card padding="sm" className={fullscreen ? 'flex h-full flex-col overflow-auto' : 'h-full'}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {!fullscreen && (
            <button
              type="button"
              className="mt-0.5 cursor-grab touch-none rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
              aria-label="Drag to reorder"
              draggable
              onDragStart={onDragStart}
            >
              <Bars3Icon className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900" title={widget.title}>
              {widget.title}
            </h3>
            {widget.question && (
              <p className="truncate text-xs text-gray-500" title={widget.question}>
                {widget.question}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {result?.cached && !isLoading && (
            <span className="hidden rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 sm:inline" title={`Cached at ${result.cachedAt}`}>
              cached
            </span>
          )}
          <button
            type="button"
            onClick={() => refresh.mutate(widget.id)}
            disabled={isLoading}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
            aria-label="Refresh widget"
          >
            <ArrowPathIcon className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((value) => !value)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullscreen ? <ArrowsPointingInIcon className="h-4 w-4" /> : <ArrowsPointingOutIcon className="h-4 w-4" />}
          </button>
          <Menu as="div" className="relative">
            <Menu.Button className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Widget options">
              <EllipsisVerticalIcon className="h-4 w-4" />
            </Menu.Button>
            <Menu.Items className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
              {(Object.keys(SIZE_LABELS) as WidgetSize[]).map((size) => (
                <Menu.Item key={size}>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={() => update.mutate({ widgetId: widget.id, size })}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${active ? 'bg-gray-50' : ''} ${widget.size === size ? 'font-semibold text-primary-700' : 'text-gray-700'}`}
                    >
                      {SIZE_LABELS[size]}
                    </button>
                  )}
                </Menu.Item>
              ))}
              <div className="my-1 border-t border-gray-100" />
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={() =>
                      duplicate.mutate(widget.id, {
                        onSuccess: () => toast.success('Widget duplicated'),
                      })
                    }
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 ${active ? 'bg-gray-50' : ''}`}
                  >
                    <DocumentDuplicateIcon className="h-4 w-4" /> Duplicate
                  </button>
                )}
              </Menu.Item>
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={() =>
                      unpin.mutate(widget.id, {
                        onSuccess: () => toast.success('Widget unpinned'),
                      })
                    }
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 ${active ? 'bg-red-50' : ''}`}
                  >
                    <TrashIcon className="h-4 w-4" /> Unpin
                  </button>
                )}
              </Menu.Item>
            </Menu.Items>
          </Menu>
        </div>
      </div>
      {body}
    </Card>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900/40 p-4 sm:p-8" onClick={() => setFullscreen(false)}>
        <div className="mx-auto h-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
          {card}
        </div>
      </div>
    );
  }

  return (
    <div onDragOver={onDragOver} onDrop={onDrop} className="h-full">
      {card}
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="animate-pulse space-y-3" data-testid="widget-skeleton">
      <div className="grid grid-cols-2 gap-2">
        <div className="h-16 rounded-lg bg-gray-100" />
        <div className="h-16 rounded-lg bg-gray-100" />
      </div>
      <div className="h-40 rounded-lg bg-gray-100" />
    </div>
  );
}
