import { useMemo, useState } from 'react';
import { PieChart } from '../../components/charts/PieChart';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import { usePharmaGrid } from '../../hooks/usePharmaGrid';
import { usePdfPayload } from '../../hooks/usePdfPayload';
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
import { fmt, fmtCurrency, fmtDate, fmtPct, reportCols } from './shared';

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

  // ABC and XYZ return all rows in one go (no LIMIT) — useGridState still
  // gives us debounced filter state and consistent UI behaviour.
  const deadSlowGrid = usePharmaGrid({ initialSortBy: 'inventory_value', initialSortOrder: 'desc' });
  const abcGrid = usePharmaGrid({ initialSortBy: 'consumption_value', initialSortOrder: 'desc', initialPageSize: 100 });
  const xyzGrid = usePharmaGrid({ initialPageSize: 100 });
  const turnoverGrid = usePharmaGrid();

  const deadSlow = useDeadSlowStock(deadSlowGrid.pharmaParams, activeTab === 'deadSlow');
  const abc = useABCAnalysis(abcGrid.pharmaParams, activeTab === 'abc');
  const xyz = useXYZAnalysis(xyzGrid.pharmaParams, activeTab === 'xyz');
  const turnover = useInventoryTurnover(turnoverGrid.pharmaParams, activeTab === 'turnover');
  const queryMap = { abc, xyz, deadSlow, turnover };
  const activeQuery = queryMap[activeTab];
  const gridMap = { abc: abcGrid, xyz: xyzGrid, deadSlow: deadSlowGrid, turnover: turnoverGrid };
  const activeGrid = gridMap[activeTab];
  const exportFilters: Record<Tab, Record<string, unknown>> = {
    abc: abcGrid.pharmaParams,
    xyz: xyzGrid.pharmaParams,
    deadSlow: deadSlowGrid.pharmaParams,
    turnover: turnoverGrid.pharmaParams,
  };

  const abcColors: Record<string, string> = { A: '#10B981', B: '#F59E0B', C: '#94A3B8' };
  const xyzColors: Record<string, string> = { X: '#3B82F6', Y: '#F59E0B', Z: '#EF4444' };

  const deadSlowCols: Column<DeadSlowRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'category', header: 'Category', accessor: (r) => r.category ?? '—', filterType: 'text', filterField: 'category' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px', filterType: 'text', filterField: 'location_code' },
    { key: 'on_hand_qty', header: 'On Hand', accessor: (r) => fmt(r.on_hand_qty), align: 'right', sortable: true, filterType: 'number', filterField: 'on_hand_qty' },
    { key: 'inventory_value', header: 'Value', accessor: (r) => fmtCurrency(r.inventory_value), align: 'right', sortable: true, filterType: 'number', filterField: 'inventory_value' },
    { key: 'last_sale_date', header: 'Last Sale', accessor: (r) => fmtDate(r.last_sale_date), sortable: true, filterType: 'date', filterField: 'last_sale_date' },
    { key: 'days_since_last_sale', header: 'Days Idle', accessor: (r) => r.days_since_last_sale != null ? fmt(r.days_since_last_sale) : 'Never', align: 'right' },
    {
      key: 'classification', header: 'Class',
      accessor: (r) => <Badge variant={r.classification === 'DEAD' ? 'error' : 'warning'} size="sm">{r.classification}</Badge>,
    },
  ]);

  const abcCols: Column<ABCRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'consumption_value', header: 'Consumption', accessor: (r) => fmtCurrency(r.consumption_value), align: 'right', sortable: true, filterType: 'number', filterField: 'consumption_value' },
    { key: 'pct_of_total', header: '% Total', accessor: (r) => fmtPct(r.pct_of_total), align: 'right', filterType: 'number', filterField: 'pct_of_total' },
    { key: 'cumulative_pct', header: 'Cumul. %', accessor: (r) => fmtPct(r.cumulative_pct), align: 'right' },
    { key: 'on_hand_qty', header: 'On Hand', accessor: (r) => fmt(r.on_hand_qty), align: 'right', filterType: 'number', filterField: 'on_hand_qty' },
    { key: 'inventory_value', header: 'Inv. Value', accessor: (r) => fmtCurrency(r.inventory_value), align: 'right', filterType: 'number', filterField: 'inventory_value' },
    {
      key: 'abc_class', header: 'Class',
      accessor: (r) => <Badge variant={r.abc_class === 'A' ? 'success' : r.abc_class === 'B' ? 'warning' : 'default'} size="sm">{r.abc_class}</Badge>,
    },
  ]);

  const xyzCols: Column<XYZRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'avg_monthly_demand', header: 'Avg Demand/Mo', accessor: (r) => r.avg_monthly_demand?.toFixed(1) ?? '—', align: 'right', sortable: true, filterType: 'number', filterField: 'avg_monthly_demand' },
    { key: 'stddev_monthly_demand', header: 'Std Dev', accessor: (r) => r.stddev_monthly_demand?.toFixed(1) ?? '—', align: 'right', filterType: 'number', filterField: 'stddev_monthly_demand' },
    { key: 'coefficient_of_variation', header: 'CV', accessor: (r) => r.coefficient_of_variation?.toFixed(3) ?? '—', align: 'right' },
    { key: 'months_analyzed', header: 'Months', accessor: (r) => fmt(r.months_analyzed), align: 'right', filterType: 'number', filterField: 'months_analyzed' },
    {
      key: 'xyz_class', header: 'Class',
      accessor: (r) => <Badge variant={r.xyz_class === 'X' ? 'primary' : r.xyz_class === 'Y' ? 'warning' : 'error'} size="sm">{r.xyz_class}</Badge>,
    },
  ]);

  const turnoverCols: Column<TurnoverRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px', filterType: 'text', filterField: 'location_code' },
    { key: 'cogs', header: 'COGS', accessor: (r) => fmtCurrency(r.cogs), align: 'right', sortable: true, filterType: 'number', filterField: 'cogs' },
    { key: 'avg_inventory', header: 'Avg Inventory', accessor: (r) => fmtCurrency(r.avg_inventory), align: 'right', sortable: true, filterType: 'number', filterField: 'avg_inventory' },
    { key: 'turnover_ratio', header: 'Turnover', accessor: (r) => r.turnover_ratio != null ? r.turnover_ratio.toFixed(2) : '—', align: 'right' },
    { key: 'days_of_inventory', header: 'Days of Inv.', accessor: (r) => r.days_of_inventory != null ? r.days_of_inventory.toFixed(0) : '—', align: 'right' },
  ]);

  const pdfColsMap = {
    abc: abcCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    xyz: xyzCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    deadSlow: deadSlowCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    turnover: turnoverCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
  };

  const activeData = useMemo(() => {
    switch (activeTab) {
      case 'abc': return (abc.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'xyz': return (xyz.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'deadSlow': return (deadSlow.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'turnover': return (turnover.data?.data ?? []) as unknown as Record<string, unknown>[];
    }
  }, [activeTab, abc.data, xyz.data, deadSlow.data, turnover.data]);

  const pdfPayload = usePdfPayload({
    title: tabs.find((t) => t.key === activeTab)?.label ?? 'Stock Analysis',
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
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Stock Analysis</h1>
          <p className="mt-1 text-sm text-gray-500">ABC, XYZ, dead/slow stock, and inventory turnover analytics</p>
        </div>
        <ExportToolbar
          reportType={exportMap[activeTab]}
          filters={exportFilters[activeTab]}
          pdfPayload={pdfPayload}
          onRefresh={() => void activeQuery.refetch()}
          isRefreshing={activeQuery.isFetching}
          onResetView={activeGrid.resetAll}
          hasActiveViewState={activeGrid.hasActiveControls}
        />
      </div>

      {/* Tabs */}
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
        <div className="grid grid-cols-3 gap-3">
          {['X', 'Y', 'Z'].map((cls) => {
            const count = xyz.data!.data.filter((r) => r.xyz_class === cls).length;
            return (
              <Card key={cls} padding="sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: xyzColors[cls] }} />
                  <span className="text-xs lg:text-sm font-medium text-gray-600">Class {cls}</span>
                </div>
                <p className="text-xl lg:text-2xl font-bold text-gray-900 mt-1">{count}</p>
                <p className="text-[10px] lg:text-xs text-gray-500">
                  {cls === 'X' ? 'Stable demand (CV ≤ 0.5)' : cls === 'Y' ? 'Moderate variability (CV ≤ 1.0)' : 'Erratic demand (CV > 1.0)'}
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
              sorting={abcGrid.sortingProps}
              filtering={abcGrid.filteringProps}
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
              sorting={xyzGrid.sortingProps}
              filtering={xyzGrid.filteringProps}
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
              sorting={deadSlowGrid.sortingProps}
              filtering={deadSlowGrid.filteringProps}
              pagination={deadSlowGrid.paginationProps(deadSlow.data?.total ?? 0)}
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
              sorting={turnoverGrid.sortingProps}
              filtering={turnoverGrid.filteringProps}
              pagination={turnoverGrid.paginationProps(turnover.data?.total ?? 0)}
            />
          </Card>
        </>
      )}
    </div>
  );
}
