// ============================================================================
// PROCUREMENT / ORDERING REPORTS SERVICE
// Covers: Suggested Purchase, Supplier Performance, Stock-Out Detection
// ============================================================================

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  StockOutFilterDto,
  SuggestedPurchaseFilterDto,
  SupplierPerformanceFilterDto
} from '../dto';
import {
    AllowedSqlColumns,
    buildPharmaFilterSql,
    buildPharmaOrderBySql,
    PharmaColumnFilter,
    PharmaFieldType,
    parsePharmaFilters,
} from '../pharma-filter.helper';

// Suggested Purchase shares the Reorder engine: everything is computed in a CTE
// (`sp`) and the outer SELECT reads bare column names, so these expressions are
// plain output-column names (valid in the outer WHERE / ORDER BY).
const SUGGESTED_PURCHASE_COLUMNS: AllowedSqlColumns = {
  sku: { expression: 'sku', type: 'string' },
  product_name: { expression: 'product_name', type: 'string' },
  location_code: { expression: 'location_code', type: 'string' },
  current_stock: { expression: 'current_stock', type: 'number' },
  available_stock: { expression: 'available_stock', type: 'number' },
  on_order_qty: { expression: 'on_order_qty', type: 'number' },
  avg_daily_demand: { expression: 'avg_daily_demand', type: 'number' },
  lead_time_days: { expression: 'lead_time_days', type: 'number' },
  safety_stock: { expression: 'safety_stock', type: 'number' },
  reorder_point: { expression: 'reorder_point', type: 'number' },
  demand_during_lead_time: { expression: 'demand_during_lead_time', type: 'number' },
  suggested_purchase_qty: { expression: 'suggested_purchase_qty', type: 'number' },
  estimated_cost: { expression: 'estimated_cost', type: 'number' },
  abc_class: { expression: 'abc_class', type: 'string' },
};

const SUPPLIER_PERFORMANCE_COLUMNS: AllowedSqlColumns = {
  supplier_code: { expression: 's.code', type: 'string' },
  supplier_name: { expression: 's.name', type: 'string' },
  quality_rating: { expression: 's.quality_rating', type: 'number' },
};

const STOCKOUT_COLUMNS: AllowedSqlColumns = {
  sku: { expression: 'p.code', type: 'string' },
  product_name: { expression: 'p.name', type: 'string' },
  location_code: { expression: 'l.code', type: 'string' },
  is_currently_out: { expression: 'so.is_currently_out', type: 'boolean' },
  stockout_start: { expression: 'so.stockout_start', type: 'date' },
};

const SUPPLIER_PERFORMANCE_REPORT_FILTER_TYPES: Record<string, PharmaFieldType> = {
  supplier_key: 'string',
  supplier_code: 'string',
  supplier_name: 'string',
  total_orders: 'number',
  purchase_invoice_count: 'number',
  on_time_delivery_pct: 'number',
  avg_lead_time_days: 'number',
  fulfillment_rate_pct: 'number',
  rejection_rate_pct: 'number',
  total_spend: 'number',
  has_explicit_marg_mapping: 'boolean',
  mapping_status: 'enum',
  order_source: 'string',
  spend_source: 'string',
  last_activity_date: 'date',
};

const SUPPLIER_PO_DETAIL_COLUMNS: AllowedSqlColumns = {
  document_number: { expression: 'd.document_number', type: 'string' },
  document_date: { expression: 'd.document_date', type: 'date' },
  expected_date: { expression: 'd.expected_date', type: 'date' },
  supplier_code: { expression: 'd.supplier_code', type: 'string' },
  supplier_name: { expression: 'd.supplier_name', type: 'string' },
  status: { expression: 'd.status', type: 'enum' },
  total_amount: { expression: 'd.total_amount', type: 'number' },
  currency: { expression: 'd.currency', type: 'string' },
  line_count: { expression: 'd.line_count', type: 'number' },
  ordered_qty: { expression: 'd.ordered_qty', type: 'number' },
  received_qty: { expression: 'd.received_qty', type: 'number' },
  pending_qty: { expression: 'd.pending_qty', type: 'number' },
};

const SUPPLIER_PI_DETAIL_COLUMNS: AllowedSqlColumns = {
  document_number: { expression: 'd.document_number', type: 'string' },
  document_date: { expression: 'd.document_date', type: 'date' },
  order_date: { expression: 'd.order_date', type: 'date' },
  company_id: { expression: 'd.company_id', type: 'number' },
  voucher: { expression: 'd.voucher', type: 'string' },
  vcn: { expression: 'd.vcn', type: 'string' },
  orn: { expression: 'd.orn', type: 'string' },
  supplier_code: { expression: 'd.supplier_code', type: 'string' },
  supplier_name: { expression: 'd.supplier_name', type: 'string' },
  status: { expression: 'd.status', type: 'enum' },
  total_amount: { expression: 'd.total_amount', type: 'number' },
  currency: { expression: 'd.currency', type: 'string' },
  line_count: { expression: 'd.line_count', type: 'number' },
  total_qty: { expression: 'd.total_qty', type: 'number' },
};

const MARG_PURCHASE_ORDER_PREFIX = 'MARG-PO-';
const MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX = 'MARG-PIF-';
const MARG_GOODS_RECEIPT_PREFIX = 'MARG-GRN-';
const MARG_EXPECTED_DATE_UNKNOWN_MARKER = '[MARG_EXPECTED_DATE_UNKNOWN]';
const MARG_ORDER_DATE_UNKNOWN_MARKER = '[MARG_ORDER_DATE_UNKNOWN]';
const MARG_SYNC_GOODS_RECEIPT_MARKER = '[MARG_SYNC_GRN]';
const MARG_MIN_VALID_ORDER_DATE = '1901-01-01';

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
  purchase_invoice_count: number;
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

export interface SupplierPerformancePurchaseOrderDetailRow {
  id: string;
  document_number: string;
  document_date: Date;
  expected_date: Date | null;
  supplier_id: string;
  supplier_code: string | null;
  supplier_name: string;
  status: string;
  total_amount: number;
  currency: string;
  line_count: number;
  ordered_qty: number;
  received_qty: number;
  pending_qty: number;
  source: 'LOCAL_PURCHASE_ORDER';
  open_path: string;
}

export interface SupplierPerformancePurchaseInvoiceDetailRow {
  id: string;
  supplier_key: string;
  company_id: number;
  document_number: string;
  document_date: Date;
  order_date: Date | null;
  voucher: string;
  vcn: string | null;
  orn: string | null;
  supplier_id: string | null;
  supplier_code: string | null;
  supplier_name: string;
  status: 'POSTED';
  total_amount: number;
  currency: string;
  line_count: number;
  total_qty: number;
  source: 'CORE_PURCHASE_INVOICE_GRN';
  open_path: string;
}

type SupplierPerformanceDetailResponse<T> = {
  data: T[];
  total: number;
};

type SupplierKey =
  | { kind: 'local'; supplierId: string }
  | { kind: 'marg'; companyId: number; cid: string };

interface LocalSupplierPerformanceMetric {
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  total_orders: number;
  purchase_invoice_count: number;
  on_time_delivery_pct: number | null;
  avg_lead_time_days: number | null;
  fulfillment_rate_pct: number | null;
  rejection_rate_pct: number | null;
  has_explicit_marg_mapping: boolean;
  local_po_spend: number;
  last_activity_date: Date | null;
}

@Injectable()
export class ProcurementReportsService {
  private readonly logger = new Logger(ProcurementReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // A. SUGGESTED PURCHASE
  //
  // Shares the exact engine as the inventory Reorder report (getReorderReport)
  // so the two screens never disagree, then enriches each row with the
  // procurement-only columns (preferred supplier, estimated cost).
  //
  //   Avg Daily Demand = NET sales from `actuals` (ActualType=SALES) / lookback
  //                      — excludes challans / transfers / replacements that raw
  //                        inventory ISSUE would over-count.
  //   Order-up-to      = Avg Daily Demand × (lead time + coverage) + safety stock
  //   Need             = MAX(0, order-up-to − on hand − on order)
  //   Suggested Qty    = need, then policy lot logic applied:
  //                      reorder lot → min-order → pack multiple → max-order → ceil
  //   Estimated Cost   = suggested qty × COALESCE(average_cost, standard_cost)
  //
  // Gating (mirrors Reorder): ACTIVE products only, and suggested_qty > 0 — which
  // keeps fees / non-stock / discontinued items out of the suggestion list.
  //
  // Edge cases:
  //   • No sales history → avg daily demand 0 → suggested qty driven by safety only
  //   • No policy → lead time = leadTimeDays default, safety = safetyDays × demand
  //   • Already sufficient stock → suggested qty 0 → excluded by the gate
  // ─────────────────────────────────────────────────────────────────────────
  async getSuggestedPurchase(
    tenantId: string,
    filters: SuggestedPurchaseFilterDto,
  ): Promise<{ data: SuggestedPurchaseRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    // Same horizon controls as the inventory Reorder report (keeps the two
    // screens consistent).
    const lookbackDays = Math.max(1, filters.lookbackDays ?? 90);
    const coverageDays = Math.max(1, filters.coverageDays ?? 30);
    const leadTimeDays = Math.max(0, filters.leadTimeDays ?? 7);
    const safetyDays = Math.max(0, filters.safetyDays ?? 7);

    // Inner (CTE-level) filters operate on base tables.
    const innerConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) innerConds.push(Prisma.sql`il.product_id = ANY(${filters.productIds}::uuid[])`);
    if (filters.locationIds?.length) innerConds.push(Prisma.sql`il.location_id = ANY(${filters.locationIds}::uuid[])`);
    if (filters.category) innerConds.push(Prisma.sql`p.category = ${filters.category}`);
    const innerWhere = innerConds.length ? Prisma.sql`AND ${Prisma.join(innerConds, ' AND ')}` : Prisma.empty;

    // Outer filters/sort operate on the computed `sp` columns (bare names).
    const columnFilters = parsePharmaFilters(filters.filters);
    const filterConds = buildPharmaFilterSql(columnFilters, SUGGESTED_PURCHASE_COLUMNS);
    const filterWhere = filterConds.length ? Prisma.sql`AND ${Prisma.join(filterConds, ' AND ')}` : Prisma.empty;

    const orderBy = buildPharmaOrderBySql(
      filters.sortBy, filters.sortDir, SUGGESTED_PURCHASE_COLUMNS,
      Prisma.sql`CASE abc_class WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
                 suggested_purchase_qty DESC`,
    );

    // Demand, gating and order policy mirror getReorderReport():
    //   • Demand = NET sales from `actuals` (ActualType=SALES) — excludes
    //     challans / transfers / replacements that raw inventory ISSUE includes.
    //   • Only ACTIVE products (no discontinued/inactive SKUs).
    //   • Full policy lot logic: reorder lot, min-order, pack multiple, max-order,
    //     order-up-to over (lead time + coverage).
    //   • Gate `suggested_purchase_qty > 0` suppresses fees / non-stock noise.
    // Enriched with the procurement-only columns: preferred supplier + estimated cost.
    const cte = Prisma.sql`
      WITH demand AS (
        SELECT a.product_id, a.location_id,
          GREATEST(COALESCE(SUM(a.quantity), 0), 0)::float8 / ${lookbackDays}::float8 AS avg_daily_demand
        FROM actuals a
        WHERE a.tenant_id = ${tenantId}::uuid
          AND a.actual_type = 'SALES'::"ActualType"
          AND a.period_date >= (CURRENT_DATE - ${lookbackDays}::int)
        GROUP BY a.product_id, a.location_id
      ),
      on_order AS (
        SELECT pol.product_id, po.location_id,
          COALESCE(SUM(GREATEST(pol.quantity - pol.received_qty, 0)), 0)::float8 AS on_order_qty
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.purchase_order_id AND po.tenant_id = ${tenantId}::uuid
        WHERE po.status NOT IN ('DRAFT', 'CLOSED', 'CANCELLED')
        GROUP BY pol.product_id, po.location_id
      ),
      preferred_supplier AS (
        SELECT DISTINCT ON (pol.product_id)
          pol.product_id, s.name AS supplier_name
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.purchase_order_id
        JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.tenant_id = ${tenantId}::uuid
          AND po.status NOT IN ('CANCELLED', 'DRAFT')
        ORDER BY pol.product_id, po.order_date DESC
      ),
      base AS (
        SELECT
          p.id AS product_id, p.code AS sku, p.name AS product_name,
          l.id AS location_id, l.code AS location_code, ip.abc_class,
          COALESCE(il.on_hand_qty, 0)::float8 AS on_hand_qty,
          COALESCE(il.available_qty, 0)::float8 AS available_qty,
          COALESCE(oo.on_order_qty, 0)::float8 AS on_order_qty,
          COALESCE(d.avg_daily_demand, 0)::float8 AS avg_daily_sales,
          COALESCE(NULLIF(ip.lead_time_days, 0), ${leadTimeDays})::float8 AS lead_time_days,
          COALESCE(ip.safety_stock_qty, COALESCE(ip.safety_stock_days, ${safetyDays})::float8 * COALESCE(d.avg_daily_demand, 0))::float8 AS safety_stock_qty,
          COALESCE(il.average_cost, p.standard_cost, 0)::float8 AS unit_cost_src,
          ip.reorder_point::float8 AS cfg_reorder_point,
          ip.reorder_qty::float8 AS cfg_reorder_qty,
          ip.min_order_qty::float8 AS cfg_min_order,
          ip.multiple_order_qty::float8 AS cfg_multiple,
          ip.max_order_qty::float8 AS cfg_max_order
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id AND p.status = 'ACTIVE'::"DimensionStatus"
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN inventory_policies ip ON ip.tenant_id = il.tenant_id AND ip.product_id = il.product_id AND ip.location_id = il.location_id
        LEFT JOIN demand d ON d.product_id = il.product_id AND d.location_id = il.location_id
        LEFT JOIN on_order oo ON oo.product_id = il.product_id AND oo.location_id = il.location_id
        WHERE il.tenant_id = ${tenantId}::uuid ${innerWhere}
      ),
      calc AS (
        SELECT base.*,
          COALESCE(cfg_reorder_point, avg_daily_sales * lead_time_days + safety_stock_qty)::float8 AS reorder_point,
          GREATEST(
            (avg_daily_sales * (lead_time_days + ${coverageDays}::float8) + safety_stock_qty)
            - on_hand_qty - on_order_qty, 0
          )::float8 AS need_raw
        FROM base
      ),
      r1 AS (
        SELECT calc.*,
          CASE WHEN cfg_reorder_qty IS NOT NULL AND cfg_reorder_qty > 0 AND need_raw > 0
               THEN cfg_reorder_qty ELSE need_raw END::float8 AS s1
        FROM calc
      ),
      r2 AS (
        SELECT r1.*,
          CASE WHEN s1 > 0 THEN GREATEST(s1, COALESCE(cfg_min_order, 0)) ELSE 0 END::float8 AS s2
        FROM r1
      ),
      r3 AS (
        SELECT r2.*,
          CASE WHEN cfg_multiple IS NOT NULL AND cfg_multiple > 0 AND s2 > 0
               THEN CEIL(s2 / cfg_multiple) * cfg_multiple ELSE s2 END::float8 AS s3
        FROM r2
      ),
      rr AS (
        SELECT r3.*,
          CEIL(
            CASE WHEN cfg_max_order IS NOT NULL AND cfg_max_order > 0 THEN LEAST(s3, cfg_max_order) ELSE s3 END
          )::float8 AS suggested_order_qty
        FROM r3
      ),
      sp AS (
        SELECT
          rr.product_id, rr.sku, rr.product_name, rr.location_id, rr.location_code,
          rr.on_hand_qty           AS current_stock,
          rr.available_qty         AS available_stock,
          rr.on_order_qty,
          rr.avg_daily_sales       AS avg_daily_demand,
          rr.lead_time_days,
          rr.safety_stock_qty      AS safety_stock,
          rr.reorder_point,
          (rr.avg_daily_sales * rr.lead_time_days)::float8 AS demand_during_lead_time,
          rr.suggested_order_qty   AS suggested_purchase_qty,
          rr.abc_class,
          ps.supplier_name         AS preferred_supplier,
          (rr.suggested_order_qty * rr.unit_cost_src)::float8 AS estimated_cost
        FROM rr
        LEFT JOIN preferred_supplier ps ON ps.product_id = rr.product_id
      )
    `;

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(Prisma.sql`
      ${cte}
      SELECT COUNT(*)::bigint AS cnt FROM sp WHERE suggested_purchase_qty > 0 ${filterWhere}
    `);

    const rows = await this.prisma.$queryRaw<SuggestedPurchaseRow[]>(Prisma.sql`
      ${cte}
      SELECT
        product_id, sku, product_name, location_id, location_code,
        current_stock, available_stock, on_order_qty, avg_daily_demand,
        lead_time_days, safety_stock, reorder_point, demand_during_lead_time,
        suggested_purchase_qty, abc_class, preferred_supplier, estimated_cost
      FROM sp
      WHERE suggested_purchase_qty > 0 ${filterWhere}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `);

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
    if (filters.status) {
      extraConds.push(Prisma.sql`po.status::text = ${filters.status}`);
    }
    if (filters.companyId !== undefined && filters.companyId !== null) {
      const companyId = Number(filters.companyId);
      extraConds.push(Prisma.sql`po.order_number LIKE ${`${MARG_PURCHASE_ORDER_PREFIX}${companyId}-%`}`);
    }

    // Match the supplier-performance report's PO scoping: synthesized fallback
    // POs (`MARG-PIF-…`) inflate the order count and confuse users comparing
    // against Marg, so they are excluded unless the caller explicitly asks.
    const fallbackPoMatch = `${MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX}%`;
    const includeFallback = (filters as any).includeFallbackPurchaseOrders === true
      || (filters as any).includeFallbackPurchaseOrders === 'true';
    if (!includeFallback) {
      extraConds.push(Prisma.sql`COALESCE(po.order_number, '') NOT LIKE ${fallbackPoMatch}`);
    }

    const baseCond = Prisma.sql`po.tenant_id = ${tenantId}::uuid AND po.status != 'CANCELLED'`;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;
    const hasExpectedDateMarker = `%${MARG_EXPECTED_DATE_UNKNOWN_MARKER}%`;
    const hasUnknownOrderDateMarker = `%${MARG_ORDER_DATE_UNKNOWN_MARKER}%`;

    // Column-level filters apply to the outermost SELECT (post-aggregation suppliers)
    const columnFilters = parsePharmaFilters(filters.filters);
    const supplierFilterConds = buildPharmaFilterSql(columnFilters, SUPPLIER_PERFORMANCE_COLUMNS);
    const supplierFilterClause = supplierFilterConds.length
      ? Prisma.sql`AND ${Prisma.join(supplierFilterConds, ' AND ')}`
      : Prisma.empty;
    const supplierOrderBy = buildPharmaOrderBySql(
      filters.sortBy, filters.sortDir, SUPPLIER_PERFORMANCE_COLUMNS,
      Prisma.sql`on_time_pct DESC, avg_lead_time_days ASC`,
    );

    const rows = await this.prisma.$queryRaw<SupplierPerformanceRow[]>(
      Prisma.sql`
        WITH po_receipts AS (
          SELECT
            po.id AS po_id,
            po.supplier_id,
            po.order_date,
            po.expected_date,
            po.notes AS po_notes,
            po.total_amount,
            po.status,
            MIN(gr.receipt_date) AS first_receipt_date
          FROM purchase_orders po
          LEFT JOIN goods_receipts gr
            ON gr.purchase_order_id = po.id
            AND gr.status = 'POSTED'
          WHERE ${where}
          GROUP BY po.id, po.supplier_id, po.order_date, po.expected_date, po.notes, po.total_amount, po.status
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
                AND COALESCE(pr.po_notes, '') NOT LIKE ${hasUnknownOrderDateMarker}
              THEN (pr.first_receipt_date::date - pr.order_date::date)
              ELSE NULL END
            ), 0
          )::float8 AS avg_lead_time_days,
          COALESCE(
            MIN(
              CASE WHEN pr.first_receipt_date IS NOT NULL
                AND COALESCE(pr.po_notes, '') NOT LIKE ${hasUnknownOrderDateMarker}
              THEN (pr.first_receipt_date::date - pr.order_date::date)
              ELSE NULL END
            ), 0
          )::float8 AS min_lead_time_days,
          COALESCE(
            MAX(
              CASE WHEN pr.first_receipt_date IS NOT NULL
                AND COALESCE(pr.po_notes, '') NOT LIKE ${hasUnknownOrderDateMarker}
              THEN (pr.first_receipt_date::date - pr.order_date::date)
              ELSE NULL END
            ), 0
          )::float8 AS max_lead_time_days,
          COUNT(
            CASE
              WHEN pr.first_receipt_date IS NOT NULL
                AND pr.expected_date IS NOT NULL
                AND COALESCE(pr.po_notes, '') NOT LIKE ${hasExpectedDateMarker}
                AND pr.first_receipt_date::date <= pr.expected_date::date
              THEN 1
            END
          )::int AS on_time_count,
          CASE
            WHEN COUNT(
              CASE
                WHEN pr.first_receipt_date IS NOT NULL
                  AND pr.expected_date IS NOT NULL
                  AND COALESCE(pr.po_notes, '') NOT LIKE ${hasExpectedDateMarker}
                THEN 1
              END
            ) > 0
            THEN (
              COUNT(
                CASE
                  WHEN pr.first_receipt_date IS NOT NULL
                    AND pr.expected_date IS NOT NULL
                    AND COALESCE(pr.po_notes, '') NOT LIKE ${hasExpectedDateMarker}
                    AND pr.first_receipt_date::date <= pr.expected_date::date
                  THEN 1
                END
              )::float8
              /
              COUNT(
                CASE
                  WHEN pr.first_receipt_date IS NOT NULL
                    AND pr.expected_date IS NOT NULL
                    AND COALESCE(pr.po_notes, '') NOT LIKE ${hasExpectedDateMarker}
                  THEN 1
                END
              )::float8 * 100
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
          ${supplierFilterClause}
        GROUP BY s.id, s.code, s.name, s.quality_rating
        HAVING COUNT(pr.po_id) > 0
        ORDER BY ${supplierOrderBy}
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
          ${supplierFilterClause}
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

    // Column-level filters applied at outer SELECT (after stockouts CTE)
    const columnFilters = parsePharmaFilters(filters.filters);
    const stockoutFilterConds = buildPharmaFilterSql(columnFilters, STOCKOUT_COLUMNS);
    const stockoutFilterClause = stockoutFilterConds.length
      ? Prisma.sql`WHERE ${Prisma.join(stockoutFilterConds, ' AND ')}`
      : Prisma.empty;
    const stockoutOrderBy = buildPharmaOrderBySql(
      filters.sortBy, filters.sortDir, STOCKOUT_COLUMNS,
      Prisma.sql`so.is_currently_out DESC, so.stockout_start DESC`,
    );

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
        ${stockoutFilterClause}
        ORDER BY ${stockoutOrderBy}
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
            ) AS prev_balance,
            LEAD(il.running_balance) OVER (
              PARTITION BY il.product_id, il.location_id
              ORDER BY il.sequence_number
            ) AS next_balance
          FROM inventory_ledger il
          WHERE il.tenant_id = ${tenantId}::uuid
        ),
        stockouts AS (
          SELECT
            sub.product_id, sub.location_id, sub.transaction_date AS stockout_start,
            CASE WHEN sub.next_balance IS NULL OR sub.next_balance <= 0 THEN true ELSE false END AS is_currently_out
          FROM balance_transitions sub
          WHERE sub.running_balance <= 0
            AND (sub.prev_balance IS NULL OR sub.prev_balance > 0)
            ${filterSql}
        )
        SELECT COUNT(*)::bigint AS cnt
        FROM stockouts so
        JOIN products p  ON p.id = so.product_id
        JOIN locations l ON l.id = so.location_id
        ${stockoutFilterClause}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  async getProcurementDataSyncAnalysis(tenantId: string): Promise<ProcurementDataSyncAnalysis> {
    const [
      localPurchaseOrders,
      margProjectedPurchaseOrders,
      margFallbackPurchaseOrders,
      margSourcePurchaseOrders,
      localGoodsReceipts,
      margProjectedGoodsReceipts,
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
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM purchase_orders WHERE tenant_id = ${tenantId}::uuid AND order_number LIKE ${`${MARG_PURCHASE_ORDER_PREFIX}%`}`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM purchase_orders WHERE tenant_id = ${tenantId}::uuid AND order_number LIKE ${`${MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX}%`}`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM marg_vouchers WHERE tenant_id = ${tenantId}::uuid AND type = 'X'`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM goods_receipts WHERE tenant_id = ${tenantId}::uuid`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM goods_receipts WHERE tenant_id = ${tenantId}::uuid AND receipt_number LIKE ${`${MARG_GOODS_RECEIPT_PREFIX}%`}`),
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
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM marg_vouchers WHERE tenant_id = ${tenantId}::uuid AND type = 'P' AND o_date > ${MARG_MIN_VALID_ORDER_DATE}::date`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM inventory_transactions WHERE tenant_id = ${tenantId}::uuid AND reference_type = 'MARG_EDE'`),
      this.countRows(Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM inventory_ledger WHERE tenant_id = ${tenantId}::uuid AND reference_type = 'MARG_EDE'`),
    ]);

    return {
      purchaseOrders: {
        syncedFromMarg: margProjectedPurchaseOrders > 0 || margFallbackPurchaseOrders > 0,
        margRecordCount: margSourcePurchaseOrders,
        localRecordCount: localPurchaseOrders,
        tables: ['purchase_orders', 'purchase_order_lines'],
        notes: [
          `${margProjectedPurchaseOrders} local purchase orders are projected directly from ${margSourcePurchaseOrders} Marg type X purchase-order vouchers.`,
          `${margFallbackPurchaseOrders} fallback purchase orders were synthesized from purchase invoices that could not be linked to a synced Marg purchase order by ORN.`,
        ],
      },
      purchaseInvoices: {
        syncedFromMarg: margPurchaseInvoices > 0,
        margRecordCount: margPurchaseInvoices,
        localRecordCount: 0,
        tables: ['marg_vouchers', 'marg_transactions', 'actuals'],
        notes: [
          'Marg voucher type P is treated as purchase invoice spend.',
          `${mappedMargPurchaseInvoices} of ${margPurchaseInvoices} synced purchase invoices can currently be attributed through explicit supplier mapping; ${margPurchaseInvoicesWithOrderDate} carry a valid Marg ODate for lead-time fallback after excluding the 1900 placeholder date.`,
        ],
      },
      goodsReceipts: {
        syncedFromMarg: margProjectedGoodsReceipts > 0,
        margRecordCount: margPurchaseInvoices,
        localRecordCount: localGoodsReceipts,
        tables: ['goods_receipts', 'goods_receipt_lines', 'inventory_transactions'],
        notes: [
          `${margProjectedGoodsReceipts} posted local GRNs are projected from ${margPurchaseInvoices} Marg purchase invoices.`,
          `Exact partial-delivery math now comes from those projected GRNs plus any ${localQualityInspections} linked quality inspections; invoice-only rows without a linked Marg PO get a synthesized fallback PO so fulfillment remains PO/GRN-driven.`,
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
        supplierPerformanceMetrics: 'Local purchase_orders + posted goods_receipts + quality_inspections remain authoritative for OTIF, fulfillment, rejection, and exact lead time; Marg sync now materializes purchase_orders and posted goods_receipts locally so supplier performance is PO/GRN-driven for synced procurement documents.',
        leadTimeCalculation: 'Exact lead time is computed from local purchase_orders.order_date to the first posted goods_receipt when the order date is known. On-time delivery is computed only when a trustworthy expected date exists; Marg-synced rows marked with unknown expected dates are intentionally excluded.',
        spendCalculation: 'Marg purchase invoices (marg_vouchers.type = P) are used only through explicit supplier mapping. Local PO spend is shown only when there is no Marg invoice overlap risk or when an explicitly mapped supplier has no invoice in the filtered window.',
      },
      risks: [
        'Supplier spend no longer uses heuristic code/name joins; unmapped Marg suppliers remain isolated until an explicit externalId or attributes.margCid mapping is configured.',
        'On-time delivery is intentionally blank for Marg-synced POs unless a trustworthy promised/expected date exists; the sync currently marks placeholder dates as unavailable instead of inventing OTIF.',
        'Fulfillment rate is intentionally computed only from local PO/GRN lifecycle data; Marg invoices do not fabricate partial-delivery events.',
        'Current stock now carries a live-vs-Marg delta so manual inventory adjustments cannot silently distort Marg-only stock-out history.',
        `${mappedSuppliers} of ${totalSuppliers} suppliers currently advertise explicit Marg mapping metadata; ${unmappedMargPurchaseInvoices} Marg purchase invoices still remain unmapped and are reported separately.`,
      ],
      fallbackLogic: [
        'If a supplier has local PO/GR/QC data, use that for order count, on-time %, fulfillment %, rejection %, and exact lead time.',
        'If a Marg purchase invoice references a synced PO through ORN, the posted GRN is linked back to that PO so total orders, lead time, and fulfillment come from local PO/GRN lifecycle data.',
        'If a purchase invoice has no linked Marg PO, synthesize a fallback local PO from the invoice lines so order count and fulfillment remain PO/GRN-driven; lead time stays blank when Marg did not provide a real order date.',
        'If a local supplier is not explicitly mapped and Marg purchase invoices exist, suppress local spend rather than double count PO value against invoice value.',
        'If no explicit supplier mapping exists for a Marg invoice, keep that supplier in a separate Marg-only row instead of merging by code or name.',
      ],
      syncImprovements: [
        'Add a dedicated Marg supplier crosswalk into suppliers.externalId / attributes.margCid for reliable invoice-to-supplier joins.',
        'Persist expected delivery date, promised date, and supplier document timestamps from Marg raw payload where available so OTIF no longer needs the unknown-date guard.',
        'Store raw Marg purchase-order identifiers on local PO/GRN headers to support deeper drill-through and reconciliation tooling.',
      ],
    };
  }

  async getSupplierPerformanceReport(
    tenantId: string,
    filters: SupplierPerformanceFilterDto,
  ): Promise<SupplierPerformanceReportResponse> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const localMetrics = await this.getLocalSupplierPerformanceMetrics(tenantId, filters);
    const merged = new Map<string, SupplierPerformanceReportRow>();

    for (const row of localMetrics) {
      const key = `supplier:${row.supplier_id}`;

      merged.set(key, {
        supplier_key: key,
        supplier_name: row.supplier_name,
        supplier_code: row.supplier_code,
        total_orders: row.total_orders,
        purchase_invoice_count: row.purchase_invoice_count,
        on_time_delivery_pct: row.on_time_delivery_pct,
        avg_lead_time_days: row.avg_lead_time_days,
        fulfillment_rate_pct: row.fulfillment_rate_pct,
        rejection_rate_pct: row.rejection_rate_pct,
        total_spend: row.local_po_spend > 0 ? row.local_po_spend : null,
        has_explicit_marg_mapping: row.has_explicit_marg_mapping,
        mapping_status: row.has_explicit_marg_mapping ? 'EXPLICIT_MARG_MAPPING' : 'LOCAL_ONLY_UNMAPPED',
        order_source: 'LOCAL_PURCHASE_ORDER',
        lead_time_source: row.avg_lead_time_days != null ? 'LOCAL_PO_GRN' : 'UNAVAILABLE',
        spend_source: row.purchase_invoice_count > 0 ? 'CORE_PURCHASE_INVOICE_GRN' : 'CORE_PURCHASE_ORDER',
        spend_note: null,
        rejection_source: row.rejection_rate_pct != null ? 'LOCAL_QUALITY_INSPECTION' : 'UNAVAILABLE',
        last_activity_date: row.last_activity_date,
      });
    }

    const rows = this.applySupplierPerformanceReportGrid(Array.from(merged.values()), filters);

    return {
      analysis: this.buildCoreSupplierPerformanceAnalysis(),
      data: rows.slice(offset, offset + limit),
      total: rows.length,
    };
  }

  private buildCoreSupplierPerformanceAnalysis(): ProcurementDataSyncAnalysis {
    return {
      purchaseOrders: {
        syncedFromMarg: true,
        margRecordCount: 0,
        localRecordCount: 0,
        tables: ['purchase_orders', 'purchase_order_lines'],
        notes: [
          'Supplier performance is computed from core purchase orders and purchase order lines.',
          'Marg-origin purchase orders are materialized into these core tables during sync.',
        ],
      },
      purchaseInvoices: {
        syncedFromMarg: true,
        margRecordCount: 0,
        localRecordCount: 0,
        tables: ['goods_receipts', 'goods_receipt_lines', 'purchase_orders'],
        notes: [
          'Marg purchase invoices are represented by posted core goods receipts with Marg GRN markers.',
          'The runtime scorecard no longer joins Marg staging voucher or transaction tables.',
        ],
      },
      goodsReceipts: {
        syncedFromMarg: true,
        margRecordCount: 0,
        localRecordCount: 0,
        tables: ['goods_receipts', 'goods_receipt_lines'],
        notes: [
          'On-time, fulfillment, lead-time, and invoice counts are PO/GRN-driven.',
        ],
      },
      stockTransactions: {
        syncedFromMarg: true,
        margRecordCount: 0,
        localRecordCount: 0,
        tables: ['inventory_transactions', 'inventory_ledger'],
        notes: [
          'Stock movement reports use core inventory transaction and ledger projections.',
        ],
      },
      sourceOfTruth: {
        supplierPerformanceMetrics: 'Core purchase_orders, purchase_order_lines, goods_receipts, goods_receipt_lines, and quality_inspections.',
        leadTimeCalculation: 'Core purchase order date to first posted goods receipt date.',
        spendCalculation: 'Core purchase order totals after Marg sync materializes procurement documents.',
      },
      risks: [
        'If a Marg supplier is not materialized into a core supplier, the supplier is excluded from this production scorecard until sync diagnostics are resolved.',
      ],
      fallbackLogic: [
        'Invoice-only Marg documents are materialized as fallback core purchase orders and posted goods receipts during sync.',
      ],
      syncImprovements: [
        'Keep resolving missing supplier mappings during Marg sync so runtime reports remain core-table only.',
      ],
    };
  }

  async getSupplierPerformancePurchaseOrders(
    tenantId: string,
    supplierKey: string,
    filters: SupplierPerformanceFilterDto,
  ): Promise<SupplierPerformanceDetailResponse<SupplierPerformancePurchaseOrderDetailRow>> {
    const parsedKey = this.parseSupplierKey(supplierKey);
    if (parsedKey.kind !== 'local') {
      return { data: [], total: 0 };
    }

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const contextConds: Prisma.Sql[] = [
      Prisma.sql`po.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`po.supplier_id = ${parsedKey.supplierId}::uuid`,
      Prisma.sql`po.status NOT IN ('CANCELLED', 'DRAFT')`,
    ];

    if (filters.supplierIds?.length) {
      contextConds.push(Prisma.sql`po.supplier_id = ANY(${filters.supplierIds}::uuid[])`);
    }
    if (filters.startDate) {
      contextConds.push(Prisma.sql`po.order_date >= ${filters.startDate}::date`);
    }
    if (filters.endDate) {
      contextConds.push(Prisma.sql`po.order_date <= ${filters.endDate}::date`);
    }
    if (filters.status) {
      contextConds.push(Prisma.sql`po.status::text = ${filters.status}`);
    }
    if (filters.companyId !== undefined && filters.companyId !== null) {
      const companyId = Number(filters.companyId);
      contextConds.push(Prisma.sql`(
        po.order_number LIKE ${`${MARG_PURCHASE_ORDER_PREFIX}${companyId}-%`}
        OR s.external_id LIKE ${`marg:${companyId}:%`}
        OR COALESCE(s.attributes->>'margCompanyId', '') = ${String(companyId)}
      )`);
    }

    const fallbackPoMatch = `${MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX}%`;
    if (!filters.includeFallbackPurchaseOrders) {
      contextConds.push(Prisma.sql`COALESCE(po.order_number, '') NOT LIKE ${fallbackPoMatch}`);
    }

    const detailFilterConds = buildPharmaFilterSql(parsePharmaFilters(filters.filters), SUPPLIER_PO_DETAIL_COLUMNS);
    const detailWhere = detailFilterConds.length
      ? Prisma.sql`WHERE ${Prisma.join(detailFilterConds, ' AND ')}`
      : Prisma.empty;
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy,
      filters.sortDir,
      SUPPLIER_PO_DETAIL_COLUMNS,
      Prisma.sql`d.document_date DESC NULLS LAST, d.document_number DESC`,
    );

    const detailCte = Prisma.sql`
      WITH filtered_pos AS (
        SELECT po.*
        FROM purchase_orders po
        JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
        WHERE ${Prisma.join(contextConds, ' AND ')}
      ),
      line_rollup AS (
        SELECT
          pol.purchase_order_id,
          COUNT(*)::int AS line_count,
          SUM(COALESCE(pol.quantity, 0))::float8 AS ordered_qty,
          SUM(COALESCE(pol.received_qty, 0))::float8 AS received_qty
        FROM purchase_order_lines pol
        JOIN filtered_pos po ON po.id = pol.purchase_order_id
        GROUP BY pol.purchase_order_id
      ),
      po_detail AS (
        SELECT
          po.id::text AS id,
          po.order_number AS document_number,
          po.order_date AS document_date,
          po.expected_date,
          s.id::text AS supplier_id,
          s.code AS supplier_code,
          s.name AS supplier_name,
          po.status::text AS status,
          COALESCE(po.total_amount, 0)::float8 AS total_amount,
          COALESCE(NULLIF(po.currency, ''), 'INR') AS currency,
          COALESCE(lr.line_count, 0)::int AS line_count,
          COALESCE(lr.ordered_qty, 0)::float8 AS ordered_qty,
          COALESCE(lr.received_qty, 0)::float8 AS received_qty,
          GREATEST(COALESCE(lr.ordered_qty, 0) - COALESCE(lr.received_qty, 0), 0)::float8 AS pending_qty,
          'LOCAL_PURCHASE_ORDER' AS source,
          CONCAT('/manufacturing/purchase-orders?poId=', po.id::text) AS open_path
        FROM filtered_pos po
        JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
        LEFT JOIN line_rollup lr ON lr.purchase_order_id = po.id
      )
    `;

    const rows = await this.prisma.$queryRaw<SupplierPerformancePurchaseOrderDetailRow[]>(
      Prisma.sql`
        ${detailCte}
        SELECT *
        FROM po_detail d
        ${detailWhere}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        ${detailCte}
        SELECT COUNT(*)::bigint AS cnt
        FROM po_detail d
        ${detailWhere}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  async getSupplierPerformancePurchaseInvoices(
    tenantId: string,
    supplierKey: string,
    filters: SupplierPerformanceFilterDto,
  ): Promise<SupplierPerformanceDetailResponse<SupplierPerformancePurchaseInvoiceDetailRow>> {
    const parsedKey = this.parseSupplierKey(supplierKey);
    if (parsedKey.kind !== 'local') {
      return { data: [], total: 0 };
    }

    if (filters.status && filters.status !== 'POSTED') {
      return { data: [], total: 0 };
    }

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const contextConds: Prisma.Sql[] = [
      Prisma.sql`gr.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`po.supplier_id = ${parsedKey.supplierId}::uuid`,
      Prisma.sql`gr.status = 'POSTED'`,
      Prisma.sql`(
        gr.receipt_number LIKE ${`${MARG_GOODS_RECEIPT_PREFIX}%`}
        OR COALESCE(gr.notes, '') LIKE ${`%${MARG_SYNC_GOODS_RECEIPT_MARKER}%`}
      )`,
    ];

    if (filters.startDate) {
      contextConds.push(Prisma.sql`gr.receipt_date >= ${filters.startDate}::date`);
    }
    if (filters.endDate) {
      contextConds.push(Prisma.sql`gr.receipt_date <= ${filters.endDate}::date`);
    }
    if (filters.companyId !== undefined && filters.companyId !== null) {
      contextConds.push(Prisma.sql`(substring(COALESCE(gr.notes, '') from 'company=([0-9]+)'))::int = ${Number(filters.companyId)}`);
    }
    if (filters.supplierIds?.length) {
      contextConds.push(Prisma.sql`po.supplier_id = ANY(${filters.supplierIds}::uuid[])`);
    }

    const detailFilterConds = buildPharmaFilterSql(parsePharmaFilters(filters.filters), SUPPLIER_PI_DETAIL_COLUMNS);
    const detailWhere = detailFilterConds.length
      ? Prisma.sql`WHERE ${Prisma.join(detailFilterConds, ' AND ')}`
      : Prisma.empty;
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy,
      filters.sortDir,
      SUPPLIER_PI_DETAIL_COLUMNS,
      Prisma.sql`d.document_date DESC NULLS LAST, d.document_number DESC`,
    );

    const detailCte = Prisma.sql`
      WITH filtered_receipts AS (
        SELECT
          gr.*,
          po.order_date,
          po.total_amount AS po_total_amount,
          po.currency,
          s.id AS supplier_id,
          s.code AS supplier_code,
          s.name AS supplier_name,
          (substring(COALESCE(gr.notes, '') from 'company=([0-9]+)'))::int AS company_id,
          substring(COALESCE(gr.notes, '') from 'voucher=([^ ]+)') AS voucher,
          substring(COALESCE(gr.notes, '') from 'vcn=([^ ]+)') AS vcn,
          substring(COALESCE(gr.notes, '') from 'orn=([^ ]+)') AS orn
        FROM goods_receipts gr
        JOIN purchase_orders po
          ON po.id = gr.purchase_order_id
          AND po.tenant_id = gr.tenant_id
        JOIN suppliers s
          ON s.id = po.supplier_id
          AND s.tenant_id = po.tenant_id
        WHERE ${Prisma.join(contextConds, ' AND ')}
      ),
      line_rollup AS (
        SELECT
          gr.id AS receipt_id,
          COUNT(grl.id)::int AS line_count,
          SUM(COALESCE(grl.quantity, 0))::float8 AS total_qty,
          SUM(COALESCE(grl.quantity, 0) * COALESCE(pol.unit_price, 0))::float8 AS receipt_amount
        FROM filtered_receipts gr
        LEFT JOIN goods_receipt_lines grl ON grl.goods_receipt_id = gr.id
        LEFT JOIN purchase_order_lines pol
          ON pol.purchase_order_id = gr.purchase_order_id
          AND pol.product_id = grl.product_id
          AND pol.line_number = grl.line_number
        GROUP BY gr.id
      ),
      invoice_detail AS (
        SELECT
          gr.id::text AS id,
          CONCAT('supplier:', gr.supplier_id::text) AS supplier_key,
          gr.company_id,
          COALESCE(NULLIF(gr.vcn, ''), NULLIF(gr.voucher, ''), gr.receipt_number) AS document_number,
          gr.receipt_date AS document_date,
          CASE
            WHEN gr.order_date > ${MARG_MIN_VALID_ORDER_DATE}::date THEN gr.order_date
            ELSE NULL
          END AS order_date,
          COALESCE(NULLIF(gr.voucher, ''), gr.receipt_number) AS voucher,
          gr.vcn,
          gr.orn,
          gr.supplier_id::text AS supplier_id,
          gr.supplier_code,
          gr.supplier_name,
          'POSTED' AS status,
          COALESCE(line_rollup.receipt_amount, gr.po_total_amount, 0)::float8 AS total_amount,
          COALESCE(NULLIF(gr.currency, ''), 'INR') AS currency,
          COALESCE(line_rollup.line_count, 0)::int AS line_count,
          COALESCE(line_rollup.total_qty, 0)::float8 AS total_qty,
          'CORE_PURCHASE_INVOICE_GRN' AS source,
          CONCAT('/manufacturing/purchase-invoices?invoiceId=', gr.id::text) AS open_path
        FROM filtered_receipts gr
        LEFT JOIN line_rollup ON line_rollup.receipt_id = gr.id
      )
    `;

    const rows = await this.prisma.$queryRaw<SupplierPerformancePurchaseInvoiceDetailRow[]>(
      Prisma.sql`
        ${detailCte}
        SELECT *
        FROM invoice_detail d
        ${detailWhere}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        ${detailCte}
        SELECT COUNT(*)::bigint AS cnt
        FROM invoice_detail d
        ${detailWhere}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
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

    if (filters.status) {
      extraConds.push(Prisma.sql`po.status::text = ${filters.status}`);
    }
    if (filters.companyId !== undefined && filters.companyId !== null) {
      const companyId = Number(filters.companyId);
      extraConds.push(Prisma.sql`(
        po.order_number LIKE ${`${MARG_PURCHASE_ORDER_PREFIX}${companyId}-%`}
        OR s_filter.external_id LIKE ${`marg:${companyId}:%`}
        OR COALESCE(s_filter.attributes->>'margCompanyId', '') = ${String(companyId)}
      )`);
    }

    const fallbackPoMatch = `${MARG_PURCHASE_INVOICE_FALLBACK_PO_PREFIX}%`;
    const includeFallback = (filters as any).includeFallbackPurchaseOrders === true
      || (filters as any).includeFallbackPurchaseOrders === 'true';

    const baseCond = Prisma.sql`po.tenant_id = ${tenantId}::uuid AND po.status NOT IN ('CANCELLED', 'DRAFT')`;
    const where = extraConds.length
      ? Prisma.sql`${baseCond} AND ${Prisma.join(extraConds, ' AND ')}`
      : baseCond;
    const hasExpectedDateMarker = `%${MARG_EXPECTED_DATE_UNKNOWN_MARKER}%`;
    const hasUnknownOrderDateMarker = `%${MARG_ORDER_DATE_UNKNOWN_MARKER}%`;

    return this.prisma.$queryRaw<LocalSupplierPerformanceMetric[]>(
      Prisma.sql`
        WITH filtered_pos AS (
          SELECT po.*
          FROM purchase_orders po
          JOIN suppliers s_filter ON s_filter.id = po.supplier_id AND s_filter.tenant_id = po.tenant_id
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
            SUM(COALESCE(grl.quantity, 0)) FILTER (WHERE gr.status = 'POSTED')::float8 AS received_qty,
            COUNT(DISTINCT gr.id) FILTER (
              WHERE gr.status = 'POSTED'
                AND (
                  gr.receipt_number LIKE ${`${MARG_GOODS_RECEIPT_PREFIX}%`}
                  OR COALESCE(gr.notes, '') LIKE ${`%${MARG_SYNC_GOODS_RECEIPT_MARKER}%`}
                )
            )::int AS purchase_invoice_count
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
          COUNT(DISTINCT CASE
            WHEN ${includeFallback}
              OR COALESCE(po.order_number, '') NOT LIKE ${fallbackPoMatch}
            THEN po.id
          END)::int AS total_orders,
          COALESCE(SUM(rr.purchase_invoice_count), 0)::int AS purchase_invoice_count,
          CASE
            WHEN COUNT(DISTINCT CASE
              WHEN rr.first_receipt_date IS NOT NULL
                AND po.expected_date IS NOT NULL
                AND COALESCE(po.notes, '') NOT LIKE ${hasExpectedDateMarker}
              THEN po.id
            END) > 0
            THEN (
              COUNT(DISTINCT CASE
                WHEN rr.first_receipt_date IS NOT NULL
                  AND po.expected_date IS NOT NULL
                  AND COALESCE(po.notes, '') NOT LIKE ${hasExpectedDateMarker}
                  AND rr.first_receipt_date::date <= po.expected_date::date
                THEN po.id
              END)::float8
              /
              COUNT(DISTINCT CASE
                WHEN rr.first_receipt_date IS NOT NULL
                  AND po.expected_date IS NOT NULL
                  AND COALESCE(po.notes, '') NOT LIKE ${hasExpectedDateMarker}
                THEN po.id
              END)::float8
            ) * 100
            ELSE NULL
          END::float8 AS on_time_delivery_pct,
          AVG(
            CASE
              WHEN rr.first_receipt_date IS NOT NULL
                AND COALESCE(po.notes, '') NOT LIKE ${hasUnknownOrderDateMarker}
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

  private parseSupplierKey(rawKey: string): SupplierKey {
    const key = decodeURIComponent(String(rawKey || '')).trim();
    if (key.startsWith('supplier:')) {
      const supplierId = key.slice('supplier:'.length);
      if (!supplierId) {
        throw new BadRequestException('Invalid supplier key');
      }
      return { kind: 'local', supplierId };
    }

    if (key.startsWith('marg:')) {
      const [, companyIdRaw, ...cidParts] = key.split(':');
      const companyId = Number(companyIdRaw);
      const cid = cidParts.join(':') || 'unknown';
      if (!Number.isInteger(companyId) || companyId < 0) {
        throw new BadRequestException('Invalid Marg supplier key');
      }
      return { kind: 'marg', companyId, cid };
    }

    throw new BadRequestException('Supplier key must start with supplier: or marg:');
  }

  private applySupplierPerformanceReportGrid(
    rows: SupplierPerformanceReportRow[],
    filters: SupplierPerformanceFilterDto,
  ): SupplierPerformanceReportRow[] {
    const columnFilters = parsePharmaFilters(filters.filters);
    const filteredRows = columnFilters.length
      ? rows.filter((row) => columnFilters.every((filter) => this.matchesSupplierPerformanceReportFilter(row, filter)))
      : rows;

    if (!filters.sortBy || !SUPPLIER_PERFORMANCE_REPORT_FILTER_TYPES[filters.sortBy]) {
      return filteredRows.sort((left, right) => {
        const spendDelta = (right.total_spend ?? 0) - (left.total_spend ?? 0);
        if (spendDelta !== 0) return spendDelta;
        const orderDelta = right.total_orders - left.total_orders;
        if (orderDelta !== 0) return orderDelta;
        return left.supplier_name.localeCompare(right.supplier_name);
      });
    }

    const sortField = filters.sortBy;
    const sortDir = filters.sortDir === 'desc' ? -1 : 1;
    const type = SUPPLIER_PERFORMANCE_REPORT_FILTER_TYPES[sortField];

    return filteredRows.sort((left, right) => {
      const leftValue = this.getSupplierPerformanceReportValue(left, sortField);
      const rightValue = this.getSupplierPerformanceReportValue(right, sortField);
      const leftMissing = leftValue === null || leftValue === undefined;
      const rightMissing = rightValue === null || rightValue === undefined;
      if (leftMissing && rightMissing) return 0;
      if (leftMissing) return 1;
      if (rightMissing) return -1;

      if (type === 'number' || type === 'boolean') {
        return (Number(leftValue) - Number(rightValue)) * sortDir;
      }
      if (type === 'date') {
        return (this.toComparableDate(leftValue) - this.toComparableDate(rightValue)) * sortDir;
      }
      return String(leftValue).localeCompare(String(rightValue)) * sortDir;
    });
  }

  private matchesSupplierPerformanceReportFilter(
    row: SupplierPerformanceReportRow,
    filter: PharmaColumnFilter,
  ): boolean {
    const type = SUPPLIER_PERFORMANCE_REPORT_FILTER_TYPES[filter.field];
    if (!type) {
      throw new BadRequestException(`Filtering on column '${filter.field}' is not permitted`);
    }

    const value = this.getSupplierPerformanceReportValue(row, filter.field);
    const operator = filter.operator;
    if (operator === 'isNull') return value === null || value === undefined;
    if (operator === 'isNotNull') return value !== null && value !== undefined;
    if (value === null || value === undefined) return false;

    if (type === 'number' || type === 'boolean') {
      const left = Number(value);
      const right = Number(filter.value);
      if (!Number.isFinite(right) && operator !== 'between') return false;
      switch (operator) {
        case 'equals': return left === right;
        case 'notEquals': return left !== right;
        case 'gt': return left > right;
        case 'gte': return left >= right;
        case 'lt': return left < right;
        case 'lte': return left <= right;
        case 'between': {
          const [fromRaw, toRaw] = Array.isArray(filter.value) ? filter.value : [filter.value, filter.value];
          const from = Number(fromRaw);
          const to = Number(toRaw);
          return Number.isFinite(from) && Number.isFinite(to) && left >= from && left <= to;
        }
        default: return String(value) === String(filter.value ?? '');
      }
    }

    if (type === 'date') {
      const left = this.toComparableDate(value);
      const right = this.toComparableDate(filter.value);
      switch (operator) {
        case 'equals': return left === right;
        case 'gt':
        case 'gte': return operator === 'gt' ? left > right : left >= right;
        case 'lt':
        case 'lte': return operator === 'lt' ? left < right : left <= right;
        case 'between': {
          const [fromRaw, toRaw] = Array.isArray(filter.value) ? filter.value : [filter.value, filter.value];
          return left >= this.toComparableDate(fromRaw) && left <= this.toComparableDate(toRaw);
        }
        default: return false;
      }
    }

    const left = String(value).toLowerCase();
    const right = String(filter.value ?? '').toLowerCase();
    switch (operator) {
      case 'contains': return left.includes(right);
      case 'startsWith': return left.startsWith(right);
      case 'endsWith': return left.endsWith(right);
      case 'equals': return left === right;
      case 'notEquals': return left !== right;
      case 'in': return (Array.isArray(filter.value) ? filter.value : [filter.value]).map((v) => String(v).toLowerCase()).includes(left);
      case 'notIn': return !(Array.isArray(filter.value) ? filter.value : [filter.value]).map((v) => String(v).toLowerCase()).includes(left);
      default: return false;
    }
  }

  private getSupplierPerformanceReportValue(row: SupplierPerformanceReportRow, field: string): unknown {
    return (row as unknown as Record<string, unknown>)[field];
  }

  private toComparableDate(value: unknown): number {
    if (!value) return Number.NaN;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return Number.NaN;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  private async countRows(query: Prisma.Sql): Promise<number> {
    const result = await this.prisma.$queryRaw<[{ cnt: bigint }]>(query);
    return Number(result[0]?.cnt ?? 0);
  }
}
