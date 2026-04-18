import { useState } from 'react';
import { Badge, Card, QueryErrorBanner } from '../../components/ui';
import { usePharmaAlerts } from '../../hooks/usePharmaReports';
import { fmtCurrency } from './shared';

const ALERT_TYPES = ['ALL', 'NEAR_EXPIRY', 'NEWLY_EXPIRED', 'LOW_STOCK', 'STOCKOUT', 'DEAD_STOCK'] as const;
const SEVERITIES = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

const sevVariant: Record<string, 'error' | 'warning' | 'primary' | 'default'> = {
  CRITICAL: 'error',
  HIGH: 'warning',
  MEDIUM: 'primary',
  LOW: 'default',
};

const typeVariant: Record<string, 'error' | 'warning' | 'primary' | 'default' | 'secondary'> = {
  NEAR_EXPIRY: 'warning',
  NEWLY_EXPIRED: 'error',
  LOW_STOCK: 'primary',
  STOCKOUT: 'error',
  DEAD_STOCK: 'default',
};

export default function AlertsPage() {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterSev, setFilterSev] = useState<string>('ALL');

  const { data: alerts, isLoading, isError, error } = usePharmaAlerts({ alertLimit: 500 });

  const filtered = (alerts ?? []).filter((a) => {
    if (filterType !== 'ALL' && a.alert_type !== filterType) return false;
    if (filterSev !== 'ALL' && a.severity !== filterSev) return false;
    return true;
  });

  const countBySev = (sev: string) => (alerts ?? []).filter((a) => a.severity === sev).length;
  const total = alerts?.length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory Alerts</h1>
        <p className="mt-1 text-sm text-gray-500">Real-time alerts for expiry, low-stock, stock-outs, and dead stock</p>
      </div>

      {/* Summary Bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-sm text-gray-600 font-medium">
          {total} alerts total
        </span>
        <Badge variant="error" size="sm">{countBySev('CRITICAL')} Critical</Badge>
        <Badge variant="warning" size="sm">{countBySev('HIGH')} High</Badge>
        <Badge variant="primary" size="sm">{countBySev('MEDIUM')} Medium</Badge>
        <Badge variant="default" size="sm">{countBySev('LOW')} Low</Badge>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">Type:</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-md border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
          >
            {ALERT_TYPES.map((t) => (
              <option key={t} value={t}>{t === 'ALL' ? 'All Types' : t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">Severity:</label>
          <select
            value={filterSev}
            onChange={(e) => setFilterSev(e.target.value)}
            className="rounded-md border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{s === 'ALL' ? 'All Severities' : s}</option>
            ))}
          </select>
        </div>
        <span className="text-sm text-gray-400">{filtered.length} shown</span>
      </div>

      {isError && <QueryErrorBanner error={error} />}

      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <p className="py-12 text-center text-sm text-gray-400">No alerts matching the current filters</p>
        </Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <Card padding="none">
          <div className="divide-y divide-gray-100">
            {filtered.map((alert, idx) => (
              <div
                key={`${alert.product_id}-${alert.alert_type}-${idx}`}
                className="flex items-center gap-4 py-3 px-5 hover:bg-gray-50 transition-colors"
              >
                {/* Severity */}
                <Badge variant={sevVariant[alert.severity] ?? 'default'} size="sm">
                  {alert.severity}
                </Badge>

                {/* Type */}
                <Badge variant={typeVariant[alert.alert_type] ?? 'default'} size="sm">
                  {alert.alert_type.replace(/_/g, ' ')}
                </Badge>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {alert.sku} — {alert.product_name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{alert.message}</p>
                </div>

                {/* Meta */}
                <div className="hidden md:flex items-center gap-4 text-xs text-gray-500 whitespace-nowrap">
                  {alert.location_code && <span>{alert.location_code}</span>}
                  {alert.batch_number && <span>Batch: {alert.batch_number}</span>}
                </div>

                {/* Value at Risk */}
                <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                  {fmtCurrency(alert.value_at_risk)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
