import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext, InsightSeverity } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAgo, formatAmount, labelValue, metricValue, percent } from './provider-utils';

const WINDOW_DAYS = 30;
const DROP_ALERT_THRESHOLD_PCT = -10;
const OPPORTUNITY_THRESHOLD_PCT = 15;

/**
 * Compares net sales of the trailing 30 days against the previous 30 days.
 * Emits a revenue-drop alert or a sales-opportunity insight, with the top
 * moving customers as evidence.
 */
@Injectable()
export class RevenueInsightProvider implements IInsightProvider {
  readonly providerId = 'revenue';
  readonly displayName = 'Revenue Trend';
  readonly category = 'revenue';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const currentRange = customRange(daysAgo(ctx.now, WINDOW_DAYS), ctx.now);
    const previousRange = customRange(daysAgo(ctx.now, WINDOW_DAYS * 2), daysAgo(ctx.now, WINDOW_DAYS + 1));

    const [current, previous] = await Promise.all([
      ctx.runReport(
        aggregateQuery({ title: 'Net sales (current window)', datasetId: 'sales_net', metrics: ['sales_net_amount'], timeRange: currentRange }),
      ),
      ctx.runReport(
        aggregateQuery({ title: 'Net sales (previous window)', datasetId: 'sales_net', metrics: ['sales_net_amount'], timeRange: previousRange }),
      ),
    ]);

    const currentAmount = metricValue(current.rows[0], 'sales_net_amount');
    const previousAmount = metricValue(previous.rows[0], 'sales_net_amount');
    if (previousAmount <= 0) return [];

    const changePct = ((currentAmount - previousAmount) / previousAmount) * 100;
    if (changePct > DROP_ALERT_THRESHOLD_PCT && changePct < OPPORTUNITY_THRESHOLD_PCT) return [];

    const evidence = await this.topCustomerMovers(ctx, currentRange, previousRange, changePct < 0);

    if (changePct <= DROP_ALERT_THRESHOLD_PCT) {
      return [
        {
          dedupeKey: 'revenue-drop',
          severity: this.dropSeverity(changePct),
          title: `Net sales dropped ${Math.abs(changePct).toFixed(1)}% over the last ${WINDOW_DAYS} days`,
          summary:
            `Net sales were ₹${formatAmount(currentAmount)} in the last ${WINDOW_DAYS} days versus ` +
            `₹${formatAmount(previousAmount)} in the previous ${WINDOW_DAYS} days (${percent(changePct)}).`,
          confidence: 0.9,
          metrics: {
            headline: percent(changePct),
            headlineLabel: `Net sales vs previous ${WINDOW_DAYS} days`,
            impactLabel: 'Sales shortfall (30d)',
            impactValue: `₹${formatAmount(previousAmount - currentAmount)}`,
            currentAmount,
            previousAmount,
            changePct: Number(changePct.toFixed(2)),
            windowDays: WINDOW_DAYS,
          },
          evidence,
          actions: [
            'Contact the customers with the largest declines to understand reduced ordering',
            'Check stock availability for the top declining products',
            'Review pricing and scheme changes in the period',
          ],
          drillDownQuestion: 'Customer-wise net sales last 30 days',
        },
      ];
    }

    return [
      {
        dedupeKey: 'revenue-opportunity',
        severity: 'info',
        title: `Net sales grew ${changePct.toFixed(1)}% over the last ${WINDOW_DAYS} days`,
        summary:
          `Net sales rose to ₹${formatAmount(currentAmount)} from ₹${formatAmount(previousAmount)} ` +
          `(${percent(changePct)}). Consider securing inventory for the fastest growing customers.`,
        confidence: 0.85,
        metrics: {
          headline: percent(changePct),
          headlineLabel: `Net sales vs previous ${WINDOW_DAYS} days`,
          impactLabel: 'Added sales (30d)',
          impactValue: `₹${formatAmount(currentAmount - previousAmount)}`,
          currentAmount,
          previousAmount,
          changePct: Number(changePct.toFixed(2)),
          windowDays: WINDOW_DAYS,
        },
        evidence,
        actions: ['Prioritise replenishment for fast-moving products', 'Extend credit reviews for growing customers'],
        drillDownQuestion: 'Top selling products last 30 days',
      },
    ];
  }

  private dropSeverity(changePct: number): InsightSeverity {
    if (changePct <= -35) return 'critical';
    if (changePct <= -20) return 'high';
    return 'medium';
  }

  private async topCustomerMovers(
    ctx: InsightProviderContext,
    currentRange: ReturnType<typeof customRange>,
    previousRange: ReturnType<typeof customRange>,
    declining: boolean,
  ): Promise<string[]> {
    try {
      const [current, previous] = await Promise.all([
        ctx.runReport(
          aggregateQuery({
            title: 'Customer net sales (current window)',
            datasetId: 'sales_net',
            metrics: ['sales_net_amount'],
            dimensions: ['sales_net_customer'],
            timeRange: currentRange,
            sortByMetric: 'sales_net_amount',
            limit: 200,
          }),
        ),
        ctx.runReport(
          aggregateQuery({
            title: 'Customer net sales (previous window)',
            datasetId: 'sales_net',
            metrics: ['sales_net_amount'],
            dimensions: ['sales_net_customer'],
            timeRange: previousRange,
            sortByMetric: 'sales_net_amount',
            limit: 200,
          }),
        ),
      ]);

      const currentByCustomer = new Map<string, number>();
      for (const row of current.rows) {
        currentByCustomer.set(labelValue(row, ['customer_name', 'customer_code']), metricValue(row, 'sales_net_amount'));
      }
      const deltas: Array<{ name: string; delta: number }> = [];
      for (const row of previous.rows) {
        const name = labelValue(row, ['customer_name', 'customer_code']);
        const before = metricValue(row, 'sales_net_amount');
        const after = currentByCustomer.get(name) ?? 0;
        deltas.push({ name, delta: after - before });
      }
      for (const [name, after] of currentByCustomer) {
        if (!deltas.some((d) => d.name === name)) deltas.push({ name, delta: after });
      }
      deltas.sort((a, b) => (declining ? a.delta - b.delta : b.delta - a.delta));
      return deltas
        .filter((d) => (declining ? d.delta < 0 : d.delta > 0))
        .slice(0, 3)
        .map((d) => `${d.name}: ${d.delta >= 0 ? '+' : '-'}₹${formatAmount(Math.abs(d.delta))} vs previous window`);
    } catch {
      // Evidence is best-effort; the headline insight still stands without it.
      return [];
    }
  }
}
