import { useState } from 'react';
import { PieChart } from '../../components/charts/PieChart';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import {
    useABCAnalysis,
    useDeadSlowStock,
    useInventoryTurnover,
    useXYZAnalysis,
} from '../../hooks/usePharmaReports';
import type {
    ABCRow,
    DeadSlowRow,
    TurnoverRow,
    XYZRow,
} from '../../services/api/pharma-reports.service';
import ExportToolbar from './ExportToolbar';
import { fmt, fmtCurrency, fmtDate, fmtPct } from './shared';

type Tab = 'deadSlow' | 'abc' | 'xyz' | 'turnover';

const tabs: { key: Tab; label: string }[] = [
  { key: 'abc', label: 'ABC Analysis' },
  { key: 'xyz', label: 'XYZ Analysis' },
  { key: 'deadSlow', label: 'Dead / Slow Stock' },
  { key: 'turnover', label: 'Inventory Turnover' },
];

const exportMap: Record<Tab, string> = {
  abc: 'abc-analysis',
  xyz: 'xyz-analysis',
  deadSlow: 'dead-slow',
  turnover: 'inventory-turnover',
};

export default function StockAnalysisPage() {
  const [activeTab, setActiveTab] = useState<Tab>('abc');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const filters = { limit: pageSize, offset: (page - 1) * pageSize };

  const deadSlow = useDeadSlowStock(filters, activeTab === 'deadSlow');
  const abc = useABCAnalysis({}, activeTab === 'abc');
  const xyz = useXYZAnalysis({}, activeTab === 'xyz');
  const turnover = useInventoryTurnover(filters, activeTab === 'turnover');

  const abcColors: Record<string, string> = { A: '#EF4444', B: '#F59E0B', C: '#10B981' };
  const xyzColors: Record<string, string> = { X: '#3B82F6', Y: '#F59E0B', Z: '#EF4444' };

  const deadSlowCols: Column<DeadSlowRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'category', header: 'Category', accessor: (r) => r.category ?? '—' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'on_hand_qty', header: 'On Hand', accessor: (r) => fmt(r.on_hand_qty), align: 'right' },
    { key: 'inventory_value', header: 'Value', accessor: (r) => fmtCurrency(r.inventory_value), align: 'right' },
    { key: 'last_sale_date', header: 'Last Sale', accessor: (r) => fmtDate(r.last_sale_date) },
    { key: 'days_since_last_sale', header: 'Days Idle', accessor: (r) => r.days_since_last_sale != null ? fmt(r.days_since_last_sale) : 'Never', align: 'right' },
    { key: 'classification', header: 'Class', accessor: (r) => <Badge variant={r.classification === 'DEAD' ? 'error' : 'warning'} size="sm">{r.classification}</Badge> },
  ];

  const abcCols: Column<ABCRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'consumption_value', header: 'Consumption', accessor: (r) => fmtCurrency(r.consumption_value), align: 'right' },
    { key: 'pct_of_total', header: '% Total', accessor: (r) => fmtPct(r.pct_of_total), align: 'right' },
    { key: 'cumulative_pct', header: 'Cumul. %', accessor: (r) => fmtPct(r.cumulative_pct), align: 'right' },
    { key: 'on_hand_qty', header: 'On Hand', accessor: (r) => fmt(r.on_hand_qty), align: 'right' },
    { key: 'inventory_value', header: 'Inv. Value', accessor: (r) => fmtCurrency(r.inventory_value), align: 'right' },
    { key: 'abc_class', header: 'Class', accessor: (r) => (
      <Badge
        variant={r.abc_class === 'A' ? 'error' : r.abc_class === 'B' ? 'warning' : 'success'}
        size="sm"
      >
        {r.abc_class}
      </Badge>
    ) },
  ];

  const xyzCols: Column<XYZRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'avg_monthly_demand', header: 'Avg Demand/Mo', accessor: (r) => r.avg_monthly_demand?.toFixed(1) ?? '—', align: 'right' },
    { key: 'stddev_monthly_demand', header: 'Std Dev', accessor: (r) => r.stddev_monthly_demand?.toFixed(1) ?? '—', align: 'right' },
    { key: 'coefficient_of_variation', header: 'CV', accessor: (r) => r.coefficient_of_variation?.toFixed(3) ?? '—', align: 'right' },
    { key: 'months_analyzed', header: 'Months', accessor: (r) => fmt(r.months_analyzed), align: 'right' },
    { key: 'xyz_class', header: 'Class', accessor: (r) => (
      <Badge variant={r.xyz_class === 'X' ? 'primary' : r.xyz_class === 'Y' ? 'warning' : 'error'} size="sm">
        {r.xyz_class}
      </Badge>
    ) },
  ];

  const turnoverCols: Column<TurnoverRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'cogs', header: 'COGS', accessor: (r) => fmtCurrency(r.cogs), align: 'right' },
    { key: 'avg_inventory', header: 'Avg Inventory', accessor: (r) => fmtCurrency(r.avg_inventory), align: 'right' },
    { key: 'turnover_ratio', header: 'Turnover', accessor: (r) => r.turnover_ratio != null ? r.turnover_ratio.toFixed(2) : '—', align: 'right' },
    { key: 'days_of_inventory', header: 'Days of Inv.', accessor: (r) => r.days_of_inventory != null ? r.days_of_inventory.toFixed(0) : '—', align: 'right' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Analysis</h1>
          <p className="mt-1 text-sm text-gray-500">ABC, XYZ, dead/slow stock, and inventory turnover analytics</p>
        </div>
        <ExportToolbar reportType={exportMap[activeTab]} filters={{}} />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setPage(1); }}
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

      {/* ABC Summary + Chart */}
      {activeTab === 'abc' && abc.data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader title="ABC Distribution" description="By consumption value" />
            {abc.data.summary && (
              <PieChart
                data={abc.data.summary.map((s) => ({
                  name: `Class ${s.class}`,
                  value: s.value,
                  color: abcColors[s.class],
                }))}
                height={220}
              />
            )}
          </Card>
          <div className="lg:col-span-2">
            <Card>
              <CardHeader title="ABC Summary" />
              {abc.data.summary && (
                <div className="space-y-3">
                  {abc.data.summary.map((s) => (
                    <div key={s.class} className="flex items-center justify-between py-2 px-1 border-b border-gray-100 last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: abcColors[s.class] }} />
                        <span className="font-semibold text-gray-900">Class {s.class}</span>
                      </div>
                      <div className="flex items-center gap-6 text-sm text-gray-600">
                        <span>{s.count} products</span>
                        <span>{fmtCurrency(s.value)}</span>
                        <span className="font-medium">{fmtPct(s.pct)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* XYZ Summary */}
      {activeTab === 'xyz' && xyz.data && (
        <div className="grid grid-cols-3 gap-4">
          {['X', 'Y', 'Z'].map((cls) => {
            const count = xyz.data!.data.filter((r) => r.xyz_class === cls).length;
            return (
              <Card key={cls} padding="sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: xyzColors[cls] }} />
                  <span className="text-sm font-medium text-gray-600">Class {cls}</span>
                </div>
                <p className="text-2xl font-bold text-gray-900 mt-1">{count}</p>
                <p className="text-xs text-gray-500">
                  {cls === 'X' ? 'Stable demand' : cls === 'Y' ? 'Moderate variability' : 'Erratic demand'}
                </p>
              </Card>
            );
          })}
        </div>
      )}

      {/* Tables */}
      {activeTab === 'abc' && (
        <>
          {abc.isError && <QueryErrorBanner error={abc.error} />}
          <Card padding="none">
            <DataTable<ABCRow>
              data={abc.data?.data ?? []}
              columns={abcCols}
              keyExtractor={(r) => r.product_id}
              isLoading={abc.isLoading}
              emptyMessage="No ABC data"
            />
          </Card>
        </>
      )}

      {activeTab === 'xyz' && (
        <>
          {xyz.isError && <QueryErrorBanner error={xyz.error} />}
          <Card padding="none">
            <DataTable<XYZRow>
              data={xyz.data?.data ?? []}
              columns={xyzCols}
              keyExtractor={(r) => r.product_id}
              isLoading={xyz.isLoading}
              emptyMessage="No XYZ data"
            />
          </Card>
        </>
      )}

      {activeTab === 'deadSlow' && (
        <>
          {deadSlow.isError && <QueryErrorBanner error={deadSlow.error} />}
          <Card padding="none">
            <CardHeader title="Dead & Slow Stock" description="Items with no or low movement" className="px-6 pt-6" />
            <DataTable<DeadSlowRow>
              data={deadSlow.data?.data ?? []}
              columns={deadSlowCols}
              keyExtractor={(r) => `${r.product_id}-${r.location_code}`}
              isLoading={deadSlow.isLoading}
              emptyMessage="No dead or slow stock"
              pagination={{
                page,
                pageSize,
                total: deadSlow.data?.total ?? 0,
                onPageChange: setPage,
                onPageSizeChange: () => {},
              }}
            />
          </Card>
        </>
      )}

      {activeTab === 'turnover' && (
        <>
          {turnover.isError && <QueryErrorBanner error={turnover.error} />}
          <Card padding="none">
            <CardHeader title="Inventory Turnover" description="COGS / Avg Inventory (last 12 months)" className="px-6 pt-6" />
            <DataTable<TurnoverRow>
              data={turnover.data?.data ?? []}
              columns={turnoverCols}
              keyExtractor={(r) => `${r.product_id}-${r.location_code}`}
              isLoading={turnover.isLoading}
              emptyMessage="No turnover data"
              pagination={{
                page,
                pageSize,
                total: turnover.data?.total ?? 0,
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
