import { Injectable } from '@nestjs/common';
import { IInsightProvider, InsightCandidate, InsightProviderContext } from '../insight-provider.interface';
import { aggregateQuery, formatAmount, labelValue, metricValue } from './provider-utils';

const MIN_TOTAL_OUTSTANDING = 10000;

/**
 * Flags customer collection risk from outstanding receivables, highlighting
 * concentration in the top parties.
 */
@Injectable()
export class OutstandingInsightProvider implements IInsightProvider {
  readonly providerId = 'outstanding';
  readonly displayName = 'Outstanding Collection Risk';
  readonly category = 'outstanding';
  readonly defaultEnabled = true;

  async generate(ctx: InsightProviderContext): Promise<InsightCandidate[]> {
    const byParty = await ctx.runReport(
      aggregateQuery({
        title: 'Customer outstanding by party',
        datasetId: 'party_outstanding',
        metrics: ['outstanding_amount'],
        dimensions: ['party'],
        filters: [{ filterId: 'party_type_filter', operator: '=', value: 'CUSTOMER' }],
        sortByMetric: 'outstanding_amount',
        limit: 500,
      }),
    );

    const parties = byParty.rows
      .map((row) => ({
        name: labelValue(row, ['party_name', 'party_code']),
        amount: metricValue(row, 'outstanding_amount'),
      }))
      .filter((party) => party.amount > 0);
    if (!parties.length) return [];

    const total = parties.reduce((sum, party) => sum + party.amount, 0);
    if (total < MIN_TOTAL_OUTSTANDING) return [];

    const top = parties.slice(0, 5);
    const topShare = total > 0 ? (top.reduce((sum, party) => sum + party.amount, 0) / total) * 100 : 0;

    return [
      {
        dedupeKey: 'customer-outstanding',
        severity: topShare >= 60 ? 'high' : topShare >= 40 ? 'medium' : 'low',
        title: `₹${formatAmount(total)} outstanding from customers — top 5 hold ${topShare.toFixed(0)}%`,
        summary:
          `Customers owe ₹${formatAmount(total)} in total. The top 5 parties account for ` +
          `${topShare.toFixed(0)}% of it; prioritise follow-up there for the fastest collection impact.`,
        confidence: 0.85,
        metrics: {
          headline: `₹${formatAmount(total)}`,
          headlineLabel: 'Total customer outstanding',
          impactLabel: 'Top 5 parties hold',
          impactValue: `${topShare.toFixed(0)}%`,
          totalOutstanding: total,
          partyCount: parties.length,
          topFiveSharePct: Number(topShare.toFixed(1)),
        },
        evidence: top.map((party) => `${party.name}: ₹${formatAmount(party.amount)} outstanding`),
        actions: [
          'Schedule collection calls for the top outstanding parties',
          'Pause further credit to parties exceeding their limit',
          'Reconcile disputed invoices blocking payment',
        ],
        drillDownQuestion: 'Customer outstanding summary',
      },
    ];
  }
}
