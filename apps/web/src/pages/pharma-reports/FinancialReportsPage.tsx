import { BanknotesIcon, BookOpenIcon, ChartBarIcon, RectangleGroupIcon } from '@heroicons/react/24/outline';
import type { ElementType } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PieChart } from '../../components/charts';
import { DetailPopupActions } from '../../components/reports/DetailPopupActions';
import type { Column } from '../../components/ui';
import { Badge, Button, Card, CardHeader, DataTable, QueryErrorBanner } from '../../components/ui';
import { usePdfPayload } from '../../hooks/usePdfPayload';
import { usePharmaGrid } from '../../hooks/usePharmaGrid';
import {
  useFinancialOutstanding,
  useFinancialOutstandingByGroup,
  useFinancialOutstandingDetail,
  useFinancialPartyLedger,
} from '../../hooks/usePharmaReports';
import type {
  FinancialBucketDefinition,
  FinancialLedgerTransactionRow,
  FinancialOutstandingGroupRow,
  FinancialOutstandingInvoiceRow,
  FinancialOutstandingPartyRow,
  FinancialPartyType,
  FinancialTopOverdueRow,
} from '../../services/api/pharma-reports.service';
import ExportToolbar from './ExportToolbar';
import { fmt, fmtCurrency, fmtDate } from './shared';

type ReportTab = 'summary' | 'group' | 'outstanding' | 'ledger';

type InvoiceTableRow = FinancialOutstandingInvoiceRow & { rowKey: string };
type LedgerTableRow = FinancialLedgerTransactionRow & { rowKey: string };

const partyTypeOptions: { key: FinancialPartyType; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'CUSTOMER', label: 'Receivables' },
  { key: 'SUPPLIER', label: 'Payables' },
];

const reportTabs: { key: ReportTab; label: string; icon: ElementType }[] = [
  { key: 'summary', label: 'Outstanding', icon: ChartBarIcon },
  { key: 'group', label: 'By Group', icon: RectangleGroupIcon },
  { key: 'outstanding', label: 'Party Outstanding', icon: BanknotesIcon },
  { key: 'ledger', label: 'Party Ledger', icon: BookOpenIcon },
];

function fmtAmount(value: number | null | undefined) {
  if (value == null) return '-';
  const sign = value < 0 ? '-' : '';
  return `${sign}${fmtCurrency(Math.abs(value))}`;
}

function amountClass(value: number | null | undefined) {
  if (!value) return 'text-gray-900';
  return value < 0 ? 'text-red-600' : 'text-gray-900';
}

function bucketLabel(bucket: FinancialOutstandingInvoiceRow['bucket']) {
  switch (bucket) {
    case 'CURRENT':
      return '0-30';
    case 'DAYS_31_60':
      return '31-60';
    case 'DAYS_61_90':
      return '61-90';
    default:
      return '91+';
  }
}

/**
 * Industry-standard ageing presets. "Custom" lets the user type a CSV of
 * thresholds; the rest map to fixed boundaries the report sends as
 * `bucketBoundaries` to the backend. The labels match what CFOs / auditors
 * recognise (e.g., "Pharma 5-bucket" = pharma distributor convention).
 */
const BUCKET_PRESETS = [
  { id: 'standard', label: 'Standard (30 / 60 / 90)', boundaries: '30,60,90' },
  { id: 'pharma5', label: 'Pharma 5-bucket (30 / 60 / 90 / 180)', boundaries: '30,60,90,180' },
  { id: 'strict', label: 'Strict (15 / 30 / 60 / 90)', boundaries: '15,30,60,90' },
  { id: 'tight', label: 'Tight (7 / 15 / 30 / 60 / 90)', boundaries: '7,15,30,60,90' },
  { id: 'extended', label: 'Extended (30 / 60 / 90 / 180 / 365)', boundaries: '30,60,90,180,365' },
  { id: 'custom', label: 'Custom…', boundaries: '' },
] as const;

type BucketPresetId = (typeof BUCKET_PRESETS)[number]['id'];

/** Visualisation palette — bucket 0 (current) is healthy green; aged buckets escalate to red. */
const BUCKET_PALETTE = ['#10B981', '#22C55E', '#FACC15', '#F97316', '#EF4444', '#B91C1C', '#7F1D1D', '#475569'];

function bucketColor(index: number): string {
  return BUCKET_PALETTE[Math.min(index, BUCKET_PALETTE.length - 1)];
}

function pctOfTotal(part: number, whole: number): string {
  if (!whole || whole === 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function partyTypeLabel(row: FinancialOutstandingPartyRow) {
  const group = (row.groupCode ?? '').toUpperCase();
  if (group.startsWith('C')) return { label: 'Customer', variant: 'success' as const };
  if (group.startsWith('D')) return { label: 'Supplier', variant: 'warning' as const };
  return { label: 'Other', variant: 'secondary' as const };
}

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
      <p className="text-[10px] lg:text-xs font-semibold uppercase tracking-wide text-gray-500 truncate">{label}</p>
      <p className={`mt-1 text-sm lg:text-lg font-bold truncate ${valueClassName}`}>{value}</p>
      {subtext && <p className="mt-1 text-xs text-gray-500">{subtext}</p>}
    </Card>
  );
}

export default function FinancialReportsPage() {
  const [searchParams] = useSearchParams();
  const requestedPartyType = searchParams.get('partyType');
  const initialPartyType: FinancialPartyType =
    requestedPartyType === 'CUSTOMER' || requestedPartyType === 'SUPPLIER' || requestedPartyType === 'ALL'
      ? requestedPartyType
      : 'ALL';
  const requestedView = searchParams.get('view');
  const queryReportTab: ReportTab =
    requestedView === 'ledger'
      ? 'ledger'
      : requestedView === 'outstanding'
        ? 'outstanding'
        : requestedView === 'group'
          ? 'group'
          : 'summary';

  const [partyType, setPartyType] = useState<FinancialPartyType>(initialPartyType);
  const [selectedParty, setSelectedParty] = useState<FinancialOutstandingPartyRow | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>(queryReportTab);
  const [includeSettled, setIncludeSettled] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Aging configuration — drives both summary and detail queries. Defaults
  // preserve current behaviour (no asOf override, standard 30/60/90 buckets,
  // 90-day DSO window).
  const [asOfDate, setAsOfDate] = useState<string>('');
  const [bucketPresetId, setBucketPresetId] = useState<BucketPresetId>('standard');
  const [customBoundaries, setCustomBoundaries] = useState<string>('30,60,90,180');
  const [dsoDays, setDsoDays] = useState<number>(90);
  /** Active bucket-cell drill: when set, the detail view is filtered to the bucket. */
  const [activeBucketIndex, setActiveBucketIndex] = useState<number | null>(null);

  const bucketBoundariesParam = useMemo<string>(() => {
    if (bucketPresetId === 'custom') return customBoundaries.trim();
    return BUCKET_PRESETS.find((p) => p.id === bucketPresetId)?.boundaries ?? '30,60,90';
  }, [bucketPresetId, customBoundaries]);

  const summaryGrid = usePharmaGrid({ initialSortBy: 'totalOutstanding', initialSortOrder: 'desc', initialPageSize: 25 });
  const groupGrid = usePharmaGrid({ initialSortBy: 'totalOutstanding', initialSortOrder: 'desc', initialPageSize: 25 });
  const invoiceGrid = usePharmaGrid({ initialSortBy: 'date', initialSortOrder: 'asc', initialPageSize: 50 });
  const ledgerGrid = usePharmaGrid({ initialPageSize: 50 });

  const outstanding = useFinancialOutstanding({
    ...summaryGrid.pharmaParams,
    partyType,
    asOfDate: asOfDate || undefined,
    bucketBoundaries: bucketBoundariesParam || undefined,
    dsoDays,
  });

  // Run only when active so the group rollup doesn't burn DB cycles when the
  // user is on another tab. Same aging context as the by-party view so the
  // two reconcile to the kopeck.
  const outstandingGroups = useFinancialOutstandingByGroup(
    {
      ...groupGrid.pharmaParams,
      partyType,
      asOfDate: asOfDate || undefined,
      bucketBoundaries: bucketBoundariesParam || undefined,
    },
    activeTab === 'group',
  );

  useEffect(() => {
    setSelectedParty(null);
    setActiveBucketIndex(null);
  }, [partyType]);

  // When the user switches buckets/preset/asOf, the detail view's filter is
  // no longer meaningful — clear the bucket drill so we don't show a stale
  // chip referring to a bucket that doesn't exist.
  useEffect(() => {
    setActiveBucketIndex(null);
  }, [bucketBoundariesParam, asOfDate]);

  useEffect(() => {
    if (requestedPartyType === 'CUSTOMER' || requestedPartyType === 'SUPPLIER' || requestedPartyType === 'ALL') {
      setPartyType(requestedPartyType);
    }
    setActiveTab(queryReportTab);
  }, [requestedPartyType, queryReportTab]);

  useEffect(() => {
    if (!selectedParty && outstanding.data?.rows.length) {
      setSelectedParty(outstanding.data.rows[0]);
    }
  }, [outstanding.data?.rows, selectedParty]);

  const selectedPartyCode = selectedParty?.partyCode;
  const selectedCompanyId = selectedParty?.companyId;

  const outstandingDetail = useFinancialOutstandingDetail(
    selectedPartyCode,
    {
      ...invoiceGrid.pharmaParams,
      companyId: selectedCompanyId,
      includeSettled,
      asOfDate: asOfDate || undefined,
      bucketBoundaries: bucketBoundariesParam || undefined,
      bucketIndex: activeBucketIndex ?? undefined,
    },
    activeTab === 'outstanding',
  );

  const ledger = useFinancialPartyLedger(
    selectedPartyCode,
    {
      ...ledgerGrid.pharmaParams,
      companyId: selectedCompanyId,
      fromDate,
      toDate,
    },
    activeTab === 'ledger',
  );

  const invoiceRows = useMemo<InvoiceTableRow[]>(
    () => (outstandingDetail.data?.invoices ?? []).map((row, index) => ({
      ...row,
      rowKey: `${row.voucher ?? 'no-voucher'}-${row.sVoucher ?? 'no-svoucher'}-${row.vcn ?? 'no-vcn'}-${row.date}-${index}`,
    })),
    [outstandingDetail.data?.invoices],
  );

  const ledgerRows = useMemo<LedgerTableRow[]>(
    () => (ledger.data?.transactions ?? []).map((row, index) => ({
      ...row,
      rowKey: `${row.date}-${row.voucher ?? 'no-voucher'}-${row.counterpartyCode ?? 'no-counterparty'}-${index}`,
    })),
    [ledger.data?.transactions],
  );

  const selectedRowKey = selectedParty
    ? `${selectedParty.companyId}-${selectedParty.partyCode}-${selectedParty.groupCode ?? ''}`
    : null;

  const summary = outstanding.data?.summary;
  // Forward the active aging context into export filters so a CSV/XLSX export
  // matches the on-screen scheme — preventing the "30/60/90 headers + 15/30/60
  // values" mismatch that an audit reviewer would call out.
  const exportConfig =
    activeTab === 'summary'
      ? {
          reportType: 'financial-outstanding',
          filters: {
            ...summaryGrid.pharmaParams,
            partyType,
            asOfDate: asOfDate || undefined,
            bucketBoundaries: bucketBoundariesParam || undefined,
            dsoDays,
          },
          disabled: false,
        }
      : activeTab === 'group'
        ? {
            reportType: 'financial-outstanding-groups',
            filters: {
              ...groupGrid.pharmaParams,
              partyType,
              asOfDate: asOfDate || undefined,
              bucketBoundaries: bucketBoundariesParam || undefined,
            },
            disabled: false,
          }
        : activeTab === 'outstanding'
          ? {
              reportType: 'financial-outstanding-detail',
              filters: {
                ...invoiceGrid.pharmaParams,
                partyCode: selectedPartyCode,
                companyId: selectedCompanyId,
                includeSettled,
                asOfDate: asOfDate || undefined,
                bucketBoundaries: bucketBoundariesParam || undefined,
                bucketIndex: activeBucketIndex ?? undefined,
              },
              disabled: !selectedPartyCode,
            }
          : {
              reportType: 'financial-party-ledger',
              filters: {
                ...ledgerGrid.pharmaParams,
                partyCode: selectedPartyCode,
                companyId: selectedCompanyId,
                fromDate,
                toDate,
              },
              disabled: !selectedPartyCode,
            };
  const activeQuery =
    activeTab === 'summary'
      ? outstanding
      : activeTab === 'group'
        ? outstandingGroups
        : activeTab === 'outstanding'
          ? outstandingDetail
          : ledger;
  const activeGrid =
    activeTab === 'summary'
      ? summaryGrid
      : activeTab === 'group'
        ? groupGrid
        : activeTab === 'outstanding'
          ? invoiceGrid
          : ledgerGrid;
  const hasActiveViewState = activeGrid.hasActiveControls
    || (activeTab === 'outstanding' && includeSettled)
    || (activeTab === 'ledger' && (fromDate !== '' || toDate !== ''));
  const resetActiveView = () => {
    activeGrid.resetAll();
    if (activeTab === 'outstanding') {
      setIncludeSettled(false);
    }
    if (activeTab === 'ledger') {
      setFromDate('');
      setToDate('');
    }
  };

  const bucketDefs: FinancialBucketDefinition[] = outstanding.data?.bucketDefinitions ?? [];
  const groupBucketDefs: FinancialBucketDefinition[] = outstandingGroups.data?.bucketDefinitions ?? bucketDefs;

  /**
   * Drill from a group rollup row into the by-party view, automatically
   * filtering the party table to the chosen group. We use the public
   * `summaryGrid.filteringProps.onFilterChange` API so the chip / clear
   * controls in the column-filter UI work the same as if the user had typed
   * the filter manually.
   */
  const drillIntoGroup = (row: FinancialOutstandingGroupRow) => {
    const groupKey = row.groupName ?? row.groupCode ?? '';
    if (groupKey) {
      summaryGrid.filteringProps.onFilterChange('groupName', 'equals', groupKey);
    }
    setSelectedParty(null);
    setActiveBucketIndex(null);
    setActiveTab('summary');
  };

  /** Open the detail view for a party, optionally pre-filtered to a bucket cell. */
  const openPartyAtBucket = (row: FinancialOutstandingPartyRow, bucketIndex: number | null) => {
    setSelectedParty(row);
    setActiveBucketIndex(bucketIndex);
    setActiveTab('outstanding');
  };

  const partyCols: Column<FinancialOutstandingPartyRow>[] = [
    {
      key: 'partyName',
      header: 'Party',
      sortable: true,
      filterType: 'text',
      filterField: 'partyName',
      accessor: (row) => {
        const badge = partyTypeLabel(row);
        return (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{row.partyName ?? row.partyCode}</span>
              <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
            </div>
            <div className="text-xs text-gray-500">{row.partyCode}</div>
          </div>
        );
      },
    },
    // { key: 'companyId', header: 'Company', accessor: (row) => row.companyId, align: 'right', width: '80px', sortable: true },
    { key: 'groupName', header: 'Group', accessor: (row) => row.groupName ?? row.groupCode ?? '-', width: '150px', sortable: true, filterType: 'text', filterField: 'groupName' },
    { key: 'openInvoiceCount', header: 'Open Bills', accessor: (row) => fmt(row.openInvoiceCount), align: 'right', sortable: true, filterType: 'number', filterField: 'openInvoiceCount' },
    {
      key: 'totalOutstanding',
      header: 'Outstanding',
      accessor: (row) => <span className={`font-semibold ${amountClass(row.totalOutstanding)}`}>{fmtAmount(row.totalOutstanding)}</span>,
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'totalOutstanding',
    },
    {
      key: 'creditBalance',
      header: 'Credit / Advance',
      accessor: (row) => fmtAmount(row.creditBalance),
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'creditBalance',
    },
    {
      key: 'pdLess',
      header: 'PD',
      accessor: (row) => (row.pdLess ? fmtAmount(row.pdLess) : '—'),
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'pdLess',
    },
    // Dynamic bucket columns. Each cell is a clickable button that opens the
    // detail view filtered to that bucket — saves the user a manual filter step.
    // Filter mapping: legacy fields back the first three buckets in any scheme;
    // for index 3+ the legacy "91+" field is the bundled tail, so we only enable
    // filtering on those buckets when the active scheme has exactly 4 buckets
    // (otherwise filter semantics would be lossy).
    ...bucketDefs.map<Column<FinancialOutstandingPartyRow>>((def, idx) => {
      const legacyFilterField =
        idx === 0
          ? 'currentBucket'
          : idx === 1
            ? 'days31To60'
            : idx === 2
              ? 'days61To90'
              : idx === 3 && bucketDefs.length === 4
                ? 'days91Plus'
                : undefined;
      return {
        key: `bucket_${idx}`,
        header: def.label,
        align: 'right',
        sortable: legacyFilterField !== undefined,
        filterType: legacyFilterField ? 'number' : undefined,
        filterField: legacyFilterField,
        accessor: (row) => {
          const value = row.bucketAmounts?.[idx] ?? 0;
          if (!value) return <span className="text-gray-400">—</span>;
          return (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openPartyAtBucket(row, idx);
              }}
              className="font-semibold text-primary-700 underline-offset-2 hover:underline"
              title={`Drill to ${def.label} bills for ${row.partyName ?? row.partyCode}`}
            >
              {fmtAmount(value)}
            </button>
          );
        },
      };
    }),
    {
      key: 'avgDaysOutstanding',
      header: 'Avg Days',
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'avgDaysOutstanding',
      accessor: (row) =>
        row.avgDaysOutstanding == null ? (
          <span className="text-gray-400">—</span>
        ) : (
          <span className={row.avgDaysOutstanding > 90 ? 'text-red-600 font-medium' : ''}>
            {row.avgDaysOutstanding.toFixed(0)}d
          </span>
        ),
      width: '90px',
    },
    { key: 'lastInvoiceDate', header: 'Last Bill', accessor: (row) => fmtDate(row.lastInvoiceDate), width: '120px', sortable: true, filterType: 'date', filterField: 'lastInvoiceDate' },
  ];

  const invoiceCols: Column<InvoiceTableRow>[] = [
    { key: 'date', header: 'Date', accessor: (row) => fmtDate(row.date), width: '120px', sortable: true, filterType: 'date', filterField: 'date' },
    { key: 'vcn', header: 'VCN', accessor: (row) => row.vcn ?? '-', width: '120px', sortable: true, filterType: 'text', filterField: 'vcn' },
    { key: 'voucher', header: 'Voucher', accessor: (row) => row.voucher ?? row.sVoucher ?? '-', width: '130px', sortable: true, filterType: 'text', filterField: 'voucher' },
    { key: 'days', header: 'Days', accessor: (row) => fmt(row.days), align: 'right', width: '80px', sortable: true, filterType: 'number', filterField: 'days' },
    {
      key: 'bucket',
      header: 'Bucket',
      accessor: (row) => (
        <Badge variant={row.bucket === 'DAYS_91_PLUS' ? 'error' : row.bucket === 'DAYS_61_90' ? 'warning' : 'secondary'} size="sm">
          {bucketLabel(row.bucket)}
        </Badge>
      ),
      width: '100px',
      filterType: 'select',
      filterField: 'bucket',
      filterOptions: [
        { value: 'CURRENT', label: '0-30' },
        { value: 'DAYS_31_60', label: '31-60' },
        { value: 'DAYS_61_90', label: '61-90' },
        { value: 'DAYS_91_PLUS', label: '91+' },
      ],
    },
    { key: 'finalAmt', header: 'Bill Amount', accessor: (row) => fmtAmount(row.finalAmt), align: 'right', sortable: true, filterType: 'number', filterField: 'finalAmt' },
    { key: 'pdLess', header: 'PD Less', accessor: (row) => fmtAmount(row.pdLess), align: 'right', sortable: true, filterType: 'number', filterField: 'pdLess' },
    {
      key: 'balance',
      header: 'Balance',
      accessor: (row) => <span className={`font-semibold ${amountClass(row.balance)}`}>{fmtAmount(row.balance)}</span>,
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'balance',
    },
  ];

  const ledgerCols: Column<LedgerTableRow>[] = [
    { key: 'date', header: 'Date', accessor: (row) => fmtDate(row.date), width: '120px', sortable: true, filterType: 'date', filterField: 'date' },
    {
      key: 'bookName',
      header: 'Book',
      sortable: true,
      filterType: 'text',
      filterField: 'bookName',
      accessor: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.bookName ?? row.book ?? '-'}</div>
          {row.book && <div className="text-xs text-gray-500">{row.book}</div>}
        </div>
      ),
      width: '130px',
    },
    {
      key: 'voucher',
      header: 'Voucher',
      sortable: true,
      filterType: 'text',
      filterField: 'voucher',
      accessor: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.vcn ?? row.voucher ?? '-'}</div>
          {row.vcn && row.voucher && <div className="text-xs text-gray-500">{row.voucher}</div>}
        </div>
      ),
      width: '140px',
    },
    {
      key: 'counterpartyName',
      header: 'Particulars',
      sortable: true,
      filterType: 'text',
      filterField: 'counterpartyName',
      accessor: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.counterpartyName ?? row.counterpartyCode ?? '-'}</div>
          {row.counterpartyName && row.counterpartyCode && <div className="text-xs text-gray-500">{row.counterpartyCode}</div>}
        </div>
      ),
    },
    { key: 'remark', header: 'Remark', accessor: (row) => row.remark ?? '-', className: 'max-w-xs truncate', filterType: 'text', filterField: 'remark' },
    { key: 'debit', header: 'Debit', accessor: (row) => row.debit ? fmtAmount(row.debit) : '-', align: 'right', sortable: true, filterType: 'number', filterField: 'debit' },
    { key: 'credit', header: 'Credit', accessor: (row) => row.credit ? fmtAmount(row.credit) : '-', align: 'right', sortable: true, filterType: 'number', filterField: 'credit' },
    {
      key: 'runningBalance',
      header: 'Running Balance',
      accessor: (row) => <span className={`font-semibold ${amountClass(row.runningBalance)}`}>{fmtAmount(row.runningBalance)}</span>,
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'runningBalance',
    },
  ];

  const pdfColumns = (() => {
    if (activeTab === 'summary') return partyCols.map((c) => ({ key: c.key, header: c.header, align: c.align }));
    if (activeTab === 'outstanding') return invoiceCols.map((c) => ({ key: c.key, header: c.header, align: c.align }));
    if (activeTab === 'ledger') return ledgerCols.map((c) => ({ key: c.key, header: c.header, align: c.align }));
    // 'group' tab uses inline columns — provide minimal set
    return [
      { key: 'groupName', header: 'Group' },
      { key: 'partyCount', header: 'Parties', align: 'right' as const },
      { key: 'openInvoiceCount', header: 'Open Bills', align: 'right' as const },
      { key: 'totalOutstanding', header: 'Outstanding', align: 'right' as const },
      { key: 'creditBalance', header: 'Credit / Advance', align: 'right' as const },
      { key: 'avgDaysOutstanding', header: 'Avg Days', align: 'right' as const },
    ];
  })();

  const pdfData = useMemo<Record<string, unknown>[]>(() => {
    if (activeTab === 'summary') return (outstanding.data?.rows ?? []) as unknown as Record<string, unknown>[];
    if (activeTab === 'group') return (outstandingGroups.data?.rows ?? []) as unknown as Record<string, unknown>[];
    if (activeTab === 'outstanding') return invoiceRows as unknown as Record<string, unknown>[];
    if (activeTab === 'ledger') return ledgerRows as unknown as Record<string, unknown>[];
    return [];
  }, [activeTab, outstanding.data, outstandingGroups.data, invoiceRows, ledgerRows]);

  const pdfPayload = usePdfPayload({
    title: reportTabs.find((t) => t.key === activeTab)?.label ?? 'Financial Report',
    reportKey: exportConfig.reportType,
    columns: pdfColumns,
    data: pdfData,
    filters: exportConfig.filters,
    exportMode: 'current-page',
  });

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Financial Reports</h1>
          <p className="mt-1 text-sm text-gray-500">Marg-backed outstanding, party-wise ageing, and Tally-style ledgers.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ExportToolbar
            reportType={exportConfig.reportType}
            filters={exportConfig.filters}
            pdfPayload={pdfPayload}
            disabled={exportConfig.disabled}
            onRefresh={() => void activeQuery.refetch()}
            isRefreshing={activeQuery.isFetching}
            onResetView={resetActiveView}
            hasActiveViewState={hasActiveViewState}
          />
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
            {partyTypeOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setPartyType(option.key)}
                className={`px-3 py-2 text-sm font-medium ${
                  partyType === option.key
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {outstanding.isError && <QueryErrorBanner error={outstanding.error} />}

      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="-mb-px flex gap-4 lg:gap-6 min-w-max" aria-label="Financial report tabs">
          {reportTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Aging configuration — shared by Outstanding and By Group tabs so the
          two views always reconcile to identical numbers under the same anchor. */}
      {(activeTab === 'summary' || activeTab === 'group') && (
        <Card padding="sm">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="label">As Of Date</label>
              <input
                type="date"
                className="input"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
              <div className="mt-1 text-xs text-gray-500">
                {asOfDate ? `Aged as of ${fmtDate(asOfDate)}` : 'Live (today)'}
              </div>
            </div>
            <div>
              <label className="label">Aging buckets</label>
              <select
                className="input"
                value={bucketPresetId}
                onChange={(e) => setBucketPresetId(e.target.value as BucketPresetId)}
              >
                {BUCKET_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Custom thresholds (CSV)</label>
              <input
                type="text"
                className="input"
                value={customBoundaries}
                placeholder="e.g. 30,60,90,180"
                disabled={bucketPresetId !== 'custom'}
                onChange={(e) => setCustomBoundaries(e.target.value)}
              />
              <div className="mt-1 text-xs text-gray-500">Strictly ascending, max 10 thresholds.</div>
            </div>
            <div>
              <label className="label">DSO window (days)</label>
              <input
                type="number"
                className="input"
                min={7}
                max={365}
                value={dsoDays}
                onChange={(e) => setDsoDays(Math.max(7, Math.min(365, Number(e.target.value) || 90)))}
              />
              <div className="mt-1 text-xs text-gray-500">Window for credit-sales lookback.</div>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'summary' && (
        <>
          {summary && (
            <>
              {/* Portfolio KPIs — the at-a-glance row that a CFO scans first. */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <MetricCard label="Parties" value={fmt(summary.partyCount)} subtext={`${fmt(summary.openInvoiceCount)} open bills`} />
                <MetricCard
                  label="Outstanding"
                  value={fmtAmount(summary.totalOutstanding)}
                  valueClassName={amountClass(summary.totalOutstanding)}
                />
                <MetricCard label="Credit / Advance" value={fmtAmount(summary.creditBalance)} />
                <MetricCard
                  label="PD Cheques"
                  value={fmtAmount(summary.pdLessTotal)}
                  subtext="Post-dated payments held"
                />
                <MetricCard
                  label="DSO"
                  value={summary.dso ? `${summary.dso.days.toFixed(1)} days` : '—'}
                  subtext={
                    summary.dso
                      ? `${dsoDays}d window · ${fmtAmount(summary.dso.totalCreditSales)} credit sales`
                      : partyType === 'SUPPLIER'
                        ? 'N/A for payables'
                        : 'No credit sales / receivables in window'
                  }
                  valueClassName={
                    summary.dso ? (summary.dso.days > 90 ? 'text-red-600' : summary.dso.days > 60 ? 'text-amber-600' : 'text-green-600') : 'text-gray-900'
                  }
                />
                <MetricCard
                  label="As Of"
                  value={fmtDate(outstanding.data?.asOf)}
                  subtext={outstanding.data?.asOfExplicit ? 'Backdated snapshot' : 'Live'}
                />
              </div>

              {/* Bucket KPI strip — dynamic per the configured boundaries. Each card
                  shows amount + % share so health is visible without doing math. */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                {bucketDefs.map((def, idx) => {
                  const value = summary.bucketTotals[idx] ?? 0;
                  const totalAged = summary.bucketTotals.reduce((a, b) => a + b, 0);
                  return (
                    <Card key={def.key} padding="sm">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] lg:text-xs font-semibold uppercase tracking-wide text-gray-500 truncate">{def.label}</p>
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: bucketColor(idx) }}
                        />
                      </div>
                      <p
                        className={`mt-2 text-lg font-bold ${idx >= 2 && value > 0 ? 'text-red-600' : 'text-gray-900'}`}
                      >
                        {fmtAmount(value)}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {pctOfTotal(value, totalAged)} of total
                      </p>
                    </Card>
                  );
                })}
              </div>

              {/* Visual + Top Overdue side-by-side. */}
              {summary.totalOutstanding > 0 && (
                <div className="grid grid-cols-1 gap-4 lg:gap-6 lg:grid-cols-2 xl:grid-cols-3">
                  <Card>
                    <CardHeader
                      title="Aging Composition"
                      description="Share of total outstanding per bucket — green is healthy, red is overdue."
                    />
                    <PieChart
                      data={bucketDefs.map((def, idx) => ({
                        name: def.label,
                        value: summary.bucketTotals[idx] ?? 0,
                        color: bucketColor(idx),
                      }))}
                      height={260}
                    />
                  </Card>
                  <Card padding="none" className="xl:col-span-2">
                    <CardHeader
                      title="Top 10 Most-Overdue"
                      description="Largest exposure outside the current bucket — your collection priority list."
                      className="px-6 pt-6"
                    />
                    <DataTable<FinancialTopOverdueRow>
                      data={summary.topOverdue}
                      columns={[
                        {
                          key: 'partyName',
                          header: 'Party',
                          accessor: (row) => (
                            <button
                              type="button"
                              className="font-medium text-primary-700 underline-offset-2 hover:underline"
                              onClick={() => {
                                // Synthesize a selection so the detail view loads.
                                const parent = outstanding.data?.rows.find(
                                  (r) => r.companyId === row.companyId && r.partyCode === row.partyCode,
                                );
                                if (parent) openPartyAtBucket(parent, null);
                              }}
                            >
                              {row.partyName ?? row.partyCode}
                            </button>
                          ),
                        },
                        // { key: 'companyId', header: 'Co.', accessor: (row) => row.companyId, align: 'right', width: '70px' },
                         {
                          key: 'overdueAmount',
                          header: 'Overdue',
                          accessor: (row) => (
                            <span className="font-semibold text-red-600">{fmtAmount(row.overdueAmount)}</span>
                          ),
                          align: 'right',
                        },
                        {
                          key: 'totalOutstanding',
                          header: 'Total Outstanding',
                          accessor: (row) => fmtAmount(row.totalOutstanding),
                          align: 'right',
                        },
                        {
                          key: 'overdueShare',
                          header: '% Overdue',
                          accessor: (row) => pctOfTotal(row.overdueAmount, row.totalOutstanding),
                          align: 'right',
                          width: '100px',
                        },
                      ]}
                      keyExtractor={(row) => `${row.companyId}-${row.partyCode}`}
                      emptyMessage="No overdue exposure — every bucket past current is empty."
                    />
                  </Card>
                </div>
              )}
            </>
          )}

          <Card padding="none">
            <CardHeader
              title="Outstanding Summary"
              description={`Party-wise open receivables and payables · ${bucketDefs.length} aging bucket${bucketDefs.length === 1 ? '' : 's'} · click a bucket cell to drill into its bills.`}
              className="px-6 pt-6"
            />
            <DataTable<FinancialOutstandingPartyRow>
              key={selectedRowKey ?? 'no-selected-party'}
              data={outstanding.data?.rows ?? []}
              columns={partyCols}
              keyExtractor={(row) => `${row.companyId}-${row.partyCode}-${row.groupCode ?? ''}`}
              isLoading={outstanding.isLoading}
              emptyMessage="No outstanding balances found"
              onRowClick={(row) => {
                setSelectedParty(row);
                setActiveBucketIndex(null);
                setActiveTab('outstanding');
              }}
              selectedRows={selectedRowKey ? [selectedRowKey] : []}
              sorting={summaryGrid.sortingProps}
              filtering={summaryGrid.filteringProps}
              pagination={summaryGrid.paginationProps(outstanding.data?.total ?? 0)}
            />
          </Card>
        </>
      )}

      {activeTab === 'group' && (
        <>
          {outstandingGroups.isError && <QueryErrorBanner error={outstandingGroups.error} />}

          {outstandingGroups.data && (
            <>
              {/* Portfolio KPIs rolled up across groups — these always reconcile
                  with the by-party tab since the same source rows feed both. */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <MetricCard
                  label="Groups"
                  value={fmt(outstandingGroups.data.total)}
                  subtext={`${fmt(outstandingGroups.data.grandTotals.partyCount)} parties · ${fmt(outstandingGroups.data.grandTotals.openInvoiceCount)} open bills`}
                />
                <MetricCard
                  label="Outstanding"
                  value={fmtAmount(outstandingGroups.data.grandTotals.totalOutstanding)}
                  valueClassName={amountClass(outstandingGroups.data.grandTotals.totalOutstanding)}
                />
                <MetricCard
                  label="Credit / Advance"
                  value={fmtAmount(outstandingGroups.data.grandTotals.creditBalance)}
                />
                <MetricCard
                  label="PD Cheques"
                  value={fmtAmount(outstandingGroups.data.grandTotals.pdLess)}
                  subtext="Post-dated payments held"
                />
                <MetricCard
                  label="Largest Group"
                  value={
                    outstandingGroups.data.rows[0]
                      ? outstandingGroups.data.rows[0].groupName ?? outstandingGroups.data.rows[0].groupCode ?? '—'
                      : '—'
                  }
                  subtext={
                    outstandingGroups.data.rows[0]
                      ? `${fmtAmount(outstandingGroups.data.rows[0].totalOutstanding)} outstanding`
                      : ''
                  }
                />
                <MetricCard
                  label="As Of"
                  value={fmtDate(outstandingGroups.data.asOf)}
                  subtext={outstandingGroups.data.asOfExplicit ? 'Backdated snapshot' : 'Live'}
                />
              </div>

              {/* Bucket strip — driven by the group rollup's own grand totals so
                  they always match the rollup table footer. */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                {groupBucketDefs.map((def, idx) => {
                  const value = outstandingGroups.data!.grandTotals.bucketTotals[idx] ?? 0;
                  const totalAged = outstandingGroups.data!.grandTotals.bucketTotals.reduce((a, b) => a + b, 0);
                  return (
                    <Card key={def.key} padding="sm">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] lg:text-xs font-semibold uppercase tracking-wide text-gray-500 truncate">{def.label}</p>
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: bucketColor(idx) }}
                        />
                      </div>
                      <p className={`mt-2 text-lg font-bold ${idx >= 2 && value > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {fmtAmount(value)}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">{pctOfTotal(value, totalAged)} of total</p>
                    </Card>
                  );
                })}
              </div>

              {outstandingGroups.data.grandTotals.totalOutstanding > 0 && (
                <Card>
                  <CardHeader
                    title="Aging Composition by Group"
                    description="Cross-group aging mix — same numbers as the Outstanding tab, grouped at a higher grain."
                  />
                  <PieChart
                    data={groupBucketDefs.map((def, idx) => ({
                      name: def.label,
                      value: outstandingGroups.data!.grandTotals.bucketTotals[idx] ?? 0,
                      color: bucketColor(idx),
                    }))}
                    height={260}
                  />
                </Card>
              )}
            </>
          )}

          <Card padding="none">
            <CardHeader
              title="Outstanding by Group"
              description={`Marg account-group rollup · ${groupBucketDefs.length} aging bucket${groupBucketDefs.length === 1 ? '' : 's'} · click a row to drill into its parties.`}
              className="px-6 pt-6"
            />
            <DataTable<FinancialOutstandingGroupRow>
              data={outstandingGroups.data?.rows ?? []}
              columns={[
                {
                  key: 'groupName',
                  header: 'Group',
                  sortable: true,
                  filterType: 'text',
                  filterField: 'groupName',
                  accessor: (row) => (
                    <div>
                      <div className="font-medium text-gray-900">{row.groupName ?? row.groupCode ?? 'Unmapped'}</div>
                      {row.groupCode && row.groupCode !== row.groupName && (
                        <div className="text-xs text-gray-500">{row.groupCode}</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'partyCount',
                  header: 'Parties',
                  align: 'right',
                  sortable: true,
                  filterType: 'number',
                  filterField: 'partyCount',
                  accessor: (row) => fmt(row.partyCount),
                },
                {
                  key: 'openInvoiceCount',
                  header: 'Open Bills',
                  align: 'right',
                  sortable: true,
                  filterType: 'number',
                  filterField: 'openInvoiceCount',
                  accessor: (row) => fmt(row.openInvoiceCount),
                },
                {
                  key: 'totalOutstanding',
                  header: 'Outstanding',
                  align: 'right',
                  sortable: true,
                  filterType: 'number',
                  filterField: 'totalOutstanding',
                  accessor: (row) => (
                    <span className={`font-semibold ${amountClass(row.totalOutstanding)}`}>
                      {fmtAmount(row.totalOutstanding)}
                    </span>
                  ),
                },
                {
                  key: 'creditBalance',
                  header: 'Credit / Advance',
                  align: 'right',
                  sortable: true,
                  filterType: 'number',
                  filterField: 'creditBalance',
                  accessor: (row) => fmtAmount(row.creditBalance),
                },
                {
                  key: 'pdLess',
                  header: 'PD',
                  align: 'right',
                  sortable: true,
                  filterType: 'number',
                  filterField: 'pdLess',
                  accessor: (row) => (row.pdLess ? fmtAmount(row.pdLess) : '—'),
                },
                ...groupBucketDefs.map<Column<FinancialOutstandingGroupRow>>((def, idx) => {
                  const legacyFilterField =
                    idx === 0
                      ? 'currentBucket'
                      : idx === 1
                        ? 'days31To60'
                        : idx === 2
                          ? 'days61To90'
                          : idx === 3 && groupBucketDefs.length === 4
                            ? 'days91Plus'
                            : undefined;
                  return {
                    key: `bucket_${idx}`,
                    header: def.label,
                    align: 'right',
                    sortable: legacyFilterField !== undefined,
                    filterType: legacyFilterField ? 'number' : undefined,
                    filterField: legacyFilterField,
                    accessor: (row) => {
                      const value = row.bucketAmounts?.[idx] ?? 0;
                      if (!value) return <span className="text-gray-400">—</span>;
                      return <span className="font-medium">{fmtAmount(value)}</span>;
                    },
                  };
                }),
                {
                  key: 'avgDaysOutstanding',
                  header: 'Avg Days',
                  align: 'right',
                  sortable: true,
                  filterType: 'number',
                  filterField: 'avgDaysOutstanding',
                  accessor: (row) =>
                    row.avgDaysOutstanding == null ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span className={row.avgDaysOutstanding > 90 ? 'text-red-600 font-medium' : ''}>
                        {row.avgDaysOutstanding.toFixed(0)}d
                      </span>
                    ),
                  width: '90px',
                },
                {
                  key: 'lastInvoiceDate',
                  header: 'Last Bill',
                  accessor: (row) => fmtDate(row.lastInvoiceDate),
                  width: '120px',
                  sortable: true,
                  filterType: 'date',
                  filterField: 'lastInvoiceDate',
                },
              ]}
              keyExtractor={(row) => `${row.groupCode ?? '__unmapped__'}`}
              isLoading={outstandingGroups.isLoading}
              emptyMessage="No outstanding balances grouped by Marg account group."
              onRowClick={(row) => drillIntoGroup(row)}
              sorting={groupGrid.sortingProps}
              filtering={groupGrid.filteringProps}
              pagination={groupGrid.paginationProps(outstandingGroups.data?.total ?? 0)}
            />
          </Card>
        </>
      )}

      {selectedParty && (activeTab === 'outstanding' || activeTab === 'ledger') && (
        <>
        <DetailPopupActions
          title={activeTab === 'outstanding' ? 'Party Outstanding' : 'Party Ledger'}
          documentNumber={selectedParty.partyCode}
          fields={[
            { label: 'Party', value: selectedParty.partyName ?? selectedParty.partyCode },
            { label: 'Party Code', value: selectedParty.partyCode },
            { label: 'Company', value: String(selectedParty.companyId) },
            { label: 'Group', value: selectedParty.groupName ?? selectedParty.groupCode },
            { label: 'Total Outstanding', value: fmtAmount(selectedParty.totalOutstanding) },
          ]}
        />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{selectedParty.partyName ?? selectedParty.partyCode}</h2>
            <p className="text-sm text-gray-500">
              {selectedParty.partyCode} | Company {selectedParty.companyId} | {selectedParty.groupName ?? selectedParty.groupCode ?? 'No group'}
              {asOfDate && (
                <>
                  {' · '}
                  <span className="font-medium text-amber-700">As of {fmtDate(asOfDate)}</span>
                </>
              )}
            </p>
          </div>

          {activeTab === 'outstanding' ? (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={includeSettled}
                onChange={(event) => setIncludeSettled(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Include settled bills
            </label>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">From</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">To</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </label>
              {(fromDate || toDate) && (
                <Button variant="ghost" size="sm" onClick={() => { setFromDate(''); setToDate(''); }}>
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>
        </>
      )}

      {activeTab === 'outstanding' && (
        <>
          {outstandingDetail.isError && <QueryErrorBanner error={outstandingDetail.error} />}

          {/* Active bucket-drill chip — visible when user opened the detail by
              clicking a bucket cell. One-click clear restores the full list. */}
          {activeBucketIndex !== null && outstandingDetail.data?.bucketDefinitions[activeBucketIndex] && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm">
              <span className="font-medium text-primary-900">
                Filtered to bucket: {outstandingDetail.data.bucketDefinitions[activeBucketIndex].label} days
              </span>
              <span className="text-primary-700">
                ({fmt(outstandingDetail.data.totals.openCount)} bills · {fmtAmount(outstandingDetail.data.totals.balance)})
              </span>
              <button
                type="button"
                onClick={() => setActiveBucketIndex(null)}
                className="ml-auto text-primary-700 hover:text-primary-900 underline-offset-2 hover:underline text-xs font-medium"
              >
                Clear bucket filter
              </button>
            </div>
          )}

          {outstandingDetail.data?.totals && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Bills" value={fmt(outstandingDetail.data.totals.openCount)} />
              <MetricCard label="Bill Amount" value={fmtAmount(outstandingDetail.data.totals.finalAmt)} />
              <MetricCard label="PD Less" value={fmtAmount(outstandingDetail.data.totals.pdLess)} />
              <MetricCard label="Balance" value={fmtAmount(outstandingDetail.data.totals.balance)} valueClassName={amountClass(outstandingDetail.data.totals.balance)} />
            </div>
          )}
          <Card padding="none">
            <CardHeader
              title="Party Outstanding"
              description="Invoice-wise ageing and open balance"
              className="px-6 pt-6"
            />
            <DataTable<InvoiceTableRow>
              data={invoiceRows}
              columns={invoiceCols}
              keyExtractor={(row) => row.rowKey}
              isLoading={outstandingDetail.isLoading}
              emptyMessage={selectedParty ? 'No party outstanding rows found' : 'No party selected'}
              sorting={invoiceGrid.sortingProps}
              filtering={invoiceGrid.filteringProps}
              pagination={invoiceGrid.paginationProps(outstandingDetail.data?.pagination?.total ?? 0)}
            />
          </Card>
        </>
      )}

      {activeTab === 'ledger' && (
        <>
          {ledger.isError && <QueryErrorBanner error={ledger.error} />}
          {ledger.data?.totals && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Opening" value={fmtAmount(ledger.data.totals.openingBalance)} valueClassName={amountClass(ledger.data.totals.openingBalance)} />
              <MetricCard label="Debit" value={fmtAmount(ledger.data.totals.debit)} />
              <MetricCard label="Credit" value={fmtAmount(ledger.data.totals.credit)} />
              <MetricCard label="Closing" value={fmtAmount(ledger.data.totals.closingBalance)} valueClassName={amountClass(ledger.data.totals.closingBalance)} />
            </div>
          )}
          <Card padding="none">
            <CardHeader
              title="Party Ledger"
              description="Opening balance, postings, running balance, and closing balance"
              className="px-6 pt-6"
            />
            <DataTable<LedgerTableRow>
              data={ledgerRows}
              columns={ledgerCols}
              keyExtractor={(row) => row.rowKey}
              isLoading={ledger.isLoading}
              emptyMessage={selectedParty ? 'No ledger transactions found' : 'No party selected'}
              sorting={ledgerGrid.sortingProps}
              filtering={ledgerGrid.filteringProps}
              pagination={ledgerGrid.paginationProps(ledger.data?.pagination.total ?? 0)}
            />
          </Card>
        </>
      )}
    </div>
  );
}
