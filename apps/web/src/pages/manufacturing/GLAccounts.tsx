import { Badge, Card, Column, DataTable, QueryErrorBanner } from '@components/ui';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useGridState } from '@/hooks/useGridState';
import { manufacturingService, type GLAccountType, type ManufacturingGlAccount } from '@services/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

const ACCOUNT_TYPE_OPTIONS = [
  { label: 'Asset', value: 'ASSET' },
  { label: 'Liability', value: 'LIABILITY' },
  { label: 'Equity', value: 'EQUITY' },
  { label: 'Revenue', value: 'REVENUE' },
  { label: 'Expense', value: 'EXPENSE' },
  { label: 'Contra Asset', value: 'CONTRA_ASSET' },
];

function accountTypeVariant(accountType: GLAccountType): 'primary' | 'secondary' | 'success' | 'warning' | 'error' {
  switch (accountType) {
    case 'ASSET': return 'primary';
    case 'LIABILITY': return 'warning';
    case 'EQUITY': return 'secondary';
    case 'REVENUE': return 'success';
    case 'EXPENSE': return 'error';
    default: return 'secondary';
  }
}

export default function GLAccountsPage() {
  const grid = useGridState({ initialSortBy: 'accountNumber', initialSortOrder: 'asc', initialPageSize: 50 });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'accounting', 'gl-accounts', grid.queryKey],
    queryFn: () => manufacturingService.getGLAccounts(grid.queryParams),
    placeholderData: (prev) => prev,
  });

  const rows: ManufacturingGlAccount[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const activeCount = rows.filter((row) => row.isActive).length;
  const systemCount = rows.filter((row) => row.isSystem).length;
  const parentCount = rows.filter((row) => (row.children?.length || 0) > 0).length;

  const columns = useMemo<Column<ManufacturingGlAccount>[]>(
    () => [
      {
        key: 'accountNumber',
        header: 'Account #',
        accessor: (row) => <span className="font-medium font-mono">{row.accountNumber}</span>,
        sortable: true,
        filterType: 'text',
        filterField: 'accountNumber',
      },
      {
        key: 'name',
        header: 'Name',
        accessor: 'name' as keyof ManufacturingGlAccount,
        sortable: true,
        filterType: 'text',
        filterField: 'name',
      },
      {
        key: 'accountType',
        header: 'Type',
        accessor: (row) => <Badge variant={accountTypeVariant(row.accountType)} size="sm">{row.accountType}</Badge>,
        filterType: 'select',
        filterField: 'accountType',
        filterOptions: ACCOUNT_TYPE_OPTIONS,
      },
      {
        key: 'normalBalance',
        header: 'Normal Balance',
        accessor: (row) => <Badge variant={row.normalBalance === 'DEBIT' ? 'primary' : 'warning'} size="sm">{row.normalBalance}</Badge>,
        filterType: 'select',
        filterField: 'normalBalance',
        filterOptions: [{ value: 'DEBIT', label: 'Debit' }, { value: 'CREDIT', label: 'Credit' }],
      },
      {
        key: 'isActive',
        header: 'Status',
        accessor: (row) => <Badge variant={row.isActive ? 'success' : 'secondary'} size="sm">{row.isActive ? 'Active' : 'Inactive'}</Badge>,
        filterType: 'select',
        filterField: 'isActive',
        filterOptions: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }],
      },
      {
        key: 'isSystem',
        header: 'System',
        accessor: (row) => <Badge variant={row.isSystem ? 'warning' : 'secondary'} size="sm">{row.isSystem ? 'System' : 'Manual'}</Badge>,
        filterType: 'select',
        filterField: 'isSystem',
        filterOptions: [{ value: 'true', label: 'System' }, { value: 'false', label: 'Manual' }],
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
        accessor: (row) => row.description || '—',
        className: 'whitespace-normal',
        filterType: 'text',
        filterField: 'description',
      },
    ],
    [],
  );

  return (
    <div className="space-y-4 lg:space-y-6 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold">GL Accounts</h1>
          <p className="text-secondary-500 mt-1">Chart of accounts. Filter per column · sort by clicking header · server-side.</p>
        </div>
        <button className="btn-secondary" onClick={() => void refetch()}>
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Total (filtered)</p>
          <p className="text-2xl font-bold mt-1">{total}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Active (page)</p>
          <p className="text-2xl font-bold mt-1">{activeCount}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">System (page)</p>
          <p className="text-2xl font-bold mt-1">{systemCount}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Parent (page)</p>
          <p className="text-2xl font-bold mt-1">{parentCount}</p>
        </Card>
      </div>

      <Card padding="none">
        <DataTable
          data={rows}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="No GL accounts match the selected filters."
          sorting={grid.sortingProps}
          filtering={grid.filteringProps}
          pagination={grid.paginationProps(total)}
        />
      </Card>
    </div>
  );
}
