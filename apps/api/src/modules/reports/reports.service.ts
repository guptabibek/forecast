import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { margSalesAmountSignSql } from '../marg-ede/marg-voucher-family.sql';
import {
    ABCAnalysisDto,
    DashboardFilterDto,
} from './dto';

// Helper to build dimension filter conditions
interface DimensionFilters {
  productId?: { in: string[] };
  customerId?: { in: string[] };
}

type DashboardGranularity = NonNullable<DashboardFilterDto['granularity']>;

interface DashboardDateRange {
  start: Date;
  end: Date;
}

const DEFAULT_DASHBOARD_PERIODS = 6;
const DEFAULT_ANALYTICS_PERIODS = 12;
const MAX_DASHBOARD_FORECAST_ROWS = 5000;
const MAX_DASHBOARD_ACTUAL_ROWS = 10000;

function buildDimensionFilters(filters?: DashboardFilterDto): DimensionFilters {
  const conditions: DimensionFilters = {};
  if (filters?.productIds?.length) {
    conditions.productId = { in: filters.productIds };
  }
  if (filters?.customerIds?.length) {
    conditions.customerId = { in: filters.customerIds };
  }
  return conditions;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveDashboardDateRange(
    filters?: DashboardFilterDto,
    defaultPeriods: number = DEFAULT_DASHBOARD_PERIODS,
    defaultGranularity: DashboardGranularity = 'monthly',
  ): DashboardDateRange {
    const safeEnd = filters?.endDate ? new Date(filters.endDate) : new Date();
    const end = Number.isNaN(safeEnd.getTime()) ? new Date() : safeEnd;
    end.setHours(23, 59, 59, 999);

    if (filters?.startDate) {
      const parsedStart = new Date(filters.startDate);
      if (!Number.isNaN(parsedStart.getTime())) {
        parsedStart.setHours(0, 0, 0, 0);
        return { start: parsedStart, end };
      }
    }

    const granularity = filters?.granularity ?? defaultGranularity;
    const periods = Math.max(1, filters?.periods ?? defaultPeriods);
    const start = new Date(end);

    switch (granularity) {
      case 'daily':
        start.setDate(start.getDate() - (periods - 1));
        break;
      case 'weekly':
        start.setDate(start.getDate() - ((periods * 7) - 1));
        break;
      case 'quarterly':
        start.setMonth(start.getMonth() - (periods * 3) + 1, 1);
        break;
      case 'monthly':
      default:
        start.setMonth(start.getMonth() - periods + 1, 1);
        break;
    }

    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  private buildDashboardComparisonKey(
    periodDate: Date,
    productId?: string | null,
    locationId?: string | null,
    customerId?: string | null,
  ): string {
    return [
      this.dashboardDateKey(periodDate),
      productId || '',
      locationId || '',
      customerId || '',
    ].join('|');
  }

  private dashboardDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalizeDashboardPeriod(date: Date, granularity: DashboardGranularity, fiscalYearStart = 4): string {
    switch (granularity) {
      case 'daily':
        return this.dashboardDateKey(date);
      case 'weekly': {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        return `W${this.dashboardDateKey(weekStart)}`;
      }
      case 'quarterly': {
        // Fiscal quarter: Q1 starts at fiscalYearStart, quarters are 3-month windows.
        // fyYear is the calendar year in which this fiscal year began.
        const fyMonth0 = fiscalYearStart - 1;
        const fyYear = date.getMonth() >= fyMonth0 ? date.getFullYear() : date.getFullYear() - 1;
        const monthsIntoFY = ((date.getMonth() - fyMonth0) + 12) % 12;
        const quarterNum = Math.floor(monthsIntoFY / 3) + 1;
        return `${fyYear}-Q${quarterNum}`;
      }
      case 'monthly':
      default:
        return this.dashboardDateKey(date).substring(0, 7);
    }
  }

  private formatDashboardPeriodLabel(period: string, granularity: DashboardGranularity): string {
    switch (granularity) {
      case 'daily':
        return new Date(period).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      case 'weekly':
        return period.replace('W', 'Week ').substring(0, 12);
      case 'quarterly':
        return period;
      case 'monthly':
      default:
        return new Date(`${period}-01`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    }
  }

  private erpSalesLineTypeSql(voucherAlias: string, transactionAlias: string): Prisma.Sql {
    const mv = Prisma.raw(voucherAlias);
    const mt = Prisma.raw(transactionAlias);
    return Prisma.sql`(
      (${mv}.type = 'S' AND ${mt}.type IN ('G', 'S', 'O'))
      OR (${mv}.type = 'R' AND ${mt}.type = 'R')
      OR (${mv}.type = 'T' AND ${mt}.type IN ('X', 'T'))
    )`;
  }

  private erpDashboardWhereSql(
    tenantId: string,
    filters?: DashboardFilterDto,
    range?: DashboardDateRange,
    voucherAlias = 'mv',
    transactionAlias = 'mt',
    productAlias = 'mprod',
    partyAlias = 'mp',
  ): Prisma.Sql {
    const mv = Prisma.raw(voucherAlias);
    const mprod = Prisma.raw(productAlias);
    const mp = Prisma.raw(partyAlias);
    // Header type filter intentionally excludes 'T' (SC price-difference) —
    // SC is accounting-only per business rules confirmed by QA and must not
    // contribute to commercial sales dashboards. Challans (S/CHAL) remain in
    // the load so they can be filtered by family downstream, but their
    // contribution to monetary aggregates is suppressed by margSalesAmountSignSql
    // returning 0 for the SALES_CHALLAN family.
    // `is_cancelled = FALSE` excludes Marg-cancelled vouchers — cancelled
    // documents must never contribute to dashboard sales totals.
    const conds: Prisma.Sql[] = [
      Prisma.sql`${mv}.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`${mv}.is_cancelled = FALSE`,
      Prisma.sql`${mv}.type IN ('S', 'R')`,
    ];

    if (range?.start) conds.push(Prisma.sql`${mv}.date >= ${this.dashboardDateKey(range.start)}::date`);
    if (range?.end) conds.push(Prisma.sql`${mv}.date <= ${this.dashboardDateKey(range.end)}::date`);
    if (filters?.startDate && !range?.start) conds.push(Prisma.sql`${mv}.date >= ${filters.startDate}::date`);
    if (filters?.endDate && !range?.end) conds.push(Prisma.sql`${mv}.date <= ${filters.endDate}::date`);
    if (filters?.productIds?.length) conds.push(Prisma.sql`${mprod}.product_id = ANY(${filters.productIds}::uuid[])`);
    if (filters?.customerIds?.length) conds.push(Prisma.sql`${mp}.customer_id = ANY(${filters.customerIds}::uuid[])`);

    return Prisma.sql`${Prisma.join(conds, ' AND ')}`;
  }

  private erpSalesBillRollupSql(
    tenantId: string,
    filters?: DashboardFilterDto,
    range?: DashboardDateRange,
  ): Prisma.Sql {
    const where = this.erpDashboardWhereSql(tenantId, filters, range);
    return Prisma.sql`
      SELECT
        mv.company_id || ':' || mv.voucher AS bill_key,
        mv.company_id,
        mv.voucher,
        mv.type,
        mv.date,
        COALESCE(mb.location_id::text, mv.company_id::text) AS location_id,
        COALESCE(mb.name, mb.branch, 'Company ' || mv.company_id::text) AS location_name,
        -- Family-signed monetary amounts: invoice +1, return -1, challan 0.
        -- Downstream SUM(net_amount) gives net commercial sales (gross less
        -- returns, excluding challans). The pre-fix expression summed every
        -- type unsigned which double-counted returns and inflated headlines.
        (COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))) * ${margSalesAmountSignSql('mv')})::float8 AS net_amount,
        (COALESCE(SUM(ABS(COALESCE(mt.amount, 0))), 0) * ${margSalesAmountSignSql('mv')})::float8 AS taxable_amount,
        (COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0) * ${margSalesAmountSignSql('mv')})::float8 AS quantity,
        COUNT(DISTINCT mt.pid) FILTER (WHERE mt.pid IS NOT NULL)::int AS item_count,
        -- State/area codes from marg_transactions.add_field (';'-separated positional format).
        -- Format: I; ;BWMF;00;0;;date;0;...;0;STATE_CODE;AREA_CODE;...
        -- SPLIT_PART position 20 (1-indexed) = state s_code (marg_sale_types sg_code='ROUT')
        -- SPLIT_PART position 21 (1-indexed) = area  s_code (marg_sale_types sg_code='AREA')
        -- MAX used because all transaction rows for a voucher carry the same header-level codes.
        MAX(NULLIF(TRIM(SPLIT_PART(COALESCE(mt.add_field, ''), ';', 20)), '')) AS state_code,
        MAX(NULLIF(TRIM(SPLIT_PART(COALESCE(mt.add_field, ''), ';', 21)), '')) AS area_code
      FROM marg_vouchers mv
      LEFT JOIN marg_transactions mt
        ON mt.tenant_id = mv.tenant_id
        AND mt.company_id = mv.company_id
        AND mt.voucher = mv.voucher
        AND ${this.erpSalesLineTypeSql('mv', 'mt')}
      LEFT JOIN marg_products mprod
        ON mprod.tenant_id = mv.tenant_id
        AND mprod.company_id = mv.company_id
        AND mprod.pid = mt.pid
      LEFT JOIN marg_parties mp
        ON mp.tenant_id = mv.tenant_id
        AND mp.company_id = mv.company_id
        AND mp.cid = mv.cid
      LEFT JOIN marg_branches mb
        ON mb.tenant_id = mv.tenant_id
        AND mb.company_id = mv.company_id
      WHERE ${where}
      -- mv.family is referenced by the signed_net_amount / signed_taxable
      -- / signed_quantity expressions above OUTSIDE any aggregate (it sits
      -- next to MAX/SUM in the multiplication). Postgres does NOT infer
      -- functional dependency of a STORED GENERATED column from its source
      -- columns, even when those source columns are in GROUP BY -- so we
      -- must list mv.family explicitly to avoid error 42803
      -- (column must appear in the GROUP BY clause or be used in an
      -- aggregate function). The column is functionally constant within
      -- a (company_id, voucher, type) group so listing it does not change
      -- the result cardinality.
      GROUP BY mv.company_id, mv.voucher, mv.type, mv.date, mv.family, mb.location_id, mb.name, mb.branch
    `;
  }

  private async getErpSalesAmount(
    tenantId: string,
    start: Date,
    end: Date,
    filters?: DashboardFilterDto,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ amount: number }>>(Prisma.sql`
      WITH bills AS (${this.erpSalesBillRollupSql(tenantId, filters, { start, end })})
      SELECT COALESCE(SUM(net_amount), 0)::float8 AS amount FROM bills
    `);
    return Number(row?.amount ?? 0);
  }

  private async getErpSalesActualRows(
    tenantId: string,
    range: DashboardDateRange,
    filters?: DashboardFilterDto,
  ): Promise<Array<{
    periodDate: Date;
    amount: number;
    productId: string | null;
    locationId: string | null;
    customerId: string | null;
  }>> {
    const where = this.erpDashboardWhereSql(tenantId, filters, range);
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        mv.date::date AS "periodDate",
        COALESCE(mprod.product_id::text, mt.pid) AS "productId",
        mb.location_id::text AS "locationId",
        mp.customer_id::text AS "customerId",
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0))), 0)::float8 AS amount
      FROM marg_vouchers mv
      JOIN marg_transactions mt
        ON mt.tenant_id = mv.tenant_id
        AND mt.company_id = mv.company_id
        AND mt.voucher = mv.voucher
        AND ${this.erpSalesLineTypeSql('mv', 'mt')}
      LEFT JOIN marg_products mprod
        ON mprod.tenant_id = mv.tenant_id
        AND mprod.company_id = mv.company_id
        AND mprod.pid = mt.pid
      LEFT JOIN marg_parties mp
        ON mp.tenant_id = mv.tenant_id
        AND mp.company_id = mv.company_id
        AND mp.cid = mv.cid
      LEFT JOIN marg_branches mb
        ON mb.tenant_id = mv.tenant_id
        AND mb.company_id = mv.company_id
      WHERE ${where}
      GROUP BY mv.date::date, COALESCE(mprod.product_id::text, mt.pid), mb.location_id::text, mp.customer_id::text
      ORDER BY mv.date::date DESC
      LIMIT ${MAX_DASHBOARD_ACTUAL_ROWS}
    `);
  }

  // =====================
  // Dashboard Methods
  // =====================

  async getDashboardStats(tenantId: string, filters?: DashboardFilterDto) {
    const now = new Date();
    const lastQuarter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const currentRange = this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    const previousRange = this.getPreviousDashboardDateRange(currentRange);

    const dimensionFilters = buildDimensionFilters(filters);

    const [
      activePlans,
      pendingApproval,
      totalForecasts,
      forecastsLastQuarter,
      lastImport,
      accuracy,
      previousAccuracy,
    ] = await Promise.all([
      this.prisma.planVersion.count({
        where: { tenantId, status: { in: ['DRAFT', 'IN_REVIEW', 'APPROVED'] } },
      }),
      this.prisma.planVersion.count({
        where: { tenantId, status: 'IN_REVIEW' },
      }),
      this.prisma.forecast.count({ where: { tenantId, ...dimensionFilters } }),
      this.prisma.forecast.count({
        where: { tenantId, createdAt: { gte: lastQuarter }, ...dimensionFilters },
      }),
      this.prisma.dataImport.findFirst({
        where: { tenantId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
      this.calculateAverageAccuracy(tenantId, currentRange.start, currentRange.end, filters),
      this.calculateAverageAccuracy(tenantId, previousRange.start, previousRange.end, filters),
    ]);

    const forecastAccuracy = this.toForecastAccuracy(accuracy.mape, accuracy.comparisons);
    const previousForecastAccuracy = this.toForecastAccuracy(
      previousAccuracy.mape,
      previousAccuracy.comparisons,
    );
    const accuracyChange = accuracy.comparisons > 0 && previousAccuracy.comparisons > 0
      ? forecastAccuracy - previousForecastAccuracy
      : 0;
    const forecastsChange = forecastsLastQuarter > 0
      ? ((totalForecasts - forecastsLastQuarter) / forecastsLastQuarter) * 100
      : 0;

    return {
      data: {
        forecastAccuracy,
        accuracyChange,
        activePlans,
        pendingApproval,
        totalForecasts,
        forecastsChange,
        lastDataSync: lastImport?.completedAt?.toISOString() || new Date().toISOString(),
      },
    };
  }

  private async calculateAverageAccuracy(tenantId: string, startDate?: Date, endDate?: Date, filters?: DashboardFilterDto) {
    const dimensionFilters = buildDimensionFilters(filters);
    const dateRange = startDate && endDate
      ? { start: startDate, end: endDate }
      : this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    
    const forecasts = await this.prisma.forecast.findMany({
      where: {
        tenantId,
        ...dimensionFilters,
        periodDate: { gte: dateRange.start, lte: dateRange.end },
      },
      select: {
        periodDate: true,
        forecastAmount: true,
        productId: true,
        locationId: true,
        customerId: true,
      },
      take: 1000,
      orderBy: { periodDate: 'desc' },
    });

    if (forecasts.length === 0) {
      return { mape: 0, rmse: 0, comparisons: 0 };
    }

    const actuals = await this.getErpSalesActualRows(tenantId, dateRange, filters);

    // Sum amounts per (periodDate, product, location, customer) so multiple
    // line-level actuals (e.g. each Marg Dis line) compare correctly against a
    // forecast that was produced at month/product granularity. Without this
    // sum, only the latest line's amount survived in the map.
    const actualsMap = new Map<string, number>();
    for (const actual of actuals) {
      const key = this.buildDashboardComparisonKey(actual.periodDate, actual.productId, actual.locationId, actual.customerId);
      actualsMap.set(key, (actualsMap.get(key) ?? 0) + Number(actual.amount));
    }

    let totalError = 0;
    let validComparisons = 0;

    for (const forecast of forecasts) {
      const key = this.buildDashboardComparisonKey(forecast.periodDate, forecast.productId, forecast.locationId, forecast.customerId);
      const actualValue = actualsMap.get(key);
      
      if (actualValue !== undefined && actualValue !== 0) {
        const forecastValue = Number(forecast.forecastAmount);
        totalError += Math.abs((actualValue - forecastValue) / actualValue);
        validComparisons++;
      }
    }

    const mape = validComparisons > 0 ? totalError / validComparisons : 0;
    return { mape, rmse: 0, comparisons: validComparisons };
  }

  async getForecastTrend(tenantId: string, periods: number = 12, filters?: DashboardFilterDto) {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - periods, 1);
    const dateRange = { start: startDate, end: now };
    const dimensionFilters = buildDimensionFilters(filters);

    const actuals = await this.getErpSalesActualRows(tenantId, dateRange, filters);

    const forecasts = await this.prisma.forecast.findMany({
      where: {
        tenantId,
        periodDate: { gte: startDate },
        ...dimensionFilters,
      },
      select: {
        periodDate: true,
        forecastAmount: true,
        confidenceLower: true,
        confidenceUpper: true,
      },
    });

    const actualsByMonth = new Map<string, number>();
    for (const a of actuals) {
      const monthKey = this.dashboardDateKey(a.periodDate).substring(0, 7);
      const existing = actualsByMonth.get(monthKey) || 0;
      actualsByMonth.set(monthKey, existing + Number(a.amount));
    }

    const forecastsByMonth = new Map<string, { value: number; lower: number; upper: number }>();
    for (const f of forecasts) {
      const monthKey = this.dashboardDateKey(f.periodDate).substring(0, 7);
      const existing = forecastsByMonth.get(monthKey) || { value: 0, lower: 0, upper: 0 };
      existing.value += Number(f.forecastAmount);
      existing.lower += Number(f.confidenceLower || f.forecastAmount) * 0.9;
      existing.upper += Number(f.confidenceUpper || f.forecastAmount) * 1.1;
      forecastsByMonth.set(monthKey, existing);
    }

    const result = [];
    for (let i = 0; i < periods; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - periods + i + 1, 1);
      const monthKey = this.dashboardDateKey(date).substring(0, 7);
      const periodStr = this.dashboardDateKey(date);
      
      const actualValue = actualsByMonth.get(monthKey);
      const forecastData = forecastsByMonth.get(monthKey);

      result.push({
        period: periodStr,
        actual: actualValue !== undefined ? actualValue : null,
        forecast: forecastData?.value || 0,
        lowerBound: forecastData?.lower || 0,
        upperBound: forecastData?.upper || 0,
      });
    }

    return { data: result };
  }

  async getModelAccuracyComparison(tenantId: string, filters?: DashboardFilterDto) {
    const dimensionFilters = buildDimensionFilters(filters);
    const dateRange = this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    
    const forecasts = await this.prisma.forecast.findMany({
      where: {
        tenantId,
        ...dimensionFilters,
        periodDate: { gte: dateRange.start, lte: dateRange.end },
      },
      select: {
        forecastModel: true,
        periodDate: true,
        forecastAmount: true,
        productId: true,
        locationId: true,
        customerId: true,
      },
      take: MAX_DASHBOARD_FORECAST_ROWS,
      orderBy: { periodDate: 'desc' },
    });

    const actuals = await this.getErpSalesActualRows(tenantId, dateRange, filters);

    const actualsMap = new Map<string, number>();
    for (const actual of actuals) {
      const key = this.buildDashboardComparisonKey(actual.periodDate, actual.productId, actual.locationId, actual.customerId);
      actualsMap.set(key, (actualsMap.get(key) ?? 0) + Number(actual.amount));
    }

    const modelStats = new Map<string, { totalError: number; count: number }>();

    for (const forecast of forecasts) {
      const key = this.buildDashboardComparisonKey(forecast.periodDate, forecast.productId, forecast.locationId, forecast.customerId);
      const actualValue = actualsMap.get(key);
      
      if (actualValue !== undefined && actualValue !== 0) {
        const forecastValue = Number(forecast.forecastAmount);
        const error = Math.abs((actualValue - forecastValue) / actualValue);
        
        const stats = modelStats.get(forecast.forecastModel) || { totalError: 0, count: 0 };
        stats.totalError += error;
        stats.count++;
        modelStats.set(forecast.forecastModel, stats);
      }
    }

    const modelNames: Record<string, string> = {
      MOVING_AVERAGE: 'Moving Avg',
      WEIGHTED_AVERAGE: 'Weighted MA',
      LINEAR_REGRESSION: 'Linear Reg',
      HOLT_WINTERS: 'Holt-Winters',
      SEASONAL_NAIVE: 'Seasonal',
      YOY_GROWTH: 'YoY Growth',
      TREND_PERCENT: 'Trend %',
      AI_HYBRID: 'AI Hybrid',
      MANUAL: 'Manual',
    };

    const result = Array.from(modelStats.entries())
      .map(([model, stats]) => ({
        model: modelNames[model] || model,
        mape: Number((stats.count > 0 ? (stats.totalError / stats.count) * 100 : 0).toFixed(1)),
        count: stats.count,
      }))
      .sort((a, b) => a.mape - b.mape)
      .slice(0, 6);

    return { data: result };
  }

  async getRecentActivity(tenantId: string, limit: number = 10) {
    const auditLogs = await this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
    });

    const result = auditLogs.map(log => ({
      id: log.id,
      type: this.mapActionToType(log.action),
      title: this.formatAuditTitle(log.action, log.entityType),
      user: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System',
      createdAt: log.createdAt.toISOString(),
    }));

    return { data: result };
  }

  // =====================
  // Enterprise Dashboard Methods
  // =====================

  async getRevenueMetrics(tenantId: string, filters?: DashboardFilterDto) {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYearMonthStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const lastYearMonthEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0, 23, 59, 59, 999);

    // YTD starts at the beginning of the current fiscal year, not January 1.
    const tenantSettings = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { fiscalYearStart: true },
    });
    const fyStartMonth0 = (tenantSettings?.fiscalYearStart ?? 4) - 1;
    const fyYear = now.getMonth() >= fyStartMonth0 ? now.getFullYear() : now.getFullYear() - 1;
    const ytdStart = new Date(fyYear, fyStartMonth0, 1);
    const dimensionFilters = buildDimensionFilters(filters);

    const [currentMonthRevenue, lastMonthRevenue, sameMonthLYRevenue, ytdRevenue, ytdForecasts] = await Promise.all([
      this.getErpSalesAmount(tenantId, currentMonthStart, now, filters),
      this.getErpSalesAmount(tenantId, lastMonthStart, new Date(currentMonthStart.getTime() - 1), filters),
      this.getErpSalesAmount(tenantId, lastYearMonthStart, lastYearMonthEnd, filters),
      this.getErpSalesAmount(tenantId, ytdStart, now, filters),
      this.prisma.forecast.aggregate({
        where: {
          tenantId,
          periodDate: { gte: ytdStart },
          ...dimensionFilters,
        },
        _sum: { forecastAmount: true },
      }),
    ]);

    const ytdForecast = Number(ytdForecasts._sum.forecastAmount || 0);

    const momChange = lastMonthRevenue > 0 
      ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 
      : 0;
    const yoyChange = sameMonthLYRevenue > 0 
      ? ((currentMonthRevenue - sameMonthLYRevenue) / sameMonthLYRevenue) * 100 
      : 0;
    const ytdVariance = ytdForecast > 0 
      ? ((ytdRevenue - ytdForecast) / ytdForecast) * 100 
      : 0;

    return {
      data: {
        currentMonth: currentMonthRevenue,
        lastMonth: lastMonthRevenue,
        momChange,
        yoyChange,
        ytdRevenue,
        ytdForecast,
        ytdVariance,
      },
    };
  }

  async getTopProducts(tenantId: string, limit: number = 5, filters?: DashboardFilterDto) {
    const range = this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    const where = this.erpDashboardWhereSql(tenantId, filters, range);
    const data = await this.prisma.$queryRaw<Array<{ id: string; name: string; code: string; revenue: number }>>(Prisma.sql`
      SELECT
        COALESCE(p.id::text, mprod.product_id::text, mt.pid, 'unknown') AS id,
        COALESCE(p.name, mprod.name, 'Unmapped Item') AS name,
        COALESCE(p.code, mprod.code, mt.pid, '') AS code,
        -- Per-line revenue signed by the parent voucher's family so returned
        -- units net against sold units and challan/SC contribute 0.
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS revenue
      FROM marg_vouchers mv
      JOIN marg_transactions mt
        ON mt.tenant_id = mv.tenant_id
        AND mt.company_id = mv.company_id
        AND mt.voucher = mv.voucher
        AND ${this.erpSalesLineTypeSql('mv', 'mt')}
      LEFT JOIN marg_products mprod
        ON mprod.tenant_id = mv.tenant_id
        AND mprod.company_id = mv.company_id
        AND mprod.pid = mt.pid
      LEFT JOIN products p
        ON p.id = mprod.product_id
        AND p.tenant_id = mv.tenant_id
      LEFT JOIN marg_parties mp
        ON mp.tenant_id = mv.tenant_id
        AND mp.company_id = mv.company_id
        AND mp.cid = mv.cid
      WHERE ${where}
      GROUP BY COALESCE(p.id::text, mprod.product_id::text, mt.pid, 'unknown'), COALESCE(p.name, mprod.name, 'Unmapped Item'), COALESCE(p.code, mprod.code, mt.pid, '')
      ORDER BY revenue DESC
      LIMIT ${limit}
    `);

    const total = data.reduce((sum, item) => sum + item.revenue, 0);

    return {
      data: data.map(item => ({
        ...item,
        percentage: total > 0 ? (item.revenue / total) * 100 : 0,
      })),
    };
  }

  async getRegionalBreakdown(tenantId: string, filters?: DashboardFilterDto) {
    const range = this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    const data = await this.prisma.$queryRaw<Array<{ id: string; name: string; code: string; revenue: number }>>(Prisma.sql`
      WITH bills AS (${this.erpSalesBillRollupSql(tenantId, filters, range)})
      SELECT
        COALESCE(location_id, 'unknown') AS id,
        COALESCE(location_name, 'Unknown') AS name,
        COALESCE(location_id, '') AS code,
        COALESCE(SUM(net_amount), 0)::float8 AS revenue
      FROM bills
      GROUP BY COALESCE(location_id, 'unknown'), COALESCE(location_name, 'Unknown'), COALESCE(location_id, '')
      ORDER BY revenue DESC
    `);

    const total = data.reduce((sum, item) => sum + item.revenue, 0);

    return {
      data: data.map(item => ({
        ...item,
        percentage: total > 0 ? (item.revenue / total) * 100 : 0,
      })),
    };
  }

  async getStateBreakdown(tenantId: string, filters?: DashboardFilterDto) {
    const range = this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    const data = await this.prisma.$queryRaw<Array<{ name: string; revenue: number }>>(Prisma.sql`
      WITH bills AS (${this.erpSalesBillRollupSql(tenantId, filters, range)})
      SELECT
        COALESCE(mst.name, bills.state_code, 'Unknown') AS name,
        COALESCE(SUM(bills.net_amount), 0)::float8 AS revenue
      FROM bills
      LEFT JOIN marg_sale_types mst
        ON mst.tenant_id = ${tenantId}::uuid
        AND mst.company_id = bills.company_id
        AND mst.sg_code = 'ROUT'
        AND mst.s_code = bills.state_code
      GROUP BY COALESCE(mst.name, bills.state_code, 'Unknown')
      ORDER BY revenue DESC
    `);
    const total = data.reduce((s, r) => s + r.revenue, 0);
    return {
      data: data.map((r, i) => ({
        id: r.name,
        name: r.name,
        code: r.name,
        revenue: r.revenue,
        percentage: total > 0 ? (r.revenue / total) * 100 : 0,
        rank: i + 1,
      })),
    };
  }

  async getCityBreakdown(tenantId: string, filters?: DashboardFilterDto) {
    const range = this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    const data = await this.prisma.$queryRaw<Array<{ name: string; revenue: number }>>(Prisma.sql`
      WITH bills AS (${this.erpSalesBillRollupSql(tenantId, filters, range)})
      SELECT
        COALESCE(mst.name, bills.area_code, 'Unknown') AS name,
        COALESCE(SUM(bills.net_amount), 0)::float8 AS revenue
      FROM bills
      LEFT JOIN marg_sale_types mst
        ON mst.tenant_id = ${tenantId}::uuid
        AND mst.company_id = bills.company_id
        AND mst.sg_code = 'AREA'
        AND mst.s_code = bills.area_code
      GROUP BY COALESCE(mst.name, bills.area_code, 'Unknown')
      ORDER BY revenue DESC
    `);
    const total = data.reduce((s, r) => s + r.revenue, 0);
    return {
      data: data.map((r, i) => ({
        id: r.name,
        name: r.name,
        code: r.name,
        revenue: r.revenue,
        percentage: total > 0 ? (r.revenue / total) * 100 : 0,
        rank: i + 1,
      })),
    };
  }

  async getVarianceAlerts(tenantId: string, filters?: DashboardFilterDto) {
    const dimensionFilters = buildDimensionFilters(filters);
    const dateRange = this.resolveDashboardDateRange(filters, DEFAULT_DASHBOARD_PERIODS);
    
    const forecasts = await this.prisma.forecast.findMany({
      where: {
        tenantId,
        ...dimensionFilters,
        periodDate: { gte: dateRange.start, lte: dateRange.end },
      },
      include: {
        product: { select: { name: true } },
        location: { select: { name: true } },
      },
      take: 500,
      orderBy: { periodDate: 'desc' },
    });

    const actuals = await this.getErpSalesActualRows(tenantId, dateRange, filters);

    const actualsMap = new Map<string, number>();
    for (const actual of actuals) {
      const key = this.buildDashboardComparisonKey(actual.periodDate, actual.productId, actual.locationId, actual.customerId);
      actualsMap.set(key, (actualsMap.get(key) ?? 0) + Number(actual.amount));
    }

    const alerts: Array<{
      id: string;
      type: 'over' | 'under';
      entity: string;
      period: string;
      expected: number;
      actual: number;
      variance: number;
      severity: 'high' | 'medium' | 'low';
    }> = [];

    for (const forecast of forecasts) {
      const key = this.buildDashboardComparisonKey(forecast.periodDate, forecast.productId, forecast.locationId, forecast.customerId);
      const actualValue = actualsMap.get(key);

      if (actualValue !== undefined) {
        const forecastValue = Number(forecast.forecastAmount);
        const variancePct = forecastValue > 0 
          ? ((actualValue - forecastValue) / forecastValue) * 100 
          : 0;

        if (Math.abs(variancePct) > 10) {
          const entity = forecast.product?.name || forecast.location?.name || 'Overall';
          alerts.push({
            id: forecast.id,
            type: variancePct > 0 ? 'over' : 'under',
            entity,
            period: this.dashboardDateKey(forecast.periodDate),
            expected: forecastValue,
            actual: actualValue,
            variance: variancePct,
            severity: Math.abs(variancePct) > 25 ? 'high' : Math.abs(variancePct) > 15 ? 'medium' : 'low',
          });
        }
      }
    }

    return {
      data: alerts
        .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
        .slice(0, 10),
    };
  }

  async getForecastHealthMetrics(tenantId: string, filters?: DashboardFilterDto) {
    const dimensionFilters = buildDimensionFilters(filters);
    
    const [totalForecasts, modelsUsed, coveragePct, avgAccuracy] = await Promise.all([
      this.prisma.forecast.count({ where: { tenantId, ...dimensionFilters } }),
      this.prisma.forecast.groupBy({
        by: ['forecastModel'],
        where: { tenantId, ...dimensionFilters },
        _count: true,
      }),
      this.calculateCoverage(tenantId, filters),
      this.calculateAverageAccuracy(tenantId, undefined, undefined, filters),
    ]);

    const modelStats = modelsUsed.map(m => ({
      model: m.forecastModel,
      count: m._count,
    }));

    return {
      data: {
        totalForecasts,
        modelDistribution: modelStats,
        coverage: coveragePct,
        accuracy: this.toForecastAccuracy(avgAccuracy.mape, avgAccuracy.comparisons),
      },
    };
  }

  private getPreviousDashboardDateRange(range: DashboardDateRange): DashboardDateRange {
    const end = new Date(range.start.getTime() - 1);
    const durationMs = Math.max(range.end.getTime() - range.start.getTime(), 0);
    const start = new Date(end.getTime() - durationMs);
    return { start, end };
  }

  private toForecastAccuracy(mape: number, comparisons: number): number {
    if (comparisons === 0) {
      return 0;
    }

    return Math.min(100, Math.max(0, 100 - (mape * 100)));
  }

  private async calculateCoverage(tenantId: string, filters?: DashboardFilterDto): Promise<number> {
    const dimensionFilters = buildDimensionFilters(filters);
    
    const [totalProducts, forecastedProducts] = await Promise.all([
      this.prisma.product.count({ 
        where: { 
          tenantId, 
          status: 'ACTIVE',
          ...(filters?.productIds?.length ? { id: { in: filters.productIds } } : {}),
        } 
      }),
      this.prisma.forecast.findMany({
        where: { tenantId, ...dimensionFilters },
        select: { productId: true },
        distinct: ['productId'],
      }),
    ]);

    return totalProducts > 0 ? (forecastedProducts.length / totalProducts) * 100 : 0;
  }

  // =====================
  // Enhanced Enterprise Dashboard Methods
  // =====================

  async getTrendComparison(
    tenantId: string,
    options: {
      granularity: 'daily' | 'weekly' | 'monthly' | 'quarterly';
      periods: number;
      startDate?: string;
      endDate?: string;
    },
    filters?: DashboardFilterDto
  ) {
    const { granularity, periods, startDate, endDate } = options;
    const now = new Date();
    const dimensionFilters = buildDimensionFilters(filters);

    // Fetch fiscalYearStart only when it will actually affect the output.
    let fiscalYearStart = 4; // India default (April)
    if (granularity === 'quarterly') {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { fiscalYearStart: true },
      });
      fiscalYearStart = tenant?.fiscalYearStart ?? 4;
    }
    
    // Calculate date range
    let rangeStart: Date;
    let rangeEnd: Date = endDate ? new Date(endDate) : now;
    
    if (startDate) {
      rangeStart = new Date(startDate);
    } else {
      switch (granularity) {
        case 'daily':
          rangeStart = new Date(now.getTime() - periods * 24 * 60 * 60 * 1000);
          break;
        case 'weekly':
          rangeStart = new Date(now.getTime() - periods * 7 * 24 * 60 * 60 * 1000);
          break;
        case 'quarterly':
          rangeStart = new Date(now.getFullYear(), now.getMonth() - periods * 3, 1);
          break;
        case 'monthly':
        default:
          rangeStart = new Date(now.getFullYear(), now.getMonth() - periods + 1, 1);
      }
    }

    const [actualRows, forecasts] = await Promise.all([
      this.prisma.$queryRaw<Array<{ period_date: Date; amount: number }>>(Prisma.sql`
        WITH bills AS (${this.erpSalesBillRollupSql(tenantId, filters, { start: rangeStart, end: rangeEnd })})
        SELECT date::date AS period_date, COALESCE(SUM(net_amount), 0)::float8 AS amount
        FROM bills
        GROUP BY date::date
        ORDER BY date::date
      `),
      this.prisma.forecast.groupBy({
        by: ['periodDate'],
        where: {
          tenantId,
          periodDate: { gte: rangeStart, lte: rangeEnd },
          ...dimensionFilters,
        },
        _sum: { forecastAmount: true },
        orderBy: { periodDate: 'asc' },
      }),
    ]);

    // Aggregate by period
    const periodData = new Map<string, { actual: number; forecast: number }>();

    for (const a of actualRows) {
      const key = this.normalizeDashboardPeriod(a.period_date, granularity, fiscalYearStart);
      const existing = periodData.get(key) || { actual: 0, forecast: 0 };
      existing.actual += Number(a.amount || 0);
      periodData.set(key, existing);
    }

    for (const f of forecasts) {
      const key = this.normalizeDashboardPeriod(f.periodDate, granularity, fiscalYearStart);
      const existing = periodData.get(key) || { actual: 0, forecast: 0 };
      existing.forecast += Number(f._sum.forecastAmount || 0);
      periodData.set(key, existing);
    }

    const data = Array.from(periodData.entries())
      .map(([period, values]) => ({
        period,
        label: this.formatDashboardPeriodLabel(period, granularity),
        actual: values.actual,
        forecast: values.forecast,
        variance: values.actual - values.forecast,
        variancePercent: values.forecast > 0 ? ((values.actual - values.forecast) / values.forecast) * 100 : 0,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    return {
      data,
      meta: {
        granularity,
        startDate: rangeStart.toISOString(),
        endDate: rangeEnd.toISOString(),
        totalPeriods: data.length,
      },
    };
  }

  async getDemandSupplyAnalysis(tenantId: string, periods: number = 6, filters?: DashboardFilterDto) {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - periods + 1, 1);
    const dimensionFilters = buildDimensionFilters(filters);

    const [forecasts, actualRows] = await Promise.all([
      this.prisma.forecast.groupBy({
        by: ['periodDate'],
        where: { tenantId, periodDate: { gte: startDate }, ...dimensionFilters },
        _sum: { forecastAmount: true },
        orderBy: { periodDate: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{ period_date: Date; amount: number }>>(Prisma.sql`
        WITH bills AS (${this.erpSalesBillRollupSql(tenantId, filters, { start: startDate, end: now })})
        SELECT date_trunc('month', date)::date AS period_date, COALESCE(SUM(net_amount), 0)::float8 AS amount
        FROM bills
        GROUP BY date_trunc('month', date)::date
        ORDER BY date_trunc('month', date)::date
      `),
    ]);

    // Aggregate demand (forecasts) vs supply (actuals) by month
    const monthlyData = new Map<string, { demand: number; supply: number; gap: number }>();

    for (const f of forecasts) {
      const key = this.dashboardDateKey(f.periodDate).substring(0, 7);
      const existing = monthlyData.get(key) || { demand: 0, supply: 0, gap: 0 };
      existing.demand += Number(f._sum.forecastAmount || 0);
      monthlyData.set(key, existing);
    }

    for (const a of actualRows) {
      const key = this.dashboardDateKey(a.period_date).substring(0, 7);
      const existing = monthlyData.get(key) || { demand: 0, supply: 0, gap: 0 };
      existing.supply += Number(a.amount || 0);
      monthlyData.set(key, existing);
    }

    const data = Array.from(monthlyData.entries())
      .map(([month, values]) => ({
        month,
        label: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        demand: values.demand,
        supply: values.supply,
        gap: values.demand - values.supply,
        fillRate: values.demand > 0 ? Math.min(100, (values.supply / values.demand) * 100) : 100,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const totals = data.reduce((acc, d) => ({
      totalDemand: acc.totalDemand + d.demand,
      totalSupply: acc.totalSupply + d.supply,
    }), { totalDemand: 0, totalSupply: 0 });

    return {
      data,
      summary: {
        ...totals,
        overallFillRate: totals.totalDemand > 0 ? (totals.totalSupply / totals.totalDemand) * 100 : 100,
        totalGap: totals.totalDemand - totals.totalSupply,
      },
    };
  }

  async getInventoryMetrics(tenantId: string, filters?: DashboardFilterDto) {
    {
    const range = this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    const where = this.erpDashboardWhereSql(tenantId, filters, range);
    const products = await this.prisma.$queryRaw<Array<{
      id: string;
      name: string;
      code: string;
      totalSales: number;
      monthsOfData: number;
      avgMonthly: number;
      velocity: number;
    }>>(Prisma.sql`
      WITH product_sales AS (
        SELECT
          COALESCE(p.id::text, mprod.product_id::text, mt.pid, 'unknown') AS id,
          COALESCE(p.name, mprod.name, 'Unmapped Item') AS name,
          COALESCE(p.code, mprod.code, mt.pid, '') AS code,
          COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS total_sales,
          COUNT(DISTINCT date_trunc('month', mv.date))::int AS months_of_data
        FROM marg_vouchers mv
        JOIN marg_transactions mt
          ON mt.tenant_id = mv.tenant_id
          AND mt.company_id = mv.company_id
          AND mt.voucher = mv.voucher
          AND ${this.erpSalesLineTypeSql('mv', 'mt')}
        LEFT JOIN marg_products mprod
          ON mprod.tenant_id = mv.tenant_id
          AND mprod.company_id = mv.company_id
          AND mprod.pid = mt.pid
        LEFT JOIN products p
          ON p.id = mprod.product_id
          AND p.tenant_id = mv.tenant_id
        LEFT JOIN marg_parties mp
          ON mp.tenant_id = mv.tenant_id
          AND mp.company_id = mv.company_id
          AND mp.cid = mv.cid
        WHERE ${where}
        GROUP BY COALESCE(p.id::text, mprod.product_id::text, mt.pid, 'unknown'), COALESCE(p.name, mprod.name, 'Unmapped Item'), COALESCE(p.code, mprod.code, mt.pid, '')
      )
      SELECT
        id,
        name,
        code,
        total_sales AS "totalSales",
        months_of_data AS "monthsOfData",
        CASE WHEN months_of_data > 0 THEN (total_sales / months_of_data)::float8 ELSE 0 END AS "avgMonthly",
        CASE WHEN months_of_data > 0 THEN (total_sales / months_of_data)::float8 ELSE 0 END AS velocity
      FROM product_sales
      ORDER BY total_sales DESC
    `);

    const totalSales = products.reduce((sum, p) => sum + p.totalSales, 0);
    let cumulative = 0;
    const classified = products.map(p => {
      cumulative += p.totalSales;
      const cumPct = totalSales > 0 ? (cumulative / totalSales) * 100 : 0;
      return {
        ...p,
        class: cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C',
        contribution: totalSales > 0 ? (p.totalSales / totalSales) * 100 : 0,
      };
    });

    return {
      data: classified.slice(0, 20),
      summary: {
        totalProducts: classified.length,
        classA: classified.filter(p => p.class === 'A').length,
        classB: classified.filter(p => p.class === 'B').length,
        classC: classified.filter(p => p.class === 'C').length,
        avgTurnover: products.length > 0
          ? products.reduce((sum, p) => sum + p.velocity, 0) / products.length
          : 0,
      },
    };
    }

  }

  async getForecastBiasAnalysis(tenantId: string, filters?: DashboardFilterDto) {
    const dimensionFilters = buildDimensionFilters(filters);
    const dateRange = this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    
    const forecasts = await this.prisma.forecast.findMany({
      where: {
        tenantId,
        ...dimensionFilters,
        periodDate: { gte: dateRange.start, lte: dateRange.end },
      },
      select: {
        forecastModel: true,
        periodDate: true,
        forecastAmount: true,
        productId: true,
        locationId: true,
        customerId: true,
      },
      take: MAX_DASHBOARD_FORECAST_ROWS,
      orderBy: { periodDate: 'desc' },
    });

    const actuals = await this.getErpSalesActualRows(tenantId, dateRange, filters);

    const actualsMap = new Map<string, number>();
    for (const actual of actuals) {
      const key = this.buildDashboardComparisonKey(actual.periodDate, actual.productId, actual.locationId, actual.customerId);
      actualsMap.set(key, (actualsMap.get(key) ?? 0) + Number(actual.amount));
    }

    // Calculate bias by model
    const modelBias = new Map<string, { 
      overCount: number; 
      underCount: number; 
      totalBias: number;
      count: number;
    }>();

    for (const forecast of forecasts) {
      const key = this.buildDashboardComparisonKey(forecast.periodDate, forecast.productId, forecast.locationId, forecast.customerId);
      const actualValue = actualsMap.get(key);

      if (actualValue !== undefined) {
        const forecastValue = Number(forecast.forecastAmount);
        const bias = forecastValue - actualValue;
        const biasPct = actualValue > 0 ? (bias / actualValue) * 100 : 0;

        const stats = modelBias.get(forecast.forecastModel) || {
          overCount: 0,
          underCount: 0,
          totalBias: 0,
          count: 0,
        };
        
        if (bias > 0) stats.overCount++;
        else if (bias < 0) stats.underCount++;
        stats.totalBias += biasPct;
        stats.count++;
        modelBias.set(forecast.forecastModel, stats);
      }
    }

    const modelNames: Record<string, string> = {
      MOVING_AVERAGE: 'Moving Avg',
      WEIGHTED_AVERAGE: 'Weighted MA',
      LINEAR_REGRESSION: 'Linear Reg',
      HOLT_WINTERS: 'Holt-Winters',
      SEASONAL_NAIVE: 'Seasonal',
      YOY_GROWTH: 'YoY Growth',
      TREND_PERCENT: 'Trend %',
      AI_HYBRID: 'AI Hybrid',
      MANUAL: 'Manual',
    };

    const data = Array.from(modelBias.entries())
      .map(([model, stats]) => ({
        model: modelNames[model] || model,
        avgBias: stats.count > 0 ? stats.totalBias / stats.count : 0,
        overForecastRate: stats.count > 0 ? (stats.overCount / stats.count) * 100 : 0,
        underForecastRate: stats.count > 0 ? (stats.underCount / stats.count) * 100 : 0,
        totalForecasts: stats.count,
      }))
      .filter(d => d.totalForecasts > 0)
      .sort((a, b) => Math.abs(a.avgBias) - Math.abs(b.avgBias));

    return { data };
  }

  async getABCAnalysis(tenantId: string, filters?: ABCAnalysisDto) {
    const mode = filters?.mode || 'revenue';
    const thresholdA = filters?.thresholdA || 80;
    const thresholdB = filters?.thresholdB || 95;
    const range = this.resolveDashboardDateRange(filters, DEFAULT_ANALYTICS_PERIODS);
    const where = this.erpDashboardWhereSql(tenantId, filters, range);
    const productsArray = await this.prisma.$queryRaw<Array<{
      id: string;
      name: string;
      code: string;
      category: string;
      totalRevenue: number;
      totalQuantity: number;
      totalMargin: number;
      metricValue: number;
    }>>(Prisma.sql`
      WITH item_sales AS (
        SELECT
          COALESCE(p.id::text, mprod.product_id::text, mt.pid, 'unknown') AS id,
          COALESCE(p.name, mprod.name, 'Unmapped Item') AS name,
          COALESCE(p.code, mprod.code, mt.pid, '') AS code,
          COALESCE(p.category, mprod.g_code5, 'Uncategorized') AS category,
          -- All per-line aggregates are family-signed so a returned unit's
          -- revenue / quantity / margin nets against the same item's prior
          -- invoice and challan/SC are excluded entirely.
          COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS total_revenue,
          COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS total_quantity,
          COALESCE(SUM((ABS(COALESCE(mt.amount, 0)) - ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS total_margin
        FROM marg_vouchers mv
        JOIN marg_transactions mt
          ON mt.tenant_id = mv.tenant_id
          AND mt.company_id = mv.company_id
          AND mt.voucher = mv.voucher
          AND ${this.erpSalesLineTypeSql('mv', 'mt')}
        LEFT JOIN marg_products mprod
          ON mprod.tenant_id = mv.tenant_id
          AND mprod.company_id = mv.company_id
          AND mprod.pid = mt.pid
        LEFT JOIN products p
          ON p.id = mprod.product_id
          AND p.tenant_id = mv.tenant_id
        LEFT JOIN marg_parties mp
          ON mp.tenant_id = mv.tenant_id
          AND mp.company_id = mv.company_id
          AND mp.cid = mv.cid
        LEFT JOIN LATERAL (
          SELECT p_rate, lp_rate
          FROM marg_stocks ms
          WHERE ms.tenant_id = mv.tenant_id
            AND ms.company_id = mv.company_id
            AND ms.pid = mt.pid
            AND (mt.batch IS NULL OR ms.batch = mt.batch)
          ORDER BY CASE WHEN mt.batch IS NOT NULL AND ms.batch = mt.batch THEN 0 ELSE 1 END, ms.updated_at DESC
          LIMIT 1
        ) ms ON TRUE
        WHERE ${where}
        GROUP BY COALESCE(p.id::text, mprod.product_id::text, mt.pid, 'unknown'), COALESCE(p.name, mprod.name, 'Unmapped Item'), COALESCE(p.code, mprod.code, mt.pid, ''), COALESCE(p.category, mprod.g_code5, 'Uncategorized')
      )
      SELECT
        id,
        name,
        code,
        category,
        total_revenue AS "totalRevenue",
        total_quantity AS "totalQuantity",
        total_margin AS "totalMargin",
        CASE WHEN ${mode} = 'margin' THEN total_margin ELSE total_revenue END AS "metricValue"
      FROM item_sales
      ORDER BY "metricValue" DESC
      LIMIT ${MAX_DASHBOARD_FORECAST_ROWS}
    `);

    const totalMetric = productsArray.reduce((sum, p) => sum + Math.max(0, p.metricValue), 0);
    let cumulative = 0;
    const classifiedProducts = productsArray.map((p) => {
      if (mode === 'margin' && p.metricValue <= 0) {
        return {
          id: p.id,
          name: p.name,
          code: p.code,
          category: p.category,
          revenue: p.totalRevenue,
          margin: p.totalMargin,
          metricValue: p.metricValue,
          contribution: 0,
          cumulativeContribution: 100,
          class: 'C' as const,
        };
      }

      const contribution = totalMetric > 0 ? (p.metricValue / totalMetric) * 100 : 0;
      cumulative += contribution;
      const abcClass = cumulative <= thresholdA ? 'A' : cumulative <= thresholdB ? 'B' : 'C';
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        category: p.category,
        revenue: p.totalRevenue,
        margin: p.totalMargin,
        metricValue: p.metricValue,
        contribution,
        cumulativeContribution: cumulative,
        class: abcClass as 'A' | 'B' | 'C',
      };
    });

    const classA = classifiedProducts.filter(p => p.class === 'A');
    const classB = classifiedProducts.filter(p => p.class === 'B');
    const classC = classifiedProducts.filter(p => p.class === 'C');
    const calculateClassMetrics = (products: typeof classifiedProducts) => ({
      count: products.length,
      totalRevenue: products.reduce((sum, p) => sum + p.revenue, 0),
      totalMargin: products.reduce((sum, p) => sum + p.margin, 0),
      contributionPercent: products.reduce((sum, p) => sum + p.contribution, 0),
    });
    const classAMetrics = calculateClassMetrics(classA);
    const classBMetrics = calculateClassMetrics(classB);
    const classCMetrics = calculateClassMetrics(classC);

    return {
      config: {
        mode,
        thresholdA,
        thresholdB,
        totalProducts: classifiedProducts.length,
        totalRevenue: productsArray.reduce((sum, p) => sum + p.totalRevenue, 0),
        totalMargin: productsArray.reduce((sum, p) => sum + p.totalMargin, 0),
      },
      products: classifiedProducts,
      summary: {
        totalProducts: classifiedProducts.length,
        classA: classAMetrics.count,
        classB: classBMetrics.count,
        classC: classCMetrics.count,
        classAContribution: classAMetrics.contributionPercent,
        classBContribution: classBMetrics.contributionPercent,
        classCContribution: classCMetrics.contributionPercent,
      },
      distribution: [
        { class: 'A', count: classAMetrics.count, revenue: classAMetrics.totalRevenue, margin: classAMetrics.totalMargin, contribution: classAMetrics.contributionPercent, label: `Class A (<=${thresholdA}%)` },
        { class: 'B', count: classBMetrics.count, revenue: classBMetrics.totalRevenue, margin: classBMetrics.totalMargin, contribution: classBMetrics.contributionPercent, label: `Class B (${thresholdA}-${thresholdB}%)` },
        { class: 'C', count: classCMetrics.count, revenue: classCMetrics.totalRevenue, margin: classCMetrics.totalMargin, contribution: classCMetrics.contributionPercent, label: `Class C (>${thresholdB}%)` },
      ],
      classBreakdown: {
        A: { ...classAMetrics, products: classA },
        B: { ...classBMetrics, products: classB },
        C: { ...classCMetrics, products: classC },
      },
    };
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
}
