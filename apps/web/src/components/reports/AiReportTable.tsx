import { useMemo, useState } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { Button, EmptyState, Pagination } from '../ui';
import type { AiReportColumn, AiReportRow } from '../../services/api/ai-reporting.service';
import { columnField, exportRowsToCsv, formatAiValue, isCurrencyKey } from './ai-reporting-utils';

const PAGE_SIZE = 25;

interface AiReportTableProps {
  title?: string;
  columns: AiReportColumn[];
  rows: AiReportRow[];
  totals?: Record<string, number>;
}

export function AiReportTable({ title = 'ai-report', columns, rows, totals }: AiReportTableProps) {
  const [page, setPage] = useState(1);
  const displayColumns = useMemo(
    () => columns.map((column) => ({ ...column, key: columnField(column) })).filter((column) => column.key),
    [columns],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [page, rows]);
  const hasTotals = !!totals && Object.keys(totals).length > 0;

  if (!displayColumns.length || !rows.length) {
    return <EmptyState title="No data found" description="No matching rows were returned for this report." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="text-sm font-medium text-gray-700">{rows.length.toLocaleString('en-IN')} rows</div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
          onClick={() => exportRowsToCsv(`${title.replace(/\s+/g, '_').toLowerCase()}.csv`, columns, rows)}
        >
          Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {displayColumns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 ${
                    isCurrencyKey(column.key) ? 'text-right' : ''
                  }`}
                >
                  {column.label || column.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {pageRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50">
                {displayColumns.map((column) => (
                  <td
                    key={column.key}
                    className={`whitespace-nowrap px-4 py-3 text-gray-700 ${
                      typeof row[column.key] === 'number' || isCurrencyKey(column.key) ? 'text-right font-medium tabular-nums' : ''
                    }`}
                  >
                    {formatAiValue(row[column.key], column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasTotals && (
            <tfoot className="border-t border-gray-200 bg-gray-50">
              <tr>
                {displayColumns.map((column, index) => (
                  <td
                    key={column.key}
                    className={`whitespace-nowrap px-4 py-3 text-sm font-semibold text-gray-900 ${
                      totals[column.key] !== undefined || isCurrencyKey(column.key) ? 'text-right tabular-nums' : ''
                    }`}
                  >
                    {totals[column.key] !== undefined
                      ? formatAiValue(totals[column.key], column)
                      : index === 0
                        ? 'Total'
                        : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        total={rows.length}
        pageSize={PAGE_SIZE}
        onPageChange={(nextPage) => setPage(Math.min(Math.max(nextPage, 1), totalPages))}
      />
    </div>
  );
}
