import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAgo, formatAmount, labelValue, metricValue } from './provider-utils';

const RECENT_DAYS = 30;
const BASELINE_DAYS = 60;
const MIN_BASELINE_VALUE = 10000;
const DECLINE_THRESHOLD_PCT = 30;

/**
 * Flags sales-team productivity risk from billing data: salesmen whose net
 * sales dropped sharply versus their own baseline, or who stopped billing
 * entirely. (Field-visit data is not available in Marg, so this measures
 * output, not activity.)
 */
@Injectable()
export class SalesmanPerformanceInsightProvider implements IInsightProvider {
  readonly providerId = 'salesman-performance';
  readonly displayName = 'Sales Team Performance';
  readonly category = 'sales-team';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const [baseline, recent] = await Promise.all([
      ctx.runReport(
        aggregateQuery({
          title: 'Salesman sales (baseline window)',
          datasetId: 'sales_net',
          metrics: ['sales_net_amount'],
          dimensions: ['sales_net_salesman'],
          timeRange: customRange(daysAgo(ctx.now, RECENT_DAYS + BASELINE_DAYS), daysAgo(ctx.now, RECENT_DAYS + 1)),
          sortByMetric: 'sales_net_amount',
          limit: 500,
        }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Salesman sales (recent window)',
          datasetId: 'sales_net',
          metrics: ['sales_net_amount'],
          dimensions: ['sales_net_salesman'],
          timeRange: customRange(daysAgo(ctx.now, RECENT_DAYS), ctx.now),
          limit: 500,
        }),
      ),
    ]);

    const recentBySalesman = new Map<string, number>();
    for (const row of recent.rows) {
      recentBySalesman.set(
        labelValue(row, ['salesman_name', 'salesman_code']).toLowerCase(),
        metricValue(row, 'sales_net_amount'),
      );
    }

    const declining: Array<{ name: string; baselineMonthly: number; recentValue: number; dropPct: number }> = [];
    let inactiveCount = 0;
    for (const row of baseline.rows) {
      const name = labelValue(row, ['salesman_name', 'salesman_code']);
      // Baseline window is 60 days — halve it to compare like-for-like with the 30-day recent window.
      const baselineMonthly = metricValue(row, 'sales_net_amount') / (BASELINE_DAYS / RECENT_DAYS);
      if (baselineMonthly < MIN_BASELINE_VALUE) continue;
      const recentValue = recentBySalesman.get(name.toLowerCase()) ?? 0;
      const dropPct = ((baselineMonthly - recentValue) / baselineMonthly) * 100;
      if (dropPct < DECLINE_THRESHOLD_PCT) continue;
      if (recentValue <= 0) inactiveCount += 1;
      declining.push({ name, baselineMonthly, recentValue, dropPct });
    }

    if (!declining.length) return [];

    declining.sort((a, b) => b.dropPct - a.dropPct);
    const top = declining.slice(0, 5);
    const valueAtRisk = declining.reduce((sum, item) => sum + (item.baselineMonthly - item.recentValue), 0);

    return [
      {
        dedupeKey: 'salesman-decline',
        severity: inactiveCount >= 3 || declining.length >= 8 ? 'high' : declining.length >= 3 ? 'medium' : 'low',
        title: `${formatAmount(declining.length)} salesmen are billing well below their baseline`,
        summary:
          `${formatAmount(declining.length)} salesmen dropped more than ${DECLINE_THRESHOLD_PCT}% versus their own ` +
          `two-month baseline${inactiveCount ? ` (${inactiveCount} billed nothing in the last ${RECENT_DAYS} days)` : ''}, ` +
          `a shortfall of about ₹${formatAmount(valueAtRisk)} this month.`,
        confidence: 0.75,
        metrics: {
          headline: `-${formatAmount(declining.length)}`,
          headlineLabel: 'Underperforming salesmen',
          impactLabel: 'Monthly shortfall',
          impactValue: `₹${formatAmount(valueAtRisk)}`,
          decliningCount: declining.length,
          inactiveCount,
          valueAtRisk,
        },
        evidence: top.map(
          (item) =>
            `${item.name}: ₹${formatAmount(item.recentValue)} vs ₹${formatAmount(item.baselineMonthly)} baseline ` +
            `(-${item.dropPct.toFixed(0)}%)`,
        ),
        actions: [
          'Review territories and targets with the declining salesmen',
          'Reassign inactive salesmen accounts before customers churn',
          'Check whether key customers of these salesmen moved to other channels',
        ],
        drillDownQuestion: 'Salesman-wise sales last 30 days',
      },
    ];
  }
}
