import { useState } from 'react';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import {
  useStockOuts,
  useSuggestedPurchase,
  useSupplierPerformance,
} from '../../hooks/usePharmaReports';
import type {
  ProcurementDataSyncAnalysis,
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
  stockouts: 'stock-out',
};

function renderPct(value: number | null | undefined) {
  if (value == null) return '—';
  return fmtPct(value);
}

function renderSignedQty(value: number) {
  if (value === 0) return fmt(0, 2);
  return `${value > 0 ? '+' : '-'}${fmt(Math.abs(value), 2)}`;
}

function getMappingBadge(status: SupplierPerformanceRow['mapping_status']) {
  switch (status) {
    case 'EXPLICIT_MARG_MAPPING':
      return { label: 'Mapped', variant: 'success' as const };
    case 'MARG_ONLY_UNMAPPED':
      return { label: 'Marg only', variant: 'warning' as const };
    default:
      return { label: 'Needs mapping', variant: 'warning' as const };
  }
}

function getSpendSourceLabel(source: SupplierPerformanceRow['spend_source']) {
  switch (source) {
    case 'MARG_PURCHASE_INVOICE_EXPLICIT_MAPPING':
      return 'Marg invoice';
    case 'MARG_PURCHASE_INVOICE_UNMAPPED':
      return 'Marg only';
    case 'LOCAL_PURCHASE_ORDER_NO_MARG_INVOICE_OVERLAP':
      return 'Local PO';
    case 'LOCAL_PURCHASE_ORDER_EXPLICIT_MAPPING_FALLBACK':
      return 'Local fallback';
    case 'REQUIRES_EXPLICIT_MARG_MAPPING':
      return 'Mapping required';
    default:
      return '—';
  }
}

function SyncAnalysisCard({ analysis }: { analysis: ProcurementDataSyncAnalysis }) {
  const blocks = [
    { label: 'Purchase Orders', value: analysis.purchaseOrders },
    { label: 'Purchase Invoices', value: analysis.purchaseInvoices },
    { label: 'Goods Receipts', value: analysis.goodsReceipts },
    { label: 'Stock Transactions', value: analysis.stockTransactions },
  ];

  return (
    <Card>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Data Sync Analysis</h2>
          <p className="mt-1 text-sm text-gray-500">
            Marg EDE is authoritative for posted invoices and stock movements, but supplier OTIF metrics still depend on whether local PO, GRN, and QC records exist.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {blocks.map((block) => (
            <div key={block.label} className="rounded-lg border border-secondary-200 bg-secondary-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">{block.label}</p>
                <Badge variant={block.value.syncedFromMarg ? 'success' : 'warning'} size="sm">
                  {block.value.syncedFromMarg ? 'Marg Sync' : 'Fallback'}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-gray-900">
                Marg: {fmt(block.value.margRecordCount)} | Local: {fmt(block.value.localRecordCount)}
              </p>
              <p className="mt-2 text-xs text-gray-500">{block.value.notes[0]}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-secondary-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">Source Of Truth</p>
            <div className="mt-2 space-y-2 text-sm text-gray-700">
              <p>{analysis.sourceOfTruth.supplierPerformanceMetrics}</p>
              <p>{analysis.sourceOfTruth.leadTimeCalculation}</p>
              <p>{analysis.sourceOfTruth.spendCalculation}</p>
            </div>
          </div>
          <div className="rounded-lg border border-secondary-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">Fallback Logic</p>
            <div className="mt-2 space-y-2 text-sm text-gray-700">
              {analysis.fallbackLogic.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-secondary-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">Risks</p>
            <div className="mt-2 space-y-2 text-sm text-gray-700">
              {analysis.risks.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function ProcurementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('purchase');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const filters = { limit: pageSize, offset: page * pageSize };

  const purchase = useSuggestedPurchase(activeTab === 'purchase' ? filters : undefined);
  const supplier = useSupplierPerformance(activeTab === 'supplier' ? filters : undefined);
  const stockouts = useStockOuts(activeTab === 'stockouts' ? filters : undefined);
  const activeAnalysis = activeTab === 'supplier' ? supplier.data?.analysis : activeTab === 'stockouts' ? stockouts.data?.analysis : null;

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
    {
      key: 'supplier_name',
      header: 'Supplier Name',
      accessor: (r) => {
        const badge = getMappingBadge(r.mapping_status);
        return (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium text-gray-900">{r.supplier_name}</div>
              <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
            </div>
            <div className="text-xs text-gray-500">{r.supplier_code ?? r.order_source}</div>
          </div>
        );
      },
    },
    { key: 'total_orders', header: 'Total Orders', accessor: (r) => fmt(r.total_orders), align: 'right' },
    { key: 'on_time_delivery_pct', header: 'On-Time Delivery %', accessor: (r) => {
      const rate = r.on_time_delivery_pct;
      if (rate == null) return '—';
      const color = rate >= 95 ? 'text-green-600' : rate >= 80 ? 'text-amber-600' : 'text-red-600';
      return <span className={`font-semibold ${color}`}>{renderPct(rate)}</span>;
    }, align: 'right' },
    { key: 'avg_lead_time_days', header: 'Avg Lead Time', accessor: (r) => r.avg_lead_time_days != null ? `${r.avg_lead_time_days.toFixed(1)} d` : '—', align: 'right' },
    { key: 'fulfillment_rate_pct', header: 'Fulfillment Rate %', accessor: (r) => renderPct(r.fulfillment_rate_pct), align: 'right' },
    { key: 'rejection_rate_pct', header: 'Rejection Rate %', accessor: (r) => renderPct(r.rejection_rate_pct), align: 'right' },
    {
      key: 'total_spend',
      header: 'Total Spend',
      accessor: (r) => (
        <div className="text-right">
          <div>{r.total_spend != null ? fmtCurrency(r.total_spend) : '—'}</div>
          <div className={`text-xs ${r.spend_note ? 'text-amber-600' : 'text-gray-500'}`}>
            {r.spend_note ?? getSpendSourceLabel(r.spend_source)}
          </div>
        </div>
      ),
      align: 'right',
    },
  ];

  const stockoutCols: Column<StockOutRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px' },
    { key: 'item_name', header: 'Item Name', accessor: 'item_name' },
    { key: 'stock_out_count', header: 'Stock-Out Count', accessor: (r) => fmt(r.stock_out_count), align: 'right' },
    { key: 'total_duration_days', header: 'Total Duration', accessor: (r) => (
      <span className={r.total_duration_days > 14 ? 'text-red-600 font-bold' : 'text-amber-600 font-semibold'}>
        {fmt(r.total_duration_days)} d
      </span>
    ), align: 'right' },
    { key: 'last_stock_out_date', header: 'Last Stock-Out Date', accessor: (r) => fmtDate(r.last_stock_out_date) },
    {
      key: 'current_stock',
      header: 'Current Stock',
      accessor: (r) => (
        <div className="text-right">
          <div className={r.current_stock <= 0 ? 'text-red-600 font-bold' : 'text-gray-900 font-medium'}>{fmt(r.current_stock, 2)}</div>
          <div className={`text-xs ${r.current_stock_source === 'DIVERGES_FROM_MARG' ? 'text-amber-600' : 'text-gray-500'}`}>
            Marg {fmt(r.marg_current_stock, 2)} | Δ {renderSignedQty(r.current_stock_delta)}
          </div>
        </div>
      ),
      align: 'right',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Procurement & Supply</h1>
          <p className="mt-1 text-sm text-gray-500">Validate Marg sync coverage first, then review supplier performance and stock-out behavior with explicit source-of-truth caveats.</p>
        </div>
        <ExportToolbar reportType={exportMap[activeTab]} filters={{}} />
      </div>

      {activeAnalysis && <SyncAnalysisCard analysis={activeAnalysis} />}

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
              description="On-time delivery, lead time, fulfillment, rejection, and spend with Marg-vs-local provenance exposed"
              className="px-6 pt-6"
            />
            <DataTable<SupplierPerformanceRow>
              data={supplier.data?.data ?? []}
              columns={supplierCols}
              keyExtractor={(r) => r.supplier_key}
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
              title="Stock-Out Report"
              description="Marg-backed stock-out frequency, total duration, last zero-stock date, and current on-hand position with live-vs-Marg drift exposed"
              className="px-6 pt-6"
            />
            <DataTable<StockOutRow>
              data={stockouts.data?.data ?? []}
              columns={stockoutCols}
              keyExtractor={(r) => r.product_id}
              isLoading={stockouts.isLoading}
              emptyMessage="No Marg-backed stock-out history found"
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
