import { useState } from 'react';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import {
    useBatchInventory,
    useCurrentStock,
    useMovementLedger,
    useReorderReport,
    useStockAgeing,
} from '../../hooks/usePharmaReports';
import type {
    BatchInventoryRow,
    CurrentStockRow,
    MovementLedgerRow,
    ReorderRow,
    StockAgeingRow,
} from '../../services/api/pharma-reports.service';
import ExportToolbar from './ExportToolbar';
import { fmt, fmtCurrency, fmtDate } from './shared';

type Tab = 'current' | 'batch' | 'ledger' | 'reorder' | 'ageing';

const tabs: { key: Tab; label: string }[] = [
  { key: 'current', label: 'Current Stock' },
  { key: 'batch', label: 'Batch Inventory' },
  { key: 'ledger', label: 'Movement Ledger' },
  { key: 'reorder', label: 'Reorder / Low Stock' },
  { key: 'ageing', label: 'Stock Ageing' },
];

const exportMap: Record<Tab, string> = {
  current: 'current-stock',
  batch: 'batch-inventory',
  ledger: 'movement-ledger',
  reorder: 'reorder',
  ageing: 'stock-ageing',
};

export default function InventoryReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('current');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const filters = { limit: pageSize, offset: (page - 1) * pageSize };

  const currentStock = useCurrentStock(filters, activeTab === 'current');
  const batchInv = useBatchInventory(filters, activeTab === 'batch');
  const ledger = useMovementLedger(filters, activeTab === 'ledger');
  const reorder = useReorderReport(filters, activeTab === 'reorder');
  const ageing = useStockAgeing(filters, activeTab === 'ageing');

  const queryMap = { current: currentStock, batch: batchInv, ledger, reorder, ageing };
  const activeQuery = queryMap[activeTab];

  const currentCols: Column<CurrentStockRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '100px' },
    { key: 'on_hand_qty', header: 'On Hand', accessor: (r) => fmt(r.on_hand_qty), align: 'right' },
    { key: 'available_qty', header: 'Available', accessor: (r) => fmt(r.available_qty), align: 'right' },
    { key: 'in_transit_qty', header: 'In Transit', accessor: (r) => fmt(r.in_transit_qty), align: 'right' },
    { key: 'on_order_qty', header: 'On Order', accessor: (r) => fmt(r.on_order_qty), align: 'right' },
    { key: 'inventory_value', header: 'Value', accessor: (r) => fmtCurrency(r.inventory_value), align: 'right' },
  ];

  const batchCols: Column<BatchInventoryRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right' },
    { key: 'cost_per_unit', header: 'Unit Cost', accessor: (r) => fmtCurrency(r.cost_per_unit), align: 'right' },
    { key: 'expiry_date', header: 'Expiry', accessor: (r) => fmtDate(r.expiry_date) },
    { key: 'days_to_expiry', header: 'Days Left', accessor: (r) => r.days_to_expiry != null ? (
      <span className={r.days_to_expiry <= 30 ? 'text-red-600 font-semibold' : r.days_to_expiry <= 90 ? 'text-amber-600' : ''}>
        {r.days_to_expiry}
      </span>
    ) : '—', align: 'right' },
    { key: 'batch_status', header: 'Status', accessor: (r) => <Badge variant={r.batch_status === 'AVAILABLE' ? 'success' : r.batch_status === 'QUARANTINE' ? 'warning' : 'default'} size="sm">{r.batch_status}</Badge> },
  ];

  const ledgerCols: Column<MovementLedgerRow>[] = [
    { key: 'transaction_date', header: 'Date', accessor: (r) => fmtDate(r.transaction_date), width: '100px' },
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'entry_type', header: 'Type', accessor: (r) => <Badge variant={r.entry_type.includes('RECEIPT') || r.entry_type.includes('IN') ? 'success' : r.entry_type.includes('ISSUE') || r.entry_type.includes('OUT') ? 'error' : 'default'} size="sm">{r.entry_type}</Badge> },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right' },
    { key: 'total_cost', header: 'Value', accessor: (r) => fmtCurrency(r.total_cost), align: 'right' },
    { key: 'running_balance', header: 'Balance', accessor: (r) => fmt(r.running_balance), align: 'right' },
    { key: 'batch_number', header: 'Batch', accessor: (r) => r.batch_number ?? '—', width: '100px' },
  ];

  const reorderCols: Column<ReorderRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'on_hand_qty', header: 'On Hand', accessor: (r) => fmt(r.on_hand_qty), align: 'right' },
    { key: 'reorder_point', header: 'Reorder Pt', accessor: (r) => fmt(r.reorder_point), align: 'right' },
    { key: 'safety_stock_qty', header: 'Safety', accessor: (r) => fmt(r.safety_stock_qty), align: 'right' },
    { key: 'avg_daily_sales', header: 'Avg/Day', accessor: (r) => r.avg_daily_sales?.toFixed(1) ?? '—', align: 'right' },
    { key: 'suggested_order_qty', header: 'Suggested Qty', accessor: (r) => <span className="font-semibold text-primary-700">{fmt(r.suggested_order_qty)}</span>, align: 'right' },
    { key: 'abc_class', header: 'ABC', accessor: (r) => <Badge variant={r.abc_class === 'A' ? 'error' : r.abc_class === 'B' ? 'warning' : 'default'} size="sm">{r.abc_class ?? '—'}</Badge> },
    { key: 'days_of_stock', header: 'Days Stock', accessor: (r) => r.days_of_stock != null ? r.days_of_stock.toFixed(0) : '—', align: 'right' },
  ];

  const ageingCols: Column<StockAgeingRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'age_days', header: 'Age (Days)', accessor: (r) => r.age_days >= 0 ? fmt(r.age_days) : '—', align: 'right' },
    { key: 'age_bucket', header: 'Bucket', accessor: (r) => <Badge variant={r.age_bucket.startsWith('>') ? 'error' : r.age_bucket.includes('181') ? 'warning' : 'default'} size="sm">{r.age_bucket}</Badge> },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right' },
    { key: 'batch_value', header: 'Value', accessor: (r) => fmtCurrency(r.batch_value), align: 'right' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory & Stock Reports</h1>
          <p className="mt-1 text-sm text-gray-500">Current stock, batch details, movements, reorder analysis, and ageing</p>
        </div>
        <ExportToolbar reportType={exportMap[activeTab]} filters={{}} />
      </div>

      {/* Tab Navigation */}
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

      {activeQuery?.isError && <QueryErrorBanner error={activeQuery.error} />}

      {/* Ageing summary if on ageing tab */}
      {activeTab === 'ageing' && ageing.data?.summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {ageing.data.summary.map((s) => (
            <Card key={s.bucket} padding="sm">
              <p className="text-xs text-gray-500 font-medium">{s.bucket}</p>
              <p className="text-lg font-bold text-gray-900">{fmt(s.total_qty)}</p>
              <p className="text-xs text-gray-500">{fmtCurrency(s.total_value)}</p>
            </Card>
          ))}
        </div>
      )}

      <Card padding="none">
        <CardHeader
          title={tabs.find((t) => t.key === activeTab)?.label ?? ''}
          className="px-6 pt-6"
        />

        {activeTab === 'current' && (
          <DataTable<CurrentStockRow>
            data={currentStock.data?.data ?? []}
            columns={currentCols}
            keyExtractor={(r) => `${r.product_id}-${r.location_id}`}
            isLoading={currentStock.isLoading}
            emptyMessage="No stock data"
            pagination={{
              page,
              pageSize,
              total: currentStock.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: () => {},
            }}
          />
        )}

        {activeTab === 'batch' && (
          <DataTable<BatchInventoryRow>
            data={batchInv.data?.data ?? []}
            columns={batchCols}
            keyExtractor={(r) => r.batch_id}
            isLoading={batchInv.isLoading}
            emptyMessage="No batch data"
            pagination={{
              page,
              pageSize,
              total: batchInv.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: () => {},
            }}
          />
        )}

        {activeTab === 'ledger' && (
          <DataTable<MovementLedgerRow>
            data={ledger.data?.data ?? []}
            columns={ledgerCols}
            keyExtractor={(r) => r.id}
            isLoading={ledger.isLoading}
            emptyMessage="No transactions"
            pagination={{
              page,
              pageSize,
              total: ledger.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: () => {},
            }}
          />
        )}

        {activeTab === 'reorder' && (
          <DataTable<ReorderRow>
            data={reorder.data?.data ?? []}
            columns={reorderCols}
            keyExtractor={(r) => `${r.product_id}-${r.location_id}`}
            isLoading={reorder.isLoading}
            emptyMessage="No items below reorder point"
            pagination={{
              page,
              pageSize,
              total: reorder.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: () => {},
            }}
          />
        )}

        {activeTab === 'ageing' && (
          <DataTable<StockAgeingRow>
            data={ageing.data?.data ?? []}
            columns={ageingCols}
            keyExtractor={(r) => `${r.product_id}-${r.batch_number}`}
            isLoading={ageing.isLoading}
            emptyMessage="No ageing data"
            pagination={{
              page,
              pageSize,
              total: ageing.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: () => {},
            }}
          />
        )}
      </Card>
    </div>
  );
}
