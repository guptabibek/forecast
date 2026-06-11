import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAgo, formatAmount, labelValue, metricValue } from './provider-utils';

const RECENT_DAYS = 30;
const BASELINE_DAYS = 90;
const MIN_DISCOUNT_RATIO_PCT = 2;
const ANOMALY_MULTIPLIER = 1.5;

/**
 * Margin-leak / fraud-style detection: compares the discount-to-gross-sales
 * ratio of the last 30 days against the prior 90-day baseline and flags an
 * abnormal jump, with the heaviest-discounting salesmen as evidence.
 */
@Injectable()
export class DiscountAnomalyInsightProvider implements IInsightProvider {
  readonly providerId = 'discount-anomaly';
  readonly displayName = 'Discount Anomaly';
  readonly category = 'margin';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const recentRange = customRange(daysAgo(ctx.now, RECENT_DAYS), ctx.now);
    const baselineRange = customRange(daysAgo(ctx.now, RECENT_DAYS + BASELINE_DAYS), daysAgo(ctx.now, RECENT_DAYS + 1));

    const [recent, baseline] = await Promise.all([
      ctx.runReport(
        aggregateQuery({
          title: 'Discounts vs gross sales (recent)',
          datasetId: 'sales_items',
          metrics: ['sales_discount', 'gross_sales'],
          timeRange: recentRange,
        }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Discounts vs gross sales (baseline)',
          datasetId: 'sales_items',
          metrics: ['sales_discount', 'gross_sales'],
          timeRange: baselineRange,
        }),
      ),
    ]);

    const recentDiscount = metricValue(recent.rows[0], 'sales_discount');
    const recentGross = metricValue(recent.rows[0], 'gross_sales');
    const baselineDiscount = metricValue(baseline.rows[0], 'sales_discount');
    const baselineGross = metricValue(baseline.rows[0], 'gross_sales');
    if (recentGross <= 0 || baselineGross <= 0) return [];

    const recentRatioPct = (recentDiscount / recentGross) * 100;
    const baselineRatioPct = (baselineDiscount / baselineGross) * 100;
    if (recentRatioPct < MIN_DISCOUNT_RATIO_PCT) return [];
    if (baselineRatioPct > 0 && recentRatioPct < baselineRatioPct * ANOMALY_MULTIPLIER) return [];

    const excessDiscount = recentDiscount - (baselineRatioPct / 100) * recentGross;
    const evidence = await this.topDiscountingSalesmen(ctx, recentRange);

    return [
      {
        dedupeKey: 'discount-anomaly',
        severity: recentRatioPct >= baselineRatioPct * 2.5 ? 'high' : 'medium',
        title: `Discounting jumped to ${recentRatioPct.toFixed(1)}% of gross sales (baseline ${baselineRatioPct.toFixed(1)}%)`,
        summary:
          `Discounts in the last ${RECENT_DAYS} days are ${recentRatioPct.toFixed(1)}% of gross sales versus a ` +
          `${baselineRatioPct.toFixed(1)}% baseline — roughly ₹${formatAmount(Math.max(0, excessDiscount))} of extra ` +
          `margin given away. Verify the discounts were authorised.`,
        confidence: 0.7,
        metrics: {
          headline: `${recentRatioPct.toFixed(1)}%`,
          headlineLabel: 'Discount share of gross sales',
          impactLabel: 'Excess discount (30d)',
          impactValue: `₹${formatAmount(Math.max(0, excessDiscount))}`,
          recentRatioPct: Number(recentRatioPct.toFixed(2)),
          baselineRatioPct: Number(baselineRatioPct.toFixed(2)),
          excessDiscount: Math.max(0, excessDiscount),
        },
        evidence,
        actions: [
          'Audit the highest-discount invoices for approval compliance',
          'Review scheme configuration for unintended stacking',
          'Set a discount approval threshold for billing staff',
        ],
        drillDownQuestion: 'Salesman-wise sales last 30 days',
      },
    ];
  }

  private async topDiscountingSalesmen(
    ctx: InsightProviderContext,
    recentRange: ReturnType<typeof customRange>,
  ): Promise<string[]> {
    try {
      const bySalesman = await ctx.runReport(
        aggregateQuery({
          title: 'Discounts by salesman (recent)',
          datasetId: 'sales_items',
          metrics: ['sales_discount', 'gross_sales'],
          dimensions: ['sales_item_salesman'],
          timeRange: recentRange,
          sortByMetric: 'sales_discount',
          limit: 100,
        }),
      );
      return bySalesman.rows
        .map((row) => ({
          name: labelValue(row, ['salesman_name', 'salesman_code']),
          discount: metricValue(row, 'sales_discount'),
          gross: metricValue(row, 'gross_sales'),
        }))
        .filter((item) => item.gross > 0 && item.discount > 0)
        .map((item) => ({ ...item, ratioPct: (item.discount / item.gross) * 100 }))
        .sort((a, b) => b.ratioPct - a.ratioPct)
        .slice(0, 3)
        .map((item) => `${item.name}: ₹${formatAmount(item.discount)} discount (${item.ratioPct.toFixed(1)}% of gross)`);
    } catch {
      return [];
    }
  }
}
