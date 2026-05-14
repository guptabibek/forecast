// ============================================================================
// EXECUTIVE DASHBOARD KPIs SERVICE
// Covers: Total Inventory Value, Turnover Ratio, % Near Expiry, % Dead Stock,
//         Days of Inventory (DOH), Expiry Loss Trend
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { InventoryBaseFilterDto } from '../dto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DashboardKPIs {
  total_inventory_value: number;
  total_sku_count: number;
  total_batch_count: number;
  total_location_count: number;
  turnover_ratio: number | null;
  pct_near_expiry_90d: number;
  pct_dead_stock: number;
  days_of_inventory: number | null;
  avg_days_to_expiry: number | null;
  negative_stock_count: number;
}

export interface ExpiryLossTrendPoint {
  month: string;
  expired_value: number;
  expired_qty: number;
  batch_count: number;
  cumulative_loss: number;
}

export interface InventoryValueTrendPoint {
  date: string;
  total_value: number;
  receipt_value: number;
  issue_value: number;
}

@Injectable()
export class DashboardKpiService {
  private readonly logger = new Logger(DashboardKpiService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // EXECUTIVE KPIs
  //
  // All computed in a single multi-CTE query for efficiency.
  //
  // Formulas:
  //   Total Inventory Value = SUM(inventory_levels.inventory_value)
  //   Turnover Ratio = Total COGS (12m) / Total Inventory Value
  //   % Near Expiry  = value of batches expiring in 90d / total batch value * 100
  //   % Dead Stock   = value of products with no issues in 6m / total value * 100
  //   Days of Inventory (DOH) = 365 / Turnover Ratio
  //   Avg Days to Expiry = AVG(expiry_date - today) across active batches
  //   Negative Stock Count = products with on_hand_qty < 0
  //
  // Edge cases:
  //   • Zero inventory → turnover NULL, DOH NULL, percentages 0
  //   • No expiry data → near_expiry = 0
  //   • All dead stock → 100%
  // ─────────────────────────────────────────────────────────────────────────
  async getDashboardKPIs(
    tenantId: string,
    filters: InventoryBaseFilterDto,
  ): Promise<DashboardKPIs> {
    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(Prisma.sql`il.product_id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.locationIds?.length) {
      extraConds.push(Prisma.sql`il.location_id = ANY(${filters.locationIds}::uuid[])`);
    }

    const baseCond = Prisma.sql`il.tenant_id = ${tenantId}::uuid`;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;

    const [kpi] = await this.prisma.$queryRaw<[DashboardKPIs]>(
      Prisma.sql`
        WITH inv_totals AS (
          SELECT
            COALESCE(SUM(il.inventory_value), 0)::float8 AS total_inventory_value,
            COUNT(DISTINCT il.product_id)::int             AS total_sku_count,
            COUNT(DISTINCT il.location_id)::int            AS total_location_count,
            COUNT(CASE WHEN il.on_hand_qty < 0 THEN 1 END)::int AS negative_stock_count
          FROM inventory_levels il
          WHERE ${where}
        ),
        batch_totals AS (
          SELECT
            COUNT(b.id)::int AS total_batch_count,
            COALESCE(SUM(b.quantity * COALESCE(b.cost_per_unit, 0)), 0)::float8 AS total_batch_value,
            COALESCE(SUM(
              CASE
                WHEN b.expiry_date IS NOT NULL
                  AND b.expiry_date::date >= CURRENT_DATE
                  AND b.expiry_date::date <= (CURRENT_DATE + 90)
                  AND b.quantity > 0
                THEN b.quantity * COALESCE(b.cost_per_unit, 0)
                ELSE 0
              END
            ), 0)::float8 AS near_expiry_value,
            AVG(
              CASE
                WHEN b.expiry_date IS NOT NULL AND b.expiry_date::date >= CURRENT_DATE
                THEN (b.expiry_date::date - CURRENT_DATE)
                ELSE NULL
              END
            )::float8 AS avg_days_to_expiry
          FROM batches b
          WHERE b.tenant_id = ${tenantId}::uuid
            AND b.status NOT IN ('CONSUMED', 'RECALLED')
            AND b.quantity > 0
        ),
        cogs_12m AS (
          SELECT
            COALESCE(SUM(it.quantity * COALESCE(it.unit_cost, 0)), 0)::float8 AS total_cogs
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
            AND it.transaction_date >= (CURRENT_DATE - INTERVAL '12 months')
        ),
        dead_stock AS (
          SELECT
            COALESCE(SUM(il.inventory_value), 0)::float8 AS dead_value
          FROM inventory_levels il
          WHERE il.tenant_id = ${tenantId}::uuid
            AND il.on_hand_qty > 0
            AND NOT EXISTS (
              SELECT 1 FROM inventory_transactions it
              WHERE it.product_id = il.product_id
                AND it.location_id = il.location_id
                AND it.tenant_id = il.tenant_id
                AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
                AND it.transaction_date >= (CURRENT_DATE - INTERVAL '6 months')
            )
        )
        SELECT
          inv.total_inventory_value,
          inv.total_sku_count,
          bt.total_batch_count,
          inv.total_location_count,
          CASE
            WHEN inv.total_inventory_value > 0
            THEN (cg.total_cogs / inv.total_inventory_value)::float8
            ELSE NULL
          END AS turnover_ratio,
          CASE
            WHEN bt.total_batch_value > 0
            THEN (bt.near_expiry_value / bt.total_batch_value * 100)::float8
            ELSE 0
          END AS pct_near_expiry_90d,
          CASE
            WHEN inv.total_inventory_value > 0
            THEN (ds.dead_value / inv.total_inventory_value * 100)::float8
            ELSE 0
          END AS pct_dead_stock,
          CASE
            WHEN cg.total_cogs > 0
            THEN (365.0 * inv.total_inventory_value / cg.total_cogs)::float8
            ELSE NULL
          END AS days_of_inventory,
          bt.avg_days_to_expiry,
          inv.negative_stock_count
        FROM inv_totals inv
        CROSS JOIN batch_totals bt
        CROSS JOIN cogs_12m cg
        CROSS JOIN dead_stock ds
      `,
    );

    return (
      kpi ?? {
        total_inventory_value: 0,
        total_sku_count: 0,
        total_batch_count: 0,
        total_location_count: 0,
        turnover_ratio: null,
        pct_near_expiry_90d: 0,
        pct_dead_stock: 0,
        days_of_inventory: null,
        avg_days_to_expiry: null,
        negative_stock_count: 0,
      }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPIRY LOSS TREND
  //
  // Monthly aggregation of expired inventory over the last 12 months.
  // Shows the cost of expired batches by month they expired.
  //
  // Formula:
  //   expired_value = SUM(qty × cost_per_unit) for batches that expired in month
  //   cumulative_loss = running SUM of expired_value over time
  //
  // Edge cases:
  //   • Months with no expirations → included as 0
  //   • Expired but scrapped batches (qty=0) → excluded (already processed)
  //
  // Performance:
  //   • Index: batches(tenant_id, expiry_date)
  //   • Bounded to 12-month lookback
  // ─────────────────────────────────────────────────────────────────────────
  async getExpiryLossTrend(
    tenantId: string,
    filters: InventoryBaseFilterDto,
  ): Promise<ExpiryLossTrendPoint[]> {
    const rows = await this.prisma.$queryRaw<ExpiryLossTrendPoint[]>(
      Prisma.sql`
        WITH months AS (
          SELECT generate_series(
            DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months'),
            DATE_TRUNC('month', CURRENT_DATE),
            '1 month'::interval
          )::date AS month_start
        ),
        expired_monthly AS (
          SELECT
            DATE_TRUNC('month', b.expiry_date)::date AS exp_month,
            SUM(b.quantity * COALESCE(b.cost_per_unit, 0))::float8 AS expired_value,
            SUM(b.quantity)::float8 AS expired_qty,
            COUNT(b.id)::int AS batch_count
          FROM batches b
          WHERE b.tenant_id = ${tenantId}::uuid
            AND b.expiry_date IS NOT NULL
            AND b.expiry_date::date >= (CURRENT_DATE - INTERVAL '12 months')
            AND b.expiry_date::date < CURRENT_DATE
            AND b.quantity > 0
            AND b.status NOT IN ('CONSUMED', 'RECALLED')
          GROUP BY DATE_TRUNC('month', b.expiry_date)
        )
        SELECT
          TO_CHAR(m.month_start, 'YYYY-MM') AS month,
          COALESCE(em.expired_value, 0)::float8 AS expired_value,
          COALESCE(em.expired_qty, 0)::float8   AS expired_qty,
          COALESCE(em.batch_count, 0)::int      AS batch_count,
          SUM(COALESCE(em.expired_value, 0)) OVER (ORDER BY m.month_start)::float8
            AS cumulative_loss
        FROM months m
        LEFT JOIN expired_monthly em ON em.exp_month = m.month_start
        ORDER BY m.month_start
      `,
    );

    return rows;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INVENTORY VALUE TREND (monthly)
  //
  // Tracks monthly receipt vs issue values for trend visualization.
  //
  // Performance:
  //   • Index: inventory_transactions(tenant_id, transaction_date)
  //   • 12-month bounded query
  // ─────────────────────────────────────────────────────────────────────────
  async getInventoryValueTrend(
    tenantId: string,
  ): Promise<InventoryValueTrendPoint[]> {
    const rows = await this.prisma.$queryRaw<InventoryValueTrendPoint[]>(
      Prisma.sql`
        WITH months AS (
          SELECT generate_series(
            DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months'),
            DATE_TRUNC('month', CURRENT_DATE),
            '1 month'::interval
          )::date AS month_start
        ),
        monthly_txns AS (
          SELECT
            DATE_TRUNC('month', it.transaction_date)::date AS txn_month,
            SUM(CASE
              WHEN it.transaction_type IN ('RECEIPT','ADJUSTMENT_IN','RETURN','PRODUCTION_RECEIPT')
              THEN it.quantity * COALESCE(it.unit_cost, 0) ELSE 0
            END)::float8 AS receipt_value,
            SUM(CASE
              WHEN it.transaction_type IN ('ISSUE','ADJUSTMENT_OUT','SCRAP','PRODUCTION_ISSUE')
              THEN it.quantity * COALESCE(it.unit_cost, 0) ELSE 0
            END)::float8 AS issue_value
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_date >= (CURRENT_DATE - INTERVAL '12 months')
          GROUP BY DATE_TRUNC('month', it.transaction_date)
        )
        SELECT
          TO_CHAR(m.month_start, 'YYYY-MM') AS date,
          (COALESCE(mt.receipt_value, 0) - COALESCE(mt.issue_value, 0))::float8 AS total_value,
          COALESCE(mt.receipt_value, 0)::float8 AS receipt_value,
          COALESCE(mt.issue_value, 0)::float8   AS issue_value
        FROM months m
        LEFT JOIN monthly_txns mt ON mt.txn_month = m.month_start
        ORDER BY m.month_start
      `,
    );

    return rows;
  }
}
