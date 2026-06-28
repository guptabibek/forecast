import { useMemo, useState } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { Button, EmptyState, DataTable } from '../ui';
import type { AiReportColumn, AiReportRow } from '../../services/api/ai-reporting.service';
import { columnField, exportRowsToCsv, formatAiValue, isCurrencyKey, isDisplayableAiColumn } from './ai-reporting-utils';
import type { Column } from '../ui/DataTable';

const PAGE_SIZE = 25;

interface AiReportTableProps {
  title?: string;
  columns: AiReportColumn[];
  rows: AiReportRow[];
  totals?: Record<string, number>;
}

export function AiReportTable({ title = 'ai-report', columns, rows }: AiReportTableProps) {
  const [page, setPage] = useState(1);
  const displayColumns = useMemo(
    () => columns.map((column) => ({ ...column, key: columnField(column) })).filter(isDisplayableAiColumn),
    [columns],
  );
  
  const tableColumns: Column<AiReportRow>[] = useMemo(() => {
    return displayColumns.map((col) => ({
      key: col.key,
      header: col.label || col.key,
      accessor: (row: AiReportRow) => formatAiValue(row[col.key], col),
      align: isCurrencyKey(col.key) ? 'right' : 'left',
    }));
  }, [displayColumns]);

  const pageRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [page, rows]);

  // Append a totals row if available (since DataTable doesn't support tfoot out of the box)
  // For a more robust approach, we can render the totals in a separate footer or inside DataTable,
  // but since DataTable lacks tfoot, we'll just let DataTable render the rows.

  if (!displayColumns.length || !rows.length) {
    return <EmptyState title="No data found" description="No matching rows were returned for this report." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 bg-gray-50">
        <div className="text-sm font-medium text-gray-700">{rows.length.toLocaleString('en-IN')} rows</div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
          onClick={() => exportRowsToCsv(`${title.replace(/\s+/g, '_').toLowerCase()}.csv`, displayColumns, rows)}
        >
          Export CSV
        </Button>
      </div>
      <DataTable
        data={pageRows}
        columns={tableColumns}
        keyExtractor={(row) => JSON.stringify(row)}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: rows.length,
          onPageChange: (p) => setPage(p),
          onPageSizeChange: () => {}, // AiReportTable doesn't support dynamic page size yet
        }}
      />
    </div>
  );
}
