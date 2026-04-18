import {
    ClockIcon,
    ExclamationTriangleIcon,
    ShieldExclamationIcon,
    XCircleIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';
import { BarChart } from '../../components/charts/BarChart';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import {
    useExpiredStock,
    useExpiryRisk,
    useFEFOPicking,
    useNearExpiry,
} from '../../hooks/usePharmaReports';
import type {
    ExpiredStockRow,
    FEFOPickingRow,
    NearExpiryRow,
} from '../../services/api/pharma-reports.service';
import ExportToolbar from './ExportToolbar';
import KpiCard from './KpiCard';
import { fmt, fmtCurrency, fmtDate, fmtPct } from './shared';

type Tab = 'near' | 'expired' | 'fefo' | 'risk';

const tabs: { key: Tab; label: string }[] = [
  { key: 'risk', label: 'Risk Overview' },
  { key: 'near', label: 'Near Expiry' },
  { key: 'expired', label: 'Expired Stock' },
  { key: 'fefo', label: 'FEFO Picking' },
];

const exportMap: Record<Tab, string> = {
  near: 'near-expiry',
  expired: 'expired-stock',
  fefo: 'near-expiry',
  risk: 'near-expiry',
};

export default function ExpiryManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('risk');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const filters = { limit: pageSize, offset: page * pageSize };

  const nearExpiry = useNearExpiry(activeTab === 'near' ? { ...filters, thresholdDays: 180 } : undefined);
  const expired = useExpiredStock(activeTab === 'expired' ? filters : undefined);
  const fefo = useFEFOPicking(activeTab === 'fefo' ? filters : undefined);
  const risk = useExpiryRisk(activeTab === 'risk' ? {} : undefined);

  const urgencyVariant: Record<string, 'error' | 'warning' | 'primary' | 'default'> = {
    CRITICAL: 'error',
    HIGH: 'warning',
    MEDIUM: 'primary',
    LOW: 'default',
  };

  const nearCols: Column<NearExpiryRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'expiry_date', header: 'Expiry Date', accessor: (r) => fmtDate(r.expiry_date) },
    { key: 'remaining_days', header: 'Days Left', accessor: (r) => (
      <span className={r.remaining_days <= 30 ? 'text-red-600 font-bold' : r.remaining_days <= 90 ? 'text-amber-600 font-semibold' : ''}>
        {r.remaining_days}
      </span>
    ), align: 'right' },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right' },
    { key: 'at_risk_value', header: 'Value at Risk', accessor: (r) => fmtCurrency(r.at_risk_value), align: 'right' },
    { key: 'urgency', header: 'Urgency', accessor: (r) => <Badge variant={urgencyVariant[r.urgency] ?? 'default'} size="sm">{r.urgency}</Badge> },
  ];

  const expiredCols: Column<ExpiredStockRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'expiry_date', header: 'Expired On', accessor: (r) => fmtDate(r.expiry_date) },
    { key: 'days_expired', header: 'Days Expired', accessor: (r) => <span className="text-red-600 font-semibold">{r.days_expired}</span>, align: 'right' },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right' },
    { key: 'expired_value', header: 'Expired Value', accessor: (r) => <span className="text-red-600">{fmtCurrency(r.expired_value)}</span>, align: 'right' },
    { key: 'batch_status', header: 'Status', accessor: (r) => <Badge variant={r.batch_status === 'EXPIRED' ? 'error' : 'warning'} size="sm">{r.batch_status}</Badge> },
  ];

  const fefoCols: Column<FEFOPickingRow>[] = [
    { key: 'picking_sequence', header: '#', accessor: (r) => r.picking_sequence, width: '50px', align: 'center' },
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'expiry_date', header: 'Expiry', accessor: (r) => fmtDate(r.expiry_date) },
    { key: 'remaining_days', header: 'Days Left', accessor: (r) => r.remaining_days != null ? (
      <span className={r.remaining_days <= 30 ? 'text-red-600 font-bold' : ''}>{r.remaining_days}</span>
    ) : '—', align: 'right' },
    { key: 'available_qty', header: 'Available', accessor: (r) => fmt(r.available_qty), align: 'right' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expiry Management</h1>
          <p className="mt-1 text-sm text-gray-500">Track near-expiry, expired stock, FEFO picking, and expiry risk</p>
        </div>
        <ExportToolbar reportType={exportMap[activeTab]} filters={{}} />
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setPage(0); }}
              className={`whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Risk Overview */}
      {activeTab === 'risk' && (
        <>
          {risk.isError && <QueryErrorBanner error={risk.error} />}
          {risk.data && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  title="Total Inventory"
                  value={fmtCurrency(risk.data.total_inventory_value)}
                  icon={<ShieldExclamationIcon className="h-6 w-6" />}
                  color="blue"
                />
                <KpiCard
                  title="Expired Value"
                  value={fmtCurrency(risk.data.expired_value)}
                  subtitle={fmtPct(risk.data.expired_pct)}
                  icon={<XCircleIcon className="h-6 w-6" />}
                  color="red"
                />
                <KpiCard
                  title="Expiring ≤ 30d"
                  value={fmtCurrency(risk.data.near_expiry_value_30d)}
                  subtitle={fmtPct(risk.data.near_expiry_pct_30d)}
                  icon={<ExclamationTriangleIcon className="h-6 w-6" />}
                  color="red"
                />
                <KpiCard
                  title="Expiring ≤ 90d"
                  value={fmtCurrency(risk.data.near_expiry_value_90d)}
                  subtitle={fmtPct(risk.data.near_expiry_pct_90d)}
                  icon={<ClockIcon className="h-6 w-6" />}
                  color="amber"
                />
              </div>

              {/* Monthly Trend Chart */}
              {risk.data.monthly_trend?.length > 0 && (
                <Card>
                  <CardHeader title="Monthly Expiry Forecast" description="Batches expiring in the next 12 months by value" />
                  <BarChart
                    data={risk.data.monthly_trend.map((t) => ({
                      month: t.month?.slice(0, 7) ?? '',
                      value: t.expiring_value,
                      batches: t.batch_count,
                    }))}
                    bars={[{ dataKey: 'value', name: 'Expiring Value', color: '#EF4444' }]}
                    xAxisKey="month"
                    height={300}
                    formatYAxis={(v) => fmtCurrency(v)}
                  />
                </Card>
              )}
            </>
          )}
          {risk.isLoading && (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
            </div>
          )}
        </>
      )}

      {/* Near Expiry Table */}
      {activeTab === 'near' && (
        <>
          {nearExpiry.isError && <QueryErrorBanner error={nearExpiry.error} />}
          <Card padding="none">
            <CardHeader title="Near-Expiry Stock" description="Batches expiring within 180 days" className="px-6 pt-6" />
            <DataTable<NearExpiryRow>
              data={nearExpiry.data?.data ?? []}
              columns={nearCols}
              keyExtractor={(r) => r.batch_id}
              isLoading={nearExpiry.isLoading}
              emptyMessage="No near-expiry batches"
              pagination={{
                page,
                pageSize,
                total: nearExpiry.data?.total ?? 0,
                onPageChange: setPage,
                onPageSizeChange: () => {},
              }}
            />
          </Card>
        </>
      )}

      {/* Expired Stock Table */}
      {activeTab === 'expired' && (
        <>
          {expired.isError && <QueryErrorBanner error={expired.error} />}
          <Card padding="none">
            <CardHeader title="Expired Stock" description="Expired batches still in inventory" className="px-6 pt-6" />
            <DataTable<ExpiredStockRow>
              data={expired.data?.data ?? []}
              columns={expiredCols}
              keyExtractor={(r) => r.batch_id}
              isLoading={expired.isLoading}
              emptyMessage="No expired stock"
              pagination={{
                page,
                pageSize,
                total: expired.data?.total ?? 0,
                onPageChange: setPage,
                onPageSizeChange: () => {},
              }}
            />
          </Card>
        </>
      )}

      {/* FEFO Picking Table */}
      {activeTab === 'fefo' && (
        <>
          {fefo.isError && <QueryErrorBanner error={fefo.error} />}
          <Card padding="none">
            <CardHeader title="FEFO Picking Sequence" description="First Expiry, First Out — optimal picking order" className="px-6 pt-6" />
            <DataTable<FEFOPickingRow>
              data={fefo.data?.data ?? []}
              columns={fefoCols}
              keyExtractor={(r) => r.batch_id}
              isLoading={fefo.isLoading}
              emptyMessage="No pickable batches"
              pagination={{
                page,
                pageSize,
                total: fefo.data?.total ?? 0,
                onPageChange: setPage,
                onPageSizeChange: () => {},
              }}
            />
          </Card>
        </>
      )}
    </div>
  );
}
