import { useState } from 'react';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import {
    useStockOuts,
    useSuggestedPurchase,
    useSupplierPerformance,
} from '../../hooks/usePharmaReports';
import type {
    StockOutRow,
    SuggestedPurchaseRow,
    SupplierPerformanceRow,
} from '../../services/api/pharma-reports.service';
import ExportToolbar from './ExportToolbar';
import { fmt, fmtCurrency, fmtDate, fmtPct } from './shared';

type Tab = 'purchase' | 'supplier' | 'stockouts';

const tabs: { key: Tab; label: string }[] = [
  { key: 'purchase', label: 'Suggested Purchase' },
  { key: 'supplier', label: 'Supplier Performance' },
  { key: 'stockouts', label: 'Stock-outs' },
];

const exportMap: Record<Tab, string> = {
  purchase: 'suggested-purchase',
  supplier: 'supplier-performance',
  stockouts: 'suggested-purchase',
};

export default function ProcurementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('purchase');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const filters = { limit: pageSize, offset: page * pageSize };

  const purchase = useSuggestedPurchase(activeTab === 'purchase' ? filters : undefined);
  const supplier = useSupplierPerformance(activeTab === 'supplier' ? filters : undefined);
  const stockouts = useStockOuts(activeTab === 'stockouts' ? filters : undefined);

  const purchaseCols: Column<SuggestedPurchaseRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'current_stock', header: 'On Hand', accessor: (r) => fmt(r.current_stock), align: 'right' },
    { key: 'reorder_point', header: 'ROP', accessor: (r) => fmt(r.reorder_point), align: 'right' },
    { key: 'on_order_qty', header: 'On Order', accessor: (r) => fmt(r.on_order_qty), align: 'right' },
    { key: 'safety_stock', header: 'Safety', accessor: (r) => fmt(r.safety_stock), align: 'right' },
    { key: 'lead_time_days', header: 'Lead (d)', accessor: (r) => r.lead_time_days ?? '—', align: 'right' },
    { key: 'suggested_purchase_qty', header: 'Suggested Qty', accessor: (r) => (
      <span className="font-bold text-primary-700">{fmt(r.suggested_purchase_qty)}</span>
    ), align: 'right' },
    { key: 'estimated_cost', header: 'Est. Cost', accessor: (r) => fmtCurrency(r.estimated_cost), align: 'right' },
    { key: 'preferred_supplier', header: 'Supplier', accessor: (r) => r.preferred_supplier ?? '—' },
  ];

  const supplierCols: Column<SupplierPerformanceRow>[] = [
    { key: 'supplier_code', header: 'Code', accessor: 'supplier_code', width: '90px' },
    { key: 'supplier_name', header: 'Supplier', accessor: 'supplier_name' },
    { key: 'total_orders', header: 'Orders', accessor: (r) => fmt(r.total_orders), align: 'right' },
    { key: 'total_order_value', header: 'Total Value', accessor: (r) => fmtCurrency(r.total_order_value), align: 'right' },
    { key: 'on_time_pct', header: 'On-Time %', accessor: (r) => {
      const rate = r.on_time_pct;
      const color = rate >= 95 ? 'text-green-600' : rate >= 80 ? 'text-amber-600' : 'text-red-600';
      return <span className={`font-semibold ${color}`}>{fmtPct(rate)}</span>;
    }, align: 'right' },
    { key: 'avg_lead_time_days', header: 'Avg Lead (d)', accessor: (r) => r.avg_lead_time_days?.toFixed(1) ?? '—', align: 'right' },
    { key: 'quality_rating', header: 'Quality', accessor: (r) => {
      const q = r.quality_rating;
      if (q == null) return '—';
      const stars = '★'.repeat(Math.round(q)) + '☆'.repeat(5 - Math.round(q));
      return <span className="text-amber-500 tracking-wide">{stars}</span>;
    }, align: 'center' },
    { key: 'received_orders', header: 'Received', accessor: (r) => fmt(r.received_orders), align: 'right' },
  ];

  const stockoutCols: Column<StockOutRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'product_name', header: 'Product', accessor: 'product_name' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px' },
    { key: 'stockout_start', header: 'Out Since', accessor: (r) => fmtDate(r.stockout_start) },
    { key: 'stockout_days', header: 'Days Out', accessor: (r) => (
      <span className={r.stockout_days > 14 ? 'text-red-600 font-bold' : 'text-amber-600 font-semibold'}>
        {r.stockout_days}
      </span>
    ), align: 'right' },
    { key: 'stockout_end', header: 'Resolved', accessor: (r) => r.stockout_end ? fmtDate(r.stockout_end) : (
      <Badge variant="error" size="sm">Active</Badge>
    ) },
    { key: 'is_currently_out', header: 'Status', accessor: (r) => r.is_currently_out ? (
      <Badge variant="error" size="sm">Out of Stock</Badge>
    ) : (
      <Badge variant="success" size="sm">Resolved</Badge>
    ), align: 'center' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Procurement & Supply</h1>
          <p className="mt-1 text-sm text-gray-500">Purchase suggestions, supplier analytics, and stock-out tracking</p>
        </div>
        <ExportToolbar reportType={exportMap[activeTab]} filters={{}} />
      </div>

      {/* Tabs */}
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

      {/* Suggested Purchase */}
      {activeTab === 'purchase' && (
        <>
          {purchase.isError && <QueryErrorBanner error={purchase.error} />}
          <Card padding="none">
            <CardHeader
              title="Suggested Purchase Orders"
              description="Items below reorder point with auto-calculated quantities"
              className="px-6 pt-6"
            />
            <DataTable<SuggestedPurchaseRow>
              data={purchase.data?.data ?? []}
              columns={purchaseCols}
              keyExtractor={(r) => `${r.product_id}-${r.location_code}`}
              isLoading={purchase.isLoading}
              emptyMessage="No purchase suggestions — all items are adequately stocked"
              pagination={{
                page,
                pageSize,
                total: purchase.data?.total ?? 0,
                onPageChange: setPage,
                onPageSizeChange: () => {},
              }}
            />
          </Card>
        </>
      )}

      {/* Supplier Performance */}
      {activeTab === 'supplier' && (
        <>
          {supplier.isError && <QueryErrorBanner error={supplier.error} />}
          <Card padding="none">
            <CardHeader
              title="Supplier Scorecard"
              description="Delivery, quality, and cost performance by supplier"
              className="px-6 pt-6"
            />
            <DataTable<SupplierPerformanceRow>
              data={supplier.data?.data ?? []}
              columns={supplierCols}
              keyExtractor={(r) => r.supplier_id}
              isLoading={supplier.isLoading}
              emptyMessage="No supplier data available"
              pagination={{
                page,
                pageSize,
                total: supplier.data?.total ?? 0,
                onPageChange: setPage,
                onPageSizeChange: () => {},
              }}
            />
          </Card>
        </>
      )}

      {/* Stock-outs */}
      {activeTab === 'stockouts' && (
        <>
          {stockouts.isError && <QueryErrorBanner error={stockouts.error} />}
          <Card padding="none">
            <CardHeader
              title="Active Stock-outs"
              description="Products currently out of stock with estimated impact"
              className="px-6 pt-6"
            />
            <DataTable<StockOutRow>
              data={stockouts.data?.data ?? []}
              columns={stockoutCols}
              keyExtractor={(r) => `${r.product_id}-${r.location_code}`}
              isLoading={stockouts.isLoading}
              emptyMessage="No active stock-outs"
              pagination={{
                page,
                pageSize,
                total: stockouts.data?.total ?? 0,
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
