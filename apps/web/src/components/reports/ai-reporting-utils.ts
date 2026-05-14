import { formatIndianNumber, formatInr } from '../../utils/number-format';
import type { AiReportColumn, AiReportRow } from '../../services/api/ai-reporting.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

export function columnField(column: AiReportColumn): string {
  return column.field ?? column.key ?? '';
}

export function isCurrencyKey(key: string): boolean {
  return /(amount|value|sales|purchase|outstanding|balance|gross|net|tax|discount|cost|profit|payable|receivable)/i.test(key);
}

export function isDateKey(key: string, type?: string): boolean {
  return type === 'date' || /date|month|created_at|updated_at/i.test(key);
}

export function formatAiValue(value: unknown, column?: AiReportColumn): string {
  if (value === null || value === undefined || value === '') return '-';
  const key = column ? columnField(column) : '';
  if (typeof value === 'number') {
    return column?.dataType === 'currency' || isCurrencyKey(key)
      ? formatInr(value)
      : formatIndianNumber(value, Number.isInteger(value) ? 0 : 2);
  }
  if (typeof value === 'string' && isDateKey(key, column?.dataType) && DATE_RE.test(value)) {
    return formatDate(value);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function labelForColumn(columns: AiReportColumn[], key?: string): string {
  if (!key) return '';
  return columns.find((column) => columnField(column) === key)?.label ?? key.replace(/_/g, ' ');
}

export function firstNumericColumn(columns: AiReportColumn[], rows: AiReportRow[]): string | undefined {
  const column = columns.find((candidate) => {
    const key = columnField(candidate);
    return key && rows.some((row) => asNumber(row[key]) !== null);
  });
  return column ? columnField(column) : undefined;
}

export function firstTextColumn(columns: AiReportColumn[], metricKey?: string): string | undefined {
  const column = columns.find((candidate) => columnField(candidate) !== metricKey);
  return column ? columnField(column) : undefined;
}

export function exportRowsToCsv(filename: string, columns: AiReportColumn[], rows: AiReportRow[]) {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map((column) => escape(column.label || columnField(column))).join(',');
  const body = rows.map((row) => columns.map((column) => escape(row[columnField(column)])).join(',')).join('\n');
  const blob = new Blob([[header, body].filter(Boolean).join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
