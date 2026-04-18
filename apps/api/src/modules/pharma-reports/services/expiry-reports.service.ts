// ============================================================================
// EXPIRY MANAGEMENT REPORTS SERVICE
// Covers: Near Expiry, Expired Stock, FEFO Picking, Expiry Risk Analysis
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { ExpiryFilterDto, InventoryBaseFilterDto } from '../dto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NearExpiryRow {
  product_id: string;
  sku: string;
  product_name: string;
  batch_id: string;
  batch_number: string;
  location_code: string;
  location_name: string;
  expiry_date: Date;
  remaining_days: number;
  quantity: number;
  available_qty: number;
  cost_per_unit: number;
  at_risk_value: number;
  batch_status: string;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ExpiredStockRow {
  product_id: string;
  sku: string;
  product_name: string;
  batch_id: string;
  batch_number: string;
  location_code: string;
  location_name: string;
  expiry_date: Date;
  days_expired: number;
  quantity: number;
  cost_per_unit: number;
  expired_value: number;
  batch_status: string;
}

export interface FEFOPickingRow {
  product_id: string;
  sku: string;
  product_name: string;
  picking_sequence: number;
  batch_id: string;
  batch_number: string;
  location_code: string;
  expiry_date: Date | null;
  remaining_days: number | null;
  available_qty: number;
  batch_status: string;
}

export interface ExpiryRiskSummary {
  total_inventory_value: number;
  expired_value: number;
  expired_pct: number;
  near_expiry_value_30d: number;
  near_expiry_pct_30d: number;
  near_expiry_value_90d: number;
  near_expiry_pct_90d: number;
  near_expiry_value_180d: number;
  near_expiry_pct_180d: number;
  near_expiry_value_270d: number;
  near_expiry_pct_270d: number;
  monthly_trend: ExpiryTrendPoint[];
}

export interface ExpiryTrendPoint {
  month: string;
  expiring_value: number;
  expiring_qty: number;
  batch_count: number;
}

@Injectable()
export class ExpiryReportsService {
  private readonly logger = new Logger(ExpiryReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // A. NEAR EXPIRY
  //
  // Formula: Remaining Days = expiry_date - CURRENT_DATE
  // Configurable threshold (default 90 days).
  // Urgency classification:
  //   CRITICAL: ≤ 30 days
  //   HIGH:     31–90 days
  //   MEDIUM:   91–180 days
  //   LOW:      181–threshold days
  //
  // Edge cases:
  //   • NULL expiry_date: excluded (no expiry tracking)
  //   • expiry_date < manufacturing_date: included but flagged via negative margin
  //   • Zero quantity batches: excluded
  //   • Already expired: excluded (see getExpiredStock)
  //
  // Performance:
  //   • Index: batches(tenant_id, expiry_date)
  //   • Filter limits result set by threshold window
  // ─────────────────────────────────────────────────────────────────────────
  async getNearExpiry(
    tenantId: string,
    filters: ExpiryFilterDto,
  ): Promise<{ data: NearExpiryRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const thresholdDays = filters.thresholdDays ?? 90;

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
      b.tenant_id = ${tenantId}::uuid
      AND b.expiry_date IS NOT NULL
      AND b.expiry_date::date >= CURRENT_DATE
      AND b.expiry_date::date <= (CURRENT_DATE + ${thresholdDays}::int)
      AND b.quantity > 0
      AND b.status NOT IN ('CONSUMED', 'RECALLED')
    `;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM batches b
        JOIN products p ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE ${where}
      `,
    );

    const rows = await this.prisma.$queryRaw<NearExpiryRow[]>(
      Prisma.sql`
        SELECT
          p.id                          AS product_id,
          p.code                        AS sku,
          p.name                        AS product_name,
          b.id                          AS batch_id,
          b.batch_number,
          l.code                        AS location_code,
          l.name                        AS location_name,
          b.expiry_date,
          (b.expiry_date::date - CURRENT_DATE) AS remaining_days,
          b.quantity::float8            AS quantity,
          COALESCE(b.available_qty, 0)::float8  AS available_qty,
          COALESCE(b.cost_per_unit, 0)::float8  AS cost_per_unit,
          (COALESCE(b.quantity, 0) * COALESCE(b.cost_per_unit, 0))::float8 AS at_risk_value,
          b.status::text                AS batch_status,
          CASE
            WHEN (b.expiry_date::date - CURRENT_DATE) <= 30  THEN 'CRITICAL'
            WHEN (b.expiry_date::date - CURRENT_DATE) <= 90  THEN 'HIGH'
            WHEN (b.expiry_date::date - CURRENT_DATE) <= 180 THEN 'MEDIUM'
            ELSE 'LOW'
          END AS urgency
        FROM batches b
        JOIN products p  ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE ${where}
        ORDER BY remaining_days ASC, at_risk_value DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // B. EXPIRED STOCK
  //
  // expiry_date < CURRENT_DATE AND quantity > 0 (still in stock).
  //
  // Edge cases:
  //   • Batches still showing quantity > 0 after expiry: indicates unreturned/
  //     unscraped stock → financial liability.
  //   • Status still 'AVAILABLE': data inconsistency flag.
  //
  // Performance:
  //   • Index: batches(tenant_id, expiry_date) covers this query efficiently
  // ─────────────────────────────────────────────────────────────────────────
  async getExpiredStock(
    tenantId: string,
    filters: InventoryBaseFilterDto,
  ): Promise<{ data: ExpiredStockRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(Prisma.sql`p.id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.locationIds?.length) {
      extraConds.push(Prisma.sql`l.id = ANY(${filters.locationIds}::uuid[])`);
    }

    const baseCond = Prisma.sql`
      b.tenant_id = ${tenantId}::uuid
      AND b.expiry_date IS NOT NULL
      AND b.expiry_date::date < CURRENT_DATE
      AND b.quantity > 0
      AND b.status NOT IN ('CONSUMED', 'RECALLED')
    `;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM batches b
        JOIN products p ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE ${where}
      `,
    );

    const rows = await this.prisma.$queryRaw<ExpiredStockRow[]>(
      Prisma.sql`
        SELECT
          p.id                          AS product_id,
          p.code                        AS sku,
          p.name                        AS product_name,
          b.id                          AS batch_id,
          b.batch_number,
          l.code                        AS location_code,
          l.name                        AS location_name,
          b.expiry_date,
          (CURRENT_DATE - b.expiry_date::date) AS days_expired,
          b.quantity::float8            AS quantity,
          COALESCE(b.cost_per_unit, 0)::float8  AS cost_per_unit,
          (COALESCE(b.quantity, 0) * COALESCE(b.cost_per_unit, 0))::float8 AS expired_value,
          b.status::text                AS batch_status
        FROM batches b
        JOIN products p  ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE ${where}
        ORDER BY days_expired DESC, expired_value DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // C. FEFO (First Expiry, First Out) PICKING SEQUENCE
  //
  // For each product, returns batches sorted by earliest expiry first.
  // This provides the optimal picking order for warehouse operations.
  //
  // Rules:
  //   1. Only AVAILABLE batches with available_qty > 0
  //   2. Sorted by expiry_date ASC (earliest first)
  //   3. NULL expiry_date placed LAST
  //   4. Picking sequence numbered per product
  //
  // Edge cases:
  //   • Quarantined/held batches: excluded from picking
  //   • Multiple locations: separate sequences per product+location
  // ─────────────────────────────────────────────────────────────────────────
  async getFEFOPickingSequence(
    tenantId: string,
    filters: InventoryBaseFilterDto,
  ): Promise<{ data: FEFOPickingRow[]; total: number }> {
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(Prisma.sql`p.id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.locationIds?.length) {
      extraConds.push(Prisma.sql`l.id = ANY(${filters.locationIds}::uuid[])`);
    }

    const baseCond = Prisma.sql`
      b.tenant_id = ${tenantId}::uuid
      AND b.status = 'AVAILABLE'
      AND COALESCE(b.available_qty, 0) > 0
    `;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;

    const rows = await this.prisma.$queryRaw<FEFOPickingRow[]>(
      Prisma.sql`
        SELECT
          p.id                AS product_id,
          p.code              AS sku,
          p.name              AS product_name,
          ROW_NUMBER() OVER (
            PARTITION BY p.id, l.id
            ORDER BY b.expiry_date ASC NULLS LAST, b.manufacturing_date ASC NULLS LAST
          )::int              AS picking_sequence,
          b.id                AS batch_id,
          b.batch_number,
          l.code              AS location_code,
          b.expiry_date,
          CASE
            WHEN b.expiry_date IS NOT NULL
            THEN (b.expiry_date::date - CURRENT_DATE)
            ELSE NULL
          END                 AS remaining_days,
          COALESCE(b.available_qty, 0)::float8 AS available_qty,
          b.status::text      AS batch_status
        FROM batches b
        JOIN products p  ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE ${where}
        ORDER BY p.code, l.code, picking_sequence
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM batches b
        JOIN products p ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE ${where}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // D. EXPIRY RISK ANALYSIS
  //
  // Provides:
  //   • Total inventory value
  //   • Expired stock value + percentage
  //   • Near-expiry value at multiple thresholds (30/90/180/270 days)
  //   • Monthly expiry trend (next 12 months)
  //
  // Formulas:
  //   expired_pct = expired_value / total_inventory_value * 100
  //   near_expiry_pct = near_expiry_value / total_inventory_value * 100
  //
  // Edge cases:
  //   • Zero total inventory: percentages = 0 (not NaN)
  //   • Batches with NULL expiry: excluded from expiry risk but included in total
  //   • Batches with NULL cost_per_unit: treated as 0 value
  //
  // Performance:
  //   • Single-pass CTE for total, expired, near-expiry at all thresholds
  //   • Monthly trend: separate GROUP BY on expiry month
  // ─────────────────────────────────────────────────────────────────────────
  async getExpiryRiskAnalysis(
    tenantId: string,
    filters: InventoryBaseFilterDto,
  ): Promise<ExpiryRiskSummary> {
    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(Prisma.sql`p.id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.locationIds?.length) {
      extraConds.push(Prisma.sql`l.id = ANY(${filters.locationIds}::uuid[])`);
    }

    const baseCond = Prisma.sql`
      b.tenant_id = ${tenantId}::uuid
      AND b.quantity > 0
      AND b.status NOT IN ('CONSUMED', 'RECALLED')
    `;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;

    const [summary] = await this.prisma.$queryRaw<[{
      total_inventory_value: number;
      expired_value: number;
      near_expiry_value_30d: number;
      near_expiry_value_90d: number;
      near_expiry_value_180d: number;
      near_expiry_value_270d: number;
    }]>(
      Prisma.sql`
        SELECT
          COALESCE(SUM(b.quantity * COALESCE(b.cost_per_unit, 0)), 0)::float8
            AS total_inventory_value,

          COALESCE(SUM(
            CASE WHEN b.expiry_date IS NOT NULL AND b.expiry_date::date < CURRENT_DATE
            THEN b.quantity * COALESCE(b.cost_per_unit, 0) ELSE 0 END
          ), 0)::float8 AS expired_value,

          COALESCE(SUM(
            CASE WHEN b.expiry_date IS NOT NULL
              AND b.expiry_date::date >= CURRENT_DATE
              AND b.expiry_date::date <= (CURRENT_DATE + 30)
            THEN b.quantity * COALESCE(b.cost_per_unit, 0) ELSE 0 END
          ), 0)::float8 AS near_expiry_value_30d,

          COALESCE(SUM(
            CASE WHEN b.expiry_date IS NOT NULL
              AND b.expiry_date::date >= CURRENT_DATE
              AND b.expiry_date::date <= (CURRENT_DATE + 90)
            THEN b.quantity * COALESCE(b.cost_per_unit, 0) ELSE 0 END
          ), 0)::float8 AS near_expiry_value_90d,

          COALESCE(SUM(
            CASE WHEN b.expiry_date IS NOT NULL
              AND b.expiry_date::date >= CURRENT_DATE
              AND b.expiry_date::date <= (CURRENT_DATE + 180)
            THEN b.quantity * COALESCE(b.cost_per_unit, 0) ELSE 0 END
          ), 0)::float8 AS near_expiry_value_180d,

          COALESCE(SUM(
            CASE WHEN b.expiry_date IS NOT NULL
              AND b.expiry_date::date >= CURRENT_DATE
              AND b.expiry_date::date <= (CURRENT_DATE + 270)
            THEN b.quantity * COALESCE(b.cost_per_unit, 0) ELSE 0 END
          ), 0)::float8 AS near_expiry_value_270d

        FROM batches b
        JOIN products p ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE ${where}
      `,
    );

    const totalVal = summary?.total_inventory_value ?? 0;
    const safeDivide = (num: number) =>
      totalVal > 0 ? Math.round((num / totalVal) * 10000) / 100 : 0;

    // Monthly expiry trend (next 12 months)
    const trend = await this.prisma.$queryRaw<ExpiryTrendPoint[]>(
      Prisma.sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', b.expiry_date), 'YYYY-MM') AS month,
          SUM(b.quantity * COALESCE(b.cost_per_unit, 0))::float8 AS expiring_value,
          SUM(b.quantity)::float8 AS expiring_qty,
          COUNT(b.id)::int AS batch_count
        FROM batches b
        JOIN products p ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE ${where}
          AND b.expiry_date IS NOT NULL
          AND b.expiry_date::date >= CURRENT_DATE
          AND b.expiry_date::date < (CURRENT_DATE + INTERVAL '12 months')
        GROUP BY DATE_TRUNC('month', b.expiry_date)
        ORDER BY month
      `,
    );

    return {
      total_inventory_value: totalVal,
      expired_value: summary?.expired_value ?? 0,
      expired_pct: safeDivide(summary?.expired_value ?? 0),
      near_expiry_value_30d: summary?.near_expiry_value_30d ?? 0,
      near_expiry_pct_30d: safeDivide(summary?.near_expiry_value_30d ?? 0),
      near_expiry_value_90d: summary?.near_expiry_value_90d ?? 0,
      near_expiry_pct_90d: safeDivide(summary?.near_expiry_value_90d ?? 0),
      near_expiry_value_180d: summary?.near_expiry_value_180d ?? 0,
      near_expiry_pct_180d: safeDivide(summary?.near_expiry_value_180d ?? 0),
      near_expiry_value_270d: summary?.near_expiry_value_270d ?? 0,
      near_expiry_pct_270d: safeDivide(summary?.near_expiry_value_270d ?? 0),
      monthly_trend: trend,
    };
  }
}
