import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext } from '../insight-provider.interface';
import { aggregateQuery, customRange, daysAgo, formatAmount, labelValue, metricValue } from './provider-utils';

const RECENT_DAYS = 30;
const BASELINE_DAYS = 90;
const MIN_BASELINE_VALUE = 5000;

/**
 * Detects customer churn risk: customers who bought regularly in the
 * baseline window (90→30 days ago) but have no purchases in the last 30 days.
 */
@Injectable()
export class ChurnInsightProvider implements IInsightProvider {
  readonly providerId = 'churn';
  readonly displayName = 'Customer Churn Risk';
  readonly category = 'customers';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const [baseline, recent] = await Promise.all([
      ctx.runReport(
        aggregateQuery({
          title: 'Customer sales (baseline window)',
          datasetId: 'sales_net',
          metrics: ['sales_net_amount'],
          dimensions: ['sales_net_customer'],
          timeRange: customRange(daysAgo(ctx.now, BASELINE_DAYS), daysAgo(ctx.now, RECENT_DAYS + 1)),
          sortByMetric: 'sales_net_amount',
          limit: 500,
        }),
      ),
      ctx.runReport(
        aggregateQuery({
          title: 'Customer sales (recent window)',
          datasetId: 'sales_net',
          metrics: ['sales_net_amount'],
          dimensions: ['sales_net_customer'],
          timeRange: customRange(daysAgo(ctx.now, RECENT_DAYS), ctx.now),
          limit: 2000,
        }),
      ),
    ]);

    const activeRecently = new Set(
      recent.rows
        .filter((row) => metricValue(row, 'sales_net_amount') > 0)
        .map((row) => labelValue(row, ['customer_name', 'customer_code']).toLowerCase()),
    );

    const churned = baseline.rows
      .map((row) => ({
        name: labelValue(row, ['customer_name', 'customer_code']),
        baselineValue: metricValue(row, 'sales_net_amount'),
      }))
      .filter((item) => item.baselineValue >= MIN_BASELINE_VALUE && !activeRecently.has(item.name.toLowerCase()));

    if (!churned.length) return [];

    const valueAtRisk = churned.reduce((sum, item) => sum + item.baselineValue, 0);
    const top = churned.sort((a, b) => b.baselineValue - a.baselineValue).slice(0, 5);

    return [
      {
        dedupeKey: 'churn-risk',
        severity: churned.length >= 20 || valueAtRisk > 500000 ? 'high' : churned.length >= 5 ? 'medium' : 'low',
        title: `${formatAmount(churned.length)} regular customers have stopped ordering`,
        summary:
          `${formatAmount(churned.length)} customers who bought ₹${formatAmount(valueAtRisk)} between ` +
          `${BASELINE_DAYS} and ${RECENT_DAYS} days ago have placed no orders in the last ${RECENT_DAYS} days.`,
        confidence: 0.75,
        metrics: {
          headline: formatAmount(churned.length),
          headlineLabel: `Customers inactive for ${RECENT_DAYS}+ days`,
          impactLabel: 'Revenue at risk',
          impactValue: `₹${formatAmount(valueAtRisk)}`,
          churnedCustomerCount: churned.length,
          valueAtRisk,
          recentDays: RECENT_DAYS,
          baselineDays: BASELINE_DAYS,
        },
        evidence: top.map((item) => `${item.name}: ₹${formatAmount(item.baselineValue)} in baseline window, nothing since`),
        actions: [
          'Have the assigned salesman contact each inactive customer',
          'Check for unresolved complaints, credit blocks, or pricing disputes',
          'Offer a reactivation scheme to the highest-value inactive customers',
        ],
        drillDownQuestion: 'Customer-wise sales last 30 days',
      },
    ];
  }
}
