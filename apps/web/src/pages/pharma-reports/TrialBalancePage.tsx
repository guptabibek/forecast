import { ArrowDownIcon, ArrowTrendingUpIcon, ArrowUpIcon, BanknotesIcon, ChartBarIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, ExclamationTriangleIcon, ScaleIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { reportsService } from '../../services/api';
import { formatInrCompact } from '../../utils/number-format';
import type { Column } from '../../components/ui';
import { Card, DataTable, Modal, QueryErrorBanner } from '../../components/ui';
import { DetailPopupActions } from '../../components/reports/DetailPopupActions';
import { usePharmaGrid } from '../../hooks/usePharmaGrid';
import { usePdfPayload } from '../../hooks/usePdfPayload';
import { useAccountLedger, useTrialBalance } from '../../hooks/usePharmaReports';
import type { AccountLedgerRow, TrialBalanceRow } from '../../services/api/pharma-reports.service';
import ExportToolbar from './ExportToolbar';
import { fmt, fmtCurrency, fmtDate } from './shared';

const ACCOUNT_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'REVENUE', label: 'Revenue' },
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'CONTRA_ASSET', label: 'Contra Asset' },
];

// Tally-style group ordering — Liabilities & Equity above Assets, then P&L below.
const GROUP_ORDER: Record<string, number> = {
  LIABILITY: 1,
  EQUITY: 2,
  ASSET: 3,
  CONTRA_ASSET: 4,
  REVENUE: 5,
  EXPENSE: 6,
};

const GROUP_LABEL: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Capital Account',
  REVENUE: 'Income',
  EXPENSE: 'Expenses',
  CONTRA_ASSET: 'Contra Assets',
};

function MetricCard({
  label,
  value,
  subtext,
  valueClassName = 'text-gray-900',
}: {
  label: string;
  value: string;
  subtext?: string;
  valueClassName?: string;
}) {
  return (
    <Card padding="sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-sm lg:text-lg font-bold truncate ${valueClassName}`}>{value}</p>
      {subtext && <p className="mt-1 text-xs text-gray-500">{subtext}</p>}
    </Card>
  );
}

// Convenience: format Dr/Cr columns. In Tally, accounts with debit closing balance
// fill the Debit column; credit closing balance fills the Credit column. A zero
// row shows '—' in both, but we hide zero rows by default.
function dr(value: number) {
  return value > 0.005 ? fmtCurrency(value) : '';
}
function cr(value: number) {
  return value < -0.005 ? fmtCurrency(-value) : '';
}

interface RevenueMetrics {
  currentMonth: number;
  lastMonth: number;
  momChange: number;
  yoyChange: number;
  ytdRevenue: number;
  ytdForecast: number;
  ytdVariance: number;
}

const formatPercent = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

const formatRelativeTime = (dateString: string): string => {
  const diffMins = Math.floor((Date.now() - new Date(dateString).getTime()) / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateString).toLocaleDateString();
};

const KPICard = ({
  title, value, trend, icon: Icon, color, isLoading,
}: {
  title: string;
  value: string;
  trend?: number;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'red';
  isLoading?: boolean;
}) => {
  const palette = {
    blue:   { bg: 'bg-blue-50 dark:bg-blue-900/20',     icon: 'text-blue-600',    border: 'border-blue-200' },
    green:  { bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: 'text-emerald-600', border: 'border-emerald-200' },
    purple: { bg: 'bg-purple-50 dark:bg-purple-900/20', icon: 'text-purple-600',  border: 'border-purple-200' },
    orange: { bg: 'bg-orange-50 dark:bg-orange-900/20', icon: 'text-orange-600',  border: 'border-orange-200' },
    red:    { bg: 'bg-red-50 dark:bg-red-900/20',       icon: 'text-red-600',     border: 'border-red-200' },
  };
  const c = palette[color];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`p-3 rounded-xl ${c.bg} border ${c.border} border-opacity-50 min-w-0 overflow-hidden`}
    >
      {isLoading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-secondary-200 rounded w-16" />
          <div className="h-6 bg-secondary-200 rounded w-20" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${c.icon}`} />
            <span className="text-[11px] font-medium text-secondary-600 dark:text-secondary-300 truncate">{title}</span>
          </div>
          <div className="flex items-end justify-between gap-1">
            <p className="text-sm lg:text-base font-bold text-secondary-900 dark:text-white truncate">{value}</p>
            {trend !== undefined && (
              <div className={`flex items-center gap-0.5 text-xs font-medium flex-shrink-0 ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {trend >= 0 ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />}
                {Math.abs(trend).toFixed(1)}%
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
};

export default function TrialBalancePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialStart = searchParams.get('startDate') ?? '';
  const initialEnd = searchParams.get('endDate') ?? '';
  const initialAccountType = searchParams.get('accountType') ?? '';
  const initialShowZero = searchParams.get('showZero') === 'true';

  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [accountType, setAccountType] = useState(initialAccountType);
  const [showZero, setShowZero] = useState(initialShowZero);

  // Trial balance fetches all accounts (subtotals demand the whole set).
  const baseFilters = useMemo(
    () => ({
      limit: 5000,
      offset: 0,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      accountType: accountType || undefined,
      showZero: showZero ? true : undefined,
    }),
    [startDate, endDate, accountType, showZero],
  );

  const trialBalance = useTrialBalance(baseFilters);

  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ['dashboard-revenue'],
    queryFn: () => reportsService.getRevenueMetrics(),
    staleTime: 30000,
  });
  const { data: statsData } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => reportsService.getDashboardStats(),
    staleTime: 30000,
  });
  const revenue = revenueData as RevenueMetrics | undefined;
  const lastSync = (statsData as { lastDataSync?: string } | undefined)?.lastDataSync;

  const ledgerGrid = usePharmaGrid({ initialSortBy: 'entryDate', initialSortOrder: 'asc', initialPageSize: 50 });
  const [selectedAccount, setSelectedAccount] = useState<TrialBalanceRow | null>(null);
  const [showLedger, setShowLedger] = useState(false);

  const ledger = useAccountLedger(
    selectedAccount?.id,
    {
      ...ledgerGrid.pharmaParams,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    },
    !!selectedAccount,
  );

  // URL-sync for sharable views
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (startDate) next.set('startDate', startDate); else next.delete('startDate');
    if (endDate) next.set('endDate', endDate); else next.delete('endDate');
    if (accountType) next.set('accountType', accountType); else next.delete('accountType');
    if (showZero) next.set('showZero', 'true'); else next.delete('showZero');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, accountType, showZero]);

  const summary = trialBalance.data?.summary;
  const rows = useMemo(
    () => trialBalance.data?.rows ?? [],
    [trialBalance.data?.rows],
  );

  // Group rows by accountType in Tally order
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { type: string; label: string; rows: TrialBalanceRow[]; debit: number; credit: number; openingDr: number; openingCr: number; periodDr: number; periodCr: number }
    >();
    for (const r of rows) {
      const type = r.accountType;
      if (!map.has(type)) {
        map.set(type, {
          type,
          label: GROUP_LABEL[type] ?? type,
          rows: [],
          debit: 0,
          credit: 0,
          openingDr: 0,
          openingCr: 0,
          periodDr: 0,
          periodCr: 0,
        });
      }
      const g = map.get(type)!;
      g.rows.push(r);
      if (r.closingBalance > 0) g.debit += r.closingBalance;
      else if (r.closingBalance < 0) g.credit += -r.closingBalance;
      if (r.openingBalance > 0) g.openingDr += r.openingBalance;
      else if (r.openingBalance < 0) g.openingCr += -r.openingBalance;
      g.periodDr += r.totalDebits;
      g.periodCr += r.totalCredits;
    }
    return Array.from(map.values()).sort(
      (a, b) => (GROUP_ORDER[a.type] ?? 99) - (GROUP_ORDER[b.type] ?? 99),
    );
  }, [rows]);

  // Default: all groups expanded
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (type: string) =>
    setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }));

  const openLedger = (row: TrialBalanceRow) => {
    setSelectedAccount(row);
    setShowLedger(true);
  };

  const totalOpeningDr = grouped.reduce((s, g) => s + g.openingDr, 0);
  const totalOpeningCr = grouped.reduce((s, g) => s + g.openingCr, 0);
  const totalPeriodDr = grouped.reduce((s, g) => s + g.periodDr, 0);
  const totalPeriodCr = grouped.reduce((s, g) => s + g.periodCr, 0);
  const totalClosingDr = grouped.reduce((s, g) => s + g.debit, 0);
  const totalClosingCr = grouped.reduce((s, g) => s + g.credit, 0);
  const closingDiff = totalClosingDr - totalClosingCr;
  const isBalanced = Math.abs(closingDiff) < 0.01;

  const ledgerColumns: Column<AccountLedgerRow>[] = [
    {
      key: 'entryDate',
      header: 'Date',
      sortable: true,
      filterType: 'date',
      filterField: 'entryDate',
      accessor: (row) => fmtDate(row.entryDate),
    },
    {
      key: 'entryNumber',
      header: 'Entry #',
      sortable: true,
      filterType: 'text',
      filterField: 'entryNumber',
      accessor: (row) => <span className="font-mono text-xs">{row.entryNumber}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      filterType: 'text',
      filterField: 'description',
      accessor: (row) => row.description ?? '—',
      className: 'whitespace-normal',
    },
    {
      key: 'referenceType',
      header: 'Ref Type',
      filterType: 'text',
      filterField: 'referenceType',
      accessor: (row) => row.referenceType ?? '—',
    },
    {
      key: 'debitAmount',
      header: 'Debit',
      sortable: true,
      align: 'right',
      filterType: 'number',
      filterField: 'debitAmount',
      accessor: (row) => (row.debitAmount > 0 ? fmtCurrency(row.debitAmount) : '—'),
    },
    {
      key: 'creditAmount',
      header: 'Credit',
      sortable: true,
      align: 'right',
      filterType: 'number',
      filterField: 'creditAmount',
      accessor: (row) => (row.creditAmount > 0 ? fmtCurrency(row.creditAmount) : '—'),
    },
    {
      key: 'runningBalance',
      header: 'Running',
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'runningBalance',
      accessor: (row) => (
        <span className={row.runningBalance < 0 ? 'text-red-600 font-medium' : 'font-medium'}>
          {fmtCurrency(row.runningBalance)}
        </span>
      ),
    },
  ];

  const pdfColumns = useMemo(() => [
    { key: 'name', header: 'Particulars' },
    { key: 'accountNumber', header: 'Account No.' },
    { key: 'accountType', header: 'Type' },
    { key: 'openingBalance', header: 'Opening', align: 'right' as const },
    { key: 'totalDebits', header: 'Period Debit', align: 'right' as const },
    { key: 'totalCredits', header: 'Period Credit', align: 'right' as const },
    { key: 'closingBalance', header: 'Closing', align: 'right' as const },
  ], []);

  const pdfData = useMemo(
    () => rows as unknown as Record<string, unknown>[],
    [rows],
  );

  const pdfPayload = usePdfPayload({
    title: 'Trial Balance',
    reportKey: 'trial-balance',
    columns: pdfColumns,
    data: pdfData,
    filters: baseFilters,
    exportMode: 'current-page',
  });

  const balancedClass = isBalanced ? 'text-green-600' : 'text-red-600';
  const balancedSubtext = isBalanced
    ? 'Ledger balanced (Σ Dr = Σ Cr)'
    : 'Out of balance — investigate posting errors';

  return (
    <div className="space-y-4 lg:space-y-6 animate-in">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Trial Balance</h1>
          <p className="mt-1 text-sm text-gray-500">
            Tally-style grouped trial balance with opening, period activity, and closing balances per account.
            Click an account name to drill into its journal lines.
          </p>
        </div>
        <ExportToolbar
          reportType="trial-balance"
          filters={baseFilters}
          pdfPayload={pdfPayload}
          onRefresh={() => void trialBalance.refetch()}
          isRefreshing={trialBalance.isFetching}
        />
      </div>

      {trialBalance.isError && (
        <QueryErrorBanner error={trialBalance.error} onRetry={() => trialBalance.refetch()} />
      )}

      {/* Revenue Overview — mirrors the dashboard KPI strip */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-4 lg:p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <BanknotesIcon className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base lg:text-lg font-semibold">Revenue Overview</h2>
          </div>
          {lastSync && (
            <span className="text-xs text-secondary-400">
              Updated: {formatRelativeTime(lastSync)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-2 lg:gap-3">
          <KPICard title="This Month"  value={formatInrCompact(revenue?.currentMonth ?? 0)} trend={revenue?.momChange} icon={BanknotesIcon}           color="green"  isLoading={revenueLoading} />
          <KPICard title="Last Month"  value={formatInrCompact(revenue?.lastMonth ?? 0)}                              icon={ClockIcon}              color="blue"   isLoading={revenueLoading} />
          <KPICard title="MoM Change"  value={formatPercent(revenue?.momChange ?? 0)}                                icon={ArrowTrendingUpIcon}    color={revenue?.momChange != null && revenue.momChange >= 0 ? 'green' : 'red'}   isLoading={revenueLoading} />
          <KPICard title="YoY Change"  value={formatPercent(revenue?.yoyChange ?? 0)}                                icon={ArrowTrendingUpIcon}    color={revenue?.yoyChange != null && revenue.yoyChange >= 0 ? 'green' : 'red'}   isLoading={revenueLoading} />
          <KPICard title="YTD Revenue" value={formatInrCompact(revenue?.ytdRevenue ?? 0)}                            icon={ChartBarIcon}           color="purple" isLoading={revenueLoading} />
          <KPICard title="YTD Forecast"value={formatInrCompact(revenue?.ytdForecast ?? 0)}                           icon={SparklesIcon}           color="blue"   isLoading={revenueLoading} />
          <KPICard title="YTD Variance"value={formatPercent(revenue?.ytdVariance ?? 0)}                              icon={ExclamationTriangleIcon} color={revenue?.ytdVariance != null && Math.abs(revenue.ytdVariance) < 5 ? 'green' : 'orange'} isLoading={revenueLoading} />
        </div>
      </motion.div>

      <Card padding="sm">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <div>
            <label className="label">Start Date</label>
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">End Date</label>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Account Type</label>
            <select
              className="input"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
            >
              {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                checked={showZero}
                onChange={(e) => setShowZero(e.target.checked)}
              />
              <span className="text-sm text-secondary-700 dark:text-secondary-300">
                Show zero-balance rows
              </span>
            </label>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <MetricCard label="Accounts" value={fmt(summary?.accountsShown ?? 0)} />
        <MetricCard label="Σ Period Debits" value={fmtCurrency(totalPeriodDr)} />
        <MetricCard label="Σ Period Credits" value={fmtCurrency(totalPeriodCr)} />
        <MetricCard
          label="Balance Check"
          value={fmtCurrency(closingDiff)}
          subtext={balancedSubtext}
          valueClassName={balancedClass}
        />
      </div>

      <Card padding="none">
        <div className="overflow-x-auto">
          {trialBalance.isLoading ? (
            <div className="py-12 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
            </div>
          ) : grouped.length === 0 ? (
            <div className="py-12 text-center text-secondary-500">
              No account activity in the selected window. Adjust filters or check "Show zero-balance rows".
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Particulars</th>
                  <th className="px-4 py-3 text-right" colSpan={2}>
                    Opening Balance
                  </th>
                  <th className="px-4 py-3 text-right" colSpan={2}>
                    Period Activity
                  </th>
                  <th className="px-4 py-3 text-right" colSpan={2}>
                    Closing Balance
                  </th>
                </tr>
                <tr className="text-[11px] normal-case">
                  <th />
                  <th className="px-4 py-2 text-right font-medium">Debit</th>
                  <th className="px-4 py-2 text-right font-medium">Credit</th>
                  <th className="px-4 py-2 text-right font-medium">Debit</th>
                  <th className="px-4 py-2 text-right font-medium">Credit</th>
                  <th className="px-4 py-2 text-right font-medium">Debit</th>
                  <th className="px-4 py-2 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) => {
                  const isCollapsed = collapsed[g.type];
                  return (
                    <>
                      <tr
                        key={`grp-${g.type}`}
                        className="bg-gray-100 dark:bg-gray-700/40 font-semibold cursor-pointer"
                        onClick={() => toggleGroup(g.type)}
                      >
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-1">
                            {isCollapsed ? (
                              <ChevronRightIcon className="h-4 w-4" />
                            ) : (
                              <ChevronDownIcon className="h-4 w-4" />
                            )}
                            {g.label}
                            <span className="ml-2 text-xs font-normal text-gray-500">
                              ({g.rows.length})
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">{dr(g.openingDr)}</td>
                        <td className="px-4 py-2 text-right">{cr(-g.openingCr)}</td>
                        <td className="px-4 py-2 text-right">{fmtCurrency(g.periodDr)}</td>
                        <td className="px-4 py-2 text-right">{fmtCurrency(g.periodCr)}</td>
                        <td className="px-4 py-2 text-right">{fmtCurrency(g.debit)}</td>
                        <td className="px-4 py-2 text-right">{fmtCurrency(g.credit)}</td>
                      </tr>
                      {!isCollapsed &&
                        g.rows.map((r) => (
                          <tr
                            key={r.id}
                            className="border-b dark:border-gray-700 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 cursor-pointer"
                            onClick={() => openLedger(r)}
                          >
                            <td className="px-4 py-2 pl-10">
                              <div className="font-medium text-gray-900 dark:text-gray-100">
                                {r.name}
                              </div>
                              <div className="text-xs text-gray-500 font-mono">{r.accountNumber}</div>
                            </td>
                            <td className="px-4 py-2 text-right">{dr(r.openingBalance)}</td>
                            <td className="px-4 py-2 text-right">{cr(r.openingBalance)}</td>
                            <td className="px-4 py-2 text-right">
                              {r.totalDebits > 0 ? fmtCurrency(r.totalDebits) : ''}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {r.totalCredits > 0 ? fmtCurrency(r.totalCredits) : ''}
                            </td>
                            <td className="px-4 py-2 text-right font-medium">
                              {dr(r.closingBalance)}
                            </td>
                            <td className="px-4 py-2 text-right font-medium">
                              {cr(r.closingBalance)}
                            </td>
                          </tr>
                        ))}
                    </>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-100 dark:bg-gray-700/60 font-bold">
                <tr>
                  <td className="px-4 py-3">Grand Total</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(totalOpeningDr)}</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(totalOpeningCr)}</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(totalPeriodDr)}</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(totalPeriodCr)}</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(totalClosingDr)}</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(totalClosingCr)}</td>
                </tr>
                {!isBalanced && (
                  <tr>
                    <td colSpan={7} className="px-4 py-2 text-right text-red-600 text-xs">
                      Imbalance: {fmtCurrency(closingDiff)} — investigate journal posting errors.
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>
      </Card>

      <Modal
        isOpen={showLedger}
        onClose={() => {
          setShowLedger(false);
          setSelectedAccount(null);
          ledgerGrid.resetAll();
        }}
        title={
          ledger.data
            ? `Account Ledger: ${ledger.data.account.accountNumber} - ${ledger.data.account.name}`
            : 'Account Ledger'
        }
        size="full"
      >
        {ledger.data && (
          <div className="space-y-4">
            <DetailPopupActions
              title="Account Ledger"
              documentNumber={`${ledger.data.account.accountNumber} - ${ledger.data.account.name}`}
              fields={[
                { label: 'Account Number', value: ledger.data.account.accountNumber },
                { label: 'Account Name', value: ledger.data.account.name },
                { label: 'Account Type', value: ledger.data.account.accountType },
                { label: 'Normal Balance', value: ledger.data.account.normalBalance },
                { label: 'Opening Balance', value: fmtCurrency(ledger.data.openingBalance) },
                { label: 'Lines (filtered)', value: fmt(ledger.data.total) },
                { label: 'Window', value: startDate || endDate ? `${fmtDate(startDate)} – ${fmtDate(endDate)}` : 'All-time' },
              ]}
              tables={ledger.data.rows.length ? [{
                title: 'Journal Lines',
                columns: [
                  { key: 'entryDate', header: 'Date' },
                  { key: 'entryNumber', header: 'Entry #' },
                  { key: 'description', header: 'Description' },
                  { key: 'referenceType', header: 'Ref Type' },
                  { key: 'debitAmount', header: 'Debit', align: 'right' as const },
                  { key: 'creditAmount', header: 'Credit', align: 'right' as const },
                  { key: 'runningBalance', header: 'Running', align: 'right' as const },
                ],
                rows: ledger.data.rows.map((row) => ({
                  entryDate: fmtDate(row.entryDate),
                  entryNumber: row.entryNumber,
                  description: row.description ?? '—',
                  referenceType: row.referenceType ?? '—',
                  debitAmount: row.debitAmount > 0 ? fmtCurrency(row.debitAmount) : '—',
                  creditAmount: row.creditAmount > 0 ? fmtCurrency(row.creditAmount) : '—',
                  runningBalance: fmtCurrency(row.runningBalance),
                })),
              }] : []}
              totals={[
                { label: 'Opening Balance', value: fmtCurrency(ledger.data.openingBalance) },
              ]}
            />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
              <MetricCard
                label="Opening Balance"
                value={fmtCurrency(ledger.data.openingBalance)}
                valueClassName={ledger.data.openingBalance < 0 ? 'text-red-600' : 'text-gray-900'}
              />
              <MetricCard label="Lines (filtered)" value={fmt(ledger.data.total)} />
              <MetricCard
                label="Account Type"
                value={ledger.data.account.accountType}
                subtext={`Normal balance: ${ledger.data.account.normalBalance}`}
              />
              <MetricCard
                label="Window"
                value={
                  startDate || endDate
                    ? `${fmtDate(startDate)} – ${fmtDate(endDate)}`
                    : 'All-time'
                }
                subtext="Inherits trial-balance filters"
              />
            </div>

            {ledger.isError && (
              <QueryErrorBanner error={ledger.error} onRetry={() => ledger.refetch()} />
            )}

            <DataTable<AccountLedgerRow>
              data={ledger.data.rows}
              columns={ledgerColumns}
              keyExtractor={(row) => row.lineId}
              isLoading={ledger.isLoading}
              emptyMessage="No journal lines in this window"
              sorting={ledgerGrid.sortingProps}
              filtering={ledgerGrid.filteringProps}
              pagination={ledgerGrid.paginationProps(ledger.data.total)}
            />

            <div className="flex items-center justify-end text-xs text-gray-500 gap-2 pt-2 border-t dark:border-gray-700">
              <ScaleIcon className="h-4 w-4" />
              Running balance computed from opening + cumulative (debit − credit) across this window.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
