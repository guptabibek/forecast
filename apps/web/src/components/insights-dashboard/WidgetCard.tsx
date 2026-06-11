import { useState } from 'react';
import { Menu } from '@headlessui/react';
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  Bars3Icon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  LightBulbIcon,
  SparklesIcon,
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
import type { DashboardWidget, WidgetAnalytics, WidgetSize } from '../../services/api/insights-dashboard.service';

const SIZE_LABELS: Record<WidgetSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  full: 'Full Width',
};

const KPI_TONES: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-800',
  negative: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800',
  neutral: 'bg-secondary-50 text-secondary-700 ring-secondary-200 dark:bg-secondary-800 dark:text-secondary-300 dark:ring-secondary-700',
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
      {result.analytics && <WidgetAnalyticsStrip analytics={result.analytics} />}
      {result.chart?.enabled && result.chart.type !== 'none' && result.chart.type !== 'kpi' ? (
        <AiChartRenderer chart={result.chart} visualization={result.visualization} columns={result.columns} rows={result.rows} />
      ) : (
        <AiReportTable title={widget.title} columns={result.columns} rows={result.rows} totals={result.grid?.totals} />
      )}
    </div>
  );

  const card = (
    <Card
      padding="sm"
      className={
        fullscreen
          ? 'flex h-full flex-col overflow-auto'
          : 'h-full transition-shadow duration-150 hover:shadow-md'
      }
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {!fullscreen && (
            <button
              type="button"
              className="mt-0.5 cursor-grab touch-none rounded p-1 text-secondary-300 hover:bg-secondary-100 hover:text-secondary-500 dark:text-secondary-600 dark:hover:bg-secondary-800 dark:hover:text-secondary-400"
              aria-label="Drag to reorder"
              draggable
              onDragStart={onDragStart}
            >
              <Bars3Icon className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold text-secondary-900 dark:text-white" title={widget.title}>
                {widget.title}
              </h3>
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 ring-1 ring-inset ring-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:ring-purple-800"
                title="Pinned AI report"
              >
                <SparklesIcon className="h-3 w-3" /> AI
              </span>
            </div>
            {widget.question && (
              <p className="truncate text-xs text-secondary-500 dark:text-secondary-400" title={widget.question}>
                {widget.question}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {result?.cached && !isLoading && (
            <span
              className="hidden rounded bg-secondary-100 px-1.5 py-0.5 text-[10px] text-secondary-500 dark:bg-secondary-800 dark:text-secondary-400 sm:inline"
              title={`Cached at ${result.cachedAt}`}
            >
              cached
            </span>
          )}
          <button
            type="button"
            onClick={() => refresh.mutate(widget.id)}
            disabled={isLoading}
            className="rounded p-1 text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700 disabled:opacity-50 dark:hover:bg-secondary-800 dark:hover:text-secondary-200"
            aria-label="Refresh widget"
          >
            <ArrowPathIcon className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((value) => !value)}
            className="rounded p-1 text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700 dark:hover:bg-secondary-800 dark:hover:text-secondary-200"
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullscreen ? <ArrowsPointingInIcon className="h-4 w-4" /> : <ArrowsPointingOutIcon className="h-4 w-4" />}
          </button>
          <Menu as="div" className="relative">
            <Menu.Button
              className="rounded p-1 text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700 dark:hover:bg-secondary-800 dark:hover:text-secondary-200"
              aria-label="Widget options"
            >
              <EllipsisVerticalIcon className="h-4 w-4" />
            </Menu.Button>
            <Menu.Items className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-secondary-200 bg-white py-1 shadow-lg focus:outline-none dark:border-secondary-700 dark:bg-secondary-900">
              {(Object.keys(SIZE_LABELS) as WidgetSize[]).map((size) => (
                <Menu.Item key={size}>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={() => update.mutate({ widgetId: widget.id, size })}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${active ? 'bg-secondary-50 dark:bg-secondary-800' : ''} ${
                        widget.size === size
                          ? 'font-semibold text-primary-700 dark:text-primary-300'
                          : 'text-secondary-700 dark:text-secondary-300'
                      }`}
                    >
                      {SIZE_LABELS[size]}
                    </button>
                  )}
                </Menu.Item>
              ))}
              <div className="my-1 border-t border-secondary-100 dark:border-secondary-800" />
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={() =>
                      duplicate.mutate(widget.id, {
                        onSuccess: () => toast.success('Widget duplicated'),
                      })
                    }
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-secondary-700 dark:text-secondary-300 ${active ? 'bg-secondary-50 dark:bg-secondary-800' : ''}`}
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
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 dark:text-red-400 ${active ? 'bg-red-50 dark:bg-red-900/30' : ''}`}
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

/**
 * The deterministic analysis the server computes for every pinned query:
 * KPI chips (total / average / growth vs previous period) and narrative
 * findings (top contributor share, Pareto concentration, trend direction).
 */
function WidgetAnalyticsStrip({ analytics }: { analytics: WidgetAnalytics }) {
  const [expanded, setExpanded] = useState(false);
  if (!analytics.kpis.length && !analytics.insights.length) return null;
  const insights = expanded ? analytics.insights : analytics.insights.slice(0, 2);
  const TrendIcon = analytics.trend?.direction === 'falling' ? ArrowTrendingDownIcon : ArrowTrendingUpIcon;

  return (
    <div
      className="rounded-lg border border-secondary-100 bg-secondary-50/60 p-3 dark:border-secondary-800 dark:bg-secondary-800/40"
      data-testid="widget-analytics"
    >
      {analytics.kpis.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {analytics.kpis.map((kpi) => (
            <span
              key={kpi.label}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${KPI_TONES[kpi.tone] ?? KPI_TONES.neutral}`}
              title={kpi.label}
            >
              <span className="text-[10px] font-normal opacity-70">{kpi.label}:</span> {kpi.value}
            </span>
          ))}
          {analytics.trend && analytics.trend.direction !== 'flat' && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${analytics.trend.direction === 'rising' ? KPI_TONES.positive : KPI_TONES.negative}`}>
              <TrendIcon className="h-3 w-3" /> {analytics.trend.direction}
            </span>
          )}
        </div>
      )}
      {insights.length > 0 && (
        <ul className="mt-2 space-y-1">
          {insights.map((line) => (
            <li key={line} className="flex items-start gap-1.5 text-xs text-secondary-600 dark:text-secondary-300">
              <LightBulbIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      {analytics.insights.length > 2 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1.5 text-[11px] font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          {expanded ? 'Show less' : `Show ${analytics.insights.length - 2} more`}
        </button>
      )}
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="animate-pulse space-y-3" data-testid="widget-skeleton">
      <div className="grid grid-cols-2 gap-2">
        <div className="h-16 rounded-lg bg-secondary-100 dark:bg-secondary-800" />
        <div className="h-16 rounded-lg bg-secondary-100 dark:bg-secondary-800" />
      </div>
      <div className="h-8 rounded-lg bg-secondary-100 dark:bg-secondary-800" />
      <div className="h-40 rounded-lg bg-secondary-100 dark:bg-secondary-800" />
    </div>
  );
}
