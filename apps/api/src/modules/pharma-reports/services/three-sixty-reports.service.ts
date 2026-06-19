import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { MargOutstandingService } from '../../marg-ede/marg-outstanding.service';
import {
  margPurchaseAmountSignSql,
  margSalesAmountSignSql,
  margVoucherFamilySql,
} from '../../marg-ede/marg-voucher-family.sql';
import { InventoryReportsService } from './inventory-reports.service';
import { ProcurementReportsService } from './procurement-reports.service';

type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'fy'
  | 'last_fy'
  | 'calendar'
  | 'last12';
type ThreeSixtySearchType = 'item' | 'customer' | 'supplier' | 'route' | 'city' | 'salesman';

interface ReportContext {
  asOf: Date;
  monthStart: Date;
  nextMonthStart: Date;
  lastMonthStart: Date;
  // Selected analysis window [periodStart, periodEnd] (inclusive). Drives all
  // period-scoped aggregates (period sales/purchase, returns, margin, top
  // items/buyers, location sales). The month/trend anchors above are
  // period-independent and always reflect "now".
  periodStart: Date;
  periodEnd: Date;
  // Same window shifted back one year, for the prior-period (YoY) comparison.
  // priorFiscalEnd is an EXCLUSIVE upper bound.
  priorFiscalStart: Date;
  priorFiscalEnd: Date;
  trendStart: Date;
}

@Injectable()
export class ThreeSixtyReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryReports: InventoryReportsService,
    private readonly procurementReports: ProcurementReportsService,
    private readonly margOutstanding: MargOutstandingService,
  ) {}

  async getItem360(tenantId: string, search?: string, period: PeriodKey = 'fy', locationId?: string) {
    const ctx = await this.getContext(tenantId, period);
    const item = await this.findItem(tenantId, search);
    if (!item) {
      throw new NotFoundException('No item found for the selected search.');
    }

    const isAllItems = item.is_all === true;
    const productFilter = isAllItems
      ? Prisma.sql`TRUE`
      : item.product_id
      ? Prisma.sql`a.product_id = ${item.product_id}::uuid`
      : Prisma.sql`a.product_id IS NULL`;
    const localProductFilter = isAllItems
      ? Prisma.sql`TRUE`
      : item.product_id
        ? Prisma.sql`il.product_id = ${item.product_id}::uuid`
        : Prisma.sql`FALSE`;
    const batchProductFilter = isAllItems
      ? Prisma.sql`TRUE`
      : item.product_id
        ? Prisma.sql`b.product_id = ${item.product_id}::uuid`
        : Prisma.sql`FALSE`;
    const poProductFilter = isAllItems
      ? Prisma.sql`TRUE`
      : item.product_id
        ? Prisma.sql`pol.product_id = ${item.product_id}::uuid`
        : Prisma.sql`FALSE`;
    const ledgerProductFilter = isAllItems
      ? Prisma.sql`TRUE`
      : item.product_id
        ? Prisma.sql`il.product_id = ${item.product_id}::uuid`
        : Prisma.sql`FALSE`;
    const margProductFilter = isAllItems
      ? Prisma.sql`TRUE`
      : item.marg_pid
      ? Prisma.sql`mt.company_id = ${item.company_id} AND mt.pid = ${item.marg_pid}`
      : Prisma.sql`FALSE`;
    const margStockProductFilter = isAllItems
      ? Prisma.sql`TRUE`
      : item.marg_pid
        ? Prisma.sql`ms.company_id = ${item.company_id} AND ms.pid = ${item.marg_pid}`
        : Prisma.sql`FALSE`;
    const actualLocationFilter = locationId ? Prisma.sql`AND a.location_id = ${locationId}::uuid` : Prisma.empty;
    const margVoucherLocationFilter = locationId ? Prisma.sql`AND EXISTS (SELECT 1 FROM marg_branches mbf WHERE mbf.tenant_id = mv.tenant_id AND mbf.company_id = mv.company_id AND mbf.location_id = ${locationId}::uuid)` : Prisma.empty;
    const inventoryLevelLocationFilter = locationId ? Prisma.sql`AND il.location_id = ${locationId}::uuid` : Prisma.empty;
    const batchLocationFilter = locationId ? Prisma.sql`AND b.location_id = ${locationId}::uuid` : Prisma.empty;
    const poLocationFilter = locationId ? Prisma.sql`AND po.location_id = ${locationId}::uuid` : Prisma.empty;
    const ledgerLocationFilter = locationId ? Prisma.sql`AND il.location_id = ${locationId}::uuid` : Prisma.empty;
    const inventoryFilter = this.inventoryReportFilter(item.product_id, locationId);
    const currentStockReportP = this.inventoryReports.getCurrentStock(tenantId, inventoryFilter);
    const batchInventoryReportP = this.inventoryReports.getBatchInventory(tenantId, inventoryFilter);
    const stockAgeingReportP = this.inventoryReports.getStockAgeing(tenantId, { ...inventoryFilter, bucketDays: [30, 60, 90] } as any);

    // Movements CTE is family-aware: sales-side lines are signed via
    // margSalesAmountSignSql ({SALES_INVOICE: +1, SALES_RETURN: -1, others: 0})
    // and purchase-side via margPurchaseAmountSignSql, so a CN return nets
    // against an invoice, and challan / SC contribute 0. Aggregations below
    // SUM the signed values directly — no further ABS or filter is needed.
    const kpiP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH movements AS (
        SELECT
          mv.date,
          'SALES'::text AS kind,
          (ABS(COALESCE(mt.qty, 0)) * ${margSalesAmountSignSql('mv')})::float8 AS quantity,
          (ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')})::float8 AS amount
        FROM marg_vouchers mv
        JOIN marg_transactions mt
          ON mt.tenant_id = mv.tenant_id
          AND mt.company_id = mv.company_id
          AND mt.voucher = mv.voucher
          AND ${this.compatibleSalesLineSql('mv', 'mt')}
        WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE
          AND UPPER(mv.type) IN ('S', 'R', 'W')
          AND ${margProductFilter}
          ${margVoucherLocationFilter}
        UNION ALL
        SELECT
          mv.date,
          'PURCHASES'::text AS kind,
          (ABS(COALESCE(mt.qty, 0)) * ${margPurchaseAmountSignSql('mv')})::float8 AS quantity,
          (ABS(COALESCE(mt.amount, 0)) * ${margPurchaseAmountSignSql('mv')})::float8 AS amount
        FROM marg_vouchers mv
        JOIN marg_transactions mt
          ON mt.tenant_id = mv.tenant_id
          AND mt.company_id = mv.company_id
          AND mt.voucher = mv.voucher
          AND ${this.compatiblePurchaseLineSql('mv', 'mt')}
        WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE
          AND UPPER(mv.type) IN ('P', 'B', 'Q')
          AND ${margProductFilter}
          ${margVoucherLocationFilter}
      )
      SELECT
        COALESCE(SUM(quantity) FILTER (WHERE kind = 'SALES' AND date >= ${ctx.monthStart}::date AND date < ${ctx.nextMonthStart}::date), 0)::float8 AS current_month_sales_qty,
        COALESCE(SUM(amount) FILTER (WHERE kind = 'SALES' AND date >= ${ctx.monthStart}::date AND date < ${ctx.nextMonthStart}::date), 0)::float8 AS current_month_sales_value,
        COALESCE(SUM(quantity) FILTER (WHERE kind = 'SALES' AND date >= ${ctx.lastMonthStart}::date AND date < ${ctx.monthStart}::date), 0)::float8 AS last_month_sales_qty,
        COALESCE(SUM(amount) FILTER (WHERE kind = 'SALES' AND date >= ${ctx.lastMonthStart}::date AND date < ${ctx.monthStart}::date), 0)::float8 AS last_month_sales_value,
        COALESCE(SUM(quantity) FILTER (WHERE kind = 'PURCHASES' AND date >= ${ctx.monthStart}::date AND date < ${ctx.nextMonthStart}::date), 0)::float8 AS current_month_purchase_qty,
        COALESCE(SUM(amount) FILTER (WHERE kind = 'PURCHASES' AND date >= ${ctx.monthStart}::date AND date < ${ctx.nextMonthStart}::date), 0)::float8 AS current_month_purchase_value,
        COALESCE(SUM(amount) FILTER (WHERE kind = 'SALES' AND date >= ${ctx.periodStart}::date AND date <= ${ctx.periodEnd}::date), 0)::float8 AS current_year_sales_value,
        COALESCE(SUM(quantity) FILTER (WHERE kind = 'SALES' AND date >= ${ctx.periodStart}::date AND date <= ${ctx.periodEnd}::date), 0)::float8 AS current_year_sales_qty,
        COALESCE(SUM(amount) FILTER (WHERE kind = 'SALES' AND date >= ${ctx.priorFiscalStart}::date AND date < ${ctx.priorFiscalEnd}::date), 0)::float8 AS last_year_sales_value,
        COALESCE(SUM(amount) FILTER (WHERE kind = 'PURCHASES' AND date >= ${ctx.periodStart}::date AND date <= ${ctx.periodEnd}::date), 0)::float8 AS current_year_purchase_value,
        COALESCE(SUM(quantity) FILTER (WHERE kind = 'PURCHASES' AND date >= ${ctx.periodStart}::date AND date <= ${ctx.periodEnd}::date), 0)::float8 AS current_year_purchase_qty
      FROM movements
    `);

    const stockP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(on_hand_qty), 0)::float8 AS current_stock,
        COALESCE(SUM(stock_value), 0)::float8 AS stock_value,
        COALESCE(MAX(last_purchase_date), NULL) AS last_purchase_date
      FROM (
        SELECT
          il.on_hand_qty::float8 AS on_hand_qty,
          COALESCE(il.inventory_value, il.on_hand_qty * COALESCE(il.average_cost, il.standard_cost, p.standard_cost, 0))::float8 AS stock_value,
          il.last_receipt_date AS last_purchase_date
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id
        WHERE il.tenant_id = ${tenantId}::uuid AND ${localProductFilter} ${inventoryLevelLocationFilter}
        UNION ALL
        SELECT
          COALESCE(ms.stock, 0)::float8 AS on_hand_qty,
          (COALESCE(ms.stock, 0) * COALESCE(ms.p_rate, ms.lp_rate, 0))::float8 AS stock_value,
          ms.sup_date AS last_purchase_date
        FROM marg_stocks ms
        WHERE ms.tenant_id = ${tenantId}::uuid
          AND ms.source_deleted = false
          AND ${margStockProductFilter}
      ) s
    `);

    const openPoP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(pol.quantity - pol.received_qty, 0)), 0)::float8 AS open_po_qty,
        COALESCE(SUM(GREATEST(pol.quantity - pol.received_qty, 0) * pol.unit_price), 0)::float8 AS open_po_value,
        COUNT(DISTINCT po.id)::int AS open_po_count
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      WHERE po.tenant_id = ${tenantId}::uuid
        AND po.status NOT IN ('CLOSED', 'CANCELLED')
        AND ${poProductFilter}
        ${poLocationFilter}
    `);

    // Returns by FAMILY (classifier-aligned), joined to the voucher so we can
    // exclude cancelled documents — matching the Sales/Purchase Analysis
    // dashboard scope=return. Sales returns = SALES_RETURN (CN) +
    // SALES_BRK_EXP_RECEIVE (breakage/expiry CN); purchase returns =
    // PURCHASE_RETURN (DN) + PURCHASE_BRK_EXP_RETURN. SC price-difference
    // adjustments (SALES_RETURN_ADJUSTMENT) and challans are NOT returns and
    // are excluded by the family lists. The earlier version filtered on raw
    // line type ('R'/'B'), missed breakage/expiry, and counted cancelled rows.
    const margReturnsP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0))) FILTER (
          WHERE mv.family IN ('SALES_RETURN', 'SALES_BRK_EXP_RECEIVE')), 0)::float8 AS sales_return_value,
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0))) FILTER (
          WHERE mv.family IN ('PURCHASE_RETURN', 'PURCHASE_BRK_EXP_RETURN')), 0)::float8 AS purchase_return_value
      FROM marg_vouchers mv
      JOIN marg_transactions mt
        ON mt.tenant_id = mv.tenant_id
        AND mt.company_id = mv.company_id
        AND mt.voucher = mv.voucher
        AND (${this.compatibleSalesLineSql('mv', 'mt')} OR ${this.compatiblePurchaseLineSql('mv', 'mt')})
      WHERE mv.tenant_id = ${tenantId}::uuid
        AND mv.is_cancelled = FALSE
        AND mv.date >= ${ctx.periodStart}::date
        AND mv.date <= ${ctx.periodEnd}::date
        AND ${margProductFilter}
    `);

    // Margin is computed only over SALES_INVOICE lines (challan/SC contribute
    // zero, sales returns net out). The prior `mt.type = 'S'` filter was a
    // narrow Dis-line-type match that excluded the dominant 'G' lines under
    // S headers; joining to mv and filtering by family is the correct lens.
    const itemMarginP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(COALESCE(mt.amount, 0) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS sales_value,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, 0) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS cost_value
      FROM marg_transactions mt
      JOIN marg_vouchers mv
        ON mv.tenant_id = mt.tenant_id
        AND mv.company_id = mt.company_id
        AND mv.voucher = mt.voucher
        AND ${this.compatibleSalesLineSql('mv', 'mt')}
      LEFT JOIN LATERAL (
        SELECT p_rate, lp_rate
        FROM marg_stocks ms
        WHERE ms.tenant_id = mt.tenant_id AND ms.company_id = mt.company_id AND ms.pid = mt.pid
        ORDER BY ms.updated_at DESC
        LIMIT 1
      ) ms ON TRUE
      WHERE mt.tenant_id = ${tenantId}::uuid
        AND mv.type IN ('S', 'R')
        AND mt.date >= ${ctx.periodStart}::date
        AND mt.date <= ${ctx.periodEnd}::date
        AND ${margProductFilter}
    `);

    const monthlyTrendP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH monthly AS (
        SELECT
          date_trunc('month', mv.date) AS month_bucket,
          'SALES'::text AS kind,
          (ABS(COALESCE(mt.qty, 0)) * ${margSalesAmountSignSql('mv')})::float8 AS quantity,
          (ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')})::float8 AS amount
        FROM marg_vouchers mv
        JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleSalesLineSql('mv', 'mt')}
        WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R') AND ${margProductFilter} ${margVoucherLocationFilter}
        UNION ALL
        SELECT
          date_trunc('month', mv.date) AS month_bucket,
          'PURCHASES'::text AS kind,
          (ABS(COALESCE(mt.qty, 0)) * ${margPurchaseAmountSignSql('mv')})::float8 AS quantity,
          (ABS(COALESCE(mt.amount, 0)) * ${margPurchaseAmountSignSql('mv')})::float8 AS amount
        FROM marg_vouchers mv
        JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatiblePurchaseLineSql('mv', 'mt')}
        WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('P', 'B') AND ${margProductFilter} ${margVoucherLocationFilter}
      )
      SELECT
        to_char(buckets.month_bucket, 'Mon YYYY') AS month,
        COALESCE(SUM(monthly.amount) FILTER (WHERE monthly.kind = 'SALES'), 0)::float8 AS sales_value,
        COALESCE(SUM(monthly.amount) FILTER (WHERE monthly.kind = 'PURCHASES'), 0)::float8 AS purchase_value,
        COALESCE(SUM(monthly.quantity) FILTER (WHERE monthly.kind = 'SALES'), 0)::float8 AS sales_qty
      FROM generate_series(date_trunc('month', ${ctx.trendStart}::date), date_trunc('month', ${ctx.asOf}::date), interval '1 month') AS buckets(month_bucket)
      LEFT JOIN monthly ON monthly.month_bucket = buckets.month_bucket
      GROUP BY buckets.month_bucket
      ORDER BY buckets.month_bucket
    `);

    const topBuyersP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ROW_NUMBER() OVER (ORDER BY SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}) DESC)::int AS rank,
        COALESCE(c.name, mp.par_name, 'Unmapped Customer') AS name,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS quantity,
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS value
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleSalesLineSql('mv', 'mt')}
      LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid
      LEFT JOIN customers c ON c.id = mp.customer_id
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE
        AND mv.type IN ('S', 'R')
        AND ${margProductFilter}
        ${margVoucherLocationFilter}
        AND mv.date >= ${ctx.monthStart}::date
        AND mv.date < ${ctx.nextMonthStart}::date
      GROUP BY COALESCE(c.name, mp.par_name, 'Unmapped Customer')
      ORDER BY value DESC
      LIMIT 5
    `);

    const locationSalesP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(l.code, l.name, mb.name, mb.branch, 'Unmapped') AS location,
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS sales_value
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleSalesLineSql('mv', 'mt')}
      LEFT JOIN marg_branches mb ON mb.tenant_id = mv.tenant_id AND mb.company_id = mv.company_id
      LEFT JOIN locations l ON l.id = mb.location_id
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE
        AND mv.type IN ('S', 'R')
        AND ${margProductFilter}
        ${margVoucherLocationFilter}
        AND mv.date >= ${ctx.periodStart}::date
        AND mv.date <= ${ctx.periodEnd}::date
      GROUP BY COALESCE(l.code, l.name, mb.name, mb.branch, 'Unmapped')
      ORDER BY sales_value DESC
      LIMIT 6
    `);

    const batchesP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT * FROM (
        SELECT
          b.batch_number,
          COALESCE(b.available_qty, b.quantity, 0)::float8 AS quantity,
          b.expiry_date,
          CASE WHEN b.expiry_date IS NOT NULL THEN (b.expiry_date::date - CURRENT_DATE) ELSE NULL END::int AS days_left,
          COALESCE(b.cost_per_unit, 0)::float8 AS rate
        FROM batches b
        WHERE b.tenant_id = ${tenantId}::uuid AND ${batchProductFilter} ${batchLocationFilter}
        UNION ALL
        SELECT
          ms.batch AS batch_number,
          COALESCE(ms.stock, 0)::float8 AS quantity,
          ms.expiry AS expiry_date,
          CASE WHEN ms.expiry IS NOT NULL THEN (ms.expiry::date - CURRENT_DATE) ELSE NULL END::int AS days_left,
          COALESCE(ms.p_rate, ms.lp_rate, 0)::float8 AS rate
        FROM marg_stocks ms
        WHERE ms.tenant_id = ${tenantId}::uuid
          AND ms.source_deleted = false
          AND COALESCE(ms.stock, 0) > 0
          AND ${margStockProductFilter}
      ) b
      ORDER BY expiry_date ASC NULLS LAST
      LIMIT 8
    `);

    const stockAgeingP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH stock_rows AS (
        SELECT
          GREATEST((CURRENT_DATE - COALESCE(b.created_at::date, b.manufacturing_date, CURRENT_DATE)), 0)::int AS age_days,
          COALESCE(b.available_qty, b.quantity, 0)::float8 AS quantity,
          (COALESCE(b.available_qty, b.quantity, 0) * COALESCE(b.cost_per_unit, 0))::float8 AS value
        FROM batches b
        WHERE b.tenant_id = ${tenantId}::uuid
          AND ${batchProductFilter}
          ${batchLocationFilter}
        UNION ALL
        SELECT
          GREATEST((CURRENT_DATE - COALESCE(ms.sup_date, ms.bat_date, ms.created_at::date, CURRENT_DATE)), 0)::int AS age_days,
          COALESCE(ms.stock, 0)::float8 AS quantity,
          (COALESCE(ms.stock, 0) * COALESCE(ms.p_rate, ms.lp_rate, 0))::float8 AS value
        FROM marg_stocks ms
        WHERE ms.tenant_id = ${tenantId}::uuid
          AND ms.source_deleted = false
          AND COALESCE(ms.stock, 0) > 0
          AND ${margStockProductFilter}
      ),
      bucketed AS (
        SELECT
          CASE
            WHEN age_days <= 30 THEN '0-30'
            WHEN age_days <= 60 THEN '31-60'
            WHEN age_days <= 90 THEN '61-90'
            ELSE '91+'
          END AS bucket,
          CASE
            WHEN age_days <= 30 THEN 1
            WHEN age_days <= 60 THEN 2
            WHEN age_days <= 90 THEN 3
            ELSE 4
          END AS sort_order,
          quantity,
          value
        FROM stock_rows
        WHERE quantity > 0
      )
      SELECT
        bucket,
        COALESCE(SUM(quantity), 0)::float8 AS quantity,
        COALESCE(SUM(value), 0)::float8 AS value,
        CASE bucket WHEN '0-30' THEN 'Fresh' WHEN '31-60' THEN 'Healthy' WHEN '61-90' THEN 'Monitor' ELSE 'Slow' END AS status
      FROM bucketed
      GROUP BY bucket, sort_order
      ORDER BY sort_order
    `);

    const stockMovementP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        to_char(month_bucket, 'Mon YYYY') AS month,
        COALESCE(SUM(il.quantity) FILTER (WHERE il.entry_type::text IN ('LEDGER_RECEIPT', 'LEDGER_TRANSFER_IN', 'LEDGER_PRODUCTION_RECEIPT', 'LEDGER_RETURN')), 0)::float8 AS receipt_qty,
        COALESCE(SUM(ABS(il.quantity)) FILTER (WHERE il.entry_type::text IN ('LEDGER_ISSUE', 'LEDGER_TRANSFER_OUT', 'LEDGER_PRODUCTION_ISSUE', 'LEDGER_SCRAP')), 0)::float8 AS issue_qty
      FROM generate_series(date_trunc('month', ${ctx.trendStart}::date), date_trunc('month', ${ctx.asOf}::date), interval '1 month') month_bucket
      LEFT JOIN inventory_ledger il
        ON il.tenant_id = ${tenantId}::uuid
        AND ${ledgerProductFilter}
        ${ledgerLocationFilter}
        AND date_trunc('month', il.transaction_date) = month_bucket
      GROUP BY month_bucket
      ORDER BY month_bucket
    `);

    const openPoRowsP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        po.order_number,
        po.order_date,
        po.expected_date,
        COALESCE(s.name, '-') AS supplier_name,
        COALESCE(SUM(pol.quantity), 0)::float8 AS ordered_qty,
        COALESCE(SUM(pol.received_qty), 0)::float8 AS received_qty,
        COALESCE(SUM(GREATEST(pol.quantity - pol.received_qty, 0)), 0)::float8 AS pending_qty,
        COALESCE(SUM(GREATEST(pol.quantity - pol.received_qty, 0) * pol.unit_price), 0)::float8 AS pending_value,
        po.status::text AS status
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.tenant_id = ${tenantId}::uuid
        AND po.status NOT IN ('CLOSED', 'CANCELLED')
        AND ${poProductFilter}
        ${poLocationFilter}
      GROUP BY po.id, po.order_number, po.order_date, po.expected_date, s.name, po.status
      HAVING SUM(GREATEST(pol.quantity - pol.received_qty, 0)) > 0
      ORDER BY po.expected_date ASC
      LIMIT 8
    `);

    // Every block above is an independent read (3 inventory sub-reports + the
    // Marg KPI / stock / PO / returns / margin / trend / ranking queries).
    // Resolve them concurrently so the endpoint costs the slowest single query
    // rather than their sum. SQL is unchanged — only execution is parallelised.
    const [
      currentStockReport,
      batchInventoryReport,
      stockAgeingReport,
      kpiRows,
      stockRows,
      openPoAggRows,
      margReturnsRows,
      itemMarginRows,
      monthlyTrend,
      topBuyers,
      locationSales,
      batches,
      stockAgeing,
      stockMovement,
      openPoRows,
    ] = await Promise.all([
      currentStockReportP,
      batchInventoryReportP,
      stockAgeingReportP,
      kpiP,
      stockP,
      openPoP,
      margReturnsP,
      itemMarginP,
      monthlyTrendP,
      topBuyersP,
      locationSalesP,
      batchesP,
      stockAgeingP,
      stockMovementP,
      openPoRowsP,
    ]);
    const [kpi] = kpiRows;
    const [stock] = stockRows;
    const [openPo] = openPoAggRows;
    const [margReturns] = margReturnsRows;
    const [itemMargin] = itemMarginRows;

    const totalSales = Number(kpi.current_month_sales_value ?? 0);
    const lastSales = Number(kpi.last_month_sales_value ?? 0);
    const reportStock = this.currentStockFromReport(currentStockReport?.data ?? []);
    const stockQty = reportStock.hasRows ? reportStock.currentStock : Number(stock.current_stock ?? 0);
    const stockValue = reportStock.hasRows ? reportStock.stockValue : Number(stock.stock_value ?? 0);
    const effectiveBatches = batchInventoryReport?.data?.length
      ? this.batchesFromInventoryReport(batchInventoryReport.data)
      : batches;
    const effectiveStockAgeing = stockAgeingReport?.summary?.length
      ? this.stockAgeingFromInventoryReport(stockAgeingReport.summary)
      : this.addQuantityShare(stockAgeing);
    // Days-of-cover uses the selected period's sales rate so it tracks the chosen window.
    const avgDailySales = Number(kpi.current_year_sales_qty ?? 0) / Math.max(1, this.periodDays(ctx));

    return {
      asOf: ctx.asOf,
      profile: {
        code: item.sku,
        name: item.product_name,
        category: item.category,
        brand: item.brand,
        company: item.company,
        companyName: item.company_name,
        companyDisplay: item.company_display,
        salt: item.salt,
        saltName: item.salt_name,
        saltDisplay: item.salt_display,
        productGroup: item.product_group,
        productGroupName: item.product_group_name,
        productGroupDisplay: item.product_group_display,
        hsnCode: item.hsn_code,
        uom: item.uom,
        uomName: item.uom_name,
        uomDisplay: item.uom_display,
        mrp: item.mrp,
        sellingPrice: item.selling_price,
        lastPurchaseDate: reportStock.lastUpdated ?? stock.last_purchase_date,
      },
      kpis: {
        currentStock: stockQty,
        stockValue,
        currentMonthSalesQty: Number(kpi.current_month_sales_qty ?? 0),
        currentMonthSalesValue: totalSales,
        currentMonthPurchaseQty: Number(kpi.current_month_purchase_qty ?? 0),
        currentMonthPurchaseValue: Number(kpi.current_month_purchase_value ?? 0),
        currentYearSalesValue: Number(kpi.current_year_sales_value ?? 0),
        currentYearSalesQty: Number(kpi.current_year_sales_qty ?? 0),
        currentYearPurchaseValue: Number(kpi.current_year_purchase_value ?? 0),
        currentYearPurchaseQty: Number(kpi.current_year_purchase_qty ?? 0),
        momSalesChangePct: this.pctChange(totalSales, lastSales),
        yoySalesChangePct: this.pctChange(Number(kpi.current_year_sales_value ?? 0), Number(kpi.last_year_sales_value ?? 0)),
        openPoQty: Number(openPo.open_po_qty ?? 0),
        openPoValue: Number(openPo.open_po_value ?? 0),
        openPoCount: Number(openPo.open_po_count ?? 0),
        daysStockCover: avgDailySales > 0 ? stockQty / avgDailySales : null,
        returnPct: Number(kpi.current_year_sales_value ?? 0) > 0 ? Number(margReturns.sales_return_value ?? 0) / Number(kpi.current_year_sales_value ?? 0) * 100 : null,
        grossMargin: Number(itemMargin.sales_value ?? 0) - Number(itemMargin.cost_value ?? 0),
        marginPct: Number(itemMargin.sales_value ?? 0) > 0
          ? (Number(itemMargin.sales_value ?? 0) - Number(itemMargin.cost_value ?? 0)) / Number(itemMargin.sales_value ?? 0) * 100
          : null,
      },
      charts: { monthlyTrend, locationSales, stockMovement },
      tables: {
        topBuyers: this.addShare(topBuyers),
        batches: effectiveBatches,
        stockAgeing: effectiveStockAgeing,
        openPurchaseOrders: openPoRows,
      },
      insights: this.itemInsights(stockQty, avgDailySales, Number(openPo.open_po_qty ?? 0), effectiveBatches),
    };
  }

  async searchOptions(
    tenantId: string,
    type: ThreeSixtySearchType,
    search?: string,
    limit = 25,
  ): Promise<Array<{
    value: string;
    label: string;
    code: string | null;
    description: string | null;
    source: 'LOCAL' | 'MARG';
  }>> {
    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 50);
    const term = this.searchTerm(search);

    if (type === 'item') {
      const rows = await this.prisma.$queryRaw<Array<{ value: string; label: string; code: string | null; description: string | null; source: 'LOCAL' | 'MARG'; rank: number }>>(Prisma.sql`
        SELECT value, label, code, description, source, rank
        FROM (
          SELECT
            p.code AS value,
            p.name AS label,
            p.code,
            NULLIF(CONCAT_WS(' | ', NULLIF(p.category, ''), NULLIF(p.unit_of_measure, '')), '') AS description,
            'LOCAL'::text AS source,
            CASE
              WHEN p.code ILIKE ${term} THEN 0
              WHEN p.name ILIKE ${term} THEN 1
              ELSE 2
            END AS rank
          FROM products p
          WHERE p.tenant_id = ${tenantId}::uuid
            AND (${term} = '%%' OR p.code ILIKE ${term} OR p.name ILIKE ${term})
          UNION ALL
          SELECT
            mp.code AS value,
            mp.name AS label,
            mp.code,
            NULLIF(CONCAT_WS(' | ', NULLIF(mp.g_code, ''), NULLIF(mp.g_code3, ''), NULLIF(mp.g_code5, ''), NULLIF(mp.g_code6, ''), NULLIF(mp.unit, ''), mp.pid), '') AS description,
            'MARG'::text AS source,
            CASE
              WHEN mp.code ILIKE ${term} THEN 0
              WHEN mp.name ILIKE ${term} THEN 1
              ELSE 2
            END AS rank
          FROM marg_products mp
          WHERE mp.tenant_id = ${tenantId}::uuid
            AND (${term} = '%%' OR mp.code ILIKE ${term} OR mp.name ILIKE ${term} OR mp.pid ILIKE ${term})
            AND NOT EXISTS (
              SELECT 1 FROM products p
              WHERE p.tenant_id = mp.tenant_id AND (p.id = mp.product_id OR p.code = mp.code)
            )
        ) options
        ORDER BY rank, label
        LIMIT ${safeLimit}
      `);
      return rows;
    }

    if (type === 'customer') {
      const rows = await this.prisma.$queryRaw<Array<{ value: string; label: string; code: string | null; description: string | null; source: 'LOCAL' | 'MARG'; rank: number }>>(Prisma.sql`
        SELECT value, label, code, description, source, rank
        FROM (
          SELECT
            c.code AS value,
            c.name AS label,
            c.code,
            NULLIF(CONCAT_WS(' | ', NULLIF(c.segment, ''), NULLIF(mp.gst_no, ''), NULLIF(COALESCE(mp.phone1, mp.phone2, mp.phone3, mp.phone4), '')), '') AS description,
            'LOCAL'::text AS source,
            CASE
              WHEN c.code ILIKE ${term} THEN 0
              WHEN c.name ILIKE ${term} THEN 1
              ELSE 2
            END AS rank
          FROM customers c
          LEFT JOIN marg_parties mp ON mp.customer_id = c.id
          WHERE c.tenant_id = ${tenantId}::uuid
            AND (${term} = '%%' OR c.code ILIKE ${term} OR c.name ILIKE ${term} OR COALESCE(mp.gst_no, '') ILIKE ${term})
          UNION ALL
          SELECT
            mp.cid AS value,
            mp.par_name AS label,
            mp.cid AS code,
            NULLIF(CONCAT_WS(' | ', NULLIF(mp.gst_no, ''), NULLIF(COALESCE(mp.phone1, mp.phone2, mp.phone3, mp.phone4), ''), NULLIF(mp.area, ''), NULLIF(mp.route, '')), '') AS description,
            'MARG'::text AS source,
            CASE
              WHEN mp.cid ILIKE ${term} THEN 0
              WHEN mp.par_name ILIKE ${term} THEN 1
              ELSE 2
            END AS rank
          FROM marg_parties mp
          WHERE mp.tenant_id = ${tenantId}::uuid
            AND mp.is_deleted = false
            AND (${term} = '%%' OR mp.cid ILIKE ${term} OR mp.par_name ILIKE ${term} OR COALESCE(mp.gst_no, '') ILIKE ${term} OR COALESCE(mp.phone1, '') ILIKE ${term})
            AND EXISTS (
              SELECT 1 FROM marg_vouchers mv
              WHERE mv.tenant_id = mp.tenant_id AND mv.company_id = mp.company_id AND mv.cid = mp.cid AND mv.type = 'S'
            )
            AND NOT EXISTS (
              SELECT 1 FROM customers c
              WHERE c.tenant_id = mp.tenant_id AND (c.id = mp.customer_id OR c.code = mp.cid)
            )
        ) options
        ORDER BY rank, label
        LIMIT ${safeLimit}
      `);
      return rows;
    }

    if (type === 'supplier') {
      const rows = await this.prisma.$queryRaw<Array<{ value: string; label: string; code: string | null; description: string | null; source: 'LOCAL' | 'MARG'; rank: number }>>(Prisma.sql`
        SELECT value, label, code, description, source, rank
        FROM (
          SELECT
            s.code AS value,
            s.name AS label,
            s.code,
            NULLIF(CONCAT_WS(' | ', NULLIF(s.contact_name, ''), NULLIF(s.phone, ''), NULLIF(s.payment_terms, ''), NULLIF(mp.gst_no, '')), '') AS description,
            'LOCAL'::text AS source,
            CASE
              WHEN s.code ILIKE ${term} THEN 0
              WHEN s.name ILIKE ${term} THEN 1
              ELSE 2
            END AS rank
          FROM suppliers s
          LEFT JOIN marg_parties mp
            ON mp.tenant_id = s.tenant_id
            AND (
              s.external_id = CONCAT('marg:', mp.company_id::text, ':', mp.cid)
              OR COALESCE(s.attributes->>'margCid', '') = mp.cid
            )
          WHERE s.tenant_id = ${tenantId}::uuid
            AND (${term} = '%%' OR s.code ILIKE ${term} OR s.name ILIKE ${term} OR COALESCE(mp.gst_no, '') ILIKE ${term})
          UNION ALL
          SELECT
            mp.cid AS value,
            mp.par_name AS label,
            mp.cid AS code,
            NULLIF(CONCAT_WS(' | ', NULLIF(mp.gst_no, ''), NULLIF(COALESCE(mp.phone1, mp.phone2, mp.phone3, mp.phone4), ''), NULLIF(mp.area, ''), NULLIF(mp.route, '')), '') AS description,
            'MARG'::text AS source,
            CASE
              WHEN mp.cid ILIKE ${term} THEN 0
              WHEN mp.par_name ILIKE ${term} THEN 1
              ELSE 2
            END AS rank
          FROM marg_parties mp
          WHERE mp.tenant_id = ${tenantId}::uuid
            AND mp.is_deleted = false
            AND (${term} = '%%' OR mp.cid ILIKE ${term} OR mp.par_name ILIKE ${term} OR COALESCE(mp.gst_no, '') ILIKE ${term} OR COALESCE(mp.phone1, '') ILIKE ${term})
            AND EXISTS (
              SELECT 1 FROM marg_vouchers mv
              WHERE mv.tenant_id = mp.tenant_id AND mv.company_id = mp.company_id AND mv.cid = mp.cid AND mv.type = 'P'
            )
            AND NOT EXISTS (
              SELECT 1 FROM suppliers s
              WHERE s.tenant_id = mp.tenant_id
                AND (
                  s.code = mp.cid
                  OR s.external_id = CONCAT('marg:', mp.company_id::text, ':', mp.cid)
                  OR COALESCE(s.attributes->>'margCid', '') = mp.cid
                )
            )
        ) options
        ORDER BY rank, label
        LIMIT ${safeLimit}
      `);
      return rows;
    }

    if (type === 'route') {
      const rows = await this.prisma.$queryRaw<Array<{ value: string; label: string; code: string | null; description: string | null; source: 'LOCAL' | 'MARG' }>>(Prisma.sql`
        SELECT s_code AS value, COALESCE(name, s_code) AS label, s_code AS code, NULL::text AS description, 'MARG'::text AS source
        FROM marg_sale_types
        WHERE tenant_id = ${tenantId}::uuid AND sg_code = 'ROUT'
          AND (${term} = '%%' OR s_code ILIKE ${term} OR name ILIKE ${term})
        ORDER BY name
        LIMIT ${safeLimit}
      `);
      return rows;
    }

    if (type === 'city') {
      const rows = await this.prisma.$queryRaw<Array<{ value: string; label: string; code: string | null; description: string | null; source: 'LOCAL' | 'MARG' }>>(Prisma.sql`
        SELECT s_code AS value, COALESCE(name, s_code) AS label, s_code AS code, NULL::text AS description, 'MARG'::text AS source
        FROM marg_sale_types
        WHERE tenant_id = ${tenantId}::uuid AND sg_code = 'AREA'
          AND (${term} = '%%' OR s_code ILIKE ${term} OR name ILIKE ${term})
        ORDER BY name
        LIMIT ${safeLimit}
      `);
      return rows;
    }

    if (type === 'salesman') {
      const rows = await this.prisma.$queryRaw<Array<{ value: string; label: string; code: string | null; description: string | null; source: 'LOCAL' | 'MARG' }>>(Prisma.sql`
        SELECT value, label, code, description, source FROM (
          SELECT
            s.code AS value,
            COALESCE(s.name, s.code) AS label,
            s.code,
            NULL::text AS description,
            'LOCAL'::text AS source,
            CASE WHEN s.code ILIKE ${term} THEN 0 WHEN s.name ILIKE ${term} THEN 1 ELSE 2 END AS rank
          FROM salesmen s
          WHERE s.tenant_id = ${tenantId}::uuid
            AND (${term} = '%%' OR s.code ILIKE ${term} OR s.name ILIKE ${term})
          UNION ALL
          SELECT
            COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) AS value,
            COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) AS label,
            COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) AS code,
            NULL::text AS description,
            'MARG'::text AS source,
            1 AS rank
          FROM marg_vouchers mv
          WHERE mv.tenant_id = ${tenantId}::uuid
            AND COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) IS NOT NULL
            AND (${term} = '%%' OR COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) ILIKE ${term})
            AND NOT EXISTS (
              SELECT 1 FROM salesmen s WHERE s.tenant_id = mv.tenant_id AND s.code = COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''))
            )
          GROUP BY COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''))
        ) options
        ORDER BY rank, label
        LIMIT ${safeLimit}
      `);
      return rows;
    }

    throw new BadRequestException('type must be item, customer, supplier, route, city, or salesman');
  }

  async getCustomer360(tenantId: string, search?: string, period: PeriodKey = 'fy', locationId?: string) {
    const ctx = await this.getContext(tenantId, period);
    const customer = await this.findCustomer(tenantId, search);
    if (!customer) throw new NotFoundException('No customer found for the selected search.');

    const isAllCustomers = customer.is_all === true;
    const margCustomerFilter = isAllCustomers
      ? Prisma.sql`TRUE`
      : customer.cid
      ? Prisma.sql`mv.company_id = ${customer.company_id} AND mv.cid = ${customer.cid}`
      : Prisma.sql`FALSE`;
    const outstandingFilter = isAllCustomers
      ? Prisma.sql`TRUE`
      : customer.cid
      ? Prisma.sql`mo.company_id = ${customer.company_id} AND mo.ord = ${customer.cid}`
      : Prisma.sql`FALSE`;
    // Customer sales totals must exclude S/CHAL challans (no A/C impact) and
    // subtract R/CN returns. Per-row sign = margSalesAmountSignSql: invoice +1,
    // return -1, challan/SC/other 0. The header filter loads both S and R so
    // returns can contribute their negative contra; CHAL vouchers stay loaded
    // (sign = 0) so invoice_count remains stable for callers that consume it.
    const voucherSalesP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.monthStart}::date AND mv.date < ${ctx.nextMonthStart}::date), 0)::float8 AS current_month_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.lastMonthStart}::date AND mv.date < ${ctx.monthStart}::date), 0)::float8 AS last_month_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date), 0)::float8 AS current_year_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.priorFiscalStart}::date AND mv.date < ${ctx.priorFiscalEnd}::date), 0)::float8 AS last_year_sales,
        COUNT(DISTINCT mv.voucher) FILTER (WHERE ${margVoucherFamilySql('mv')} = 'SALES_INVOICE' AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date)::int AS invoice_count,
        MAX(mv.date) FILTER (WHERE ${margVoucherFamilySql('mv')} = 'SALES_INVOICE') AS last_invoice_date
      FROM marg_vouchers mv
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R') AND ${margCustomerFilter}
    `);

    const outstandingP = this.getOutstandingSnapshot(tenantId, customer.cid, customer.company_id, 'CUSTOMER');

    const monthlyTrendP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        to_char(month_bucket, 'Mon YYYY') AS month,
        COALESCE(SUM(mv.final_amt * ${margSalesAmountSignSql('mv')}), 0)::float8 AS sales_value
      FROM generate_series(date_trunc('month', ${ctx.trendStart}::date), date_trunc('month', ${ctx.asOf}::date), interval '1 month') month_bucket
      LEFT JOIN marg_vouchers mv
        ON mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE
        AND mv.type IN ('S', 'R')
        AND ${margCustomerFilter}
        AND date_trunc('month', mv.date) = month_bucket
      GROUP BY month_bucket
      ORDER BY month_bucket
    `);

    const topItemsP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ROW_NUMBER() OVER (ORDER BY SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}) DESC)::int AS rank,
        COALESCE(p.name, mprod.name, CONCAT('Missing item master: ', mt.pid), 'Missing item reference') AS name,
        COALESCE(p.code, mprod.code, mt.pid) AS code,
        CASE WHEN NULLIF(TRIM(COALESCE(p.product_company, mprod.g_code)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.product_company, mprod.g_code)) || ' - ' || COALESCE(pc.name, 'Unknown company (' || TRIM(COALESCE(p.product_company, mprod.g_code)) || ')') END AS company,
        CASE WHEN NULLIF(TRIM(COALESCE(p.salt, mprod.g_code3)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.salt, mprod.g_code3)) || ' - ' || COALESCE(ps.name, 'Unknown salt (' || TRIM(COALESCE(p.salt, mprod.g_code3)) || ')') END AS salt,
        CASE WHEN NULLIF(TRIM(COALESCE(p.product_group, mprod.g_code5)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.product_group, mprod.g_code5)) || ' - ' || COALESCE(pg.name, 'Unknown group (' || TRIM(COALESCE(p.product_group, mprod.g_code5)) || ')') END AS "productGroup",
        mprod.g_code6 AS "hsnCode",
        CASE WHEN p.id IS NOT NULL THEN 'MAPPED' WHEN mprod.id IS NOT NULL THEN 'STAGED_PRODUCT_NOT_PROJECTED' ELSE 'MISSING_MARG_PRODUCT_MASTER' END AS "mappingStatus",
        NULL::text AS "missingReason",
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS quantity,
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS value
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleSalesLineSql('mv', 'mt')}
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
      LEFT JOIN products p ON p.tenant_id = mt.tenant_id AND p.id = mprod.product_id
      LEFT JOIN product_companies pc ON pc.tenant_id = mt.tenant_id AND pc.code = NULLIF(TRIM(COALESCE(p.product_company, mprod.g_code)), '')
      LEFT JOIN product_salts ps ON ps.tenant_id = mt.tenant_id AND ps.code = NULLIF(TRIM(COALESCE(p.salt, mprod.g_code3)), '')
      LEFT JOIN product_categories pg ON pg.tenant_id = mt.tenant_id AND pg.code = NULLIF(TRIM(COALESCE(p.product_group, mprod.g_code5)), '')
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE
        AND mv.type IN ('S', 'R')
        AND ${margCustomerFilter}
        AND mv.date >= ${ctx.periodStart}::date
        AND mv.date <= ${ctx.periodEnd}::date
      GROUP BY COALESCE(p.name, mprod.name, CONCAT('Missing item master: ', mt.pid), 'Missing item reference'),
        COALESCE(p.code, mprod.code, mt.pid), COALESCE(p.product_company, mprod.g_code), COALESCE(p.salt, mprod.g_code3),
        COALESCE(p.product_group, mprod.g_code5), pc.name, ps.name, pg.name, mprod.g_code6, mt.tenant_id,
        CASE WHEN p.id IS NOT NULL THEN 'MAPPED' WHEN mprod.id IS NOT NULL THEN 'STAGED_PRODUCT_NOT_PROJECTED' ELSE 'MISSING_MARG_PRODUCT_MASTER' END
      ORDER BY value DESC
      LIMIT 5
    `);

    const paymentDelayTrendP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        to_char(month_bucket, 'Mon YYYY') AS month,
        COALESCE(AVG(GREATEST(GREATEST(COALESCE(NULLIF(mo.days, 0), CURRENT_DATE - mo.date::date), 0) - COALESCE(${customer.credit_days ?? 0}, 0), 0)), 0)::float8 AS delay_days
      FROM generate_series(date_trunc('month', ${ctx.trendStart}::date), date_trunc('month', ${ctx.asOf}::date), interval '1 month') month_bucket
      LEFT JOIN marg_outstandings mo
        ON mo.tenant_id = ${tenantId}::uuid
        AND mo.source_deleted = FALSE
        AND ${outstandingFilter}
        AND COALESCE(mo.balance, 0) <> 0
        AND COALESCE(mo.group_code, '') LIKE 'C%'
        AND date_trunc('month', mo.date) = month_bucket
      GROUP BY month_bucket
      ORDER BY month_bucket
    `);

    // returnInsight reports only true SALES_RETURN (R/CN). SC (T) is a
    // price-difference accounting credit, not a goods return, so it must
    // not contribute to return_value / return_qty / return_count.
    const returnInsightP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0))), 0)::float8 AS return_value,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)::float8 AS return_qty,
        COUNT(DISTINCT mv.company_id || ':' || mv.voucher)::int AS return_count
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleSalesLineSql('mv', 'mt')}
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE
        AND ${margVoucherFamilySql('mv')} = 'SALES_RETURN'
        AND ${margCustomerFilter}
        AND mv.date >= ${ctx.periodStart}::date
        AND mv.date <= ${ctx.periodEnd}::date
    `);

    // Profitability over the customer's true sales activity: invoices add,
    // returns subtract, challan / SC contribute zero. Filtering by
    // family='SALES_INVOICE' alone would ignore returns; this signed sum is
    // consistent with the headline sales_value the customer sees.
    const profitabilityP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS sales_value,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS estimated_cost
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleSalesLineSql('mv', 'mt')}
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
      LEFT JOIN products p ON p.tenant_id = mt.tenant_id AND p.id = mprod.product_id
      LEFT JOIN LATERAL (
        SELECT p_rate, lp_rate FROM marg_stocks ms
        WHERE ms.tenant_id = mt.tenant_id AND ms.company_id = mt.company_id AND ms.pid = mt.pid
        ORDER BY ms.updated_at DESC LIMIT 1
      ) ms ON TRUE
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE
        AND mv.type IN ('S', 'R')
        AND ${margCustomerFilter}
        AND mv.date >= ${ctx.periodStart}::date
        AND mv.date <= ${ctx.periodEnd}::date
    `);

    const lastPaymentP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        map.date AS last_payment_date,
        ABS(map.amount)::float8 AS last_payment_amount
      FROM marg_account_postings map
      WHERE map.tenant_id = ${tenantId}::uuid
        AND ${isAllCustomers ? Prisma.sql`TRUE` : customer.cid ? Prisma.sql`map.company_id = ${customer.company_id} AND (map.code = ${customer.cid} OR map.code1 = ${customer.cid})` : Prisma.sql`FALSE`}
        AND map.date <= ${ctx.periodEnd}::date
      ORDER BY map.date DESC, ABS(map.amount) DESC
      LIMIT 1
    `);

    // All of the above are independent reads — resolve them concurrently so the
    // endpoint latency is the slowest single query, not the sum of all of them.
    // The SQL is byte-for-byte unchanged; only the execution is parallelised.
    const [
      voucherSalesRows,
      outstanding,
      monthlyTrend,
      topItems,
      paymentDelayTrend,
      returnInsightRows,
      profitabilityRows,
      lastPaymentRows,
    ] = await Promise.all([
      voucherSalesP,
      outstandingP,
      monthlyTrendP,
      topItemsP,
      paymentDelayTrendP,
      returnInsightP,
      profitabilityP,
      lastPaymentP,
    ]);
    const [voucherSales] = voucherSalesRows;
    const salesBase = voucherSales;
    const [returnInsight] = returnInsightRows;
    const [profitability] = profitabilityRows;
    const [lastPayment] = lastPaymentRows;

    const currentMonthSales = Number(salesBase.current_month_sales ?? 0);
    const lastMonthSales = Number(salesBase.last_month_sales ?? 0);
    const totalOutstanding = Number(outstanding.total_outstanding ?? 0);
    const creditLimit = Number(customer.credit_limit ?? customer.marg_credit ?? 0);
    const invoiceCount = Number(salesBase.invoice_count ?? 0);
    const selectedDays = this.periodDays(ctx);

    return {
      asOf: ctx.asOf,
      profile: {
        code: customer.code,
        name: customer.name,
        type: customer.type,
        gstNo: customer.gst_no,
        phone: customer.phone,
        creditLimit,
        creditDays: isAllCustomers ? null : customer.credit_days,
        salesPerson: customer.sales_person,
        lastInvoiceDate: salesBase.last_invoice_date,
      },
      kpis: {
        currentMonthSales,
        lastMonthSales,
        momSalesChangePct: this.pctChange(currentMonthSales, lastMonthSales),
        currentYearSales: Number(salesBase.current_year_sales ?? 0),
        yoySalesChangePct: this.pctChange(Number(salesBase.current_year_sales ?? 0), Number(salesBase.last_year_sales ?? 0)),
        outstandingAmount: totalOutstanding,
        creditBalance: Number(outstanding.credit_balance ?? 0),
        notDueAmount: Number(outstanding.bucket_0_30 ?? 0),
        dueThisWeekAmount: Number(outstanding.bucket_31_60 ?? 0),
        overdueAmount: Number(outstanding.bucket_31_60 ?? 0) + Number(outstanding.bucket_61_90 ?? 0) + Number(outstanding.bucket_91_plus ?? 0),
        averagePaymentDays: Number(outstanding.avg_payment_days ?? 0),
        lastPaymentAmount: lastPayment?.last_payment_amount == null ? null : Number(lastPayment.last_payment_amount),
        creditLimitUsagePct: creditLimit > 0 ? totalOutstanding / creditLimit * 100 : null,
        invoiceCount,
        riskScore: this.customerRiskScore(totalOutstanding, creditLimit, Number(outstanding.bucket_91_plus ?? 0)),
      },
      ageing: this.ageingRows(outstanding, isAllCustomers ? 'Party' : 'Invoice'),
      charts: { monthlyTrend, paymentDelayTrend },
      tables: {
        topItems: this.addShare(topItems),
        returnInsight: {
          returnValue: Number(returnInsight.return_value ?? 0),
          returnQty: Number(returnInsight.return_qty ?? 0),
          returnCount: Number(returnInsight.return_count ?? 0),
          returnPct: Number(salesBase.current_year_sales ?? 0) > 0 ? Number(returnInsight.return_value ?? 0) / Number(salesBase.current_year_sales ?? 0) * 100 : null,
        },
        profitability: {
          salesValue: Number(profitability.sales_value ?? 0),
          estimatedCost: Number(profitability.estimated_cost ?? 0),
          grossMargin: Number(profitability.sales_value ?? 0) - Number(profitability.estimated_cost ?? 0),
          marginPct: Number(profitability.sales_value ?? 0) > 0
            ? (Number(profitability.sales_value ?? 0) - Number(profitability.estimated_cost ?? 0)) / Number(profitability.sales_value ?? 0) * 100
            : null,
        },
        loyalty: {
          invoiceCount,
          purchaseFrequency: invoiceCount / selectedDays,
          inactiveDays: this.daysSince(salesBase.last_invoice_date, ctx.asOf),
          lastInvoiceDate: salesBase.last_invoice_date,
          lastPaymentDate: lastPayment?.last_payment_date ?? null,
          averagePaymentDays: Number(outstanding.avg_payment_days ?? 0),
        },
      },
      insights: this.customerInsights(totalOutstanding, creditLimit, Number(outstanding.bucket_91_plus ?? 0), currentMonthSales, lastMonthSales),
    };
  }

  async getSupplier360(tenantId: string, search?: string, period: PeriodKey = 'fy', locationId?: string) {
    const ctx = await this.getContext(tenantId, period);
    const supplier = await this.findSupplier(tenantId, search);
    if (!supplier) throw new NotFoundException('No supplier found for the selected search.');

    const isAllSuppliers = supplier.is_all === true;
    const margSupplierFilter = isAllSuppliers
      ? Prisma.sql`TRUE`
      : supplier.cid
      ? Prisma.sql`mv.company_id = ${supplier.company_id} AND mv.cid = ${supplier.cid}`
      : Prisma.sql`FALSE`;
    const localSupplierFilter = isAllSuppliers
      ? Prisma.sql`TRUE`
      : supplier.supplier_id
      ? Prisma.sql`po.supplier_id = ${supplier.supplier_id}::uuid`
      : Prisma.sql`FALSE`;
    const poLocationFilter = locationId ? Prisma.sql`AND po.location_id = ${locationId}::uuid` : Prisma.empty;

    // Family-signed purchase totals: PURCHASE_INVOICE +1, PURCHASE_RETURN -1,
    // everything else 0. The header filter widens from 'P' to ('P','B') so
    // DN purchase returns can subtract from the supplier's net purchases;
    // the sign helper takes care of the directionality. Mirrors the
    // sales-side family-aware aggregation introduced for customer 360.
    const purchaseP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margPurchaseAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.monthStart}::date AND mv.date < ${ctx.nextMonthStart}::date), 0)::float8 AS current_month_purchase,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margPurchaseAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.lastMonthStart}::date AND mv.date < ${ctx.monthStart}::date), 0)::float8 AS last_month_purchase,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margPurchaseAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date), 0)::float8 AS current_year_purchase,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margPurchaseAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.priorFiscalStart}::date AND mv.date < ${ctx.priorFiscalEnd}::date), 0)::float8 AS last_year_purchase,
        COUNT(DISTINCT mv.voucher) FILTER (WHERE ${margVoucherFamilySql('mv')} = 'PURCHASE_INVOICE' AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date)::int AS purchase_invoice_count,
        MAX(mv.date) FILTER (WHERE ${margVoucherFamilySql('mv')} = 'PURCHASE_INVOICE') AS last_purchase_date
      FROM marg_vouchers mv
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('P', 'B') AND ${margSupplierFilter}
    `);

    const payableP = this.getOutstandingSnapshot(tenantId, supplier.cid, supplier.company_id, 'SUPPLIER');

    const performanceP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH filtered_pos AS (
        SELECT po.*
        FROM purchase_orders po
        WHERE po.tenant_id = ${tenantId}::uuid
          AND ${localSupplierFilter}
          ${poLocationFilter}
      ),
      po_line_rollup AS (
        SELECT
          pol.purchase_order_id,
          COALESCE(SUM(pol.quantity), 0)::float8 AS ordered_qty,
          COALESCE(SUM(pol.received_qty), 0)::float8 AS received_qty,
          COALESCE(SUM(GREATEST(pol.quantity - pol.received_qty, 0)), 0)::float8 AS pending_qty,
          COALESCE(SUM(GREATEST(pol.quantity - pol.received_qty, 0) * pol.unit_price), 0)::float8 AS open_po_value
        FROM purchase_order_lines pol
        JOIN filtered_pos po ON po.id = pol.purchase_order_id
        GROUP BY pol.purchase_order_id
      ),
      receipt_rollup AS (
        SELECT
          po.id AS purchase_order_id,
          MIN(gr.receipt_date) FILTER (WHERE gr.status = 'POSTED') AS first_receipt_date,
          COALESCE(SUM(grl.quantity) FILTER (WHERE gr.status = 'POSTED'), 0)::float8 AS received_qty
        FROM filtered_pos po
        LEFT JOIN goods_receipts gr ON gr.purchase_order_id = po.id
        LEFT JOIN goods_receipt_lines grl ON grl.goods_receipt_id = gr.id
        GROUP BY po.id
      ),
      quality_rollup AS (
        SELECT
          COALESCE(SUM(qi.inspected_qty), 0)::float8 AS inspected_qty,
          COALESCE(SUM(qi.rejected_qty), 0)::float8 AS rejected_qty,
          COUNT(*) FILTER (WHERE COALESCE(qi.rejected_qty, 0) > 0)::int AS rejection_cases,
          MAX(qi.inspection_date) FILTER (WHERE COALESCE(qi.rejected_qty, 0) > 0) AS last_qc_issue_date
        FROM filtered_pos po
        JOIN quality_inspections qi ON qi.purchase_order_id = po.id AND qi.tenant_id = ${tenantId}::uuid
      )
      SELECT
        COUNT(po.id)::int AS total_orders,
        COALESCE(AVG(CASE WHEN rr.first_receipt_date IS NOT NULL THEN GREATEST((rr.first_receipt_date::date - po.order_date::date), 0) END), NULL)::float8 AS avg_lead_time_days,
        COALESCE(MIN(CASE WHEN rr.first_receipt_date IS NOT NULL THEN GREATEST((rr.first_receipt_date::date - po.order_date::date), 0) END), NULL)::float8 AS best_lead_time_days,
        CASE WHEN COUNT(rr.first_receipt_date) > 0
          THEN COUNT(*) FILTER (WHERE rr.first_receipt_date <= po.expected_date)::float8 / COUNT(rr.first_receipt_date)::float8 * 100
          ELSE NULL
        END::float8 AS on_time_delivery_pct,
        COUNT(*) FILTER (WHERE rr.first_receipt_date IS NOT NULL AND rr.first_receipt_date > po.expected_date)::int AS delayed_deliveries,
        CASE WHEN SUM(COALESCE(pl.ordered_qty, 0)) > 0 THEN LEAST(SUM(COALESCE(rr.received_qty, 0)), SUM(COALESCE(pl.ordered_qty, 0)))::float8 / SUM(COALESCE(pl.ordered_qty, 0))::float8 * 100 ELSE NULL END::float8 AS fulfillment_rate_pct,
        CASE WHEN SUM(COALESCE(pl.ordered_qty, 0)) > 0 THEN SUM(COALESCE(pl.pending_qty, 0))::float8 / SUM(COALESCE(pl.ordered_qty, 0))::float8 * 100 ELSE NULL END::float8 AS short_supply_pct,
        COALESCE(SUM(pl.open_po_value) FILTER (WHERE po.status NOT IN ('CLOSED', 'CANCELLED')), 0)::float8 AS open_po_value,
        COALESCE(SUM(pl.pending_qty) FILTER (WHERE po.status NOT IN ('CLOSED', 'CANCELLED')), 0)::float8 AS pending_po_qty,
        COUNT(DISTINCT po.id) FILTER (WHERE po.status NOT IN ('CLOSED', 'CANCELLED') AND COALESCE(pl.pending_qty, 0) > 0)::int AS open_po_count,
        CASE WHEN MAX(qr.inspected_qty) > 0 THEN MAX(qr.rejected_qty) / MAX(qr.inspected_qty) * 100 ELSE NULL END::float8 AS rejection_rate_pct,
        COALESCE(MAX(qr.rejection_cases), 0)::int AS rejection_cases,
        COALESCE(MAX(qr.rejected_qty), 0)::float8 AS damaged_qty,
        MAX(qr.last_qc_issue_date) AS last_qc_issue_date
      FROM filtered_pos po
      LEFT JOIN po_line_rollup pl ON pl.purchase_order_id = po.id
      LEFT JOIN receipt_rollup rr ON rr.purchase_order_id = po.id
      CROSS JOIN quality_rollup qr
    `);

    // Supplier topItems uses purchase-side family signing so DN purchase
    // returns net out against the prior P invoice for the same item. Loads
    // both P and B header types and the corresponding line types via
    // compatiblePurchaseLineSql; mt.is_cancelled = FALSE keeps cancelled
    // lines out of the rollup.
    const topItemsP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ROW_NUMBER() OVER (ORDER BY SUM(ABS(COALESCE(mt.amount, 0)) * ${margPurchaseAmountSignSql('mv')}) DESC)::int AS rank,
        COALESCE(p.name, mp.name, CONCAT('Missing item master: ', mt.pid), 'Missing item reference') AS name,
        COALESCE(p.code, mp.code, mt.pid) AS code,
        CASE WHEN NULLIF(TRIM(COALESCE(p.product_company, mp.g_code)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.product_company, mp.g_code)) || ' - ' || COALESCE(pc.name, 'Unknown company (' || TRIM(COALESCE(p.product_company, mp.g_code)) || ')') END AS company,
        CASE WHEN NULLIF(TRIM(COALESCE(p.salt, mp.g_code3)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.salt, mp.g_code3)) || ' - ' || COALESCE(ps.name, 'Unknown salt (' || TRIM(COALESCE(p.salt, mp.g_code3)) || ')') END AS salt,
        CASE WHEN NULLIF(TRIM(COALESCE(p.product_group, mp.g_code5)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.product_group, mp.g_code5)) || ' - ' || COALESCE(pg.name, 'Unknown group (' || TRIM(COALESCE(p.product_group, mp.g_code5)) || ')') END AS "productGroup",
        mp.g_code6 AS "hsnCode",
        CASE
          WHEN p.id IS NOT NULL THEN 'MAPPED'
          WHEN mp.id IS NOT NULL THEN 'STAGED_PRODUCT_NOT_PROJECTED'
          WHEN mt.pid IS NOT NULL THEN 'MISSING_MARG_PRODUCT_MASTER'
          ELSE 'ACTUAL_MISSING_PRODUCT_ID'
        END AS "mappingStatus",
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * ${margPurchaseAmountSignSql('mv')}), 0)::float8 AS quantity,
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margPurchaseAmountSignSql('mv')}), 0)::float8 AS value
      FROM marg_transactions mt
      LEFT JOIN marg_products mp ON mp.tenant_id = mt.tenant_id AND mp.company_id = mt.company_id AND mp.pid = mt.pid
      LEFT JOIN products p ON p.id = mp.product_id
      LEFT JOIN product_companies pc ON pc.tenant_id = mt.tenant_id AND pc.code = NULLIF(TRIM(COALESCE(p.product_company, mp.g_code)), '')
      LEFT JOIN product_salts ps ON ps.tenant_id = mt.tenant_id AND ps.code = NULLIF(TRIM(COALESCE(p.salt, mp.g_code3)), '')
      LEFT JOIN product_categories pg ON pg.tenant_id = mt.tenant_id AND pg.code = NULLIF(TRIM(COALESCE(p.product_group, mp.g_code5)), '')
      JOIN marg_vouchers mv
        ON mv.tenant_id = mt.tenant_id
        AND mv.company_id = mt.company_id
        AND mv.voucher = mt.voucher
        AND mv.is_cancelled = FALSE
        AND ${this.compatiblePurchaseLineSql('mv', 'mt')}
      WHERE mt.tenant_id = ${tenantId}::uuid
        AND mt.is_cancelled = FALSE
        AND mt.type IN ('P', 'B')
        AND ${margSupplierFilter}
        AND mt.date >= ${ctx.periodStart}::date
        AND mt.date <= ${ctx.periodEnd}::date
      GROUP BY COALESCE(p.name, mp.name, CONCAT('Missing item master: ', mt.pid), 'Missing item reference'),
        COALESCE(p.code, mp.code, mt.pid),
        COALESCE(p.product_company, mp.g_code),
        COALESCE(p.salt, mp.g_code3),
        COALESCE(p.product_group, mp.g_code5),
        pc.name,
        ps.name,
        pg.name,
        mp.g_code6,
        mt.tenant_id,
        CASE
          WHEN p.id IS NOT NULL THEN 'MAPPED'
          WHEN mp.id IS NOT NULL THEN 'STAGED_PRODUCT_NOT_PROJECTED'
          WHEN mt.pid IS NOT NULL THEN 'MISSING_MARG_PRODUCT_MASTER'
          ELSE 'ACTUAL_MISSING_PRODUCT_ID'
        END
      ORDER BY value DESC
      LIMIT 5
    `);

    // Family-signed monthly purchase trend: P invoices add, B/DN returns
    // subtract, everything else 0. Headers widen to ('P','B') so returns are
    // visible to the sign multiplier.
    const monthlyTrendP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        to_char(month_bucket, 'Mon YYYY') AS month,
        COALESCE(SUM(mv.final_amt * ${margPurchaseAmountSignSql('mv')}), 0)::float8 AS purchase_value
      FROM generate_series(date_trunc('month', ${ctx.trendStart}::date), date_trunc('month', ${ctx.asOf}::date), interval '1 month') month_bucket
      LEFT JOIN marg_vouchers mv
        ON mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE
        AND mv.type IN ('P', 'B')
        AND ${margSupplierFilter}
        AND date_trunc('month', mv.date) = month_bucket
      GROUP BY month_bucket
      ORDER BY month_bucket
    `);

    const openOrdersP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        po.order_number,
        po.order_date,
        po.expected_date,
        COALESCE(po.total_amount, SUM(pol.quantity * pol.unit_price), 0)::float8 AS po_value,
        COALESCE(SUM(pol.quantity), 0)::float8 AS ordered_qty,
        COALESCE(SUM(pol.received_qty), 0)::float8 AS received_qty,
        COALESCE(SUM(GREATEST(pol.quantity - pol.received_qty, 0)), 0)::float8 AS pending_qty,
        CASE WHEN SUM(pol.quantity) > 0 THEN SUM(pol.received_qty)::float8 / SUM(pol.quantity)::float8 * 100 ELSE NULL END::float8 AS received_pct,
        CASE WHEN SUM(pol.quantity) > 0 THEN SUM(GREATEST(pol.quantity - pol.received_qty, 0))::float8 / SUM(pol.quantity)::float8 * 100 ELSE NULL END::float8 AS pending_pct,
        po.status::text AS status
      FROM purchase_orders po
      JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
      WHERE po.tenant_id = ${tenantId}::uuid
        AND ${localSupplierFilter}
        ${poLocationFilter}
        AND po.status NOT IN ('CLOSED', 'CANCELLED')
      GROUP BY po.id, po.order_number, po.order_date, po.expected_date, po.total_amount, po.status
      HAVING SUM(GREATEST(pol.quantity - pol.received_qty, 0)) > 0
      ORDER BY po.expected_date ASC
      LIMIT 8
    `);

    const deliveryTrendP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH receipt_rollup AS (
        SELECT
          po.id AS purchase_order_id,
          MIN(gr.receipt_date) FILTER (WHERE gr.status = 'POSTED') AS first_receipt_date
        FROM purchase_orders po
        LEFT JOIN goods_receipts gr ON gr.purchase_order_id = po.id
        WHERE po.tenant_id = ${tenantId}::uuid
          AND ${localSupplierFilter}
          ${poLocationFilter}
        GROUP BY po.id
      )
      SELECT
        to_char(month_bucket, 'Mon YYYY') AS month,
        COUNT(po.id)::int AS total_orders,
        COUNT(po.id) FILTER (WHERE rr.first_receipt_date IS NOT NULL AND rr.first_receipt_date <= po.expected_date)::int AS on_time_orders,
        CASE WHEN COUNT(po.id) FILTER (WHERE rr.first_receipt_date IS NOT NULL) > 0
          THEN COUNT(po.id) FILTER (WHERE rr.first_receipt_date IS NOT NULL AND rr.first_receipt_date <= po.expected_date)::float8
            / COUNT(po.id) FILTER (WHERE rr.first_receipt_date IS NOT NULL)::float8 * 100
          ELSE NULL
        END::float8 AS on_time_delivery_pct
      FROM generate_series(date_trunc('month', ${ctx.trendStart}::date), date_trunc('month', ${ctx.asOf}::date), interval '1 month') month_bucket
      LEFT JOIN purchase_orders po
        ON po.tenant_id = ${tenantId}::uuid
        AND ${localSupplierFilter}
        ${poLocationFilter}
        AND date_trunc('month', po.order_date) = month_bucket
      LEFT JOIN receipt_rollup rr ON rr.purchase_order_id = po.id
      GROUP BY month_bucket
      ORDER BY month_bucket
    `);

    const priceVarianceP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH item_rates AS (
        SELECT
          mt.pid,
          COALESCE(p.name, mp.name, CONCAT('Missing item master: ', mt.pid), 'Missing item reference') AS item_name,
          AVG(COALESCE(mt.rate, 0)) FILTER (WHERE mt.date >= ${ctx.periodStart}::date AND mt.date <= ${ctx.periodEnd}::date) AS current_rate,
          AVG(COALESCE(mt.rate, 0)) FILTER (WHERE mt.date >= ${ctx.priorFiscalStart}::date AND mt.date < ${ctx.periodStart}::date) AS previous_rate
        FROM marg_transactions mt
        LEFT JOIN marg_products mp ON mp.tenant_id = mt.tenant_id AND mp.company_id = mt.company_id AND mp.pid = mt.pid
        LEFT JOIN products p ON p.id = mp.product_id
      JOIN marg_vouchers mv
        ON mv.tenant_id = mt.tenant_id
        AND mv.company_id = mt.company_id
        AND mv.voucher = mt.voucher
        AND ${this.compatiblePurchaseLineSql('mv', 'mt')}
        WHERE mt.tenant_id = ${tenantId}::uuid
          AND mt.type = 'P'
          AND ${margSupplierFilter}
          AND mt.date >= ${ctx.priorFiscalStart}::date
          AND mt.date <= ${ctx.periodEnd}::date
        GROUP BY mt.pid, COALESCE(p.name, mp.name, CONCAT('Missing item master: ', mt.pid), 'Missing item reference')
      ),
      variances AS (
        SELECT
          item_name,
          COALESCE(current_rate, 0)::float8 AS current_rate,
          COALESCE(previous_rate, 0)::float8 AS previous_rate,
          CASE WHEN COALESCE(previous_rate, 0) > 0 THEN (COALESCE(current_rate, 0) - previous_rate) / previous_rate * 100 ELSE NULL END::float8 AS variance_pct,
          (COALESCE(current_rate, 0) - COALESCE(previous_rate, 0))::float8 AS variance_amount
        FROM item_rates
        WHERE current_rate IS NOT NULL
      )
      SELECT
        COALESCE(AVG(variance_pct) FILTER (WHERE variance_pct IS NOT NULL), 0)::float8 AS avg_rate_increase_pct,
        COUNT(*) FILTER (WHERE COALESCE(variance_pct, 0) > 0)::int AS items_with_price_increase,
        (ARRAY_AGG(item_name ORDER BY COALESCE(variance_pct, -999999) DESC))[1] AS highest_variance_item,
        COALESCE(MAX(variance_amount), 0)::float8 AS variance_amount
      FROM variances
    `);

    const supplierPerformanceP = isAllSuppliers
      ? Promise.resolve(null)
      : this.getSupplierPerformanceSnapshot(tenantId, supplier, ctx);

    // Independent reads — resolve concurrently (SQL unchanged, execution only).
    const [
      purchaseRows,
      payable,
      performanceRows,
      topItems,
      monthlyTrend,
      openOrders,
      deliveryTrend,
      priceVarianceRows,
      supplierPerformance,
    ] = await Promise.all([
      purchaseP,
      payableP,
      performanceP,
      topItemsP,
      monthlyTrendP,
      openOrdersP,
      deliveryTrendP,
      priceVarianceP,
      supplierPerformanceP,
    ]);
    const [purchase] = purchaseRows;
    const [performance] = performanceRows;
    const [priceVariance] = priceVarianceRows;

    const performanceView = {
      ...performance,
      on_time_delivery_pct: supplierPerformance?.on_time_delivery_pct ?? performance.on_time_delivery_pct,
      avg_lead_time_days: supplierPerformance?.avg_lead_time_days ?? performance.avg_lead_time_days,
      fulfillment_rate_pct: supplierPerformance?.fulfillment_rate_pct ?? performance.fulfillment_rate_pct,
      short_supply_pct: supplierPerformance?.fulfillment_rate_pct == null
        ? performance.short_supply_pct
        : Math.max(0, 100 - Number(supplierPerformance.fulfillment_rate_pct)),
      rejection_rate_pct: supplierPerformance?.rejection_rate_pct ?? performance.rejection_rate_pct,
      total_orders: supplierPerformance?.total_orders ?? performance.total_orders,
    };
    const currentMonthPurchase = Number(purchase.current_month_purchase ?? 0);
    const lastMonthPurchase = Number(purchase.last_month_purchase ?? 0);
    const score = this.supplierScore(Number(performanceView.on_time_delivery_pct ?? 0), Number(performanceView.fulfillment_rate_pct ?? 0), Number(payable.bucket_91_plus ?? 0));

    return {
      asOf: ctx.asOf,
      profile: {
        code: supplier.code,
        name: supplier.name,
        type: supplier.type,
        gstNo: supplier.gst_no,
        phone: supplier.phone,
        contactPerson: supplier.contact_name,
        paymentTerms: supplier.payment_terms,
        avgLeadTimeDays: performanceView.avg_lead_time_days,
        lastPurchaseDate: purchase.last_purchase_date,
      },
      kpis: {
        currentMonthPurchase,
        lastMonthPurchase,
        momPurchaseChangePct: this.pctChange(currentMonthPurchase, lastMonthPurchase),
        currentYearPurchase: Number(purchase.current_year_purchase ?? 0),
        purchaseInvoiceCount: Number(purchase.purchase_invoice_count ?? 0),
        yoyPurchaseChangePct: this.pctChange(Number(purchase.current_year_purchase ?? 0), Number(purchase.last_year_purchase ?? 0)),
        payableAmount: Number(payable.total_outstanding ?? 0),
        supplierAdvanceAmount: Number(payable.credit_balance ?? 0),
        overduePayable: Number(payable.bucket_31_60 ?? 0) + Number(payable.bucket_61_90 ?? 0) + Number(payable.bucket_91_plus ?? 0),
        openPoValue: Number(performanceView.open_po_value ?? 0),
        openPoCount: Number(performanceView.open_po_count ?? 0),
        onTimeDeliveryPct: performanceView.on_time_delivery_pct,
        fulfillmentRatePct: performanceView.fulfillment_rate_pct,
        score,
      },
      ageing: this.ageingRows(payable, isAllSuppliers ? 'Party' : 'Bill'),
      charts: { monthlyTrend, deliveryTrend },
      tables: {
        topItems: this.addShare(topItems),
        openOrders,
        deliveryPerformance: {
          onTimeDeliveryPct: performanceView.on_time_delivery_pct,
          delayedDeliveries: Number(performanceView.delayed_deliveries ?? 0),
          averageLeadTimeDays: performanceView.avg_lead_time_days,
          bestDeliveryTimeDays: performanceView.best_lead_time_days,
          shortSupplyPct: performanceView.short_supply_pct,
          status: Number(performanceView.on_time_delivery_pct ?? 0) >= 85 ? 'Strong' : 'Needs Review',
        },
        quality: {
          rejectionRatePct: performanceView.rejection_rate_pct,
          shortSupplyCases: Number(performanceView.rejection_cases ?? 0),
          damagedQty: Number(performanceView.damaged_qty ?? 0),
          lastQcIssueDate: performanceView.last_qc_issue_date,
          status: Number(performanceView.rejection_rate_pct ?? 0) <= 2 ? 'Good' : 'Review',
        },
        priceVariance: {
          avgRateIncreasePct: priceVariance?.avg_rate_increase_pct == null ? null : Number(priceVariance.avg_rate_increase_pct),
          itemsWithPriceIncrease: Number(priceVariance?.items_with_price_increase ?? 0),
          highestVarianceItem: priceVariance?.highest_variance_item ?? null,
          varianceAmount: Number(priceVariance?.variance_amount ?? 0),
          status: Number(priceVariance?.avg_rate_increase_pct ?? 0) <= 5 ? 'Controlled' : 'Review',
        },
      },
      insights: this.supplierInsights(score, Number(payable.bucket_91_plus ?? 0), Number(performanceView.open_po_value ?? 0), currentMonthPurchase, lastMonthPurchase),
    };
  }

  async getRoute360(tenantId: string, search?: string, period: PeriodKey = 'fy') {
    const ctx = await this.getContext(tenantId, period);
    const route = await this.findRoute(tenantId, search);
    if (!route) throw new NotFoundException('No route found for the selected search.');

    const isAll = route.is_all === true;
    const voucherRouteFilter = isAll
      ? Prisma.sql`TRUE`
      : Prisma.sql`EXISTS (SELECT 1 FROM marg_transactions mt_rf WHERE mt_rf.tenant_id = mv.tenant_id AND mt_rf.company_id = mv.company_id AND mt_rf.voucher = mv.voucher AND NULLIF(TRIM(SPLIT_PART(COALESCE(mt_rf.add_field, ''), ';', 20)), '') = ${route.route_code})`;
    const txnRouteFilter = isAll
      ? Prisma.sql`TRUE`
      : Prisma.sql`NULLIF(TRIM(SPLIT_PART(COALESCE(mt.add_field, ''), ';', 20)), '') = ${route.route_code}`;

    const salesP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.monthStart}::date AND mv.date < ${ctx.nextMonthStart}::date), 0)::float8 AS current_month_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.lastMonthStart}::date AND mv.date < ${ctx.monthStart}::date), 0)::float8 AS last_month_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date), 0)::float8 AS current_period_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.priorFiscalStart}::date AND mv.date < ${ctx.priorFiscalEnd}::date), 0)::float8 AS prior_period_sales,
        COUNT(DISTINCT mv.company_id::text || ':' || mv.voucher) FILTER (WHERE ${margVoucherFamilySql('mv')} = 'SALES_INVOICE' AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date)::int AS bill_count,
        COUNT(DISTINCT mv.cid) FILTER (WHERE mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date)::int AS customer_count
      FROM marg_vouchers mv
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
        AND ${voucherRouteFilter}
    `);

    const monthlyTrendP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        to_char(month_bucket, 'Mon YYYY') AS month,
        COALESCE(SUM(sd.sales_amt), 0)::float8 AS sales_value
      FROM generate_series(date_trunc('month', ${ctx.trendStart}::date), date_trunc('month', ${ctx.asOf}::date), interval '1 month') month_bucket
      LEFT JOIN (
        SELECT date_trunc('month', mv.date) AS mb, (COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')})::float8 AS sales_amt
        FROM marg_vouchers mv
        WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
          AND ${voucherRouteFilter}
      ) sd ON sd.mb = month_bucket
      GROUP BY month_bucket
      ORDER BY month_bucket
    `);

    const topItemsP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ROW_NUMBER() OVER (ORDER BY SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}) DESC)::int AS rank,
        COALESCE(p.name, mprod.name, mt.pid) AS name,
        COALESCE(p.code, mprod.code, mt.pid) AS code,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS quantity,
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS value
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleSalesLineSql('mv', 'mt')}
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
      LEFT JOIN products p ON p.tenant_id = mt.tenant_id AND p.id = mprod.product_id
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
        AND ${txnRouteFilter}
        AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date
      GROUP BY COALESCE(p.name, mprod.name, mt.pid), COALESCE(p.code, mprod.code, mt.pid)
      ORDER BY value DESC
      LIMIT 5
    `);

    const topCustomersP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ROW_NUMBER() OVER (ORDER BY SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) DESC)::int AS rank,
        COALESCE(c.name, mp.par_name, mv.cid) AS name,
        mv.cid AS code,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS value
      FROM marg_vouchers mv
      LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid AND mp.is_deleted = false
      LEFT JOIN customers c ON c.id = mp.customer_id
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
        AND ${voucherRouteFilter}
        AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date
      GROUP BY COALESCE(c.name, mp.par_name, mv.cid), mv.cid
      ORDER BY value DESC
      LIMIT 5
    `);

    const [salesRows, monthlyTrend, topItems, topCustomers] = await Promise.all([salesP, monthlyTrendP, topItemsP, topCustomersP]);
    const [sales] = salesRows;
    const currentMonthSales = Number(sales.current_month_sales ?? 0);
    const lastMonthSales = Number(sales.last_month_sales ?? 0);
    const currentPeriodSales = Number(sales.current_period_sales ?? 0);
    const priorPeriodSales = Number(sales.prior_period_sales ?? 0);
    const billCount = Number(sales.bill_count ?? 0);
    const customerCount = Number(sales.customer_count ?? 0);
    const yoyChange = this.pctChange(currentPeriodSales, priorPeriodSales);

    const insights: string[] = [];
    if (yoyChange != null && yoyChange < -10) insights.push('Route sales are down more than 10% versus the prior period. Review coverage and outlet activity.');
    if (customerCount === 0) insights.push('No customers billed on this route in the selected period. Verify route assignment in Marg.');
    if (yoyChange != null && yoyChange >= 10) insights.push(`Route is growing ${yoyChange.toFixed(1)}% versus the prior period.`);
    if (!insights.length) insights.push('Route sales signals are within normal control limits.');

    return {
      asOf: ctx.asOf,
      profile: { code: route.route_code ?? 'ALL', name: route.route_name },
      kpis: {
        currentMonthSales,
        lastMonthSales,
        momSalesChangePct: this.pctChange(currentMonthSales, lastMonthSales),
        currentPeriodSales,
        priorPeriodSales,
        yoySalesChangePct: yoyChange,
        billCount,
        customerCount,
        avgBillValue: billCount > 0 ? currentPeriodSales / billCount : null,
      },
      charts: { monthlyTrend },
      tables: {
        topItems: this.addShare(topItems),
        topCustomers: this.addShare(topCustomers),
      },
      insights,
    };
  }

  async getCity360(tenantId: string, search?: string, period: PeriodKey = 'fy') {
    const ctx = await this.getContext(tenantId, period);
    const city = await this.findCity(tenantId, search);
    if (!city) throw new NotFoundException('No city/area found for the selected search.');

    const isAll = city.is_all === true;
    const cityCodeFilter = isAll ? Prisma.sql`TRUE` : Prisma.sql`mp_cty.area = ${city.city_code}`;

    const salesP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.monthStart}::date AND mv.date < ${ctx.nextMonthStart}::date), 0)::float8 AS current_month_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.lastMonthStart}::date AND mv.date < ${ctx.monthStart}::date), 0)::float8 AS last_month_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date), 0)::float8 AS current_period_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.priorFiscalStart}::date AND mv.date < ${ctx.priorFiscalEnd}::date), 0)::float8 AS prior_period_sales,
        COUNT(DISTINCT mv.company_id::text || ':' || mv.voucher) FILTER (WHERE ${margVoucherFamilySql('mv')} = 'SALES_INVOICE' AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date)::int AS bill_count,
        COUNT(DISTINCT mv.cid) FILTER (WHERE mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date)::int AS customer_count
      FROM marg_vouchers mv
      LEFT JOIN marg_parties mp_cty ON mp_cty.tenant_id = mv.tenant_id AND mp_cty.company_id = mv.company_id AND mp_cty.cid = mv.cid AND mp_cty.is_deleted = false
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
        AND ${cityCodeFilter}
    `);

    const monthlyTrendP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        to_char(month_bucket, 'Mon YYYY') AS month,
        COALESCE(SUM(sd.sales_amt), 0)::float8 AS sales_value
      FROM generate_series(date_trunc('month', ${ctx.trendStart}::date), date_trunc('month', ${ctx.asOf}::date), interval '1 month') month_bucket
      LEFT JOIN (
        SELECT date_trunc('month', mv.date) AS mb, (COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')})::float8 AS sales_amt
        FROM marg_vouchers mv
        LEFT JOIN marg_parties mp_cty ON mp_cty.tenant_id = mv.tenant_id AND mp_cty.company_id = mv.company_id AND mp_cty.cid = mv.cid AND mp_cty.is_deleted = false
        WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
          AND ${cityCodeFilter}
      ) sd ON sd.mb = month_bucket
      GROUP BY month_bucket
      ORDER BY month_bucket
    `);

    const topItemsP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ROW_NUMBER() OVER (ORDER BY SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}) DESC)::int AS rank,
        COALESCE(p.name, mprod.name, mt.pid) AS name,
        COALESCE(p.code, mprod.code, mt.pid) AS code,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS quantity,
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS value
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleSalesLineSql('mv', 'mt')}
      LEFT JOIN marg_parties mp_cty ON mp_cty.tenant_id = mv.tenant_id AND mp_cty.company_id = mv.company_id AND mp_cty.cid = mv.cid AND mp_cty.is_deleted = false
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
      LEFT JOIN products p ON p.tenant_id = mt.tenant_id AND p.id = mprod.product_id
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
        AND ${cityCodeFilter}
        AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date
      GROUP BY COALESCE(p.name, mprod.name, mt.pid), COALESCE(p.code, mprod.code, mt.pid)
      ORDER BY value DESC
      LIMIT 5
    `);

    const topCustomersP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ROW_NUMBER() OVER (ORDER BY SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) DESC)::int AS rank,
        COALESCE(c.name, mp_cty.par_name, mv.cid) AS name,
        mv.cid AS code,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS value
      FROM marg_vouchers mv
      LEFT JOIN marg_parties mp_cty ON mp_cty.tenant_id = mv.tenant_id AND mp_cty.company_id = mv.company_id AND mp_cty.cid = mv.cid AND mp_cty.is_deleted = false
      LEFT JOIN customers c ON c.id = mp_cty.customer_id
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
        AND ${cityCodeFilter}
        AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date
      GROUP BY COALESCE(c.name, mp_cty.par_name, mv.cid), mv.cid
      ORDER BY value DESC
      LIMIT 5
    `);

    const [salesRows, monthlyTrend, topItems, topCustomers] = await Promise.all([salesP, monthlyTrendP, topItemsP, topCustomersP]);
    const [sales] = salesRows;
    const currentMonthSales = Number(sales.current_month_sales ?? 0);
    const lastMonthSales = Number(sales.last_month_sales ?? 0);
    const currentPeriodSales = Number(sales.current_period_sales ?? 0);
    const priorPeriodSales = Number(sales.prior_period_sales ?? 0);
    const billCount = Number(sales.bill_count ?? 0);
    const customerCount = Number(sales.customer_count ?? 0);
    const yoyChange = this.pctChange(currentPeriodSales, priorPeriodSales);

    const insights: string[] = [];
    if (yoyChange != null && yoyChange < -10) insights.push('City sales are down more than 10% versus the prior period. Review distribution and outlet activity.');
    if (customerCount === 0) insights.push('No customers billed in this city in the selected period.');
    if (yoyChange != null && yoyChange >= 10) insights.push(`City is growing ${yoyChange.toFixed(1)}% versus the prior period.`);
    if (!insights.length) insights.push('City sales signals are within normal control limits.');

    return {
      asOf: ctx.asOf,
      profile: { code: city.city_code ?? 'ALL', name: city.city_name },
      kpis: {
        currentMonthSales,
        lastMonthSales,
        momSalesChangePct: this.pctChange(currentMonthSales, lastMonthSales),
        currentPeriodSales,
        priorPeriodSales,
        yoySalesChangePct: yoyChange,
        billCount,
        customerCount,
        avgBillValue: billCount > 0 ? currentPeriodSales / billCount : null,
      },
      charts: { monthlyTrend },
      tables: {
        topItems: this.addShare(topItems),
        topCustomers: this.addShare(topCustomers),
      },
      insights,
    };
  }

  async getSalesTeam360(tenantId: string, search?: string, period: PeriodKey = 'fy') {
    const ctx = await this.getContext(tenantId, period);
    const salesman = await this.findSalesman(tenantId, search);
    if (!salesman) throw new NotFoundException('No salesman found for the selected search.');

    const isAll = salesman.is_all === true;
    const salesmanFilter = isAll
      ? Prisma.sql`TRUE`
      : Prisma.sql`COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) = ${salesman.salesman_code}`;

    const salesP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.monthStart}::date AND mv.date < ${ctx.nextMonthStart}::date), 0)::float8 AS current_month_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.lastMonthStart}::date AND mv.date < ${ctx.monthStart}::date), 0)::float8 AS last_month_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date), 0)::float8 AS current_period_sales,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) FILTER (WHERE mv.date >= ${ctx.priorFiscalStart}::date AND mv.date < ${ctx.priorFiscalEnd}::date), 0)::float8 AS prior_period_sales,
        COUNT(DISTINCT mv.company_id::text || ':' || mv.voucher) FILTER (WHERE ${margVoucherFamilySql('mv')} = 'SALES_INVOICE' AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date)::int AS bill_count,
        COUNT(DISTINCT mv.cid) FILTER (WHERE mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date)::int AS customer_count
      FROM marg_vouchers mv
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
        AND ${salesmanFilter}
    `);

    const monthlyTrendP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        to_char(month_bucket, 'Mon YYYY') AS month,
        COALESCE(SUM(sd.sales_amt), 0)::float8 AS sales_value
      FROM generate_series(date_trunc('month', ${ctx.trendStart}::date), date_trunc('month', ${ctx.asOf}::date), interval '1 month') month_bucket
      LEFT JOIN (
        SELECT date_trunc('month', mv.date) AS mb, (COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')})::float8 AS sales_amt
        FROM marg_vouchers mv
        WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
          AND ${salesmanFilter}
      ) sd ON sd.mb = month_bucket
      GROUP BY month_bucket
      ORDER BY month_bucket
    `);

    const topItemsP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ROW_NUMBER() OVER (ORDER BY SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}) DESC)::int AS rank,
        COALESCE(p.name, mprod.name, mt.pid) AS name,
        COALESCE(p.code, mprod.code, mt.pid) AS code,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS quantity,
        COALESCE(SUM(ABS(COALESCE(mt.amount, 0)) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS value
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleSalesLineSql('mv', 'mt')}
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
      LEFT JOIN products p ON p.tenant_id = mt.tenant_id AND p.id = mprod.product_id
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
        AND ${salesmanFilter}
        AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date
      GROUP BY COALESCE(p.name, mprod.name, mt.pid), COALESCE(p.code, mprod.code, mt.pid)
      ORDER BY value DESC
      LIMIT 5
    `);

    const topCustomersP = this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ROW_NUMBER() OVER (ORDER BY SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}) DESC)::int AS rank,
        COALESCE(c.name, mp.par_name, mv.cid) AS name,
        mv.cid AS code,
        COALESCE(SUM(COALESCE(mv.final_amt, 0) * ${margSalesAmountSignSql('mv')}), 0)::float8 AS value
      FROM marg_vouchers mv
      LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid AND mp.is_deleted = false
      LEFT JOIN customers c ON c.id = mp.customer_id
      WHERE mv.tenant_id = ${tenantId}::uuid AND mv.is_cancelled = FALSE AND mv.type IN ('S', 'R')
        AND ${salesmanFilter}
        AND mv.date >= ${ctx.periodStart}::date AND mv.date <= ${ctx.periodEnd}::date
      GROUP BY COALESCE(c.name, mp.par_name, mv.cid), mv.cid
      ORDER BY value DESC
      LIMIT 5
    `);

    const [salesRows, monthlyTrend, topItems, topCustomers] = await Promise.all([salesP, monthlyTrendP, topItemsP, topCustomersP]);
    const [sales] = salesRows;
    const currentMonthSales = Number(sales.current_month_sales ?? 0);
    const lastMonthSales = Number(sales.last_month_sales ?? 0);
    const currentPeriodSales = Number(sales.current_period_sales ?? 0);
    const priorPeriodSales = Number(sales.prior_period_sales ?? 0);
    const billCount = Number(sales.bill_count ?? 0);
    const customerCount = Number(sales.customer_count ?? 0);
    const yoyChange = this.pctChange(currentPeriodSales, priorPeriodSales);

    const insights: string[] = [];
    if (yoyChange != null && yoyChange < -10) insights.push('Salesman sales are down more than 10% versus the prior period. Review target achievement and customer coverage.');
    if (customerCount === 0) insights.push('No customers billed by this salesman in the selected period.');
    if (yoyChange != null && yoyChange >= 10) insights.push(`Salesman is growing ${yoyChange.toFixed(1)}% versus the prior period.`);
    if (!insights.length) insights.push('Salesman sales signals are within normal control limits.');

    return {
      asOf: ctx.asOf,
      profile: { code: salesman.salesman_code ?? 'ALL', name: salesman.salesman_name },
      kpis: {
        currentMonthSales,
        lastMonthSales,
        momSalesChangePct: this.pctChange(currentMonthSales, lastMonthSales),
        currentPeriodSales,
        priorPeriodSales,
        yoySalesChangePct: yoyChange,
        billCount,
        customerCount,
        avgBillValue: billCount > 0 ? currentPeriodSales / billCount : null,
      },
      charts: { monthlyTrend },
      tables: {
        topItems: this.addShare(topItems),
        topCustomers: this.addShare(topCustomers),
      },
      insights,
    };
  }

  private async getContext(tenantId: string, period: PeriodKey): Promise<ReportContext> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { fiscalYearStart: true },
    });
    const asOf = new Date();
    const Y = asOf.getUTCFullYear();
    const M = asOf.getUTCMonth();
    const D = asOf.getUTCDate();

    // Period-independent anchors: current-month KPI tiles + 12-month trends.
    const monthStart = new Date(Date.UTC(Y, M, 1));
    const nextMonthStart = new Date(Date.UTC(Y, M + 1, 1));
    const lastMonthStart = new Date(Date.UTC(Y, M - 1, 1));
    const trendStart = new Date(Date.UTC(Y, M - 11, 1));
    const today = new Date(Date.UTC(Y, M, D));

    const fiscalMonth = Math.max(1, Math.min(12, tenant?.fiscalYearStart ?? 4)) - 1;
    const fiscalYear = M >= fiscalMonth ? Y : Y - 1;

    // Monday-based week boundaries.
    const mondayOffset = (asOf.getUTCDay() + 6) % 7;
    const thisWeekStart = new Date(Date.UTC(Y, M, D - mondayOffset));
    const lastWeekStart = new Date(Date.UTC(Y, M, D - mondayOffset - 7));
    const lastWeekEnd = new Date(Date.UTC(Y, M, D - mondayOffset - 1));

    // Fiscal quarter boundaries. fiscalYear/fiscalMonth are already computed above.
    // monthsIntoFY: how far into the current fiscal year today falls (0-11).
    // qIndex: 0=Q1, 1=Q2, 2=Q3, 3=Q4. Offsets are relative to fiscalYear start;
    // JS Date handles month overflow (e.g. month 13 → Feb next year) correctly.
    const monthsIntoFY = ((M - fiscalMonth) + 12) % 12;
    const fiscalQIndex = Math.floor(monthsIntoFY / 3);
    const thisQuarterStart = new Date(Date.UTC(fiscalYear, fiscalMonth + fiscalQIndex * 3, 1));
    const lastQuarterStart = new Date(Date.UTC(fiscalYear, fiscalMonth + fiscalQIndex * 3 - 3, 1));
    const lastQuarterEnd = new Date(Date.UTC(fiscalYear, fiscalMonth + fiscalQIndex * 3, 0)); // day before this quarter

    const fiscalStart = new Date(Date.UTC(fiscalYear, fiscalMonth, 1));
    const lastFiscalStart = new Date(Date.UTC(fiscalYear - 1, fiscalMonth, 1));
    const lastFiscalEnd = new Date(Date.UTC(fiscalYear, fiscalMonth, 0)); // day before this FY

    let periodStart: Date;
    let periodEnd: Date;
    switch (period) {
      case 'today':
        periodStart = today; periodEnd = today; break;
      case 'yesterday':
        periodStart = new Date(Date.UTC(Y, M, D - 1)); periodEnd = new Date(Date.UTC(Y, M, D - 1)); break;
      case 'this_week':
        periodStart = thisWeekStart; periodEnd = today; break;
      case 'last_week':
        periodStart = lastWeekStart; periodEnd = lastWeekEnd; break;
      case 'this_month':
        periodStart = monthStart; periodEnd = today; break;
      case 'last_month':
        periodStart = lastMonthStart; periodEnd = new Date(Date.UTC(Y, M, 0)); break;
      case 'this_quarter':
        periodStart = thisQuarterStart; periodEnd = today; break;
      case 'last_quarter':
        periodStart = lastQuarterStart; periodEnd = lastQuarterEnd; break;
      case 'last_fy':
        periodStart = lastFiscalStart; periodEnd = lastFiscalEnd; break;
      case 'calendar':
        periodStart = new Date(Date.UTC(Y, 0, 1)); periodEnd = today; break;
      case 'last12':
        periodStart = new Date(Date.UTC(Y, M - 11, 1)); periodEnd = today; break;
      case 'fy':
      default:
        periodStart = fiscalStart; periodEnd = today; break;
    }

    // Prior period = selected window shifted back exactly one year. priorFiscalEnd
    // is exclusive (queries use `date < priorFiscalEnd`), so add one day.
    const shiftBackOneYear = (d: Date) =>
      new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
    const priorFiscalStart = shiftBackOneYear(periodStart);
    const priorFiscalEnd = new Date(shiftBackOneYear(periodEnd).getTime() + 86_400_000);

    return { asOf, monthStart, nextMonthStart, lastMonthStart, periodStart, periodEnd, priorFiscalStart, priorFiscalEnd, trendStart };
  }

  private compatibleSalesLineSql(voucherAlias: string, transactionAlias: string): Prisma.Sql {
    const mv = Prisma.raw(voucherAlias);
    const mt = Prisma.raw(transactionAlias);
    // UPPER-normalised + includes W (BRK/EXP receive — Credit Note flow) so
    // 360 sales movements net breakage/expiry returns the same way the
    // Sales Analysis dashboard does. SALES_BRK_EXP_RECEIVE is signed -1 by
    // margSalesAmountSignSql, so it correctly subtracts.
    return Prisma.sql`(
      (UPPER(${mv}.type) = 'S' AND ${mt}.type IN ('G', 'S', 'O'))
      OR (UPPER(${mv}.type) = 'R' AND ${mt}.type IN ('R', 'W'))
      OR (UPPER(${mv}.type) = 'T' AND ${mt}.type IN ('X', 'T'))
      OR (UPPER(${mv}.type) = 'W' AND ${mt}.type IN ('W', 'R'))
    ) AND ${mt}.is_cancelled = FALSE`;
  }

  private compatiblePurchaseLineSql(voucherAlias: string, transactionAlias: string): Prisma.Sql {
    const mv = Prisma.raw(voucherAlias);
    const mt = Prisma.raw(transactionAlias);
    // UPPER-normalised + includes Q (BRK/EXP return — Debit Note flow) so
    // 360 purchase movements net breakage/expiry returns. PURCHASE_BRK_EXP_RETURN
    // is signed -1 by margPurchaseAmountSignSql.
    return Prisma.sql`(
      (UPPER(${mv}.type) = 'P' AND ${mt}.type IN ('P', 'Q'))
      OR (UPPER(${mv}.type) = 'B' AND ${mt}.type = 'B')
      OR (UPPER(${mv}.type) = 'Q' AND ${mt}.type IN ('Q', 'B'))
    ) AND ${mt}.is_cancelled = FALSE`;
  }

  private async findRoute(tenantId: string, search?: string) {
    if (!(search ?? '').trim()) {
      return { is_all: true, route_code: null as string | null, route_name: 'All Routes', code: 'ALL' };
    }
    const term = this.searchTerm(search);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT s_code AS route_code, COALESCE(name, s_code) AS route_name, s_code AS code
      FROM marg_sale_types
      WHERE tenant_id = ${tenantId}::uuid AND sg_code = 'ROUT'
        AND (${term} = '%%' OR s_code ILIKE ${term} OR name ILIKE ${term})
      ORDER BY name
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private async findCity(tenantId: string, search?: string) {
    if (!(search ?? '').trim()) {
      return { is_all: true, city_code: null as string | null, city_name: 'All Cities', code: 'ALL' };
    }
    const term = this.searchTerm(search);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT s_code AS city_code, COALESCE(name, s_code) AS city_name, s_code AS code
      FROM marg_sale_types
      WHERE tenant_id = ${tenantId}::uuid AND sg_code = 'AREA'
        AND (${term} = '%%' OR s_code ILIKE ${term} OR name ILIKE ${term})
      ORDER BY name
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private async findSalesman(tenantId: string, search?: string) {
    if (!(search ?? '').trim()) {
      return { is_all: true, salesman_code: null as string | null, salesman_name: 'All Sales Team', code: 'ALL' };
    }
    const term = this.searchTerm(search);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT code AS salesman_code, COALESCE(name, code) AS salesman_name, code
      FROM salesmen
      WHERE tenant_id = ${tenantId}::uuid
        AND (${term} = '%%' OR code ILIKE ${term} OR name ILIKE ${term})
      ORDER BY name
      LIMIT 1
    `);
    if (rows[0]) return rows[0];
    const margRows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) AS salesman_code,
        COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) AS salesman_name,
        COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) AS code
      FROM marg_vouchers mv
      WHERE mv.tenant_id = ${tenantId}::uuid
        AND COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) IS NOT NULL
        AND (${term} = '%%' OR COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) ILIKE ${term})
      ORDER BY salesman_code
      LIMIT 1
    `);
    return margRows[0] ?? null;
  }

  private async findItem(tenantId: string, search?: string) {
    if (!(search ?? '').trim()) {
      return {
        is_all: true,
        product_id: null,
        sku: 'ALL',
        product_name: 'All Items',
        category: 'Portfolio',
        brand: null,
        company: null,
        salt: null,
        product_group: null,
        hsn_code: null,
        uom: 'All',
        selling_price: null,
        mrp: null,
        marg_pid: null,
        company_id: null,
      };
    }

    const term = this.searchTerm(search);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        p.id::text AS product_id,
        p.code AS sku,
        p.name AS product_name,
        p.category,
        NULL::text AS brand,
        NULLIF(TRIM(COALESCE(p.product_company, mp.g_code)), '') AS company,
        COALESCE(pc.name, CASE WHEN NULLIF(TRIM(COALESCE(p.product_company, mp.g_code)), '') IS NULL THEN NULL ELSE 'Unknown company (' || TRIM(COALESCE(p.product_company, mp.g_code)) || ')' END) AS company_name,
        CASE WHEN NULLIF(TRIM(COALESCE(p.product_company, mp.g_code)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.product_company, mp.g_code)) || ' - ' || COALESCE(pc.name, 'Unknown company (' || TRIM(COALESCE(p.product_company, mp.g_code)) || ')') END AS company_display,
        NULLIF(TRIM(COALESCE(p.salt, mp.g_code3)), '') AS salt,
        COALESCE(ps.name, CASE WHEN NULLIF(TRIM(COALESCE(p.salt, mp.g_code3)), '') IS NULL THEN NULL ELSE 'Unknown salt (' || TRIM(COALESCE(p.salt, mp.g_code3)) || ')' END) AS salt_name,
        CASE WHEN NULLIF(TRIM(COALESCE(p.salt, mp.g_code3)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.salt, mp.g_code3)) || ' - ' || COALESCE(ps.name, 'Unknown salt (' || TRIM(COALESCE(p.salt, mp.g_code3)) || ')') END AS salt_display,
        NULLIF(TRIM(COALESCE(p.product_group, mp.g_code5)), '') AS product_group,
        COALESCE(pg.name, CASE WHEN NULLIF(TRIM(COALESCE(p.product_group, mp.g_code5)), '') IS NULL THEN NULL ELSE 'Unknown group (' || TRIM(COALESCE(p.product_group, mp.g_code5)) || ')' END) AS product_group_name,
        CASE WHEN NULLIF(TRIM(COALESCE(p.product_group, mp.g_code5)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.product_group, mp.g_code5)) || ' - ' || COALESCE(pg.name, 'Unknown group (' || TRIM(COALESCE(p.product_group, mp.g_code5)) || ')') END AS product_group_display,
        COALESCE(p.hsn_code, mp.g_code6) AS hsn_code,
        NULLIF(TRIM(COALESCE(p.unit_of_measure, mp.unit)), '') AS uom,
        COALESCE(uom.name, CASE WHEN NULLIF(TRIM(COALESCE(p.unit_of_measure, mp.unit)), '') IS NULL THEN NULL ELSE 'Unknown UOM (' || TRIM(COALESCE(p.unit_of_measure, mp.unit)) || ')' END) AS uom_name,
        CASE WHEN NULLIF(TRIM(COALESCE(p.unit_of_measure, mp.unit)), '') IS NULL THEN NULL ELSE TRIM(COALESCE(p.unit_of_measure, mp.unit)) || ' - ' || COALESCE(uom.name, 'Unknown UOM (' || TRIM(COALESCE(p.unit_of_measure, mp.unit)) || ')') END AS uom_display,
        COALESCE(p.list_price, 0)::float8 AS selling_price,
        COALESCE(p.list_price, 0)::float8 AS mrp,
        mp.pid AS marg_pid,
        mp.company_id
      FROM products p
      LEFT JOIN marg_products mp ON mp.product_id = p.id
      LEFT JOIN product_companies pc ON pc.tenant_id = p.tenant_id AND pc.code = NULLIF(TRIM(COALESCE(p.product_company, mp.g_code)), '')
      LEFT JOIN product_salts ps ON ps.tenant_id = p.tenant_id AND ps.code = NULLIF(TRIM(COALESCE(p.salt, mp.g_code3)), '')
      LEFT JOIN product_categories pg ON pg.tenant_id = p.tenant_id AND pg.code = NULLIF(TRIM(COALESCE(p.product_group, mp.g_code5)), '')
      LEFT JOIN unit_of_measures uom ON uom.tenant_id = p.tenant_id AND uom.code = NULLIF(TRIM(COALESCE(p.unit_of_measure, mp.unit)), '')
      WHERE p.tenant_id = ${tenantId}::uuid
        AND (${term} = '%%' OR p.code ILIKE ${term} OR p.name ILIKE ${term} OR COALESCE(mp.pid, '') ILIKE ${term})
      ORDER BY
        CASE WHEN p.code ILIKE ${term} THEN 0 WHEN p.name ILIKE ${term} THEN 1 ELSE 2 END,
        p.name
      LIMIT 1
    `);
    if (rows[0]) return rows[0];

    const margRows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        NULL::text AS product_id,
        mp.code AS sku,
        mp.name AS product_name,
        mp.g_code5 AS category,
        NULL::text AS brand,
        NULLIF(TRIM(mp.g_code), '') AS company,
        COALESCE(pc.name, CASE WHEN NULLIF(TRIM(mp.g_code), '') IS NULL THEN NULL ELSE 'Unknown company (' || TRIM(mp.g_code) || ')' END) AS company_name,
        CASE WHEN NULLIF(TRIM(mp.g_code), '') IS NULL THEN NULL ELSE TRIM(mp.g_code) || ' - ' || COALESCE(pc.name, 'Unknown company (' || TRIM(mp.g_code) || ')') END AS company_display,
        NULLIF(TRIM(mp.g_code3), '') AS salt,
        COALESCE(ps.name, CASE WHEN NULLIF(TRIM(mp.g_code3), '') IS NULL THEN NULL ELSE 'Unknown salt (' || TRIM(mp.g_code3) || ')' END) AS salt_name,
        CASE WHEN NULLIF(TRIM(mp.g_code3), '') IS NULL THEN NULL ELSE TRIM(mp.g_code3) || ' - ' || COALESCE(ps.name, 'Unknown salt (' || TRIM(mp.g_code3) || ')') END AS salt_display,
        NULLIF(TRIM(mp.g_code5), '') AS product_group,
        COALESCE(pg.name, CASE WHEN NULLIF(TRIM(mp.g_code5), '') IS NULL THEN NULL ELSE 'Unknown group (' || TRIM(mp.g_code5) || ')' END) AS product_group_name,
        CASE WHEN NULLIF(TRIM(mp.g_code5), '') IS NULL THEN NULL ELSE TRIM(mp.g_code5) || ' - ' || COALESCE(pg.name, 'Unknown group (' || TRIM(mp.g_code5) || ')') END AS product_group_display,
        mp.g_code6 AS hsn_code,
        NULLIF(TRIM(mp.unit), '') AS uom,
        COALESCE(uom.name, CASE WHEN NULLIF(TRIM(mp.unit), '') IS NULL THEN NULL ELSE 'Unknown UOM (' || TRIM(mp.unit) || ')' END) AS uom_name,
        CASE WHEN NULLIF(TRIM(mp.unit), '') IS NULL THEN NULL ELSE TRIM(mp.unit) || ' - ' || COALESCE(uom.name, 'Unknown UOM (' || TRIM(mp.unit) || ')') END AS uom_display,
        COALESCE(ms.rate_a, ms.mrp, 0)::float8 AS selling_price,
        COALESCE(ms.mrp, 0)::float8 AS mrp,
        mp.pid AS marg_pid,
        mp.company_id
      FROM marg_products mp
      LEFT JOIN product_companies pc ON pc.tenant_id = mp.tenant_id AND pc.code = NULLIF(TRIM(mp.g_code), '')
      LEFT JOIN product_salts ps ON ps.tenant_id = mp.tenant_id AND ps.code = NULLIF(TRIM(mp.g_code3), '')
      LEFT JOIN product_categories pg ON pg.tenant_id = mp.tenant_id AND pg.code = NULLIF(TRIM(mp.g_code5), '')
      LEFT JOIN unit_of_measures uom ON uom.tenant_id = mp.tenant_id AND uom.code = NULLIF(TRIM(mp.unit), '')
      LEFT JOIN LATERAL (
        SELECT rate_a, mrp FROM marg_stocks ms
        WHERE ms.tenant_id = mp.tenant_id AND ms.company_id = mp.company_id AND ms.pid = mp.pid
        ORDER BY ms.updated_at DESC
        LIMIT 1
      ) ms ON TRUE
      WHERE mp.tenant_id = ${tenantId}::uuid
        AND (${term} = '%%' OR mp.code ILIKE ${term} OR mp.name ILIKE ${term} OR mp.pid ILIKE ${term})
      ORDER BY mp.name
      LIMIT 1
    `);
    return margRows[0] ?? null;
  }

  private async findCustomer(tenantId: string, search?: string) {
    if (!(search ?? '').trim()) {
      return {
        is_all: true,
        customer_id: null,
        code: 'ALL',
        name: 'All Customers',
        type: 'Portfolio',
        credit_limit: null,
        payment_terms: null,
        company_id: null,
        cid: null,
        gst_no: null,
        phone: null,
        marg_credit: null,
        credit_days: null,
        sales_person: null,
      };
    }

    const term = this.searchTerm(search);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        c.id::text AS customer_id,
        c.code,
        c.name,
        COALESCE(c.segment, c.type::text) AS type,
        c.credit_limit::float8 AS credit_limit,
        c.payment_terms,
        mp.company_id,
        mp.cid,
        mp.gst_no,
        COALESCE(mp.phone1, mp.phone2, mp.phone3, mp.phone4) AS phone,
        mp.credit::float8 AS marg_credit,
        mp.cr_days AS credit_days,
        CASE
          WHEN NULLIF(TRIM(COALESCE(mp.mr, mp.s_code)), '') IS NULL THEN NULL
          ELSE TRIM(COALESCE(mp.mr, mp.s_code)) || ' - ' || COALESCE(
            (SELECT s.name FROM salesmen s WHERE s.tenant_id = mp.tenant_id AND s.code = NULLIF(TRIM(COALESCE(mp.mr, mp.s_code)), '') LIMIT 1),
            (SELECT NULLIF(TRIM(REGEXP_REPLACE(sp.par_name, '[[:cntrl:]]', '', 'g')), '') FROM marg_parties sp WHERE sp.tenant_id = mp.tenant_id AND sp.company_id = mp.company_id AND sp.cid = NULLIF(TRIM(COALESCE(mp.mr, mp.s_code)), '') AND sp.is_deleted = false LIMIT 1),
            'Unknown salesman (' || TRIM(COALESCE(mp.mr, mp.s_code)) || ')'
          )
        END AS sales_person
      FROM customers c
      LEFT JOIN marg_parties mp ON mp.customer_id = c.id
      WHERE c.tenant_id = ${tenantId}::uuid
        AND (${term} = '%%' OR c.code ILIKE ${term} OR c.name ILIKE ${term} OR COALESCE(mp.gst_no, '') ILIKE ${term})
      ORDER BY c.name
      LIMIT 1
    `);
    if (rows[0]) return rows[0];

    const margRows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        NULL::text AS customer_id,
        mp.cid AS code,
        mp.par_name AS name,
        COALESCE(mp.area, mp.route, 'Marg Party') AS type,
        NULL::float8 AS credit_limit,
        NULL::text AS payment_terms,
        mp.company_id,
        mp.cid,
        mp.gst_no,
        COALESCE(mp.phone1, mp.phone2, mp.phone3, mp.phone4) AS phone,
        mp.credit::float8 AS marg_credit,
        mp.cr_days AS credit_days,
        CASE
          WHEN NULLIF(TRIM(COALESCE(mp.mr, mp.s_code)), '') IS NULL THEN NULL
          ELSE TRIM(COALESCE(mp.mr, mp.s_code)) || ' - ' || COALESCE(
            (SELECT s.name FROM salesmen s WHERE s.tenant_id = mp.tenant_id AND s.code = NULLIF(TRIM(COALESCE(mp.mr, mp.s_code)), '') LIMIT 1),
            (SELECT NULLIF(TRIM(REGEXP_REPLACE(sp.par_name, '[[:cntrl:]]', '', 'g')), '') FROM marg_parties sp WHERE sp.tenant_id = mp.tenant_id AND sp.company_id = mp.company_id AND sp.cid = NULLIF(TRIM(COALESCE(mp.mr, mp.s_code)), '') AND sp.is_deleted = false LIMIT 1),
            'Unknown salesman (' || TRIM(COALESCE(mp.mr, mp.s_code)) || ')'
          )
        END AS sales_person
      FROM marg_parties mp
      WHERE mp.tenant_id = ${tenantId}::uuid
        AND mp.is_deleted = false
        AND (${term} = '%%' OR mp.cid ILIKE ${term} OR mp.par_name ILIKE ${term} OR COALESCE(mp.gst_no, '') ILIKE ${term} OR COALESCE(mp.phone1, '') ILIKE ${term})
        AND EXISTS (
          SELECT 1 FROM marg_vouchers mv
          WHERE mv.tenant_id = mp.tenant_id AND mv.company_id = mp.company_id AND mv.cid = mp.cid AND mv.type = 'S'
        )
      ORDER BY mp.par_name
      LIMIT 1
    `);
    return margRows[0] ?? null;
  }

  private async findSupplier(tenantId: string, search?: string) {
    if (!(search ?? '').trim()) {
      return {
        is_all: true,
        supplier_id: null,
        code: 'ALL',
        name: 'All Suppliers',
        type: 'Portfolio',
        contact_name: null,
        phone: null,
        payment_terms: null,
        company_id: null,
        cid: null,
        gst_no: null,
      };
    }

    const term = this.searchTerm(search);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        s.id::text AS supplier_id,
        s.code,
        s.name,
        'Supplier'::text AS type,
        s.contact_name,
        s.phone,
        s.payment_terms,
        mp.company_id,
        mp.cid,
        mp.gst_no
      FROM suppliers s
      LEFT JOIN marg_parties mp
        ON mp.tenant_id = s.tenant_id
        AND (
          s.external_id = CONCAT('marg:', mp.company_id::text, ':', mp.cid)
          OR COALESCE(s.attributes->>'margCid', '') = mp.cid
        )
      WHERE s.tenant_id = ${tenantId}::uuid
        AND (${term} = '%%' OR s.code ILIKE ${term} OR s.name ILIKE ${term} OR COALESCE(mp.gst_no, '') ILIKE ${term})
      ORDER BY s.name
      LIMIT 1
    `);
    if (rows[0]) return rows[0];

    const margRows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        NULL::text AS supplier_id,
        mp.cid AS code,
        mp.par_name AS name,
        COALESCE(mp.area, mp.route, 'Marg Supplier') AS type,
        NULL::text AS contact_name,
        COALESCE(mp.phone1, mp.phone2, mp.phone3, mp.phone4) AS phone,
        CASE WHEN mp.cr_days IS NOT NULL THEN CONCAT(mp.cr_days::text, ' Days') ELSE NULL END AS payment_terms,
        mp.company_id,
        mp.cid,
        mp.gst_no
      FROM marg_parties mp
      WHERE mp.tenant_id = ${tenantId}::uuid
        AND mp.is_deleted = false
        AND (${term} = '%%' OR mp.cid ILIKE ${term} OR mp.par_name ILIKE ${term} OR COALESCE(mp.gst_no, '') ILIKE ${term} OR COALESCE(mp.phone1, '') ILIKE ${term})
        AND EXISTS (
          SELECT 1 FROM marg_vouchers mv
          WHERE mv.tenant_id = mp.tenant_id AND mv.company_id = mp.company_id AND mv.cid = mp.cid AND mv.type = 'P'
        )
      ORDER BY mp.par_name
      LIMIT 1
    `);
    return margRows[0] ?? null;
  }

  private inventoryReportFilter(productId?: string | null, locationId?: string) {
    return {
      limit: 100000,
      offset: 0,
      ...(productId ? { productIds: [productId] } : {}),
      ...(locationId ? { locationIds: [locationId] } : {}),
    } as any;
  }

  private currentStockFromReport(rows: any[]) {
    let lastUpdated: Date | null = null;
    const summary = rows.reduce(
      (acc, row) => {
        acc.currentStock += Number(row.on_hand_qty ?? 0);
        acc.stockValue += Number(row.inventory_value ?? 0);
        const updated = row.last_updated ? new Date(row.last_updated) : null;
        if (updated && (!lastUpdated || updated > lastUpdated)) lastUpdated = updated;
        return acc;
      },
      { currentStock: 0, stockValue: 0 },
    );
    return {
      ...summary,
      hasRows: rows.length > 0,
      lastUpdated,
    };
  }

  private batchesFromInventoryReport(rows: any[]) {
    return rows
      .map((row) => ({
        batch_number: row.batch_number,
        quantity: Number(row.available_qty ?? row.quantity ?? 0),
        expiry_date: row.expiry_date,
        days_left: row.days_to_expiry,
        rate: Number(row.cost_per_unit ?? 0),
        status: row.batch_status,
      }))
      .filter((row) => row.quantity > 0)
      .sort((left, right) => {
        const leftDays = left.days_left == null ? Number.POSITIVE_INFINITY : Number(left.days_left);
        const rightDays = right.days_left == null ? Number.POSITIVE_INFINITY : Number(right.days_left);
        return leftDays - rightDays;
      })
      .slice(0, 8);
  }

  private stockAgeingFromInventoryReport(summary: any[]) {
    const rows = summary.map((row) => ({
      bucket: String(row.bucket ?? ''),
      quantity: Number(row.total_qty ?? 0),
      value: Number(row.total_value ?? 0),
      status: this.stockAgeingStatus(String(row.bucket ?? '')),
    }));
    return this.addQuantityShare(rows);
  }

  private stockAgeingStatus(bucket: string): string {
    if (bucket.startsWith('0-30')) return 'Fresh';
    if (bucket.startsWith('31-60')) return 'Healthy';
    if (bucket.startsWith('61-90')) return 'Monitor';
    if (bucket === 'UNKNOWN') return 'Unknown';
    return 'Slow / Dead Stock';
  }

  private async getOutstandingSnapshot(
    tenantId: string,
    partyCode: string | null | undefined,
    companyId: number | null | undefined,
    partyType: 'CUSTOMER' | 'SUPPLIER',
  ) {
    try {
      if (!partyCode || companyId == null) {
        const summary = await this.margOutstanding.getMargOutstandingSummary(tenantId, {
          partyType,
          limit: 10000,
        });
        return {
          total_outstanding: Number(summary.summary.totalOutstanding ?? 0),
          credit_balance: Number(summary.summary.creditBalance ?? 0),
          signed_balance: Number(summary.summary.signedBalance ?? 0),
          bucket_0_30: Number(summary.summary.currentBucket ?? 0),
          bucket_31_60: Number(summary.summary.days31To60Bucket ?? 0),
          bucket_61_90: Number(summary.summary.days61To90Bucket ?? 0),
          bucket_91_plus: Number(summary.summary.days91PlusBucket ?? 0),
          count_0_30: summary.rows.filter((row) => Number(row.currentBucket ?? 0) > 0).length,
          count_31_60: summary.rows.filter((row) => Number(row.days31To60 ?? 0) > 0).length,
          count_61_90: summary.rows.filter((row) => Number(row.days61To90 ?? 0) > 0).length,
          count_91_plus: summary.rows.filter((row) => Number(row.days91Plus ?? 0) > 0).length,
          open_invoice_count: Number(summary.summary.openInvoiceCount ?? 0),
          avg_payment_days: 0,
        };
      }

      const [summary, detail] = await Promise.all([
        this.margOutstanding.getMargOutstandingSummary(tenantId, {
          partyType,
          companyId,
          limit: 10000,
        }),
        this.margOutstanding.getMargOutstandingDetail(tenantId, partyCode, {
          companyId,
          limit: 10000,
        }),
      ]);
      const invoices = detail.invoices ?? [];
      const exposureInvoices = invoices
        .map((invoice) => {
          const signedBalance = Number(invoice.balance ?? 0);
          const exposure = partyType === 'CUSTOMER'
            ? Math.max(signedBalance, 0)
            : Math.max(-signedBalance, 0);
          const credit = partyType === 'CUSTOMER'
            ? Math.max(-signedBalance, 0)
            : Math.max(signedBalance, 0);
          return { ...invoice, exposure, credit };
        });
      const row = summary.rows.find((entry) => entry.companyId === companyId && entry.partyCode === partyCode);
      const bucketSum = (bucket: string) => exposureInvoices
        .filter((invoice) => invoice.bucket === bucket)
        .reduce((sum, invoice) => sum + invoice.exposure, 0);
      const bucketCount = (bucket: string) => exposureInvoices
        .filter((invoice) => invoice.bucket === bucket && invoice.exposure > 0)
        .length;
      const exposureRows = exposureInvoices.filter((invoice) => invoice.exposure > 0);
      return {
        total_outstanding: exposureRows.reduce((sum, invoice) => sum + invoice.exposure, 0),
        credit_balance: exposureInvoices.reduce((sum, invoice) => sum + invoice.credit, 0),
        signed_balance: Number(row?.signedBalance ?? 0),
        bucket_0_30: bucketSum('CURRENT'),
        bucket_31_60: bucketSum('DAYS_31_60'),
        bucket_61_90: bucketSum('DAYS_61_90'),
        bucket_91_plus: bucketSum('DAYS_91_PLUS'),
        count_0_30: bucketCount('CURRENT'),
        count_31_60: bucketCount('DAYS_31_60'),
        count_61_90: bucketCount('DAYS_61_90'),
        count_91_plus: bucketCount('DAYS_91_PLUS'),
        open_invoice_count: exposureRows.length,
        avg_payment_days: exposureRows.length
          ? exposureRows.reduce((sum, invoice) => sum + Number(invoice.days ?? 0), 0) / exposureRows.length
          : 0,
      };
    } catch {
      return this.emptyOutstandingSnapshot();
    }
  }

  private emptyOutstandingSnapshot() {
    return {
      total_outstanding: 0,
      bucket_0_30: 0,
      bucket_31_60: 0,
      bucket_61_90: 0,
      bucket_91_plus: 0,
      credit_balance: 0,
      signed_balance: 0,
      count_0_30: 0,
      count_31_60: 0,
      count_61_90: 0,
      count_91_plus: 0,
      open_invoice_count: 0,
      avg_payment_days: 0,
    };
  }

  private async getSupplierPerformanceSnapshot(tenantId: string, supplier: any, ctx: ReportContext) {
    const filters = {
      limit: 10000,
      offset: 0,
      startDate: this.dateOnly(ctx.periodStart),
      endDate: this.dateOnly(ctx.periodEnd),
      ...(supplier.supplier_id ? { supplierIds: [supplier.supplier_id] } : {}),
    } as any;
    const report = await this.procurementReports.getSupplierPerformanceReport(tenantId, filters);
    return report.data.find((row) => {
      if (supplier.supplier_id && row.supplier_key === `supplier:${supplier.supplier_id}`) return true;
      if (supplier.code && row.supplier_code === supplier.code) return true;
      return supplier.name && row.supplier_name === supplier.name;
    }) ?? null;
  }

  private dateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private periodDays(ctx: ReportContext): number {
    return Math.max(1, Math.floor((ctx.periodEnd.getTime() - ctx.periodStart.getTime()) / 86_400_000) + 1);
  }

  private daysSince(value: Date | string | null | undefined, asOf: Date): number | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.max(0, Math.floor((asOf.getTime() - date.getTime()) / 86_400_000));
  }

  private searchTerm(search?: string): string {
    const value = (search ?? '').trim();
    return value ? `%${value}%` : '%%';
  }

  private pctChange(current: number, previous: number): number | null {
    if (!Number.isFinite(previous) || previous === 0) return null;
    return (current - previous) / Math.abs(previous) * 100;
  }


  private addShare(rows: any[]) {
    const total = rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
    return rows.map((row) => ({
      ...row,
      share: total > 0 ? Number(row.value ?? 0) / total * 100 : 0,
    }));
  }

  private addQuantityShare(rows: any[]) {
    const total = rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    return rows.map((row) => ({
      ...row,
      share: total > 0 ? Number(row.quantity ?? 0) / total * 100 : 0,
    }));
  }

  private ageingRows(row: any, countLabel: string) {
    return [
      { bucket: '0-30', countLabel, count: Number(row.count_0_30 ?? 0), amount: Number(row.bucket_0_30 ?? 0), status: 'Not Due' },
      { bucket: '31-60', countLabel, count: Number(row.count_31_60 ?? 0), amount: Number(row.bucket_31_60 ?? 0), status: 'Due Soon' },
      { bucket: '61-90', countLabel, count: Number(row.count_61_90 ?? 0), amount: Number(row.bucket_61_90 ?? 0), status: 'Overdue' },
      { bucket: '91+', countLabel, count: Number(row.count_91_plus ?? 0), amount: Number(row.bucket_91_plus ?? 0), status: 'High Risk' },
    ];
  }

  private customerRiskScore(outstanding: number, creditLimit: number, oldOverdue: number): number {
    let score = 90;
    if (creditLimit > 0 && outstanding / creditLimit > 0.8) score -= 20;
    if (oldOverdue > 0) score -= 25;
    if (outstanding > 0 && creditLimit <= 0) score -= 10;
    return Math.max(0, Math.min(100, score));
  }

  private supplierScore(onTime: number, fulfillment: number, oldPayable: number): number {
    const delivery = Number.isFinite(onTime) && onTime > 0 ? onTime : 70;
    const fulfil = Number.isFinite(fulfillment) && fulfillment > 0 ? fulfillment : 70;
    let score = delivery * 0.55 + fulfil * 0.35 + 10;
    if (oldPayable > 0) score -= 10;
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  private itemInsights(stockQty: number, avgDailySales: number, openPoQty: number, batches: any[]): string[] {
    const insights: string[] = [];
    const cover = avgDailySales > 0 ? stockQty / avgDailySales : null;
    if (cover != null && cover < 7) insights.push('Stock cover is below 7 days. Raise or expedite purchase orders.');
    if (cover != null && cover > 60) insights.push('Stock cover is above 60 days. Review slow-moving inventory and purchase plans.');
    if (openPoQty > 0) insights.push('Open purchase quantity exists. Track pending receipts against current demand.');
    if (batches.some((b) => b.days_left != null && Number(b.days_left) <= 30)) insights.push('Near-expiry batches exist. Prioritize FEFO picking and liquidation.');
    if (!insights.length) insights.push('No immediate item risk detected from stock, purchase, and expiry signals.');
    return insights;
  }

  private customerInsights(outstanding: number, creditLimit: number, oldOverdue: number, currentSales: number, lastSales: number): string[] {
    const insights: string[] = [];
    if (creditLimit > 0 && outstanding / creditLimit > 0.8) insights.push('Credit utilization is high. Review credit exposure before new dispatches.');
    if (oldOverdue > 0) insights.push('Old overdue balance exists. Prioritize collection follow-up.');
    if (this.pctChange(currentSales, lastSales) != null && (this.pctChange(currentSales, lastSales) ?? 0) < -10) insights.push('Current month sales are down more than 10% versus last month.');
    if (!insights.length) insights.push('Customer sales and receivable signals are within normal control limits.');
    return insights;
  }

  private supplierInsights(score: number, oldPayable: number, openPoValue: number, currentPurchase: number, lastPurchase: number): string[] {
    const insights: string[] = [];
    if (score < 70) insights.push('Supplier score is below target. Review delivery and fulfilment performance.');
    if (oldPayable > 0) insights.push('Old payable exists. Align payment follow-up with procurement priority.');
    if (openPoValue > 0) insights.push('Open PO value is pending. Track expected receipts and shortages.');
    if (this.pctChange(currentPurchase, lastPurchase) != null && (this.pctChange(currentPurchase, lastPurchase) ?? 0) > 20) insights.push('Purchase value is up sharply versus last month. Validate demand and price changes.');
    if (!insights.length) insights.push('Supplier performance and payable signals are within normal control limits.');
    return insights;
  }
}
