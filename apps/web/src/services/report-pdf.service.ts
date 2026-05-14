import toast from 'react-hot-toast';
import { apiClient } from './api/client';

export interface PdfField {
  label: string;
  value: string | number | null | undefined;
}

export interface PdfTableColumn {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
}

export interface PdfTable {
  title?: string;
  columns: PdfTableColumn[];
  rows: Array<Record<string, unknown>>;
}

export interface ReportExportPayload {
  title: string;
  documentNumber?: string | null;
  fields: PdfField[];
  tables?: PdfTable[];
  totals?: PdfField[];
  appliedFilters?: Record<string, string>;
  reportKey?: string;
  drilldownTitle?: string;
  exportMode?: 'current-page' | 'all';
}

export interface PdfShareResult {
  fileId: string;
  downloadUrl: string;
  expiresAt: string;
  whatsappUrl: string;
}

function buildFilename(title: string, docNumber?: string | null): string {
  const ts = new Date().toISOString().slice(0, 10);
  const safe = (title + (docNumber ? `-${docNumber}` : ''))
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
  return `${safe}_${ts}.pdf`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const maybeResponse = error as { response?: { data?: { message?: string } } };
    return maybeResponse.response?.data?.message || fallback;
  }
  return fallback;
}

export const reportPdfService = {
  async exportPdf(payload: ReportExportPayload): Promise<void> {
    const loadingToast = toast.loading('Generating PDF...');
    try {
      const response = await apiClient.post('/pharma-reports/export-pdf', payload, {
        responseType: 'blob',
        timeout: 120000,
      });

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildFilename(payload.title, payload.documentNumber);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('PDF exported successfully', { id: loadingToast });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'PDF export failed'), { id: loadingToast });
      throw err;
    }
  },

  async shareToWhatsApp(payload: ReportExportPayload): Promise<PdfShareResult> {
    const loadingToast = toast.loading('Generating share link...');
    try {
      const response = await apiClient.post<PdfShareResult>('/pharma-reports/share-pdf', payload);
      const result = response.data;
      window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer');
      toast.success('WhatsApp share link ready', { id: loadingToast });
      return result;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to generate share link'), { id: loadingToast });
      throw err;
    }
  },

  async exportReportPdf(reportType: string, filters?: Record<string, unknown>): Promise<void> {
    const loadingToast = toast.loading('Generating PDF (all data)...');
    try {
      const shareResult = await apiClient.post<PdfShareResult>('/pharma-reports/share-report-pdf', {
        reportType,
        filters,
      });
      const downloadUrl = shareResult.data.downloadUrl;
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success('PDF ready — downloading', { id: loadingToast });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'PDF export failed'), { id: loadingToast });
      throw err;
    }
  },

  async shareReportToWhatsApp(reportType: string, filters?: Record<string, unknown>): Promise<PdfShareResult> {
    const loadingToast = toast.loading('Generating share link...');
    try {
      const response = await apiClient.post<PdfShareResult>('/pharma-reports/share-report-pdf', {
        reportType,
        filters,
      });
      const result = response.data;
      window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer');
      toast.success('WhatsApp share link ready', { id: loadingToast });
      return result;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to generate share link'), { id: loadingToast });
      throw err;
    }
  },
};
