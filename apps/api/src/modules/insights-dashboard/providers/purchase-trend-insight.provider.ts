import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAgo, formatAmount, labelValue, metricValue, percent } from './provider-utils';

const WINDOW_DAYS = 30;
const TREND_THRESHOLD_PCT = 15;

/**
 * Tracks net purchase value of the trailing 30 days against the previous
 * 30 days and surfaces significant swings with the top supplier movers.
 */
@Injectable()
export class PurchaseTrendInsightProvider implements IInsightProvider {
  readonly providerId = 'purchase-trend';
  readonly displayName = 'Purchase Trend';
  readonly category = 'purchases';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const currentRange = customRange(daysAgo(ctx.now, WINDOW_DAYS), ctx.now);
    const previousRange = customRange(daysAgo(ctx.now, WINDOW_DAYS * 2), daysAgo(ctx.now, WINDOW_DAYS + 1));

    const [current, previous] = await Promise.all([
      ctx.runReport(
        aggregateQuery({ title: 'Net purchases (current window)', datasetId: 'purchase_net', metrics: ['purchase_net_amount'], timeRange: currentRange }),
      ),
      ctx.runReport(
        aggregateQuery({ title: 'Net purchases (previous window)', datasetId: 'purchase_net', metrics: ['purchase_net_amount'], timeRange: previousRange }),
      ),
    ]);

    const currentAmount = metricValue(current.rows[0], 'purchase_net_amount');
    const previousAmount = metricValue(previous.rows[0], 'purchase_net_amount');
    if (previousAmount <= 0) return [];

    const changePct = ((currentAmount - previousAmount) / previousAmount) * 100;
    if (Math.abs(changePct) < TREND_THRESHOLD_PCT) return [];

    const movers = await this.topSupplierMovers(ctx, currentRange, previousRange, changePct > 0);
    const rising = changePct > 0;

    return [
      {
        dedupeKey: 'purchase-trend',
        severity: rising ? (changePct >= 40 ? 'medium' : 'low') : 'info',
        title: `Purchases ${rising ? 'rose' : 'fell'} ${Math.abs(changePct).toFixed(1)}% over the last ${WINDOW_DAYS} days`,
        summary:
          `Net purchases were ₹${formatAmount(currentAmount)} in the last ${WINDOW_DAYS} days versus ` +
          `₹${formatAmount(previousAmount)} before (${percent(changePct)}). ` +
          (rising
            ? 'Verify the buildup is backed by sales demand to avoid locking working capital.'
            : 'Confirm reduced buying will not cause stock-outs for fast movers.'),
        confidence: 0.85,
        metrics: {
          headline: percent(changePct),
          headlineLabel: `Purchase value vs previous ${WINDOW_DAYS} days`,
          impactLabel: 'Purchases (30d)',
          impactValue: `₹${formatAmount(currentAmount)}`,
          currentAmount,
          previousAmount,
          changePct: Number(changePct.toFixed(2)),
        },
        evidence: movers,
        actions: rising
          ? ['Compare supplier rates before the next bulk order', 'Cross-check purchase buildup against sales velocity']
          : ['Review open purchase orders for fast movers', 'Confirm supplier supply is not constrained'],
        drillDownQuestion: 'Supplier-wise purchase this month',
      },
    ];
  }

  private async topSupplierMovers(
    ctx: InsightProviderContext,
    currentRange: ReturnType<typeof customRange>,
    previousRange: ReturnType<typeof customRange>,
    rising: boolean,
  ): Promise<string[]> {
    try {
      const [current, previous] = await Promise.all([
        ctx.runReport(
          aggregateQuery({
            title: 'Supplier purchases (current window)',
            datasetId: 'purchase_net',
            metrics: ['purchase_net_amount'],
            dimensions: ['purchase_net_supplier'],
            timeRange: currentRange,
            sortByMetric: 'purchase_net_amount',
            limit: 200,
          }),
        ),
        ctx.runReport(
          aggregateQuery({
            title: 'Supplier purchases (previous window)',
            datasetId: 'purchase_net',
            metrics: ['purchase_net_amount'],
            dimensions: ['purchase_net_supplier'],
            timeRange: previousRange,
            sortByMetric: 'purchase_net_amount',
            limit: 200,
          }),
        ),
      ]);

      const previousBySupplier = new Map<string, number>();
      for (const row of previous.rows) {
        previousBySupplier.set(labelValue(row, ['supplier_name', 'supplier_code']), metricValue(row, 'purchase_net_amount'));
      }
      const deltas: Array<{ name: string; delta: number }> = [];
      for (const row of current.rows) {
        const name = labelValue(row, ['supplier_name', 'supplier_code']);
        deltas.push({ name, delta: metricValue(row, 'purchase_net_amount') - (previousBySupplier.get(name) ?? 0) });
        previousBySupplier.delete(name);
      }
      for (const [name, before] of previousBySupplier) deltas.push({ name, delta: -before });

      deltas.sort((a, b) => (rising ? b.delta - a.delta : a.delta - b.delta));
      return deltas
        .filter((d) => (rising ? d.delta > 0 : d.delta < 0))
        .slice(0, 3)
        .map((d) => `${d.name}: ${d.delta >= 0 ? '+' : '-'}₹${formatAmount(Math.abs(d.delta))} vs previous window`);
    } catch {
      return [];
    }
  }
}
