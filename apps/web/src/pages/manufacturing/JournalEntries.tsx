import { Badge, Card, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { DetailPopupActions } from '@components/reports/DetailPopupActions';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useGridState } from '@/hooks/useGridState';
import {
    manufacturingService,
    type ManufacturingJournalEntry,
    type ManufacturingJournalEntryLine,
} from '@services/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

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
  const [selectedEntryId, setSelectedEntryId] = useState<string | undefined>();
  const [showDetail, setShowDetail] = useState(false);
  const grid = useGridState({ initialSortBy: 'createdAt', initialSortOrder: 'desc', initialPageSize: 50 });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'accounting', 'journal-entries', grid.queryKey],
    queryFn: () => manufacturingService.getJournalEntries(grid.queryParams),
    placeholderData: (prev) => prev,
  });

  const entries = data?.entries || [];
  const total = (data as any)?.total ?? entries.length;
  const postedCount = entries.filter((entry) => entry.status === 'POSTED').length;
  const reversedCount = entries.filter((entry) => entry.status === 'REVERSED').length;
  const totalDebits = entries.reduce((sum, entry) => sum + calculateTotal(entry.lines, 'debitAmount'), 0);
  const totalCredits = entries.reduce((sum, entry) => sum + calculateTotal(entry.lines, 'creditAmount'), 0);

  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) || null;

  const entryColumns = useMemo<Column<ManufacturingJournalEntry>[]>(
    () => [
      {
        key: 'entryNumber',
        header: 'Entry #',
        accessor: (row) => <span className="font-mono">{(row as any).entryNumber || row.id.slice(0, 8)}</span>,
        sortable: true,
        filterType: 'text',
        filterField: 'entryNumber',
      },
      {
        key: 'entryDate',
        header: 'Entry Date',
        accessor: (row) => formatDateTime(row.entryDate),
        sortable: true,
        filterType: 'date',
        filterField: 'entryDate',
      },
      {
        key: 'status',
        header: 'Status',
        accessor: (row) => <Badge variant={row.status === 'POSTED' ? 'success' : 'warning'} size="sm">{row.status}</Badge>,
        filterType: 'select',
        filterField: 'status',
        filterOptions: [
          { value: 'DRAFT', label: 'Draft' },
          { value: 'POSTED', label: 'Posted' },
          { value: 'REVERSED', label: 'Reversed' },
        ],
      },
      {
        key: 'referenceType',
        header: 'Ref Type',
        accessor: (row) => row.referenceType || '—',
        filterType: 'text',
        filterField: 'referenceType',
      },
      {
        key: 'description',
        header: 'Description',
        accessor: (row) => row.description || '—',
        className: 'whitespace-normal',
        filterType: 'text',
        filterField: 'description',
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
        accessor: (row) => row.glAccount ? `${row.glAccount.accountNumber} - ${row.glAccount.name}` : row.glAccountId,
        className: 'whitespace-normal',
      },
      { key: 'accountType', header: 'Type', accessor: (row) => row.glAccount?.accountType || '—' },
      { key: 'debitAmount', header: 'Debit', accessor: (row) => formatCurrency(row.debitAmount), align: 'right' },
      { key: 'creditAmount', header: 'Credit', accessor: (row) => formatCurrency(row.creditAmount), align: 'right' },
      { key: 'description', header: 'Line Description', accessor: (row) => row.description || '—', className: 'whitespace-normal' },
    ],
    [],
  );

  return (
    <div className="space-y-4 lg:space-y-6 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold">Journal Entries</h1>
          <p className="text-xs lg:text-sm text-secondary-500 mt-1">Posted and reversed journal activity. Filter per column · sort by clicking header.</p>
        </div>
        <button className="btn-secondary" onClick={() => void refetch()}>
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Refresh
        </button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <Card padding="sm">
          <p className="text-xs lg:text-sm text-secondary-500">Total (filtered)</p>
          <p className="text-xl lg:text-2xl font-bold mt-1">{total}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs lg:text-sm text-secondary-500">Posted (page)</p>
          <p className="text-xl lg:text-2xl font-bold mt-1">{postedCount}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs lg:text-sm text-secondary-500">Debits (page)</p>
          <p className="text-xl lg:text-2xl font-bold mt-1">{formatCurrency(totalDebits)}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs lg:text-sm text-secondary-500">Credits (page)</p>
          <p className="text-xl lg:text-2xl font-bold mt-1">{formatCurrency(totalCredits)}</p>
        </Card>
      </div>

      <Card padding="none">
        <DataTable
          data={entries}
          columns={entryColumns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="No journal entries match the selected filters."
          onRowClick={(row) => { setSelectedEntryId(row.id); setShowDetail(true); }}
          sorting={grid.sortingProps}
          filtering={grid.filteringProps}
          pagination={grid.paginationProps(total)}
        />
      </Card>

      <Modal
        isOpen={showDetail}
        onClose={() => setShowDetail(false)}
        title={
          selectedEntry
            ? `Journal Entry: ${(selectedEntry as any).entryNumber || selectedEntry.id.slice(0, 8)}`
            : 'Journal Entry'
        }
        size="full"
      >
        {selectedEntry && (
          <div className="space-y-4">
            <DetailPopupActions
              title="Journal Entry"
              documentNumber={(selectedEntry as any).entryNumber || selectedEntry.id.slice(0, 8)}
              fields={[
                { label: 'Entry #', value: (selectedEntry as any).entryNumber || selectedEntry.id.slice(0, 8) },
                { label: 'Date', value: formatDateTime(selectedEntry.entryDate) },
                { label: 'Status', value: selectedEntry.status },
                { label: 'Reference Type', value: selectedEntry.referenceType },
                { label: 'Description', value: selectedEntry.description },
                { label: 'Lines', value: selectedEntry.lines.length },
              ]}
              tables={[{
                title: 'Journal Lines',
                columns: [
                  { key: 'glAccount', header: 'GL Account' },
                  { key: 'accountType', header: 'Type' },
                  { key: 'debitAmount', header: 'Debit', align: 'right' },
                  { key: 'creditAmount', header: 'Credit', align: 'right' },
                  { key: 'description', header: 'Description' },
                ],
                rows: selectedEntry.lines.map((l) => ({
                  glAccount: l.glAccount ? `${l.glAccount.accountNumber} - ${l.glAccount.name}` : l.glAccountId,
                  accountType: l.glAccount?.accountType || '—',
                  debitAmount: formatCurrency(l.debitAmount),
                  creditAmount: formatCurrency(l.creditAmount),
                  description: l.description || '—',
                })),
              }]}
              totals={[
                { label: 'Total Debits', value: formatCurrency(calculateTotal(selectedEntry.lines, 'debitAmount')) },
                { label: 'Total Credits', value: formatCurrency(calculateTotal(selectedEntry.lines, 'creditAmount')) },
                { label: 'Balance', value: formatCurrency(calculateTotal(selectedEntry.lines, 'debitAmount') - calculateTotal(selectedEntry.lines, 'creditAmount')) },
              ]}
            />
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <p className="text-sm text-secondary-500 mt-1">
                  {formatDateTime(selectedEntry.entryDate)}
                  {selectedEntry.description ? ` • ${selectedEntry.description}` : ''}
                </p>
                {selectedEntry.referenceType && (
                  <p className="text-xs text-secondary-500">Ref: {selectedEntry.referenceType}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={selectedEntry.status === 'POSTED' ? 'success' : 'warning'}>
                  {selectedEntry.status}
                </Badge>
                <span className="text-sm text-secondary-500">{selectedEntry.lines.length} lines</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4">
                <p className="text-sm text-secondary-500">Debits</p>
                <p className="text-xl font-semibold mt-1">
                  {formatCurrency(calculateTotal(selectedEntry.lines, 'debitAmount'))}
                </p>
              </div>
              <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4">
                <p className="text-sm text-secondary-500">Credits</p>
                <p className="text-xl font-semibold mt-1">
                  {formatCurrency(calculateTotal(selectedEntry.lines, 'creditAmount'))}
                </p>
              </div>
              <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4">
                <p className="text-sm text-secondary-500">Balance Check</p>
                <p
                  className={`text-xl font-semibold mt-1 ${
                    Math.abs(
                      calculateTotal(selectedEntry.lines, 'debitAmount') -
                        calculateTotal(selectedEntry.lines, 'creditAmount'),
                    ) < 0.01
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}
                >
                  {formatCurrency(
                    calculateTotal(selectedEntry.lines, 'debitAmount') -
                      calculateTotal(selectedEntry.lines, 'creditAmount'),
                  )}
                </p>
              </div>
            </div>
            <DataTable
              data={selectedEntry.lines}
              columns={lineColumns}
              keyExtractor={(row) => row.id}
              emptyMessage="No journal lines on this entry."
            />
          </div>
        )}
      </Modal>

      {reversedCount > 0 && (
        <Card padding="sm">
          <p className="text-xs lg:text-sm text-secondary-500">Reversed entries in current page</p>
          <p className="text-xl lg:text-2xl font-bold mt-1">{reversedCount}</p>
        </Card>
      )}
    </div>
  );
}
