import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { pharmaReportsService } from '../../services/api/pharma-reports.service';

export type ExportFormat = 'csv' | 'xlsx';

export function useReportExport() {
  const [isExporting, setIsExporting] = useState(false);

  const exportReport = useCallback(
    async (reportType: string, format: ExportFormat, filters?: Record<string, unknown>) => {
      setIsExporting(true);
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
      } catch (err: any) {
        toast.error(err?.response?.data?.message || 'Export failed');
      } finally {
        setIsExporting(false);
      }
    },
    [],
  );

  return { exportReport, isExporting };
}

// ── Formatting helpers ───────────────────────────────────────────────────

export function fmt(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${value.toFixed(2)}`;
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
