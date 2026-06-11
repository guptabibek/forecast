import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAgo, formatAmount, labelValue, metricValue } from './provider-utils';

const LOOKBACK_DAYS = 90;
const MIN_DEAD_VALUE = 1000;

/**
 * Detects dead stock: products holding stock value with zero sales in the
 * last 90 days. Joins two catalog reports in memory (stock by product vs
 * sales by product) — no raw SQL.
 */
@Injectable()
export class DeadStockInsightProvider implements IInsightProvider {
  readonly providerId = 'dead-stock';
  readonly displayName = 'Dead Stock Detection';
  readonly category = 'inventory';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const [stock, sales] = await Promise.all([
      ctx.runReport(
        aggregateQuery({
          title: 'Stock value by product',
          datasetId: 'stock_summary',
          metrics: ['stock_value', 'current_stock'],
          dimensions: ['stock_product'],
          sortByMetric: 'stock_value',
          limit: 500,
        }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Products sold in lookback window',
          datasetId: 'sales_net',
          metrics: ['sales_net_quantity'],
          dimensions: ['sales_net_product'],
          timeRange: customRange(daysAgo(ctx.now, LOOKBACK_DAYS), ctx.now),
          limit: 2000,
        }),
      ),
    ]);

    const soldProducts = new Set(
      sales.rows
        .filter((row) => metricValue(row, 'sales_net_quantity') > 0)
        .map((row) => labelValue(row, ['product_name', 'product_code']).toLowerCase()),
    );

    const dead = stock.rows
      .map((row) => ({
        name: labelValue(row, ['product_name', 'product_code']),
        value: metricValue(row, 'stock_value'),
        quantity: metricValue(row, 'current_stock'),
      }))
      .filter((item) => item.quantity > 0 && item.value >= MIN_DEAD_VALUE && !soldProducts.has(item.name.toLowerCase()));

    if (!dead.length) return [];

    const totalValue = dead.reduce((sum, item) => sum + item.value, 0);
    const top = dead.sort((a, b) => b.value - a.value).slice(0, 5);

    return [
      {
        dedupeKey: 'dead-stock',
        severity: totalValue > 500000 ? 'high' : totalValue > 100000 ? 'medium' : 'low',
        title: `${formatAmount(dead.length)} products show no sales in ${LOOKBACK_DAYS} days (₹${formatAmount(totalValue)} locked)`,
        summary:
          `${formatAmount(dead.length)} stocked products have had zero sales in the last ${LOOKBACK_DAYS} days, ` +
          `locking roughly ₹${formatAmount(totalValue)} of inventory value.`,
        confidence: 0.8,
        metrics: {
          headline: `₹${formatAmount(totalValue)}`,
          headlineLabel: 'Inventory value locked in dead stock',
          impactLabel: 'Dead products',
          impactValue: formatAmount(dead.length),
          deadProductCount: dead.length,
          lockedValue: totalValue,
          lookbackDays: LOOKBACK_DAYS,
        },
        evidence: top.map((item) => `${item.name}: ₹${formatAmount(item.value)} in stock, no sales`),
        actions: [
          'Run clearance schemes for the highest-value dead items',
          'Stop reordering items with no movement',
          'Check whether dead items can be transferred to better-performing branches',
        ],
        drillDownQuestion: 'Stock value by product',
      },
    ];
  }
}
