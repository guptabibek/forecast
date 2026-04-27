import { Badge, Card, Column, DataTable, QueryErrorBanner } from '@components/ui';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import {
    manufacturingService,
    type JournalEntryStatus,
    type ManufacturingJournalEntry,
    type ManufacturingJournalEntryLine,
} from '@services/api';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatCurrency(value: number | string): string {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(numeric);
}

function calculateTotal(lines: ManufacturingJournalEntryLine[], field: 'debitAmount' | 'creditAmount'): number {
  return lines.reduce((sum, line) => sum + Number(line[field] || 0), 0);
}

export default function JournalEntriesPage() {
  const [statusFilter, setStatusFilter] = useState<'ALL' | JournalEntryStatus>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string | undefined>();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['manufacturing', 'accounting', 'journal-entries', statusFilter, startDate, endDate],
    queryFn: () =>
      manufacturingService.getJournalEntries({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
  });

  const entries = data?.entries || [];
  const postedCount = entries.filter((entry) => entry.status === 'POSTED').length;
  const reversedCount = entries.filter((entry) => entry.status === 'REVERSED').length;
  const totalDebits = entries.reduce((sum, entry) => sum + calculateTotal(entry.lines, 'debitAmount'), 0);
  const totalCredits = entries.reduce((sum, entry) => sum + calculateTotal(entry.lines, 'creditAmount'), 0);

  useEffect(() => {
    if (!entries.length) {
      setSelectedEntryId(undefined);
      return;
    }

    const currentExists = selectedEntryId && entries.some((entry) => entry.id === selectedEntryId);
    if (!currentExists) {
      setSelectedEntryId(entries[0].id);
    }
  }, [entries, selectedEntryId]);

  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) || null;

  const entryColumns = useMemo<Column<ManufacturingJournalEntry>[]>(
    () => [
      {
        key: 'entryDate',
        header: 'Entry Date',
        accessor: (row) => formatDateTime(row.entryDate),
      },
      {
        key: 'status',
        header: 'Status',
        accessor: (row) => <Badge variant={row.status === 'POSTED' ? 'success' : 'warning'} size="sm">{row.status}</Badge>,
      },
      {
        key: 'reference',
        header: 'Reference',
        accessor: (row) => row.referenceType ? `${row.referenceType}${row.referenceId ? ` • ${row.referenceId}` : ''}` : '-',
        className: 'whitespace-normal',
      },
      {
        key: 'description',
        header: 'Description',
        accessor: (row) => row.description || '-',
        className: 'whitespace-normal',
      },
      {
        key: 'lines',
        header: 'Lines',
        accessor: (row) => row.lines.length,
        align: 'right',
      },
      {
        key: 'debits',
        header: 'Debits',
        accessor: (row) => formatCurrency(calculateTotal(row.lines, 'debitAmount')),
        align: 'right',
      },
      {
        key: 'credits',
        header: 'Credits',
        accessor: (row) => formatCurrency(calculateTotal(row.lines, 'creditAmount')),
        align: 'right',
      },
    ],
    [],
  );

  const lineColumns = useMemo<Column<ManufacturingJournalEntryLine>[]>(
    () => [
      {
        key: 'glAccount',
        header: 'GL Account',
        accessor: (row) =>
          row.glAccount ? `${row.glAccount.accountNumber} - ${row.glAccount.name}` : row.glAccountId,
        className: 'whitespace-normal',
      },
      {
        key: 'accountType',
        header: 'Type',
        accessor: (row) => row.glAccount?.accountType || '-',
      },
      {
        key: 'debitAmount',
        header: 'Debit',
        accessor: (row) => formatCurrency(row.debitAmount),
        align: 'right',
      },
      {
        key: 'creditAmount',
        header: 'Credit',
        accessor: (row) => formatCurrency(row.creditAmount),
        align: 'right',
      },
      {
        key: 'description',
        header: 'Line Description',
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
          <h1 className="text-2xl font-bold">Journal Entries</h1>
          <p className="text-secondary-500 mt-1">Inspect posted and reversed journal activity from the live manufacturing accounting ledger. The API currently returns the latest 50 matching entries.</p>
        </div>
        <button className="btn-secondary" onClick={() => void refetch()}>
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Entries</p>
          <p className="text-2xl font-bold mt-1">{entries.length}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Posted</p>
          <p className="text-2xl font-bold mt-1">{postedCount}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Debits</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(totalDebits)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Credits</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(totalCredits)}</p>
        </Card>
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'ALL' | JournalEntryStatus)}
            >
              <option value="ALL">All</option>
              <option value="POSTED">Posted</option>
              <option value="REVERSED">Reversed</option>
            </select>
          </div>
          <div>
            <label className="label">Start Date</label>
            <input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div>
            <label className="label">End Date</label>
            <input className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
        </div>
      </Card>

      <Card padding="none">
        <DataTable
          data={entries}
          columns={entryColumns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="No journal entries match the selected filters."
          onRowClick={(row) => setSelectedEntryId(row.id)}
        />
      </Card>

      {selectedEntry && (
        <Card padding="none">
          <div className="p-6 border-b border-secondary-200 dark:border-secondary-700">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Selected Entry</h2>
                <p className="text-sm text-secondary-500 mt-1">
                  {formatDateTime(selectedEntry.entryDate)}
                  {selectedEntry.description ? ` • ${selectedEntry.description}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={selectedEntry.status === 'POSTED' ? 'success' : 'warning'}>{selectedEntry.status}</Badge>
                <span className="text-sm text-secondary-500">{selectedEntry.lines.length} lines</span>
              </div>
            </div>
            {selectedEntry.referenceType && (
              <p className="text-sm text-secondary-500 mt-3">
                Reference: {selectedEntry.referenceType}
                {selectedEntry.referenceId ? ` • ${selectedEntry.referenceId}` : ''}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4">
                <p className="text-sm text-secondary-500">Debits</p>
                <p className="text-xl font-semibold mt-1">{formatCurrency(calculateTotal(selectedEntry.lines, 'debitAmount'))}</p>
              </div>
              <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4">
                <p className="text-sm text-secondary-500">Credits</p>
                <p className="text-xl font-semibold mt-1">{formatCurrency(calculateTotal(selectedEntry.lines, 'creditAmount'))}</p>
              </div>
              <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4">
                <p className="text-sm text-secondary-500">Balance Check</p>
                <p className="text-xl font-semibold mt-1">{formatCurrency(calculateTotal(selectedEntry.lines, 'debitAmount') - calculateTotal(selectedEntry.lines, 'creditAmount'))}</p>
              </div>
            </div>
          </div>
          <DataTable
            data={selectedEntry.lines}
            columns={lineColumns}
            keyExtractor={(row) => row.id}
            emptyMessage="No journal lines on this entry."
          />
        </Card>
      )}

      {reversedCount > 0 && (
        <Card padding="sm">
          <p className="text-sm text-secondary-500">Reversed entries in current result set</p>
          <p className="text-2xl font-bold mt-1">{reversedCount}</p>
        </Card>
      )}
    </div>
  );
}
