import {
    ClockIcon,
    ExclamationTriangleIcon,
    ShieldExclamationIcon,
    XCircleIcon,
} from '@heroicons/react/24/outline';
import { useMemo, useState } from 'react';
import { BarChart } from '../../components/charts/BarChart';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import { usePharmaGrid } from '../../hooks/usePharmaGrid';
import { usePdfPayload } from '../../hooks/usePdfPayload';
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
import { fmt, fmtCurrency, fmtDate, fmtPct, reportCols } from './shared';

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
  fefo: 'fefo-picking',
  risk: 'expiry-risk',
};

export default function ExpiryManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('risk');

  const nearGrid = usePharmaGrid({ initialSortBy: 'remaining_days' });
  const expiredGrid = usePharmaGrid({ initialSortBy: 'days_expired', initialSortOrder: 'desc' });
  const fefoGrid = usePharmaGrid({ initialSortBy: 'expiry_date' });

  const nearExpiry = useNearExpiry({ ...nearGrid.pharmaParams, thresholdDays: 180 }, activeTab === 'near');
  const expired = useExpiredStock(expiredGrid.pharmaParams, activeTab === 'expired');
  const fefo = useFEFOPicking(fefoGrid.pharmaParams, activeTab === 'fefo');
  const risk = useExpiryRisk({}, activeTab === 'risk');
  const queryMap = { risk, near: nearExpiry, expired, fefo };
  const activeQuery = queryMap[activeTab];
  const gridMap = { risk: null, near: nearGrid, expired: expiredGrid, fefo: fefoGrid };
  const activeGrid = gridMap[activeTab];
  const exportFilters: Record<Tab, Record<string, unknown>> = {
    risk: {},
    near: { ...nearGrid.pharmaParams, thresholdDays: 180 },
    expired: expiredGrid.pharmaParams,
    fefo: fefoGrid.pharmaParams,
  };

  const urgencyVariant: Record<string, 'error' | 'warning' | 'primary' | 'default'> = {
    CRITICAL: 'error',
    HIGH: 'warning',
    MEDIUM: 'primary',
    LOW: 'default',
  };

  const nearCols: Column<NearExpiryRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px', filterType: 'text', filterField: 'batch_number' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px', filterType: 'text', filterField: 'location_code' },
    { key: 'expiry_date', header: 'Expiry Date', accessor: (r) => fmtDate(r.expiry_date), sortable: true, filterType: 'date', filterField: 'expiry_date' },
    {
      key: 'remaining_days', header: 'Days Left', align: 'right', sortable: true, filterType: 'number', filterField: 'remaining_days',
      accessor: (r) => (
        <span className={r.remaining_days <= 30 ? 'text-red-600 font-bold' : r.remaining_days <= 90 ? 'text-amber-600 font-semibold' : ''}>
          {r.remaining_days}
        </span>
      ),
    },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right', filterType: 'number', filterField: 'quantity' },
    { key: 'at_risk_value', header: 'Value at Risk', accessor: (r) => fmtCurrency(r.at_risk_value), align: 'right', sortable: true, filterType: 'number', filterField: 'at_risk_value' },
    { key: 'urgency', header: 'Urgency', accessor: (r) => <Badge variant={urgencyVariant[r.urgency] ?? 'default'} size="sm">{r.urgency}</Badge> },
  ]);

  const expiredCols: Column<ExpiredStockRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px', filterType: 'text', filterField: 'batch_number' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px', filterType: 'text', filterField: 'location_code' },
    { key: 'expiry_date', header: 'Expired On', accessor: (r) => fmtDate(r.expiry_date), sortable: true, filterType: 'date', filterField: 'expiry_date' },
    { key: 'days_expired', header: 'Days Expired', accessor: (r) => <span className="text-red-600 font-semibold">{r.days_expired}</span>, align: 'right', sortable: true, filterType: 'number', filterField: 'days_expired' },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right', filterType: 'number', filterField: 'quantity' },
    { key: 'expired_value', header: 'Expired Value', accessor: (r) => <span className="text-red-600">{fmtCurrency(r.expired_value)}</span>, align: 'right', sortable: true, filterType: 'number', filterField: 'expired_value' },
    {
      key: 'batch_status', header: 'Status',
      accessor: (r) => <Badge variant={r.batch_status === 'EXPIRED' ? 'error' : 'warning'} size="sm">{r.batch_status}</Badge>,
      filterType: 'select', filterField: 'batch_status',
      filterOptions: [{ value: 'EXPIRED', label: 'Expired' }, { value: 'AVAILABLE', label: 'Available' }, { value: 'QUARANTINE', label: 'Quarantine' }],
    },
  ]);

  const fefoCols: Column<FEFOPickingRow>[] = reportCols([
    { key: 'picking_sequence', header: '#', accessor: (r) => r.picking_sequence, width: '50px', align: 'center' },
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px', filterType: 'text', filterField: 'batch_number' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px', filterType: 'text', filterField: 'location_code' },
    { key: 'expiry_date', header: 'Expiry', accessor: (r) => fmtDate(r.expiry_date), sortable: true, filterType: 'date', filterField: 'expiry_date' },
    {
      key: 'remaining_days', header: 'Days Left', align: 'right',
      accessor: (r) => r.remaining_days != null ? (
        <span className={r.remaining_days <= 30 ? 'text-red-600 font-bold' : ''}>{r.remaining_days}</span>
      ) : '—',
    },
    { key: 'available_qty', header: 'Available', accessor: (r) => fmt(r.available_qty), align: 'right', sortable: true, filterType: 'number', filterField: 'available_qty' },
  ]);

  const pdfColsMap = {
    risk: [] as Array<{ key: string; header: string; align?: 'left' | 'right' | 'center' }>,
    near: nearCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    expired: expiredCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    fefo: fefoCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
  };

  const activeData = useMemo(() => {
    switch (activeTab) {
      case 'near': return (nearExpiry.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'expired': return (expired.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'fefo': return (fefo.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'risk': return [] as Record<string, unknown>[];
    }
  }, [activeTab, nearExpiry.data, expired.data, fefo.data]);

  const pdfPayload = usePdfPayload({
    title: tabs.find((t) => t.key === activeTab)?.label ?? 'Expiry Management',
    reportKey: exportMap[activeTab],
    columns: pdfColsMap[activeTab],
    data: activeData,
    filters: exportFilters[activeTab],
    exportMode: 'current-page',
  });

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Expiry Management</h1>
          <p className="mt-1 text-sm text-gray-500">Track near-expiry, expired stock, FEFO picking, and expiry risk</p>
        </div>
        <ExportToolbar
          reportType={exportMap[activeTab]}
          filters={exportFilters[activeTab]}
          pdfPayload={pdfPayload}
          onRefresh={() => void activeQuery.refetch()}
          isRefreshing={activeQuery.isFetching}
          onResetView={activeGrid?.resetAll}
          hasActiveViewState={activeGrid?.hasActiveControls ?? false}
        />
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="-mb-px flex gap-4 lg:gap-6 min-w-max" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
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
              sorting={nearGrid.sortingProps}
              filtering={nearGrid.filteringProps}
              pagination={nearGrid.paginationProps(nearExpiry.data?.total ?? 0)}
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
              sorting={expiredGrid.sortingProps}
              filtering={expiredGrid.filteringProps}
              pagination={expiredGrid.paginationProps(expired.data?.total ?? 0)}
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
              sorting={fefoGrid.sortingProps}
              filtering={fefoGrid.filteringProps}
              pagination={fefoGrid.paginationProps(fefo.data?.total ?? 0)}
            />
          </Card>
        </>
      )}
    </div>
  );
}
