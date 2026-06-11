import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { SemanticReportQuery } from '../../ai-reporting/semantic-query.types';
import {
  IInsightProvider,
  InsightCandidate,
  InsightProviderContext,
  InsightReportRows,
  InsightSeverity,
} from '../insight-provider.interface';
import { applyRollingWindow } from '../rolling-window.util';
import { buildPreviousPeriodQuery } from '../result-analytics.util';
import { formatAmount, labelValue, metricValue, percent } from './provider-utils';

/** Bound per cycle so one tenant with many pins cannot monopolize generation. */
const MAX_WIDGETS_PER_CYCLE = 40;
/** Analysis never needs more rows than this regardless of the stored limit. */
const MAX_ANALYSIS_ROWS = 100;
const EVIDENCE_ROWS = 3;

/**
 * Generic analysis engine for user-pinned reports: every pinned widget's
 * stored semantic query is run through the same pipeline as the built-in
 * providers and turned into an insight card — headline value, change versus
 * the previous period (when the query has a comparable past window), top
 * contributors as evidence, and a severity derived from the size of the move.
 *
 * This is what makes a custom pinned query "behave like the defaults": the
 * defaults are hand-written semantic queries with analysis on top; this
 * provider derives the analysis from ANY stored query instead.
 *
 * Note: insights are tenant-wide, so a report pinned by one user produces an
 * insight visible to everyone with insight access in that tenant.
 */
@Injectable()
export class PinnedReportInsightProvider implements IInsightProvider {
  readonly providerId = 'pinned-reports';
  readonly displayName = 'Pinned Report Analysis';
  readonly category = 'custom';
  readonly defaultEnabled = true;

  constructor(private readonly prisma: PrismaService) {}

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const widgets = await this.prisma.aiDashboardWidget.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'asc' },
      take: MAX_WIDGETS_PER_CYCLE,
    });

    const candidates: InsightCandidate[] = [];
    for (const widget of widgets) {
      try {
        const candidate = await this.analyzeWidget(ctx, widget);
        if (candidate) candidates.push(candidate);
      } catch {
        // One broken pin (deleted dataset, unsupported query, ...) must not
        // block analysis of the remaining widgets.
      }
    }
    return candidates;
  }

  private async analyzeWidget(
    ctx: InsightProviderContext,
    widget: { id: string; title: string; createdAt: Date; semanticQuery: unknown },
  ): Promise<InsightCandidate | null> {
    const stored = applyRollingWindow(widget.semanticQuery as SemanticReportQuery, widget.createdAt, ctx.now);
    const query: SemanticReportQuery = {
      ...stored,
      limit: Math.min(stored.limit ?? MAX_ANALYSIS_ROWS, MAX_ANALYSIS_ROWS),
      output: { showGrid: true, showChart: false, chartType: 'none' },
    };

    const current = await ctx.runReport(query);
    const primaryMetric = query.metrics?.[0];
    const currentTotal = primaryMetric ? this.sumMetric(current, primaryMetric) : null;

    const comparison = await this.compareToPreviousPeriod(ctx, query, currentTotal);
    if (current.rowCount === 0 && !comparison) return null;

    const isCurrency = primaryMetric ? /amount|value|cost|outstanding/i.test(primaryMetric) : false;
    const formatValue = (value: number) => (isCurrency ? `₹${formatAmount(value)}` : formatAmount(value));

    const headline =
      currentTotal !== null ? formatValue(currentTotal) : `${formatAmount(current.rowCount)} rows`;
    const headlineLabel = comparison
      ? `${this.metricLabel(primaryMetric)} (${percent(comparison.changePct)} vs previous period)`
      : this.metricLabel(primaryMetric) ?? 'Matching records';

    const summary = this.buildSummary(widget.title, current, currentTotal, comparison, formatValue);

    return {
      dedupeKey: `widget:${widget.id}`,
      severity: this.severityFor(comparison?.changePct),
      title: `Pinned report: ${widget.title}`,
      summary,
      confidence: 0.8,
      metrics: {
        headline,
        headlineLabel,
        impactLabel: comparison ? 'Previous period' : 'Rows in result',
        impactValue: comparison ? formatValue(comparison.previousTotal) : formatAmount(current.rowCount),
        widgetId: widget.id,
        rowCount: current.rowCount,
        ...(currentTotal !== null ? { currentTotal } : {}),
        ...(comparison
          ? { previousTotal: comparison.previousTotal, changePct: Number(comparison.changePct.toFixed(2)) }
          : {}),
      },
      evidence: this.buildEvidence(query, current, formatValue),
      actions: [
        'Open the pinned widget on the AI Insights dashboard for the full result',
        'Re-run the question in AI Reporting to drill into the details',
      ],
      drillDownQuestion: widget.title,
    };
  }

  /**
   * Compares the query's window against the immediately preceding window of
   * the same length (window construction shared with the widget-analytics
   * layer via buildPreviousPeriodQuery — past-facing custom ranges only).
   */
  private async compareToPreviousPeriod(
    ctx: InsightProviderContext,
    query: SemanticReportQuery,
    currentTotal: number | null,
  ): Promise<{ previousTotal: number; changePct: number } | null> {
    const primaryMetric = query.metrics?.[0];
    if (currentTotal === null || !primaryMetric) return null;
    const previousQuery = buildPreviousPeriodQuery(query, ctx.now);
    if (!previousQuery) return null;

    try {
      const previous = await ctx.runReport(previousQuery);
      const previousTotal = this.sumMetric(previous, primaryMetric);
      if (previousTotal <= 0) return null;
      return { previousTotal, changePct: ((currentTotal - previousTotal) / previousTotal) * 100 };
    } catch {
      return null;
    }
  }

  /**
   * The engine cannot know whether a move is good or bad for an arbitrary
   * query (revenue down is bad, outstanding down is good), so severity only
   * encodes the SIZE of the move and the wording stays neutral.
   */
  private severityFor(changePct: number | undefined): InsightSeverity {
    if (changePct === undefined) return 'info';
    const magnitude = Math.abs(changePct);
    if (magnitude >= 40) return 'medium';
    if (magnitude >= 15) return 'low';
    return 'info';
  }

  private buildSummary(
    title: string,
    current: InsightReportRows,
    currentTotal: number | null,
    comparison: { previousTotal: number; changePct: number } | null,
    formatValue: (value: number) => string,
  ): string {
    if (currentTotal !== null && comparison) {
      const direction = comparison.changePct >= 0 ? 'up' : 'down';
      return (
        `"${title}" is at ${formatValue(currentTotal)}, ${direction} ${Math.abs(comparison.changePct).toFixed(1)}% ` +
        `from ${formatValue(comparison.previousTotal)} in the previous period of the same length.`
      );
    }
    if (currentTotal !== null) {
      return `"${title}" currently totals ${formatValue(currentTotal)} across ${current.rowCount} row(s).`;
    }
    return `"${title}" currently matches ${current.rowCount} record(s).`;
  }

  private buildEvidence(
    query: SemanticReportQuery,
    current: InsightReportRows,
    formatValue: (value: number) => string,
  ): string[] {
    const primaryMetric = query.metrics?.[0];
    return current.rows.slice(0, EVIDENCE_ROWS).map((row) => {
      const label = labelValue(row, query.dimensions ?? []);
      return primaryMetric ? `${label}: ${formatValue(metricValue(row, primaryMetric))}` : label;
    });
  }

  private sumMetric(result: InsightReportRows, metricId: string): number {
    return result.rows.reduce((total, row) => total + metricValue(row, metricId), 0);
  }

  private metricLabel(metricId: string | undefined): string | null {
    if (!metricId) return null;
    const label = metricId.replace(/_/g, ' ').trim();
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
}
