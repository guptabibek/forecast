import {
    ArchiveBoxXMarkIcon,
    ArrowTrendingDownIcon,
    BanknotesIcon,
    ClockIcon,
    CubeIcon,
    ExclamationTriangleIcon,
    ShieldExclamationIcon,
    XCircleIcon,
} from '@heroicons/react/24/outline';
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
import { fmt, fmtCurrency } from './shared';

export default function PharmaReportsDashboard() {
  const { data: kpis, isLoading: kpisLoading, isError, error } = useDashboardKPIs();
  const { data: expiryTrend } = useExpiryLossTrend();
  const { data: valueTrend } = useInventoryValueTrend();
  const { data: alerts } = usePharmaAlerts({ alertLimit: 10 });

  if (isError) return <QueryErrorBanner error={error} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Executive dashboard — real-time KPIs, trends, and critical alerts
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Inventory Value"
          value={kpisLoading ? '...' : fmtCurrency(kpis?.total_inventory_value)}
          icon={<BanknotesIcon className="h-6 w-6" />}
          color="blue"
        />
        <KpiCard
          title="Products"
          value={kpisLoading ? '...' : fmt(kpis?.total_products)}
          icon={<CubeIcon className="h-6 w-6" />}
          color="purple"
        />
        <KpiCard
          title="Expired Stock Value"
          value={kpisLoading ? '...' : fmtCurrency(kpis?.expired_value)}
          icon={<XCircleIcon className="h-6 w-6" />}
          color="red"
        />
        <KpiCard
          title="Near Expiry Value"
          value={kpisLoading ? '...' : fmtCurrency(kpis?.near_expiry_value)}
          subtitle="Within 90 days"
          icon={<ClockIcon className="h-6 w-6" />}
          color="amber"
        />
        <KpiCard
          title="Low Stock Items"
          value={kpisLoading ? '...' : fmt(kpis?.low_stock_count)}
          icon={<ExclamationTriangleIcon className="h-6 w-6" />}
          color="amber"
        />
        <KpiCard
          title="Dead Stock Value"
          value={kpisLoading ? '...' : fmtCurrency(kpis?.dead_stock_value)}
          icon={<ArchiveBoxXMarkIcon className="h-6 w-6" />}
          color="gray"
        />
        <KpiCard
          title="Avg Turnover Ratio"
          value={kpisLoading ? '...' : (kpis?.avg_turnover_ratio?.toFixed(2) ?? '—')}
          icon={<ArrowTrendingDownIcon className="h-6 w-6" />}
          color="green"
        />
        <KpiCard
          title="Active Stock-outs"
          value={kpisLoading ? '...' : fmt(kpis?.stockout_count)}
          icon={<ShieldExclamationIcon className="h-6 w-6" />}
          color="red"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Inventory Value Trend" description="Monthly total inventory value" />
          {valueTrend && valueTrend.length > 0 ? (
            <AreaChart
              data={valueTrend.map((p) => ({ month: p.month?.slice(0, 7) ?? '', value: p.total_value }))}
              areas={[{ dataKey: 'value', name: 'Inventory Value', color: '#3B82F6' }]}
              xAxisKey="month"
              height={280}
              formatYAxis={(v) => fmtCurrency(v)}
            />
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data</div>
          )}
        </Card>

        <Card>
          <CardHeader title="Expiry Loss Trend" description="Monthly expiry losses (12 months)" />
          {expiryTrend && expiryTrend.length > 0 ? (
            <BarChart
              data={expiryTrend.map((p) => ({ month: p.month?.slice(0, 7) ?? '', value: p.expired_value, batches: p.batch_count }))}
              bars={[{ dataKey: 'value', name: 'Loss Value', color: '#EF4444' }]}
              xAxisKey="month"
              height={280}
              formatYAxis={(v) => fmtCurrency(v)}
            />
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data</div>
          )}
        </Card>
      </div>

      {/* Critical Alerts */}
      <Card>
        <CardHeader title="Critical Alerts" description="Top alerts requiring immediate action" />
        {alerts && alerts.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {alerts.slice(0, 10).map((alert, i) => {
              const sevVariant: Record<string, 'error' | 'warning' | 'primary' | 'default'> = {
                CRITICAL: 'error',
                HIGH: 'warning',
                MEDIUM: 'primary',
                LOW: 'default',
              };
              return (
                <div key={`${alert.product_id}-${alert.alert_type}-${i}`} className="flex items-center gap-4 py-3 px-1">
                  <Badge variant={sevVariant[alert.severity] ?? 'default'} size="sm">
                    {alert.severity}
                  </Badge>
                  <Badge variant={alert.alert_type === 'NEAR_EXPIRY' ? 'warning' : alert.alert_type === 'NEWLY_EXPIRED' ? 'error' : 'primary'} size="sm">
                    {alert.alert_type.replace(/_/g, ' ')}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {alert.sku} — {alert.product_name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{alert.message}</p>
                  </div>
                  <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    {fmtCurrency(alert.value_at_risk)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-gray-400">No active alerts</p>
        )}
      </Card>
    </div>
  );
}
