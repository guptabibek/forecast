import { ArrowDownTrayIcon, DocumentArrowDownIcon, ShareIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { useState } from 'react';
import { Button } from '../ui';
import { reportPdfService, type ReportExportPayload } from '../../services/report-pdf.service';

export interface DetailField {
  label: string;
  value: string | number | null | undefined;
}

export interface DetailTable {
  title?: string;
  columns: Array<{ key: string; header: string; align?: 'left' | 'right' | 'center'; excludeFromPdf?: boolean }>;
  rows: Array<Record<string, unknown>>;
}

interface DetailPopupActionsProps {
  title: string;
  documentNumber?: string | null;
  fields: DetailField[];
  tables?: DetailTable[];
  totals?: DetailField[];
  drilldownTitle?: string;
  appliedFilters?: Record<string, string>;
}

function textValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value).replace(/<[^>]*>/g, '');
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toCsv(fields: DetailField[], tables: DetailTable[] = [], totals: DetailField[] = []) {
  const lines: string[] = [];
  const cell = (value: unknown) => `"${textValue(value).replace(/"/g, '""')}"`;

  lines.push(cell('Field') + ',' + cell('Value'));
  fields.forEach((field) => lines.push(`${cell(field.label)},${cell(field.value)}`));
  if (totals.length) {
    lines.push('');
    lines.push(cell('Totals') + ',' + cell('Value'));
    totals.forEach((field) => lines.push(`${cell(field.label)},${cell(field.value)}`));
  }

  tables.forEach((table) => {
    lines.push('');
    if (table.title) lines.push(cell(table.title));
    lines.push(table.columns.map((column) => cell(column.header)).join(','));
    table.rows.forEach((row) => {
      lines.push(table.columns.map((column) => cell(row[column.key])).join(','));
    });
  });

  return lines.join('\n');
}

export function DetailPopupActions({
  title,
  documentNumber,
  fields,
  tables = [],
  totals = [],
  drilldownTitle,
  appliedFilters,
}: DetailPopupActionsProps) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [sharing, setSharing] = useState(false);

  const safeName = `${title}-${documentNumber ?? format(new Date(), 'yyyy-MM-dd')}`
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-');

  const handleCsv = () => download(`${safeName}.csv`, toCsv(fields, tables, totals), 'text/csv;charset=utf-8');

  const buildPayload = (): ReportExportPayload => ({
    title,
    documentNumber,
    fields: fields.filter((f) => f.value != null && String(f.value) !== '' && String(f.value) !== '-'),
    tables: tables.map(t => ({
      ...t,
      columns: t.columns.filter(c => !c.excludeFromPdf)
    })),
    totals,
    drilldownTitle,
    appliedFilters,
  });

  const handlePdf = async () => {
    setPdfLoading(true);
    try {
      await reportPdfService.exportPdf(buildPayload());
    } finally {
      setPdfLoading(false);
    }
  };

  const handleWhatsApp = async () => {
    setSharing(true);
    try {
      await reportPdfService.shareToWhatsApp(buildPayload());
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="flex flex-wrap justify-end gap-2 border-b border-secondary-200 pb-3 dark:border-secondary-700">
      <Button variant="secondary" size="sm" onClick={handlePdf} disabled={pdfLoading} isLoading={pdfLoading} leftIcon={<DocumentArrowDownIcon className="h-4 w-4" />}>
        Export PDF
      </Button>
      <Button variant="secondary" size="sm" onClick={handleCsv} leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}>
        Export CSV
      </Button>
      <Button variant="secondary" size="sm" onClick={handleWhatsApp} disabled={sharing} isLoading={sharing} leftIcon={<ShareIcon className="h-4 w-4" />}>
        Share via WhatsApp
      </Button>
    </div>
  );
}
