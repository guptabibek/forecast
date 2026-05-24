import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import type { Column } from '../../components/ui';
import { pharmaReportsService } from '../../services/api/pharma-reports.service';
import { formatIndianNumber, formatInr } from '../../utils/number-format';

export type ExportFormat = 'csv' | 'xlsx';

// Columns hidden from every client-facing report table. Clients run a single
// branch/location, so the Location column is redundant; SKU is hidden by request
// (the product name identifies the row, and the raw Marg codes are noisy).
// Centralised so there is exactly one place to flip if a tenant ever needs
// multi-branch. Apply by wrapping a report's column array: reportCols([...]).
export const HIDDEN_REPORT_COLUMN_KEYS = new Set(['sku', 'location_code']);

export function reportCols<T>(cols: Column<T>[]): Column<T>[] {
  return cols.filter((c) => !HIDDEN_REPORT_COLUMN_KEYS.has(c.key));
}

export function useReportExport() {
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);

  const exportReport = useCallback(
    async (reportType: string, format: ExportFormat, filters?: Record<string, unknown>) => {
      setExportingFormat(format);
      try {
        const blob = await pharmaReportsService.exportReport(reportType, format, filters);
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `${reportType}_${timestamp}.${format}`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast.success(`Export complete — ${filename}`);
      } catch (err: unknown) {
        const maybeResponse = err as { response?: { data?: { message?: string } } };
        toast.error(maybeResponse.response?.data?.message || 'Export failed');
      } finally {
        setExportingFormat(null);
      }
    },
    [],
  );

  return { exportReport, isExporting: exportingFormat !== null, exportingFormat };
}

// ── Formatting helpers ───────────────────────────────────────────────────

export function fmt(value: number | null | undefined, decimals = 0): string {
  return formatIndianNumber(value, decimals);
}

export function fmtCurrency(value: number | null | undefined): string {
  return formatInr(value);
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}%`;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}
