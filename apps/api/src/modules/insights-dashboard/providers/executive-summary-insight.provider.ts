import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext, InsightSeverity } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAgo, daysAhead, formatAmount, metricValue, percent } from './provider-utils';

const WINDOW_DAYS = 30;
const EXPIRY_HORIZON_DAYS = 90;

/**
 * Composite business-health score (0–100) from four measurable pillars:
 * revenue trend, receivables pressure, expiry exposure, and stock-out
 * pressure. Deterministic and explainable — every deduction is listed as
 * evidence.
 */
@Injectable()
export class ExecutiveSummaryInsightProvider implements IInsightProvider {
  readonly providerId = 'executive-summary';
  readonly displayName = 'Business Health Summary';
  readonly category = 'summary';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const [salesCurrent, salesPrevious, outstanding, expiring, stockValue, lowStock] = await Promise.all([
      ctx.runReport(
        aggregateQuery({
          title: 'Net sales (current window)',
          datasetId: 'sales_net',
          metrics: ['sales_net_amount'],
          timeRange: customRange(daysAgo(ctx.now, WINDOW_DAYS), ctx.now),
        }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Net sales (previous window)',
          datasetId: 'sales_net',
          metrics: ['sales_net_amount'],
          timeRange: customRange(daysAgo(ctx.now, WINDOW_DAYS * 2), daysAgo(ctx.now, WINDOW_DAYS + 1)),
        }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Customer outstanding total',
          datasetId: 'party_outstanding',
          metrics: ['outstanding_amount'],
          filters: [{ filterId: 'party_type_filter', operator: '=', value: 'CUSTOMER' }],
        }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Stock expiring within 90 days',
          datasetId: 'stock_batches',
          metrics: ['expiring_stock_value'],
          timeRange: { ...customRange(ctx.now, daysAhead(ctx.now, EXPIRY_HORIZON_DAYS)), fieldId: 'expiry_date' },
        }),
      ),
      ctx.runReport(
        aggregateQuery({ title: 'Total stock value', datasetId: 'stock_summary', metrics: ['stock_value'] }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Items below minimum or reorder level',
          datasetId: 'stock_summary',
          metrics: ['low_stock_item_count'],
          filters: [{ filterId: 'low_stock_filter', operator: 'IN', value: ['BELOW_MINIMUM', 'BELOW_REORDER', 'NEGATIVE'] }],
        }),
      ),
    ]);

    const currentSales = metricValue(salesCurrent.rows[0], 'sales_net_amount');
    const previousSales = metricValue(salesPrevious.rows[0], 'sales_net_amount');
    if (currentSales <= 0 && previousSales <= 0) return []; // No sales history — a score would be meaningless.

    const outstandingTotal = metricValue(outstanding.rows[0], 'outstanding_amount');
    const expiringValue = metricValue(expiring.rows[0], 'expiring_stock_value');
    const totalStockValue = metricValue(stockValue.rows[0], 'stock_value');
    const lowStockCount = metricValue(lowStock.rows[0], 'low_stock_item_count');

    let score = 100;
    const evidence: string[] = [];

    const revenueChangePct = previousSales > 0 ? ((currentSales - previousSales) / previousSales) * 100 : 0;
    if (previousSales > 0) {
      if (revenueChangePct <= -20) score -= 25;
      else if (revenueChangePct <= -10) score -= 15;
      else if (revenueChangePct < 0) score -= 5;
      evidence.push(
        `Sales ${revenueChangePct >= 0 ? 'up' : 'down'} ${percent(revenueChangePct)} vs previous ${WINDOW_DAYS} days ` +
          `(₹${formatAmount(currentSales)})`,
      );
    }

    const outstandingRatio = currentSales > 0 ? outstandingTotal / currentSales : 0;
    if (currentSales > 0 && outstandingTotal > 0) {
      if (outstandingRatio > 2) score -= 20;
      else if (outstandingRatio > 1) score -= 10;
      else if (outstandingRatio > 0.5) score -= 5;
      evidence.push(
        `Customer outstanding ₹${formatAmount(outstandingTotal)} = ${outstandingRatio.toFixed(1)}× monthly sales`,
      );
    }

    const expiryRatio = totalStockValue > 0 ? expiringValue / totalStockValue : 0;
    if (expiringValue > 0 && totalStockValue > 0) {
      if (expiryRatio > 0.2) score -= 15;
      else if (expiryRatio > 0.1) score -= 8;
      else if (expiryRatio > 0.05) score -= 4;
      evidence.push(
        `₹${formatAmount(expiringValue)} (${(expiryRatio * 100).toFixed(0)}% of stock value) expires within ${EXPIRY_HORIZON_DAYS} days`,
      );
    }

    if (lowStockCount >= 200) score -= 10;
    else if (lowStockCount >= 50) score -= 5;
    if (lowStockCount > 0) evidence.push(`${formatAmount(lowStockCount)} items below minimum or reorder level`);

    score = Math.min(100, Math.max(5, Math.round(score)));

    return [
      {
        dedupeKey: 'business-health',
        severity: this.scoreSeverity(score),
        title: `Business health score: ${score}/100 — ${this.scoreLabel(score)}`,
        summary:
          score >= 80
            ? 'Overall business performance is healthy. Keep an eye on the watch items below.'
            : score >= 60
              ? 'Business is broadly stable with specific risks that deserve attention this month.'
              : 'Multiple risk indicators are elevated — review the items below with your team this week.',
        confidence: 0.7,
        metrics: {
          headline: `${score}/100`,
          headlineLabel: 'Business health score',
          impactLabel: 'Sales (30d)',
          impactValue: `₹${formatAmount(currentSales)}`,
          score,
          revenueChangePct: Number(revenueChangePct.toFixed(2)),
          outstandingRatio: Number(outstandingRatio.toFixed(2)),
          expiryRatioPct: Number((expiryRatio * 100).toFixed(1)),
          lowStockCount,
        },
        evidence,
        actions:
          score >= 80
            ? ['Review the open insights below to keep the score healthy']
            : [
                'Prioritise the critical and high severity insights first',
                'Review collections and near-expiry stock in the weekly ops meeting',
              ],
        drillDownQuestion: 'Sales dashboard this month',
      },
    ];
  }

  private scoreSeverity(score: number): InsightSeverity {
    if (score >= 80) return 'info';
    if (score >= 60) return 'low';
    if (score >= 40) return 'medium';
    return 'high';
  }

  private scoreLabel(score: number): string {
    if (score >= 80) return 'stable';
    if (score >= 60) return 'needs attention';
    if (score >= 40) return 'at risk';
    return 'critical';
  }
}
