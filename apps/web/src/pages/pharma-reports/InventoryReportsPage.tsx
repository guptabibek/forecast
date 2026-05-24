import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Column } from '../../components/ui';
import { Badge, Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import { usePharmaGrid } from '../../hooks/usePharmaGrid';
import { usePdfPayload } from '../../hooks/usePdfPayload';
import { useTenantConfig } from '../../hooks/useTenantConfig';
import {
  useBatchInventory,
  useCurrentStock,
  useMovementLedger,
  useReorderReport,
  useStockAgeing,
  useUpsertReorderConfig,
} from '../../hooks/usePharmaReports';
import { parseReorderConfigCsv } from './reorderConfigCsv';
import type {
  BatchInventoryRow,
  CurrentStockRow,
  MovementLedgerRow,
  ReorderRow,
  StockAgeingRow,
} from '../../services/api/pharma-reports.service';
import ExportToolbar from './ExportToolbar';
import { fmt, fmtCurrency, fmtDate, reportCols } from './shared';

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
  const { showSaltColumn } = useTenantConfig();
  const [activeTab, setActiveTab] = useState<Tab>('current');

  // Reorder report horizons — client-configurable per run. Defaults mirror the
  // backend (lookback 90d, cover next 30d, lead 7d, safety 7d).
  const [reorderParams, setReorderParams] = useState({
    lookbackDays: 90,
    coverageDays: 30,
    leadTimeDays: 7,
    safetyDays: 7,
    includeAll: false,
  });
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const upsertConfig = useUpsertReorderConfig();

  const handleConfigCsv = async (file: File) => {
    setImportMsg(null);
    const text = await file.text();
    const { rows, errors } = parseReorderConfigCsv(text);
    if (errors.length) {
      setImportMsg({ kind: 'error', text: `CSV not imported. ${errors.slice(0, 3).join(' ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}` });
      return;
    }
    try {
      const res = await upsertConfig.mutateAsync(rows);
      const skippedNote = res.skipped.length
        ? ` ${res.skipped.length} row(s) skipped (unknown product/location).`
        : '';
      setImportMsg({ kind: res.skipped.length ? 'error' : 'ok', text: `Imported ${res.upserted} policy override(s).${skippedNote}` });
    } catch {
      setImportMsg({ kind: 'error', text: 'Import failed. Check your access and try again.' });
    }
  };

  // One grid state per tab — filters/sort/pagination are isolated per report.
  const currentGrid = usePharmaGrid({ initialSortBy: 'sku' });
  const batchGrid = usePharmaGrid({ initialSortBy: 'expiry_date' });
  const ledgerGrid = usePharmaGrid({ initialSortBy: 'transaction_date', initialSortOrder: 'desc' });
  const reorderGrid = usePharmaGrid();
  const ageingGrid = usePharmaGrid({ initialSortBy: 'inward_date', initialSortOrder: 'desc' });

  const currentStock = useCurrentStock(currentGrid.pharmaParams, activeTab === 'current');
  const batchInv = useBatchInventory(batchGrid.pharmaParams, activeTab === 'batch');
  const ledger = useMovementLedger(ledgerGrid.pharmaParams, activeTab === 'ledger');
  const reorder = useReorderReport({ ...reorderGrid.pharmaParams, ...reorderParams }, activeTab === 'reorder');
  const ageing = useStockAgeing(ageingGrid.pharmaParams, activeTab === 'ageing');

  const queryMap = { current: currentStock, batch: batchInv, ledger, reorder, ageing };
  const activeQuery = queryMap[activeTab];
  const gridMap = { current: currentGrid, batch: batchGrid, ledger: ledgerGrid, reorder: reorderGrid, ageing: ageingGrid };
  const activeGrid = gridMap[activeTab];
  const exportFilters: Record<Tab, Record<string, unknown>> = {
    current: currentGrid.pharmaParams,
    batch: batchGrid.pharmaParams,
    ledger: ledgerGrid.pharmaParams,
    reorder: reorderGrid.pharmaParams,
    ageing: ageingGrid.pharmaParams,
  };

  const currentCols: Column<CurrentStockRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', sortable: true, filterType: 'text', filterField: 'product_name' },
    { key: 'company', header: 'Company', accessor: (r) => r.company_display ?? r.company ?? '-', filterType: 'text', filterField: 'company' },
    ...(showSaltColumn ? [{ key: 'salt', header: 'Salt', accessor: (r: CurrentStockRow) => r.salt_display ?? r.salt ?? '-', filterType: 'text' as const, filterField: 'salt' }] : []),
    { key: 'product_group', header: 'Group', accessor: (r) => r.product_group_display ?? r.product_group ?? '-', filterType: 'text', filterField: 'product_group' },
    { key: 'hsn_code', header: 'HSN', accessor: (r) => r.hsn_code ?? '-', filterType: 'text', filterField: 'hsn_code' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '100px', sortable: true, filterType: 'text', filterField: 'location_code' },
    { key: 'on_hand_qty', header: 'On Hand', accessor: (r) => fmt(r.on_hand_qty), align: 'right', sortable: true, filterType: 'number', filterField: 'on_hand_qty' },
    { key: 'available_qty', header: 'Available', accessor: (r) => fmt(r.available_qty), align: 'right', sortable: true, filterType: 'number', filterField: 'available_qty' },
    { key: 'in_transit_qty', header: 'In Transit', accessor: (r) => fmt(r.in_transit_qty), align: 'right', filterType: 'number', filterField: 'in_transit_qty' },
    { key: 'on_order_qty', header: 'On Order', accessor: (r) => fmt(r.on_order_qty), align: 'right', filterType: 'number', filterField: 'on_order_qty' },
    { key: 'inventory_value', header: 'Value', accessor: (r) => fmtCurrency(r.inventory_value), align: 'right', sortable: true, filterType: 'number', filterField: 'inventory_value' },
  ]);

  const batchCols: Column<BatchInventoryRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', sortable: true, filterType: 'text', filterField: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px', sortable: true, filterType: 'text', filterField: 'batch_number' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px', filterType: 'text', filterField: 'location_code' },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right', sortable: true, filterType: 'number', filterField: 'quantity' },
    { key: 'cost_per_unit', header: 'Unit Cost', accessor: (r) => fmtCurrency(r.cost_per_unit), align: 'right', filterType: 'number', filterField: 'cost_per_unit' },
    { key: 'expiry_date', header: 'Expiry', accessor: (r) => fmtDate(r.expiry_date), sortable: true, filterType: 'date', filterField: 'expiry_date' },
    {
      key: 'days_to_expiry', header: 'Days Left', align: 'right',
      accessor: (r) => r.days_to_expiry != null ? (
        <span className={r.days_to_expiry <= 30 ? 'text-red-600 font-semibold' : r.days_to_expiry <= 90 ? 'text-amber-600' : ''}>
          {r.days_to_expiry}
        </span>
      ) : '—',
    },
    {
      key: 'batch_status', header: 'Status',
      accessor: (r) => <Badge variant={r.batch_status === 'AVAILABLE' ? 'success' : r.batch_status === 'QUARANTINE' ? 'warning' : 'default'} size="sm">{r.batch_status}</Badge>,
      filterType: 'select', filterField: 'batch_status',
      filterOptions: [
        { value: 'AVAILABLE', label: 'Available' },
        { value: 'QUARANTINE', label: 'Quarantine' },
        { value: 'EXPIRED', label: 'Expired' },
        { value: 'IN_PROCESS', label: 'In Process' },
      ],
    },
  ]);

  const ledgerCols: Column<MovementLedgerRow>[] = reportCols([
    { key: 'transaction_date', header: 'Date', accessor: (r) => fmtDate(r.transaction_date), width: '100px', sortable: true, filterType: 'date', filterField: 'transaction_date' },
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    {
      key: 'entry_type', header: 'Type',
      accessor: (r) => <Badge variant={r.entry_type.includes('RECEIPT') || r.entry_type.includes('IN') ? 'success' : r.entry_type.includes('ISSUE') || r.entry_type.includes('OUT') ? 'error' : 'default'} size="sm">{r.entry_type}</Badge>,
      filterType: 'select', filterField: 'entry_type',
      filterOptions: [
        { value: 'LEDGER_RECEIPT', label: 'Receipt' },
        { value: 'LEDGER_ISSUE', label: 'Issue' },
        { value: 'LEDGER_ADJUSTMENT', label: 'Adjustment' },
        { value: 'LEDGER_TRANSFER_IN', label: 'Transfer In' },
        { value: 'LEDGER_TRANSFER_OUT', label: 'Transfer Out' },
        { value: 'LEDGER_RETURN', label: 'Return' },
        { value: 'LEDGER_SCRAP', label: 'Scrap' }
      ],
    },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right', sortable: true, filterType: 'number', filterField: 'quantity' },
    { key: 'total_cost', header: 'Value', accessor: (r) => fmtCurrency(r.total_cost), align: 'right', filterType: 'number', filterField: 'total_cost' },
    { key: 'running_balance', header: 'Balance', accessor: (r) => fmt(r.running_balance), align: 'right', filterType: 'number', filterField: 'running_balance' },
    { key: 'batch_number', header: 'Batch', accessor: (r) => r.batch_number ?? '—', width: '100px', filterType: 'text', filterField: 'batch_number' },
  ]);

  const reorderCols: Column<ReorderRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px', filterType: 'text', filterField: 'location_code' },
    {
      key: 'reorder_status', header: 'Status',
      accessor: (r) => (
        <Badge
          variant={r.reorder_status === 'OUT_OF_STOCK' ? 'error' : r.reorder_status === 'BELOW_REORDER' ? 'warning' : 'success'}
          size="sm"
        >
          {r.reorder_status === 'OUT_OF_STOCK' ? 'Out' : r.reorder_status === 'BELOW_REORDER' ? 'Reorder' : 'OK'}
        </Badge>
      ),
      filterType: 'select', filterField: 'reorder_status',
      filterOptions: [{ value: 'OUT_OF_STOCK', label: 'Out of stock' }, { value: 'BELOW_REORDER', label: 'Below reorder' }, { value: 'OK', label: 'OK' }],
    },
    { key: 'on_hand_qty', header: 'On Hand', accessor: (r) => fmt(r.on_hand_qty), align: 'right', sortable: true, filterType: 'number', filterField: 'on_hand_qty' },
    { key: 'on_order_qty', header: 'On Order', accessor: (r) => fmt(r.on_order_qty), align: 'right', sortable: true, filterType: 'number', filterField: 'on_order_qty' },
    { key: 'avg_daily_sales', header: 'Avg/Day', accessor: (r) => r.avg_daily_sales?.toFixed(1) ?? '—', align: 'right', sortable: true, filterType: 'number', filterField: 'avg_daily_sales' },
    {
      key: 'reorder_point', header: 'Reorder Pt', align: 'right', sortable: true, filterType: 'number', filterField: 'reorder_point',
      accessor: (r) => (
        <span title={r.is_configured ? 'From configured policy' : 'Auto-computed from demand'}>
          {fmt(r.reorder_point)}{r.is_configured ? ' *' : ''}
        </span>
      ),
    },
    { key: 'order_up_to_qty', header: 'Order Up To', accessor: (r) => fmt(r.order_up_to_qty), align: 'right', sortable: true, filterType: 'number', filterField: 'order_up_to_qty' },
    { key: 'safety_stock_qty', header: 'Safety', accessor: (r) => fmt(r.safety_stock_qty), align: 'right', filterType: 'number', filterField: 'safety_stock_qty' },
    { key: 'suggested_order_qty', header: 'Suggested Qty', accessor: (r) => <span className="font-semibold text-primary-700">{fmt(r.suggested_order_qty)}</span>, align: 'right', sortable: true, filterType: 'number', filterField: 'suggested_order_qty' },
    {
      key: 'abc_class', header: 'ABC',
      accessor: (r) => <Badge variant={r.abc_class === 'A' ? 'success' : r.abc_class === 'B' ? 'warning' : 'default'} size="sm">{r.abc_class ?? '—'}</Badge>,
      filterType: 'select', filterField: 'abc_class',
      filterOptions: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }],
    },
    { key: 'days_of_stock', header: 'Days Stock', accessor: (r) => r.days_of_stock != null ? r.days_of_stock.toFixed(0) : '—', align: 'right' },
  ]);

  const ageingCols: Column<StockAgeingRow>[] = reportCols([
    { key: 'sku', header: 'SKU', accessor: 'sku', width: '100px', sortable: true, filterType: 'text', filterField: 'sku' },
    { key: 'product_name', header: 'Product', accessor: 'product_name', filterType: 'text', filterField: 'product_name' },
    { key: 'batch_number', header: 'Batch', accessor: 'batch_number', width: '120px', filterType: 'text', filterField: 'batch_number' },
    { key: 'location_code', header: 'Location', accessor: 'location_code', width: '90px', filterType: 'text', filterField: 'location_code' },
    { key: 'inward_date', header: 'Inward Date', accessor: (r) => fmtDate(r.inward_date), sortable: true, filterType: 'date', filterField: 'inward_date' },
    { key: 'age_days', header: 'Age (Days)', accessor: (r) => r.age_days >= 0 ? fmt(r.age_days) : '—', align: 'right' },
    { key: 'age_bucket', header: 'Bucket', accessor: (r) => <Badge variant={r.age_bucket.startsWith('>') ? 'error' : r.age_bucket.includes('181') ? 'warning' : 'default'} size="sm">{r.age_bucket}</Badge> },
    { key: 'quantity', header: 'Qty', accessor: (r) => fmt(r.quantity), align: 'right', sortable: true, filterType: 'number', filterField: 'quantity' },
    { key: 'batch_value', header: 'Value', accessor: (r) => fmtCurrency(r.batch_value), align: 'right', sortable: true, filterType: 'number', filterField: 'batch_value' },
  ]);

  const pdfColsMap = {
    current: currentCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    batch: batchCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    ledger: ledgerCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    reorder: reorderCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
    ageing: ageingCols.map((c) => ({ key: c.key, header: c.header, align: c.align })),
  };

  const activeData = useMemo(() => {
    switch (activeTab) {
      case 'current': return (currentStock.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'batch': return (batchInv.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'ledger': return (ledger.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'reorder': return (reorder.data?.data ?? []) as unknown as Record<string, unknown>[];
      case 'ageing': return (ageing.data?.data ?? []) as unknown as Record<string, unknown>[];
    }
  }, [activeTab, currentStock.data, batchInv.data, ledger.data, reorder.data, ageing.data]);

  const pdfPayload = usePdfPayload({
    title: tabs.find((t) => t.key === activeTab)?.label ?? 'Inventory Report',
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
          <h1 className="text-2xl font-bold text-gray-900">Inventory & Stock Reports</h1>
          <p className="mt-1 text-sm text-gray-500">Filter per column · sort by clicking header · server-side</p>
        </div>
        <ExportToolbar
          reportType={exportMap[activeTab]}
          filters={exportFilters[activeTab]}
          onRefresh={() => void activeQuery.refetch()}
          isRefreshing={activeQuery.isFetching}
          onResetView={activeGrid.resetAll}
          hasActiveViewState={activeGrid.hasActiveControls}
          pdfPayload={pdfPayload}
        />
      </div>

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

      {activeQuery?.isError && <QueryErrorBanner error={activeQuery.error} />}

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
        <CardHeader title={tabs.find((t) => t.key === activeTab)?.label ?? ''} className="px-6 pt-6" />

        {activeTab === 'current' && (
          <DataTable<CurrentStockRow>
            data={currentStock.data?.data ?? []}
            columns={currentCols}
            keyExtractor={(r) => `${r.product_id}-${r.location_id}`}
            isLoading={currentStock.isLoading}
            emptyMessage="No stock data"
            sorting={currentGrid.sortingProps}
            filtering={currentGrid.filteringProps}
            pagination={currentGrid.paginationProps(currentStock.data?.total ?? 0)}
          />
        )}

        {activeTab === 'batch' && (
          <DataTable<BatchInventoryRow>
            data={batchInv.data?.data ?? []}
            columns={batchCols}
            keyExtractor={(r) => r.batch_id}
            isLoading={batchInv.isLoading}
            emptyMessage="No batch data"
            sorting={batchGrid.sortingProps}
            filtering={batchGrid.filteringProps}
            pagination={batchGrid.paginationProps(batchInv.data?.total ?? 0)}
          />
        )}

        {activeTab === 'ledger' && (
          <DataTable<MovementLedgerRow>
            data={ledger.data?.data ?? []}
            columns={ledgerCols}
            keyExtractor={(r) => r.id}
            isLoading={ledger.isLoading}
            emptyMessage="No transactions"
            sorting={ledgerGrid.sortingProps}
            filtering={ledgerGrid.filteringProps}
            pagination={ledgerGrid.paginationProps(ledger.data?.total ?? 0)}
          />
        )}

        {activeTab === 'reorder' && (
          <>
            <div className="px-6 pb-4 flex flex-wrap items-end gap-3 border-b border-gray-100">
              {([
                ['lookbackDays', 'Demand window (days)', 'Trailing days of net sales used for average daily demand'],
                ['coverageDays', 'Cover next (days)', 'Days of demand the order should cover'],
                ['leadTimeDays', 'Lead time (days)', 'Default supplier lead time (per-product config overrides this)'],
                ['safetyDays', 'Safety (days)', 'Buffer days of cover (per-product config overrides this)'],
              ] as const).map(([k, label, hint]) => (
                <label key={k} className="flex flex-col gap-1" title={hint}>
                  <span className="text-xs font-medium text-gray-500">{label}</span>
                  <input
                    type="number"
                    min={k === 'coverageDays' || k === 'lookbackDays' ? 1 : 0}
                    value={reorderParams[k]}
                    onChange={(e) => setReorderParams((p) => ({ ...p, [k]: Math.max(0, Number(e.target.value) || 0) }))}
                    className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-gray-700 pb-1.5">
                <input
                  type="checkbox"
                  checked={reorderParams.includeAll}
                  onChange={(e) => setReorderParams((p) => ({ ...p, includeAll: e.target.checked }))}
                />
                Show all items
              </label>
              <div className="ml-auto flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500">Min/Max config</span>
                <div className="flex gap-2">
                  <Link
                    to="/pharma-reports/reorder-config"
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Manage config →
                  </Link>
                  <button
                    type="button"
                    onClick={() => csvInputRef.current?.click()}
                    disabled={upsertConfig.isPending}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {upsertConfig.isPending ? 'Importing…' : 'Import config CSV'}
                  </button>
                </div>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleConfigCsv(f);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
            {importMsg && (
              <div className={`px-6 py-2 text-xs ${importMsg.kind === 'ok' ? 'text-green-700 bg-green-50' : 'text-amber-800 bg-amber-50'}`}>
                {importMsg.text}
              </div>
            )}
            <div className="px-6 pt-2 pb-1 text-xs text-gray-400">
              Demand-driven from net sales over the last {reorderParams.lookbackDays} days; “Reorder Pt” marked “*” is a configured override. CSV columns: productCode, locationCode, reorderPoint, minOrderQty, maxOrderQty, multipleOrderQty, safetyStockQty, safetyStockDays, leadTimeDays.
            </div>
            <DataTable<ReorderRow>
              data={reorder.data?.data ?? []}
              columns={reorderCols}
              keyExtractor={(r) => `${r.product_id}-${r.location_id}`}
              isLoading={reorder.isLoading}
              emptyMessage={reorderParams.includeAll ? 'No stock data' : 'No items need reordering'}
              sorting={reorderGrid.sortingProps}
              filtering={reorderGrid.filteringProps}
              pagination={reorderGrid.paginationProps(reorder.data?.total ?? 0)}
            />
          </>
        )}

        {activeTab === 'ageing' && (
          <DataTable<StockAgeingRow>
            data={ageing.data?.data ?? []}
            columns={ageingCols}
            keyExtractor={(r) => `${r.product_id}-${r.batch_number}`}
            isLoading={ageing.isLoading}
            emptyMessage="No ageing data"
            sorting={ageingGrid.sortingProps}
            filtering={ageingGrid.filteringProps}
            pagination={ageingGrid.paginationProps(ageing.data?.total ?? 0)}
          />
        )}
      </Card>
    </div>
  );
}
