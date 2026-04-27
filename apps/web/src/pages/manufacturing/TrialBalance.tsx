import { Badge, Card, Column, DataTable, QueryErrorBanner } from '@components/ui';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { manufacturingService, type ManufacturingTrialBalanceRow } from '@services/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

function toNumber(value: number | string): number {
  return Number(value || 0);
}

function formatCurrency(value: number | string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

export default function TrialBalancePage() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showZeroRows, setShowZeroRows] = useState(false);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['manufacturing', 'accounting', 'trial-balance', startDate, endDate],
    queryFn: () =>
      manufacturingService.getTrialBalance({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
  });

  const rows = data || [];
  const displayedRows = useMemo(
    () =>
      showZeroRows
        ? rows
        : rows.filter((row) => toNumber(row.total_debits) !== 0 || toNumber(row.total_credits) !== 0 || toNumber(row.net_balance) !== 0),
    [rows, showZeroRows],
  );

  const totalDebits = displayedRows.reduce((sum, row) => sum + toNumber(row.total_debits), 0);
  const totalCredits = displayedRows.reduce((sum, row) => sum + toNumber(row.total_credits), 0);
  const netDifference = totalDebits - totalCredits;

  const columns = useMemo<Column<ManufacturingTrialBalanceRow>[]>(
    () => [
      {
        key: 'account_number',
        header: 'Account',
        accessor: (row) => (
          <div>
            <div className="font-medium">{row.account_number}</div>
            <div className="text-xs text-secondary-500">{row.name}</div>
          </div>
        ),
        className: 'whitespace-normal',
      },
      {
        key: 'account_type',
        header: 'Type',
        accessor: (row) => row.account_type,
      },
      {
        key: 'normal_balance',
        header: 'Normal Balance',
        accessor: (row) => <Badge variant={row.normal_balance === 'DEBIT' ? 'primary' : 'warning'} size="sm">{row.normal_balance}</Badge>,
      },
      {
        key: 'total_debits',
        header: 'Debits',
        accessor: (row) => formatCurrency(row.total_debits),
        align: 'right',
      },
      {
        key: 'total_credits',
        header: 'Credits',
        accessor: (row) => formatCurrency(row.total_credits),
        align: 'right',
      },
      {
        key: 'net_balance',
        header: 'Net Balance',
        accessor: (row) => (
          <span className={toNumber(row.net_balance) === 0 ? 'text-secondary-500' : toNumber(row.net_balance) > 0 ? 'text-green-600' : 'text-red-600'}>
            {formatCurrency(row.net_balance)}
          </span>
        ),
        align: 'right',
      },
    ],
    [],
  );

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Trial Balance</h1>
          <p className="text-secondary-500 mt-1">Validate posted ledger balances over a chosen accounting window without leaving the manufacturing workspace.</p>
        </div>
        <button className="btn-secondary" onClick={() => void refetch()}>
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Accounts Shown</p>
          <p className="text-2xl font-bold mt-1">{displayedRows.length}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Total Debits</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(totalDebits)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Total Credits</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(totalCredits)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Balance Check</p>
          <p className={`text-2xl font-bold mt-1 ${netDifference === 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(netDifference)}
          </p>
        </Card>
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Start Date</label>
            <input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div>
            <label className="label">End Date</label>
            <input className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2">
              <input type="checkbox" checked={showZeroRows} onChange={(event) => setShowZeroRows(event.target.checked)} />
              <span className="text-sm text-secondary-700 dark:text-secondary-300">Show zero-balance rows</span>
            </label>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <DataTable
          data={displayedRows}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="No trial balance rows match the selected filters."
        />
      </Card>
    </div>
  );
}
