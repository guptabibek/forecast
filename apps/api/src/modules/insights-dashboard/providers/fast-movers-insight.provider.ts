import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAgo, formatAmount, labelValue, metricValue } from './provider-utils';

const WINDOW_DAYS = 30;
const GROWTH_THRESHOLD_PCT = 40;
const MIN_CURRENT_VALUE = 10000;

/**
 * Surfaces fast-moving products: items whose net sales grew sharply versus
 * the previous 30-day window — a demand surge worth securing stock for.
 */
@Injectable()
export class FastMoversInsightProvider implements IInsightProvider {
  readonly providerId = 'fast-movers';
  readonly displayName = 'Fast Moving Products';
  readonly category = 'sales-opportunity';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const [current, previous] = await Promise.all([
      ctx.runReport(
        aggregateQuery({
          title: 'Product sales (current window)',
          datasetId: 'sales_net',
          metrics: ['sales_net_amount'],
          dimensions: ['sales_net_product'],
          timeRange: customRange(daysAgo(ctx.now, WINDOW_DAYS), ctx.now),
          sortByMetric: 'sales_net_amount',
          limit: 500,
        }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Product sales (previous window)',
          datasetId: 'sales_net',
          metrics: ['sales_net_amount'],
          dimensions: ['sales_net_product'],
          timeRange: customRange(daysAgo(ctx.now, WINDOW_DAYS * 2), daysAgo(ctx.now, WINDOW_DAYS + 1)),
          limit: 2000,
        }),
      ),
    ]);

    const previousByProduct = new Map<string, number>();
    for (const row of previous.rows) {
      previousByProduct.set(
        labelValue(row, ['product_name', 'product_code']).toLowerCase(),
        metricValue(row, 'sales_net_amount'),
      );
    }

    const movers: Array<{ name: string; currentValue: number; previousValue: number; growthPct: number }> = [];
    for (const row of current.rows) {
      const name = labelValue(row, ['product_name', 'product_code']);
      const currentValue = metricValue(row, 'sales_net_amount');
      if (currentValue < MIN_CURRENT_VALUE) continue;
      const previousValue = previousByProduct.get(name.toLowerCase()) ?? 0;
      if (previousValue <= 0) continue;
      const growthPct = ((currentValue - previousValue) / previousValue) * 100;
      if (growthPct < GROWTH_THRESHOLD_PCT) continue;
      movers.push({ name, currentValue, previousValue, growthPct });
    }

    if (!movers.length) return [];

    movers.sort((a, b) => b.growthPct - a.growthPct);
    const top = movers.slice(0, 5);
    const addedValue = movers.reduce((sum, item) => sum + (item.currentValue - item.previousValue), 0);

    return [
      {
        dedupeKey: 'fast-movers',
        severity: 'info',
        title: `${formatAmount(movers.length)} products are growing ${GROWTH_THRESHOLD_PCT}%+ month over month`,
        summary:
          `${formatAmount(movers.length)} products grew at least ${GROWTH_THRESHOLD_PCT}% versus the previous ` +
          `${WINDOW_DAYS} days, adding ₹${formatAmount(addedValue)}. Secure inventory before the surge outruns stock.`,
        confidence: 0.8,
        metrics: {
          headline: `+${top[0].growthPct.toFixed(0)}%`,
          headlineLabel: `Top grower: ${top[0].name}`,
          impactLabel: 'Added sales (30d)',
          impactValue: `₹${formatAmount(addedValue)}`,
          moverCount: movers.length,
          addedValue,
        },
        evidence: top.map(
          (item) => `${item.name}: ₹${formatAmount(item.currentValue)} (+${item.growthPct.toFixed(0)}% vs previous window)`,
        ),
        actions: [
          'Check stock cover for the fastest growers and reorder early',
          'Negotiate supplier rates while volumes are rising',
          'Push the growing range to similar customers who are not buying it yet',
        ],
        drillDownQuestion: 'Top selling products last 30 days',
      },
    ];
  }
}
