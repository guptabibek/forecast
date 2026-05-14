import { ArrowPathIcon, ChevronUpDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTenantConfig } from '../../hooks/useTenantConfig';
import type { KeyboardEvent, ReactNode } from 'react';
import { AreaChart } from '../../components/charts/AreaChart';
import { BarChart } from '../../components/charts/BarChart';
import { Badge, Button, Card, QueryErrorBanner } from '../../components/ui';
import {
  useCustomer360,
  useItem360,
  useSupplier360,
} from '../../hooks/usePharmaReports';
import type {
  Customer360Report,
  Item360Report,
  Supplier360Report,
  ThreeSixtyItemMappingDiagnostic,
  ThreeSixtyPeriod,
  ThreeSixtySearchOption,
} from '../../services/api/pharma-reports.service';
import { pharmaReportsService } from '../../services/api/pharma-reports.service';
import { dataService } from '../../services/api/data.service';
import { fmt, fmtCurrency, fmtDate, fmtPct } from './shared';

type Tab = 'item' | 'customer' | 'supplier';
type Report = Item360Report | Customer360Report | Supplier360Report;
type ChartDatum = Record<string, string | number | null | undefined>;

const tabs: { key: Tab; label: string; placeholder: string }[] = [
  { key: 'item', label: 'Item 360', placeholder: 'Search by Item Name / Code / Barcode' },
  { key: 'customer', label: 'Customer 360', placeholder: 'Search by Customer Name / Code / GST / Mobile' },
  { key: 'supplier', label: 'Supplier 360', placeholder: 'Search by Supplier Name / Code / GST / Mobile' },
];

const periodOptions: { value: ThreeSixtyPeriod; label: string }[] = [
  { value: 'fy', label: 'Current Financial Year' },
  { value: 'calendar', label: 'Current Calendar Year' },
  { value: 'last12', label: 'Last 12 Months' },
];

const allEntityLabels: Record<Tab, string> = {
  item: 'All Items',
  customer: 'All Customers',
  supplier: 'All Suppliers',
};

const chartData = <T extends object>(value: T[] | null | undefined): ChartDatum[] =>
  (value ?? []) as ChartDatum[];

function EntitySearchSelect({
  type,
  value,
  placeholder,
  onInputChange,
  onSelect,
}: {
  type: Tab;
  value: string;
  placeholder: string;
  onInputChange: (value: string) => void;
  onSelect: (option: ThreeSixtySearchOption) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [debouncedValue, setDebouncedValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedValue(value), 250);
    return () => window.clearTimeout(handle);
  }, [value]);

  useEffect(() => {
    const handle = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  const { data = [], isFetching } = useQuery({
    queryKey: ['360-search-options', type, debouncedValue],
    queryFn: () => pharmaReportsService.search360Options({ type, search: debouncedValue, limit: 25 }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const options = useMemo<ThreeSixtySearchOption[]>(
    () => [
      { value: '', label: allEntityLabels[type], code: 'ALL', description: null, source: 'LOCAL' },
      ...data,
    ],
    [data, type],
  );

  function choose(option: ThreeSixtySearchOption) {
    onSelect(option);
    setIsOpen(false);
    setHighlightIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setIsOpen(true);
      event.preventDefault();
      return;
    }

    if (!isOpen) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) => (index < options.length - 1 ? index + 1 : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => (index > 0 ? index - 1 : options.length - 1));
    } else if (event.key === 'Enter' && options[highlightIndex]) {
      event.preventDefault();
      choose(options[highlightIndex]);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      setHighlightIndex(0);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-secondary-400" />
      <input
        ref={inputRef}
        className="input w-full pl-10 pr-20"
        value={value}
        onChange={(event) => {
          onInputChange(event.target.value);
          setIsOpen(true);
          setHighlightIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1">
        {value && (
          <button
            type="button"
            className="rounded p-1 text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700"
            onClick={() => {
              onInputChange('');
              inputRef.current?.focus();
              setIsOpen(true);
            }}
            title="Clear"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className="rounded p-1 text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700"
          onClick={() => {
            setIsOpen((open) => !open);
            inputRef.current?.focus();
          }}
          title="Open"
        >
          <ChevronUpDownIcon className="h-4 w-4" />
        </button>
      </div>

      {isOpen && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-secondary-200 bg-white py-1 shadow-lg"
        >
          {options.map((option, index) => (
            <li key={`${option.source}-${option.value || 'all'}-${index}`}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                  index === highlightIndex ? 'bg-primary-50 text-primary-800' : 'text-secondary-800 hover:bg-secondary-50'
                }`}
                onMouseEnter={() => setHighlightIndex(index)}
                onClick={() => choose(option)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{option.label}</span>
                  {option.description && <span className="block truncate text-xs text-secondary-500">{option.description}</span>}
                </span>
                {option.code && (
                  <span className="shrink-0 rounded bg-secondary-100 px-2 py-0.5 font-mono text-xs text-secondary-600">
                    {option.code}
                  </span>
                )}
              </button>
            </li>
          ))}
          {options.length === 1 && (
            <li className="px-3 py-3 text-center text-sm text-secondary-500">
              {isFetching ? 'Loading...' : 'No matches found'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function asText(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function trendClass(value: number | null | undefined) {
  if (value == null) return 'text-secondary-500';
  return value >= 0 ? 'text-green-600' : 'text-red-600';
}

function trendText(value: number | null | undefined) {
  if (value == null) return 'No prior period';
  return `${value >= 0 ? '+' : ''}${fmtPct(value)} vs prior period`;
}

function KpiTile({
  title,
  value,
  subtext,
  tone,
}: {
  title: string;
  value: string;
  subtext?: string;
  tone?: 'good' | 'warn' | 'risk';
}) {
  const toneClass =
    tone === 'good' ? 'border-green-200 bg-green-50/60' :
    tone === 'warn' ? 'border-amber-200 bg-amber-50/70' :
    tone === 'risk' ? 'border-red-200 bg-red-50/70' :
    'border-secondary-200 bg-white';

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <p className="text-sm font-medium text-secondary-500">{title}</p>
      <p className="mt-2 text-2xl font-bold text-secondary-950">{value}</p>
      {subtext && <p className="mt-1 text-xs text-secondary-500">{subtext}</p>}
    </div>
  );
}

function ProfileCard({ activeTab, report }: { activeTab: Tab; report: Report }) {
  const { showSaltColumn } = useTenantConfig();
  const profile = report.profile;
  const title = asText(profile.name);
  const codeLabel = activeTab === 'item' ? 'SKU' : activeTab === 'customer' ? 'Customer Code' : 'Supplier Code';
  const fields: Array<[string, unknown]> =
    activeTab === 'item'
      ? [
          ['Category', profile.category],
          ['Brand', profile.brand],
          ['Company', profile.companyDisplay ?? profile.company],
          ...(showSaltColumn ? [['Salt', profile.saltDisplay ?? profile.salt] as [string, unknown]] : []),
          ['Group', profile.productGroupDisplay ?? profile.productGroup],
          ['HSN Code', profile.hsnCode],
          ['UOM', profile.uomDisplay ?? profile.uom],
          ['MRP', fmtCurrency(asNumber(profile.mrp))],
          ['Selling Price', fmtCurrency(asNumber(profile.sellingPrice))],
          ['Last Purchase', fmtDate(profile.lastPurchaseDate as string | null | undefined)],
        ]
      : activeTab === 'customer'
        ? [
            ['Customer Type', profile.type],
            ['GST No', profile.gstNo],
            ['Credit Limit', fmtCurrency(asNumber(profile.creditLimit))],
            ['Credit Days', profile.creditDays ? `${profile.creditDays} Days` : '-'],
            ['Sales Person', profile.salesPerson],
            ['Last Invoice', fmtDate(profile.lastInvoiceDate as string | null | undefined)],
          ]
        : [
            ['Supplier Type', profile.type],
            ['GST No', profile.gstNo],
            ['Payment Terms', profile.paymentTerms],
            ['Avg Lead Time', profile.avgLeadTimeDays ? `${fmt(asNumber(profile.avgLeadTimeDays), 1)} Days` : '-'],
            ['Contact Person', profile.contactPerson],
            ['Last Purchase', fmtDate(profile.lastPurchaseDate as string | null | undefined)],
          ];

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary-50 text-2xl font-bold text-primary-700">
            {activeTab === 'item' ? 'I' : activeTab === 'customer' ? 'C' : 'S'}
          </div>
          <div>
            <h2 className="text-xl font-bold text-secondary-950">{title}</h2>
            <p className="text-sm text-secondary-500">
              {codeLabel}: <span className="font-semibold text-secondary-800">{asText(profile.code)}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="default" size="sm">360 View</Badge>
              <Badge variant="success" size="sm">Marg-backed</Badge>
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {fields.map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-secondary-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">{label}</p>
              <p className="mt-1 text-sm font-semibold text-secondary-900">{asText(value)}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ItemReport({ report }: { report: Item360Report }) {
  const k = report.kpis;
  const stockAgeing = report.tables.stockAgeing ?? [];
  const openPurchaseOrders = report.tables.openPurchaseOrders ?? [];
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile title="Current Stock" value={fmt(k.currentStock)} subtext={`Cover: ${k.daysStockCover == null ? '-' : `${fmt(k.daysStockCover, 1)} days`}`} />
        <KpiTile title="Current Month Sales" value={fmtCurrency(k.currentMonthSalesValue)} subtext={trendText(k.momSalesChangePct)} tone={(k.momSalesChangePct ?? 0) >= 0 ? 'good' : 'warn'} />
        <KpiTile title="Current Month Purchase" value={fmtCurrency(k.currentMonthPurchaseValue)} subtext={`${fmt(k.currentMonthPurchaseQty)} units`} />
        <KpiTile title="Raised PO Pending" value={fmt(k.openPoQty)} subtext={fmtCurrency(k.openPoValue)} tone={asNumber(k.openPoQty) > 0 ? 'warn' : 'good'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Sales Insight</h3>
          <MetricTable rows={[
            ['Current Month Qty', fmt(k.currentMonthSalesQty)],
            ['Current Month Value', fmtCurrency(k.currentMonthSalesValue)],
            ['Current Year Sales', fmtCurrency(k.currentYearSalesValue)],
            ['YoY Change', <span className={trendClass(k.yoySalesChangePct)}>{trendText(k.yoySalesChangePct)}</span>],
          ]} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Purchase Insight</h3>
          <MetricTable rows={[
            ['Current Month Qty', fmt(k.currentMonthPurchaseQty)],
            ['Current Month Value', fmtCurrency(k.currentMonthPurchaseValue)],
            ['Current Year Purchase', fmtCurrency(k.currentYearPurchaseValue)],
            ['Open PO Count', fmt(k.openPoCount)],
          ]} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Stock Insight</h3>
          <MetricTable rows={[
            ['Stock Value', fmtCurrency(k.stockValue)],
            ['Days Stock Cover', k.daysStockCover == null ? '-' : `${fmt(k.daysStockCover, 1)} Days`],
            ['Gross Margin', fmtCurrency(k.grossMargin)],
            ['Margin %', k.marginPct == null ? '-' : fmtPct(k.marginPct)],
            ['Return %', k.returnPct == null ? '-' : fmtPct(k.returnPct)],
            ['Suggested Action', asNumber(k.currentStock) <= 0 ? 'Replenish' : 'Monitor'],
          ]} />
        </Card>
      </div>

      <SimpleTable
        title="Open Purchase Orders"
        headers={['PO No', 'PO Date', 'Supplier', 'Ordered', 'Received', 'Pending', 'Expected', 'Status']}
        rows={openPurchaseOrders.map((row) => [
          asText(row.order_number),
          fmtDate(row.order_date as string | null | undefined),
          asText(row.supplier_name),
          fmt(asNumber(row.ordered_qty)),
          fmt(asNumber(row.received_qty)),
          fmt(asNumber(row.pending_qty)),
          fmtDate(row.expected_date as string | null | undefined),
          asText(row.status),
        ])}
      />

      <ChartGrid
        leftTitle="Monthly Sales Trend"
        left={<AreaChart data={chartData(report.charts.monthlyTrend)} xAxisKey="month" areas={[
          { dataKey: 'sales_value', name: 'Sales', color: '#2563eb' },
        ]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />}
        rightTitle="Purchase vs Sales"
        right={<AreaChart data={chartData(report.charts.monthlyTrend)} xAxisKey="month" areas={[
          { dataKey: 'purchase_value', name: 'Purchase', color: '#f97316' },
          { dataKey: 'sales_value', name: 'Sales', color: '#2563eb' },
        ]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />}
      />

      <ChartGrid
        leftTitle="Stock Movement"
        left={<BarChart data={chartData(report.charts.stockMovement)} xAxisKey="month" bars={[
          { dataKey: 'receipt_qty', name: 'Receipts', color: '#16a34a' },
          { dataKey: 'issue_qty', name: 'Issues', color: '#dc2626' },
        ]} height={280} formatYAxis={fmt} formatTooltip={fmt} />}
        rightTitle="Location Wise Sales"
        right={<BarChart data={chartData(report.charts.locationSales)} xAxisKey="location" bars={[{ dataKey: 'sales_value', name: 'Sales', color: '#0f766e' }]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <SimpleTable
          title="Stock Ageing Analysis"
          headers={['Age Bucket', 'Qty', 'Share', 'Value', 'Status']}
          rows={stockAgeing.map((row) => [
            asText(row.bucket),
            fmt(asNumber(row.quantity)),
            fmtPct(asNumber(row.share)),
            fmtCurrency(asNumber(row.value)),
            asText(row.status),
          ])}
        />
        <SimpleTable
          title="Near Expiry Stock"
          headers={['Batch No', 'Qty', 'Expiry Date', 'Days Left', 'Status']}
          rows={report.tables.batches.map((row) => [
            asText(row.batch_number),
            fmt(asNumber(row.quantity)),
            fmtDate(row.expiry_date as string | null | undefined),
            row.days_left == null ? '-' : fmt(asNumber(row.days_left)),
            row.days_left != null && asNumber(row.days_left) <= 30 ? 'Critical' : 'Monitor',
          ])}
        />
      </div>

      <ChartGrid
        leftTitle="Top Buyers Contribution"
        left={<BarChart data={chartData(report.tables.topBuyers)} xAxisKey="name" bars={[{ dataKey: 'value', name: 'Sale Value', color: '#7c3aed' }]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />}
        rightTitle="Top Buyers - Current Month"
        right={<div className="-m-4"><ContributionTable title="Top Buyers - Current Month" rows={report.tables.topBuyers} compact /></div>}
      />

    </>
  );
}

function CustomerReport({ report }: { report: Customer360Report }) {
  const k = report.kpis;
  const returnInsight = asRecord(report.tables.returnInsight);
  const profitability = asRecord(report.tables.profitability);
  const loyalty = asRecord(report.tables.loyalty);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile title="Current Month Sales" value={fmtCurrency(k.currentMonthSales)} subtext={trendText(k.momSalesChangePct)} tone={(k.momSalesChangePct ?? 0) >= 0 ? 'good' : 'warn'} />
        <KpiTile title="Outstanding Amount" value={fmtCurrency(k.outstandingAmount)} subtext={`Overdue: ${fmtCurrency(k.overdueAmount)}`} tone={asNumber(k.overdueAmount) > 0 ? 'risk' : 'good'} />
        <KpiTile title="Current Year Sales" value={fmtCurrency(k.currentYearSales)} subtext={trendText(k.yoySalesChangePct)} />
        <KpiTile title="Average Payment Days" value={fmt(k.averagePaymentDays)} subtext={k.lastPaymentAmount == null ? 'No recent payment' : `Last payment ${fmtCurrency(k.lastPaymentAmount)}`} tone={asNumber(k.averagePaymentDays) <= 45 ? 'good' : 'warn'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Sales Growth Insight</h3>
          <MetricTable rows={[
            ['Current Month Sales', fmtCurrency(k.currentMonthSales)],
            ['Last Month Sales', fmtCurrency(k.lastMonthSales)],
            ['MoM Change', <span className={trendClass(k.momSalesChangePct)}>{trendText(k.momSalesChangePct)}</span>],
            ['Current Year Sales', fmtCurrency(k.currentYearSales)],
            ['YoY Change', <span className={trendClass(k.yoySalesChangePct)}>{trendText(k.yoySalesChangePct)}</span>],
          ]} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Outstanding & Payment Insight</h3>
          <MetricTable rows={[
            ['Total Outstanding', fmtCurrency(k.outstandingAmount)],
            ['Not Due', fmtCurrency(k.notDueAmount)],
            ['Due This Week', fmtCurrency(k.dueThisWeekAmount)],
            ['Overdue Amount', fmtCurrency(k.overdueAmount)],
            ['Credit / Advance', fmtCurrency(k.creditBalance)],
            ['Last Payment', k.lastPaymentAmount == null ? '-' : fmtCurrency(k.lastPaymentAmount)],
            ['Average Payment Days', fmt(k.averagePaymentDays)],
          ]} />
        </Card>
        <ScoreCard title="Customer Risk Score" score={asNumber(k.riskScore)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <AgeingTable title="Outstanding Ageing" rows={report.ageing} countHeader="Invoice Count" />
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Outstanding Ageing Chart</h3>
          <div className="mt-3">
            <BarChart data={chartData(report.ageing)} xAxisKey="bucket" bars={[{ dataKey: 'amount', name: 'Outstanding', color: '#dc2626' }]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />
          </div>
        </Card>
      </div>
      <ChartGrid
        leftTitle="Monthly Sales Trend"
        left={<AreaChart data={chartData(report.charts.monthlyTrend)} xAxisKey="month" areas={[{ dataKey: 'sales_value', name: 'Sales', color: '#2563eb' }]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />}
        rightTitle="Payment Delay Trend"
        right={<AreaChart data={chartData(report.charts.paymentDelayTrend)} xAxisKey="month" areas={[{ dataKey: 'delay_days', name: 'Delay Days', color: '#f97316' }]} height={280} formatYAxis={fmt} formatTooltip={fmt} />}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <ContributionTable title="Top Purchased Items" rows={report.tables.topItems} showItemDetails />
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Top Items Contribution</h3>
          <div className="mt-3">
            <BarChart data={chartData(report.tables.topItems)} xAxisKey="name" bars={[{ dataKey: 'value', name: 'Sale Value', color: '#7c3aed' }]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />
          </div>
        </Card>
      </div>
      <MappingDiagnostics diagnostics={report.diagnostics?.unmappedItems ?? []} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Return Insight</h3>
          <MetricTable rows={[
            ['Return Value', fmtCurrency(asNumber(returnInsight.returnValue))],
            ['Return Qty', fmt(asNumber(returnInsight.returnQty))],
            ['Return Count', fmt(asNumber(returnInsight.returnCount))],
            ['Return %', returnInsight.returnPct == null ? '-' : fmtPct(asNumber(returnInsight.returnPct))],
          ]} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Profitability Insight</h3>
          <MetricTable rows={[
            ['Sales Value', fmtCurrency(asNumber(profitability.salesValue))],
            ['Estimated Cost', fmtCurrency(asNumber(profitability.estimatedCost))],
            ['Gross Margin', fmtCurrency(asNumber(profitability.grossMargin))],
            ['Margin %', profitability.marginPct == null ? '-' : fmtPct(asNumber(profitability.marginPct))],
          ]} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Loyalty Insight</h3>
          <MetricTable rows={[
            ['Invoice Count', fmt(asNumber(loyalty.invoiceCount))],
            ['Purchase Frequency', `${fmt(asNumber(loyalty.purchaseFrequency), 3)} / day`],
            ['Inactive Days', loyalty.inactiveDays == null ? '-' : fmt(asNumber(loyalty.inactiveDays))],
            ['Last Invoice', fmtDate(loyalty.lastInvoiceDate as string | null | undefined)],
            ['Last Payment', fmtDate(loyalty.lastPaymentDate as string | null | undefined)],
            ['Average Payment Days', fmt(asNumber(loyalty.averagePaymentDays))],
          ]} />
        </Card>
      </div>
    </>
  );
}

function SupplierReport({ report }: { report: Supplier360Report }) {
  const k = report.kpis;
  const delivery = asRecord(report.tables.deliveryPerformance);
  const quality = asRecord(report.tables.quality);
  const priceVariance = asRecord(report.tables.priceVariance);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile title="Current Month Purchase" value={fmtCurrency(k.currentMonthPurchase)} subtext={trendText(k.momPurchaseChangePct)} tone={(k.momPurchaseChangePct ?? 0) >= 0 ? 'good' : 'warn'} />
        <KpiTile title="Payable Amount" value={fmtCurrency(k.payableAmount)} subtext={`Overdue: ${fmtCurrency(k.overduePayable)}`} tone={asNumber(k.overduePayable) > 0 ? 'risk' : 'good'} />
        <KpiTile title="Open PO Value" value={fmtCurrency(k.openPoValue)} subtext={`${fmt(k.openPoCount)} open orders`} tone={asNumber(k.openPoValue) > 0 ? 'warn' : 'good'} />
        <KpiTile title="On-time Delivery" value={k.onTimeDeliveryPct == null ? '-' : fmtPct(k.onTimeDeliveryPct)} subtext={`Score: ${fmt(k.score)}`} tone={asNumber(k.score) >= 75 ? 'good' : 'warn'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Purchase Growth Insight</h3>
          <MetricTable rows={[
            ['Current Month Purchase', fmtCurrency(k.currentMonthPurchase)],
            ['Last Month Purchase', fmtCurrency(k.lastMonthPurchase)],
            ['MoM Change', <span className={trendClass(k.momPurchaseChangePct)}>{trendText(k.momPurchaseChangePct)}</span>],
            ['Current Year Purchase', fmtCurrency(k.currentYearPurchase)],
          ]} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Payable Insight</h3>
          <MetricTable rows={[
            ['Total Payable', fmtCurrency(k.payableAmount)],
            ['Overdue', fmtCurrency(k.overduePayable)],
            ['Supplier Advance', fmtCurrency(k.supplierAdvanceAmount)],
            ['Open PO Value', fmtCurrency(k.openPoValue)],
            ['Fulfillment Rate', k.fulfillmentRatePct == null ? '-' : fmtPct(k.fulfillmentRatePct)],
          ]} />
        </Card>
        <ScoreCard title="Supplier Performance Score" score={asNumber(k.score)} />
      </div>
      <ChartGrid
        leftTitle="Payable Ageing Chart"
        left={<BarChart data={chartData(report.ageing)} xAxisKey="bucket" bars={[{ dataKey: 'amount', name: 'Payable', color: '#f97316' }]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />}
        rightTitle="Monthly Purchase Trend"
        right={<AreaChart data={chartData(report.charts.monthlyTrend)} xAxisKey="month" areas={[{ dataKey: 'purchase_value', name: 'Purchase', color: '#0f766e' }]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <AgeingTable title="Payable Ageing" rows={report.ageing} countHeader="Bill Count" />
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">On-time Delivery Trend</h3>
          <div className="mt-3">
            <AreaChart data={chartData(report.charts.deliveryTrend)} xAxisKey="month" areas={[{ dataKey: 'on_time_delivery_pct', name: 'On-time %', color: '#2563eb' }]} height={280} formatYAxis={fmtPct} formatTooltip={fmtPct} />
          </div>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Delivery Performance</h3>
          <MetricTable rows={[
            ['On-time Delivery', delivery.onTimeDeliveryPct == null ? '-' : fmtPct(asNumber(delivery.onTimeDeliveryPct))],
            ['Delayed Deliveries', fmt(asNumber(delivery.delayedDeliveries))],
            ['Average Lead Time', delivery.averageLeadTimeDays == null ? '-' : `${fmt(asNumber(delivery.averageLeadTimeDays), 1)} Days`],
            ['Best Delivery Time', delivery.bestDeliveryTimeDays == null ? '-' : `${fmt(asNumber(delivery.bestDeliveryTimeDays), 1)} Days`],
            ['Short Supply %', delivery.shortSupplyPct == null ? '-' : fmtPct(asNumber(delivery.shortSupplyPct))],
            ['Status', asText(delivery.status)],
          ]} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Quality & Rejection</h3>
          <MetricTable rows={[
            ['Rejection Rate', quality.rejectionRatePct == null ? '-' : fmtPct(asNumber(quality.rejectionRatePct))],
            ['Short Supply Cases', fmt(asNumber(quality.shortSupplyCases))],
            ['Damaged Qty', fmt(asNumber(quality.damagedQty))],
            ['Last QC Issue', fmtDate(quality.lastQcIssueDate as string | null | undefined)],
            ['Status', asText(quality.status)],
          ]} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Price Variance</h3>
          <MetricTable rows={[
            ['Avg Rate Increase', priceVariance.avgRateIncreasePct == null ? '-' : fmtPct(asNumber(priceVariance.avgRateIncreasePct))],
            ['Items With Price Increase', fmt(asNumber(priceVariance.itemsWithPriceIncrease))],
            ['Highest Variance Item', asText(priceVariance.highestVarianceItem)],
            ['Variance Amount', fmtCurrency(asNumber(priceVariance.varianceAmount))],
            ['Status', asText(priceVariance.status)],
          ]} />
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ContributionTable title="Top Items Supplied" rows={report.tables.topItems} showItemDetails />
        <Card>
          <h3 className="text-base font-semibold text-secondary-950">Top Items Purchase Contribution</h3>
          <div className="mt-3">
            <BarChart data={chartData(report.tables.topItems)} xAxisKey="name" bars={[{ dataKey: 'value', name: 'Purchase Value', color: '#7c3aed' }]} height={280} formatYAxis={fmtCurrency} formatTooltip={fmtCurrency} />
          </div>
        </Card>
      </div>
      <div className="grid gap-4">
        <SimpleTable
          title="Open Purchase Orders"
          headers={['PO No', 'PO Date', 'PO Value', 'Received', 'Pending', 'Expected Date', 'Status']}
          rows={report.tables.openOrders.map((row) => [
            asText(row.order_number),
            fmtDate(row.order_date as string | null | undefined),
            fmtCurrency(asNumber(row.po_value)),
            row.received_pct == null ? '-' : fmtPct(asNumber(row.received_pct)),
            row.pending_pct == null ? '-' : fmtPct(asNumber(row.pending_pct)),
            fmtDate(row.expected_date as string | null | undefined),
            asText(row.status),
          ])}
        />
      </div>
    </>
  );
}

function MetricTable({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-secondary-200">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-secondary-100 last:border-0">
              <td className="bg-secondary-50 px-3 py-2 font-medium text-secondary-600">{label}</td>
              <td className="px-3 py-2 text-right font-semibold text-secondary-950">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreCard({ title, score }: { title: string; score: number }) {
  const label = score >= 85 ? 'A Grade' : score >= 70 ? 'Monitor' : 'High Risk';
  return (
    <Card>
      <h3 className="text-base font-semibold text-secondary-950">{title}</h3>
      <div className="mt-5 flex flex-col items-center">
        <div className="flex h-32 w-32 items-center justify-center rounded-full border-[12px] border-primary-500 bg-primary-50 text-3xl font-black text-primary-700">
          {fmt(score)}
        </div>
        <p className="mt-4 font-semibold text-secondary-900">{label}</p>
        <p className="mt-1 text-center text-sm text-secondary-500">Based on growth, ageing, fulfilment, risk, and open exposure.</p>
      </div>
    </Card>
  );
}

function ChartGrid({
  leftTitle,
  left,
  rightTitle,
  right,
}: {
  leftTitle: string;
  left: ReactNode;
  rightTitle: string;
  right: ReactNode;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <h3 className="text-base font-semibold text-secondary-950">{leftTitle}</h3>
        <div className="mt-3">{left}</div>
      </Card>
      <Card>
        <h3 className="text-base font-semibold text-secondary-950">{rightTitle}</h3>
        <div className="mt-3">{right}</div>
      </Card>
    </div>
  );
}

function MappingDiagnostics({ diagnostics }: { diagnostics: ThreeSixtyItemMappingDiagnostic[] }) {
  if (!diagnostics.length) return null;

  return (
    <SimpleTable
      title="Item Mapping Diagnostics"
      headers={['Reason', 'Company', 'PID', 'Code', 'Staged Name', 'Lines', 'Value']}
      rows={diagnostics.map((row) => [
        row.reason,
        row.companyId == null ? '-' : String(row.companyId),
        row.margPid || '-',
        row.itemCode || '-',
        row.stagedName || '-',
        fmt(row.lineCount),
        fmtCurrency(row.value),
      ])}
    />
  );
}

function ContributionTable({
  title,
  rows,
  compact = false,
  showItemDetails = false,
}: {
  title: string;
  rows: Array<{
    rank: number;
    name: string;
    code?: string | null;
    company?: string | null;
    salt?: string | null;
    saltDisplay?: string | null;
    productGroup?: string | null;
    productGroupDisplay?: string | null;
    companyDisplay?: string | null;
    uomDisplay?: string | null;
    hsnCode?: string | null;
    mappingStatus?: string | null;
    missingReason?: string | null;
    quantity?: number;
    value: number;
    share: number;
  }>;
  compact?: boolean;
  showItemDetails?: boolean;
}) {
  const { showSaltColumn } = useTenantConfig();
  const headers = showItemDetails
    ? ['Rank', 'Name', 'Code', 'Company', ...(showSaltColumn ? ['Salt'] : []), 'Group', 'HSN', 'Qty', 'Value', 'Share', 'Mapping']
    : ['Rank', 'Name', 'Qty', 'Value', 'Share'];
  const tableRows = rows.map((row) => {
    const base = [
      fmt(row.rank),
      row.name,
    ];
    if (showItemDetails) {
      base.push(
        row.code || '-',
        row.company || '-',
        ...(showSaltColumn ? [row.salt || '-'] : []),
        row.productGroup || '-',
        row.hsnCode || '-',
      );
    }
    base.push(
      row.quantity == null ? '-' : fmt(row.quantity),
      fmtCurrency(row.value),
      fmtPct(row.share),
    );
    if (showItemDetails) {
      base.push(row.mappingStatus === 'MAPPED' || !row.mappingStatus ? 'Mapped' : `${row.mappingStatus}: ${row.missingReason || 'Check Marg sync'}`);
    }
    return base;
  });

  const table = (
    <DataTable
      headers={headers}
      rows={tableRows}
    />
  );
  if (compact) return table;
  return <Card><h3 className="text-base font-semibold text-secondary-950">{title}</h3>{table}</Card>;
}

function SimpleTable({ title, headers, rows }: { title: string; headers: string[]; rows: ReactNode[][] }) {
  return (
    <Card>
      <h3 className="text-base font-semibold text-secondary-950">{title}</h3>
      <DataTable headers={headers} rows={rows} />
    </Card>
  );
}

function AgeingTable({ title, rows, countHeader }: { title: string; rows: Array<{ bucket: string; count?: number; amount: number; status: string }>; countHeader: string }) {
  return (
    <SimpleTable
      title={title}
      headers={['Age Bucket', countHeader, 'Amount', 'Status']}
      rows={rows.map((row) => [
        row.bucket,
        fmt(asNumber(row.count)),
        fmtCurrency(row.amount),
        row.status,
      ])}
    />
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  const numericHeaders = new Set(['Rank', 'Qty', 'Value', 'Share', 'Lines', 'Amount', 'Count', 'Company', 'PID']);
  const isNumericColumn = (header: string) =>
    numericHeaders.has(header)
    || header.includes('%')
    || header.toLowerCase().includes('value')
    || header.toLowerCase().includes('amount');

  return (
    <div className="mt-3 overflow-auto rounded-lg border border-secondary-200">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-secondary-50">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-secondary-500 ${
                  isNumericColumn(header) ? 'text-right' : 'text-left'
                }`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={index} className="border-t border-secondary-100">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-3 py-2 text-secondary-800 ${
                    isNumericColumn(headers[cellIndex]) ? 'text-right tabular-nums' : ''
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          )) : (
            <tr>
              <td className="px-3 py-8 text-center text-secondary-500" colSpan={headers.length}>No data available</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function InsightCard({ insights }: { insights: string[] }) {
  return (
    <Card>
      <h3 className="text-base font-semibold text-secondary-950">System Generated Insights</h3>
      <ul className="mt-3 space-y-2">
        {insights.map((insight) => (
          <li key={insight} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {insight}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ThreeSixtyReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('item');
  const [draftSearch, setDraftSearch] = useState('');
  const [selectedSearchValue, setSelectedSearchValue] = useState('');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<ThreeSixtyPeriod>('fy');
  const [locationId, setLocationId] = useState('');

  const { data: locations = [] } = useQuery({
    queryKey: ['dimensions', 'location', '360-reports'],
    queryFn: () => dataService.getLocations({ limit: 200 }),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const params = useMemo(() => ({ search, period, locationId }), [search, period, locationId]);
  const item = useItem360(params, activeTab === 'item');
  const customer = useCustomer360(params, activeTab === 'customer');
  const supplier = useSupplier360(params, activeTab === 'supplier');

  const activeQuery = activeTab === 'item' ? item : activeTab === 'customer' ? customer : supplier;
  const report = activeQuery.data as Report | undefined;
  const activeMeta = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];
  const hasActiveViewState = Boolean(search || draftSearch || selectedSearchValue || locationId || period !== 'fy');

  function submit(event: FormEvent) {
    event.preventDefault();
    setSearch(selectedSearchValue || draftSearch.trim());
  }

  function resetView() {
    setDraftSearch('');
    setSelectedSearchValue('');
    setSearch('');
    setPeriod('fy');
    setLocationId('');
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="rounded-lg border border-primary-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-secondary-950">360 Reports</h1>
            <p className="mt-1 text-sm text-secondary-500">Entity-wise item, customer, and supplier intelligence from Marg EDE and operational data.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key);
                  setDraftSearch('');
                  setSelectedSearchValue('');
                  setSearch('');
                }}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  activeTab === tab.key
                    ? 'bg-primary-600 text-white'
                    : 'bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3 lg:flex-row">
          <EntitySearchSelect
            type={activeTab}
            value={draftSearch}
            onInputChange={(value) => {
              setDraftSearch(value);
              setSelectedSearchValue('');
            }}
            onSelect={(option) => {
              setDraftSearch(option.value ? `${option.label}${option.code ? ` (${option.code})` : ''}` : '');
              setSelectedSearchValue(option.value);
              setSearch(option.value);
            }}
            placeholder={activeMeta.placeholder}
          />
          <select className="input lg:w-64" value={period} onChange={(event) => setPeriod(event.target.value as ThreeSixtyPeriod)}>
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select className="input lg:w-56" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">All Locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name || location.code}</option>
            ))}
          </select>
          <Button type="submit" leftIcon={<MagnifyingGlassIcon className="h-4 w-4" />}>Search</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void activeQuery.refetch()}
            isLoading={activeQuery.isFetching}
            leftIcon={<ArrowPathIcon className="h-4 w-4" />}
          >
            Refresh
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={resetView}
            disabled={!hasActiveViewState}
            leftIcon={<XMarkIcon className="h-4 w-4" />}
          >
            Reset
          </Button>
        </form>
      </div>

      {activeQuery.isError && <QueryErrorBanner error={activeQuery.error} onRetry={() => activeQuery.refetch()} />}

      {activeQuery.isLoading && (
        <Card>
          <div className="flex h-48 items-center justify-center text-sm text-secondary-500">Loading 360 report...</div>
        </Card>
      )}

      {report && !activeQuery.isLoading && (
        <>
          <ProfileCard activeTab={activeTab} report={report} />
          {activeTab === 'item' && <ItemReport report={report as Item360Report} />}
          {activeTab === 'customer' && <CustomerReport report={report as Customer360Report} />}
          {activeTab === 'supplier' && <SupplierReport report={report as Supplier360Report} />}
          <InsightCard insights={report.insights} />
        </>
      )}
    </div>
  );
}
