import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAgo, formatAmount, labelValue, metricValue } from './provider-utils';

const VELOCITY_WINDOW_DAYS = 30;
const COVER_ALERT_DAYS = 7;
const REORDER_TARGET_DAYS = 30;

/**
 * Predicts imminent stock-outs: days of cover = current stock / average
 * daily sales over the last 30 days. Flags items with cover below 7 days
 * and suggests a reorder quantity to restore 30 days of cover.
 */
@Injectable()
export class StockoutRiskInsightProvider implements IInsightProvider {
  readonly providerId = 'stockout-risk';
  readonly displayName = 'Stock-Out Prediction';
  readonly category = 'inventory';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const [stock, sales] = await Promise.all([
      ctx.runReport(
        aggregateQuery({
          title: 'Current stock by product',
          datasetId: 'stock_summary',
          metrics: ['current_stock'],
          dimensions: ['stock_product'],
          sortByMetric: 'current_stock',
          limit: 2000,
        }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Sales velocity by product',
          datasetId: 'sales_net',
          metrics: ['sales_net_quantity'],
          dimensions: ['sales_net_product'],
          timeRange: customRange(daysAgo(ctx.now, VELOCITY_WINDOW_DAYS), ctx.now),
          sortByMetric: 'sales_net_quantity',
          limit: 2000,
        }),
      ),
    ]);

    const stockByProduct = new Map<string, { name: string; stock: number }>();
    for (const row of stock.rows) {
      const name = labelValue(row, ['product_name', 'product_code']);
      stockByProduct.set(name.toLowerCase(), { name, stock: metricValue(row, 'current_stock') });
    }

    const atRisk: Array<{ name: string; stock: number; dailySales: number; daysCover: number; reorderQty: number }> = [];
    for (const row of sales.rows) {
      const name = labelValue(row, ['product_name', 'product_code']);
      const sold = metricValue(row, 'sales_net_quantity');
      if (sold <= 0) continue;
      const entry = stockByProduct.get(name.toLowerCase());
      if (!entry || entry.stock <= 0) continue;
      const dailySales = sold / VELOCITY_WINDOW_DAYS;
      const daysCover = entry.stock / dailySales;
      if (daysCover > COVER_ALERT_DAYS) continue;
      atRisk.push({
        name: entry.name,
        stock: entry.stock,
        dailySales,
        daysCover,
        reorderQty: Math.max(0, Math.ceil(dailySales * REORDER_TARGET_DAYS - entry.stock)),
      });
    }

    if (!atRisk.length) return [];

    atRisk.sort((a, b) => a.daysCover - b.daysCover);
    const top = atRisk.slice(0, 5);
    const worstDays = Math.max(1, Math.round(top[0].daysCover));
    const criticalCount = atRisk.filter((item) => item.daysCover <= 3).length;

    return [
      {
        dedupeKey: 'stockout-risk',
        severity: criticalCount >= 5 ? 'critical' : criticalCount >= 1 ? 'high' : 'medium',
        title: `${formatAmount(atRisk.length)} selling products will run out within ${COVER_ALERT_DAYS} days`,
        summary:
          `${formatAmount(atRisk.length)} actively selling products have less than ${COVER_ALERT_DAYS} days of stock cover ` +
          `at their current sales rate; the fastest runs out in about ${worstDays} day${worstDays === 1 ? '' : 's'}.`,
        confidence: 0.85,
        metrics: {
          headline: `${worstDays} day${worstDays === 1 ? '' : 's'}`,
          headlineLabel: 'Fastest stock-out',
          impactLabel: 'Items at risk',
          impactValue: formatAmount(atRisk.length),
          atRiskCount: atRisk.length,
          criticalCount,
          coverAlertDays: COVER_ALERT_DAYS,
        },
        evidence: top.map(
          (item) =>
            `${item.name}: ${formatAmount(item.stock)} units left, ~${item.dailySales.toFixed(1)}/day → ` +
            `${Math.max(1, Math.round(item.daysCover))}d cover, reorder ~${formatAmount(item.reorderQty)}`,
        ),
        actions: [
          'Raise purchase orders for the items with the shortest cover',
          'Check pending POs before reordering to avoid double-buying',
          'Review reorder levels so these items alert earlier',
        ],
        drillDownQuestion: 'Top selling products last 30 days',
      },
    ];
  }
}
