// ============================================================================
// PROCUREMENT / ORDERING REPORTS SERVICE
// Covers: Suggested Purchase, Supplier Performance, Stock-Out Detection
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
    StockOutFilterDto,
    SuggestedPurchaseFilterDto,
    SupplierPerformanceFilterDto
} from '../dto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SuggestedPurchaseRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  current_stock: number;
  available_stock: number;
  on_order_qty: number;
  avg_daily_demand: number;
  lead_time_days: number;
  safety_stock: number;
  reorder_point: number;
  demand_during_lead_time: number;
  suggested_purchase_qty: number;
  abc_class: string | null;
  preferred_supplier: string | null;
  estimated_cost: number;
}

export interface SupplierPerformanceRow {
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  total_orders: number;
  received_orders: number;
  avg_lead_time_days: number;
  min_lead_time_days: number;
  max_lead_time_days: number;
  on_time_count: number;
  on_time_pct: number;
  total_order_value: number;
  quality_rating: number | null;
  last_order_date: Date | null;
}

export interface StockOutRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_code: string;
  stockout_start: Date;
  stockout_end: Date | null;
  stockout_days: number;
  is_currently_out: boolean;
}

@Injectable()
export class ProcurementReportsService {
  private readonly logger = new Logger(ProcurementReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // A. SUGGESTED PURCHASE
  //
  // Formula:
  //   Avg Daily Demand = SUM(issues over last 90 days) / 90
  //   Demand During Lead Time = Avg Daily Demand × Lead Time Days
  //   Suggested Purchase Qty =
  //     MAX(0,
  //       Demand During Lead Time
  //       + Safety Stock
  //       − Current Stock
  //       − On Order Qty
  //     )
  //
  // Uses inventory_policies for lead_time, safety_stock, reorder_point.
  // Falls back to product.standard_cost for estimation when policy missing.
  //
  // Edge cases:
  //   • No demand history → suggested_qty = safety_stock − current_stock
  //   • No policy → lead_time default 7 days, safety 0
  //   • Negative suggested qty → clamped to 0
  //   • Already sufficient stock → excluded from results
  //
  // Performance:
  //   • CTE for avg daily demand (bounded 90-day window)
  //   • Filters to only items needing purchase
  // ─────────────────────────────────────────────────────────────────────────
  async getSuggestedPurchase(
    tenantId: string,
    filters: SuggestedPurchaseFilterDto,
  ): Promise<{ data: SuggestedPurchaseRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

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

    const rows = await this.prisma.$queryRaw<SuggestedPurchaseRow[]>(
      Prisma.sql`
        WITH demand_90d AS (
          SELECT
            it.product_id,
            it.location_id,
            SUM(it.quantity)::float8 AS total_demand,
            (SUM(it.quantity)::float8 / 90.0) AS avg_daily_demand
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
            AND it.transaction_date >= (CURRENT_DATE - 90)
          GROUP BY it.product_id, it.location_id
        ),
        preferred_supplier AS (
          SELECT DISTINCT ON (pol.product_id)
            pol.product_id,
            s.name AS supplier_name
          FROM purchase_order_lines pol
          JOIN purchase_orders po ON po.id = pol.purchase_order_id
          JOIN suppliers s ON s.id = po.supplier_id
          WHERE po.tenant_id = ${tenantId}::uuid
            AND po.status NOT IN ('CANCELLED', 'DRAFT')
          ORDER BY pol.product_id, po.order_date DESC
        )
        SELECT
          p.id                AS product_id,
          p.code              AS sku,
          p.name              AS product_name,
          l.id                AS location_id,
          l.code              AS location_code,
          COALESCE(il.on_hand_qty, 0)::float8        AS current_stock,
          COALESCE(il.available_qty, 0)::float8       AS available_stock,
          COALESCE(il.on_order_qty, 0)::float8        AS on_order_qty,
          COALESCE(d.avg_daily_demand, 0)::float8     AS avg_daily_demand,
          COALESCE(ip.lead_time_days, 7)::int         AS lead_time_days,
          COALESCE(ip.safety_stock_qty, 0)::float8    AS safety_stock,
          COALESCE(ip.reorder_point, 0)::float8       AS reorder_point,
          (COALESCE(d.avg_daily_demand, 0) * COALESCE(ip.lead_time_days, 7))::float8
            AS demand_during_lead_time,
          GREATEST(
            (COALESCE(d.avg_daily_demand, 0) * COALESCE(ip.lead_time_days, 7))
            + COALESCE(ip.safety_stock_qty, 0)
            - COALESCE(il.on_hand_qty, 0)
            - COALESCE(il.on_order_qty, 0),
            0
          )::float8 AS suggested_purchase_qty,
          ip.abc_class,
          ps.supplier_name    AS preferred_supplier,
          (
            GREATEST(
              (COALESCE(d.avg_daily_demand, 0) * COALESCE(ip.lead_time_days, 7))
              + COALESCE(ip.safety_stock_qty, 0)
              - COALESCE(il.on_hand_qty, 0)
              - COALESCE(il.on_order_qty, 0),
              0
            )
            * COALESCE(il.average_cost, p.standard_cost, 0)
          )::float8 AS estimated_cost
        FROM inventory_levels il
        JOIN products p  ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN inventory_policies ip
          ON ip.tenant_id = il.tenant_id
          AND ip.product_id = il.product_id
          AND ip.location_id = il.location_id
        LEFT JOIN demand_90d d
          ON d.product_id = il.product_id
          AND d.location_id = il.location_id
        LEFT JOIN preferred_supplier ps
          ON ps.product_id = il.product_id
        WHERE ${where}
          AND (
            COALESCE(il.on_hand_qty, 0) + COALESCE(il.on_order_qty, 0)
            <
            (COALESCE(d.avg_daily_demand, 0) * COALESCE(ip.lead_time_days, 7))
            + COALESCE(ip.safety_stock_qty, 0)
          )
        ORDER BY
          CASE ip.abc_class WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
          suggested_purchase_qty DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        WITH demand_90d AS (
          SELECT
            it.product_id,
            it.location_id,
            SUM(it.quantity)::float8 AS total_demand,
            (SUM(it.quantity)::float8 / 90.0) AS avg_daily_demand
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
            AND it.transaction_date >= (CURRENT_DATE - 90)
          GROUP BY it.product_id, it.location_id
        )
        SELECT COUNT(*)::bigint AS cnt
        FROM inventory_levels il
        JOIN products p  ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN inventory_policies ip
          ON ip.tenant_id = il.tenant_id
          AND ip.product_id = il.product_id
          AND ip.location_id = il.location_id
        LEFT JOIN demand_90d d
          ON d.product_id = il.product_id
          AND d.location_id = il.location_id
        WHERE ${where}
          AND (
            COALESCE(il.on_hand_qty, 0) + COALESCE(il.on_order_qty, 0)
            <
            (COALESCE(d.avg_daily_demand, 0) * COALESCE(ip.lead_time_days, 7))
            + COALESCE(ip.safety_stock_qty, 0)
          )
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // B. SUPPLIER PERFORMANCE
  //
  // Metrics per supplier:
  //   Avg Lead Time  = AVG(receipt_date - order_date) in days
  //   On-Time %      = COUNT(receipt_date <= expected_date) / COUNT(received) * 100
  //   Total Orders   = COUNT(purchase_orders)
  //
  // Edge cases:
  //   • No receipts → lead time NULL, on-time 0%
  //   • Partially received POs → uses first receipt date
  //   • NULL expected_date → excluded from on-time calc
  //   • Quality rating from supplier master (may be NULL)
  //
  // Performance:
  //   • Aggregation on purchase_orders + goods_receipts
  //   • Indexes: purchase_orders(tenant_id, supplier_id), goods_receipts(tenant_id)
  // ─────────────────────────────────────────────────────────────────────────
  async getSupplierPerformance(
    tenantId: string,
    filters: SupplierPerformanceFilterDto,
  ): Promise<{ data: SupplierPerformanceRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const extraConds: Prisma.Sql[] = [];
    if (filters.supplierIds?.length) {
      extraConds.push(Prisma.sql`s.id = ANY(${filters.supplierIds}::uuid[])`);
    }
    if (filters.startDate) {
      extraConds.push(Prisma.sql`po.order_date >= ${filters.startDate}::date`);
    }
    if (filters.endDate) {
      extraConds.push(Prisma.sql`po.order_date <= ${filters.endDate}::date`);
    }

    const baseCond = Prisma.sql`po.tenant_id = ${tenantId}::uuid AND po.status != 'CANCELLED'`;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;

    const rows = await this.prisma.$queryRaw<SupplierPerformanceRow[]>(
      Prisma.sql`
        WITH po_receipts AS (
          SELECT
            po.id AS po_id,
            po.supplier_id,
            po.order_date,
            po.expected_date,
            po.total_amount,
            po.status,
            MIN(gr.receipt_date) AS first_receipt_date
          FROM purchase_orders po
          LEFT JOIN goods_receipts gr
            ON gr.purchase_order_id = po.id
            AND gr.status = 'POSTED'
          WHERE ${where}
          GROUP BY po.id, po.supplier_id, po.order_date, po.expected_date, po.total_amount, po.status
        )
        SELECT
          s.id                AS supplier_id,
          s.code              AS supplier_code,
          s.name              AS supplier_name,
          COUNT(pr.po_id)::int AS total_orders,
          COUNT(pr.first_receipt_date)::int AS received_orders,
          COALESCE(
            AVG(
              CASE WHEN pr.first_receipt_date IS NOT NULL
              THEN (pr.first_receipt_date::date - pr.order_date::date)
              ELSE NULL END
            ), 0
          )::float8 AS avg_lead_time_days,
          COALESCE(
            MIN(
              CASE WHEN pr.first_receipt_date IS NOT NULL
              THEN (pr.first_receipt_date::date - pr.order_date::date)
              ELSE NULL END
            ), 0
          )::float8 AS min_lead_time_days,
          COALESCE(
            MAX(
              CASE WHEN pr.first_receipt_date IS NOT NULL
              THEN (pr.first_receipt_date::date - pr.order_date::date)
              ELSE NULL END
            ), 0
          )::float8 AS max_lead_time_days,
          COUNT(
            CASE
              WHEN pr.first_receipt_date IS NOT NULL
                AND pr.expected_date IS NOT NULL
                AND pr.first_receipt_date::date <= pr.expected_date::date
              THEN 1
            END
          )::int AS on_time_count,
          CASE
            WHEN COUNT(pr.first_receipt_date) > 0
            THEN (
              COUNT(
                CASE
                  WHEN pr.first_receipt_date IS NOT NULL
                    AND pr.expected_date IS NOT NULL
                    AND pr.first_receipt_date::date <= pr.expected_date::date
                  THEN 1
                END
              )::float8 / COUNT(pr.first_receipt_date)::float8 * 100
            )
            ELSE 0
          END::float8 AS on_time_pct,
          COALESCE(SUM(pr.total_amount), 0)::float8 AS total_order_value,
          s.quality_rating::float8,
          MAX(pr.order_date) AS last_order_date
        FROM suppliers s
        LEFT JOIN po_receipts pr ON pr.supplier_id = s.id
        WHERE s.tenant_id = ${tenantId}::uuid
          AND s.status = 'ACTIVE'
        GROUP BY s.id, s.code, s.name, s.quality_rating
        HAVING COUNT(pr.po_id) > 0
        ORDER BY on_time_pct DESC, avg_lead_time_days ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        WITH po_receipts AS (
          SELECT
            po.id AS po_id,
            po.supplier_id,
            MIN(gr.receipt_date) AS first_receipt_date
          FROM purchase_orders po
          LEFT JOIN goods_receipts gr
            ON gr.purchase_order_id = po.id
            AND gr.status = 'POSTED'
          WHERE ${where}
          GROUP BY po.id, po.supplier_id
        )
        SELECT COUNT(DISTINCT s.id)::bigint AS cnt
        FROM suppliers s
        LEFT JOIN po_receipts pr ON pr.supplier_id = s.id
        WHERE s.tenant_id = ${tenantId}::uuid
          AND s.status = 'ACTIVE'
        GROUP BY s.id
        HAVING COUNT(pr.po_id) > 0
      `,
    );

    return { data: rows, total: countResult.length };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // C. STOCK-OUT DETECTION
  //
  // Identifies periods where a product had zero stock at a location.
  // Uses inventory_ledger running_balance transitions through zero.
  //
  // Approach:
  //   1. Find ledger entries where running_balance drops to 0 → stockout_start
  //   2. Find next entry where running_balance > 0 → stockout_end
  //   3. If still at 0 → currently out of stock
  //
  // Edge cases:
  //   • Product never had stock → no ledger entries, not a "stock-out"
  //   • Multiple stock-outs → each reported separately
  //   • Current stock-out: stockout_end = NULL, is_currently_out = true
  //
  // Performance:
  //   • Uses LAG/LEAD window functions on inventory_ledger
  //   • Index: inventory_ledger(tenant_id, product_id, location_id)
  //   • Date range filter recommended for large datasets
  // ─────────────────────────────────────────────────────────────────────────
  async getStockOuts(
    tenantId: string,
    filters: StockOutFilterDto,
  ): Promise<{ data: StockOutRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(Prisma.sql`sub.product_id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.locationIds?.length) {
      extraConds.push(Prisma.sql`sub.location_id = ANY(${filters.locationIds}::uuid[])`);
    }
    if (filters.startDate) {
      extraConds.push(Prisma.sql`sub.transaction_date >= ${filters.startDate}::timestamp`);
    }
    if (filters.endDate) {
      extraConds.push(Prisma.sql`sub.transaction_date <= ${filters.endDate}::timestamp`);
    }

    const filterSql = extraConds.length
      ? Prisma.sql`AND ${Prisma.join(extraConds, ' AND ')}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<StockOutRow[]>(
      Prisma.sql`
        WITH balance_transitions AS (
          SELECT
            il.product_id,
            il.location_id,
            il.transaction_date,
            il.running_balance,
            LAG(il.running_balance) OVER (
              PARTITION BY il.product_id, il.location_id
              ORDER BY il.sequence_number
            ) AS prev_balance,
            LEAD(il.transaction_date) OVER (
              PARTITION BY il.product_id, il.location_id
              ORDER BY il.sequence_number
            ) AS next_date,
            LEAD(il.running_balance) OVER (
              PARTITION BY il.product_id, il.location_id
              ORDER BY il.sequence_number
            ) AS next_balance
          FROM inventory_ledger il
          WHERE il.tenant_id = ${tenantId}::uuid
        ),
        stockouts AS (
          SELECT
            sub.product_id,
            sub.location_id,
            sub.transaction_date AS stockout_start,
            CASE
              WHEN sub.next_balance IS NOT NULL AND sub.next_balance > 0
              THEN sub.next_date
              ELSE NULL
            END AS stockout_end,
            CASE
              WHEN sub.next_balance IS NULL OR sub.next_balance <= 0
              THEN true
              ELSE false
            END AS is_currently_out
          FROM balance_transitions sub
          WHERE sub.running_balance <= 0
            AND (sub.prev_balance IS NULL OR sub.prev_balance > 0)
            ${filterSql}
        )
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          l.code          AS location_code,
          so.stockout_start,
          so.stockout_end,
          CASE
            WHEN so.stockout_end IS NOT NULL
            THEN (so.stockout_end::date - so.stockout_start::date)
            ELSE (CURRENT_DATE - so.stockout_start::date)
          END AS stockout_days,
          so.is_currently_out
        FROM stockouts so
        JOIN products p  ON p.id = so.product_id
        JOIN locations l ON l.id = so.location_id
        ORDER BY so.is_currently_out DESC, so.stockout_start DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        WITH balance_transitions AS (
          SELECT
            il.product_id,
            il.location_id,
            il.transaction_date,
            il.running_balance,
            LAG(il.running_balance) OVER (
              PARTITION BY il.product_id, il.location_id
              ORDER BY il.sequence_number
            ) AS prev_balance
          FROM inventory_ledger il
          WHERE il.tenant_id = ${tenantId}::uuid
        ),
        stockouts AS (
          SELECT sub.product_id, sub.location_id, sub.transaction_date
          FROM balance_transitions sub
          WHERE sub.running_balance <= 0
            AND (sub.prev_balance IS NULL OR sub.prev_balance > 0)
            ${filterSql}
        )
        SELECT COUNT(*)::bigint AS cnt FROM stockouts
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }
}
