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
    MargAnyStagedRow,
    MargStagedBranch,
    MargStagedParty,
    MargStagedProduct,
    MargStagedStock,
    MargStagedTransaction,
    MargSyncConfig,
    MargSyncLog,
    MargSyncStatus,
    UpdateMargConfigDto,
    useCreateMargConfig,
    useDeleteMargConfig,
    useMargConfigs,
    useMargOverview,
    useMargStagedBranches,
    useMargStagedParties,
    useMargStagedProducts,
    useMargStagedStock,
    useMargStagedTransactions,
    useMargSyncLogs,
    useTestMargConnection,
    useTriggerMargSync,
    useUpdateMargConfig,
} from '@hooks/useMargEde';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

type StagedTabKey = 'branches' | 'products' | 'parties' | 'transactions' | 'stock';

type ConfigFormState = {
  companyCode: string;
  margKey: string;
  decryptionKey: string;
  apiBaseUrl: string;
  companyId: string;
  syncFrequency: 'HOURLY' | 'DAILY' | 'WEEKLY';
  isActive: boolean;
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

const stagedTabLabels: Array<{ key: StagedTabKey; label: string }> = [
  { key: 'branches', label: 'Branches' },
  { key: 'products', label: 'Products' },
  { key: 'parties', label: 'Parties' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'stock', label: 'Stock' },
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

export default function MargEdePage() {
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<MargSyncConfig | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | undefined>();
  const [configForm, setConfigForm] = useState<ConfigFormState>(DEFAULT_FORM);

  const [stagedTab, setStagedTab] = useState<StagedTabKey>('branches');
  const [stagedPage, setStagedPage] = useState<Record<StagedTabKey, number>>({
    branches: 1,
    products: 1,
    parties: 1,
    transactions: 1,
    stock: 1,
  });
  const [stagedPageSize, setStagedPageSize] = useState<Record<StagedTabKey, number>>({
    branches: 25,
    products: 25,
    parties: 25,
    transactions: 25,
    stock: 25,
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

  const createConfigMutation = useCreateMargConfig();
  const updateConfigMutation = useUpdateMargConfig();
  const deleteConfigMutation = useDeleteMargConfig();
  const testConnectionMutation = useTestMargConnection();
  const triggerSyncMutation = useTriggerMargSync();

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

  const selectedConfig = useMemo(
    () => configs?.find((config) => config.id === selectedConfigId) || null,
    [configs, selectedConfigId],
  );

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
      default:
        return stagedStockQuery;
    }
  }, [stagedBranchesQuery, stagedPartiesQuery, stagedProductsQuery, stagedStockQuery, stagedTab, stagedTransactionsQuery]);

  const stagedRows = (activeStagedQuery.data?.items || []) as MargAnyStagedRow[];
  const stagedTotal = activeStagedQuery.data?.total || 0;

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
      key: 'syncStatus',
      header: 'Sync Status',
      accessor: (row) => <Badge variant={statusVariant(row.lastSyncStatus)} size="sm">{row.lastSyncStatus}</Badge>,
    },
    {
      key: 'lastSyncAt',
      header: 'Last Sync',
      accessor: (row) => formatDateTime(row.lastSyncAt),
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
              handleTestConnection(row.id);
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
              handleTriggerSync(row.id);
            }}
            disabled={triggerSyncMutation.isPending || row.lastSyncStatus === 'RUNNING' || !row.isActive}
          >
            <PlayIcon className="w-4 h-4 mr-1" />
            Sync
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
              handleDeleteConfig(row);
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
      accessor: (row) => formatNumber(row.productsSynced + row.partiesSynced + row.transactionsSynced + row.stockSynced),
      align: 'right',
    },
    {
      key: 'branches',
      header: 'Branches',
      accessor: (row) => formatNumber(row.branchesSynced),
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

  const stagedColumns = useMemo<Column<MargAnyStagedRow>[]>(() => {
    if (stagedTab === 'branches') {
      const cols: Column<MargStagedBranch>[] = [
        { key: 'companyId', header: 'Company ID', accessor: (row) => String(row.companyId) },
        { key: 'name', header: 'Name', accessor: 'name' },
        { key: 'branch', header: 'Branch', accessor: (row) => row.branch || '-' },
        { key: 'storeId', header: 'Store ID', accessor: (row) => row.storeId || '-' },
        { key: 'licence', header: 'Licence', accessor: (row) => row.licence || '-' },
        { key: 'locationId', header: 'Location', accessor: (row) => row.locationId ? 'Linked' : 'Pending', },
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

    const cols: Column<MargStagedStock>[] = [
      { key: 'pid', header: 'PID', accessor: 'pid' },
      { key: 'batch', header: 'Batch', accessor: 'batch' },
      { key: 'stock', header: 'Stock', accessor: (row) => formatNumber(row.stock), align: 'right' },
      { key: 'mrp', header: 'MRP', accessor: (row) => formatNumber(row.mrp), align: 'right' },
      { key: 'expiry', header: 'Expiry', accessor: (row) => formatDate(row.expiry) },
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

  async function handleTriggerSync(configId: string) {
    try {
      const result = await triggerSyncMutation.mutateAsync(configId);
      toast.success(result.message || 'Sync job queued successfully.');
      refetchLogs();
      refetchOverview();
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

  const activeConfigCount = overview?.configs.filter((config) => config.isActive).length || 0;

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Marg EDE Integration</h1>
          <p className="text-secondary-500 mt-1">
            Configure Marg ERP connectivity, run sync jobs, and inspect staged data.
          </p>
        </div>
        <button className="btn-primary" onClick={openCreateModal}>
          <PlusIcon className="w-5 h-5 mr-2" />
          New Marg Config
        </button>
      </div>

      {isOverviewError && <QueryErrorBanner error={overviewError} onRetry={() => refetchOverview()} />}
      {isConfigsError && <QueryErrorBanner error={configsError} onRetry={() => refetchConfigs()} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
          <p className="text-sm text-secondary-500">Selected Config Status</p>
          <div className="mt-2">
            {selectedConfig ? (
              <Badge variant={statusVariant(selectedConfig.lastSyncStatus)}>{selectedConfig.lastSyncStatus}</Badge>
            ) : (
              <Badge variant="secondary">No config selected</Badge>
            )}
          </div>
        </Card>
      </div>

      <Card padding="none">
        <div className="p-6 border-b border-secondary-200 dark:border-secondary-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Configurations</h2>
            <p className="text-sm text-secondary-500">Manage Marg credentials, company scope, and sync cadence.</p>
          </div>
          <button
            className="btn-secondary"
            onClick={() => {
              refetchConfigs();
              refetchOverview();
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
            <p className="text-sm text-secondary-500">Review sync execution history and record counts.</p>
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
            <button className="btn-secondary" onClick={() => refetchLogs()} disabled={!selectedConfigId}>
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

      <Card padding="none">
        <div className="p-6 border-b border-secondary-200 dark:border-secondary-700">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold">Staged Data</h2>
              <p className="text-sm text-secondary-500">Inspect raw entities synchronized from Marg before transformation.</p>
            </div>
            <button className="btn-secondary" onClick={() => activeStagedQuery.refetch()}>
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
                This page uses live production APIs only. Triggering sync will enqueue a real background job and update staged data tables.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={closeConfigModal}>Cancel</button>
            <button
              className="btn-primary"
              onClick={handleSaveConfig}
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
    </div>
  );
}
