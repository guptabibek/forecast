import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext, InsightSeverity } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAhead, formatAmount, metricValue } from './provider-utils';

const EXPIRY_HORIZON_DAYS = 90;

/**
 * Flags inventory risk: items below minimum/reorder level and stock value
 * expiring within the next 90 days.
 */
@Injectable()
export class InventoryInsightProvider implements IInsightProvider {
  readonly providerId = 'inventory';
  readonly displayName = 'Inventory Risk';
  readonly category = 'inventory';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const candidates: InsightCandidate[] = [];

    const lowStock = await ctx.runReport(
      aggregateQuery({
        title: 'Items below minimum or reorder level',
        datasetId: 'stock_summary',
        metrics: ['low_stock_item_count'],
        filters: [{ filterId: 'low_stock_filter', operator: 'IN', value: ['BELOW_MINIMUM', 'BELOW_REORDER', 'NEGATIVE'] }],
      }),
    );
    const lowStockCount = metricValue(lowStock.rows[0], 'low_stock_item_count');
    if (lowStockCount > 0) {
      candidates.push({
        dedupeKey: 'low-stock',
        severity: this.lowStockSeverity(lowStockCount),
        title: `${formatAmount(lowStockCount)} items are below minimum or reorder level`,
        summary: `${formatAmount(lowStockCount)} products are below their minimum or reorder stock level and risk stock-outs.`,
        confidence: 0.95,
        metrics: {
          headline: formatAmount(lowStockCount),
          headlineLabel: 'Items below minimum / reorder level',
          impactLabel: 'Stock-out exposure',
          impactValue: `${formatAmount(lowStockCount)} items`,
          lowStockCount,
        },
        evidence: ['Stock status computed from current quantity vs minimum/reorder levels'],
        actions: ['Generate purchase orders for the affected items', 'Review reorder levels for fast movers'],
        drillDownQuestion: 'Stock below minimum',
      });
    }

    const expiring = await ctx.runReport(
      aggregateQuery({
        title: 'Stock expiring in the next 90 days',
        datasetId: 'stock_batches',
        metrics: ['expiring_stock_value', 'expiring_batch_count'],
        timeRange: { ...customRange(ctx.now, daysAhead(ctx.now, EXPIRY_HORIZON_DAYS)), fieldId: 'expiry_date' },
      }),
    );
    const expiringValue = metricValue(expiring.rows[0], 'expiring_stock_value');
    const expiringBatches = metricValue(expiring.rows[0], 'expiring_batch_count');
    if (expiringValue > 0 && expiringBatches > 0) {
      candidates.push({
        dedupeKey: 'expiring-stock',
        severity: expiringValue > 500000 ? 'high' : expiringValue > 100000 ? 'medium' : 'low',
        title: `₹${formatAmount(expiringValue)} of stock expires within ${EXPIRY_HORIZON_DAYS} days`,
        summary:
          `${formatAmount(expiringBatches)} batches worth ₹${formatAmount(expiringValue)} ` +
          `expire within the next ${EXPIRY_HORIZON_DAYS} days. Liquidate or return them before write-off.`,
        confidence: 0.95,
        metrics: {
          headline: `₹${formatAmount(expiringValue)}`,
          headlineLabel: `Stock value expiring in ${EXPIRY_HORIZON_DAYS} days`,
          impactLabel: 'Batches at risk',
          impactValue: formatAmount(expiringBatches),
          expiringValue,
          expiringBatches,
          horizonDays: EXPIRY_HORIZON_DAYS,
        },
        evidence: [`Batch expiry dates within ${EXPIRY_HORIZON_DAYS} days of today`],
        actions: ['Push near-expiry batches through schemes or priority dispatch', 'Initiate purchase returns where supplier terms allow'],
        drillDownQuestion: 'Expiring stock in next 90 days',
      });
    }

    return candidates;
  }

  private lowStockSeverity(count: number): InsightSeverity {
    if (count >= 200) return 'high';
    if (count >= 50) return 'medium';
    return 'low';
  }
}
