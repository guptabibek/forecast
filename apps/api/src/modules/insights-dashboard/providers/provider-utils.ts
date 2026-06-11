import { SemanticReportQuery, SemanticTimeRange } from '../../ai-reporting/semantic-query.types';

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysAgo(now: Date, days: number): Date {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date;
}

export function daysAhead(now: Date, days: number): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return date;
}

export function customRange(start: Date, end: Date): SemanticTimeRange {
  return { preset: 'custom', startDate: isoDate(start), endDate: isoDate(end) };
}

/** Builds an aggregate semantic query with table-only output (no chart needed for analysis). */
export function aggregateQuery(input: {
  title: string;
  datasetId: string;
  metrics: string[];
  dimensions?: string[];
  filters?: SemanticReportQuery['filters'];
  timeRange?: SemanticTimeRange;
  limit?: number;
  sortByMetric?: string;
  sortDirection?: 'asc' | 'desc';
}): SemanticReportQuery {
  return {
    queryKind: 'single_report',
    title: input.title,
    datasetId: input.datasetId,
    mode: input.dimensions?.length ? 'aggregate' : 'kpi',
    metrics: input.metrics,
    dimensions: input.dimensions ?? [],
    filters: input.filters,
    timeRange: input.timeRange,
    sort: input.sortByMetric ? [{ metricId: input.sortByMetric, direction: input.sortDirection ?? 'desc' }] : undefined,
    limit: input.limit ?? 100,
    output: { showGrid: true, showChart: false, chartType: 'none' },
  };
}

/** Reads a metric value from a result row, tolerating compiler aliasing differences. */
export function metricValue(row: Record<string, unknown> | undefined, metricId: string): number {
  if (!row) return 0;
  const direct = Number(row[metricId]);
  if (Number.isFinite(direct)) return direct;
  for (const value of Object.values(row)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Reads the first present label column from a result row. */
export function labelValue(row: Record<string, unknown>, candidates: string[]): string {
  for (const candidate of candidates) {
    const value = row[candidate];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  for (const value of Object.values(row)) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'Unknown';
}

export function formatAmount(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function percent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}
