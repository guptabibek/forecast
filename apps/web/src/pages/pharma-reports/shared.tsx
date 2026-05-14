import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { pharmaReportsService } from '../../services/api/pharma-reports.service';
import { formatIndianNumber, formatInr } from '../../utils/number-format';

export type ExportFormat = 'csv' | 'xlsx';

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
