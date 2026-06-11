import { useEffect, useMemo, useState } from 'react';
import { Menu } from '@headlessui/react';
import {
  ChevronDownIcon,
  DocumentDuplicateIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid';
import toast from 'react-hot-toast';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, LoadingSpinner } from '../../components/ui';
import { InsightCard } from '../../components/insights-dashboard/InsightCard';
import { WidgetCard } from '../../components/insights-dashboard/WidgetCard';
import {
  useCloneDashboard,
  useCreateDashboard,
  useDashboards,
  useDashboardWidgets,
  useDeleteDashboard,
  useGenerateInsights,
  useInsights,
  useInsightSummary,
  useUpdateDashboard,
  useUpdateLayout,
} from '../../hooks/useInsightsDashboard';
import { canUseAiReporting, getFallbackPathForRole, roleMatches } from '../../permissions';
import { useAuthStore } from '../../stores/auth.store';
import { useBranding } from '../../components/ThemeProvider';
import type { DashboardWidget, InsightSeverity, WidgetSize } from '../../services/api/insights-dashboard.service';

const SIZE_SPANS: Record<WidgetSize, string> = {
  small: '',
  medium: 'md:col-span-1 xl:col-span-2',
  large: 'md:col-span-2 xl:col-span-3',
  full: 'md:col-span-2 xl:col-span-4',
};

function apiErrorMessage(error: unknown): string | undefined {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
}

const SEVERITY_FILTERS: Array<{ value: InsightSeverity | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'info', label: 'Info' },
];

export default function InsightsDashboard() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const { settings, isLoading: isSettingsLoading } = useBranding();
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<InsightSeverity | 'all'>('all');
  const [insightPage, setInsightPage] = useState(1);
  const [dragWidgetId, setDragWidgetId] = useState<string | null>(null);

  const dashboards = useDashboards();
  const activeDashboardId = selectedDashboardId ?? dashboards.data?.find((d) => d.isDefault)?.id ?? dashboards.data?.[0]?.id ?? null;
  const widgetsQuery = useDashboardWidgets(activeDashboardId);
  const summary = useInsightSummary();
  const insights = useInsights({
    status: ['NEW', 'ACTIVE', 'ACKNOWLEDGED'],
    severity: severityFilter === 'all' ? undefined : [severityFilter],
    page: insightPage,
    pageSize: 10,
  });

  const createDashboard = useCreateDashboard();
  const updateDashboard = useUpdateDashboard();
  const deleteDashboard = useDeleteDashboard();
  const cloneDashboard = useCloneDashboard();
  const updateLayout = useUpdateLayout();
  const generate = useGenerateInsights();

  const serverWidgets = useMemo(() => widgetsQuery.data?.widgets ?? [], [widgetsQuery.data]);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  useEffect(() => {
    setOrderedIds(serverWidgets.map((widget) => widget.id));
  }, [serverWidgets]);

  const orderedWidgets = useMemo(() => {
    const byId = new Map(serverWidgets.map((widget) => [widget.id, widget]));
    const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as DashboardWidget[];
    for (const widget of serverWidgets) {
      if (!orderedIds.includes(widget.id)) ordered.push(widget);
    }
    return ordered;
  }, [serverWidgets, orderedIds]);

  if (isSettingsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!canUseAiReporting(user, settings?.aiReporting?.enabled === true)) {
    return <Navigate to={getFallbackPathForRole(user?.role)} replace />;
  }

  const isAdmin = roleMatches(user?.role, 'ADMIN') || user?.role === 'SUPER_ADMIN';
  const activeDashboard = dashboards.data?.find((dashboard) => dashboard.id === activeDashboardId) ?? null;

  const onDropOnWidget = (targetId: string) => {
    if (!dragWidgetId || dragWidgetId === targetId || !activeDashboardId) return;
    const next = [...orderedIds];
    const from = next.indexOf(dragWidgetId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, dragWidgetId);
    setOrderedIds(next);
    setDragWidgetId(null);
    updateLayout.mutate({
      dashboardId: activeDashboardId,
      items: next.map((widgetId, position) => ({ widgetId, position })),
    });
  };

  const newDashboard = () => {
    const name = window.prompt('Dashboard name');
    if (!name?.trim()) return;
    createDashboard.mutate(
      { name: name.trim() },
      {
        onSuccess: (dashboard) => setSelectedDashboardId(dashboard.id),
        onError: (error: unknown) => toast.error(apiErrorMessage(error) ?? 'Could not create dashboard'),
      },
    );
  };

  const removeDashboard = () => {
    if (!activeDashboard) return;
    if (!window.confirm(`Delete dashboard "${activeDashboard.name}" and its ${activeDashboard.widgetCount} widgets?`)) return;
    deleteDashboard.mutate(activeDashboard.id, {
      onSuccess: () => {
        setSelectedDashboardId(null);
        toast.success('Dashboard deleted');
      },
    });
  };

  const bySeverity = summary.data?.bySeverity;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-950 lg:text-2xl">AI Insights</h1>
          <p className="mt-1 text-sm text-gray-500">
            Automatically generated business insights and your pinned AI reports, in one command center.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              isLoading={generate.isPending}
              onClick={() =>
                generate.mutate(undefined, {
                  onSuccess: () => toast.success('Insights regenerated'),
                  onError: (error: unknown) => toast.error(apiErrorMessage(error) ?? 'Insight generation failed'),
                })
              }
              leftIcon={<SparklesIcon className="h-4 w-4" />}
            >
              Generate now
            </Button>
          )}
        </div>
      </div>

      {/* Insight summary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <SummaryTile label="Open insights" value={summary.data?.openTotal} loading={summary.isLoading} accent="text-gray-900" />
        <SummaryTile label="New" value={summary.data?.newCount} loading={summary.isLoading} accent="text-primary-700" />
        <SummaryTile label="Critical" value={bySeverity?.critical} loading={summary.isLoading} accent="text-red-700" />
        <SummaryTile label="High" value={bySeverity?.high} loading={summary.isLoading} accent="text-orange-700" />
        <SummaryTile label="Medium" value={bySeverity?.medium} loading={summary.isLoading} accent="text-amber-700" />
        <SummaryTile label="Low / Info" value={(bySeverity?.low ?? 0) + (bySeverity?.info ?? 0)} loading={summary.isLoading} accent="text-blue-700" />
      </div>

      {/* Insight feed — full-width card grid */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900">Generated insights</h2>
            <div className="flex flex-wrap gap-1.5">
              {SEVERITY_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => {
                    setSeverityFilter(filter.value);
                    setInsightPage(1);
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    severityFilter === filter.value
                      ? 'bg-primary-600 text-white'
                      : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          {summary.data?.lastGeneratedAt && (
            <span className="text-[11px] text-gray-400">
              Updated {new Date(summary.data.lastGeneratedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        {insights.isLoading ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-72 animate-pulse rounded-2xl border border-gray-200 bg-white p-5">
                <div className="mb-4 h-12 w-12 rounded-xl bg-gray-100" />
                <div className="mb-3 h-8 w-1/3 rounded bg-gray-100" />
                <div className="mb-2 h-4 w-full rounded bg-gray-100" />
                <div className="h-4 w-2/3 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ) : !insights.data?.insights.length ? (
          <Card padding="sm">
            <EmptyState
              title="No open insights"
              description={isAdmin ? 'Use "Generate now" to run the insight providers for your data.' : 'Insights will appear here once generated.'}
            />
          </Card>
        ) : (
          <>
            <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
              {insights.data.insights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
            {insights.data.total > insights.data.page * insights.data.pageSize && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setInsightPage((page) => page + 1)}>
                Load more ({insights.data.total - insights.data.page * insights.data.pageSize} remaining)
              </Button>
            )}
          </>
        )}
      </section>

      {/* Pinned widgets */}
      <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Menu as="div" className="relative">
                <Menu.Button className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-50">
                  {activeDashboard?.isDefault ? <StarSolidIcon className="h-4 w-4 text-amber-400" /> : null}
                  {activeDashboard?.name ?? 'Dashboard'}
                  <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                </Menu.Button>
                <Menu.Items className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
                  {(dashboards.data ?? []).map((dashboard) => (
                    <Menu.Item key={dashboard.id}>
                      {({ active }) => (
                        <button
                          type="button"
                          onClick={() => setSelectedDashboardId(dashboard.id)}
                          className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${active ? 'bg-gray-50' : ''} ${dashboard.id === activeDashboardId ? 'font-semibold text-primary-700' : 'text-gray-700'}`}
                        >
                          <span className="truncate">{dashboard.name}</span>
                          <span className="ml-2 shrink-0 text-[11px] text-gray-400">{dashboard.widgetCount}</span>
                        </button>
                      )}
                    </Menu.Item>
                  ))}
                </Menu.Items>
              </Menu>
              <button
                type="button"
                onClick={newDashboard}
                className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-50"
                title="New dashboard"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
              {activeDashboard && (
                <>
                  <button
                    type="button"
                    onClick={() => cloneDashboard.mutate({ dashboardId: activeDashboard.id }, { onSuccess: (d) => setSelectedDashboardId(d.id) })}
                    className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-50"
                    title="Clone dashboard"
                  >
                    <DocumentDuplicateIcon className="h-4 w-4" />
                  </button>
                  {!activeDashboard.isDefault && (
                    <button
                      type="button"
                      onClick={() => updateDashboard.mutate({ dashboardId: activeDashboard.id, isDefault: true })}
                      className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-50"
                      title="Set as default"
                    >
                      <StarIcon className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={removeDashboard}
                    className="rounded-lg border border-gray-200 bg-white p-1.5 text-red-500 hover:bg-red-50"
                    title="Delete dashboard"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
            <span className="text-xs text-gray-400">Drag the handle on a widget to reorder</span>
          </div>

          {widgetsQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card padding="sm"><div className="h-48 animate-pulse rounded-lg bg-gray-100" /></Card>
              <Card padding="sm"><div className="h-48 animate-pulse rounded-lg bg-gray-100" /></Card>
            </div>
          ) : !orderedWidgets.length ? (
            <Card>
              <EmptyState
                title="No pinned reports yet"
                description='Run a question in AI Reporting and click "Pin to Dashboard" to build your command center.'
                action={
                  <Button size="sm" onClick={() => navigate('/reports/ai')} leftIcon={<SparklesIcon className="h-4 w-4" />}>
                    Open AI Reporting
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {orderedWidgets.map((widget) => (
                <div key={widget.id} className={SIZE_SPANS[widget.size] ?? ''}>
                  <WidgetCard
                    widget={widget}
                    onDragStart={() => setDragWidgetId(widget.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => onDropOnWidget(widget.id)}
                  />
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}

function SummaryTile({ label, value, loading, accent }: { label: string; value?: number; loading: boolean; accent: string }) {
  return (
    <Card padding="sm">
      <div className="text-xs font-medium uppercase text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent}`}>{loading ? '—' : (value ?? 0).toLocaleString('en-IN')}</div>
    </Card>
  );
}
