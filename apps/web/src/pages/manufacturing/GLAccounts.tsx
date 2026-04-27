import { Badge, Card, Column, DataTable, QueryErrorBanner } from '@components/ui';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { manufacturingService, type GLAccountType, type ManufacturingGlAccount } from '@services/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

const ACCOUNT_TYPE_OPTIONS: Array<{ label: string; value: 'ALL' | GLAccountType }> = [
  { label: 'All Types', value: 'ALL' },
  { label: 'Asset', value: 'ASSET' },
  { label: 'Liability', value: 'LIABILITY' },
  { label: 'Equity', value: 'EQUITY' },
  { label: 'Revenue', value: 'REVENUE' },
  { label: 'Expense', value: 'EXPENSE' },
  { label: 'Contra Asset', value: 'CONTRA_ASSET' },
];

function accountTypeVariant(accountType: GLAccountType): 'primary' | 'secondary' | 'success' | 'warning' | 'error' {
  switch (accountType) {
    case 'ASSET':
      return 'primary';
    case 'LIABILITY':
      return 'warning';
    case 'EQUITY':
      return 'secondary';
    case 'REVENUE':
      return 'success';
    case 'EXPENSE':
      return 'error';
    default:
      return 'secondary';
  }
}

export default function GLAccountsPage() {
  const [accountTypeFilter, setAccountTypeFilter] = useState<'ALL' | GLAccountType>('ALL');
  const [activityFilter, setActivityFilter] = useState<'all' | 'active' | 'inactive'>('active');

  const {
    data: accounts,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['manufacturing', 'accounting', 'gl-accounts', accountTypeFilter, activityFilter],
    queryFn: () =>
      manufacturingService.getGLAccounts({
        accountType: accountTypeFilter === 'ALL' ? undefined : accountTypeFilter,
        isActive: activityFilter === 'all' ? undefined : activityFilter === 'active',
      }),
  });

  const rows = accounts || [];
  const activeCount = rows.filter((row) => row.isActive).length;
  const systemCount = rows.filter((row) => row.isSystem).length;
  const parentCount = rows.filter((row) => (row.children?.length || 0) > 0).length;

  const columns = useMemo<Column<ManufacturingGlAccount>[]>(
    () => [
      {
        key: 'accountNumber',
        header: 'Account',
        accessor: (row) => (
          <div>
            <div className="font-medium">{row.accountNumber}</div>
            <div className="text-xs text-secondary-500">{row.name}</div>
          </div>
        ),
        className: 'whitespace-normal',
      },
      {
        key: 'type',
        header: 'Type',
        accessor: (row) => <Badge variant={accountTypeVariant(row.accountType)} size="sm">{row.accountType}</Badge>,
      },
      {
        key: 'normalBalance',
        header: 'Normal Balance',
        accessor: (row) => <Badge variant={row.normalBalance === 'DEBIT' ? 'primary' : 'warning'} size="sm">{row.normalBalance}</Badge>,
      },
      {
        key: 'status',
        header: 'Status',
        accessor: (row) => <Badge variant={row.isActive ? 'success' : 'secondary'} size="sm">{row.isActive ? 'Active' : 'Inactive'}</Badge>,
      },
      {
        key: 'system',
        header: 'System',
        accessor: (row) => <Badge variant={row.isSystem ? 'warning' : 'secondary'} size="sm">{row.isSystem ? 'System' : 'Manual'}</Badge>,
      },
      {
        key: 'children',
        header: 'Child Accounts',
        accessor: (row) => row.children?.length || 0,
        align: 'right',
      },
      {
        key: 'description',
        header: 'Description',
        accessor: (row) => row.description || '-',
        className: 'whitespace-normal',
      },
    ],
    [],
  );

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">GL Accounts</h1>
          <p className="text-secondary-500 mt-1">Read-only chart of accounts view for production accounting verification and Marg mapping setup.</p>
        </div>
        <button className="btn-secondary" onClick={() => void refetch()}>
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Accounts</p>
          <p className="text-2xl font-bold mt-1">{rows.length}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Active</p>
          <p className="text-2xl font-bold mt-1">{activeCount}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">System Managed</p>
          <p className="text-2xl font-bold mt-1">{systemCount}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Parent Accounts</p>
          <p className="text-2xl font-bold mt-1">{parentCount}</p>
        </Card>
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Account Type</label>
            <select
              className="input"
              value={accountTypeFilter}
              onChange={(event) => setAccountTypeFilter(event.target.value as 'ALL' | GLAccountType)}
            >
              {ACCOUNT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={activityFilter}
              onChange={(event) => setActivityFilter(event.target.value as 'all' | 'active' | 'inactive')}
            >
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <DataTable
          data={rows}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="No GL accounts match the selected filters."
        />
      </Card>
    </div>
  );
}
