import { SemanticReportQuery } from '../ai-reporting/semantic-query.types';
import { labelValue, metricValue } from './providers/provider-utils';

/**
 * Deterministic analytics computed from a report result — the layer that
 * turns a raw pinned query into the same kind of reading the built-in
 * insight cards provide (KPI summary, previous-period growth, contribution /
 * Pareto distribution, monthly trend, narrative findings). Pure functions:
 * no I/O, no LLM — callers run any extra query (previous period) themselves.
 */

export interface AnalyticsKpi {
  label: string;
  value: string;
  tone: 'positive' | 'negative' | 'neutral';
}

export interface WidgetAnalytics {
  kpis: AnalyticsKpi[];
  insights: string[];
  trend: { direction: 'rising' | 'falling' | 'flat'; points: Array<{ period: string; value: number }> } | null;
}

interface ReportRows {
  columns: Array<{ key: string; label: string; dataType?: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
}

const DAY_MS = 86_400_000;
const MAX_TREND_POINTS = 12;

/**
 * The immediately preceding window of the same length — only for past-facing
 * custom ranges. Presets re-resolve at compile time and have no stable
 * "previous" here; future-facing windows (expiry lists) have no meaningful
 * prior period.
 */
export function buildPreviousPeriodQuery(query: SemanticReportQuery, now: Date): SemanticReportQuery | null {
  const range = query.timeRange;
  if (range?.preset !== 'custom' || !range.startDate || !range.endDate) return null;
  if (!query.metrics?.length) return null;

  const start = Date.parse(`${range.startDate}T00:00:00Z`);
  const end = Date.parse(`${range.endDate}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if ([start, end].some(Number.isNaN) || end > today + DAY_MS) return null;

  const spanMs = end - start;
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    ...query,
    timeRange: { ...range, startDate: toIso(start - spanMs - DAY_MS), endDate: toIso(start - DAY_MS) },
  };
}

export function sumPrimaryMetric(result: ReportRows, query: SemanticReportQuery): number | null {
  const metricId = query.metrics?.[0];
  if (!metricId) return null;
  return result.rows.reduce((total, row) => total + metricValue(row, metricId), 0);
}

export function analyzeReportResult(input: {
  query: SemanticReportQuery;
  result: ReportRows;
  currentTotal: number | null;
  previousTotal: number | null;
}): WidgetAnalytics | null {
  const { query, result, currentTotal, previousTotal } = input;
  if (!result.rowCount) return null;

  const metricId = query.metrics?.[0];
  const isCurrency = metricId ? /amount|value|cost|outstanding|balance/i.test(metricId) : false;
  const fmt = (value: number) => (isCurrency ? `₹${indian(value)}` : indian(value));
  const metricLabel = metricId ? humanize(metricId) : 'Records';

  const kpis: AnalyticsKpi[] = [];
  const insights: string[] = [];

  if (metricId && currentTotal !== null) {
    kpis.push({ label: `Total ${metricLabel}`, value: fmt(currentTotal), tone: 'neutral' });
    if (result.rowCount > 1) {
      kpis.push({ label: 'Average per row', value: fmt(currentTotal / result.rowCount), tone: 'neutral' });
    }
  }
  kpis.push({ label: 'Rows', value: indian(result.rowCount), tone: 'neutral' });

  if (currentTotal !== null && previousTotal !== null && previousTotal > 0) {
    const changePct = ((currentTotal - previousTotal) / previousTotal) * 100;
    kpis.push({
      label: 'vs previous period',
      value: `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`,
      tone: changePct >= 0 ? 'positive' : 'negative',
    });
    insights.push(
      `${metricLabel} is ${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(1)}% versus the previous period of the same length (${fmt(previousTotal)} → ${fmt(currentTotal)}).`,
    );
  }

  const distribution = analyzeDistribution(query, result, metricId, currentTotal, fmt);
  insights.push(...distribution);

  const trend = analyzeTrend(result, metricId);
  if (trend) {
    insights.push(
      trend.direction === 'flat'
        ? `${metricLabel} is broadly flat across the reported periods.`
        : `${metricLabel} is ${trend.direction} across the reported periods.`,
    );
  }

  return { kpis, insights, trend };
}

/** Contribution / Pareto narrative — only meaningful for grouped results. */
function analyzeDistribution(
  query: SemanticReportQuery,
  result: ReportRows,
  metricId: string | undefined,
  currentTotal: number | null,
  fmt: (value: number) => string,
): string[] {
  if (!metricId || currentTotal === null || currentTotal <= 0) return [];
  if (!query.dimensions?.length || result.rowCount < 2) return [];

  const ranked = result.rows
    .map((row) => ({ label: labelValue(row, query.dimensions ?? []), value: metricValue(row, metricId) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
  if (!ranked.length) return [];

  const insights: string[] = [];
  const dimensionLabel = humanize(query.dimensions[0].split('_').slice(-1)[0]);

  const topShare = (ranked[0].value / currentTotal) * 100;
  if (topShare >= 5) {
    insights.push(`Top ${dimensionLabel} "${ranked[0].label}" contributes ${topShare.toFixed(1)}% of the total (${fmt(ranked[0].value)}).`);
  }

  if (ranked.length >= 3) {
    const top3Share = (ranked.slice(0, 3).reduce((sum, entry) => sum + entry.value, 0) / currentTotal) * 100;
    insights.push(`Top 3 account for ${top3Share.toFixed(1)}% of the total.`);

    let running = 0;
    let paretoCount = 0;
    for (const entry of ranked) {
      running += entry.value;
      paretoCount += 1;
      if (running / currentTotal >= 0.8) break;
    }
    if (paretoCount < ranked.length) {
      insights.push(`${paretoCount} of ${ranked.length} ${dimensionLabel.toLowerCase()}(s) drive 80% of the total.`);
    }
  }
  return insights;
}

/** Monthly buckets over any date-like column; direction by half-over-half average. */
function analyzeTrend(
  result: ReportRows,
  metricId: string | undefined,
): WidgetAnalytics['trend'] {
  if (!metricId) return null;
  const dateColumn = result.columns.find(
    (column) => column.dataType === 'date' || /(^|_)(date|month)($|_)/i.test(column.key),
  );
  if (!dateColumn) return null;

  const buckets = new Map<string, number>();
  for (const row of result.rows) {
    const raw = String(row[dateColumn.key] ?? '');
    const period = raw.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) continue;
    buckets.set(period, (buckets.get(period) ?? 0) + metricValue(row, metricId));
  }
  if (buckets.size < 3) return null;

  const points = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-MAX_TREND_POINTS)
    .map(([period, value]) => ({ period, value: Number(value.toFixed(2)) }));

  const half = Math.floor(points.length / 2);
  const firstAvg = average(points.slice(0, half).map((p) => p.value));
  const secondAvg = average(points.slice(points.length - half).map((p) => p.value));
  const direction = firstAvg === 0
    ? 'flat'
    : Math.abs(secondAvg - firstAvg) / Math.abs(firstAvg) < 0.05
      ? 'flat'
      : secondAvg > firstAvg
        ? 'rising'
        : 'falling';

  return { direction, points };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function indian(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 }).format(value);
}

function humanize(id: string): string {
  const label = id.replace(/_/g, ' ').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}
