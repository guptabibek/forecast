import { Injectable, NotFoundException } from '@nestjs/common';
import { ActualType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { margSalesAmountSignSql } from '../marg-ede/marg-voucher-family.sql';
import {
  ExportReportDto,
  GenerateReportDto,
  SaveReportDto,
  ScheduleReportDto,
} from './dto';

const REVENUE_ACTUAL_TYPES: ActualType[] = [ActualType.SALES, ActualType.REVENUE];

@Injectable()
export class ReportsManagementService {
  constructor(private readonly prisma: PrismaService) {}

  private erpSalesLineTypeSql(mv: string, mt: string): Prisma.Sql {
    return Prisma.sql`
      (
        (${Prisma.raw(mv)}.type = 'S' AND ${Prisma.raw(mt)}.type IN ('G', 'S', 'O'))
        OR (${Prisma.raw(mv)}.type = 'R' AND ${Prisma.raw(mt)}.type = 'R')
        OR (${Prisma.raw(mv)}.type = 'T' AND ${Prisma.raw(mt)}.type IN ('X', 'T'))
      )
    `;
  }

  async getReports(tenantId: string) {
    return this.prisma.report.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createReport(tenantId: string, dto: SaveReportDto, user: any) {
    return this.prisma.report.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description || null,
        type: dto.type || 'line',
        config: (dto.config || {}) as any,
        createdById: user?.id || null,
      },
    });
  }

  async getReportById(tenantId: string, id: string) {
    const report = await this.prisma.report.findFirst({
      where: { id, tenantId },
    });
    if (!report) {
      throw new NotFoundException(`Report with ID ${id} not found`);
    }
    return report;
  }

  async getReportData(tenantId: string, id: string) {
    const report = await this.getReportById(tenantId, id);
    const config = report.config as any || {};

    let data: Array<{ period?: string; name?: string; actual?: number; forecast?: number; budget?: number; variance?: number; value?: number }> = [];
    let total = 0;
    let count = 0;

    if (report.type === 'pie') {
      // Category breakdown uses family-signed per-line amounts so a returned
      // unit's revenue nets against the prior sale and SC/CHAL contribute 0.
      // The header filter drops 'T' (SC) since SC is accounting-only and
      // never belongs in commercial category aggregates.
      const categoryData = await this.prisma.$queryRaw<Array<{ category: string; total_value: number }>>(Prisma.sql`
        SELECT
          COALESCE(p.category, mprod.g_code5, 'Other') AS category,
          COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS total_value
        FROM marg_vouchers mv
        JOIN marg_transactions mt
          ON mt.tenant_id = mv.tenant_id
          AND mt.company_id = mv.company_id
          AND mt.voucher = mv.voucher
          AND ${this.erpSalesLineTypeSql('mv', 'mt')}
        LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
        LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mt.tenant_id
        WHERE mv.tenant_id = ${tenantId}::uuid
          AND mv.is_cancelled = FALSE
          AND mv.type IN ('S', 'R')
        GROUP BY COALESCE(p.category, mprod.g_code5, 'Other')
        ORDER BY total_value DESC
        LIMIT 5
      `);

      data = categoryData.map((item) => {
        const value = Number(item.total_value) || 0;
        total += value;
        count++;
        return { name: item.category, value: Math.round(value) };
      });
    } else {
      // Monthly actuals: per-voucher bill amount signed by family before the
      // outer SUM, so the rolled-up monthly figure subtracts CN returns,
      // excludes challan totals, and drops SC entirely (T filtered out above).
      const actualsData = await this.prisma.$queryRaw<Array<{ period: string; total_value: number }>>(Prisma.sql`
        SELECT
          TO_CHAR(mv.date, 'YYYY-MM') AS period,
          COALESCE(SUM(bill_amount), 0)::float8 AS total_value
        FROM (
          SELECT mv.company_id, mv.voucher, mv.date,
            (COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))) * ${margSalesAmountSignSql('mv')})::float8 AS bill_amount
          FROM marg_vouchers mv
          LEFT JOIN marg_transactions mt
            ON mt.tenant_id = mv.tenant_id
            AND mt.company_id = mv.company_id
            AND mt.voucher = mv.voucher
            AND ${this.erpSalesLineTypeSql('mv', 'mt')}
          WHERE mv.tenant_id = ${tenantId}::uuid
            AND mv.is_cancelled = FALSE
            AND mv.type IN ('S', 'R')
          -- mv.family is referenced by the sign multiplier OUTSIDE the
          -- per-voucher aggregates (the multiplication is at the
          -- single-row-per-group level, not inside MAX/SUM). Postgres does
          -- not infer functional dependency of a STORED GENERATED column
          -- from (type, vcn), so list mv.family explicitly to avoid error
          -- 42803. Adding it does not expand cardinality -- family is
          -- constant per voucher.
          GROUP BY mv.company_id, mv.voucher, mv.date, mv.type, mv.vcn, mv.family
        ) mv
        GROUP BY TO_CHAR(mv.date, 'YYYY-MM')
        ORDER BY period
      `);

      const forecastsData = config.planId
        ? await this.prisma.$queryRaw<Array<{ period: string; total_value: number }>>`
          WITH latest_run AS (
            SELECT id
            FROM forecast_runs
            WHERE tenant_id = ${tenantId}::uuid
              AND plan_version_id = ${config.planId}::uuid
              AND status = 'COMPLETED'
            ORDER BY completed_at DESC
            LIMIT 1
          )
          SELECT TO_CHAR(fr.period_date, 'YYYY-MM') as period, SUM(fr.forecast_amount) as total_value
          FROM forecast_results fr
          JOIN latest_run lr ON fr.forecast_run_id = lr.id
          GROUP BY TO_CHAR(fr.period_date, 'YYYY-MM')
          ORDER BY period
        `
        : await this.prisma.$queryRaw<Array<{ period: string; total_value: number }>>`
          WITH latest_run AS (
            SELECT id
            FROM forecast_runs
            WHERE tenant_id = ${tenantId}::uuid
              AND status = 'COMPLETED'
            ORDER BY completed_at DESC
            LIMIT 1
          )
          SELECT TO_CHAR(fr.period_date, 'YYYY-MM') as period, SUM(fr.forecast_amount) as total_value
          FROM forecast_results fr
          JOIN latest_run lr ON fr.forecast_run_id = lr.id
          GROUP BY TO_CHAR(fr.period_date, 'YYYY-MM')
          ORDER BY period
        `;

      const actualsMap = new Map(actualsData.map((a) => [a.period, Number(a.total_value) || 0]));
      const forecastsMap = new Map(forecastsData.map((f) => [f.period, Number(f.total_value) || 0]));
      const allPeriods = [...new Set([...actualsMap.keys(), ...forecastsMap.keys()])].sort();

      data = allPeriods.map((period) => {
        const actual = actualsMap.get(period) || 0;
        const forecast = forecastsMap.get(period) || 0;
        const budget = Math.round(forecast * 0.95);
        total += forecast;
        count++;
        return {
          period,
          actual: Math.round(actual),
          forecast: Math.round(forecast),
          budget,
          variance: forecast > 0 ? Math.round(((actual - forecast) / forecast) * 100) : 0,
        };
      });
    }

    if (data.length === 0) {
      return {
        data: [],
        summary: { total: 0, average: 0, variance: 0, count: 0, minValue: 0, maxValue: 0 },
      };
    }

    const nonPieData = data.filter((d) => d.actual !== undefined && d.forecast !== undefined);
    const avgVariance = nonPieData.length
      ? Math.round((nonPieData.reduce((sum, d) => sum + (d.variance || 0), 0) / nonPieData.length) * 10) / 10
      : 0;
    const values = data.map((d) => d.actual || d.value || 0);

    return {
      data,
      summary: {
        total: Math.round(total),
        average: count > 0 ? Math.round(total / count) : 0,
        variance: avgVariance,
        count,
        minValue: Math.round(Math.min(...values)),
        maxValue: Math.round(Math.max(...values)),
      },
    };
  }

  async updateReport(tenantId: string, id: string, dto: SaveReportDto) {
    await this.getReportById(tenantId, id);
    return this.prisma.report.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        config: (dto.config || {}) as any,
      },
    });
  }

  async deleteReport(tenantId: string, id: string) {
    await this.getReportById(tenantId, id);
    await this.prisma.report.delete({ where: { id } });
    return { success: true, id };
  }

  async generateSummaryReport(tenantId: string) {
    const [totalPlans, activePlans, totalForecasts, pendingApprovals, recentActivity] = await Promise.all([
      this.prisma.planVersion.count({ where: { tenantId } }),
      this.prisma.planVersion.count({ where: { tenantId, status: 'APPROVED' } }),
      this.prisma.forecast.count({ where: { tenantId } }),
      this.prisma.planVersion.count({ where: { tenantId, status: 'IN_REVIEW' } }),
      this.getRecentActivity(tenantId),
    ]);

    return {
      data: {
        overview: { totalPlans, activePlans, totalForecasts, pendingApprovals },
        recentActivity,
        topPerformers: await this.getTopPerformers(tenantId),
        alerts: await this.generateAlerts(tenantId),
      },
    };
  }

  async generateVarianceReport(tenantId: string, dto: GenerateReportDto) {
    const { startDate, endDate, dimensionType, dimensionIds } = dto;
    const actuals = await this.prisma.actual.findMany({
      where: {
        tenantId,
        actualType: { in: REVENUE_ACTUAL_TYPES },
        periodDate: { gte: new Date(startDate), lte: new Date(endDate) },
        ...(dimensionType === 'product' && dimensionIds?.length ? { productId: { in: dimensionIds } } : {}),
        ...(dimensionType === 'location' && dimensionIds?.length ? { locationId: { in: dimensionIds } } : {}),
      },
      orderBy: { periodDate: 'asc' },
    });

    const periodMap = new Map<string, { forecast: number; actual: number }>();
    for (const actual of actuals) {
      const periodKey = actual.periodDate.toISOString().split('T')[0];
      const existing = periodMap.get(periodKey) || { forecast: 0, actual: 0 };
      existing.actual += Number(actual.amount);
      periodMap.set(periodKey, existing);
    }

    return {
      data: Array.from(periodMap.entries())
        .map(([period, values]) => ({
          period,
          forecast: values.forecast,
          actual: values.actual,
          variance: values.actual - values.forecast,
          variancePercent: values.forecast !== 0 ? ((values.actual - values.forecast) / values.forecast) * 100 : 0,
        }))
        .sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()),
    };
  }

  async generateDimensionReport(tenantId: string, dto: GenerateReportDto) {
    const { dimensionType, startDate, endDate } = dto;
    const actuals = await this.prisma.actual.findMany({
      where: {
        tenantId,
        actualType: { in: REVENUE_ACTUAL_TYPES },
        periodDate: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      include: {
        product: { select: { name: true, code: true } },
        location: { select: { name: true, code: true } },
        customer: { select: { name: true, code: true } },
        account: { select: { name: true, code: true } },
      },
    });

    const dimensionMap = new Map<string, { name: string; amount: number; quantity: number }>();
    for (const actual of actuals) {
      const dimension =
        dimensionType === 'product'
          ? { key: actual.productId || 'unknown', name: actual.product?.name || 'Unknown Product' }
          : dimensionType === 'location'
            ? { key: actual.locationId || 'unknown', name: actual.location?.name || 'Unknown Location' }
            : dimensionType === 'customer'
              ? { key: actual.customerId || 'unknown', name: actual.customer?.name || 'Unknown Customer' }
              : dimensionType === 'account'
                ? { key: actual.accountId || 'unknown', name: actual.account?.name || 'Unknown Account' }
                : { key: 'total', name: 'Total' };
      const existing = dimensionMap.get(dimension.key) || { name: dimension.name, amount: 0, quantity: 0 };
      existing.amount += Number(actual.amount);
      existing.quantity += Number(actual.quantity || 0);
      dimensionMap.set(dimension.key, existing);
    }

    return {
      data: Array.from(dimensionMap.entries())
        .map(([id, values]) => ({ id, name: values.name, totalAmount: values.amount, totalQuantity: values.quantity }))
        .sort((a, b) => b.totalAmount - a.totalAmount),
    };
  }

  async saveReport(dto: SaveReportDto, user: any) {
    return {
      id: crypto.randomUUID(),
      name: dto.name,
      config: dto.config,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
    };
  }

  async exportReport(dto: ExportReportDto, _user: any) {
    return {
      downloadUrl: `/api/v1/reports/download/${crypto.randomUUID()}`,
      format: dto.format,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  }

  async scheduleReport(dto: ScheduleReportDto, user: any) {
    return {
      id: crypto.randomUUID(),
      frequency: dto.frequency,
      nextRunAt: this.calculateNextRun(dto.frequency),
      createdBy: user.id,
    };
  }

  private async getRecentActivity(tenantId: string, limit: number = 10) {
    const activities = await this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return activities.map((activity) => ({
      id: activity.id,
      type: this.mapActionToType(activity.action),
      title: this.formatAuditTitle(activity.action, activity.entityType),
      user: activity.userId || 'System',
      createdAt: activity.createdAt,
    }));
  }

  private async getTopPerformers(tenantId: string) {
    const aggregated = await this.prisma.actual.groupBy({
      by: ['productId'],
      where: { tenantId, actualType: { in: REVENUE_ACTUAL_TYPES }, productId: { not: null } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    });

    const productIds = aggregated.map((a) => a.productId).filter((v): v is string => Boolean(v));
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p.name]));

    return aggregated.map((a) => ({
      name: (a.productId && productMap.get(a.productId)) || 'Unknown',
      amount: Number(a._sum.amount ?? 0),
    }));
  }

  private async generateAlerts(tenantId: string) {
    const alerts: { type: string; message: string; severity: string }[] = [];
    const [pendingImports, pendingApprovals] = await Promise.all([
      this.prisma.dataImport.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.planVersion.count({ where: { tenantId, status: 'IN_REVIEW' } }),
    ]);

    if (pendingImports > 0) {
      alerts.push({ type: 'data', message: `${pendingImports} data import(s) pending`, severity: 'warning' });
    }
    if (pendingApprovals > 0) {
      alerts.push({ type: 'approval', message: `${pendingApprovals} plan(s) pending approval`, severity: 'info' });
    }
    return alerts;
  }

  private mapActionToType(action: string): string {
    if (action.includes('APPROVE') || action.includes('SUBMIT')) return 'approval';
    if (action.includes('FORECAST') || action.includes('GENERATE')) return 'forecast';
    if (action.includes('IMPORT') || action.includes('UPLOAD')) return 'import';
    if (action.includes('PLAN') || action.includes('CREATE')) return 'plan';
    return 'other';
  }

  private formatAuditTitle(action: string, entityType: string): string {
    switch (action) {
      case 'CREATE': return `New ${entityType.toLowerCase()} created`;
      case 'UPDATE': return `${entityType} updated`;
      case 'DELETE': return `${entityType} deleted`;
      case 'APPROVE': return `${entityType} approved`;
      case 'SUBMIT': return `${entityType} submitted for approval`;
      default: return `${action} on ${entityType}`;
    }
  }

  private calculateNextRun(frequency: string): string {
    const now = new Date();
    switch (frequency) {
      case 'daily': return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      case 'weekly': return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      case 'monthly': return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      default: return now.toISOString();
    }
  }
}
