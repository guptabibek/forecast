import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid';
import { useMemo, useState } from 'react';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, Modal, QueryErrorBanner } from '../../components/ui';
import { DetailPopupActions } from '../../components/reports/DetailPopupActions';
import { usePharmaGrid } from '../../hooks/usePharmaGrid';
import { usePdfPayload } from '../../hooks/usePdfPayload';
import {
  useStockOuts,
  useSuggestedPurchase,
  useSupplierPerformance,
  useSupplierPerformancePurchaseInvoices,
  useSupplierPerformancePurchaseOrders,
} from '../../hooks/usePharmaReports';
import type {
  PharmaFilters,
  StockOutRow,
  SuggestedPurchaseRow,
  SupplierPerformancePurchaseInvoiceDetailRow,
  SupplierPerformancePurchaseOrderDetailRow,
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

type SupplierDrilldownKind = 'purchase-orders' | 'purchase-invoices';
type SupplierDrilldownState = {
  kind: SupplierDrilldownKind;
  supplier: SupplierPerformanceRow;
} | null;

const reportContextKeys = new Set(['startDate', 'endDate', 'supplierIds', 'companyId', 'status', 'includeFallbackPurchaseOrders']);

function pickReportContextFilters(params: PharmaFilters): PharmaFilters {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => reportContextKeys.has(key)),
  ) as PharmaFilters;
}

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
    case 'CORE_PURCHASE_INVOICE_GRN':
      return 'Core GRN';
    case 'CORE_PURCHASE_ORDER':
      return 'Core PO';
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

function getStatusVariant(status: string): 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'RECEIVED':
    case 'CLOSED':
    case 'SYNCED':
    case 'POSTED':
      return 'success';
    case 'SENT':
    case 'PARTIALLY_RECEIVED':
    case 'APPROVED':
      return 'primary';
    case 'DRAFT':
    case 'PENDING_APPROVAL':
      return 'secondary';
    case 'CANCELLED':
      return 'error';
    default:
      return 'default';
  }
}

function openPath(path: string | null | undefined) {
  if (!path) return;
  window.open(path, '_blank', 'noopener,noreferrer');
}

export default function ProcurementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('purchase');
  const [drilldown, setDrilldown] = useState<SupplierDrilldownState>(null);

  const purchaseGrid = usePharmaGrid({ initialSortBy: 'sku' });
  const supplierGrid = usePharmaGrid({ initialSortBy: 'supplier_name' });
  const stockoutGrid = usePharmaGrid({ initialSortBy: 'last_stock_out_date', initialSortOrder: 'desc' });
  const poDrilldownGrid = usePharmaGrid({ initialSortBy: 'document_date', initialSortOrder: 'desc', initialPageSize: 25 });
  const piDrilldownGrid = usePharmaGrid({ initialSortBy: 'document_date', initialSortOrder: 'desc', initialPageSize: 25 });

  const purchase = useSuggestedPurchase(purchaseGrid.pharmaParams, activeTab === 'purchase');
  const supplier = useSupplierPerformance(supplierGrid.pharmaParams, activeTab === 'supplier');
  const stockouts = useStockOuts(stockoutGrid.pharmaParams, activeTab === 'stockouts');
  const supplierContextFilters = pickReportContextFilters(supplierGrid.pharmaParams);
  const purchaseOrders = useSupplierPerformancePurchaseOrders(
    drilldown?.supplier.supplier_key,
    { ...supplierContextFilters, ...poDrilldownGrid.pharmaParams },
    activeTab === 'supplier' && drilldown?.kind === 'purchase-orders',
  );
  const purchaseInvoices = useSupplierPerformancePurchaseInvoices(
    drilldown?.supplier.supplier_key,
    { ...supplierContextFilters, ...piDrilldownGrid.pharmaParams },
    activeTab === 'supplier' && drilldown?.kind === 'purchase-invoices',
  );
  const exportFilters: Record<Tab, Record<string, unknown>> = {
    purchase: purchaseGrid.pharmaParams,
    supplier: supplierGrid.pharmaParams,
    stockouts: stockoutGrid.pharmaParams,
  };
  const queryMap = { purchase, supplier, stockouts };
  const activeQuery = queryMap[activeTab];
  const gridMap = { purchase: purchaseGrid, supplier: supplierGrid, stockouts: stockoutGrid };
  const activeGrid = gridMap[activeTab];

  const openDrilldown = (kind: SupplierDrilldownKind, row: SupplierPerformanceRow) => {
    setDrilldown({ kind, supplier: row });
  };

  const renderDrilldownValue = (row: SupplierPerformanceRow, kind: SupplierDrilldownKind, value: number) => (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openDrilldown(kind, row);
      }}
      disabled={value <= 0}
      className={`font-semibold ${value > 0 ? 'text-primary-700 underline-offset-2 hover:underline' : 'text-gray-400 cursor-default'}`}
      title={value > 0 ? 'Show related documents' : 'No related documents'}
    >
      {fmt(value)}
    </button>
  );

  const purchaseCols: Column<SuggestedPurchaseRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px', filterType: 'text', filterField: 'location_code' },
    { key: 'current_stock', header: 'On Hand', accessor: (r) => fmt(r.current_stock), align: 'right', sortable: true, filterType: 'number', filterField: 'current_stock' },
    { key: 'reorder_point', header: 'ROP', accessor: (r) => fmt(r.reorder_point), align: 'right' },
    { key: 'on_order_qty', header: 'On Order', accessor: (r) => fmt(r.on_order_qty), align: 'right', filterType: 'number', filterField: 'on_order_qty' },
    { key: 'safety_stock', header: 'Safety', accessor: (r) => fmt(r.safety_stock), align: 'right' },
    { key: 'lead_time_days', header: 'Lead (d)', accessor: (r) => r.lead_time_days ?? '—', align: 'right', filterType: 'number', filterField: 'lead_time_days' },
    {
      key: 'suggested_purchase_qty', header: 'Suggested Qty', align: 'right',
      accessor: (r) => <span className="font-bold text-primary-700">{fmt(r.suggested_purchase_qty)}</span>,
    },
    { key: 'estimated_cost', header: 'Est. Cost', accessor: (r) => fmtCurrency(r.estimated_cost), align: 'right' },
    { key: 'preferred_supplier', header: 'Supplier', accessor: (r) => r.preferred_supplier ?? '—' },
  ];

  const supplierCols: Column<SupplierPerformanceRow>[] = [
    {
      key: 'supplier_name',
      header: 'Supplier Name',
      sortable: true, filterType: 'text', filterField: 'supplier_name',
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
    {
      key: 'total_orders',
      header: 'Purchase Orders',
      accessor: (r) => renderDrilldownValue(r, 'purchase-orders', r.total_orders),
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'total_orders',
    },
    {
      key: 'purchase_invoice_count',
      header: 'Purchase Invoices',
      accessor: (r) => renderDrilldownValue(r, 'purchase-invoices', r.purchase_invoice_count),
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'purchase_invoice_count',
    },
    {
      key: 'on_time_delivery_pct', header: 'On-Time Delivery %', align: 'right',
      sortable: true, filterType: 'number', filterField: 'on_time_delivery_pct',
      accessor: (r) => {
        const rate = r.on_time_delivery_pct;
        if (rate == null) return '—';
        const color = rate >= 95 ? 'text-green-600' : rate >= 80 ? 'text-amber-600' : 'text-red-600';
        return <span className={`font-semibold ${color}`}>{renderPct(rate)}</span>;
      },
    },
    { key: 'avg_lead_time_days', header: 'Avg Lead Time', accessor: (r) => r.avg_lead_time_days != null ? `${r.avg_lead_time_days.toFixed(1)} d` : '—', align: 'right', sortable: true, filterType: 'number', filterField: 'avg_lead_time_days' },
    { key: 'fulfillment_rate_pct', header: 'Fulfillment Rate %', accessor: (r) => renderPct(r.fulfillment_rate_pct), align: 'right', filterType: 'number', filterField: 'fulfillment_rate_pct' },
    { key: 'rejection_rate_pct', header: 'Rejection Rate %', accessor: (r) => renderPct(r.rejection_rate_pct), align: 'right', filterType: 'number', filterField: 'rejection_rate_pct' },
    {
      key: 'total_spend',
      header: 'Total Spend',
      align: 'right',
      filterType: 'number', filterField: 'total_spend',
      accessor: (r) => (
        <div className="text-right">
          <div>{r.total_spend != null ? fmtCurrency(r.total_spend) : '—'}</div>
          <div className={`text-xs ${r.spend_note ? 'text-amber-600' : 'text-gray-500'}`}>
            {r.spend_note ?? getSpendSourceLabel(r.spend_source)}
          </div>
        </div>
      ),
    },
  ];

  const purchaseOrderDetailCols: Column<SupplierPerformancePurchaseOrderDetailRow>[] = [
    {
      key: 'document_number',
      header: 'PO No.',
      accessor: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.document_number}</div>
          <div className="text-xs text-gray-500">{fmtDate(row.document_date)}</div>
        </div>
      ),
      sortable: true,
      filterType: 'text',
      filterField: 'document_number',
    },
    { key: 'supplier_name', header: 'Supplier', accessor: (row) => row.supplier_name, filterType: 'text', filterField: 'supplier_name' },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => <Badge variant={getStatusVariant(row.status)} size="sm">{row.status}</Badge>,
      sortable: true,
      filterType: 'select',
      filterField: 'status',
      filterOptions: [
        { value: 'APPROVED', label: 'Approved' },
        { value: 'SENT', label: 'Sent' },
        { value: 'PARTIALLY_RECEIVED', label: 'Partially Received' },
        { value: 'RECEIVED', label: 'Received' },
        { value: 'CLOSED', label: 'Closed' },
      ],
    },
    { key: 'expected_date', header: 'Expected', accessor: (row) => fmtDate(row.expected_date), sortable: true, filterType: 'date', filterField: 'expected_date' },
    { key: 'line_count', header: 'Lines', accessor: (row) => fmt(row.line_count), align: 'right', sortable: true, filterType: 'number', filterField: 'line_count' },
    { key: 'ordered_qty', header: 'Ordered', accessor: (row) => fmt(row.ordered_qty, 2), align: 'right', sortable: true, filterType: 'number', filterField: 'ordered_qty' },
    { key: 'received_qty', header: 'Received', accessor: (row) => fmt(row.received_qty, 2), align: 'right', sortable: true, filterType: 'number', filterField: 'received_qty' },
    { key: 'pending_qty', header: 'Pending', accessor: (row) => fmt(row.pending_qty, 2), align: 'right', sortable: true, filterType: 'number', filterField: 'pending_qty' },
    { key: 'total_amount', header: 'Amount', accessor: (row) => fmtCurrency(row.total_amount), align: 'right', sortable: true, filterType: 'number', filterField: 'total_amount' },
    { key: 'currency', header: 'Currency', accessor: (row) => row.currency, width: '90px' },
    {
      key: 'actions',
      header: '',
      accessor: (row) => (
        <button
          type="button"
          onClick={() => openPath(row.open_path)}
          className="inline-flex items-center rounded p-1 text-primary-700 hover:bg-primary-50"
          title="Open purchase order"
        >
          <ArrowTopRightOnSquareIcon className="h-4 w-4" />
        </button>
      ),
      align: 'center',
      width: '56px',
    },
  ];

  const purchaseInvoiceDetailCols: Column<SupplierPerformancePurchaseInvoiceDetailRow>[] = [
    {
      key: 'document_number',
      header: 'Invoice No.',
      accessor: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.document_number}</div>
          {row.vcn && row.voucher && row.vcn !== row.voucher && <div className="text-xs text-gray-500">{row.voucher}</div>}
        </div>
      ),
      sortable: true,
      filterType: 'text',
      filterField: 'document_number',
    },
    { key: 'document_date', header: 'Date', accessor: (row) => fmtDate(row.document_date), sortable: true, filterType: 'date', filterField: 'document_date' },
    { key: 'company_id', header: 'Company', accessor: (row) => row.company_id, align: 'right', sortable: true, filterType: 'number', filterField: 'company_id' },
    { key: 'supplier_name', header: 'Supplier', accessor: (row) => row.supplier_name, filterType: 'text', filterField: 'supplier_name' },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => <Badge variant={getStatusVariant(row.status)} size="sm">{row.status}</Badge>,
      filterType: 'select',
      filterField: 'status',
      filterOptions: [
        { value: 'POSTED', label: 'Posted' },
      ],
    },
    { key: 'line_count', header: 'Lines', accessor: (row) => fmt(row.line_count), align: 'right', sortable: true, filterType: 'number', filterField: 'line_count' },
    { key: 'total_qty', header: 'Qty', accessor: (row) => fmt(row.total_qty, 2), align: 'right', sortable: true, filterType: 'number', filterField: 'total_qty' },
    { key: 'total_amount', header: 'Amount', accessor: (row) => fmtCurrency(row.total_amount), align: 'right', sortable: true, filterType: 'number', filterField: 'total_amount' },
    { key: 'currency', header: 'Currency', accessor: (row) => row.currency, width: '90px' },
    { key: 'orn', header: 'Order Ref', accessor: (row) => row.orn ?? '-', filterType: 'text', filterField: 'orn' },
    {
      key: 'actions',
      header: '',
      accessor: (row) => (
        <button
          type="button"
          onClick={() => openPath(row.open_path)}
          className="inline-flex items-center rounded p-1 text-primary-700 hover:bg-primary-50"
          title="Open purchase order"
        >
          <ArrowTopRightOnSquareIcon className="h-4 w-4" />
        </button>
      ),
      align: 'center',
      width: '56px',
    },
  ];

  const stockoutCols: Column<StockOutRow>[] = [
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'item_name', header: 'Item Name', accessor: 'item_name', filterType: 'text', filterField: 'item_name' },
    { key: 'stock_out_count', header: 'Stock-Out Count', accessor: (r) => fmt(r.stock_out_count), align: 'right', sortable: true, filterType: 'number', filterField: 'stock_out_count' },
    {
      key: 'total_duration_days', header: 'Total Duration', align: 'right',
      sortable: true, filterType: 'number', filterField: 'total_duration_days',
      accessor: (r) => (
        <span className={r.total_duration_days > 14 ? 'text-red-600 font-bold' : 'text-amber-600 font-semibold'}>
          {fmt(r.total_duration_days)} d
        </span>
      ),
    },
    { key: 'last_stock_out_date', header: 'Last Stock-Out Date', accessor: (r) => fmtDate(r.last_stock_out_date), sortable: true, filterType: 'date', filterField: 'last_stock_out_date' },
    {
      key: 'current_stock',
      header: 'Current Stock',
      align: 'right',
      filterType: 'number', filterField: 'current_stock',
      accessor: (r) => (
        <div className="text-right">
          <div className={r.current_stock <= 0 ? 'text-red-600 font-bold' : 'text-gray-900 font-medium'}>{fmt(r.current_stock, 2)}</div>
          <div className={`text-xs ${r.current_stock_source === 'DIVERGES_FROM_MARG' ? 'text-amber-600' : 'text-gray-500'}`}>
            Marg {fmt(r.marg_current_stock, 2)} | Δ {renderSignedQty(r.current_stock_delta)}
          </div>
        </div>
      ),
    },
  ];

  const pdfColsMap = {
    purchase: purchaseCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    supplier: supplierCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    stockouts: stockoutCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
  };

  const activeData = useMemo(() => {
    switch (activeTab) {
      case 'purchase': return (purchase.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'supplier': return (supplier.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'stockouts': return (stockouts.data?.data ?? []) as unknown as Record<string, unknown>[];
    }
  }, [activeTab, purchase.data, supplier.data, stockouts.data]);

  const pdfPayload = usePdfPayload({
    title: tabs.find((t) => t.key === activeTab)?.label ?? 'Procurement',
    reportKey: exportMap[activeTab],
    columns: pdfColsMap[activeTab],
    data: activeData,
    filters: exportFilters[activeTab],
    exportMode: 'current-page',
  });

  const drilldownTitle = drilldown
    ? `${drilldown.kind === 'purchase-orders' ? 'Purchase Orders' : 'Purchase Invoices'} - ${drilldown.supplier.supplier_name}`
    : 'Supplier Documents';

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Procurement & Supply</h1>
          <p className="mt-1 text-sm text-gray-500">Review supplier-wise PO counts, PI counts, spend provenance, and stock-out behavior with explicit source-of-truth caveats.</p>
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
              sorting={purchaseGrid.sortingProps}
              filtering={purchaseGrid.filteringProps}
              pagination={purchaseGrid.paginationProps(purchase.data?.total ?? 0)}
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
              description="Supplier-wise PO counts, PI counts, on-time delivery, lead time, fulfillment, rejection, and spend with Marg-vs-local provenance exposed"
              className="px-6 pt-6"
            />
            <DataTable<SupplierPerformanceRow>
              data={supplier.data?.data ?? []}
              columns={supplierCols}
              keyExtractor={(r) => r.supplier_key}
              isLoading={supplier.isLoading}
              emptyMessage="No supplier data available"
              sorting={supplierGrid.sortingProps}
              filtering={supplierGrid.filteringProps}
              pagination={supplierGrid.paginationProps(supplier.data?.total ?? 0)}
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
              sorting={stockoutGrid.sortingProps}
              filtering={stockoutGrid.filteringProps}
              pagination={stockoutGrid.paginationProps(stockouts.data?.total ?? 0)}
            />
          </Card>
        </>
      )}

      <Modal
        isOpen={!!drilldown}
        onClose={() => setDrilldown(null)}
        title={drilldownTitle}
        size="full"
      >
        {drilldown && (
          <div className="space-y-4">
            <DetailPopupActions
              title={drilldown.kind === 'purchase-orders' ? 'Purchase Orders' : 'Purchase Invoices'}
              documentNumber={drilldown.supplier.supplier_code ?? drilldown.supplier.supplier_name}
              fields={[
                { label: 'Supplier', value: drilldown.supplier.supplier_name },
                { label: 'Supplier Code', value: drilldown.supplier.supplier_code },
                { label: 'Total Orders', value: drilldown.supplier.total_orders },
                { label: 'Purchase Invoices', value: drilldown.supplier.purchase_invoice_count },
                { label: 'On-Time Delivery %', value: drilldown.supplier.on_time_delivery_pct != null ? `${drilldown.supplier.on_time_delivery_pct.toFixed(1)}%` : '—' },
                { label: 'Total Spend', value: drilldown.supplier.total_spend != null ? fmtCurrency(drilldown.supplier.total_spend) : '—' },
              ]}
            />
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span>{drilldown.supplier.supplier_code ?? drilldown.supplier.order_source}</span>
              <Badge variant={getMappingBadge(drilldown.supplier.mapping_status).variant} size="sm">
                {getMappingBadge(drilldown.supplier.mapping_status).label}
              </Badge>
            </div>

            {drilldown.kind === 'purchase-orders' ? (
              <>
                {purchaseOrders.isError && <QueryErrorBanner error={purchaseOrders.error} />}
                <DataTable<SupplierPerformancePurchaseOrderDetailRow>
                  data={purchaseOrders.data?.data ?? []}
                  columns={purchaseOrderDetailCols}
                  keyExtractor={(row) => row.id}
                  isLoading={purchaseOrders.isLoading}
                  emptyMessage="No purchase orders found for this supplier and report context"
                  sorting={poDrilldownGrid.sortingProps}
                  filtering={poDrilldownGrid.filteringProps}
                  pagination={poDrilldownGrid.paginationProps(purchaseOrders.data?.total ?? 0)}
                />
              </>
            ) : (
              <>
                {purchaseInvoices.isError && <QueryErrorBanner error={purchaseInvoices.error} />}
                <DataTable<SupplierPerformancePurchaseInvoiceDetailRow>
                  data={purchaseInvoices.data?.data ?? []}
                  columns={purchaseInvoiceDetailCols}
                  keyExtractor={(row) => row.id}
                  isLoading={purchaseInvoices.isLoading}
                  emptyMessage="No purchase invoices found for this supplier and report context"
                  sorting={piDrilldownGrid.sortingProps}
                  filtering={piDrilldownGrid.filteringProps}
                  pagination={piDrilldownGrid.paginationProps(purchaseInvoices.data?.total ?? 0)}
                />
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
