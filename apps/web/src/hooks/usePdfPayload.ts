import { useMemo } from 'react';
import type { ReportExportPayload, PdfField, PdfTable, PdfTableColumn } from '../services/report-pdf.service';

interface ColumnDef {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
}

interface UsePdfPayloadOptions {
  title: string;
  reportKey: string;
  columns: ColumnDef[];
  data: Array<Record<string, unknown>>;
  filters?: Record<string, unknown>;
  summaryFields?: PdfField[];
  totals?: PdfField[];
  exportMode?: 'current-page' | 'all';
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildAppliedFilters(filters?: Record<string, unknown>): Record<string, string> {
  if (!filters) return {};
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val != null && val !== '' && key !== 'limit' && key !== 'offset' && key !== 'sortBy' && key !== 'sortDir') {
      result[key] = String(val);
    }
  }
  return result;
}

export function usePdfPayload({
  title,
  reportKey,
  columns,
  data,
  filters,
  summaryFields,
  totals,
  exportMode = 'current-page',
}: UsePdfPayloadOptions): ReportExportPayload {
  return useMemo<ReportExportPayload>(() => {
    const tableColumns: PdfTableColumn[] = columns.map((col) => ({
      key: col.key,
      header: col.header,
      align: col.align || 'left',
    }));

    const tableRows = data.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const col of columns) {
        mapped[col.key] = formatCellValue(row[col.key]);
      }
      return mapped;
    });

    const fields: PdfField[] = summaryFields ?? [
      { label: 'Report', value: title },
      { label: 'Records', value: data.length },
      { label: 'Generated', value: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) },
    ];

    const tables: PdfTable[] = tableRows.length
      ? [{ title: `${title} (${data.length} rows)`, columns: tableColumns, rows: tableRows }]
      : [];

    return {
      title,
      reportKey,
      fields,
      tables,
      totals: totals ?? [],
      appliedFilters: buildAppliedFilters(filters),
      exportMode,
    };
  }, [title, reportKey, columns, data, filters, summaryFields, totals, exportMode]);
}
