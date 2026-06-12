import { Injectable } from '@nestjs/common';
import { AiDisputeStatus, AiLedgerType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

const D = (value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal =>
  new Prisma.Decimal(value ?? 0);

/**
 * Financial reporting over the ledger and usage logs. Every figure here is
 * derived from immutable records, so reports are reproducible for audits and
 * billing disputes.
 */
@Injectable()
export class BillingReportingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Super-admin platform metrics. */
  async adminOverview() {
    const [ledgerByType, usage, wallets, openDisputes, refunds] = await Promise.all([
      this.prisma.aiWalletTransaction.groupBy({ by: ['type'], _sum: { amount: true } }),
      this.prisma.aiUsageLog.aggregate({
        _sum: { providerCost: true, customerCharge: true, margin: true, totalTokens: true },
        _count: { _all: true },
      }),
      this.prisma.aiWallet.aggregate({ _sum: { balance: true }, _count: { _all: true } }),
      this.prisma.aiDispute.count({ where: { status: { in: [AiDisputeStatus.OPEN, AiDisputeStatus.UNDER_INVESTIGATION, AiDisputeStatus.AWAITING_CUSTOMER] } } }),
      this.prisma.aiRefund.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const sumFor = (type: AiLedgerType) => D(ledgerByType.find((row) => row.type === type)?._sum.amount);
    const revenue = sumFor(AiLedgerType.PURCHASE);
    const consumed = sumFor(AiLedgerType.USAGE_CHARGE).abs();
    return {
      totalRevenue: revenue.toFixed(2),
      creditsSold: revenue.toFixed(2),
      creditsConsumed: consumed.toFixed(2),
      providerCost: D(usage._sum.providerCost).toFixed(2),
      customerCharged: D(usage._sum.customerCharge).toFixed(2),
      profitMargin: D(usage._sum.margin).toFixed(2),
      marginPct: D(usage._sum.customerCharge).isZero()
        ? null
        : Number(D(usage._sum.margin).dividedBy(D(usage._sum.customerCharge)).times(100).toFixed(2)),
      outstandingCredits: D(wallets._sum.balance).toFixed(2),
      walletCount: wallets._count._all,
      refundAmount: D(refunds._sum.amount).toFixed(2),
      refundCount: refunds._count._all,
      openDisputes,
      totalRequests: usage._count._all,
      totalTokens: Number(usage._sum.totalTokens ?? 0),
    };
  }

  /** Daily revenue / consumption / cost / margin series for charts. */
  async adminTrends(days = 30) {
    const clamped = Math.min(Math.max(days, 7), 365);
    const [ledger, usage] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: Date; type: AiLedgerType; total: Prisma.Decimal }>>`
        SELECT date_trunc('day', created_at) AS day, type, COALESCE(SUM(amount), 0) AS total
        FROM ai_wallet_transactions
        WHERE created_at >= now() - make_interval(days => ${clamped})
        GROUP BY 1, 2 ORDER BY 1`,
      this.prisma.$queryRaw<Array<{ day: Date; provider_cost: Prisma.Decimal; customer_charge: Prisma.Decimal; requests: bigint }>>`
        SELECT date_trunc('day', created_at) AS day,
               COALESCE(SUM(provider_cost), 0) AS provider_cost,
               COALESCE(SUM(customer_charge), 0) AS customer_charge,
               COUNT(*) AS requests
        FROM ai_usage_logs
        WHERE created_at >= now() - make_interval(days => ${clamped})
        GROUP BY 1 ORDER BY 1`,
    ]);
    const byDay = new Map<string, { date: string; revenue: number; consumed: number; providerCost: number; customerCharge: number; requests: number }>();
    const ensure = (day: Date) => {
      const key = day.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, { date: key, revenue: 0, consumed: 0, providerCost: 0, customerCharge: 0, requests: 0 });
      return byDay.get(key)!;
    };
    for (const row of ledger) {
      const bucket = ensure(row.day);
      if (row.type === AiLedgerType.PURCHASE) bucket.revenue += Number(row.total);
      if (row.type === AiLedgerType.USAGE_CHARGE) bucket.consumed += Math.abs(Number(row.total));
    }
    for (const row of usage) {
      const bucket = ensure(row.day);
      bucket.providerCost = Number(row.provider_cost);
      bucket.customerCharge = Number(row.customer_charge);
      bucket.requests = Number(row.requests);
    }
    return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /** Usage and money grouped by model (and provider) for trends/reports. */
  async modelBreakdown(days = 30) {
    const clamped = Math.min(Math.max(days, 1), 365);
    return this.prisma.$queryRaw<Array<{
      provider_name: string; model_code: string; requests: bigint; total_tokens: bigint;
      provider_cost: Prisma.Decimal; customer_charge: Prisma.Decimal; margin: Prisma.Decimal;
    }>>`
      SELECT provider_name, model_code, COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS total_tokens,
             COALESCE(SUM(provider_cost), 0) AS provider_cost,
             COALESCE(SUM(customer_charge), 0) AS customer_charge,
             COALESCE(SUM(margin), 0) AS margin
      FROM ai_usage_logs
      WHERE created_at >= now() - make_interval(days => ${clamped})
      GROUP BY provider_name, model_code
      ORDER BY customer_charge DESC`;
  }

  /** Per-tenant usage report for the admin (customer usage). */
  async tenantBreakdown(days = 30) {
    const clamped = Math.min(Math.max(days, 1), 365);
    return this.prisma.$queryRaw<Array<{
      tenant_id: string; tenant_name: string; requests: bigint; total_tokens: bigint;
      customer_charge: Prisma.Decimal; provider_cost: Prisma.Decimal; balance: Prisma.Decimal | null;
    }>>`
      SELECT u.tenant_id, t.name AS tenant_name, COUNT(*) AS requests,
             COALESCE(SUM(u.total_tokens), 0) AS total_tokens,
             COALESCE(SUM(u.customer_charge), 0) AS customer_charge,
             COALESCE(SUM(u.provider_cost), 0) AS provider_cost,
             w.balance
      FROM ai_usage_logs u
      JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN ai_wallets w ON w.tenant_id = u.tenant_id
      WHERE u.created_at >= now() - make_interval(days => ${clamped})
      GROUP BY u.tenant_id, t.name, w.balance
      ORDER BY customer_charge DESC`;
  }

  /** Customer-facing month-to-date summary (drives the billing dashboard). */
  async customerSummary(tenantId: string) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [usage, byModel] = await Promise.all([
      this.prisma.aiUsageLog.aggregate({
        where: { tenantId, createdAt: { gte: monthStart } },
        _sum: { customerCharge: true, totalTokens: true },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ model_code: string; requests: bigint; customer_charge: Prisma.Decimal }>>`
        SELECT model_code, COUNT(*) AS requests, COALESCE(SUM(customer_charge), 0) AS customer_charge
        FROM ai_usage_logs
        WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${monthStart}
        GROUP BY model_code ORDER BY customer_charge DESC LIMIT 10`,
    ]);
    return {
      monthToDate: {
        requests: usage._count._all,
        totalTokens: Number(usage._sum.totalTokens ?? 0),
        spend: D(usage._sum.customerCharge).toFixed(4),
      },
      byModel: byModel.map((row) => ({
        modelCode: row.model_code,
        requests: Number(row.requests),
        spend: D(row.customer_charge).toFixed(4),
      })),
    };
  }

  async listUsage(filter: { tenantId?: string; userId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
    const where = {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.aiUsageLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.aiUsageLog.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }
}
