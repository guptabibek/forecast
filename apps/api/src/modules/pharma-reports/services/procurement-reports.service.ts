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

export interface ProcurementDataAvailability {
  syncedFromMarg: boolean;
  margRecordCount: number;
  localRecordCount: number;
  tables: string[];
  notes: string[];
}

export interface ProcurementDataSyncAnalysis {
  purchaseOrders: ProcurementDataAvailability;
  purchaseInvoices: ProcurementDataAvailability;
  goodsReceipts: ProcurementDataAvailability;
  stockTransactions: ProcurementDataAvailability;
  sourceOfTruth: {
    supplierPerformanceMetrics: string;
    leadTimeCalculation: string;
    spendCalculation: string;
  };
  risks: string[];
  fallbackLogic: string[];
  syncImprovements: string[];
}

export interface SupplierPerformanceReportRow {
  supplier_key: string;
  supplier_name: string;
  supplier_code: string | null;
  total_orders: number;
  on_time_delivery_pct: number | null;
  avg_lead_time_days: number | null;
  fulfillment_rate_pct: number | null;
  rejection_rate_pct: number | null;
  total_spend: number | null;
  has_explicit_marg_mapping: boolean;
  mapping_status: 'EXPLICIT_MARG_MAPPING' | 'LOCAL_ONLY_UNMAPPED' | 'MARG_ONLY_UNMAPPED';
  order_source: string;
  lead_time_source: string;
  spend_source: string;
  spend_note: string | null;
  rejection_source: string;
  last_activity_date: Date | null;
}

export interface StockOutReportRow {
  product_id: string;
  sku: string;
  item_name: string;
  stock_out_count: number;
  total_duration_days: number;
  last_stock_out_date: Date | null;
  current_stock: number;
  marg_current_stock: number;
  current_stock_delta: number;
  current_stock_source: 'ALIGNED_WITH_MARG' | 'DIVERGES_FROM_MARG';
}

export interface SupplierPerformanceReportResponse {
  analysis: ProcurementDataSyncAnalysis;
  data: SupplierPerformanceReportRow[];
  total: number;
}

export interface StockOutReportResponse {
  analysis: ProcurementDataSyncAnalysis;
  data: StockOutReportRow[];
  total: number;
}

interface LocalSupplierPerformanceMetric {
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  total_orders: number;
  on_time_delivery_pct: number | null;
  avg_lead_time_days: number | null;
  fulfillment_rate_pct: number | null;
  rejection_rate_pct: number | null;
  has_explicit_marg_mapping: boolean;
  local_po_spend: number;
  last_activity_date: Date | null;
}

interface MargSupplierInvoiceMetric {
  supplier_key: string;
  mapped_supplier_id: string | null;
  supplier_code: string | null;
  supplier_name: string;
  purchase_invoice_count: number;
  total_spend: number;
  estimated_lead_time_days: number | null;
  has_explicit_supplier_mapping: boolean;
  has_order_date_fallback: boolean;
  last_invoice_date: Date | null;
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

  async getProcurementDataSyncAnalysis(tenantId: string): Promise<ProcurementDataSyncAnalysis> {
    const [
      localPurchaseOrders,
      localGoodsReceipts,
      localQualityInspections,
      totalSuppliers,
      mappedSuppliers,
      margPurchaseInvoices,
      mappedMargPurchaseInvoices,
      unmappedMargPurchaseInvoices,
      margPurchaseInvoicesWithOrderDate,
      margInventoryTransactions,
      margInventoryLedgerEntries,
    ] = await Promise.all([
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM purchase_orders WHERE tenant_id = ${tenantId}::uuid`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM goods_receipts WHERE tenant_id = ${tenantId}::uuid`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM quality_inspections WHERE tenant_id = ${tenantId}::uuid AND purchase_order_id IS NOT NULL`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM suppliers WHERE tenant_id = ${tenantId}::uuid`),
      this.countRows(Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM suppliers s
        WHERE s.tenant_id = ${tenantId}::uuid
          AND (
            (s.external_id IS NOT NULL AND s.external_id LIKE 'marg:%')
            OR COALESCE(s.attributes->>'margCid', '') <> ''
          )
      `),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM marg_vouchers WHERE tenant_id = ${tenantId}::uuid AND type = 'P'`),
      this.countRows(Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM marg_vouchers mv
        WHERE mv.tenant_id = ${tenantId}::uuid
          AND mv.type = 'P'
          AND EXISTS (
            SELECT 1
            FROM suppliers s
            WHERE s.tenant_id = mv.tenant_id
              AND (
                s.external_id = CONCAT('marg:', mv.company_id::text, ':', COALESCE(mv.cid, ''))
                OR (
                  COALESCE(s.attributes->>'margCid', '') = COALESCE(mv.cid, '')
                  AND (
                    COALESCE(s.attributes->>'margCompanyId', '') = ''
                    OR COALESCE(s.attributes->>'margCompanyId', '') = mv.company_id::text
                  )
                )
              )
          )
      `),
      this.countRows(Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM marg_vouchers mv
        WHERE mv.tenant_id = ${tenantId}::uuid
          AND mv.type = 'P'
          AND NOT EXISTS (
            SELECT 1
            FROM suppliers s
            WHERE s.tenant_id = mv.tenant_id
              AND (
                s.external_id = CONCAT('marg:', mv.company_id::text, ':', COALESCE(mv.cid, ''))
                OR (
                  COALESCE(s.attributes->>'margCid', '') = COALESCE(mv.cid, '')
                  AND (
                    COALESCE(s.attributes->>'margCompanyId', '') = ''
                    OR COALESCE(s.attributes->>'margCompanyId', '') = mv.company_id::text
                  )
                )
              )
          )
      `),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM marg_vouchers WHERE tenant_id = ${tenantId}::uuid AND type = 'P' AND o_date IS NOT NULL`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM inventory_transactions WHERE tenant_id = ${tenantId}::uuid AND reference_type = 'MARG_EDE'`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM inventory_ledger WHERE tenant_id = ${tenantId}::uuid AND reference_type = 'MARG_EDE'`),
    ]);

    return {
      purchaseOrders: {
        syncedFromMarg: false,
        margRecordCount: 0,
        localRecordCount: localPurchaseOrders,
        tables: ['purchase_orders', 'purchase_order_lines'],
        notes: [
          'No Marg EDE transform writes into local purchase_orders.',
          'Purchase orders are only available through the local procurement workflow unless a separate sync is added.',
        ],
      },
      purchaseInvoices: {
        syncedFromMarg: margPurchaseInvoices > 0,
        margRecordCount: margPurchaseInvoices,
        localRecordCount: 0,
        tables: ['marg_vouchers', 'marg_transactions', 'actuals'],
        notes: [
          'Marg voucher type P is treated as purchase invoice spend.',
          `${mappedMargPurchaseInvoices} of ${margPurchaseInvoices} synced purchase invoices can currently be attributed through explicit supplier mapping; ${margPurchaseInvoicesWithOrderDate} carry Marg ODate for estimated lead-time fallback.`,
        ],
      },
      goodsReceipts: {
        syncedFromMarg: false,
        margRecordCount: 0,
        localRecordCount: localGoodsReceipts,
        tables: ['goods_receipts', 'goods_receipt_lines', 'inventory_transactions'],
        notes: [
          'Marg sync does not create explicit GRN / inward header rows.',
          `Inbound receipts can only be inferred from Marg-backed inventory movements; exact partial-delivery math still comes from ${localGoodsReceipts} local GRNs and ${localQualityInspections} linked quality inspections.`,
        ],
      },
      stockTransactions: {
        syncedFromMarg: margInventoryTransactions > 0 || margInventoryLedgerEntries > 0,
        margRecordCount: margInventoryLedgerEntries,
        localRecordCount: margInventoryTransactions,
        tables: ['marg_transactions', 'inventory_transactions', 'inventory_ledger'],
        notes: [
          'Marg transaction types are projected into inventory_transactions and inventory_ledger with reference_type = MARG_EDE.',
          'Stock-out periods are anchored to Marg-origin movement history, while current stock is compared against live inventory_levels to expose manual adjustment drift.',
        ],
      },
      sourceOfTruth: {
        supplierPerformanceMetrics: 'Local purchase_orders + posted goods_receipts + quality_inspections remain authoritative for OTIF, fulfillment, rejection, and exact lead time; Marg-only suppliers intentionally keep those metrics blank.',
        leadTimeCalculation: 'On-time delivery is computed only when a local purchase order has expected_date and a posted first receipt. Marg ODate is used only as an estimated lead-time fallback, never as an on-time promise date.',
        spendCalculation: 'Marg purchase invoices (marg_vouchers.type = P) are used only through explicit supplier mapping. Local PO spend is shown only when there is no Marg invoice overlap risk or when an explicitly mapped supplier has no invoice in the filtered window.',
      },
      risks: [
        'Supplier spend no longer uses heuristic code/name joins; unmapped Marg suppliers remain isolated until an explicit externalId or attributes.margCid mapping is configured.',
        'On-time delivery is intentionally blank unless local purchase_orders.expected_date and posted GRNs are present.',
        'Fulfillment rate is intentionally computed only from local PO/GRN lifecycle data; Marg invoices do not fabricate partial-delivery events.',
        'Current stock now carries a live-vs-Marg delta so manual inventory adjustments cannot silently distort Marg-only stock-out history.',
        `${mappedSuppliers} of ${totalSuppliers} suppliers currently advertise explicit Marg mapping metadata; ${unmappedMargPurchaseInvoices} Marg purchase invoices still remain unmapped and are reported separately.`,
      ],
      fallbackLogic: [
        'If a supplier has local PO/GR/QC data, use that for order count, on-time %, fulfillment %, rejection %, and exact lead time.',
        'If only Marg purchase invoices exist, use distinct purchase invoice vouchers for order count, invoice total for spend, and oDate -> invoice date as estimated lead time when oDate is present.',
        'If a local supplier is not explicitly mapped and Marg purchase invoices exist, suppress local spend rather than double count PO value against invoice value.',
        'If no explicit supplier mapping exists for a Marg invoice, keep that supplier in a separate Marg-only row instead of merging by code or name.',
      ],
      syncImprovements: [
        'Add a dedicated Marg supplier crosswalk into suppliers.externalId / attributes.margCid for reliable invoice-to-supplier joins.',
        'Sync explicit purchase order headers/lines and goods receipt headers/lines from Marg if supplier OTIF and fulfillment must be fully Marg-native.',
        'Persist expected delivery date, promised date, and supplier document timestamps from Marg raw payload where available.',
      ],
    };
  }

  async getSupplierPerformanceReport(
    tenantId: string,
    filters: SupplierPerformanceFilterDto,
  ): Promise<SupplierPerformanceReportResponse> {
    const analysis = await this.getProcurementDataSyncAnalysis(tenantId);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const tenantHasMargPurchaseInvoices = analysis.purchaseInvoices.margRecordCount > 0;

    const localMetrics = await this.getLocalSupplierPerformanceMetrics(tenantId, filters);
    const margMetrics = await this.getMargSupplierInvoiceMetrics(tenantId, filters);

    const merged = new Map<string, SupplierPerformanceReportRow>();

    for (const row of localMetrics) {
      const key = `supplier:${row.supplier_id}`;
      const allowLocalSpend = row.local_po_spend > 0 && (!tenantHasMargPurchaseInvoices || row.has_explicit_marg_mapping);
      const spendSource = allowLocalSpend
        ? (!tenantHasMargPurchaseInvoices
          ? 'LOCAL_PURCHASE_ORDER_NO_MARG_INVOICE_OVERLAP'
          : 'LOCAL_PURCHASE_ORDER_EXPLICIT_MAPPING_FALLBACK')
        : (row.local_po_spend > 0 ? 'REQUIRES_EXPLICIT_MARG_MAPPING' : 'UNAVAILABLE');

      merged.set(key, {
        supplier_key: key,
        supplier_name: row.supplier_name,
        supplier_code: row.supplier_code,
        total_orders: row.total_orders,
        on_time_delivery_pct: row.on_time_delivery_pct,
        avg_lead_time_days: row.avg_lead_time_days,
        fulfillment_rate_pct: row.fulfillment_rate_pct,
        rejection_rate_pct: row.rejection_rate_pct,
        total_spend: allowLocalSpend ? row.local_po_spend : null,
        has_explicit_marg_mapping: row.has_explicit_marg_mapping,
        mapping_status: row.has_explicit_marg_mapping ? 'EXPLICIT_MARG_MAPPING' : 'LOCAL_ONLY_UNMAPPED',
        order_source: 'LOCAL_PURCHASE_ORDER',
        lead_time_source: row.avg_lead_time_days != null ? 'LOCAL_PO_GRN' : 'UNAVAILABLE',
        spend_source: spendSource,
        spend_note: !allowLocalSpend && row.local_po_spend > 0 && tenantHasMargPurchaseInvoices && !row.has_explicit_marg_mapping
          ? 'Hidden to avoid PO vs invoice double counting until this supplier is explicitly mapped to Marg.'
          : null,
        rejection_source: row.rejection_rate_pct != null ? 'LOCAL_QUALITY_INSPECTION' : 'UNAVAILABLE',
        last_activity_date: row.last_activity_date,
      });
    }

    for (const invoice of margMetrics) {
      const key = invoice.supplier_key;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          supplier_key: key,
          supplier_name: invoice.supplier_name,
          supplier_code: invoice.supplier_code,
          total_orders: invoice.purchase_invoice_count,
          on_time_delivery_pct: null,
          avg_lead_time_days: invoice.estimated_lead_time_days,
          fulfillment_rate_pct: null,
          rejection_rate_pct: null,
          total_spend: invoice.total_spend,
          has_explicit_marg_mapping: invoice.has_explicit_supplier_mapping,
          mapping_status: invoice.has_explicit_supplier_mapping ? 'EXPLICIT_MARG_MAPPING' : 'MARG_ONLY_UNMAPPED',
          order_source: 'MARG_PURCHASE_INVOICE',
          lead_time_source: invoice.estimated_lead_time_days != null ? 'MARG_PURCHASE_INVOICE_ESTIMATED' : 'UNAVAILABLE',
          spend_source: invoice.has_explicit_supplier_mapping ? 'MARG_PURCHASE_INVOICE_EXPLICIT_MAPPING' : 'MARG_PURCHASE_INVOICE_UNMAPPED',
          spend_note: invoice.has_explicit_supplier_mapping
            ? null
            : 'Separate Marg-only supplier row kept because no explicit local supplier mapping exists.',
          rejection_source: 'UNAVAILABLE',
          last_activity_date: invoice.last_invoice_date,
        });
        continue;
      }

      existing.total_spend = invoice.total_spend > 0 ? invoice.total_spend : existing.total_spend;
      existing.spend_source = invoice.total_spend > 0 ? 'MARG_PURCHASE_INVOICE_EXPLICIT_MAPPING' : existing.spend_source;
      existing.spend_note = invoice.total_spend > 0 ? null : existing.spend_note;
      existing.has_explicit_marg_mapping = existing.has_explicit_marg_mapping || invoice.has_explicit_supplier_mapping;
      existing.mapping_status = existing.has_explicit_marg_mapping ? 'EXPLICIT_MARG_MAPPING' : existing.mapping_status;
      if (existing.avg_lead_time_days == null && invoice.estimated_lead_time_days != null) {
        existing.avg_lead_time_days = invoice.estimated_lead_time_days;
        existing.lead_time_source = 'MARG_PURCHASE_INVOICE_ESTIMATED';
      }
      if (existing.total_orders === 0) {
        existing.total_orders = invoice.purchase_invoice_count;
        existing.order_source = 'MARG_PURCHASE_INVOICE';
      }
      if (!existing.last_activity_date || (invoice.last_invoice_date && invoice.last_invoice_date > existing.last_activity_date)) {
        existing.last_activity_date = invoice.last_invoice_date;
      }
    }

    const rows = Array.from(merged.values())
      .sort((left, right) => {
        const spendDelta = (right.total_spend ?? 0) - (left.total_spend ?? 0);
        if (spendDelta !== 0) return spendDelta;
        const orderDelta = right.total_orders - left.total_orders;
        if (orderDelta !== 0) return orderDelta;
        return left.supplier_name.localeCompare(right.supplier_name);
      });

    return {
      analysis,
      data: rows.slice(offset, offset + limit),
      total: rows.length,
    };
  }

  async getStockOutReport(
    tenantId: string,
    filters: StockOutFilterDto,
  ): Promise<StockOutReportResponse> {
    const analysis = await this.getProcurementDataSyncAnalysis(tenantId);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const scopeFilters: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      scopeFilters.push(Prisma.sql`il.product_id = ANY(${filters.productIds}::uuid[])`);
    }
    if (filters.locationIds?.length) {
      scopeFilters.push(Prisma.sql`il.location_id = ANY(${filters.locationIds}::uuid[])`);
    }

    const stockoutFilters: Prisma.Sql[] = [];
    if (filters.startDate) {
      stockoutFilters.push(Prisma.sql`ml.transaction_date >= ${filters.startDate}::timestamp`);
    }
    if (filters.endDate) {
      stockoutFilters.push(Prisma.sql`ml.transaction_date <= ${filters.endDate}::timestamp`);
    }

    const scopeFilterSql = scopeFilters.length
      ? Prisma.sql`AND ${Prisma.join(scopeFilters, ' AND ')}`
      : Prisma.empty;
    const stockoutFilterSql = stockoutFilters.length
      ? Prisma.sql`AND ${Prisma.join(stockoutFilters, ' AND ')}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<StockOutReportRow[]>(
      Prisma.sql`
        WITH marg_ledger AS (
          SELECT
            il.product_id,
            il.location_id,
            il.transaction_date,
            il.sequence_number,
            COALESCE(il.running_balance, 0)::float8 AS running_balance,
            LAG(COALESCE(il.running_balance, 0)::float8) OVER (
              PARTITION BY il.product_id, il.location_id
              ORDER BY il.sequence_number
            ) AS prev_balance
          FROM inventory_ledger il
          WHERE il.tenant_id = ${tenantId}::uuid
            AND il.reference_type = 'MARG_EDE'
            ${scopeFilterSql}
        ),
        stockout_starts AS (
          SELECT
            ml.product_id,
            ml.location_id,
            ml.transaction_date AS stockout_start,
            ml.sequence_number
          FROM marg_ledger ml
          WHERE ml.running_balance <= 0
            AND COALESCE(ml.prev_balance, 1) > 0
            ${stockoutFilterSql}
        ),
        stockout_periods AS (
          SELECT
            ss.product_id,
            ss.location_id,
            ss.stockout_start,
            (
              SELECT MIN(ml2.transaction_date)
              FROM marg_ledger ml2
              WHERE ml2.product_id = ss.product_id
                AND ml2.location_id = ss.location_id
                AND ml2.sequence_number > ss.sequence_number
                AND ml2.running_balance > 0
            ) AS stockout_end
          FROM stockout_starts ss
        ),
        level_snapshot AS (
          SELECT
            il.product_id,
            SUM(COALESCE(il.on_hand_qty, 0))::float8 AS current_stock
          FROM inventory_levels il
          WHERE il.tenant_id = ${tenantId}::uuid
            ${scopeFilterSql}
          GROUP BY il.product_id
        ),
        marg_level_snapshot AS (
          SELECT
            latest.product_id,
            SUM(latest.running_balance)::float8 AS marg_current_stock
          FROM (
            SELECT DISTINCT ON (il.product_id, il.location_id)
              il.product_id,
              il.location_id,
              COALESCE(il.running_balance, 0)::float8 AS running_balance
            FROM inventory_ledger il
            WHERE il.tenant_id = ${tenantId}::uuid
              AND il.reference_type = 'MARG_EDE'
              ${scopeFilterSql}
            ORDER BY il.product_id, il.location_id, il.sequence_number DESC
          ) latest
          GROUP BY latest.product_id
        )
        SELECT
          p.id AS product_id,
          p.code AS sku,
          p.name AS item_name,
          COUNT(*)::int AS stock_out_count,
          COALESCE(
            SUM(
              CASE
                WHEN sp.stockout_end IS NOT NULL
                THEN GREATEST(0, (sp.stockout_end::date - sp.stockout_start::date))
                ELSE GREATEST(0, (CURRENT_DATE - sp.stockout_start::date))
              END
            ),
            0
          )::int AS total_duration_days,
          MAX(sp.stockout_start) AS last_stock_out_date,
          COALESCE(ls.current_stock, 0)::float8 AS current_stock,
          COALESCE(mls.marg_current_stock, 0)::float8 AS marg_current_stock,
          CASE
            WHEN ABS(COALESCE(ls.current_stock, 0)::float8 - COALESCE(mls.marg_current_stock, 0)::float8) <= 0.0001
            THEN 0::float8
            ELSE (COALESCE(ls.current_stock, 0)::float8 - COALESCE(mls.marg_current_stock, 0)::float8)
          END::float8 AS current_stock_delta,
          CASE
            WHEN ABS(COALESCE(ls.current_stock, 0)::float8 - COALESCE(mls.marg_current_stock, 0)::float8) <= 0.0001
            THEN 'ALIGNED_WITH_MARG'
            ELSE 'DIVERGES_FROM_MARG'
          END AS current_stock_source
        FROM stockout_periods sp
        JOIN products p ON p.id = sp.product_id AND p.tenant_id = ${tenantId}::uuid
        LEFT JOIN level_snapshot ls ON ls.product_id = sp.product_id
        LEFT JOIN marg_level_snapshot mls ON mls.product_id = sp.product_id
        GROUP BY p.id, p.code, p.name, ls.current_stock, mls.marg_current_stock
        ORDER BY last_stock_out_date DESC NULLS LAST, stock_out_count DESC, item_name ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        WITH marg_ledger AS (
          SELECT
            il.product_id,
            il.location_id,
            il.transaction_date,
            COALESCE(il.running_balance, 0)::float8 AS running_balance,
            LAG(COALESCE(il.running_balance, 0)::float8) OVER (
              PARTITION BY il.product_id, il.location_id
              ORDER BY il.sequence_number
            ) AS prev_balance
          FROM inventory_ledger il
          WHERE il.tenant_id = ${tenantId}::uuid
            AND il.reference_type = 'MARG_EDE'
            ${scopeFilterSql}
        ),
        stockout_products AS (
          SELECT DISTINCT ml.product_id
          FROM marg_ledger ml
          WHERE ml.running_balance <= 0
            AND COALESCE(ml.prev_balance, 1) > 0
            ${stockoutFilterSql}
        )
        SELECT COUNT(*)::bigint AS cnt FROM stockout_products
      `,
    );

    return {
      analysis,
      data: rows,
      total: Number(countResult[0]?.cnt ?? 0),
    };
  }

  private async getLocalSupplierPerformanceMetrics(
    tenantId: string,
    filters: SupplierPerformanceFilterDto,
  ): Promise<LocalSupplierPerformanceMetric[]> {
    const extraConds: Prisma.Sql[] = [];
    if (filters.supplierIds?.length) {
      extraConds.push(Prisma.sql`po.supplier_id = ANY(${filters.supplierIds}::uuid[])`);
    }
    if (filters.startDate) {
      extraConds.push(Prisma.sql`po.order_date >= ${filters.startDate}::date`);
    }
    if (filters.endDate) {
      extraConds.push(Prisma.sql`po.order_date <= ${filters.endDate}::date`);
    }

    const baseCond = Prisma.sql`po.tenant_id = ${tenantId}::uuid AND po.status NOT IN ('CANCELLED', 'DRAFT')`;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;

    return this.prisma.$queryRaw<LocalSupplierPerformanceMetric[]>(
      Prisma.sql`
        WITH filtered_pos AS (
          SELECT *
          FROM purchase_orders po
          WHERE ${where}
        ),
        po_line_rollup AS (
          SELECT
            pol.purchase_order_id,
            SUM(COALESCE(pol.quantity, 0))::float8 AS ordered_qty
          FROM purchase_order_lines pol
          JOIN filtered_pos po ON po.id = pol.purchase_order_id
          GROUP BY pol.purchase_order_id
        ),
        receipt_rollup AS (
          SELECT
            po.id AS purchase_order_id,
            MIN(gr.receipt_date) FILTER (WHERE gr.status = 'POSTED') AS first_receipt_date,
            SUM(COALESCE(grl.quantity, 0)) FILTER (WHERE gr.status = 'POSTED')::float8 AS received_qty
          FROM filtered_pos po
          LEFT JOIN goods_receipts gr ON gr.purchase_order_id = po.id
          LEFT JOIN goods_receipt_lines grl ON grl.goods_receipt_id = gr.id
          GROUP BY po.id
        ),
        quality_rollup AS (
          SELECT
            po.supplier_id,
            SUM(COALESCE(qi.inspected_qty, 0))::float8 AS inspected_qty,
            SUM(COALESCE(qi.rejected_qty, 0))::float8 AS rejected_qty
          FROM filtered_pos po
          JOIN quality_inspections qi ON qi.purchase_order_id = po.id
          WHERE qi.tenant_id = ${tenantId}::uuid
          GROUP BY po.supplier_id
        )
        SELECT
          s.id AS supplier_id,
          s.code AS supplier_code,
          s.name AS supplier_name,
          COUNT(DISTINCT po.id)::int AS total_orders,
          CASE
            WHEN COUNT(DISTINCT CASE WHEN rr.first_receipt_date IS NOT NULL AND po.expected_date IS NOT NULL THEN po.id END) > 0
            THEN (
              COUNT(DISTINCT CASE
                WHEN rr.first_receipt_date IS NOT NULL
                  AND po.expected_date IS NOT NULL
                  AND rr.first_receipt_date::date <= po.expected_date::date
                THEN po.id
              END)::float8
              /
              COUNT(DISTINCT CASE WHEN rr.first_receipt_date IS NOT NULL AND po.expected_date IS NOT NULL THEN po.id END)::float8
            ) * 100
            ELSE NULL
          END::float8 AS on_time_delivery_pct,
          AVG(
            CASE
              WHEN rr.first_receipt_date IS NOT NULL
              THEN GREATEST((rr.first_receipt_date::date - po.order_date::date), 0)
              ELSE NULL
            END
          )::float8 AS avg_lead_time_days,
          CASE
            WHEN SUM(COALESCE(pl.ordered_qty, 0)) > 0
            THEN (
              LEAST(SUM(COALESCE(rr.received_qty, 0)), SUM(COALESCE(pl.ordered_qty, 0)))
              /
              SUM(COALESCE(pl.ordered_qty, 0))
            ) * 100
            ELSE NULL
          END::float8 AS fulfillment_rate_pct,
          CASE
            WHEN COALESCE(MAX(qr.inspected_qty), 0) > 0
            THEN (MAX(qr.rejected_qty) / MAX(qr.inspected_qty)) * 100
            ELSE NULL
          END::float8 AS rejection_rate_pct,
          BOOL_OR(
            (s.external_id IS NOT NULL AND s.external_id LIKE 'marg:%')
            OR COALESCE(s.attributes->>'margCid', '') <> ''
          ) AS has_explicit_marg_mapping,
          COALESCE(SUM(COALESCE(po.total_amount, 0)), 0)::float8 AS local_po_spend,
          MAX(COALESCE(rr.first_receipt_date, po.order_date)) AS last_activity_date
        FROM filtered_pos po
        JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = ${tenantId}::uuid
        LEFT JOIN po_line_rollup pl ON pl.purchase_order_id = po.id
        LEFT JOIN receipt_rollup rr ON rr.purchase_order_id = po.id
        LEFT JOIN quality_rollup qr ON qr.supplier_id = s.id
        GROUP BY s.id, s.code, s.name
      `,
    );
  }

  private async getMargSupplierInvoiceMetrics(
    tenantId: string,
    filters: SupplierPerformanceFilterDto,
  ): Promise<MargSupplierInvoiceMetric[]> {
    const extraConds: Prisma.Sql[] = [];
    if (filters.startDate) {
      extraConds.push(Prisma.sql`mv.date >= ${filters.startDate}::date`);
    }
    if (filters.endDate) {
      extraConds.push(Prisma.sql`mv.date <= ${filters.endDate}::date`);
    }

    const baseCond = Prisma.sql`mv.tenant_id = ${tenantId}::uuid AND mv.type = 'P'`;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;
    const supplierFilterSql = filters.supplierIds?.length
      ? Prisma.sql`WHERE invoice_rollup.mapped_supplier_id = ANY(${filters.supplierIds}::uuid[])`
      : Prisma.empty;

    return this.prisma.$queryRaw<MargSupplierInvoiceMetric[]>(
      Prisma.sql`
        WITH invoice_base AS (
          SELECT
            CASE
              WHEN supplier_map.id IS NOT NULL THEN CONCAT('supplier:', supplier_map.id::text)
              ELSE CONCAT('marg:', mv.company_id::text, ':', COALESCE(NULLIF(mv.cid, ''), 'unknown'))
            END AS supplier_key,
            supplier_map.id AS mapped_supplier_id,
            COALESCE(supplier_map.code, NULLIF(mv.cid, '')) AS supplier_code,
            COALESCE(supplier_map.name, NULLIF(mp.par_name, ''), NULLIF(mv.cid, ''), 'Unknown Marg Supplier') AS supplier_name,
            mv.voucher,
            mv.date AS invoice_date,
            mv.o_date,
            COALESCE(mv.final_amt, invoice_lines.invoice_amount, 0)::float8 AS invoice_amount
          FROM marg_vouchers mv
          LEFT JOIN marg_parties mp
            ON mp.tenant_id = mv.tenant_id
            AND mp.company_id = mv.company_id
            AND mp.cid = mv.cid
          LEFT JOIN LATERAL (
            SELECT
              SUM(ABS(COALESCE(mt.amount, 0)))::float8 AS invoice_amount
            FROM marg_transactions mt
            WHERE mt.tenant_id = mv.tenant_id
              AND mt.company_id = mv.company_id
              AND mt.voucher = mv.voucher
              AND mt.type = mv.type
          ) invoice_lines ON TRUE
          LEFT JOIN LATERAL (
            SELECT s.id, s.code, s.name
            FROM suppliers s
            WHERE s.tenant_id = mv.tenant_id
              AND (
                s.external_id = CONCAT('marg:', mv.company_id::text, ':', COALESCE(mv.cid, ''))
                OR (
                  COALESCE(s.attributes->>'margCid', '') = COALESCE(mv.cid, '')
                  AND (
                    COALESCE(s.attributes->>'margCompanyId', '') = ''
                    OR COALESCE(s.attributes->>'margCompanyId', '') = mv.company_id::text
                  )
                )
              )
            ORDER BY
              CASE
                WHEN s.external_id = CONCAT('marg:', mv.company_id::text, ':', COALESCE(mv.cid, '')) THEN 1
                WHEN COALESCE(s.attributes->>'margCid', '') = COALESCE(mv.cid, '') THEN 2
                ELSE 3
              END,
              s.created_at ASC
            LIMIT 1
          ) supplier_map ON TRUE
          WHERE ${where}
        ),
        invoice_rollup AS (
          SELECT
            supplier_key,
            mapped_supplier_id,
            supplier_code,
            supplier_name,
            COUNT(DISTINCT voucher)::int AS purchase_invoice_count,
            SUM(invoice_amount)::float8 AS total_spend,
            AVG(
              CASE
                WHEN o_date IS NOT NULL
                THEN GREATEST((invoice_date::date - o_date::date), 0)
                ELSE NULL
              END
            )::float8 AS estimated_lead_time_days,
            BOOL_OR(mapped_supplier_id IS NOT NULL) AS has_explicit_supplier_mapping,
            BOOL_OR(o_date IS NOT NULL) AS has_order_date_fallback,
            MAX(invoice_date) AS last_invoice_date
          FROM invoice_base
          GROUP BY supplier_key, mapped_supplier_id, supplier_code, supplier_name
        )
        SELECT *
        FROM invoice_rollup
        ${supplierFilterSql}
      `,
    );
  }

  private async countRows(query: Prisma.Sql): Promise<number> {
    const result = await this.prisma.$queryRaw<[{ cnt: bigint }]>(query);
    return Number(result[0]?.cnt ?? 0);
  }
}
