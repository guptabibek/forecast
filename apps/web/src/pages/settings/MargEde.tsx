import { Badge, Card, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import {
    ArrowPathIcon,
    CloudArrowUpIcon,
    PencilSquareIcon,
    PlayIcon,
    PlusIcon,
    ShieldCheckIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import {
    CreateMargConfigDto,
    CreateMargGlMappingRuleDto,
    MargAnyStagedRow,
    MargGlMappingRule,
    MargReconciliationResult,
    MargStagedAccountGroup,
    MargStagedAccountGroupBalance,
    MargStagedAccountPosting,
    MargStagedBranch,
    MargStagedOutstanding,
    MargStagedParty,
    MargStagedPartyBalance,
    MargStagedProduct,
    MargStagedStock,
    MargStagedTransaction,
    MargSyncConfig,
    MargSyncLog,
    MargSyncScope,
    MargSyncStatus,
    TriggerSyncParams,
    UpdateMargConfigDto,
    UpdateMargGlMappingRuleDto,
    useCreateMargConfig,
    useCreateMargGlMappingRule,
    useDeleteMargConfig,
    useDeleteMargGlMappingRule,
    useMargConfigs,
    useMargGlAccounts,
    useMargGlMappingRules,
    useMargOverview,
    useMargReconciliationResults,
    useMargStagedAccountGroupBalances,
    useMargStagedAccountGroups,
    useMargStagedAccountPostings,
    useMargStagedBranches,
    useMargStagedOutstandings,
    useMargStagedParties,
    useMargStagedPartyBalances,
    useMargStagedProducts,
    useMargStagedStock,
    useMargStagedTransactions,
    useMargSyncLogs,
    useTestMargConnection,
    useTriggerMargAccountingSync,
    useTriggerMargSync,
    useUpdateMargConfig,
    useUpdateMargGlMappingRule,
} from '@hooks/useMargEde';
import { useAuthStore } from '@stores/auth.store';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

type StagedTabKey =
  | 'branches'
  | 'products'
  | 'parties'
  | 'transactions'
  | 'stock'
  | 'accountGroups'
  | 'accountGroupBalances'
  | 'partyBalances'
  | 'outstandings'
  | 'accountPostings';

type ConfigFormState = {
  companyCode: string;
  margKey: string;
  decryptionKey: string;
  apiBaseUrl: string;
  companyId: string;
  syncFrequency: 'HOURLY' | 'DAILY' | 'WEEKLY';
  isActive: boolean;
};

type RuleFormState = {
  ruleName: string;
  companyId: string;
  bookCode: string;
  groupCode: string;
  partyCode: string;
  counterpartyCode: string;
  remarkContains: string;
  glAccountId: string;
  isReceivableControl: boolean;
  priority: string;
  description: string;
};

type SyncWindowState = {
  fromDate: string;
  endDate: string;
};

const DEFAULT_FORM: ConfigFormState = {
  companyCode: '',
  margKey: '',
  decryptionKey: '',
  apiBaseUrl: 'https://corporate.margerp.com',
  companyId: '0',
  syncFrequency: 'DAILY',
  isActive: true,
};

const DEFAULT_RULE_FORM: RuleFormState = {
  ruleName: '',
  companyId: '',
  bookCode: '',
  groupCode: '',
  partyCode: '',
  counterpartyCode: '',
  remarkContains: '',
  glAccountId: '',
  isReceivableControl: false,
  priority: '0',
  description: '',
};

const stagedTabLabels: Array<{ key: StagedTabKey; label: string }> = [
  { key: 'branches', label: 'Branches' },
  { key: 'products', label: 'Products' },
  { key: 'parties', label: 'Parties' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'stock', label: 'Stock' },
  { key: 'accountGroups', label: 'Account Groups' },
  { key: 'accountGroupBalances', label: 'Group Balances' },
  { key: 'partyBalances', label: 'Party Balances' },
  { key: 'outstandings', label: 'Outstandings' },
  { key: 'accountPostings', label: 'Account Postings' },
];

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const maybeResponse = error as {
      response?: { data?: { message?: string | string[] } };
      message?: string;
    };

    const responseMessage = maybeResponse.response?.data?.message;
    if (Array.isArray(responseMessage)) {
      return responseMessage.join(' ');
    }
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage;
    }
    if (typeof maybeResponse.message === 'string' && maybeResponse.message.trim()) {
      return maybeResponse.message;
    }
  }

  return fallback;
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return new Intl.NumberFormat().format(numeric);
}

function formatCurrency(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(numeric);
}

function statusVariant(status: MargSyncStatus): 'secondary' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'RUNNING':
      return 'warning';
    case 'FAILED':
      return 'error';
    default:
      return 'secondary';
  }
}

function reconciliationVariant(status: MargReconciliationResult['status']): 'success' | 'warning' | 'error' {
  switch (status) {
    case 'PASSED':
      return 'success';
    case 'WARNING':
      return 'warning';
    default:
      return 'error';
  }
}

function buildLogRecordTotal(row: MargSyncLog): number {
  const counters: Array<number | undefined> = [
    row.branchesSynced,
    row.productsSynced,
    row.partiesSynced,
    row.transactionsSynced,
    row.stockSynced,
    row.vouchersSynced,
    row.saleTypesSynced,
    row.accountGroupsSynced,
    row.accountPostingsSynced,
    row.accountGroupBalancesSynced,
    row.partyBalancesSynced,
    row.outstandingsSynced,
    row.journalEntriesSynced,
  ];

  return counters.reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
}

function getSyncErrorCount(log?: MargSyncLog | null): number {
  if (!log || !Array.isArray(log.errors)) {
    return 0;
  }

  return log.errors.length;
}

function getLatestSyncLog(config?: MargSyncConfig | null): MargSyncLog | null {
  return config?.syncLogs?.[0] || null;
}

function formatRuleMatch(rule: MargGlMappingRule): string {
  const parts = [
    rule.companyId !== null && rule.companyId !== undefined ? `Co ${rule.companyId}` : 'All companies',
    rule.bookCode ? `Book ${rule.bookCode}` : null,
    rule.groupCode ? `Group ${rule.groupCode}` : null,
    rule.partyCode ? `Party ${rule.partyCode}` : null,
    rule.counterpartyCode ? `Counterparty ${rule.counterpartyCode}` : null,
    rule.remarkContains ? `Remark ${rule.remarkContains}` : null,
  ].filter(Boolean);

  return parts.join(' | ');
}

function formatIssueSummary(result: MargReconciliationResult): string {
  if (result.issueCount === 0) {
    return 'No issues';
  }

  return `${formatNumber(result.issueCount)} issues`;
}

function formatSyncScopeLabel(scope?: MargSyncScope | null): string {
  return scope === 'accounting' ? 'accounting-only' : 'full';
}

function isSyncScopeRunning(config: MargSyncConfig, scope?: MargSyncScope | null): boolean {
  return scope === 'accounting'
    ? config.lastAccountingSyncStatus === 'RUNNING'
    : config.lastSyncStatus === 'RUNNING';
}

function isSyncScopeFailed(config: MargSyncConfig, scope?: MargSyncScope | null): boolean {
  return scope === 'accounting'
    ? config.lastAccountingSyncStatus === 'FAILED'
    : config.lastSyncStatus === 'FAILED';
}

export default function MargEdePage() {
  const role = useAuthStore((state) => state.user?.role);
  const canManageRules = role === 'ADMIN' || role === 'FINANCE';

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<MargSyncConfig | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | undefined>();
  const [configForm, setConfigForm] = useState<ConfigFormState>(DEFAULT_FORM);
  const [syncWindow, setSyncWindow] = useState<SyncWindowState>({ fromDate: '', endDate: '' });
  const [isSyncMonitoring, setIsSyncMonitoring] = useState(false);
  const [lastTriggeredConfigId, setLastTriggeredConfigId] = useState<string | undefined>();
  const [lastTriggeredScope, setLastTriggeredScope] = useState<MargSyncScope | null>(null);

  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<MargGlMappingRule | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleFormState>(DEFAULT_RULE_FORM);

  const [stagedTab, setStagedTab] = useState<StagedTabKey>('branches');
  const [stagedPage, setStagedPage] = useState<Record<StagedTabKey, number>>({
    branches: 1,
    products: 1,
    parties: 1,
    transactions: 1,
    stock: 1,
    accountGroups: 1,
    accountGroupBalances: 1,
    partyBalances: 1,
    outstandings: 1,
    accountPostings: 1,
  });
  const [stagedPageSize, setStagedPageSize] = useState<Record<StagedTabKey, number>>({
    branches: 25,
    products: 25,
    parties: 25,
    transactions: 25,
    stock: 25,
    accountGroups: 25,
    accountGroupBalances: 25,
    partyBalances: 25,
    outstandings: 25,
    accountPostings: 25,
  });

  const currentPage = stagedPage[stagedTab];
  const currentPageSize = stagedPageSize[stagedTab];

  const {
    data: overview,
    isLoading: isOverviewLoading,
    isError: isOverviewError,
    error: overviewError,
    refetch: refetchOverview,
  } = useMargOverview();

  const {
    data: configs,
    isLoading: isConfigsLoading,
    isError: isConfigsError,
    error: configsError,
    refetch: refetchConfigs,
  } = useMargConfigs();

  const {
    data: logs,
    isLoading: isLogsLoading,
    isError: isLogsError,
    error: logsError,
    refetch: refetchLogs,
  } = useMargSyncLogs(selectedConfigId);

  const stagedBranchesQuery = useMargStagedBranches(currentPage, currentPageSize, stagedTab === 'branches');
  const stagedProductsQuery = useMargStagedProducts(currentPage, currentPageSize, stagedTab === 'products');
  const stagedPartiesQuery = useMargStagedParties(currentPage, currentPageSize, stagedTab === 'parties');
  const stagedTransactionsQuery = useMargStagedTransactions(currentPage, currentPageSize, stagedTab === 'transactions');
  const stagedStockQuery = useMargStagedStock(currentPage, currentPageSize, stagedTab === 'stock');
  const stagedAccountGroupsQuery = useMargStagedAccountGroups(currentPage, currentPageSize, stagedTab === 'accountGroups');
  const stagedAccountGroupBalancesQuery = useMargStagedAccountGroupBalances(currentPage, currentPageSize, stagedTab === 'accountGroupBalances');
  const stagedPartyBalancesQuery = useMargStagedPartyBalances(currentPage, currentPageSize, stagedTab === 'partyBalances');
  const stagedOutstandingsQuery = useMargStagedOutstandings(currentPage, currentPageSize, stagedTab === 'outstandings');
  const stagedAccountPostingsQuery = useMargStagedAccountPostings(currentPage, currentPageSize, stagedTab === 'accountPostings');

  const {
    data: glMappingRules,
    isLoading: isGlMappingRulesLoading,
    isError: isGlMappingRulesError,
    error: glMappingRulesError,
    refetch: refetchGlMappingRules,
  } = useMargGlMappingRules(undefined, canManageRules);

  const {
    data: glAccounts,
    isLoading: isGlAccountsLoading,
  } = useMargGlAccounts(canManageRules && isRuleModalOpen);

  const {
    data: reconciliationResults,
    isLoading: isReconciliationLoading,
    isError: isReconciliationError,
    error: reconciliationError,
    refetch: refetchReconciliationResults,
  } = useMargReconciliationResults({ configId: selectedConfigId, take: 10 }, Boolean(selectedConfigId));

  const createConfigMutation = useCreateMargConfig();
  const updateConfigMutation = useUpdateMargConfig();
  const deleteConfigMutation = useDeleteMargConfig();
  const testConnectionMutation = useTestMargConnection();
  const triggerSyncMutation = useTriggerMargSync();
  const triggerAccountingSyncMutation = useTriggerMargAccountingSync();
  const createRuleMutation = useCreateMargGlMappingRule();
  const updateRuleMutation = useUpdateMargGlMappingRule();
  const deleteRuleMutation = useDeleteMargGlMappingRule();
  const isAnySyncActionPending = triggerSyncMutation.isPending || triggerAccountingSyncMutation.isPending;
  const monitoredScope = isSyncMonitoring ? (lastTriggeredScope ?? 'full') : null;
  const isAccountingSyncMonitoring = monitoredScope === 'accounting';
  const isFullSyncMonitoring = monitoredScope === 'full';

  useEffect(() => {
    if (!configs?.length) {
      setSelectedConfigId(undefined);
      return;
    }

    const currentExists = selectedConfigId && configs.some((config) => config.id === selectedConfigId);
    if (!currentExists) {
      setSelectedConfigId(configs[0].id);
    }
  }, [configs, selectedConfigId]);

  useEffect(() => {
    if (!isSyncMonitoring) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refetchOverview();
      void refetchConfigs();
      if (selectedConfigId) {
        void refetchLogs();
      }
      void refetchReconciliationResults();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isSyncMonitoring, refetchConfigs, refetchLogs, refetchOverview, refetchReconciliationResults, selectedConfigId]);

  useEffect(() => {
    if (!isSyncMonitoring || !lastTriggeredConfigId || !configs?.length) {
      return;
    }

    const monitoredConfig = configs.find((config) => config.id === lastTriggeredConfigId);
    if (!monitoredConfig) {
      return;
    }

    const activeScope = lastTriggeredScope ?? 'full';
    const isRunning = isSyncScopeRunning(monitoredConfig, activeScope);

    if (isRunning) {
      return;
    }

    const latestLog = getLatestSyncLog(monitoredConfig);
    const errorCount = getSyncErrorCount(latestLog);
    const syncLabel = formatSyncScopeLabel(activeScope);

    setIsSyncMonitoring(false);
    if (isSyncScopeFailed(monitoredConfig, activeScope) || latestLog?.status === 'FAILED') {
      toast.error(`Marg ${syncLabel} sync finished with failures for ${monitoredConfig.companyCode}.`);
    } else if (errorCount > 0) {
      toast(`Marg ${syncLabel} sync completed with ${errorCount} warning${errorCount === 1 ? '' : 's'} for ${monitoredConfig.companyCode}.`);
    } else {
      toast.success(`Marg ${syncLabel} sync completed for ${monitoredConfig.companyCode}.`);
    }
  }, [configs, isSyncMonitoring, lastTriggeredConfigId, lastTriggeredScope]);

  const selectedConfig = useMemo(
    () => configs?.find((config) => config.id === selectedConfigId) || null,
    [configs, selectedConfigId],
  );

  const latestSelectedLog = useMemo(
    () => getLatestSyncLog(selectedConfig) || logs?.[0] || null,
    [logs, selectedConfig],
  );
  const latestSelectedErrorCount = getSyncErrorCount(latestSelectedLog);

  const activeStagedQuery = useMemo(() => {
    switch (stagedTab) {
      case 'branches':
        return stagedBranchesQuery;
      case 'products':
        return stagedProductsQuery;
      case 'parties':
        return stagedPartiesQuery;
      case 'transactions':
        return stagedTransactionsQuery;
      case 'stock':
        return stagedStockQuery;
      case 'accountGroups':
        return stagedAccountGroupsQuery;
      case 'accountGroupBalances':
        return stagedAccountGroupBalancesQuery;
      case 'partyBalances':
        return stagedPartyBalancesQuery;
      case 'outstandings':
        return stagedOutstandingsQuery;
      default:
        return stagedAccountPostingsQuery;
    }
  }, [
    stagedAccountGroupBalancesQuery,
    stagedAccountGroupsQuery,
    stagedAccountPostingsQuery,
    stagedBranchesQuery,
    stagedOutstandingsQuery,
    stagedPartiesQuery,
    stagedPartyBalancesQuery,
    stagedProductsQuery,
    stagedStockQuery,
    stagedTab,
    stagedTransactionsQuery,
  ]);

  const stagedRows = (activeStagedQuery.data?.items || []) as MargAnyStagedRow[];
  const stagedTotal = activeStagedQuery.data?.total || 0;
  const activeConfigCount = overview?.configs.filter((config) => config.isActive).length || 0;

  const configColumns: Column<MargSyncConfig>[] = [
    {
      key: 'companyCode',
      header: 'Company Code',
      accessor: (row) => <span className="font-medium">{row.companyCode}</span>,
    },
    {
      key: 'endpoint',
      header: 'API Endpoint',
      accessor: (row) => row.apiBaseUrl,
    },
    {
      key: 'frequency',
      header: 'Frequency',
      accessor: (row) => row.syncFrequency,
    },
    {
      key: 'inventoryStatus',
      header: 'Inventory Sync',
      accessor: (row) => <Badge variant={statusVariant(row.lastSyncStatus)} size="sm">{row.lastSyncStatus}</Badge>,
    },
    {
      key: 'accountingStatus',
      header: 'Accounting Sync',
      accessor: (row) => <Badge variant={statusVariant(row.lastAccountingSyncStatus)} size="sm">{row.lastAccountingSyncStatus}</Badge>,
    },
    {
      key: 'latestOutcome',
      header: 'Latest Outcome',
      accessor: (row) => {
        const latestLog = getLatestSyncLog(row);
        if (!latestLog) {
          return <Badge variant="secondary" size="sm">No runs</Badge>;
        }

        const errorCount = getSyncErrorCount(latestLog);
        if (latestLog.status === 'FAILED') {
          return <Badge variant="error" size="sm">Failed</Badge>;
        }
        if (errorCount > 0) {
          return <Badge variant="warning" size="sm">{`${errorCount} warning${errorCount === 1 ? '' : 's'}`}</Badge>;
        }

        return <Badge variant="success" size="sm">Clean</Badge>;
      },
    },
    {
      key: 'lastSyncAt',
      header: 'Last Inventory Sync',
      accessor: (row) => formatDateTime(row.lastSyncAt),
    },
    {
      key: 'lastAccountingSyncAt',
      header: 'Last Accounting Sync',
      accessor: (row) => formatDateTime(row.lastAccountingSyncAt),
    },
    {
      key: 'active',
      header: 'Active',
      accessor: (row) => <Badge variant={row.isActive ? 'success' : 'secondary'} size="sm">{row.isActive ? 'Yes' : 'No'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-secondary btn-sm"
            onClick={(event) => {
              event.stopPropagation();
              void handleTestConnection(row.id);
            }}
            disabled={testConnectionMutation.isPending}
          >
            <ShieldCheckIcon className="w-4 h-4 mr-1" />
            Test
          </button>
          <button
            className="btn-primary btn-sm"
            onClick={(event) => {
              event.stopPropagation();
              void handleTriggerSync(row.id, 'full');
            }}
            disabled={isAnySyncActionPending || row.lastSyncStatus === 'RUNNING' || row.lastAccountingSyncStatus === 'RUNNING' || !row.isActive}
          >
            <PlayIcon className="w-4 h-4 mr-1" />
            Full Sync
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={(event) => {
              event.stopPropagation();
              openEditModal(row);
            }}
          >
            <PencilSquareIcon className="w-4 h-4" />
          </button>
          <button
            className="btn-danger btn-sm"
            onClick={(event) => {
              event.stopPropagation();
              void handleDeleteConfig(row);
            }}
            disabled={deleteConfigMutation.isPending}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const logColumns: Column<MargSyncLog>[] = [
    {
      key: 'startedAt',
      header: 'Started',
      accessor: (row) => formatDateTime(row.startedAt),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => <Badge variant={statusVariant(row.status)} size="sm">{row.status}</Badge>,
    },
    {
      key: 'completedAt',
      header: 'Completed',
      accessor: (row) => formatDateTime(row.completedAt),
    },
    {
      key: 'records',
      header: 'Records Synced',
      accessor: (row) => formatNumber(buildLogRecordTotal(row)),
      align: 'right',
    },
    {
      key: 'accountPostings',
      header: 'Acct Rows',
      accessor: (row) => formatNumber(row.accountPostingsSynced),
      align: 'right',
    },
    {
      key: 'journalEntries',
      header: 'Journals',
      accessor: (row) => formatNumber(row.journalEntriesSynced),
      align: 'right',
    },
    {
      key: 'errors',
      header: 'Errors',
      accessor: (row) => {
        const errors = Array.isArray(row.errors) ? row.errors : [];
        return errors.length > 0
          ? <Badge variant="error" size="sm">{errors.length}</Badge>
          : <Badge variant="success" size="sm">0</Badge>;
      },
      align: 'center',
    },
  ];

  const ruleColumns: Column<MargGlMappingRule>[] = [
    {
      key: 'ruleName',
      header: 'Rule',
      accessor: (row) => <span className="font-medium">{row.ruleName}</span>,
    },
    {
      key: 'match',
      header: 'Match Criteria',
      accessor: (row) => formatRuleMatch(row),
    },
    {
      key: 'glAccount',
      header: 'GL Account',
      accessor: (row) => row.glAccount ? `${row.glAccount.accountNumber} - ${row.glAccount.name}` : row.glAccountId,
    },
    {
      key: 'priority',
      header: 'Priority',
      accessor: (row) => formatNumber(row.priority),
      align: 'right',
    },
    {
      key: 'control',
      header: 'AR Control',
      accessor: (row) => <Badge variant={row.isReceivableControl ? 'warning' : 'secondary'} size="sm">{row.isReceivableControl ? 'Yes' : 'No'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (row) => (
        <div className="flex items-center gap-2">
          <button className="btn-ghost btn-sm" onClick={() => openEditRuleModal(row)}>
            <PencilSquareIcon className="w-4 h-4" />
          </button>
          <button
            className="btn-danger btn-sm"
            onClick={() => void handleDeleteRule(row)}
            disabled={deleteRuleMutation.isPending}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const reconciliationColumns: Column<MargReconciliationResult>[] = [
    {
      key: 'createdAt',
      header: 'Created',
      accessor: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'reconciliationType',
      header: 'Type',
      accessor: (row) => row.reconciliationType,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => <Badge variant={reconciliationVariant(row.status)} size="sm">{row.status}</Badge>,
    },
    {
      key: 'issueCount',
      header: 'Issues',
      accessor: (row) => formatIssueSummary(row),
    },
    {
      key: 'summary',
      header: 'Summary',
      accessor: (row) => {
        if (!row.summary) return '-';
        const totalProjectedOnHand = row.summary.totalProjectedOnHand;
        const totalOutstanding = row.summary.totalOutstanding;
        if (totalProjectedOnHand !== undefined) {
          return `Projected on hand ${formatNumber(totalProjectedOnHand)}`;
        }
        if (totalOutstanding !== undefined) {
          return `Outstanding ${formatCurrency(totalOutstanding)}`;
        }
        return JSON.stringify(row.summary).slice(0, 80);
      },
    },
  ];

  const stagedColumns = useMemo<Column<MargAnyStagedRow>[]>(() => {
    if (stagedTab === 'branches') {
      const cols: Column<MargStagedBranch>[] = [
        { key: 'companyId', header: 'Company ID', accessor: (row) => String(row.companyId) },
        { key: 'name', header: 'Name', accessor: 'name' },
        { key: 'branch', header: 'Branch', accessor: (row) => row.branch || '-' },
        { key: 'storeId', header: 'Store ID', accessor: (row) => row.storeId || '-' },
        { key: 'licence', header: 'Licence', accessor: (row) => row.licence || '-' },
        { key: 'locationId', header: 'Location', accessor: (row) => (row.locationId ? 'Linked' : 'Pending') },
        { key: 'updatedAt', header: 'Updated', accessor: (row) => formatDateTime(row.updatedAt) },
      ];
      return cols as Column<MargAnyStagedRow>[];
    }

    if (stagedTab === 'products') {
      const cols: Column<MargStagedProduct>[] = [
        { key: 'pid', header: 'PID', accessor: 'pid' },
        { key: 'code', header: 'Code', accessor: 'code' },
        { key: 'name', header: 'Name', accessor: 'name' },
        { key: 'unit', header: 'Unit', accessor: (row) => row.unit || '-' },
        { key: 'gst', header: 'GST %', accessor: (row) => formatNumber(row.gst), align: 'right' },
        { key: 'updatedAt', header: 'Updated', accessor: (row) => formatDateTime(row.updatedAt) },
      ];
      return cols as Column<MargAnyStagedRow>[];
    }

    if (stagedTab === 'parties') {
      const cols: Column<MargStagedParty>[] = [
        { key: 'cid', header: 'CID', accessor: 'cid' },
        { key: 'parName', header: 'Party Name', accessor: 'parName' },
        { key: 'phone1', header: 'Phone', accessor: (row) => row.phone1 || '-' },
        { key: 'area', header: 'Area', accessor: (row) => row.area || '-' },
        { key: 'gstnNo', header: 'GSTN', accessor: (row) => row.gstnNo || '-' },
        { key: 'updatedAt', header: 'Updated', accessor: (row) => formatDateTime(row.updatedAt) },
      ];
      return cols as Column<MargAnyStagedRow>[];
    }

    if (stagedTab === 'transactions') {
      const cols: Column<MargStagedTransaction>[] = [
        { key: 'date', header: 'Date', accessor: (row) => formatDate(row.date) },
        { key: 'voucher', header: 'Voucher', accessor: 'voucher' },
        { key: 'type', header: 'Type', accessor: 'type' },
        { key: 'cid', header: 'CID', accessor: (row) => row.cid || '-' },
        { key: 'pid', header: 'PID', accessor: (row) => row.pid || '-' },
        { key: 'qty', header: 'Qty', accessor: (row) => formatNumber(row.qty), align: 'right' },
        { key: 'amount', header: 'Amount', accessor: (row) => formatNumber(row.amount), align: 'right' },
      ];
      return cols as Column<MargAnyStagedRow>[];
    }

    if (stagedTab === 'stock') {
      const cols: Column<MargStagedStock>[] = [
        { key: 'pid', header: 'PID', accessor: 'pid' },
        { key: 'batch', header: 'Batch', accessor: 'batch' },
        { key: 'stock', header: 'Stock', accessor: (row) => formatNumber(row.stock), align: 'right' },
        { key: 'mrp', header: 'MRP', accessor: (row) => formatNumber(row.mrp), align: 'right' },
        { key: 'expiry', header: 'Expiry', accessor: (row) => formatDate(row.expiry) },
        { key: 'sourceDeleted', header: 'Deleted', accessor: (row) => <Badge variant={row.sourceDeleted ? 'warning' : 'success'} size="sm">{row.sourceDeleted ? 'Yes' : 'No'}</Badge> },
        { key: 'updatedAt', header: 'Updated', accessor: (row) => formatDateTime(row.updatedAt) },
      ];
      return cols as Column<MargAnyStagedRow>[];
    }

    if (stagedTab === 'accountGroups') {
      const cols: Column<MargStagedAccountGroup>[] = [
        { key: 'companyId', header: 'Company ID', accessor: (row) => String(row.companyId) },
        { key: 'aid', header: 'AID', accessor: 'aid' },
        { key: 'name', header: 'Name', accessor: (row) => row.name || '-' },
        { key: 'parentCode', header: 'Parent', accessor: (row) => row.parentCode || '-' },
        { key: 'updatedAt', header: 'Updated', accessor: (row) => formatDateTime(row.updatedAt) },
      ];
      return cols as Column<MargAnyStagedRow>[];
    }

    if (stagedTab === 'accountGroupBalances') {
      const cols: Column<MargStagedAccountGroupBalance>[] = [
        { key: 'companyId', header: 'Company ID', accessor: (row) => String(row.companyId) },
        { key: 'aid', header: 'AID', accessor: 'aid' },
        { key: 'opening', header: 'Opening', accessor: (row) => formatCurrency(row.opening), align: 'right' },
        { key: 'balance', header: 'Balance', accessor: (row) => formatCurrency(row.balance), align: 'right' },
        { key: 'updatedAt', header: 'Updated', accessor: (row) => formatDateTime(row.updatedAt) },
      ];
      return cols as Column<MargAnyStagedRow>[];
    }

    if (stagedTab === 'partyBalances') {
      const cols: Column<MargStagedPartyBalance>[] = [
        { key: 'companyId', header: 'Company ID', accessor: (row) => String(row.companyId) },
        { key: 'cid', header: 'CID', accessor: 'cid' },
        { key: 'opening', header: 'Opening', accessor: (row) => formatCurrency(row.opening), align: 'right' },
        { key: 'balance', header: 'Balance', accessor: (row) => formatCurrency(row.balance), align: 'right' },
        { key: 'updatedAt', header: 'Updated', accessor: (row) => formatDateTime(row.updatedAt) },
      ];
      return cols as Column<MargAnyStagedRow>[];
    }

    if (stagedTab === 'outstandings') {
      const cols: Column<MargStagedOutstanding>[] = [
        { key: 'date', header: 'Date', accessor: (row) => formatDate(row.date) },
        { key: 'ord', header: 'ORD', accessor: 'ord' },
        { key: 'voucher', header: 'Voucher', accessor: (row) => row.voucher || '-' },
        { key: 'days', header: 'Days', accessor: (row) => formatNumber(row.days), align: 'right' },
        { key: 'finalAmt', header: 'Final Amt', accessor: (row) => formatCurrency(row.finalAmt), align: 'right' },
        { key: 'balance', header: 'Balance', accessor: (row) => formatCurrency(row.balance), align: 'right' },
        { key: 'groupCode', header: 'Group', accessor: (row) => row.groupCode || '-' },
        { key: 'updatedAt', header: 'Updated', accessor: (row) => formatDateTime(row.updatedAt) },
      ];
      return cols as Column<MargAnyStagedRow>[];
    }

    const cols: Column<MargStagedAccountPosting>[] = [
      { key: 'date', header: 'Date', accessor: (row) => formatDate(row.date) },
      { key: 'voucher', header: 'Voucher', accessor: (row) => row.voucher || '-' },
      { key: 'book', header: 'Book', accessor: (row) => row.book || '-' },
      { key: 'gCode', header: 'Group', accessor: (row) => row.gCode || '-' },
      { key: 'code', header: 'Party', accessor: (row) => row.code || '-' },
      { key: 'code1', header: 'Counterparty', accessor: (row) => row.code1 || '-' },
      { key: 'amount', header: 'Amount', accessor: (row) => formatCurrency(row.amount), align: 'right' },
      { key: 'remark', header: 'Remark', accessor: (row) => row.remark || '-' },
      { key: 'updatedAt', header: 'Updated', accessor: (row) => formatDateTime(row.updatedAt) },
    ];
    return cols as Column<MargAnyStagedRow>[];
  }, [stagedTab]);

  async function handleSaveConfig() {
    if (!configForm.companyCode.trim()) {
      toast.error('Company code is required.');
      return;
    }

    const parsedCompanyId = Number(configForm.companyId);
    if (!Number.isInteger(parsedCompanyId) || parsedCompanyId < 0) {
      toast.error('Company ID must be a valid non-negative integer.');
      return;
    }

    try {
      if (!editingConfig) {
        if (!configForm.margKey.trim() || !configForm.decryptionKey.trim()) {
          toast.error('Marg key and decryption key are required for new configurations.');
          return;
        }

        const payload: CreateMargConfigDto = {
          companyCode: configForm.companyCode.trim(),
          margKey: configForm.margKey.trim(),
          decryptionKey: configForm.decryptionKey.trim(),
          apiBaseUrl: configForm.apiBaseUrl.trim(),
          companyId: parsedCompanyId,
          syncFrequency: configForm.syncFrequency,
        };

        await createConfigMutation.mutateAsync(payload);
        toast.success('Marg EDE configuration created.');
      } else {
        const payload: UpdateMargConfigDto = {
          companyCode: configForm.companyCode.trim(),
          apiBaseUrl: configForm.apiBaseUrl.trim(),
          companyId: parsedCompanyId,
          syncFrequency: configForm.syncFrequency,
          isActive: configForm.isActive,
        };

        if (configForm.margKey.trim()) {
          payload.margKey = configForm.margKey.trim();
        }
        if (configForm.decryptionKey.trim()) {
          payload.decryptionKey = configForm.decryptionKey.trim();
        }

        await updateConfigMutation.mutateAsync({ configId: editingConfig.id, dto: payload });
        toast.success('Marg EDE configuration updated.');
      }

      closeConfigModal();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save Marg EDE configuration.'));
    }
  }

  async function handleDeleteConfig(config: MargSyncConfig) {
    const confirmed = window.confirm(`Delete Marg EDE config ${config.companyCode}? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteConfigMutation.mutateAsync(config.id);
      toast.success('Marg EDE configuration deleted.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete Marg EDE configuration.'));
    }
  }

  async function handleTestConnection(configId: string) {
    try {
      const result = await testConnectionMutation.mutateAsync(configId);
      if (result.success) {
        toast.success(result.message || 'Connection successful.');
      } else {
        toast.error(result.message || 'Connection failed.');
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to test Marg EDE connection.'));
    }
  }

  async function handleTriggerSync(configId: string, scope: MargSyncScope = 'full') {
    const params: TriggerSyncParams = {};

    if (syncWindow.fromDate) {
      params.fromDate = syncWindow.fromDate;
    }
    if (syncWindow.endDate) {
      params.endDate = syncWindow.endDate;
    }
    if (params.fromDate && params.endDate && new Date(params.endDate) < new Date(params.fromDate)) {
      toast.error('Sync end date must be on or after the start date.');
      return;
    }

    try {
      const mutation = scope === 'accounting' ? triggerAccountingSyncMutation : triggerSyncMutation;
      const result = await mutation.mutateAsync({
        configId,
        params: Object.keys(params).length > 0 ? params : undefined,
      });
      const resolvedScope = result.scope ?? scope;
      toast.success(
        result.message || (resolvedScope === 'accounting' ? 'Accounting-only sync request accepted.' : 'Full sync request accepted.'),
      );
      setSelectedConfigId(configId);
      setLastTriggeredConfigId(configId);
      setLastTriggeredScope(resolvedScope);
      if (result.status === 'queued') {
        setIsSyncMonitoring(true);
      } else {
        setIsSyncMonitoring(false);
        void refetchLogs();
        void refetchOverview();
        void refetchConfigs();
        void refetchReconciliationResults();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to trigger Marg EDE sync.'));
    }
  }

  function openCreateModal() {
    setEditingConfig(null);
    setConfigForm(DEFAULT_FORM);
    setIsConfigModalOpen(true);
  }

  function openEditModal(config: MargSyncConfig) {
    setEditingConfig(config);
    setConfigForm({
      companyCode: config.companyCode,
      margKey: '',
      decryptionKey: '',
      apiBaseUrl: config.apiBaseUrl,
      companyId: String(config.companyId),
      syncFrequency: config.syncFrequency,
      isActive: config.isActive,
    });
    setIsConfigModalOpen(true);
  }

  function closeConfigModal() {
    setIsConfigModalOpen(false);
    setEditingConfig(null);
    setConfigForm(DEFAULT_FORM);
  }

  function openCreateRuleModal() {
    setEditingRule(null);
    setRuleForm(DEFAULT_RULE_FORM);
    setIsRuleModalOpen(true);
  }

  function openEditRuleModal(rule: MargGlMappingRule) {
    setEditingRule(rule);
    setRuleForm({
      ruleName: rule.ruleName,
      companyId: rule.companyId !== null && rule.companyId !== undefined ? String(rule.companyId) : '',
      bookCode: rule.bookCode || '',
      groupCode: rule.groupCode || '',
      partyCode: rule.partyCode || '',
      counterpartyCode: rule.counterpartyCode || '',
      remarkContains: rule.remarkContains || '',
      glAccountId: rule.glAccountId,
      isReceivableControl: rule.isReceivableControl,
      priority: String(rule.priority ?? 0),
      description: rule.description || '',
    });
    setIsRuleModalOpen(true);
  }

  function closeRuleModal() {
    setIsRuleModalOpen(false);
    setEditingRule(null);
    setRuleForm(DEFAULT_RULE_FORM);
  }

  async function handleSaveRule() {
    if (!ruleForm.ruleName.trim()) {
      toast.error('Rule name is required.');
      return;
    }
    if (!ruleForm.glAccountId) {
      toast.error('Select a GL account for this rule.');
      return;
    }

    const parsedPriority = Number(ruleForm.priority || '0');
    if (!Number.isInteger(parsedPriority)) {
      toast.error('Priority must be a whole number.');
      return;
    }

    let companyId: number | undefined;
    if (ruleForm.companyId.trim()) {
      const parsedCompanyId = Number(ruleForm.companyId);
      if (!Number.isInteger(parsedCompanyId)) {
        toast.error('Company ID must be a whole number.');
        return;
      }
      companyId = parsedCompanyId;
    }

    const payload: CreateMargGlMappingRuleDto = {
      ruleName: ruleForm.ruleName.trim(),
      companyId,
      bookCode: ruleForm.bookCode.trim() || undefined,
      groupCode: ruleForm.groupCode.trim() || undefined,
      partyCode: ruleForm.partyCode.trim() || undefined,
      counterpartyCode: ruleForm.counterpartyCode.trim() || undefined,
      remarkContains: ruleForm.remarkContains.trim() || undefined,
      glAccountId: ruleForm.glAccountId,
      isReceivableControl: ruleForm.isReceivableControl,
      priority: parsedPriority,
      description: ruleForm.description.trim() || undefined,
    };

    try {
      if (editingRule) {
        await updateRuleMutation.mutateAsync({
          ruleId: editingRule.id,
          dto: payload as UpdateMargGlMappingRuleDto,
        });
        toast.success('GL mapping rule updated.');
      } else {
        await createRuleMutation.mutateAsync(payload);
        toast.success('GL mapping rule created.');
      }
      closeRuleModal();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save GL mapping rule.'));
    }
  }

  async function handleDeleteRule(rule: MargGlMappingRule) {
    const confirmed = window.confirm(`Delete mapping rule ${rule.ruleName}? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteRuleMutation.mutateAsync(rule.id);
      toast.success('GL mapping rule deleted.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete GL mapping rule.'));
    }
  }

  function setPage(tab: StagedTabKey, page: number) {
    setStagedPage((prev) => ({
      ...prev,
      [tab]: Math.max(1, page),
    }));
  }

  function setPageSize(tab: StagedTabKey, pageSize: number) {
    setStagedPageSize((prev) => ({
      ...prev,
      [tab]: pageSize,
    }));
    setStagedPage((prev) => ({
      ...prev,
      [tab]: 1,
    }));
  }

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Marg EDE Integration</h1>
          <p className="text-secondary-500 mt-1">
            Configure Marg connectivity, monitor inventory and accounting sync state, and manage posting controls.
          </p>
        </div>
        <button className="btn-primary" onClick={openCreateModal}>
          <PlusIcon className="w-5 h-5 mr-2" />
          New Marg Config
        </button>
      </div>

      {isOverviewError && <QueryErrorBanner error={overviewError} onRetry={() => refetchOverview()} />}
      {isConfigsError && <QueryErrorBanner error={configsError} onRetry={() => refetchConfigs()} />}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Total Configs</p>
          <p className="text-2xl font-bold mt-1">{isOverviewLoading ? '-' : formatNumber(overview?.configs.length || 0)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Active Configs</p>
          <p className="text-2xl font-bold mt-1">{isOverviewLoading ? '-' : formatNumber(activeConfigCount)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Staged Transactions</p>
          <p className="text-2xl font-bold mt-1">{isOverviewLoading ? '-' : formatNumber(overview?.stagedData.transactions || 0)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Staged Account Rows</p>
          <p className="text-2xl font-bold mt-1">{isOverviewLoading ? '-' : formatNumber(overview?.stagedData.accountPostings || 0)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Active GL Rules</p>
          <p className="text-2xl font-bold mt-1">{isOverviewLoading ? '-' : formatNumber(overview?.stagedData.glMappingRules || 0)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Reconciliation Results</p>
          <p className="text-2xl font-bold mt-1">{isOverviewLoading ? '-' : formatNumber(overview?.stagedData.reconciliationResults || 0)}</p>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Selected Configuration</h2>
              <p className="text-sm text-secondary-500">Use an optional date window for bounded backfills and monitor separate inventory and accounting cursors.</p>
            </div>
            {selectedConfig ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4">
                  <p className="text-xs uppercase tracking-wide text-secondary-500">Inventory Sync</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant={statusVariant(selectedConfig.lastSyncStatus)}>{selectedConfig.lastSyncStatus}</Badge>
                    <span className="text-sm text-secondary-500">{formatDateTime(selectedConfig.lastSyncAt)}</span>
                  </div>
                </div>
                <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4">
                  <p className="text-xs uppercase tracking-wide text-secondary-500">Accounting Sync</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant={statusVariant(selectedConfig.lastAccountingSyncStatus)}>{selectedConfig.lastAccountingSyncStatus}</Badge>
                    <span className="text-sm text-secondary-500">{formatDateTime(selectedConfig.lastAccountingSyncAt)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <Badge variant="secondary">No config selected</Badge>
            )}
            {selectedConfig && latestSelectedLog ? (
              <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4">
                <p className="text-xs uppercase tracking-wide text-secondary-500">Latest Run Outcome</p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <Badge variant={latestSelectedErrorCount > 0 ? 'warning' : 'success'}>
                    {latestSelectedErrorCount > 0
                      ? `${latestSelectedErrorCount} warning${latestSelectedErrorCount === 1 ? '' : 's'}`
                      : 'Clean'}
                  </Badge>
                  <span className="text-sm text-secondary-500">{formatDateTime(latestSelectedLog.completedAt || latestSelectedLog.startedAt)}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="min-w-[320px] rounded-lg border border-secondary-200 dark:border-secondary-700 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Manual Sync Window</h3>
              <p className="text-xs text-secondary-500 mt-1">Leave both dates empty for normal incremental sync. Use an end date to run a bounded backfill without advancing saved cursors.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">From Date</label>
                <input
                  type="date"
                  className="input"
                  value={syncWindow.fromDate}
                  onChange={(event) => setSyncWindow((prev) => ({ ...prev, fromDate: event.target.value }))}
                />
              </div>
              <div>
                <label className="label">End Date</label>
                <input
                  type="date"
                  className="input"
                  value={syncWindow.endDate}
                  onChange={(event) => setSyncWindow((prev) => ({ ...prev, endDate: event.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                className="btn-secondary btn-sm"
                onClick={() => setSyncWindow({ fromDate: '', endDate: '' })}
                type="button"
              >
                Clear Window
              </button>
              <button
                className="btn-secondary btn-sm"
                onClick={() => selectedConfigId && void handleTriggerSync(selectedConfigId, 'accounting')}
                disabled={!selectedConfigId || isAnySyncActionPending || isSyncMonitoring}
                type="button"
              >
                <CloudArrowUpIcon className="w-4 h-4 mr-2" />
                {isAccountingSyncMonitoring ? 'Monitoring Accounting...' : 'Accounting Only'}
              </button>
              <button
                className="btn-primary btn-sm"
                onClick={() => selectedConfigId && void handleTriggerSync(selectedConfigId, 'full')}
                disabled={!selectedConfigId || isAnySyncActionPending || isSyncMonitoring}
                type="button"
              >
                <PlayIcon className="w-4 h-4 mr-2" />
                {isFullSyncMonitoring ? 'Monitoring Full Sync...' : 'Run Full Sync'}
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="p-6 border-b border-secondary-200 dark:border-secondary-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Configurations</h2>
            <p className="text-sm text-secondary-500">Manage Marg credentials, company scope, and sync cadence.</p>
          </div>
          <button
            className="btn-secondary"
            onClick={() => {
              void refetchConfigs();
              void refetchOverview();
            }}
          >
            <ArrowPathIcon className="w-4 h-4 mr-2" />
            Refresh
          </button>
        </div>
        <DataTable
          data={configs || []}
          columns={configColumns}
          keyExtractor={(row) => row.id}
          isLoading={isConfigsLoading}
          emptyMessage="No Marg EDE configurations found."
          onRowClick={(row) => setSelectedConfigId(row.id)}
        />
      </Card>

      <Card padding="none">
        <div className="p-6 border-b border-secondary-200 dark:border-secondary-700 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Sync Logs</h2>
            <p className="text-sm text-secondary-500">Review end-to-end execution history including accounting staging and journal projection counts.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="label mb-0">Config</label>
            <select
              className="input min-w-[240px]"
              value={selectedConfigId || ''}
              onChange={(event) => setSelectedConfigId(event.target.value || undefined)}
              disabled={!configs?.length}
            >
              {(configs || []).map((config) => (
                <option key={config.id} value={config.id}>
                  {config.companyCode} ({config.syncFrequency})
                </option>
              ))}
            </select>
            <button className="btn-secondary" onClick={() => void refetchLogs()} disabled={!selectedConfigId}>
              <ArrowPathIcon className="w-4 h-4 mr-2" />
              Reload
            </button>
          </div>
        </div>

        {isLogsError ? (
          <div className="p-6">
            <QueryErrorBanner error={logsError} onRetry={() => refetchLogs()} />
          </div>
        ) : (
          <DataTable
            data={logs || []}
            columns={logColumns}
            keyExtractor={(row) => row.id}
            isLoading={isLogsLoading}
            emptyMessage={selectedConfigId ? 'No sync logs for the selected config.' : 'Select a config to view logs.'}
          />
        )}
      </Card>

      {canManageRules && (
        <Card padding="none">
          <div className="p-6 border-b border-secondary-200 dark:border-secondary-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">GL Mapping Rules</h2>
              <p className="text-sm text-secondary-500">Map Marg posting groups and parties into your existing accounting engine without a second ledger subsystem.</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-secondary" onClick={() => void refetchGlMappingRules()}>
                <ArrowPathIcon className="w-4 h-4 mr-2" />
                Refresh
              </button>
              <button className="btn-primary" onClick={openCreateRuleModal}>
                <PlusIcon className="w-4 h-4 mr-2" />
                New Rule
              </button>
            </div>
          </div>
          {isGlMappingRulesError ? (
            <div className="p-6">
              <QueryErrorBanner error={glMappingRulesError} onRetry={() => refetchGlMappingRules()} />
            </div>
          ) : (
            <DataTable
              data={glMappingRules || []}
              columns={ruleColumns}
              keyExtractor={(row) => row.id}
              isLoading={isGlMappingRulesLoading}
              emptyMessage="No active GL mapping rules found."
            />
          )}
        </Card>
      )}

      <Card padding="none">
        <div className="p-6 border-b border-secondary-200 dark:border-secondary-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Reconciliation Results</h2>
            <p className="text-sm text-secondary-500">Latest stock, AR ageing, and accounting-balance checks produced during Marg sync.</p>
          </div>
          <button className="btn-secondary" onClick={() => void refetchReconciliationResults()} disabled={!selectedConfigId}>
            <ArrowPathIcon className="w-4 h-4 mr-2" />
            Refresh
          </button>
        </div>
        {isReconciliationError ? (
          <div className="p-6">
            <QueryErrorBanner error={reconciliationError} onRetry={() => refetchReconciliationResults()} />
          </div>
        ) : (
          <DataTable
            data={reconciliationResults || []}
            columns={reconciliationColumns}
            keyExtractor={(row) => row.id}
            isLoading={isReconciliationLoading}
            emptyMessage="No reconciliation results available yet."
          />
        )}
      </Card>

      <Card padding="none">
        <div className="p-6 border-b border-secondary-200 dark:border-secondary-700">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold">Staged Data</h2>
              <p className="text-sm text-secondary-500">Inspect raw entities synchronized from Marg before inventory, accounting, and reconciliation transforms run.</p>
            </div>
            <button className="btn-secondary" onClick={() => void activeStagedQuery.refetch()}>
              <ArrowPathIcon className="w-4 h-4 mr-2" />
              Refresh {stagedTab}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {stagedTabLabels.map((tab) => (
              <button
                key={tab.key}
                className={tab.key === stagedTab ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                onClick={() => setStagedTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <DataTable
          data={stagedRows}
          columns={stagedColumns}
          keyExtractor={(row) => (row as { id: string }).id}
          isLoading={activeStagedQuery.isLoading}
          emptyMessage={`No staged ${stagedTab} data found.`}
          pagination={{
            page: currentPage,
            pageSize: currentPageSize,
            total: stagedTotal,
            onPageChange: (page) => setPage(stagedTab, page),
            onPageSizeChange: (size) => setPageSize(stagedTab, size),
          }}
        />
      </Card>

      <Modal
        isOpen={isConfigModalOpen}
        onClose={closeConfigModal}
        title={editingConfig ? `Edit Marg Config: ${editingConfig.companyCode}` : 'Create Marg EDE Configuration'}
        size="2xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Company Code</label>
              <input
                className="input"
                value={configForm.companyCode}
                onChange={(event) => setConfigForm((prev) => ({ ...prev, companyCode: event.target.value }))}
                placeholder="e.g. ABC_PHARMA"
              />
            </div>

            <div>
              <label className="label">Company ID</label>
              <input
                type="number"
                min={0}
                className="input"
                value={configForm.companyId}
                onChange={(event) => setConfigForm((prev) => ({ ...prev, companyId: event.target.value }))}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Marg Key {editingConfig ? '(leave empty to keep existing)' : ''}</label>
              <input
                type="password"
                className="input"
                value={configForm.margKey}
                onChange={(event) => setConfigForm((prev) => ({ ...prev, margKey: event.target.value }))}
                placeholder={editingConfig ? '********' : 'Enter Marg key'}
              />
            </div>

            <div>
              <label className="label">Decryption Key {editingConfig ? '(leave empty to keep existing)' : ''}</label>
              <input
                type="password"
                className="input"
                value={configForm.decryptionKey}
                onChange={(event) => setConfigForm((prev) => ({ ...prev, decryptionKey: event.target.value }))}
                placeholder={editingConfig ? '********' : 'Enter decryption key'}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">API Base URL</label>
              <input
                className="input"
                value={configForm.apiBaseUrl}
                onChange={(event) => setConfigForm((prev) => ({ ...prev, apiBaseUrl: event.target.value }))}
                placeholder="https://corporate.margerp.com"
              />
            </div>

            <div>
              <label className="label">Sync Frequency</label>
              <select
                className="input"
                value={configForm.syncFrequency}
                onChange={(event) =>
                  setConfigForm((prev) => ({
                    ...prev,
                    syncFrequency: event.target.value as ConfigFormState['syncFrequency'],
                  }))
                }
              >
                <option value="HOURLY">HOURLY</option>
                <option value="DAILY">DAILY</option>
                <option value="WEEKLY">WEEKLY</option>
              </select>
            </div>
          </div>

          {editingConfig && (
            <label className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                checked={configForm.isActive}
                onChange={(event) => setConfigForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              <span className="text-sm text-secondary-700 dark:text-secondary-300">Configuration is active</span>
            </label>
          )}

          <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-900/40 p-3 text-sm text-secondary-600 dark:text-secondary-300">
            <div className="flex items-start gap-2">
              <CloudArrowUpIcon className="w-5 h-5 mt-0.5 text-secondary-500" />
              <p>
                This page uses live production APIs only. Full sync updates inventory and accounting staging together, while Accounting Only advances just the accounting cursor and validations.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={closeConfigModal}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => void handleSaveConfig()}
              disabled={createConfigMutation.isPending || updateConfigMutation.isPending}
            >
              {createConfigMutation.isPending || updateConfigMutation.isPending
                ? 'Saving...'
                : editingConfig
                  ? 'Update Configuration'
                  : 'Create Configuration'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isRuleModalOpen}
        onClose={closeRuleModal}
        title={editingRule ? `Edit Mapping Rule: ${editingRule.ruleName}` : 'Create GL Mapping Rule'}
        size="2xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Rule Name</label>
              <input
                className="input"
                value={ruleForm.ruleName}
                onChange={(event) => setRuleForm((prev) => ({ ...prev, ruleName: event.target.value }))}
                placeholder="Retail sales receivable"
              />
            </div>
            <div>
              <label className="label">GL Account</label>
              <select
                className="input"
                value={ruleForm.glAccountId}
                onChange={(event) => setRuleForm((prev) => ({ ...prev, glAccountId: event.target.value }))}
                disabled={isGlAccountsLoading}
              >
                <option value="">Select an account</option>
                {(glAccounts || []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.accountNumber} - {account.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Company ID</label>
              <input
                className="input"
                value={ruleForm.companyId}
                onChange={(event) => setRuleForm((prev) => ({ ...prev, companyId: event.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="label">Book Code</label>
              <input
                className="input"
                value={ruleForm.bookCode}
                onChange={(event) => setRuleForm((prev) => ({ ...prev, bookCode: event.target.value.toUpperCase() }))}
                placeholder="SA"
              />
            </div>
            <div>
              <label className="label">Group Code</label>
              <input
                className="input"
                value={ruleForm.groupCode}
                onChange={(event) => setRuleForm((prev) => ({ ...prev, groupCode: event.target.value.toUpperCase() }))}
                placeholder="SALES"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Party Code</label>
              <input
                className="input"
                value={ruleForm.partyCode}
                onChange={(event) => setRuleForm((prev) => ({ ...prev, partyCode: event.target.value.toUpperCase() }))}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="label">Counterparty Code</label>
              <input
                className="input"
                value={ruleForm.counterpartyCode}
                onChange={(event) => setRuleForm((prev) => ({ ...prev, counterpartyCode: event.target.value.toUpperCase() }))}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="label">Priority</label>
              <input
                type="number"
                className="input"
                value={ruleForm.priority}
                onChange={(event) => setRuleForm((prev) => ({ ...prev, priority: event.target.value }))}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Remark Contains</label>
              <input
                className="input"
                value={ruleForm.remarkContains}
                onChange={(event) => setRuleForm((prev) => ({ ...prev, remarkContains: event.target.value }))}
                placeholder="Optional text match"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={ruleForm.isReceivableControl}
                  onChange={(event) => setRuleForm((prev) => ({ ...prev, isReceivableControl: event.target.checked }))}
                />
                <span className="text-sm text-secondary-700 dark:text-secondary-300">Receivable control account</span>
              </label>
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[100px]"
              value={ruleForm.description}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Optional internal note"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={closeRuleModal}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => void handleSaveRule()}
              disabled={createRuleMutation.isPending || updateRuleMutation.isPending}
            >
              {createRuleMutation.isPending || updateRuleMutation.isPending
                ? 'Saving...'
                : editingRule
                  ? 'Update Rule'
                  : 'Create Rule'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
