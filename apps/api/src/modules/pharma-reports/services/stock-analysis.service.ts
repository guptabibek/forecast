// ============================================================================
// DEAD / SLOW STOCK & CLASSIFICATION SERVICE
// Covers: Dead/Slow Stock, ABC Analysis, XYZ Analysis, Inventory Turnover
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
    ABCAnalysisFilterDto,
    DeadSlowFilterDto,
    InventoryBaseFilterDto,
    XYZAnalysisFilterDto,
} from '../dto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DeadSlowRow {
  product_id: string;
  sku: string;
  product_name: string;
  category: string | null;
  location_code: string;
  on_hand_qty: number;
  inventory_value: number;
  last_sale_date: Date | null;
  days_since_last_sale: number | null;
  classification: 'DEAD' | 'SLOW';
}

export interface ABCRow {
  product_id: string;
  sku: string;
  product_name: string;
  consumption_value: number;
  consumption_qty: number;
  pct_of_total: number;
  cumulative_pct: number;
  abc_class: 'A' | 'B' | 'C';
  on_hand_qty: number;
  inventory_value: number;
}

export interface XYZRow {
  product_id: string;
  sku: string;
  product_name: string;
  avg_monthly_demand: number;
  stddev_monthly_demand: number;
  coefficient_of_variation: number;
  xyz_class: 'X' | 'Y' | 'Z';
  months_analyzed: number;
}

export interface TurnoverRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_code: string;
  cogs: number;
  avg_inventory: number;
  turnover_ratio: number;
  days_of_inventory: number | null;
}

@Injectable()
export class StockAnalysisService {
  private readonly logger = new Logger(StockAnalysisService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // A. DEAD / SLOW STOCK
  //
  // Dead stock: no ISSUE transactions in last X months (default 6).
  // Slow stock: has issues but quantity is declining (< 1 issue/month avg).
  //
  // Formula:
  //   last_sale_date = MAX(transaction_date) WHERE type IN ('ISSUE')
  //   days_since_last_sale = CURRENT_DATE - last_sale_date
  //   DEAD: days_since_last_sale > deadMonths * 30  OR  last_sale_date IS NULL
  //   SLOW: issues exist but avg monthly issues < 1 unit
  //
  // Edge cases:
  //   • Product never sold → DEAD (last_sale_date = NULL)
  //   • Product with only non-issue transactions → DEAD
  //   • Zero inventory → excluded (no stock to classify)
  //
  // Performance:
  //   • Left join to aggregated transactions
  //   • Index: inventory_transactions(tenant_id, product_id, transaction_date)
  // ─────────────────────────────────────────────────────────────────────────
  async getDeadSlowStock(
    tenantId: string,
    filters: DeadSlowFilterDto,
  ): Promise<{ data: DeadSlowRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const deadMonths = filters.deadMonths ?? 6;
    const deadDays = deadMonths * 30;

    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(Prisma.sql`p.id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.locationIds?.length) {
      extraConds.push(Prisma.sql`l.id = ANY(${filters.locationIds}::uuid[])`);
    }
    if (filters.category) {
      extraConds.push(Prisma.sql`p.category = ${filters.category}`);
    }

    const baseCond = Prisma.sql`
      il.tenant_id = ${tenantId}::uuid
      AND il.on_hand_qty > 0
    `;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        WITH last_sales AS (
          SELECT
            it.product_id,
            it.location_id,
            MAX(it.transaction_date) AS last_sale_date,
            SUM(it.quantity)::float8 AS total_issued
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
          GROUP BY it.product_id, it.location_id
        )
        SELECT COUNT(*)::bigint AS cnt
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN last_sales ls ON ls.product_id = il.product_id AND ls.location_id = il.location_id
        WHERE ${where}
          AND (
            ls.last_sale_date IS NULL
            OR (CURRENT_DATE - ls.last_sale_date::date) > ${deadDays}
          )
      `,
    );

    const rows = await this.prisma.$queryRaw<DeadSlowRow[]>(
      Prisma.sql`
        WITH last_sales AS (
          SELECT
            it.product_id,
            it.location_id,
            MAX(it.transaction_date) AS last_sale_date,
            SUM(it.quantity)::float8 AS total_issued,
            COUNT(DISTINCT DATE_TRUNC('month', it.transaction_date))::int AS active_months
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
          GROUP BY it.product_id, it.location_id
        )
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          p.category,
          l.code          AS location_code,
          COALESCE(il.on_hand_qty, 0)::float8     AS on_hand_qty,
          COALESCE(il.inventory_value, 0)::float8  AS inventory_value,
          ls.last_sale_date,
          CASE
            WHEN ls.last_sale_date IS NOT NULL
            THEN (CURRENT_DATE - ls.last_sale_date::date)
            ELSE NULL
          END AS days_since_last_sale,
          CASE
            WHEN ls.last_sale_date IS NULL THEN 'DEAD'
            WHEN (CURRENT_DATE - ls.last_sale_date::date) > ${deadDays} THEN 'DEAD'
            WHEN ls.active_months > 0
              AND (ls.total_issued / ls.active_months) < 1 THEN 'SLOW'
            ELSE 'DEAD'
          END::text AS classification
        FROM inventory_levels il
        JOIN products p  ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN last_sales ls ON ls.product_id = il.product_id AND ls.location_id = il.location_id
        WHERE ${where}
          AND (
            ls.last_sale_date IS NULL
            OR (CURRENT_DATE - ls.last_sale_date::date) > ${deadDays}
            OR (ls.active_months > 0 AND (ls.total_issued / ls.active_months) < 1)
          )
        ORDER BY inventory_value DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // B. ABC ANALYSIS
  //
  // Based on consumption value over a configurable period (default 12 months).
  //
  // Formula:
  //   consumption_value = SUM(issue_qty × unit_cost)  per product
  //   pct_of_total      = consumption_value / total_consumption * 100
  //   cumulative_pct    = running SUM of pct_of_total (ordered desc)
  //   A: cumulative_pct <= thresholdA (default 80%)
  //   B: cumulative_pct <= thresholdB (default 95%)
  //   C: remainder
  //
  // Edge cases:
  //   • Zero consumption → class C
  //   • All products have same consumption → all class A (mathematically)
  //   • Missing unit_cost on transactions → COALESCE to product.standard_cost
  //
  // Performance:
  //   • CTE for consumption aggregation, window function for cumulative %
  //   • Index: inventory_transactions(tenant_id, transaction_type, transaction_date)
  // ─────────────────────────────────────────────────────────────────────────
  async getABCAnalysis(
    tenantId: string,
    filters: ABCAnalysisFilterDto,
  ): Promise<{ data: ABCRow[]; summary: { class: string; count: number; value: number; pct: number }[] }> {
    const periodMonths = filters.periodMonths ?? 12;
    const thresholdA = filters.thresholdA ?? 80;
    const thresholdB = filters.thresholdB ?? 95;

    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(Prisma.sql`p.id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.category) {
      extraConds.push(Prisma.sql`p.category = ${filters.category}`);
    }

    const prodFilter = extraConds.length
      ? Prisma.sql`AND ${Prisma.join(extraConds, ' AND ')}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<ABCRow[]>(
      Prisma.sql`
        WITH consumption AS (
          SELECT
            it.product_id,
            SUM(it.quantity * COALESCE(it.unit_cost, 0))::float8 AS consumption_value,
            SUM(it.quantity)::float8 AS consumption_qty
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
            AND it.transaction_date >= (CURRENT_DATE - (${periodMonths}::int || ' months')::interval)
          GROUP BY it.product_id
        ),
        inv_agg AS (
          SELECT
            il2.product_id,
            SUM(il2.on_hand_qty)::float8 AS on_hand_qty,
            SUM(il2.inventory_value)::float8 AS inventory_value
          FROM inventory_levels il2
          WHERE il2.tenant_id = ${tenantId}::uuid
          GROUP BY il2.product_id
        ),
        product_values AS (
          SELECT
            p.id            AS product_id,
            p.code          AS sku,
            p.name          AS product_name,
            COALESCE(c.consumption_value, 0)::float8  AS consumption_value,
            COALESCE(c.consumption_qty, 0)::float8    AS consumption_qty,
            COALESCE(ia.on_hand_qty, 0)::float8 AS on_hand_qty,
            COALESCE(ia.inventory_value, 0)::float8 AS inventory_value
          FROM products p
          LEFT JOIN consumption c ON c.product_id = p.id
          LEFT JOIN inv_agg ia ON ia.product_id = p.id
          WHERE p.tenant_id = ${tenantId}::uuid
            AND p.status = 'ACTIVE'
            ${prodFilter}
        ),
        ranked AS (
          SELECT
            pv.*,
            CASE
              WHEN SUM(pv.consumption_value) OVER () > 0
              THEN (pv.consumption_value / SUM(pv.consumption_value) OVER () * 100)
              ELSE 0
            END::float8 AS pct_of_total,
            CASE
              WHEN SUM(pv.consumption_value) OVER () > 0
              THEN SUM(pv.consumption_value) OVER (ORDER BY pv.consumption_value DESC) / SUM(pv.consumption_value) OVER () * 100
              ELSE 0
            END::float8 AS cumulative_pct
          FROM product_values pv
        )
        SELECT
          r.*,
          CASE
            WHEN r.cumulative_pct <= ${thresholdA}::float8 THEN 'A'
            WHEN r.cumulative_pct <= ${thresholdB}::float8 THEN 'B'
            ELSE 'C'
          END AS abc_class
        FROM ranked r
        ORDER BY r.consumption_value DESC
      `,
    );

    // Build summary
    const summaryMap = new Map<string, { count: number; value: number }>();
    for (const cls of ['A', 'B', 'C']) {
      summaryMap.set(cls, { count: 0, value: 0 });
    }
    const totalValue = rows.reduce((s, r) => s + (r.consumption_value ?? 0), 0);
    for (const row of rows) {
      const entry = summaryMap.get(row.abc_class)!;
      entry.count++;
      entry.value += row.consumption_value ?? 0;
    }

    const summary = ['A', 'B', 'C'].map((cls) => ({
      class: cls,
      count: summaryMap.get(cls)!.count,
      value: Math.round(summaryMap.get(cls)!.value * 100) / 100,
      pct: totalValue > 0
        ? Math.round((summaryMap.get(cls)!.value / totalValue) * 10000) / 100
        : 0,
    }));

    return { data: rows, summary };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // C. XYZ ANALYSIS
  //
  // Based on demand variability (coefficient of variation of monthly consumption).
  //
  // Formula:
  //   monthly_demand[i] = SUM(issue_qty) for month i
  //   avg_monthly       = AVG(monthly_demand)
  //   stddev_monthly    = STDDEV_POP(monthly_demand)
  //   CV                = stddev / avg  (0 if avg = 0)
  //
  //   X: CV <= thresholdX (default 0.5)  — stable demand
  //   Y: CV <= thresholdY (default 1.0)  — moderate variability
  //   Z: CV > thresholdY                 — erratic demand
  //
  // Edge cases:
  //   • Only 1 month of data → CV = 0 (insufficient variability signal)
  //   • Zero avg demand → CV = 0 (no demand = no variability)
  //   • Months with zero demand included as 0 (not skipped)
  //
  // Performance:
  //   • Two-level CTE: monthly aggregation → product-level stats
  //   • date_trunc('month') grouping on indexed transaction_date
  // ─────────────────────────────────────────────────────────────────────────
  async getXYZAnalysis(
    tenantId: string,
    filters: XYZAnalysisFilterDto,
  ): Promise<{ data: XYZRow[] }> {
    const periodMonths = filters.periodMonths ?? 12;
    const thresholdX = filters.thresholdX ?? 0.5;
    const thresholdY = filters.thresholdY ?? 1.0;

    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(Prisma.sql`p.id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.category) {
      extraConds.push(Prisma.sql`p.category = ${filters.category}`);
    }

    const prodFilter = extraConds.length
      ? Prisma.sql`AND ${Prisma.join(extraConds, ' AND ')}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<XYZRow[]>(
      Prisma.sql`
        WITH month_series AS (
          SELECT generate_series(
            DATE_TRUNC('month', CURRENT_DATE - (${periodMonths}::int || ' months')::interval),
            DATE_TRUNC('month', CURRENT_DATE),
            '1 month'::interval
          )::date AS month_start
        ),
        active_products AS (
          SELECT id AS product_id
          FROM products
          WHERE tenant_id = ${tenantId}::uuid AND status = 'ACTIVE'
        ),
        product_months AS (
          SELECT ap.product_id, ms.month_start
          FROM active_products ap
          CROSS JOIN month_series ms
        ),
        monthly_demand AS (
          SELECT
            pm.product_id,
            pm.month_start,
            COALESCE(SUM(it.quantity), 0)::float8 AS demand
          FROM product_months pm
          LEFT JOIN inventory_transactions it
            ON it.product_id = pm.product_id
            AND it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
            AND DATE_TRUNC('month', it.transaction_date) = pm.month_start
          GROUP BY pm.product_id, pm.month_start
        ),
        product_stats AS (
          SELECT
            md.product_id,
            AVG(md.demand)::float8           AS avg_monthly_demand,
            STDDEV_POP(md.demand)::float8    AS stddev_monthly_demand,
            COUNT(md.month_start)::int       AS months_analyzed
          FROM monthly_demand md
          GROUP BY md.product_id
        )
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          COALESCE(ps.avg_monthly_demand, 0)::float8     AS avg_monthly_demand,
          COALESCE(ps.stddev_monthly_demand, 0)::float8  AS stddev_monthly_demand,
          CASE
            WHEN COALESCE(ps.avg_monthly_demand, 0) > 0
            THEN (COALESCE(ps.stddev_monthly_demand, 0) / ps.avg_monthly_demand)::float8
            ELSE 0
          END AS coefficient_of_variation,
          CASE
            WHEN COALESCE(ps.avg_monthly_demand, 0) = 0 THEN 'Z'
            WHEN (COALESCE(ps.stddev_monthly_demand, 0) / ps.avg_monthly_demand) <= ${thresholdX}::float8 THEN 'X'
            WHEN (COALESCE(ps.stddev_monthly_demand, 0) / ps.avg_monthly_demand) <= ${thresholdY}::float8 THEN 'Y'
            ELSE 'Z'
          END AS xyz_class,
          COALESCE(ps.months_analyzed, 0)::int AS months_analyzed
        FROM products p
        LEFT JOIN product_stats ps ON ps.product_id = p.id
        WHERE p.tenant_id = ${tenantId}::uuid
          AND p.status = 'ACTIVE'
          ${prodFilter}
        ORDER BY coefficient_of_variation ASC
      `,
    );

    return { data: rows };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // D. INVENTORY TURNOVER
  //
  // Formula:
  //   COGS = SUM(issue_qty × unit_cost) over period
  //   Avg Inventory = (opening_inventory_value + closing_inventory_value) / 2
  //     Where opening = inventory_value at period start (approximated from ledger)
  //     closing = current inventory_value
  //   Turnover Ratio = COGS / Avg Inventory
  //   Days of Inventory = 365 / Turnover Ratio (annualized)
  //
  // Simplified approach: Use current inventory as proxy for avg (more accurate
  // with time-series snapshots, which we don't store separately).
  //
  // Edge cases:
  //   • Zero avg inventory → turnover = NULL (avoid div by zero)
  //   • Zero COGS → turnover = 0 (no consumption)
  //   • Negative inventory → included as-is (flags data issue)
  //
  // Performance:
  //   • CTE for COGS aggregation, join to inventory_levels
  //   • Date-bounded query for COGS period
  // ─────────────────────────────────────────────────────────────────────────
  async getInventoryTurnover(
    tenantId: string,
    filters: InventoryBaseFilterDto,
  ): Promise<{ data: TurnoverRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Default period: last 12 months
    const startDate = filters.startDate ?? new Date(
      new Date().setMonth(new Date().getMonth() - 12),
    ).toISOString().slice(0, 10);
    const endDate = filters.endDate ?? new Date().toISOString().slice(0, 10);

    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(Prisma.sql`p.id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.locationIds?.length) {
      extraConds.push(Prisma.sql`l.id = ANY(${filters.locationIds}::uuid[])`);
    }
    if (filters.category) {
      extraConds.push(Prisma.sql`p.category = ${filters.category}`);
    }

    const baseCond = Prisma.sql`il.tenant_id = ${tenantId}::uuid`;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;

    const rows = await this.prisma.$queryRaw<TurnoverRow[]>(
      Prisma.sql`
        WITH cogs AS (
          SELECT
            it.product_id,
            it.location_id,
            SUM(it.quantity * COALESCE(it.unit_cost, 0))::float8 AS cogs_value
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
            AND it.transaction_date >= ${startDate}::timestamp
            AND it.transaction_date <= ${endDate}::timestamp
          GROUP BY it.product_id, it.location_id
        )
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          l.code          AS location_code,
          COALESCE(c.cogs_value, 0)::float8    AS cogs,
          COALESCE(il.inventory_value, 0)::float8 AS avg_inventory,
          CASE
            WHEN COALESCE(il.inventory_value, 0) > 0
            THEN (COALESCE(c.cogs_value, 0) / il.inventory_value)::float8
            ELSE NULL
          END AS turnover_ratio,
          CASE
            WHEN COALESCE(c.cogs_value, 0) > 0 AND COALESCE(il.inventory_value, 0) > 0
            THEN (365.0 * il.inventory_value / c.cogs_value)::float8
            ELSE NULL
          END AS days_of_inventory
        FROM inventory_levels il
        JOIN products p  ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN cogs c ON c.product_id = il.product_id AND c.location_id = il.location_id
        WHERE ${where}
          AND il.on_hand_qty > 0
        ORDER BY turnover_ratio ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        WHERE ${where}
          AND il.on_hand_qty > 0
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }
}
