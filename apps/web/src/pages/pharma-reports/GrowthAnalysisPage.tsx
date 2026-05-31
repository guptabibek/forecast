import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from '@heroicons/react/24/solid';
import { useEffect, useMemo, useState } from 'react';
import { BarChart } from '../../components/charts';
import type { Column } from '../../components/ui';
import { Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import { usePdfPayload } from '../../hooks/usePdfPayload';
import { useSalesPurchaseComparison } from '../../hooks/usePharmaReports';
import { useTenantConfig } from '../../hooks/useTenantConfig';
import type {
  SalesPurchaseAnalysisKind,
  SalesPurchaseComparisonBreakdownRow,
  SalesPurchaseDimension,
} from '../../services/api/pharma-reports.service';
import {
  COMPARISON_PRESETS_DEFINITION,
  resolveComparisonRange,
  type ComparisonPresetId,
} from '../../utils/date-presets';
import ExportToolbar from './ExportToolbar';
import { fmt, fmtCurrency, fmtDate, fmtPct } from './shared';

type DimensionChoice = SalesPurchaseDimension | 'none';

const ALL_DIMENSION_OPTIONS: Array<{ value: DimensionChoice; label: string; pharmaOnly?: boolean; purchaseOnly?: boolean }> = [
  { value: 'none', label: 'No breakdown (summary only)' },
  { value: 'salesman', label: 'By Salesman' },
  { value: 'supplier', label: 'By Supplier', purchaseOnly: true },
  { value: 'productCompany', label: 'By Company' },
  { value: 'productGroup', label: 'By Product Group' },
  { value: 'salt', label: 'By Salt', pharmaOnly: true },
  { value: 'product', label: 'By Product' },
  { value: 'hsnCode', label: 'By HSN' },
  { value: 'state', label: 'By Route' },
  { value: 'city', label: 'By City / Area' },
];

const KIND_TABS: Array<{ key: SalesPurchaseAnalysisKind; label: string }> = [
  { key: 'sales', label: 'Sales Growth' },
  { key: 'purchase', label: 'Purchase Growth' },
];

const DEFAULT_PRESET: ComparisonPresetId = 'last30-vs-prior30';

function GrowthBadge({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const positive = value > 0.05;
  const negative = value < -0.05;
  // For metrics where "down" is good (e.g., cost), invert the colour mapping.
  const goodDirection = invert ? negative : positive;
  const badDirection = invert ? positive : negative;
  const color = goodDirection
    ? 'text-green-600'
    : badDirection
      ? 'text-red-600'
      : 'text-gray-500';
  const Icon = positive ? ArrowUpIcon : negative ? ArrowDownIcon : MinusIcon;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {fmtPct(value)}
    </span>
  );
}

function MetricCard({
  label,
  current,
  compare,
  delta,
  growthPct,
  formatter,
}: {
  label: string;
  current: number;
  compare: number;
  delta: number;
  growthPct: number | null;
  formatter: (v: number | null | undefined) => string;
}) {
  return (
    <Card padding="sm">
      <p className="text-[10px] lg:text-xs font-semibold uppercase tracking-wide text-gray-500 truncate">{label}</p>
      <p className="mt-1 text-sm lg:text-lg font-bold text-gray-900 truncate">{formatter(current)}</p>
      <div className="mt-1 text-xs text-gray-500">
        Prev: <span className="font-medium">{formatter(compare)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-gray-500">
          {delta >= 0 ? '+' : ''}
          {formatter(delta)}
        </span>
        <GrowthBadge value={growthPct} />
      </div>
    </Card>
  );
}

export default function GrowthAnalysisPage() {
  const { isPharma } = useTenantConfig();
  const [kind, setKind] = useState<SalesPurchaseAnalysisKind>('sales');
  const DIMENSION_OPTIONS = useMemo(
    () => ALL_DIMENSION_OPTIONS.filter((d) => (!d.pharmaOnly || isPharma) && (!d.purchaseOnly || kind === 'purchase')),
    [isPharma, kind],
  );

  // Default windows resolve through the comparison-preset helper so users land
  // on a sensible "last-30-vs-prior-30" view; switching presets recomputes all
  // four dates atomically.
  const initial = resolveComparisonRange(DEFAULT_PRESET);
  const [presetId, setPresetId] = useState<ComparisonPresetId>(DEFAULT_PRESET);
  const [startDate, setStartDate] = useState<string>(initial?.current.startDate ?? '');
  const [endDate, setEndDate] = useState<string>(initial?.current.endDate ?? '');
  const [compareStartDate, setCompareStartDate] = useState<string>(initial?.compare.startDate ?? '');
  const [compareEndDate, setCompareEndDate] = useState<string>(initial?.compare.endDate ?? '');
  const [dimension, setDimension] = useState<DimensionChoice>('productCompany');
  const [breakdownSort, setBreakdownSort] = useState<{ key: string; order: 'asc' | 'desc' }>({ key: 'currentAmount', order: 'desc' });
  // The breakdown returns ALL groups (the backend no longer truncates to a
  // top-N); we paginate it client-side so a multi-thousand-SKU product
  // breakdown stays responsive while still showing every row.
  const [breakdownPage, setBreakdownPage] = useState(1);
  const [breakdownPageSize, setBreakdownPageSize] = useState(50);

  // When user picks a non-custom preset, push all four dates atomically.
  useEffect(() => {
    if (presetId === 'custom') return;
    const r = resolveComparisonRange(presetId);
    if (r) {
      setStartDate(r.current.startDate);
      setEndDate(r.current.endDate);
      setCompareStartDate(r.compare.startDate);
      setCompareEndDate(r.compare.endDate);
    }
  }, [presetId]);

  // Reset purchase-only dimensions when switching to sales.
  useEffect(() => {
    const opt = ALL_DIMENSION_OPTIONS.find((d) => d.value === dimension);
    if (opt?.purchaseOnly && kind === 'sales') {
      setDimension('productCompany');
    }
  }, [kind, dimension]);

  const filters = useMemo(
    () => ({
      startDate,
      endDate,
      compareStartDate,
      compareEndDate,
      dimension,
    }),
    [startDate, endDate, compareStartDate, compareEndDate, dimension],
  );

  const comparison = useSalesPurchaseComparison(kind, filters);
  const data = comparison.data;

  const sortedBreakdown = useMemo(() => {
    const rows = [...(data?.breakdown ?? [])];
    const { key, order } = breakdownSort;
    return rows.sort((a, b) => {
      let av: number;
      let bv: number;
      if (key === 'growthPct') {
        if (a.growthPct === null && b.growthPct === null) return 0;
        if (a.growthPct === null) return 1;
        if (b.growthPct === null) return -1;
        av = a.growthPct;
        bv = b.growthPct;
      } else {
        av = (a as unknown as Record<string, number>)[key] ?? 0;
        bv = (b as unknown as Record<string, number>)[key] ?? 0;
      }
      return order === 'desc' ? bv - av : av - bv;
    });
  }, [data?.breakdown, breakdownSort]);

  // Reset to the first page whenever the result set or its ordering changes,
  // so the user isn't stranded on a page that no longer exists.
  useEffect(() => {
    setBreakdownPage(1);
  }, [data?.breakdown, breakdownSort, breakdownPageSize]);

  const pagedBreakdown = useMemo(
    () => sortedBreakdown.slice((breakdownPage - 1) * breakdownPageSize, breakdownPage * breakdownPageSize),
    [sortedBreakdown, breakdownPage, breakdownPageSize],
  );

  const handleBreakdownSort = (key: string) => {
    setBreakdownSort((prev) =>
      prev.key === key ? { key, order: prev.order === 'asc' ? 'desc' : 'asc' } : { key, order: 'desc' },
    );
  };

  const breakdownColumns: Column<SalesPurchaseComparisonBreakdownRow>[] = [
    {
      key: 'label',
      header: DIMENSION_OPTIONS.find((d) => d.value === dimension)?.label.replace('By ', '') ?? 'Group',
      accessor: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.label}</div>
          {/* {row.key && row.key !== row.label && row.key !== '__UNMAPPED__' && row.key !== '__UNATTRIBUTED__' && (
            <div className="text-xs font-mono text-gray-500">{row.key}</div>
          )} */}
        </div>
      ),
    },
    {
      key: 'currentAmount',
      header: 'Current',
      align: 'right',
      sortable: true,
      accessor: (row) => fmtCurrency(row.currentAmount),
    },
    {
      key: 'compareAmount',
      header: 'Previous',
      align: 'right',
      accessor: (row) => fmtCurrency(row.compareAmount),
    },
    {
      key: 'delta',
      header: 'Δ Amount',
      align: 'right',
      accessor: (row) => (
        <span className={row.delta >= 0 ? 'text-green-600' : 'text-red-600'}>
          {row.delta >= 0 ? '+' : ''}
          {fmtCurrency(row.delta)}
        </span>
      ),
    },
    {
      key: 'growthPct',
      header: 'Growth %',
      align: 'right',
      sortable: true,
      accessor: (row) => <GrowthBadge value={row.growthPct} />,
    },
    {
      key: 'currentBills',
      header: 'Bills (curr / prev)',
      align: 'right',
      accessor: (row) => `${fmt(row.currentBills)} / ${fmt(row.compareBills)}`,
    },
    {
      key: 'currentQty',
      header: 'Qty (curr / prev)',
      align: 'right',
      accessor: (row) => `${fmt(row.currentQty, 2)} / ${fmt(row.compareQty, 2)}`,
    },
  ];

  const summary = data?.summary;
  const exportType = kind === 'sales' ? 'sales-growth' : 'purchase-growth';

  const pdfColumns = breakdownColumns.map((c) => ({ key: c.key, header: c.header, align: c.align }));

  const pdfData = useMemo(
    () => (data?.breakdown ?? []) as unknown as Record<string, unknown>[],
    [data?.breakdown],
  );

  const pdfPayload = usePdfPayload({
    title: kind === 'sales' ? 'Sales Growth Analysis' : 'Purchase Growth Analysis',
    reportKey: exportType,
    columns: pdfColumns,
    data: pdfData,
    filters,
    exportMode: 'current-page',
  });

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Growth & Degrowth Analysis</h1>
          <p className="mt-1 text-sm text-gray-500">
            Compare any two date ranges side-by-side. Optionally drill the comparison by salesman, salt,
            company, group, product, or HSN to find the largest gainers and laggards.
          </p>
        </div>
        <ExportToolbar
          reportType={exportType}
          filters={filters}
          pdfPayload={pdfPayload}
          onRefresh={() => void comparison.refetch()}
          isRefreshing={comparison.isFetching}
        />
      </div>

      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="-mb-px flex gap-4 lg:gap-6 min-w-max" aria-label="Tabs">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setKind(tab.key)}
              className={`whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium transition-colors ${
                kind === tab.key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <Card padding="sm">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="label">Period preset</label>
            <select
              className="input"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value as ComparisonPresetId)}
            >
              {COMPARISON_PRESETS_DEFINITION.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Current From</label>
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
            <label className="label">Current To</label>
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
          <div>
            <label className="label">Compare From</label>
            <input
              type="date"
              className="input"
              value={compareStartDate}
              onChange={(e) => {
                setCompareStartDate(e.target.value);
                setPresetId('custom');
              }}
            />
          </div>
          <div>
            <label className="label">Compare To</label>
            <input
              type="date"
              className="input"
              value={compareEndDate}
              onChange={(e) => {
                setCompareEndDate(e.target.value);
                setPresetId('custom');
              }}
            />
          </div>
          <div>
            <label className="label">Breakdown</label>
            <select
              className="input"
              value={dimension}
              onChange={(e) => setDimension(e.target.value as DimensionChoice)}
            >
              {DIMENSION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-500">
          Comparing <span className="font-medium">{fmtDate(startDate)} – {fmtDate(endDate)}</span> against{' '}
          <span className="font-medium">{fmtDate(compareStartDate)} – {fmtDate(compareEndDate)}</span>.
        </div>
      </Card>

      {comparison.isError && (
        <QueryErrorBanner error={comparison.error} onRetry={() => comparison.refetch()} />
      )}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4">
          <MetricCard
            label="Net Amount"
            current={summary.current.netAmount}
            compare={summary.compare.netAmount}
            delta={summary.delta.netAmount}
            growthPct={summary.growthPct.netAmount}
            formatter={fmtCurrency}
          />
          <MetricCard
            label="Bills"
            current={summary.current.billCount}
            compare={summary.compare.billCount}
            delta={summary.delta.billCount}
            growthPct={summary.growthPct.billCount}
            formatter={(v) => fmt(v ?? 0)}
          />
          <MetricCard
            label="Quantity"
            current={summary.current.quantity}
            compare={summary.compare.quantity}
            delta={summary.delta.quantity}
            growthPct={summary.growthPct.quantity}
            formatter={(v) => fmt(v ?? 0, 2)}
          />
          <MetricCard
            label="SKUs"
            current={summary.current.itemCount}
            compare={summary.compare.itemCount}
            delta={summary.delta.itemCount}
            growthPct={summary.growthPct.itemCount}
            formatter={(v) => fmt(v ?? 0)}
          />
          {/* {kind === 'sales' && (
            <MetricCard
              label="Profit"
              current={summary.current.profit}
              compare={summary.compare.profit}
              delta={summary.delta.profit}
              growthPct={summary.growthPct.profit}
              formatter={fmtCurrency}
            />
          )} */}
          {/* {kind === 'sales' && (
            <Card padding="sm">
              <p className="text-[10px] lg:text-xs font-semibold uppercase tracking-wide text-gray-500">Margin %</p>
              <p className="mt-1 text-sm lg:text-lg font-bold text-gray-900">{fmtPct(summary.current.marginPct)}</p>
              <div className="mt-1 text-xs text-gray-500">
                Prev: <span className="font-medium">{fmtPct(summary.compare.marginPct)}</span>
              </div>
              <div className="mt-1 text-xs">
                {summary.delta.marginPct !== null && (
                  <span
                    className={
                      summary.delta.marginPct >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'
                    }
                  >
                    {summary.delta.marginPct >= 0 ? '+' : ''}
                    {summary.delta.marginPct.toFixed(2)} pts
                  </span>
                )}
              </div>
            </Card>
          )} */}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* KPI compare bars: current vs previous side-by-side per metric. */}
          <Card>
            <CardHeader
              title="Period Comparison"
              description="Current vs previous, normalised so visual scale isn't dominated by large absolute amounts."
            />
            <BarChart
              data={[
                {
                  metric: 'Net (₹L)',
                  current: summary.current.netAmount / 100_000,
                  compare: summary.compare.netAmount / 100_000,
                },
                {
                  metric: 'Profit (₹L)',
                  current: summary.current.profit / 100_000,
                  compare: summary.compare.profit / 100_000,
                },
                {
                  metric: 'Bills',
                  current: summary.current.billCount,
                  compare: summary.compare.billCount,
                },
                {
                  metric: 'SKUs',
                  current: summary.current.itemCount,
                  compare: summary.compare.itemCount,
                },
              ]}
              xAxisKey="metric"
              bars={[
                { dataKey: 'current', name: 'Current', color: '#2563EB' },
                { dataKey: 'compare', name: 'Previous', color: '#94A3B8' },
              ]}
              height={300}
            />
          </Card>

          {/* Growth % across metrics — easy management read of the directional story. */}
          <Card>
            <CardHeader title="Growth %" description="Directional change vs the previous period." />
            <BarChart
              data={[
                { metric: 'Net', value: summary.growthPct.netAmount ?? 0 },
                { metric: 'Profit', value: summary.growthPct.profit ?? 0 },
                { metric: 'Quantity', value: summary.growthPct.quantity ?? 0 },
                { metric: 'Bills', value: summary.growthPct.billCount ?? 0 },
                { metric: 'SKUs', value: summary.growthPct.itemCount ?? 0 },
              ]}
              xAxisKey="metric"
              bars={[{ dataKey: 'value', name: 'Growth %', color: '#10B981' }]}
              colorByValue={(v) => (v >= 0 ? '#10B981' : '#EF4444')}
              showLegend={false}
              referenceLines={[{ y: 0, label: '', color: '#9CA3AF' }]}
              formatTooltip={(v) => `${v.toFixed(1)}%`}
              formatYAxis={(v) => `${Math.round(v)}%`}
              height={300}
            />
          </Card>
        </div>
      )}

      {dimension !== 'none' && data?.breakdown && data.breakdown.length > 0 && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader
              title="Top Gainers"
              description="Largest absolute increase in net amount. Investment-worthy momentum."
            />
            <BarChart
              data={data.breakdown
                .filter((r) => r.delta > 0)
                .slice(0, 10)
                .map((r) => ({
                  name: r.label.length > 24 ? `${r.label.slice(0, 24)}…` : r.label,
                  delta: r.delta,
                }))}
              xAxisKey="name"
              bars={[{ dataKey: 'delta', name: 'Δ Amount', color: '#10B981' }]}
              layout="vertical"
              height={Math.max(220, Math.min(10, data.breakdown.filter((r) => r.delta > 0).length) * 36)}
              showLegend={false}
              formatTooltip={(v) => fmtCurrency(v)}
            />
          </Card>
          <Card>
            <CardHeader
              title="Top Decliners"
              description="Largest drops vs the previous period. Where to dig in first."
            />
            <BarChart
              data={[...data.breakdown]
                .filter((r) => r.delta < 0)
                .sort((a, b) => a.delta - b.delta)
                .slice(0, 10)
                .map((r) => ({
                  name: r.label.length > 24 ? `${r.label.slice(0, 24)}…` : r.label,
                  // Recharts horizontal bars need positive magnitudes for nice rendering.
                  drop: Math.abs(r.delta),
                }))}
              xAxisKey="name"
              bars={[{ dataKey: 'drop', name: 'Drop in amount', color: '#EF4444' }]}
              layout="vertical"
              height={Math.max(220, Math.min(10, data.breakdown.filter((r) => r.delta < 0).length) * 36)}
              showLegend={false}
              formatTooltip={(v) => fmtCurrency(-v)}
            />
          </Card>
        </div>
      )}

      {dimension !== 'none' && (
        <Card padding="none">
          <CardHeader
            title={`Breakdown — ${DIMENSION_OPTIONS.find((d) => d.value === dimension)?.label}`}
            description={`All ${sortedBreakdown.length.toLocaleString()} groups with activity in either period — click any column to sort; gainers and decliners both shown.`}
            className="px-6 pt-6"
          />
          <DataTable<SalesPurchaseComparisonBreakdownRow>
            data={pagedBreakdown}
            columns={breakdownColumns}
            keyExtractor={(row) => row.key}
            isLoading={comparison.isLoading}
            emptyMessage="No activity in either period for the selected breakdown"
            sorting={{ sortBy: breakdownSort.key, sortOrder: breakdownSort.order, onSort: handleBreakdownSort }}
            pagination={{
              page: breakdownPage,
              pageSize: breakdownPageSize,
              total: sortedBreakdown.length,
              onPageChange: setBreakdownPage,
              onPageSizeChange: setBreakdownPageSize,
            }}
          />
        </Card>
      )}
    </div>
  );
}
