import { useMemo, useState } from 'react';
import { useTenantConfig } from '../../hooks/useTenantConfig';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, Modal, QueryErrorBanner } from '../../components/ui';
import { DetailPopupActions } from '../../components/reports/DetailPopupActions';
import { LineChart, PieChart } from '../../components/charts';
import { usePharmaGrid } from '../../hooks/usePharmaGrid';
import { usePdfPayload } from '../../hooks/usePdfPayload';
import {
  resolveSingleRange,
  SINGLE_RANGE_PRESETS,
  type SingleRangePresetId,
} from '../../utils/date-presets';
import {
  useSalesPurchaseBillDrilldown,
  useSalesPurchaseBills,
  useSalesPurchaseDimension,
  useSalesPurchaseItemDrilldown,
  useSalesPurchaseOverview,
  useSalesPurchasePartyDrilldown,
} from '../../hooks/usePharmaReports';
import type {
  SalesPurchaseAnalysisKind,
  SalesPurchaseBillRow,
  SalesPurchaseDimension,
  SalesPurchaseDimensionRow,
} from '../../services/api/pharma-reports.service';
import ExportToolbar from './ExportToolbar';
import { fmt, fmtCurrency, fmtDate, fmtPct } from './shared';

type Drilldown =
  | { type: 'bill'; key: string }
  | { type: 'item'; key: string; title: string }
  | { type: 'party'; key: string; title: string }
  | null;

const tabs: Array<{ key: SalesPurchaseAnalysisKind; label: string }> = [
  { key: 'sales', label: 'Sales Analysis' },
  { key: 'purchase', label: 'Purchase Analysis' },
];

function Stat({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <Card padding={compact ? 'sm' : 'md'}>
      <div className={`${compact ? 'text-[10px]' : 'text-[10px] lg:text-xs'} font-medium uppercase text-gray-500 truncate`}>{label}</div>
      <div className={`mt-0.5 ${compact ? 'text-sm' : 'text-sm lg:text-lg'} font-semibold text-gray-900 truncate`}>{value}</div>
    </Card>
  );
}

function rowValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return fmt(value, 2);
  return String(value);
}

const ALL_DIMENSION_TABS: Array<{ key: SalesPurchaseDimension; label: string; description: string; pharmaOnly?: boolean }> = [
  { key: 'salesman', label: 'Salesman', description: 'Sales by Salesman / MR — top performers and laggards' },
  { key: 'salt', label: 'Salt', description: 'Sales by drug salt (active ingredient) — therapeutic mix', pharmaOnly: true },
  { key: 'productCompany', label: 'Top Companies', description: 'Manufacturer / Marketer ranking by value' },
  { key: 'productGroup', label: 'Top Groups', description: 'Therapeutic group / classification ranking' },
  { key: 'product', label: 'Top Products', description: 'Top SKUs by value with margin context' },
  { key: 'hsnCode', label: 'HSN', description: 'HSN-code rollup for tax / GST audit' },
];

type ViewKey = 'overview' | 'bills' | 'dimension';

const VIEW_TABS: Array<{ key: ViewKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'bills', label: 'Bills' },
  { key: 'dimension', label: 'By Dimension' },
];

export default function SalesPurchaseAnalysisPage() {
  const { isPharma } = useTenantConfig();
  const DIMENSION_TABS = useMemo(() => ALL_DIMENSION_TABS.filter((d) => !d.pharmaOnly || isPharma), [isPharma]);
  const [kind, setKind] = useState<SalesPurchaseAnalysisKind>('sales');
  const [view, setView] = useState<ViewKey>('overview');
  const [drilldown, setDrilldown] = useState<Drilldown>(null);
  const [dimension, setDimension] = useState<SalesPurchaseDimension>('salesman');
  const dimensionGrid = usePharmaGrid({ initialSortBy: 'netAmount', initialSortOrder: 'desc', initialPageSize: 25 });
  const grid = usePharmaGrid({ initialSortBy: 'date', initialSortOrder: 'desc', initialPageSize: 25 });

  // Date range — defaults to last 30 days. Drives every query on this page.
  const initialRange = resolveSingleRange('last30');
  const [presetId, setPresetId] = useState<SingleRangePresetId>('last30');
  const [startDate, setStartDate] = useState<string>(initialRange?.startDate ?? '');
  const [endDate, setEndDate] = useState<string>(initialRange?.endDate ?? '');

  const dateScope = useMemo(
    () => ({ startDate: startDate || undefined, endDate: endDate || undefined }),
    [startDate, endDate],
  );

  const onPresetChange = (id: SingleRangePresetId) => {
    setPresetId(id);
    if (id === 'custom') return;
    const r = resolveSingleRange(id);
    if (r) {
      setStartDate(r.startDate);
      setEndDate(r.endDate);
    }
  };

  const overview = useSalesPurchaseOverview(kind, { ...dateScope, ...grid.pharmaParams }, view === 'overview');
  const bills = useSalesPurchaseBills(kind, { ...dateScope, ...grid.pharmaParams }, view === 'bills');
  const dimensionData = useSalesPurchaseDimension(
    kind,
    dimension,
    { ...dateScope, ...dimensionGrid.pharmaParams },
    view === 'dimension',
  );
  const billDetail = useSalesPurchaseBillDrilldown(kind, drilldown?.type === 'bill' ? drilldown.key : undefined);
  const itemDetail = useSalesPurchaseItemDrilldown(kind, drilldown?.type === 'item' ? drilldown.key : undefined, grid.pharmaParams);
  const partyDetail = useSalesPurchasePartyDrilldown(kind, drilldown?.type === 'party' ? drilldown.key : undefined, grid.pharmaParams);

  const summary = overview.data?.summary;
  const exportType = kind === 'sales' ? 'sales-analysis-bills' : 'purchase-analysis-bills';

  const columns = useMemo<Column<SalesPurchaseBillRow>[]>(() => {
    const partyLabel = kind === 'sales' ? 'Customer' : 'Supplier';
    const cols: Column<SalesPurchaseBillRow>[] = [
      { key: 'invoice_number', header: kind === 'sales' ? 'Invoice No.' : 'Bill / GRN No.', accessor: 'invoice_number', sortable: true, filterType: 'text', filterField: 'invoice_number' },
      { key: 'date', header: 'Date', accessor: (row) => fmtDate(row.date), sortable: true, filterType: 'date', filterField: 'date' },
      {
        key: 'party_name',
        header: partyLabel,
        accessor: (row) => (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (row.party_code) setDrilldown({ type: 'party', key: row.party_code, title: row.party_name });
            }}
            className="font-medium text-primary-700 underline-offset-2 hover:underline"
          >
            {row.party_name}
          </button>
        ),
        filterType: 'text',
        filterField: kind === 'sales' ? 'customer' : 'supplier',
      },
      { key: 'branch_name', header: 'Warehouse / Branch', accessor: 'branch_name', filterType: 'text', filterField: 'warehouse' },
      { key: 'salesman', header: kind === 'sales' ? 'Salesman' : 'User', accessor: (row) => row.salesman_display || row.salesman || row.user_name || '-', filterType: 'text', filterField: 'user' },
      { key: 'payment_mode', header: 'Payment', accessor: 'payment_mode', sortable: true, filterType: 'select', filterField: 'payment_mode', filterOptions: [{ value: 'CASH', label: 'Cash' }, { value: 'CREDIT', label: 'Credit' }, { value: 'MIXED', label: 'Mixed' }] },
      { key: 'gross_amount', header: 'Gross', accessor: (row) => fmtCurrency(row.gross_amount), align: 'right', sortable: true, filterType: 'number', filterField: 'gross_amount' },
      { key: 'discount', header: 'Discount', accessor: (row) => fmtCurrency(row.discount), align: 'right', filterType: 'number', filterField: 'discount' },
      { key: 'discount_pct', header: 'Disc %', accessor: (row) => row.discount_pct == null ? '-' : fmtPct(row.discount_pct), align: 'right', filterType: 'number', filterField: 'discount_pct' },
      { key: 'tax_amount', header: 'Tax', accessor: (row) => fmtCurrency(row.tax_amount), align: 'right', filterType: 'number', filterField: 'tax' },
      { key: 'net_amount', header: 'Net', accessor: (row) => fmtCurrency(row.net_amount), align: 'right', sortable: true, filterType: 'number', filterField: 'net_amount' },
    ];

    if (kind === 'sales') {
      cols.push(
        { key: 'cost_amount', header: 'Cost', accessor: (row) => fmtCurrency(row.cost_amount), align: 'right', filterType: 'number', filterField: 'cost' },
        { key: 'profit', header: 'Profit', accessor: (row) => fmtCurrency(row.profit), align: 'right', sortable: true, filterType: 'number', filterField: 'profit' },
        { key: 'margin_pct', header: 'Margin %', accessor: (row) => fmtPct(row.margin_pct), align: 'right', filterType: 'number', filterField: 'margin_pct' },
      );
    }

    cols.push(
      { key: 'quantity', header: 'Qty', accessor: (row) => fmt(row.quantity, 2), align: 'right', sortable: true, filterType: 'number', filterField: 'quantity' },
      { key: 'item_count', header: 'Items', accessor: (row) => fmt(row.item_count), align: 'right', sortable: true, filterType: 'number', filterField: 'item_count' },
      { key: 'status', header: 'Status', accessor: (row) => <Badge variant={row.status === 'RETURN' ? 'warning' : 'success'} size="sm">{row.status}</Badge>, filterType: 'select', filterField: 'status', filterOptions: [{ value: 'POSTED', label: 'Posted' }, { value: 'RETURN', label: 'Return' }] },
    );
    return cols;
  }, [kind]);

  const pdfColumns = useMemo(
    () => columns.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    [columns],
  );

  const activeData = useMemo(
    () => (bills.data?.data ?? []) as unknown as Record<string, unknown>[],
    [bills.data],
  );

  const pdfPayload = usePdfPayload({
    title: kind === 'sales' ? 'Sales Analysis' : 'Purchase Analysis',
    reportKey: exportType,
    columns: pdfColumns,
    data: activeData,
    filters: grid.pharmaParams,
    exportMode: 'current-page',
  });

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Sales & Purchase Analysis</h1>
          <p className="mt-1 text-xs lg:text-sm text-gray-500">Bill-wise Marg-backed analysis with reconciled summaries and click-loaded drilldowns.</p>
        </div>
        <ExportToolbar
          reportType={exportType}
          filters={grid.pharmaParams}
          pdfPayload={pdfPayload}
          onRefresh={() => {
            void overview.refetch();
            void bills.refetch();
          }}
          isRefreshing={overview.isFetching || bills.isFetching}
          onResetView={grid.resetAll}
          hasActiveViewState={grid.hasActiveControls}
        />
      </div>

      <div className="border-b border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <nav className="-mb-px flex gap-4 lg:gap-6 min-w-max" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setKind(tab.key);
                setDrilldown(null);
              }}
              className={`whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium transition-colors ${
                kind === tab.key ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            {VIEW_TABS.map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  view === v.key
                    ? 'bg-primary-600 text-white shadow'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sticky filter bar — date range + presets, drives every section. */}
      <Card padding="sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="label">Period</label>
            <select
              className="input"
              value={presetId}
              onChange={(e) => onPresetChange(e.target.value as SingleRangePresetId)}
            >
              {SINGLE_RANGE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPresetId('custom');
              }}
            />
          </div>
          <div>
            <label className="label">To</label>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPresetId('custom');
              }}
            />
          </div>
          <div className="flex items-end text-xs text-gray-500">
            {startDate && endDate
              ? `${fmtDate(startDate)} – ${fmtDate(endDate)}`
              : 'No date filter applied — showing all-time activity'}
          </div>
        </div>
      </Card>

      {overview.isError && view === 'overview' && <QueryErrorBanner error={overview.error} />}
      {bills.isError && view === 'bills' && <QueryErrorBanner error={bills.error} />}

      {/* Compact KPI strip — always visible above the active section. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Net Amount" value={fmtCurrency(summary?.totalAmount)} />
        <Stat label="Bills" value={fmt(summary?.totalBills)} />
        <Stat label={kind === 'sales' ? 'Customers' : 'Suppliers'} value={fmt(kind === 'sales' ? summary?.totalCustomers : summary?.totalSuppliers)} />
        <Stat label="Quantity" value={fmt(summary?.totalQuantity, 2)} />
        <Stat label="Avg Bill" value={fmtCurrency(summary?.averageBillValue)} />
        {kind === 'sales' && <Stat label="Margin" value={fmtPct(summary?.marginPct)} />}
        {kind !== 'sales' && <Stat label="Items" value={fmt(summary?.itemCount)} />}
      </div>

      {view === 'overview' && (
      <>
      <Card>
        <CardHeader title="Daily / Monthly Trend" />
        <LineChart
          data={overview.data?.trend ?? []}
          xAxisKey="period"
          lines={[{ dataKey: 'amount', name: 'Amount', color: '#2563EB' }, { dataKey: 'quantity', name: 'Quantity', color: '#059669' }]}
          height={260}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={kind === 'sales' ? 'Top Customers' : 'Top Suppliers'} />
          <DataTable
            data={overview.data?.topParties ?? []}
            columns={[
              { key: 'name', header: 'Name', accessor: (row) => <button type="button" className="font-medium text-primary-700 underline-offset-2 hover:underline" onClick={() => setDrilldown({ type: 'party', key: row.party_code, title: row.name })}>{row.name}</button> },
              { key: 'bills', header: 'Bills', accessor: (row) => fmt(row.bills), align: 'right' },
              { key: 'value', header: 'Value', accessor: (row) => fmtCurrency(row.value), align: 'right' },
              { key: 'share', header: 'Share', accessor: (row) => fmtPct(row.share), align: 'right' },
            ]}
            keyExtractor={(row) => row.party_code || row.name}
          />
        </Card>
        <Card>
          <CardHeader title="Top Items" />
          <DataTable
            data={overview.data?.topItems ?? []}
            columns={[
              { key: 'item_code', header: 'Code', accessor: 'item_code' },
              { key: 'item_name', header: 'Item', accessor: (row) => <button type="button" className="font-medium text-primary-700 underline-offset-2 hover:underline" onClick={() => setDrilldown({ type: 'item', key: row.item_key?.includes('-') ? `product:${row.item_key}` : row.item_key, title: row.item_name })}>{row.item_name}</button> },
              { key: 'quantity', header: 'Qty', accessor: (row) => fmt(row.quantity, 2), align: 'right' },
              { key: 'value', header: 'Value', accessor: (row) => fmtCurrency(row.value), align: 'right' },
            ]}
            keyExtractor={(row) => row.item_key || row.item_code}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tax Summary" />
          <DataTable
            data={overview.data?.taxSummary ?? []}
            columns={[
              { key: 'tax_pct', header: 'Tax %', accessor: (row) => fmtPct(row.tax_pct), align: 'right' },
              { key: 'taxable_amount', header: 'Taxable', accessor: (row) => fmtCurrency(row.taxable_amount), align: 'right' },
              { key: 'tax_amount', header: 'Tax', accessor: (row) => fmtCurrency(row.tax_amount), align: 'right' },
            ]}
            keyExtractor={(row) => String(row.tax_pct)}
          />
        </Card>
        <Card>
          <CardHeader title="Payment Mode Summary" />
          <PieChart
            data={(overview.data?.paymentModeSummary ?? []).map((row) => ({ name: row.payment_mode, value: row.amount }))}
            height={260}
          />
        </Card>
      </div>
      </>
      )}

      {view === 'bills' && (
      <Card padding="none">
        <CardHeader title={kind === 'sales' ? 'Sales Bill-wise' : 'Purchase Bill-wise'} description="Click a row to open the bill header and item lines." className="px-6 pt-6" />
        <DataTable<SalesPurchaseBillRow>
          data={bills.data?.data ?? []}
          columns={columns}
          keyExtractor={(row) => row.bill_key}
          isLoading={bills.isLoading}
          emptyMessage={`No ${kind} bills found for this filter context`}
          onRowClick={(row) => setDrilldown({ type: 'bill', key: row.bill_key })}
          sorting={grid.sortingProps}
          filtering={grid.filteringProps}
          pagination={grid.paginationProps(bills.data?.total ?? 0)}
        />
      </Card>
      )}

      {view === 'dimension' && (
      /* By-Dimension panel: Salesman / Salt / Top Companies / Top Groups / Top Products / HSN */
      <Card padding="none">
        <CardHeader
          title={`By Dimension — ${kind === 'sales' ? 'Sales' : 'Purchase'}`}
          description={DIMENSION_TABS.find((d) => d.key === dimension)?.description}
          className="px-6 pt-6"
        />
        <div className="px-6 border-b border-gray-200">
          <nav className="-mb-px flex flex-wrap gap-4" aria-label="Dimension Tabs">
            {DIMENSION_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setDimension(tab.key);
                  dimensionGrid.resetAll();
                }}
                className={`whitespace-nowrap border-b-2 py-2 px-1 text-sm font-medium transition-colors ${
                  dimension === tab.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
        {dimensionData.isError && <QueryErrorBanner error={dimensionData.error} />}
        <DataTable<SalesPurchaseDimensionRow>
          data={dimensionData.data?.data ?? []}
          columns={[
            {
              key: 'label',
              header: DIMENSION_TABS.find((d) => d.key === dimension)?.label ?? 'Group',
              sortable: true,
              filterType: 'text',
              filterField: 'label',
              accessor: (row) => (
                <div>
                  <div className="font-medium text-gray-900">{row.label}</div>
                  {row.key && row.key !== row.label && row.key !== '__UNMAPPED__' && row.key !== '__UNATTRIBUTED__' && (
                    <div className="text-xs font-mono text-gray-500">{row.key}</div>
                  )}
                </div>
              ),
            },
            { key: 'billCount', header: 'Bills', align: 'right', sortable: true, filterType: 'number', filterField: 'billCount', accessor: (row) => fmt(row.billCount) },
            {
              key: 'partyCount',
              header: kind === 'sales' ? 'Customers' : 'Suppliers',
              align: 'right',
              sortable: true,
              filterType: 'number',
              filterField: 'partyCount',
              accessor: (row) => fmt(row.partyCount),
            },
            { key: 'itemCount', header: 'SKUs', align: 'right', sortable: true, filterType: 'number', filterField: 'itemCount', accessor: (row) => fmt(row.itemCount) },
            { key: 'quantity', header: 'Qty', align: 'right', sortable: true, filterType: 'number', filterField: 'quantity', accessor: (row) => fmt(row.quantity, 2) },
            {
              key: 'netAmount',
              header: 'Net Amount',
              align: 'right',
              sortable: true,
              filterType: 'number',
              filterField: 'netAmount',
              accessor: (row) => <span className="font-semibold">{fmtCurrency(row.netAmount)}</span>,
            },
            ...(kind === 'sales'
              ? [
                  {
                    key: 'profit',
                    header: 'Profit',
                    align: 'right' as const,
                    sortable: true,
                    filterType: 'number' as const,
                    filterField: 'profit',
                    accessor: (row: SalesPurchaseDimensionRow) => fmtCurrency(row.profit),
                  },
                  {
                    key: 'marginPct',
                    header: 'Margin %',
                    align: 'right' as const,
                    accessor: (row: SalesPurchaseDimensionRow) => fmtPct(row.marginPct),
                  },
                ]
              : []),
            {
              key: 'share',
              header: 'Share',
              align: 'right',
              accessor: (row) => {
                const total = dimensionData.data?.grandTotal ?? 0;
                return total > 0 ? fmtPct((row.netAmount / total) * 100) : '-';
              },
            },
          ]}
          keyExtractor={(row) => row.key}
          isLoading={dimensionData.isLoading}
          emptyMessage={`No ${kind} activity grouped by ${dimension} in this filter context`}
          sorting={dimensionGrid.sortingProps}
          filtering={dimensionGrid.filteringProps}
          pagination={dimensionGrid.paginationProps(dimensionData.data?.total ?? 0)}
        />
      </Card>
      )}

      <Modal
        isOpen={!!drilldown}
        onClose={() => setDrilldown(null)}
        title={drilldown?.type === 'bill' ? 'Bill Drilldown' : drilldown?.title ?? 'Drilldown'}
        size="full"
      >
        {drilldown?.type === 'bill' && (
          <div className="space-y-4">
            {billDetail.isError && <QueryErrorBanner error={billDetail.error} />}
            <DetailPopupActions
              title={`${kind === 'sales' ? 'Sales' : 'Purchase'} Bill`}
              documentNumber={String(billDetail.data?.header?.invoice_number ?? drilldown.key)}
              fields={Object.entries(billDetail.data?.header ?? {}).slice(0, 16).map(([key, value]) => ({
                label: key.replace(/_/g, ' '),
                value: value != null ? String(value) : null,
              }))}
              tables={billDetail.data?.lines?.length ? [{
                title: 'Bill Lines',
                columns: [
                  { key: 'item_code', header: 'Code' },
                  { key: 'item_name', header: 'Item' },
                  { key: 'batch', header: 'Batch' },
                  { key: 'expiry', header: 'Expiry' },
                  { key: 'warehouse', header: 'Warehouse' },
                  { key: 'quantity', header: 'Qty', align: 'right' as const },
                  { key: 'free_quantity', header: 'Free', align: 'right' as const },
                  { key: 'uom', header: 'UOM' },
                  { key: 'rate', header: 'Rate', align: 'right' as const },
                  { key: 'gross_amount', header: 'Gross', align: 'right' as const },
                  { key: 'discount_pct', header: 'Disc %', align: 'right' as const },
                  { key: 'discount_amount', header: 'Disc Amt', align: 'right' as const },
                  { key: 'tax_pct', header: 'Tax %', align: 'right' as const },
                  { key: 'tax_amount', header: 'Tax', align: 'right' as const },
                  { key: 'cost_rate', header: kind === 'sales' ? 'Cost Rate' : 'Landed Cost', align: 'right' as const },
                  { key: 'profit', header: 'Profit', align: 'right' as const },
                  { key: 'margin_pct', header: 'Margin %', align: 'right' as const },
                  { key: 'line_total', header: 'Line Total', align: 'right' as const },
                ],
                rows: (billDetail.data?.lines ?? []).map((row) => ({
                  item_code: String(row.item_code ?? '-'),
                  item_name: String(row.item_name ?? '-'),
                  batch: String(row.batch ?? '-'),
                  expiry: row.expiry ? fmtDate(String(row.expiry)) : '-',
                  warehouse: String(row.warehouse ?? '-'),
                  quantity: fmt(Number(row.quantity ?? 0), 2),
                  free_quantity: fmt(Number(row.free_quantity ?? 0), 2),
                  uom: String(row.uom_display || row.uom || '-'),
                  rate: fmtCurrency(Number(row.rate ?? 0)),
                  gross_amount: fmtCurrency(Number(row.gross_amount ?? 0)),
                  discount_pct: row.discount_pct == null ? '-' : fmtPct(Number(row.discount_pct)),
                  discount_amount: fmtCurrency(Number(row.discount_amount ?? 0)),
                  tax_pct: fmtPct(Number(row.tax_pct ?? 0)),
                  tax_amount: fmtCurrency(Number(row.tax_amount ?? 0)),
                  cost_rate: fmtCurrency(Number(row.cost_rate ?? 0)),
                  profit: row.profit == null ? '-' : fmtCurrency(Number(row.profit)),
                  margin_pct: row.margin_pct == null ? '-' : fmtPct(Number(row.margin_pct)),
                  line_total: fmtCurrency(Number(row.line_total ?? 0)),
                })),
              }] : []}
              totals={[
                { label: 'Gross Total', value: fmtCurrency(Number(billDetail.data?.header?.gross_amount ?? 0)) },
                { label: 'Discount Total', value: fmtCurrency(Number(billDetail.data?.header?.discount_amount ?? 0)) },
                { label: 'Tax Total', value: fmtCurrency(Number(billDetail.data?.header?.tax_amount ?? 0)) },
                { label: 'Round Off', value: fmtCurrency(Number(billDetail.data?.header?.round_off ?? 0)) },
                { label: 'Net Total', value: fmtCurrency(Number(billDetail.data?.header?.net_amount ?? 0)) },
                ...(kind === 'sales' ? [{ label: 'Profit / Margin', value: `${fmtCurrency(Number(billDetail.data?.header?.profit ?? 0))} / ${fmtPct(Number(billDetail.data?.header?.margin_pct ?? 0))}` }] : []),
              ]}
            />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Object.entries(billDetail.data?.header ?? {}).slice(0, 16).map(([key, value]) => (
                <div key={key} className="rounded border border-gray-200 p-3">
                  <div className="text-xs uppercase text-gray-500">{key.replace(/_/g, ' ')}</div>
                  <div className="mt-1 text-sm font-medium text-gray-900">{String(value ?? '-')}</div>
                </div>
              ))}
            </div>
            <DataTable
              data={billDetail.data?.lines ?? []}
              columns={[
                { key: 'item_code', header: 'Code', accessor: (row) => rowValue(row, 'item_code') },
                { key: 'item_name', header: 'Item', accessor: (row) => <button type="button" className="font-medium text-primary-700 underline-offset-2 hover:underline" onClick={() => setDrilldown({ type: 'item', key: row.product_id ? `product:${row.product_id}` : String(row.marg_pid ?? ''), title: String(row.item_name ?? 'Item') })}>{rowValue(row, 'item_name')}</button> },
                { key: 'batch', header: 'Batch', accessor: (row) => rowValue(row, 'batch') },
                { key: 'expiry', header: 'Expiry', accessor: (row) => fmtDate(String(row.expiry ?? '')) },
                { key: 'warehouse', header: 'Warehouse', accessor: (row) => rowValue(row, 'warehouse') },
                { key: 'quantity', header: 'Qty', accessor: (row) => fmt(Number(row.quantity ?? 0), 2), align: 'right' },
                { key: 'free_quantity', header: 'Free', accessor: (row) => fmt(Number(row.free_quantity ?? 0), 2), align: 'right' },
                { key: 'uom', header: 'UOM', accessor: (row) => rowValue(row, 'uom_display') || rowValue(row, 'uom') },
                { key: 'rate', header: 'Rate', accessor: (row) => fmtCurrency(Number(row.rate ?? 0)), align: 'right' },
                { key: 'gross_amount', header: 'Gross', accessor: (row) => fmtCurrency(Number(row.gross_amount ?? 0)), align: 'right' },
                { key: 'discount_pct', header: 'Disc %', accessor: (row) => row.discount_pct == null ? '-' : fmtPct(Number(row.discount_pct)), align: 'right' },
                { key: 'discount_amount', header: 'Disc Amt', accessor: (row) => fmtCurrency(Number(row.discount_amount ?? 0)), align: 'right' },
                { key: 'tax_pct', header: 'Tax %', accessor: (row) => fmtPct(Number(row.tax_pct ?? 0)), align: 'right' },
                { key: 'tax_amount', header: 'Tax', accessor: (row) => fmtCurrency(Number(row.tax_amount ?? 0)), align: 'right' },
                { key: 'cost_rate', header: kind === 'sales' ? 'Cost Rate' : 'Landed Cost', accessor: (row) => fmtCurrency(Number(row.cost_rate ?? 0)), align: 'right' },
                { key: 'profit', header: 'Profit', accessor: (row) => row.profit == null ? '-' : fmtCurrency(Number(row.profit)), align: 'right' },
                { key: 'margin_pct', header: 'Margin %', accessor: (row) => row.margin_pct == null ? '-' : fmtPct(Number(row.margin_pct)), align: 'right' },
                { key: 'line_total', header: 'Line Total', accessor: (row) => fmtCurrency(Number(row.line_total ?? 0)), align: 'right' },
              ]}
              keyExtractor={(row) => String(row.id)}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Gross Total" value={fmtCurrency(Number(billDetail.data?.header?.gross_amount ?? 0))} />
              <Stat label="Discount Total" value={fmtCurrency(Number(billDetail.data?.header?.discount_amount ?? 0))} />
              <Stat label="Tax Total" value={fmtCurrency(Number(billDetail.data?.header?.tax_amount ?? 0))} />
              <Stat label="Round Off" value={fmtCurrency(Number(billDetail.data?.header?.round_off ?? 0))} />
              <Stat label="Net Total" value={fmtCurrency(Number(billDetail.data?.header?.net_amount ?? 0))} />
              {kind === 'sales' && <Stat label="Profit / Margin" value={`${fmtCurrency(Number(billDetail.data?.header?.profit ?? 0))} / ${fmtPct(Number(billDetail.data?.header?.margin_pct ?? 0))}`} />}
            </div>
          </div>
        )}

        {drilldown?.type === 'item' && (
          <div className="space-y-5">
            {itemDetail.isLoading && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
              </div>
            )}
            {itemDetail.isError && <QueryErrorBanner error={itemDetail.error} />}
            {itemDetail.data && (() => {
              const m = itemDetail.data.metrics ?? {};
              const salesQty = Number(m['sales_quantity'] ?? 0);
              const purchaseQty = Number(m['purchase_quantity'] ?? 0);
              const salesAmt = Number(m['sales_amount'] ?? 0);
              const purchaseAmt = Number(m['purchase_amount'] ?? 0);
              const avgSaleRate = m['average_sale_rate'] as number | null;
              const avgPurchaseRate = m['average_purchase_rate'] as number | null;
              const costRate = Number(m['cost_rate'] ?? 0);
              const profit = Number(m['profit'] ?? 0);
              const margin = m['margin'] as number | null;
              const currentStock = Number(m['currentStock'] ?? 0);

              return (
                <>
                  {/* Sales/Purchase Performance */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{kind === 'sales' ? 'Sales' : 'Purchase'} Performance</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Stat compact label="Sales Qty" value={fmt(salesQty, 2)} />
                      <Stat compact label="Sales Amount" value={fmtCurrency(salesAmt)} />
                      <Stat compact label="Purchase Qty" value={fmt(purchaseQty, 2)} />
                      <Stat compact label="Purchase Amount" value={fmtCurrency(purchaseAmt)} />
                    </div>
                  </div>

                  {/* Pricing & Margins */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Pricing & Profitability</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <Stat compact label="Avg Sale Rate" value={avgSaleRate != null ? fmtCurrency(avgSaleRate) : '—'} />
                      <Stat compact label="Avg Purchase Rate" value={avgPurchaseRate != null ? fmtCurrency(avgPurchaseRate) : '—'} />
                      <Stat compact label="Cost Rate" value={fmtCurrency(costRate)} />
                      <Stat compact label="Profit" value={fmtCurrency(profit)} />
                      <Stat compact label="Margin" value={margin != null ? fmtPct(margin / 100) : '—'} />
                    </div>
                  </div>

                  {/* Inventory Position */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Inventory Position</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Stat compact label="Current Stock" value={fmt(currentStock, 2)} />
                      <Stat compact label="Stock Value" value={fmtCurrency(itemDetail.data.stockByWarehouse?.reduce((s, r) => s + Number(r.stock_value ?? 0), 0) ?? 0)} />
                    </div>
                  </div>

                  {/* Stock by Warehouse */}
                  {(itemDetail.data.stockByWarehouse?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Stock by Warehouse</h4>
                      <DataTable
                        data={itemDetail.data.stockByWarehouse ?? []}
                        columns={[
                          { key: 'warehouse', header: 'Warehouse', accessor: (row) => rowValue(row, 'warehouse') },
                          { key: 'current_stock', header: 'Stock', accessor: (row) => fmt(Number(row.current_stock ?? 0), 2), align: 'right' },
                          { key: 'stock_value', header: 'Value', accessor: (row) => fmtCurrency(Number(row.stock_value ?? 0)), align: 'right' },
                        ]}
                        keyExtractor={(row) => String(row.warehouse)}
                      />
                    </div>
                  )}

                  {/* Batch Stock — fields from API: batch, expiry, current_stock, cost_rate */}
                  {(itemDetail.data.batchStock?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Batch-wise Stock</h4>
                      <DataTable
                        data={itemDetail.data.batchStock.filter((row) => row.batch || Number(row.current_stock ?? 0) > 0)}
                        columns={[
                          { key: 'batch', header: 'Batch No.', accessor: (row) => rowValue(row, 'batch') },
                          { key: 'current_stock', header: 'Stock', accessor: (row) => fmt(Number(row.current_stock ?? 0), 2), align: 'right' },
                          { key: 'cost_rate', header: 'Cost Rate', accessor: (row) => fmtCurrency(Number(row.cost_rate ?? 0)), align: 'right' },
                          { key: 'expiry', header: 'Expiry', accessor: (row) => row.expiry ? fmtDate(String(row.expiry)) : '—' },
                        ]}
                        keyExtractor={(row) => String(row.batch ?? row.expiry ?? Math.random())}
                      />
                    </div>
                  )}

                  {/* Related Bills (movementHistory and relatedBills are the same from API) */}
                  {(itemDetail.data.relatedBills?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Recent Transactions</h4>
                      <DataTable
                        data={itemDetail.data.relatedBills ?? []}
                        columns={[
                          { key: 'invoice_number', header: 'Bill', accessor: (row) => rowValue(row, 'invoice_number') },
                          { key: 'date', header: 'Date', accessor: (row) => fmtDate(String(row.date ?? '')) },
                          { key: 'type', header: 'Type', accessor: (row) => {
                            const t = String(row.type ?? '');
                            const label = t === 'S' ? 'Sale'
                              : t === 'P' ? 'Purchase'
                              : t === 'R' || t === 'T' ? 'Sales Return'
                              : t === 'B' ? 'Purchase Return'
                              : t;
                            const cls = t === 'S' ? 'bg-blue-100 text-blue-800'
                              : t === 'P' ? 'bg-green-100 text-green-800'
                              : t === 'R' || t === 'T' ? 'bg-amber-100 text-amber-800'
                              : t === 'B' ? 'bg-orange-100 text-orange-800'
                              : 'bg-gray-100 text-gray-700';
                            return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
                          } },
                          { key: 'party_name', header: 'Party', accessor: (row) => rowValue(row, 'party_name') },
                          { key: 'quantity', header: 'Qty', accessor: (row) => fmt(Number(row.quantity ?? 0), 2), align: 'right' },
                          { key: 'amount', header: 'Amount', accessor: (row) => fmtCurrency(Number(row.amount ?? 0)), align: 'right' },
                        ]}
                        keyExtractor={(row) => `${row.bill_key ?? row.invoice_number ?? Math.random()}`}
                      />
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {drilldown?.type === 'party' && (
          <div className="space-y-4">
            {partyDetail.isError && <QueryErrorBanner error={partyDetail.error} />}
            <DetailPopupActions
              title={`${kind === 'sales' ? 'Customer' : 'Supplier'} — ${drilldown.title}`}
              documentNumber={drilldown.key}
              fields={[
                { label: kind === 'sales' ? 'Total Sales' : 'Total Purchases', value: fmtCurrency(Number(partyDetail.data?.metrics?.total_amount ?? 0)) },
                { label: 'Bills', value: fmt(Number(partyDetail.data?.metrics?.total_bills ?? 0)) },
                { label: 'Average Bill', value: fmtCurrency(Number(partyDetail.data?.metrics?.average_bill_value ?? 0)) },
              ]}
              tables={[
                ...(partyDetail.data?.topItems?.length ? [{
                  title: 'Top Items',
                  columns: [
                    { key: 'item_name', header: 'Item' },
                    { key: 'quantity', header: 'Qty', align: 'right' as const },
                    { key: 'value', header: 'Value', align: 'right' as const },
                  ],
                  rows: (partyDetail.data?.topItems ?? []).map((row) => ({
                    item_name: String(row.item_name ?? '-'),
                    quantity: fmt(row.quantity, 2),
                    value: fmtCurrency(row.value),
                  })),
                }] : []),
                ...(partyDetail.data?.billHistory?.length ? [{
                  title: 'Bill History',
                  columns: [
                    { key: 'invoice_number', header: kind === 'sales' ? 'Invoice No.' : 'Bill No.' },
                    { key: 'date', header: 'Date' },
                    { key: 'party_name', header: kind === 'sales' ? 'Customer' : 'Supplier' },
                    { key: 'payment_mode', header: 'Payment' },
                    { key: 'gross_amount', header: 'Gross', align: 'right' as const },
                    { key: 'discount', header: 'Discount', align: 'right' as const },
                    { key: 'tax_amount', header: 'Tax', align: 'right' as const },
                    { key: 'net_amount', header: 'Net', align: 'right' as const },
                  ],
                  rows: (partyDetail.data?.billHistory ?? []).map((row) => ({
                    invoice_number: String(row.invoice_number ?? '-'),
                    date: fmtDate(String(row.date ?? '')),
                    party_name: String(row.party_name ?? '-'),
                    payment_mode: String(row.payment_mode ?? '-'),
                    gross_amount: fmtCurrency(Number(row.gross_amount ?? 0)),
                    discount: fmtCurrency(Number(row.discount ?? 0)),
                    tax_amount: fmtCurrency(Number(row.tax_amount ?? 0)),
                    net_amount: fmtCurrency(Number(row.net_amount ?? 0)),
                  })),
                }] : []),
              ]}
              totals={[
                { label: kind === 'sales' ? 'Total Sales' : 'Total Purchases', value: fmtCurrency(Number(partyDetail.data?.metrics?.total_amount ?? 0)) },
              ]}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Stat label={kind === 'sales' ? 'Total Sales' : 'Total Purchases'} value={fmtCurrency(Number(partyDetail.data?.metrics?.total_amount ?? 0))} />
              <Stat label="Bills" value={fmt(Number(partyDetail.data?.metrics?.total_bills ?? 0))} />
              <Stat label="Average Bill" value={fmtCurrency(Number(partyDetail.data?.metrics?.average_bill_value ?? 0))} />
            </div>
            <DataTable data={partyDetail.data?.topItems ?? []} columns={[{ key: 'item_name', header: 'Item', accessor: 'item_name' }, { key: 'quantity', header: 'Qty', accessor: (row) => fmt(row.quantity, 2), align: 'right' }, { key: 'value', header: 'Value', accessor: (row) => fmtCurrency(row.value), align: 'right' }]} keyExtractor={(row) => row.item_key || row.item_code} />
            <DataTable data={partyDetail.data?.billHistory ?? []} columns={columns.slice(0, 10)} keyExtractor={(row) => row.bill_key} />
          </div>
        )}
      </Modal>
    </div>
  );
}
