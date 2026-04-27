import {
    ArchiveBoxXMarkIcon,
    ArrowTrendingDownIcon,
    BanknotesIcon,
    ClockIcon,
    CubeIcon,
    ExclamationTriangleIcon,
    MapPinIcon,
    TableCellsIcon,
} from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { AreaChart } from '../../components/charts/AreaChart';
import { BarChart } from '../../components/charts/BarChart';
import { Badge, Card, CardHeader, QueryErrorBanner } from '../../components/ui';
import {
    useDashboardKPIs,
    useExpiryLossTrend,
    useInventoryValueTrend,
    usePharmaAlerts,
} from '../../hooks/usePharmaReports';
import KpiCard from './KpiCard';
import { fmt, fmtCurrency, fmtPct } from './shared';

function DetailLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm font-medium text-secondary-700 transition-colors hover:border-primary-300 hover:text-primary-700 dark:border-secondary-700 dark:bg-secondary-900 dark:text-secondary-100 dark:hover:border-primary-500 dark:hover:text-primary-200"
    >
      {label}
    </Link>
  );
}

export default function PharmaExecutiveOverview() {
  const kpisQuery = useDashboardKPIs();
  const expiryLossQuery = useExpiryLossTrend();
  const inventoryValueQuery = useInventoryValueTrend();
  const alertsQuery = usePharmaAlerts({ alertLimit: 6 });

  const kpis = kpisQuery.data;
  const expiryTrend = expiryLossQuery.data ?? [];
  const inventoryValueTrend = inventoryValueQuery.data ?? [];
  const alerts = alertsQuery.data ?? [];

  const primaryError =
    kpisQuery.error ?? expiryLossQuery.error ?? inventoryValueQuery.error ?? alertsQuery.error;
  const hasAnyError =
    kpisQuery.isError ||
    expiryLossQuery.isError ||
    inventoryValueQuery.isError ||
    alertsQuery.isError;
  const hasRenderableData =
    Boolean(kpis) || expiryTrend.length > 0 || inventoryValueTrend.length > 0 || alerts.length > 0;
  const latestInventoryValue = inventoryValueTrend[inventoryValueTrend.length - 1];
  const cumulativeExpiryLoss = expiryTrend[expiryTrend.length - 1]?.cumulative_loss;
  const negativeStockBadgeVariant: 'error' | 'default' =
    (kpis?.negative_stock_count ?? 0) > 0 ? 'error' : 'default';

  if (!hasRenderableData && primaryError) {
    return (
      <section className="space-y-4">
        <div className="rounded-2xl border border-primary-200/60 bg-gradient-to-r from-primary-50 via-white to-amber-50 p-5 dark:border-primary-900/60 dark:from-secondary-950 dark:via-secondary-900 dark:to-secondary-950">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary-700 dark:text-primary-300">
                Pharma Operations
              </p>
              <h2 className="mt-2 text-xl font-semibold text-secondary-900 dark:text-white">
                Inventory and expiry signals inside the main dashboard
              </h2>
              <p className="mt-2 text-sm text-secondary-600 dark:text-secondary-300">
                The old standalone pharma landing page has been replaced by a single executive section here.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DetailLink to="/pharma-reports/inventory" label="Inventory Reports" />
              <DetailLink to="/pharma-reports/alerts" label="Alert Queue" />
            </div>
          </div>
        </div>
        <QueryErrorBanner error={primaryError} />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-primary-200/60 bg-gradient-to-r from-primary-50 via-white to-amber-50 p-5 dark:border-primary-900/60 dark:from-secondary-950 dark:via-secondary-900 dark:to-secondary-950">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary-700 dark:text-primary-300">
              Pharma Operations
            </p>
            <h2 className="mt-2 text-xl font-semibold text-secondary-900 dark:text-white">
              Inventory and expiry signals inside the main dashboard
            </h2>
            <p className="mt-2 text-sm text-secondary-600 dark:text-secondary-300">
              The corrected pharma executive metrics now live alongside forecasting performance. Detailed analysis remains in the pharma report pages without maintaining a second dashboard route.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={negativeStockBadgeVariant} size="sm">
              {(kpis?.negative_stock_count ?? 0) > 0
                ? `${fmt(kpis?.negative_stock_count ?? 0)} negative stock positions`
                : 'No negative stock positions'}
            </Badge>
            <Badge variant="warning" size="sm">
              {kpis?.avg_days_to_expiry != null
                ? `Avg expiry in ${fmt(kpis.avg_days_to_expiry, 0)} days`
                : 'Expiry horizon unavailable'}
            </Badge>
            <DetailLink to="/pharma-reports/inventory" label="Inventory Reports" />
            <DetailLink to="/pharma-reports/analysis" label="Stock Analysis" />
          </div>
        </div>
        {hasAnyError && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
            Some pharma widgets are showing partial data because one or more report endpoints are temporarily unavailable.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Total Inventory Value"
          value={kpisQuery.isLoading ? '...' : fmtCurrency(kpis?.total_inventory_value)}
          icon={<BanknotesIcon className="h-6 w-6" />}
          color="blue"
        />
        <KpiCard
          title="Active SKUs"
          value={kpisQuery.isLoading ? '...' : fmt(kpis?.total_sku_count)}
          icon={<CubeIcon className="h-6 w-6" />}
          color="purple"
        />
        <KpiCard
          title="Active Batches"
          value={kpisQuery.isLoading ? '...' : fmt(kpis?.total_batch_count)}
          icon={<TableCellsIcon className="h-6 w-6" />}
          color="green"
        />
        <KpiCard
          title="Locations Covered"
          value={kpisQuery.isLoading ? '...' : fmt(kpis?.total_location_count)}
          icon={<MapPinIcon className="h-6 w-6" />}
          color="gray"
        />
        <KpiCard
          title="Turnover Ratio"
          value={kpisQuery.isLoading ? '...' : (kpis?.turnover_ratio?.toFixed(2) ?? '—')}
          icon={<ArrowTrendingDownIcon className="h-6 w-6" />}
          color="green"
        />
        <KpiCard
          title="Days of Inventory"
          value={kpisQuery.isLoading ? '...' : (kpis?.days_of_inventory != null ? fmt(kpis.days_of_inventory, 0) : '—')}
          icon={<ClockIcon className="h-6 w-6" />}
          color="amber"
        />
        <KpiCard
          title="Near Expiry Exposure"
          value={kpisQuery.isLoading ? '...' : fmtPct(kpis?.pct_near_expiry_90d)}
          subtitle="Value at risk within 90 days"
          icon={<ExclamationTriangleIcon className="h-6 w-6" />}
          color="amber"
        />
        <KpiCard
          title="Dead Stock Exposure"
          value={kpisQuery.isLoading ? '...' : fmtPct(kpis?.pct_dead_stock)}
          subtitle="Share of inventory with no issues in 6 months"
          icon={<ArchiveBoxXMarkIcon className="h-6 w-6" />}
          color="red"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Inventory Value Flow"
            description="Trailing 12-month receipt and issue movements from the corrected pharma inventory pipeline"
          />
          {inventoryValueQuery.isError ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-secondary-500 dark:text-secondary-400">
              Inventory value trend is temporarily unavailable.
            </div>
          ) : inventoryValueTrend.length > 0 ? (
            <>
              <AreaChart
                data={inventoryValueTrend.map((point) => ({
                  month: point.date,
                  receipts: point.receipt_value,
                  issues: point.issue_value,
                  net: point.total_value,
                }))}
                areas={[
                  { dataKey: 'receipts', name: 'Receipts', color: '#2563EB' },
                  { dataKey: 'issues', name: 'Issues', color: '#F97316' },
                  { dataKey: 'net', name: 'Net Movement', color: '#16A34A' },
                ]}
                xAxisKey="month"
                height={300}
                formatYAxis={(value) => fmtCurrency(value)}
                formatTooltip={(value) => fmtCurrency(value)}
              />
              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-secondary-100 pt-4 dark:border-secondary-800 md:grid-cols-3">
                <div className="rounded-xl bg-secondary-50 px-4 py-3 dark:bg-secondary-900/70">
                  <p className="text-xs font-medium uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
                    Latest Net Movement
                  </p>
                  <p className="mt-1 text-lg font-semibold text-secondary-900 dark:text-white">
                    {fmtCurrency(latestInventoryValue?.total_value)}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary-50 px-4 py-3 dark:bg-secondary-900/70">
                  <p className="text-xs font-medium uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
                    Latest Receipts
                  </p>
                  <p className="mt-1 text-lg font-semibold text-secondary-900 dark:text-white">
                    {fmtCurrency(latestInventoryValue?.receipt_value)}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary-50 px-4 py-3 dark:bg-secondary-900/70">
                  <p className="text-xs font-medium uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
                    Latest Issues
                  </p>
                  <p className="mt-1 text-lg font-semibold text-secondary-900 dark:text-white">
                    {fmtCurrency(latestInventoryValue?.issue_value)}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-[300px] items-center justify-center text-sm text-secondary-500 dark:text-secondary-400">
              No inventory value trend data is available yet.
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Expiry Loss Trend"
            description="Trailing 12-month value erosion from expired batches"
            actions={
              cumulativeExpiryLoss != null ? (
                <Badge variant="error" size="sm">
                  12m cumulative {fmtCurrency(cumulativeExpiryLoss)}
                </Badge>
              ) : undefined
            }
          />
          {expiryLossQuery.isError ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-secondary-500 dark:text-secondary-400">
              Expiry loss trend is temporarily unavailable.
            </div>
          ) : expiryTrend.length > 0 ? (
            <BarChart
              data={expiryTrend.map((point) => ({
                month: point.month,
                expiredValue: point.expired_value,
              }))}
              bars={[{ dataKey: 'expiredValue', name: 'Expired Value', color: '#DC2626' }]}
              xAxisKey="month"
              height={300}
              formatYAxis={(value) => fmtCurrency(value)}
              formatTooltip={(value) => fmtCurrency(value)}
            />
          ) : (
            <div className="flex h-[300px] items-center justify-center text-sm text-secondary-500 dark:text-secondary-400">
              No expiry losses recorded in the last 12 months.
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Critical Alerts"
          description="Immediate attention items surfaced by the pharma reporting pipeline"
          actions={<DetailLink to="/pharma-reports/alerts" label="Open Alert Queue" />}
        />
        {alertsQuery.isError ? (
          <div className="flex h-32 items-center justify-center text-sm text-secondary-500 dark:text-secondary-400">
            Alerts are temporarily unavailable.
          </div>
        ) : alerts.length > 0 ? (
          <div className="divide-y divide-secondary-100 dark:divide-secondary-800">
            {alerts.map((alert, index) => {
              const severityVariant: Record<string, 'error' | 'warning' | 'primary' | 'default'> = {
                CRITICAL: 'error',
                HIGH: 'warning',
                MEDIUM: 'primary',
                LOW: 'default',
              };

              return (
                <div
                  key={`${alert.product_id}-${alert.alert_type}-${index}`}
                  className="flex flex-col gap-3 px-1 py-4 lg:flex-row lg:items-start lg:justify-between"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={severityVariant[alert.severity] ?? 'default'} size="sm">
                      {alert.severity}
                    </Badge>
                    <Badge
                      variant={
                        alert.alert_type === 'NEWLY_EXPIRED'
                          ? 'error'
                          : alert.alert_type === 'NEAR_EXPIRY'
                            ? 'warning'
                            : 'primary'
                      }
                      size="sm"
                    >
                      {alert.alert_type.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-secondary-900 dark:text-white">
                      {alert.sku} - {alert.product_name}
                    </p>
                    <p className="mt-1 text-sm text-secondary-600 dark:text-secondary-300">{alert.message}</p>
                  </div>
                  <div className="text-left lg:text-right">
                    <p className="text-sm font-semibold text-secondary-900 dark:text-white">
                      {fmtCurrency(alert.value_at_risk)}
                    </p>
                    <p className="mt-1 text-xs text-secondary-500 dark:text-secondary-400">
                      {alert.location_code}
                      {alert.batch_number ? ` · Batch ${alert.batch_number}` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-secondary-500 dark:text-secondary-400">
            No active pharma alerts require attention.
          </div>
        )}
      </Card>
    </section>
  );
}