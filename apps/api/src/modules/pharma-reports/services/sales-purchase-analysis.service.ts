import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { SalesPurchaseAnalysisFilterDto } from '../dto';
import {
  AllowedSqlColumns,
  buildPharmaFilterSql,
  buildPharmaOrderBySql,
  parsePharmaFilters,
} from '../pharma-filter.helper';
import {
  margPurchaseAmountSignSql,
  margSalesAmountSignSql,
  margVoucherFamilySql,
} from '../../marg-ede/marg-voucher-family.sql';

type AnalysisKind = 'sales' | 'purchase';

// Report scope (Part 2 — returns + net):
//   'invoice' (default) → pure commercial invoices only (Part 1 behaviour).
//   'return'            → returns / CN / DN / BRK-EXP, shown as POSITIVE
//                         magnitudes (a returns report counts up).
//   'net'               → invoices MINUS returns (net-of-returns), via the
//                         family-signed columns already stored on the rollup.
// Default is 'invoice' so every existing caller and the Part 1 contract are
// byte-for-byte unchanged.
type ReportScope = 'invoice' | 'return' | 'net';

// Families that make up the "return" side of each kind. Sales returns are
// the Credit-Note family (R) plus the breakage/expiry receive family (W);
// purchase returns are the Debit-Note family (B) plus breakage/expiry
// return (Q). These mirror the sign helpers in marg-voucher-family.sql.ts
// (each carries -1 there), which is why 'net' sums correctly.
// Exported so the NLQ returns views and their contract test can assert they
// filter on the IDENTICAL return families — keeping NLQ returns numbers equal
// to the dashboard scope=return totals.
export const SALES_RETURN_FAMILIES = ['SALES_RETURN', 'SALES_BRK_EXP_RECEIVE'];
export const PURCHASE_RETURN_FAMILIES = ['PURCHASE_RETURN', 'PURCHASE_BRK_EXP_RETURN'];

// ─────────────────────────────────────────────────────────────────────────
// PURE-INVOICE-ONLY MODE (post-2026-05-21 product decision)
// ─────────────────────────────────────────────────────────────────────────
// Sales/purchase analysis reports show ONLY pure commercial invoices —
// no returns, no challans, no challan-returns, no BRK/EXP CN/DN, no
// accounting-only adjustments (T/U). Two filters enforce this contract,
// and both must be satisfied for a row to appear in any sales/purchase
// analysis output:
//
//   1. Header type filter (mv.type IN ...) — narrows the LOAD set to
//      'S' for sales / 'P' for purchase. Cheap because the
//      (tenant_id, type) index covers it.
//   2. Family filter (mv.family = ...) — further narrows to the pure
//      invoice family within that type. Catches the case where a tenant
//      has type=S vouchers that are actually challans (SALES_CHALLAN) —
//      those must NOT contribute to commercial sales totals.
//
// Returns / challans / adjustments are still synced into marg_vouchers
// and projected as commercial Actuals + inventory + ledger entries via
// the classifier (so accounting reports, AR/AP outstandings, and
// inventory analytics are unaffected). They simply aren't queried by
// sales/purchase analysis.
//
// If a future product decision wants returns BACK in sales analysis,
// the change is two lines: extend documentTypes() and PURE_*_FAMILY
// to include the return-flavoured families. The classifier and sign
// helpers already know how to sign them.
const SALES_TYPES = ['S'];
const PURCHASE_TYPES = ['P'];
// Exported so cross-surface consumers (e.g. the AI/NLQ reporting views and
// their contract test) can assert they filter on the IDENTICAL family value.
// If these ever change, the NLQ views must change in lockstep — the
// `ai-views-pure-invoice.contract.spec.ts` test enforces that.
export const PURE_SALES_FAMILY = 'SALES_INVOICE';
export const PURE_PURCHASE_FAMILY = 'PURCHASE_INVOICE';
// Line types accepted under pure-invoice headers. Restricted to the
// line types that actually appear under invoice-family vouchers per the
// production V2 audit — challan / return line types ('R', 'W', 'Q')
// are NOT included because they only appear under non-invoice headers.
const SALES_LINE_TYPES = ['G', 'S', 'O', 'X'];
const PURCHASE_LINE_TYPES = ['P'];

const DIMENSION_COLUMNS: AllowedSqlColumns = {
  label: { expression: 'dim_label', type: 'string' },
  netAmount: { expression: 'net_amount', type: 'number' },
  quantity: { expression: 'quantity', type: 'number' },
  billCount: { expression: 'bill_count', type: 'number' },
  partyCount: { expression: 'party_count', type: 'number' },
  itemCount: { expression: 'item_count', type: 'number' },
  profit: { expression: 'profit', type: 'number' },
  costAmount: { expression: 'cost_amount', type: 'number' },
};

const BILL_COLUMNS: AllowedSqlColumns = {
  invoice_number: { expression: 'b.invoice_number', type: 'string' },
  date: { expression: 'b.date', type: 'date' },
  customer: { expression: 'b.party_name', type: 'string' },
  supplier: { expression: 'b.party_name', type: 'string' },
  warehouse: { expression: 'b.branch_name', type: 'string' },
  branch: { expression: 'b.branch_name', type: 'string' },
  salesman: { expression: 'b.salesman', type: 'string' },
  salesman_name: { expression: 'b.salesman_name', type: 'string' },
  user: { expression: 'b.user_name', type: 'string' },
  payment_mode: { expression: 'b.payment_mode', type: 'enum' },
  gross_amount: { expression: 'b.gross_amount', type: 'number' },
  discount: { expression: 'b.discount', type: 'number' },
  discount_pct: { expression: 'b.discount_pct', type: 'number' },
  tax: { expression: 'b.tax_amount', type: 'number' },
  net_amount: { expression: 'b.net_amount', type: 'number' },
  cost: { expression: 'b.cost_amount', type: 'number' },
  profit: { expression: 'b.profit', type: 'number' },
  margin_pct: { expression: 'b.margin_pct', type: 'number' },
  quantity: { expression: 'b.quantity', type: 'number' },
  item_count: { expression: 'b.item_count', type: 'number' },
  status: { expression: 'b.status', type: 'enum' },
};

@Injectable()
export class SalesPurchaseAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    const useRollup = !this.requiresLineLevelDrill(filters);

    // FAST PATH: read pre-aggregated bill rollup. One row per bill (~tens of
    // thousands max), all signs / family / per-bill totals pre-computed. The
    // headline SUMs reduce to a single index-scan + aggregation — typically
    // sub-second even for tenants with hundreds of thousands of underlying
    // transaction lines. Only safe when no filter requires drilling into
    // per-line data (see requiresLineLevelDrill).
    const summary = useRollup
      ? await this.getOverviewSummaryFromRollup(tenantId, kind, filters)
      : await this.getOverviewSummaryFromLive(tenantId, kind, filters);

    const [trend, topParties, topItems, taxSummary, paymentModeSummary, topSalesmen, topStates, topCities] = await Promise.all([
      this.trend(tenantId, kind, filters),
      this.topParties(tenantId, kind, filters),
      this.topItems(tenantId, kind, filters),
      this.taxSummary(tenantId, kind, filters),
      this.paymentSummary(tenantId, kind, filters),
      this.topSalesmen(tenantId, kind, filters),
      this.topStates(tenantId, kind, filters),
      this.topCities(tenantId, kind, filters),
    ]);

    const totalAmount = Number(summary?.total_amount ?? 0);
    const totalBills = Number(summary?.total_bills ?? 0);
    const totalQuantity = Number(summary?.total_quantity ?? 0);

    // returnImpact was removed when sales/purchase analysis moved to
    // pure-invoice-only mode. Every loaded row is now an invoice; there
    // are no returns to summarise. Callers that need a returns view
    // should call a dedicated returns endpoint (not yet implemented —
    // tracked separately).
    return {
      kind,
      summary: {
        totalAmount,
        totalBills,
        totalCustomers: kind === 'sales' ? Number(summary?.total_parties ?? 0) : undefined,
        totalSuppliers: kind === 'purchase' ? Number(summary?.total_parties ?? 0) : undefined,
        totalQuantity,
        averageBillValue: totalBills > 0 ? totalAmount / totalBills : 0,
        averageQuantityPerBill: totalBills > 0 ? totalQuantity / totalBills : 0,
        itemCount: Number(summary?.item_count ?? 0),
        cost: Number(summary?.cost_amount ?? 0),
        grossProfit: kind === 'sales' ? Number(summary?.gross_profit ?? 0) : undefined,
        marginPct: kind === 'sales' ? summary?.margin_pct : undefined,
      },
      trend,
      topParties,
      topItems,
      taxSummary,
      paymentModeSummary,
      topSalesmen,
      topStates,
      topCities,
    };
  }

  /**
   * Fast path: aggregate directly from marg_bill_rollup. Sub-second on
   * the production tenant's data (36k bills) because there's no live
   * transaction aggregation — the heavy lifting happened at sync time.
   *
   * Mirrors what getOverviewSummaryFromLive computes; the test
   * "rollup-summary matches live-summary" asserts the two are
   * numerically identical on the same dataset.
   */
  private async getOverviewSummaryFromRollup(
    tenantId: string,
    kind: AnalysisKind,
    filters: SalesPurchaseAnalysisFilterDto,
  ): Promise<any> {
    const scope = this.resolveScope(filters);
    const where = this.buildRollupWhere(tenantId, kind, filters);
    // Scope-aware columns:
    //   invoice/net → signed_* columns (stored family sign; net subtracts returns)
    //   return      → unsigned net_amount / quantity (returns counted positive)
    const amount = this.scopeRollupAmountColumn(kind, scope);
    const quantity = this.scopeRollupQuantityColumn(kind, scope);
    const cost = this.scopeRollupCostExpr(kind, scope);
    const [row] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(b.${amount}), 0)::float8 AS total_amount,
        COUNT(*)::int AS total_bills,
        COUNT(DISTINCT b.cid)::int AS total_parties,
        COALESCE(SUM(b.${quantity}), 0)::float8 AS total_quantity,
        COUNT(DISTINCT b.company_id || ':' || COALESCE(NULLIF(b.voucher, ''), b.vcn, ''))::int AS voucher_count,
        COALESCE(SUM(b.item_count), 0)::int AS item_count,
        COALESCE(SUM(${cost}), 0)::float8 AS cost_amount,
        COALESCE(SUM(b.${amount} - (${cost})), 0)::float8 AS gross_profit,
        CASE WHEN COALESCE(SUM(b.${amount}), 0) > 0
          THEN (COALESCE(SUM(b.${amount} - (${cost})), 0) / COALESCE(SUM(b.${amount}), 0) * 100)::float8
          ELSE NULL
        END AS margin_pct
      FROM marg_bill_rollup b
      WHERE ${where}
    `);
    return row;
  }

  /**
   * Slow path: live aggregation when filters require per-line drill (product,
   * batch, taxType, category, brand, etc.). Same shape as the rollup query
   * so the consumer at getOverview is shape-stable across both paths.
   */
  private async getOverviewSummaryFromLive(
    tenantId: string,
    kind: AnalysisKind,
    filters: SalesPurchaseAnalysisFilterDto,
  ): Promise<any> {
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    const signExpr = this.scopeAmountSignSql(kind, this.resolveScope(filters), 'mv');
    const [row] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH filtered_lines AS (
        SELECT
          mv.company_id,
          mv.voucher,
          mv.type,
          mv.vcn,
          mv.date,
          mv.cid,
          mv.final_amt,
          mv.cash,
          mv.others,
          mv.salesman,
          mv.mr,
          mv.route,
          mv.area,
          -- mv.family + per-row sign are loaded once at the line level so the
          -- bill_rollup CTE can roll them up with MAX (they are functionally
          -- constant per voucher, so MAX is just the value). This is the
          -- cheapest place to pull them in -- adding to bill_rollup directly
          -- is not possible because the marg_vouchers table is out of scope
          -- there.
          mv.family,
          ${signExpr}::int AS amount_sign,
          mt.pid,
          mt.qty,
          mt.free,
          mt.rate,
          mt.discount,
          mt.amount,
          mt.gst,
          mt.gst_amount,
          ms.p_rate,
          ms.lp_rate
        FROM marg_vouchers mv
        LEFT JOIN marg_transactions mt
          ON mt.tenant_id = mv.tenant_id
          AND mt.company_id = mv.company_id
          AND mt.voucher = mv.voucher
          AND ${this.compatibleLineTypeSql('mv', 'mt')}
        LEFT JOIN marg_products mprod
          ON mprod.tenant_id = mv.tenant_id
          AND mprod.company_id = mv.company_id
          AND mprod.pid = mt.pid
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
      ),
      bill_rollup AS (
        SELECT
          company_id,
          voucher,
          type,
          MAX(vcn) AS vcn,
          MAX(date) AS date,
          MAX(cid) AS cid,
          MAX(final_amt)::float8 AS final_amt,
          -- Family is constant per (company_id, voucher, type) bucket since
          -- it is derived from the voucher own type+vcn. MAX is a cheap way
          -- to surface the single value without needing to add family to
          -- the GROUP BY.
          MAX(family) AS family,
          MAX(amount_sign)::int AS amount_sign,
          SUM(ABS(COALESCE(qty, 0)))::float8 AS quantity,
          COUNT(DISTINCT pid) FILTER (WHERE pid IS NOT NULL)::int AS item_count,
          COALESCE(SUM(ABS(COALESCE(qty, 0)) * COALESCE(rate, 0)), 0)::float8 AS gross_amount,
          COALESCE(SUM(GREATEST(ABS(COALESCE(qty, 0)) * COALESCE(rate, 0) - ABS(COALESCE(amount, 0)), 0)), 0)::float8 AS discount,
          COALESCE(SUM(ABS(COALESCE(gst_amount, 0))), 0)::float8 AS tax_amount,
          COALESCE(SUM(ABS(COALESCE(qty, 0)) * COALESCE(p_rate, lp_rate, 0)), 0)::float8 AS cost_amount,
          -- Per-bill net amount: prefer the voucher header's final_amt (which
          -- includes round-off / freight that doesn't appear in Dis lines).
          -- Fall back to Σ(amount + gst_amount) only when final_amt is NULL.
          COALESCE(MAX(final_amt), SUM(ABS(COALESCE(amount, 0)) + ABS(COALESCE(gst_amount, 0))))::float8 AS net_amount,
          -- Signed columns: per-bill net × family-sign so the outer SELECT can
          -- SUM(signed_*) for a correctly contra-signed total (sales invoices
          -- add, sales returns subtract, challans / SC / other families
          -- contribute zero).
          (COALESCE(MAX(final_amt), SUM(ABS(COALESCE(amount, 0)) + ABS(COALESCE(gst_amount, 0)))) * MAX(amount_sign))::float8 AS signed_net_amount,
          (SUM(ABS(COALESCE(qty, 0))) * MAX(amount_sign))::float8 AS signed_quantity
        FROM filtered_lines
        GROUP BY company_id, voucher, type
      )
      SELECT
        -- Under pure-invoice-only mode buildHeaderWhere restricts the WITH
        -- to family = SALES_INVOICE / PURCHASE_INVOICE; signed_net_amount
        -- always carries +1, signed_quantity always carries +1. Kept as
        -- SUM(signed_*) for shape-stability with the rollup path and so
        -- future "include returns" changes need a single one-line edit.
        COALESCE(SUM(signed_net_amount), 0)::float8 AS total_amount,
        COUNT(*)::int AS total_bills,
        COUNT(DISTINCT cid)::int AS total_parties,
        COALESCE(SUM(signed_quantity), 0)::float8 AS total_quantity,
        COUNT(DISTINCT company_id || ':' || COALESCE(NULLIF(voucher, ''), vcn, ''))::int AS voucher_count,
        COALESCE(SUM(item_count), 0)::int AS item_count,
        COALESCE(SUM(cost_amount * amount_sign), 0)::float8 AS cost_amount,
        COALESCE(SUM(signed_net_amount - cost_amount * amount_sign), 0)::float8 AS gross_profit,
        CASE WHEN COALESCE(SUM(signed_net_amount), 0) > 0
          THEN (COALESCE(SUM(signed_net_amount - cost_amount * amount_sign), 0) / COALESCE(SUM(signed_net_amount), 0) * 100)::float8
          ELSE NULL
        END AS margin_pct
      FROM bill_rollup
    `);
    return row;
  }

  async getBills(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const baseWhere = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    const columnFilters = buildPharmaFilterSql(parsePharmaFilters(filters.filters), BILL_COLUMNS);
    const projectedWhere = columnFilters.length
      ? Prisma.sql`WHERE ${Prisma.join(columnFilters, ' AND ')}`
      : Prisma.empty;
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy,
      filters.sortDir,
      BILL_COLUMNS,
      Prisma.sql`b.date DESC NULLS LAST, b.invoice_number DESC NULLS LAST`,
    );

    const query = Prisma.sql`
      WITH b AS (${this.billRollupSql(tenantId, kind, baseWhere, this.resolveScope(filters))})
      SELECT *
      FROM b
      ${projectedWhere}
    `;

    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      ${query}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRows = await this.prisma.$queryRaw<[{ cnt: bigint }]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS cnt FROM (${query}) q
    `);

    return { data: rows, total: Number(countRows[0]?.cnt ?? 0) };
  }

  async getBillDrilldown(tenantId: string, kind: AnalysisKind, billKey: string) {
    const parsed = this.parseBillKey(billKey);
    const typeFilter = this.documentTypes(kind);

    const [header] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        mv.company_id,
        mv.voucher,
        mv.type,
        COALESCE(mv.vcn, mv.voucher) AS invoice_number,
        mv.date,
        mv.cid AS party_code,
        COALESCE(mp.par_name, mv.cid, 'Unmapped Party') AS party_name,
        mp.gst_no,
        CONCAT_WS(', ', mp.par_addr, mp.par_add1, mp.par_add2, mp.pin) AS address,
        COALESCE(mb.name, mb.branch, 'Company ' || mv.company_id::text) AS branch_name,
        mb.location_id,
        mv.final_amt::float8 AS net_amount,
        mv.cash::float8 AS cash_amount,
        mv.others::float8 AS other_amount,
        CASE
          WHEN COALESCE(mv.cash, 0) > 0 AND COALESCE(mv.others, 0) > 0 THEN 'MIXED'
          WHEN COALESCE(mv.cash, 0) > 0 THEN 'CASH'
          ELSE 'CREDIT'
        END AS payment_mode,
        COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) AS salesman_code,
        COALESCE(sm.name, NULLIF(TRIM(REGEXP_REPLACE(smp.par_name, '[[:cntrl:]]', '', 'g')), ''), CASE
          WHEN COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) IS NULL THEN NULL
          ELSE 'Unknown salesman (' || COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) || ')'
        END) AS salesman_name,
        COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) AS salesman,
        CASE
          WHEN COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) IS NULL THEN NULL
          ELSE COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) || ' - ' || COALESCE(sm.name, NULLIF(TRIM(REGEXP_REPLACE(smp.par_name, '[[:cntrl:]]', '', 'g')), ''), 'Unknown salesman (' || COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) || ')')
        END AS salesman_display,
        mv.route,
        mv.area,
        mv.orn AS reference_number,
        mv.o_date AS reference_date,
        'POSTED' AS status,
        mv.raw_data
      FROM marg_vouchers mv
      LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid
      LEFT JOIN marg_branches mb ON mb.tenant_id = mv.tenant_id AND mb.company_id = mv.company_id
      LEFT JOIN salesmen sm
        ON sm.tenant_id = mv.tenant_id
       AND sm.code = COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''))
      LEFT JOIN marg_parties smp
        ON smp.tenant_id = mv.tenant_id
       AND smp.company_id = mv.company_id
       AND smp.cid = COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''))
       AND smp.is_deleted = false
      WHERE mv.tenant_id = ${tenantId}::uuid
        AND mv.company_id = ${parsed.companyId}
        AND mv.voucher = ${parsed.voucher}
        AND mv.type = ANY(${typeFilter}::text[])
      LIMIT 1
    `);

    if (!header) throw new NotFoundException('Bill not found');

    const lines = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        mt.id,
        COALESCE(p.code, mprod.code, mt.pid) AS item_code,
        COALESCE(p.name, mprod.name, 'Unmapped Item') AS item_name,
        COALESCE(p.id::text, mprod.product_id::text) AS product_id,
        mt.pid AS marg_pid,
        mt.batch,
        mt.bat_det AS batch_detail,
        ms.expiry,
        COALESCE(mb.name, mb.branch, 'Company ' || mt.company_id::text) AS warehouse,
        ABS(COALESCE(mt.qty, 0))::float8 AS quantity,
        ABS(COALESCE(mt.free, 0))::float8 AS free_quantity,
        NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '') AS uom,
        NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '') AS uom_code,
        COALESCE(uom.name, CASE
          WHEN NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '') IS NULL THEN NULL
          ELSE 'Unknown UOM (' || TRIM(COALESCE(p.unit_of_measure, mprod.unit)) || ')'
        END) AS uom_name,
        CASE
          WHEN NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '') IS NULL THEN NULL
          ELSE TRIM(COALESCE(p.unit_of_measure, mprod.unit)) || ' - ' || COALESCE(uom.name, 'Unknown UOM (' || TRIM(COALESCE(p.unit_of_measure, mprod.unit)) || ')')
        END AS uom_display,
        mt.rate::float8 AS rate,
        (ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0))::float8 AS gross_amount,
        CASE
          WHEN (ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)) > 0
          THEN LEAST(
            GREATEST(
              (
                GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0)
                / (ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0))
                * 100
              ),
              0
            ),
            100
          )::float8
          ELSE NULL::float8
        END AS discount_pct,
        GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0)::float8 AS discount_amount,
        mt.gst::float8 AS tax_pct,
        ABS(COALESCE(mt.gst_amount, 0))::float8 AS tax_amount,
        (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))::float8 AS net_amount,
        COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)::float8 AS cost_rate,
        COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)::float8 AS landed_cost,
        mt.rate::float8 AS sales_rate,
        CASE WHEN ${kind === 'sales'} THEN ((ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) - ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0))::float8 ELSE NULL::float8 END AS profit,
        CASE WHEN ${kind === 'sales'} AND (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) > 0
          THEN (((ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) - ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)) / (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) * 100)::float8
          ELSE NULL::float8
        END AS margin_pct,
        (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))::float8 AS line_total
      FROM marg_transactions mt
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
      LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mt.tenant_id
      LEFT JOIN unit_of_measures uom ON uom.tenant_id = mt.tenant_id AND uom.code = NULLIF(TRIM(COALESCE(p.unit_of_measure, mprod.unit)), '')
      LEFT JOIN marg_branches mb ON mb.tenant_id = mt.tenant_id AND mb.company_id = mt.company_id
      LEFT JOIN LATERAL (
        SELECT expiry, p_rate, lp_rate
        FROM marg_stocks ms
        WHERE ms.tenant_id = mt.tenant_id AND ms.company_id = mt.company_id AND ms.pid = mt.pid
          AND (mt.batch IS NULL OR ms.batch = mt.batch)
        ORDER BY CASE WHEN mt.batch IS NOT NULL AND ms.batch = mt.batch THEN 0 ELSE 1 END, ms.updated_at DESC
        LIMIT 1
      ) ms ON TRUE
      WHERE mt.tenant_id = ${tenantId}::uuid
        AND mt.company_id = ${parsed.companyId}
        AND mt.voucher = ${parsed.voucher}
        AND mt.type = ANY(${this.lineTypesForHeader(header.type)}::text[])
      ORDER BY mt.id
    `);

    const totals = lines.reduce(
      (acc, line) => {
        acc.quantity += Number(line.quantity ?? 0);
        acc.gross += Number(line.gross_amount ?? 0);
        acc.discount += Number(line.discount_amount ?? 0);
        acc.lineTotal += Number(line.line_total ?? 0);
        acc.tax += Number(line.tax_amount ?? 0);
        acc.cost += Number(line.quantity ?? 0) * Number(line.cost_rate ?? 0);
        acc.profit += Number(line.profit ?? 0);
        return acc;
      },
      { quantity: 0, gross: 0, discount: 0, lineTotal: 0, tax: 0, cost: 0, profit: 0 },
    );

    const netAmount = Number(header.net_amount ?? 0) || totals.lineTotal;
    const roundOff = netAmount - totals.lineTotal;
    const invoiceProfit = kind === 'sales' ? netAmount - totals.cost : totals.profit;
    const enrichedHeader = {
      ...header,
      gross_amount: totals.gross,
      discount_amount: totals.discount,
      discount_pct: totals.gross > 0 ? Math.min(Math.max((totals.discount / totals.gross) * 100, 0), 100) : null,
      tax_amount: totals.tax,
      net_amount: netAmount,
      cost_amount: totals.cost,
      profit: invoiceProfit,
      margin_pct: netAmount > 0 ? invoiceProfit / netAmount * 100 : null,
      round_off: roundOff,
      item_count: lines.length,
      quantity: totals.quantity,
    };

    return { header: enrichedHeader, lines, totals };
  }

  async getItemDrilldown(tenantId: string, kind: AnalysisKind, itemKey: string, filters: SalesPurchaseAnalysisFilterDto) {
    const transactionItemFilter = itemKey.startsWith('product:')
      ? Prisma.sql`mprod.product_id = ${itemKey.slice('product:'.length)}::uuid`
      : Prisma.sql`mt.pid = ${itemKey}`;
    const stockItemFilter = itemKey.startsWith('product:')
      ? Prisma.sql`mprod.product_id = ${itemKey.slice('product:'.length)}::uuid`
      : Prisma.sql`ms.pid = ${itemKey}`;
    // `kind` is intentionally NOT used to gate the family filter — the item
    // drilldown is a dual-sided card showing an item's sales AND purchase
    // activity together (sold X / bought Y / margin), so it loads both sides.
    // `scope` selects WHICH families per side:
    //   invoice → SALES_INVOICE / PURCHASE_INVOICE (positive)
    //   return  → the return families (positive magnitudes)
    //   net     → invoice + return families, family-signed (invoice − return)
    void kind;
    const scope = this.resolveScope(filters);
    const salesFams = this.scopeFamilies('sales', scope);
    const purchaseFams = this.scopeFamilies('purchase', scope);
    const loadFams = [...salesFams, ...purchaseFams];
    const loadTypes = [
      ...this.documentTypes('sales', scope),
      ...this.documentTypes('purchase', scope),
    ];
    // Per-row sign: net signs invoices +1 / returns -1; invoice & return
    // scopes use +1 (the family FILTER already restricts to one direction,
    // so magnitudes stay positive).
    const salesSign = scope === 'net'
      ? Prisma.sql`(CASE family WHEN 'SALES_INVOICE' THEN 1 WHEN 'SALES_RETURN' THEN -1 WHEN 'SALES_BRK_EXP_RECEIVE' THEN -1 ELSE 0 END)`
      : Prisma.sql`1`;
    const purchaseSign = scope === 'net'
      ? Prisma.sql`(CASE family WHEN 'PURCHASE_INVOICE' THEN 1 WHEN 'PURCHASE_RETURN' THEN -1 WHEN 'PURCHASE_BRK_EXP_RETURN' THEN -1 ELSE 0 END)`
      : Prisma.sql`1`;
    const salesFamFilter = Prisma.sql`family = ANY(${salesFams}::text[])`;
    const purchaseFamFilter = Prisma.sql`family = ANY(${purchaseFams}::text[])`;
    const scopedFilters = { ...filters, item: undefined, productIds: undefined };
    const itemTypeConds: Prisma.Sql[] = [
      Prisma.sql`mv.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`mv.is_cancelled = FALSE`,
      Prisma.sql`UPPER(mv.type) = ANY(${loadTypes}::text[])`,
      Prisma.sql`mv.family = ANY(${loadFams}::text[])`,
    ];
    if (scopedFilters.startDate) itemTypeConds.push(Prisma.sql`mv.date >= ${scopedFilters.startDate}::date`);
    if (scopedFilters.endDate) itemTypeConds.push(Prisma.sql`mv.date <= ${scopedFilters.endDate}::date`);
    if (scopedFilters.companyId !== undefined && scopedFilters.companyId !== null) itemTypeConds.push(Prisma.sql`mv.company_id = ${Number(scopedFilters.companyId)}`);
    const allTypesWhere = Prisma.sql`${Prisma.join(itemTypeConds, ' AND ')}`;
    const familyExpr = margVoucherFamilySql('mv');

    const [metrics] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH item_lines AS (
        SELECT
          mt.qty,
          mt.amount,
          mt.rate,
          mt.gst_amount,
          ${familyExpr} AS family,
          COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0) AS cost_rate
        FROM marg_vouchers mv
        JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleLineTypeSql('mv', 'mt')}
        LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
        LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mt.tenant_id
        LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid
        LEFT JOIN LATERAL (
          SELECT p_rate, lp_rate FROM marg_stocks ms
          WHERE ms.tenant_id = mt.tenant_id AND ms.company_id = mt.company_id AND ms.pid = mt.pid
          ORDER BY ms.updated_at DESC LIMIT 1
        ) ms ON TRUE
        WHERE ${allTypesWhere} AND ${transactionItemFilter}
      )
      SELECT
        -- Pure-invoice-only mode: the CTE loads ONLY SALES_INVOICE +
        -- PURCHASE_INVOICE rows for this item, so each column below is a
        -- plain sum with no return/challan subtraction. Both sides are
        -- populated (an item can be both bought and sold). The
        -- _return_quantity columns are retained at 0 for response-shape
        -- backward compatibility.
        -- Per-side, scope-aware sums. The family FILTER restricts each column
        -- to its side's families; the sign expression nets invoices vs returns
        -- under scope='net' and is a no-op (+1) for invoice / return scopes.
        COALESCE(SUM(ABS(qty) * ${salesSign}) FILTER (WHERE ${salesFamFilter}), 0)::float8 AS sales_quantity,
        COALESCE(SUM(ABS(amount) * ${salesSign}) FILTER (WHERE ${salesFamFilter}), 0)::float8 AS sales_amount,
        AVG(rate) FILTER (WHERE ${salesFamFilter} AND rate IS NOT NULL AND rate > 0)::float8 AS average_sale_rate,
        0::float8 AS sales_return_quantity,
        COALESCE(SUM(ABS(qty) * ${purchaseSign}) FILTER (WHERE ${purchaseFamFilter}), 0)::float8 AS purchase_quantity,
        COALESCE(SUM(ABS(amount) * ${purchaseSign}) FILTER (WHERE ${purchaseFamFilter}), 0)::float8 AS purchase_amount,
        AVG(rate) FILTER (WHERE ${purchaseFamFilter} AND rate IS NOT NULL AND rate > 0)::float8 AS average_purchase_rate,
        0::float8 AS purchase_return_quantity,
        AVG(cost_rate)::float8 AS cost_rate
      FROM item_lines
    `);

    const stockByWarehouse = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(mb.name, mb.branch, 'Company ' || ms.company_id::text) AS warehouse,
        COALESCE(SUM(ms.stock), 0)::float8 AS current_stock,
        COALESCE(SUM(ms.stock * COALESCE(ms.p_rate, ms.lp_rate, 0)), 0)::float8 AS stock_value
      FROM marg_stocks ms
      LEFT JOIN marg_products mprod ON mprod.tenant_id = ms.tenant_id AND mprod.company_id = ms.company_id AND mprod.pid = ms.pid
      LEFT JOIN marg_branches mb ON mb.tenant_id = ms.tenant_id AND mb.company_id = ms.company_id
      WHERE ms.tenant_id = ${tenantId}::uuid AND ms.source_deleted = false AND ${stockItemFilter}
      GROUP BY ms.company_id, mb.name, mb.branch
      ORDER BY current_stock DESC
    `);

    const batchStock = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT ms.batch, ms.expiry, COALESCE(ms.stock, 0)::float8 AS current_stock, COALESCE(ms.p_rate, ms.lp_rate, 0)::float8 AS cost_rate
      FROM marg_stocks ms
      LEFT JOIN marg_products mprod ON mprod.tenant_id = ms.tenant_id AND mprod.company_id = ms.company_id AND mprod.pid = ms.pid
      WHERE ms.tenant_id = ${tenantId}::uuid AND ms.source_deleted = false AND ${stockItemFilter}
      ORDER BY ms.expiry ASC NULLS LAST
      LIMIT 50
    `);

    const relatedBills = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT mv.company_id || ':' || mv.voucher AS bill_key, COALESCE(mv.vcn, mv.voucher) AS invoice_number, mv.type, mv.date,
        COALESCE(mp.par_name, mv.cid, '-') AS party_name, ABS(COALESCE(mt.qty, 0))::float8 AS quantity, ABS(COALESCE(mt.amount, 0))::float8 AS amount
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleLineTypeSql('mv', 'mt')}
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
      LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid
      WHERE ${allTypesWhere} AND ${transactionItemFilter}
      ORDER BY mv.date DESC
      LIMIT 50
    `);

    const salesAmount = Number(metrics?.sales_amount ?? 0);
    const costRate = Number(metrics?.cost_rate ?? 0);
    const salesQty = Number(metrics?.sales_quantity ?? 0);
    const profit = salesAmount - salesQty * costRate;

    return {
      metrics: {
        ...metrics,
        currentStock: stockByWarehouse.reduce((sum, row) => sum + Number(row.current_stock ?? 0), 0),
        profit,
        margin: salesAmount > 0 ? profit / salesAmount * 100 : null,
      },
      stockByWarehouse,
      batchStock,
      movementHistory: relatedBills,
      relatedBills,
    };
  }

  async getPartyDrilldown(tenantId: string, kind: AnalysisKind, partyCode: string, filters: SalesPurchaseAnalysisFilterDto) {
    const scopedFilters = { ...filters, partyCode };
    const useRollup = !this.requiresLineLevelDrill(scopedFilters);
    const metrics = useRollup
      ? await this.getPartyDrilldownMetricsFromRollup(tenantId, kind, scopedFilters)
      : await this.getPartyDrilldownMetricsFromLive(tenantId, kind, scopedFilters);
    const topItems = await this.topItems(tenantId, kind, scopedFilters);
    const billHistory = await this.getBills(tenantId, kind, { ...scopedFilters, limit: 25, offset: 0, sortBy: 'date', sortDir: 'desc' });

    return {
      metrics,
      outstanding: null,
      topItems,
      billHistory: billHistory.data,
    };
  }

  private async getPartyDrilldownMetricsFromRollup(
    tenantId: string,
    kind: AnalysisKind,
    scopedFilters: SalesPurchaseAnalysisFilterDto,
  ): Promise<any> {
    const where = this.buildRollupWhere(tenantId, kind, scopedFilters);
    const signedAmount = this.scopeRollupAmountColumn(kind, this.resolveScope(scopedFilters));
    const [metrics] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(b.${signedAmount}), 0)::float8 AS total_amount,
        COUNT(*)::int AS total_bills,
        CASE WHEN COUNT(*) > 0 THEN (COALESCE(SUM(b.${signedAmount}), 0) / COUNT(*))::float8 ELSE 0 END AS average_bill_value
      FROM marg_bill_rollup b
      WHERE ${where}
    `);
    return metrics;
  }

  private async getPartyDrilldownMetricsFromLive(
    tenantId: string,
    kind: AnalysisKind,
    scopedFilters: SalesPurchaseAnalysisFilterDto,
  ): Promise<any> {
    const where = this.buildHeaderWhere(tenantId, kind, scopedFilters, 'mv', 'mt', 'mp', 'mprod');
    const [metrics] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where, this.resolveScope(scopedFilters))})
      SELECT
        COALESCE(SUM(signed_net_amount), 0)::float8 AS total_amount,
        COUNT(*)::int AS total_bills,
        CASE WHEN COUNT(*) > 0 THEN (COALESCE(SUM(signed_net_amount), 0) / COUNT(*))::float8 ELSE 0 END AS average_bill_value
      FROM bills
    `);
    return metrics;
  }

  private async trend(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    // Fast path: monthly trend from the rollup table. The aggregate is just
    // COUNT/SUM over ~36k bill rows grouped by month — comfortably sub-second.
    if (!this.requiresLineLevelDrill(filters)) {
      const scope = this.resolveScope(filters);
      const where = this.buildRollupWhere(tenantId, kind, filters);
      const signedAmount = this.scopeRollupAmountColumn(kind, scope);
      const signedQuantity = this.scopeRollupQuantityColumn(kind, scope);
      return this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT to_char(date_trunc('month', b.date), 'YYYY-MM') AS period,
          COUNT(*)::int AS bills,
          COALESCE(SUM(b.${signedAmount}), 0)::float8 AS amount,
          COALESCE(SUM(b.${signedQuantity}), 0)::float8 AS quantity
        FROM marg_bill_rollup b
        WHERE ${where}
        GROUP BY date_trunc('month', b.date)
        ORDER BY date_trunc('month', b.date)
      `);
    }

    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where, this.resolveScope(filters))})
      SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS period,
        COUNT(*)::int AS bills,
        COALESCE(SUM(signed_net_amount), 0)::float8 AS amount,
        COALESCE(SUM(signed_quantity), 0)::float8 AS quantity
      FROM bills
      GROUP BY date_trunc('month', date)
      ORDER BY date_trunc('month', date)
    `);
  }

  private async topParties(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    // Fast path: rank parties directly from the rollup. Adds a small JOIN to
    // marg_parties for the display name; the join is a primary-key probe so
    // the speedup over the live path is still ~30×.
    if (!this.requiresLineLevelDrill(filters)) {
      const where = this.buildRollupWhere(tenantId, kind, filters);
      const signedAmount = this.scopeRollupAmountColumn(kind, this.resolveScope(filters));
      return this.prisma.$queryRaw<any[]>(Prisma.sql`
        WITH ranked AS (
          SELECT
            b.cid AS party_code,
            COALESCE(mp.par_name, b.cid, 'Unmapped Party') AS party_name,
            COUNT(*)::int AS bills,
            COALESCE(SUM(b.${signedAmount}), 0)::float8 AS value
          FROM marg_bill_rollup b
          LEFT JOIN marg_parties mp
            ON mp.tenant_id = b.tenant_id AND mp.company_id = b.company_id AND mp.cid = b.cid
          WHERE ${where}
          GROUP BY b.cid, COALESCE(mp.par_name, b.cid, 'Unmapped Party')
        )
        SELECT ROW_NUMBER() OVER (ORDER BY value DESC)::int AS rank,
          party_code, party_name AS name, bills, value,
          CASE WHEN SUM(value) OVER () > 0 THEN (value / SUM(value) OVER () * 100)::float8 ELSE 0 END AS share
        FROM ranked
        ORDER BY value DESC
        LIMIT 10
      `);
    }

    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where, this.resolveScope(filters))}),
      ranked AS (
        SELECT party_code, party_name, COUNT(*)::int AS bills, COALESCE(SUM(signed_net_amount), 0)::float8 AS value
        FROM bills GROUP BY party_code, party_name
      )
      SELECT ROW_NUMBER() OVER (ORDER BY value DESC)::int AS rank, party_code, party_name AS name, bills, value,
        CASE WHEN SUM(value) OVER () > 0 THEN (value / SUM(value) OVER () * 100)::float8 ELSE 0 END AS share
      FROM ranked
      ORDER BY value DESC
      LIMIT 10
    `);
  }

  private async topSalesmen(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    if (!this.requiresLineLevelDrill(filters)) {
      const where = this.buildRollupWhere(tenantId, kind, filters);
      const signedAmount = this.scopeRollupAmountColumn(kind, this.resolveScope(filters));
      return this.prisma.$queryRaw<any[]>(Prisma.sql`
        WITH ranked AS (
          SELECT
            COALESCE(NULLIF(TRIM(b.salesman), ''), NULLIF(TRIM(b.mr), ''), '__UNATTRIBUTED__') AS salesman_key,
            COALESCE(sm.name, NULLIF(TRIM(b.salesman), ''), NULLIF(TRIM(b.mr), ''), 'Unattributed') AS name,
            COUNT(*)::int AS bills,
            COALESCE(SUM(b.${signedAmount}), 0)::float8 AS value
          FROM marg_bill_rollup b
          LEFT JOIN salesmen sm
            ON sm.tenant_id = b.tenant_id
            AND sm.code = COALESCE(NULLIF(TRIM(b.salesman), ''), NULLIF(TRIM(b.mr), ''))
          WHERE ${where}
          GROUP BY
            COALESCE(NULLIF(TRIM(b.salesman), ''), NULLIF(TRIM(b.mr), ''), '__UNATTRIBUTED__'),
            COALESCE(sm.name, NULLIF(TRIM(b.salesman), ''), NULLIF(TRIM(b.mr), ''), 'Unattributed')
        )
        SELECT ROW_NUMBER() OVER (ORDER BY value DESC)::int AS rank,
          salesman_key AS key, name, bills, value,
          CASE WHEN SUM(value) OVER () > 0 THEN (value / SUM(value) OVER () * 100)::float8 ELSE 0 END AS share
        FROM ranked
        ORDER BY value DESC
        LIMIT 10
      `);
    }
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where, this.resolveScope(filters))}),
      ranked AS (
        SELECT
          COALESCE(salesman_code, '__UNATTRIBUTED__') AS salesman_key,
          COALESCE(salesman_name, 'Unattributed') AS name,
          COUNT(*)::int AS bills,
          COALESCE(SUM(signed_net_amount), 0)::float8 AS value
        FROM bills
        GROUP BY COALESCE(salesman_code, '__UNATTRIBUTED__'), COALESCE(salesman_name, 'Unattributed')
      )
      SELECT ROW_NUMBER() OVER (ORDER BY value DESC)::int AS rank,
        salesman_key AS key, name, bills, value,
        CASE WHEN SUM(value) OVER () > 0 THEN (value / SUM(value) OVER () * 100)::float8 ELSE 0 END AS share
      FROM ranked
      ORDER BY value DESC
      LIMIT 10
    `);
  }

  private async topStates(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    if (!this.requiresLineLevelDrill(filters)) {
      const where = this.buildRollupWhere(tenantId, kind, filters);
      const signedAmount = this.scopeRollupAmountColumn(kind, this.resolveScope(filters));
      return this.prisma.$queryRaw<any[]>(Prisma.sql`
        WITH state_per_bill AS (
          SELECT company_id, voucher,
            MAX(NULLIF(TRIM(SPLIT_PART(COALESCE(add_field, ''), ';', 20)), '')) AS state_code
          FROM marg_transactions
          WHERE tenant_id = ${tenantId}::uuid
          GROUP BY company_id, voucher
        ),
        ranked AS (
          SELECT
            COALESCE(mst.name, spb.state_code, 'Unknown') AS name,
            COUNT(*)::int AS bills,
            COALESCE(SUM(b.${signedAmount}), 0)::float8 AS value
          FROM marg_bill_rollup b
          LEFT JOIN state_per_bill spb ON spb.company_id = b.company_id AND spb.voucher = b.voucher
          LEFT JOIN marg_sale_types mst
            ON mst.tenant_id = ${tenantId}::uuid
            AND mst.company_id = b.company_id
            AND mst.sg_code = 'ROUT'
            AND mst.s_code = spb.state_code
          WHERE ${where}
          GROUP BY COALESCE(mst.name, spb.state_code, 'Unknown')
        )
        SELECT ROW_NUMBER() OVER (ORDER BY value DESC)::int AS rank,
          name, bills, value,
          CASE WHEN SUM(value) OVER () > 0 THEN (value / SUM(value) OVER () * 100)::float8 ELSE 0 END AS share
        FROM ranked
        ORDER BY value DESC
        LIMIT 10
      `);
    }
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where, this.resolveScope(filters))}),
      state_per_bill AS (
        SELECT company_id, voucher,
          MAX(NULLIF(TRIM(SPLIT_PART(COALESCE(add_field, ''), ';', 20)), '')) AS state_code
        FROM marg_transactions
        WHERE tenant_id = ${tenantId}::uuid
        GROUP BY company_id, voucher
      ),
      ranked AS (
        SELECT
          COALESCE(mst.name, spb.state_code, 'Unknown') AS name,
          COUNT(*)::int AS bills,
          COALESCE(SUM(b.signed_net_amount), 0)::float8 AS value
        FROM bills b
        LEFT JOIN state_per_bill spb ON spb.company_id = b.company_id AND spb.voucher = b.voucher
        LEFT JOIN marg_sale_types mst
          ON mst.tenant_id = ${tenantId}::uuid
          AND mst.company_id = b.company_id
          AND mst.sg_code = 'ROUT'
          AND mst.s_code = spb.state_code
        GROUP BY COALESCE(mst.name, spb.state_code, 'Unknown')
      )
      SELECT ROW_NUMBER() OVER (ORDER BY value DESC)::int AS rank,
        name, bills, value,
        CASE WHEN SUM(value) OVER () > 0 THEN (value / SUM(value) OVER () * 100)::float8 ELSE 0 END AS share
      FROM ranked
      ORDER BY value DESC
      LIMIT 10
    `);
  }

  private async topCities(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    // City / Area is resolved from the transaction-time area code on
    // marg_transactions.add_field (segment 21), collapsed to one value per
    // voucher, then named via marg_sale_types(sg_code='AREA'). This is the
    // SAME source the dashboard regional-breakdown report uses and mirrors
    // topStates() (segment 20 → ROUT). We deliberately do NOT read the
    // party-master area (mp.area): that value is mutable and silently rewrites
    // historical regional totals when a customer is re-routed.
    if (!this.requiresLineLevelDrill(filters)) {
      const where = this.buildRollupWhere(tenantId, kind, filters);
      const signedAmount = this.scopeRollupAmountColumn(kind, this.resolveScope(filters));
      return this.prisma.$queryRaw<any[]>(Prisma.sql`
        WITH area_per_bill AS (
          SELECT company_id, voucher,
            MAX(NULLIF(TRIM(SPLIT_PART(COALESCE(add_field, ''), ';', 21)), '')) AS area_code
          FROM marg_transactions
          WHERE tenant_id = ${tenantId}::uuid
          GROUP BY company_id, voucher
        ),
        ranked AS (
          SELECT
            COALESCE(mst.name, apb.area_code, 'Unknown') AS name,
            COUNT(*)::int AS bills,
            COALESCE(SUM(b.${signedAmount}), 0)::float8 AS value
          FROM marg_bill_rollup b
          LEFT JOIN area_per_bill apb ON apb.company_id = b.company_id AND apb.voucher = b.voucher
          LEFT JOIN marg_sale_types mst
            ON mst.tenant_id = ${tenantId}::uuid
            AND mst.company_id = b.company_id
            AND mst.sg_code = 'AREA'
            AND mst.s_code = apb.area_code
          WHERE ${where}
          GROUP BY COALESCE(mst.name, apb.area_code, 'Unknown')
        )
        SELECT ROW_NUMBER() OVER (ORDER BY value DESC)::int AS rank,
          name, bills, value,
          CASE WHEN SUM(value) OVER () > 0 THEN (value / SUM(value) OVER () * 100)::float8 ELSE 0 END AS share
        FROM ranked
        ORDER BY value DESC
        LIMIT 10
      `);
    }
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where, this.resolveScope(filters))}),
      area_per_bill AS (
        SELECT company_id, voucher,
          MAX(NULLIF(TRIM(SPLIT_PART(COALESCE(add_field, ''), ';', 21)), '')) AS area_code
        FROM marg_transactions
        WHERE tenant_id = ${tenantId}::uuid
        GROUP BY company_id, voucher
      ),
      ranked AS (
        SELECT
          COALESCE(mst.name, apb.area_code, 'Unknown') AS name,
          COUNT(*)::int AS bills,
          COALESCE(SUM(b.signed_net_amount), 0)::float8 AS value
        FROM bills b
        LEFT JOIN area_per_bill apb ON apb.company_id = b.company_id AND apb.voucher = b.voucher
        LEFT JOIN marg_sale_types mst
          ON mst.tenant_id = ${tenantId}::uuid
          AND mst.company_id = b.company_id
          AND mst.sg_code = 'AREA'
          AND mst.s_code = apb.area_code
        GROUP BY COALESCE(mst.name, apb.area_code, 'Unknown')
      )
      SELECT ROW_NUMBER() OVER (ORDER BY value DESC)::int AS rank,
        name, bills, value,
        CASE WHEN SUM(value) OVER () > 0 THEN (value / SUM(value) OVER () * 100)::float8 ELSE 0 END AS share
      FROM ranked
      ORDER BY value DESC
      LIMIT 10
    `);
  }

  private async topItems(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    const signExpr = this.scopeAmountSignSql(kind, this.resolveScope(filters), 'mv');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT ROW_NUMBER() OVER (ORDER BY SUM(ABS(COALESCE(mt.amount, 0)) * ${signExpr}) DESC)::int AS rank,
        COALESCE(p.id::text, mprod.product_id::text, mt.pid) AS item_key,
        COALESCE(p.code, mprod.code, mt.pid) AS item_code,
        COALESCE(p.name, mprod.name, 'Unmapped Item') AS item_name,
        -- Per-line sums are signed by the parent voucher's family so that for
        -- a sold-then-returned item the quantities/amounts net out, and
        -- challan/SC lines contribute zero (sign = 0).
        COALESCE(SUM(ABS(mt.qty) * ${signExpr}), 0)::float8 AS quantity,
        COALESCE(SUM(ABS(mt.amount) * ${signExpr}), 0)::float8 AS value
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleLineTypeSql('mv', 'mt')}
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
      LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mt.tenant_id
      LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid
      WHERE ${where}
      GROUP BY COALESCE(p.id::text, mprod.product_id::text, mt.pid), COALESCE(p.code, mprod.code, mt.pid), COALESCE(p.name, mprod.name, 'Unmapped Item')
      ORDER BY value DESC
      LIMIT 10
    `);
  }

  private async taxSummary(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    // Scope-aware tax aggregation. invoice: tax positive. net: invoice tax
    // positive, return tax negative (net GST liability). return: tax shown
    // positive (sign = 1, only return families pass the WHERE). Without the
    // multiplier a return would *increase* invoice-scope tax, which is wrong.
    const signExpr = this.scopeAmountSignSql(kind, this.resolveScope(filters), 'mv');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(mt.gst, 0)::float8 AS tax_pct,
        COALESCE(SUM(ABS(mt.gst_amount) * ${signExpr}), 0)::float8 AS tax_amount,
        COALESCE(SUM(ABS(mt.amount) * ${signExpr}), 0)::float8 AS taxable_amount
      FROM marg_vouchers mv
      JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleLineTypeSql('mv', 'mt')}
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mt.tenant_id AND mprod.company_id = mt.company_id AND mprod.pid = mt.pid
      LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid
      WHERE ${where}
      GROUP BY COALESCE(mt.gst, 0)
      ORDER BY tax_pct
    `);
  }

  private async paymentSummary(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    // Fast path: derive payment_mode from rollup's cash/others directly.
    if (!this.requiresLineLevelDrill(filters)) {
      const where = this.buildRollupWhere(tenantId, kind, filters);
      const signedAmount = this.scopeRollupAmountColumn(kind, this.resolveScope(filters));
      return this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT
          CASE
            WHEN COALESCE(b.cash, 0) > 0 AND COALESCE(b.others, 0) > 0 THEN 'MIXED'
            WHEN COALESCE(b.cash, 0) > 0 THEN 'CASH'
            ELSE 'CREDIT'
          END AS payment_mode,
          COUNT(*)::int AS bills,
          COALESCE(SUM(b.${signedAmount}), 0)::float8 AS amount
        FROM marg_bill_rollup b
        WHERE ${where}
        GROUP BY 1
        ORDER BY amount DESC
      `);
    }

    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where, this.resolveScope(filters))})
      SELECT payment_mode, COUNT(*)::int AS bills, COALESCE(SUM(signed_net_amount), 0)::float8 AS amount
      FROM bills
      GROUP BY payment_mode
      ORDER BY amount DESC
    `);
  }

  private familyAwareAmountSignSql(kind: AnalysisKind, voucherAlias: string = 'mv'): Prisma.Sql {
    // Per-family multiplier applied to bill / line amounts before summing.
    // Sales:    invoice → +1, return → -1, challan/SC/everything else → 0.
    // Purchase: invoice → +1, return → -1, everything else → 0.
    // Producing zero for challan and SC is what excludes them from commercial
    // headline totals while keeping their rows visible in drilldown lists.
    return kind === 'sales'
      ? margSalesAmountSignSql(voucherAlias)
      : margPurchaseAmountSignSql(voucherAlias);
  }

  /**
   * True when the caller's filters reference columns that only exist at the
   * Dis (line) level — product, item, category, brand, batch, tax type, or
   * per-line quantity bounds. When this returns true, we MUST run the slow
   * live-aggregation path (billRollupSql + buildHeaderWhere) because the
   * marg_bill_rollup table is per-bill and doesn't carry per-line columns.
   * When false, we can read the pre-aggregated rollup directly for the
   * 30-50× speedup that makes report timeouts go away.
   */
  private requiresLineLevelDrill(filters: SalesPurchaseAnalysisFilterDto): boolean {
    return Boolean(
      (filters.productIds && filters.productIds.length > 0)
      || filters.item
      || filters.category
      || filters.brand
      || filters.batch
      || filters.taxType
      || filters.minQuantity !== undefined
      || filters.maxQuantity !== undefined,
    );
  }

  /**
   * Pre-signed amount column to SUM for the headline / drilldown totals.
   * Rollup table stores both sales and purchase signed amounts so a single
   * SELECT works for either kind.
   */
  private signedAmountColumn(kind: AnalysisKind): Prisma.Sql {
    return kind === 'sales'
      ? Prisma.raw('signed_sales_amount')
      : Prisma.raw('signed_purchase_amount');
  }

  private signedQuantityColumn(kind: AnalysisKind): Prisma.Sql {
    return kind === 'sales'
      ? Prisma.raw('signed_sales_quantity')
      : Prisma.raw('signed_purchase_quantity');
  }

  private amountSignColumn(kind: AnalysisKind): Prisma.Sql {
    return kind === 'sales'
      ? Prisma.raw('sales_amount_sign')
      : Prisma.raw('purchase_amount_sign');
  }

  /**
   * Bill-level WHERE for the marg_bill_rollup table. Mirrors the bill-level
   * subset of buildHeaderWhere — everything that filters at the bill / voucher
   * level rather than the per-line level. Line-level filters are caught
   * upstream by `requiresLineLevelDrill`; if you add a new line-level filter
   * to buildHeaderWhere you MUST also add it to requiresLineLevelDrill so
   * the planner doesn't silently miss it.
   *
   * Aliases:
   *   b   = marg_bill_rollup
   *   mp  = marg_parties (LEFT JOIN, used for party display + customer/supplier filters)
   */
  private buildRollupWhere(
    tenantId: string,
    kind: AnalysisKind,
    filters: SalesPurchaseAnalysisFilterDto,
  ): Prisma.Sql {
    const scope = this.resolveScope(filters);
    const types = this.documentTypes(kind, scope);
    // Two-gate scope filter: type narrows the load set, family is the
    // decisive gate. Invoice scope → SALES_INVOICE/PURCHASE_INVOICE (single
    // value, byte-identical to Part 1). Return scope → the return families.
    // Net scope → both.
    const conds: Prisma.Sql[] = [
      Prisma.sql`b.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`b.type = ANY(${types}::text[])`,
      this.scopeFamilyFilterSql(Prisma.sql`b.family`, kind, scope),
    ];

    if (filters.startDate) conds.push(Prisma.sql`b.date >= ${filters.startDate}::date`);
    if (filters.endDate) conds.push(Prisma.sql`b.date <= ${filters.endDate}::date`);
    if (filters.companyId !== undefined && filters.companyId !== null) {
      conds.push(Prisma.sql`b.company_id = ${Number(filters.companyId)}`);
    }
    const branchId = filters.branchId ?? filters.warehouseId;
    if (branchId) {
      conds.push(Prisma.sql`EXISTS (SELECT 1 FROM marg_branches mbf WHERE mbf.tenant_id = b.tenant_id AND mbf.company_id = b.company_id AND mbf.location_id = ${branchId}::uuid)`);
    }
    const partyCode = filters.partyCode ?? (kind === 'sales' ? filters.customerCode : filters.supplierCode);
    if (partyCode) conds.push(Prisma.sql`b.cid = ${partyCode}`);
    if (filters.user) {
      const userTerm = `%${filters.user}%`;
      const salesmanCode = Prisma.sql`COALESCE(NULLIF(TRIM(b.salesman), ''), NULLIF(TRIM(b.mr), ''))`;
      conds.push(Prisma.sql`(
        COALESCE(b.salesman, '') ILIKE ${userTerm}
        OR COALESCE(b.mr, '') ILIKE ${userTerm}
        OR EXISTS (
          SELECT 1 FROM salesmen sf
          WHERE sf.tenant_id = b.tenant_id
            AND sf.code = ${salesmanCode}
            AND sf.name ILIKE ${userTerm}
        )
      )`);
    }
    if (filters.paymentMode) {
      if (filters.paymentMode === 'CASH') conds.push(Prisma.sql`COALESCE(b.cash, 0) > 0 AND COALESCE(b.others, 0) = 0`);
      if (filters.paymentMode === 'CREDIT') conds.push(Prisma.sql`COALESCE(b.cash, 0) = 0`);
      if (filters.paymentMode === 'MIXED') conds.push(Prisma.sql`COALESCE(b.cash, 0) > 0 AND COALESCE(b.others, 0) > 0`);
    }
    // Legacy 'status' filter. Under the default 'invoice' scope every row is
    // POSTED, so status='RETURN' yields an empty set (preserved Part-1
    // accept-and-ignore semantics). Under 'return'/'net' scope the caller is
    // explicitly asking for returns, so the status filter is a no-op there.
    if (scope === 'invoice' && filters.status === 'RETURN') {
      conds.push(Prisma.sql`FALSE`);
    }
    if (filters.minAmount !== undefined) conds.push(Prisma.sql`COALESCE(b.final_amt, 0) >= ${filters.minAmount}`);
    if (filters.maxAmount !== undefined) conds.push(Prisma.sql`COALESCE(b.final_amt, 0) <= ${filters.maxAmount}`);

    return Prisma.sql`${Prisma.join(conds, ' AND ')}`;
  }

  private billRollupSql(_tenantId: string, kind: AnalysisKind, where: Prisma.Sql, scope: ReportScope = 'invoice'): Prisma.Sql {
    const familyExpr = margVoucherFamilySql('mv');
    const signExpr = this.scopeAmountSignSql(kind, scope, 'mv');
    return Prisma.sql`
      SELECT
        mv.company_id || ':' || mv.voucher AS bill_key,
        mv.company_id,
        mv.voucher,
        mv.type,
        ${familyExpr} AS family,
        ${signExpr} AS amount_sign,
        COALESCE(mv.vcn, mv.voucher) AS invoice_number,
        mv.date,
        mv.cid AS party_code,
        COALESCE(mp.par_name, mv.cid, 'Unmapped Party') AS party_name,
        COALESCE(mb.name, mb.branch, 'Company ' || mv.company_id::text) AS branch_name,
        mb.location_id AS branch_id,
        COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) AS salesman_code,
        COALESCE(sm.name, NULLIF(TRIM(REGEXP_REPLACE(smp.par_name, '[[:cntrl:]]', '', 'g')), ''), CASE
          WHEN COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) IS NULL THEN NULL
          ELSE 'Unknown salesman (' || COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) || ')'
        END) AS salesman_name,
        COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''), '') AS salesman,
        CASE
          WHEN COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) IS NULL THEN ''
          ELSE COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) || ' - ' || COALESCE(sm.name, NULLIF(TRIM(REGEXP_REPLACE(smp.par_name, '[[:cntrl:]]', '', 'g')), ''), 'Unknown salesman (' || COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) || ')')
        END AS salesman_display,
        COALESCE(mv.mr, mv.salesman, '') AS user_name,
        CASE
          WHEN COALESCE(mv.cash, 0) > 0 AND COALESCE(mv.others, 0) > 0 THEN 'MIXED'
          WHEN COALESCE(mv.cash, 0) > 0 THEN 'CASH'
          ELSE 'CREDIT'
        END AS payment_mode,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)), 0)::float8 AS gross_amount,
        COALESCE(SUM(GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0)), 0)::float8 AS discount,
        CASE
          WHEN COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)), 0) > 0
          THEN LEAST(
            GREATEST(
              COALESCE(SUM(GREATEST(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0) - ABS(COALESCE(mt.amount, 0)), 0)), 0)
              / COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(mt.rate, 0)), 0)
              * 100,
              0
            ),
            100
          )::float8
          ELSE NULL::float8
        END AS discount_pct,
        COALESCE(SUM(ABS(COALESCE(mt.gst_amount, 0))), 0)::float8 AS tax_amount,
        (COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))) - SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))))::float8 AS round_off,
        COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))))::float8 AS net_amount,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)), 0)::float8 AS cost_amount,
        (COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))) - COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)), 0))::float8 AS profit,
        CASE WHEN COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))) > 0
          THEN ((COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))) - COALESCE(SUM(ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0)), 0)) / COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)))) * 100)::float8
          ELSE NULL
        END AS margin_pct,
        COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0)::float8 AS quantity,
        COUNT(DISTINCT mt.pid) FILTER (WHERE mt.pid IS NOT NULL)::int AS item_count,
        CASE WHEN mv.type IN ('R', 'T', 'B') THEN 'RETURN' ELSE 'POSTED' END AS status,
        -- Pre-computed signed amount: net_amount × amount_sign so callers
        -- can SUM(signed_net_amount) for a correctly contra-signed total
        -- (sales invoices add, sales returns subtract, challans / SC / other
        -- families contribute zero).
        (
          COALESCE(MAX(mv.final_amt), SUM(ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))))
          * ${signExpr}
        )::float8 AS signed_net_amount,
        (COALESCE(SUM(ABS(COALESCE(mt.qty, 0))), 0) * ${signExpr})::float8 AS signed_quantity
      FROM marg_vouchers mv
      LEFT JOIN marg_transactions mt ON mt.tenant_id = mv.tenant_id AND mt.company_id = mv.company_id AND mt.voucher = mv.voucher AND ${this.compatibleLineTypeSql('mv', 'mt')}
      LEFT JOIN marg_products mprod ON mprod.tenant_id = mv.tenant_id AND mprod.company_id = mv.company_id AND mprod.pid = mt.pid
      LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mv.tenant_id
      LEFT JOIN marg_parties mp ON mp.tenant_id = mv.tenant_id AND mp.company_id = mv.company_id AND mp.cid = mv.cid
      LEFT JOIN marg_branches mb ON mb.tenant_id = mv.tenant_id AND mb.company_id = mv.company_id
      LEFT JOIN salesmen sm
        ON sm.tenant_id = mv.tenant_id
       AND sm.code = COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''))
      LEFT JOIN marg_parties smp
        ON smp.tenant_id = mv.tenant_id
       AND smp.company_id = mv.company_id
       AND smp.cid = COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''))
       AND smp.is_deleted = false
      LEFT JOIN LATERAL (
        SELECT p_rate, lp_rate
        FROM marg_stocks ms
        WHERE ms.tenant_id = mv.tenant_id AND ms.company_id = mv.company_id AND ms.pid = mt.pid
          AND (mt.batch IS NULL OR ms.batch = mt.batch)
        ORDER BY CASE WHEN mt.batch IS NOT NULL AND ms.batch = mt.batch THEN 0 ELSE 1 END, ms.updated_at DESC
        LIMIT 1
      ) ms ON TRUE
      WHERE ${where}
      -- mv.family is the STORED GENERATED column the sign helpers
      -- reference. The multiplication MAX(final_amt) * signExpr above sits
      -- OUTSIDE the aggregate, so Postgres requires mv.family in the
      -- GROUP BY (it does NOT infer functional dependency from type+vcn
      -- even though they are listed here). Functionally constant within a
      -- (company_id, voucher, type) group, so adding it does not expand
      -- result cardinality.
      GROUP BY mv.company_id, mv.voucher, mv.type, mv.vcn, mv.family, mv.date, mv.cid, mp.par_name, mb.name, mb.branch, mb.location_id, mv.salesman, mv.mr, sm.name, smp.par_name, mv.cash, mv.others
    `;
  }

  private buildHeaderWhere(
    tenantId: string,
    kind: AnalysisKind,
    filters: SalesPurchaseAnalysisFilterDto,
    voucherAlias: string,
    transactionAlias: string,
    partyAlias: string,
    productAlias: string,
  ): Prisma.Sql {
    const mv = Prisma.raw(voucherAlias);
    const mt = Prisma.raw(transactionAlias);
    const mp = Prisma.raw(partyAlias);
    const mprod = Prisma.raw(productAlias);
    const scope = this.resolveScope(filters);
    const types = this.documentTypes(kind, scope);
    // Cancelled vouchers are NEVER part of commercial aggregates regardless of
    // which downstream query consumes this where clause — filtering here keeps
    // the contract in one place. The family filter is scope-aware (mirrors
    // buildRollupWhere): invoice → pure invoice family; return → return
    // families; net → both.
    const conds: Prisma.Sql[] = [
      Prisma.sql`${mv}.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`${mv}.is_cancelled = FALSE`,
      Prisma.sql`${mv}.type = ANY(${types}::text[])`,
      this.scopeFamilyFilterSql(Prisma.sql`${mv}.family`, kind, scope),
    ];

    if (filters.startDate) conds.push(Prisma.sql`${mv}.date >= ${filters.startDate}::date`);
    if (filters.endDate) conds.push(Prisma.sql`${mv}.date <= ${filters.endDate}::date`);
    if (filters.companyId !== undefined && filters.companyId !== null) conds.push(Prisma.sql`${mv}.company_id = ${Number(filters.companyId)}`);
    const branchId = filters.branchId ?? filters.warehouseId;
    if (branchId) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM marg_branches mbf WHERE mbf.tenant_id = ${mv}.tenant_id AND mbf.company_id = ${mv}.company_id AND mbf.location_id = ${branchId}::uuid)`);
    const partyCode = filters.partyCode ?? (kind === 'sales' ? filters.customerCode : filters.supplierCode);
    if (partyCode) conds.push(Prisma.sql`${mv}.cid = ${partyCode}`);
    if (filters.productIds?.length) conds.push(Prisma.sql`${mprod}.product_id = ANY(${filters.productIds}::uuid[])`);
    if (filters.item) conds.push(Prisma.sql`(${mt}.pid = ${filters.item} OR ${mprod}.code ILIKE ${`%${filters.item}%`} OR ${mprod}.name ILIKE ${`%${filters.item}%`})`);
    if (filters.category) conds.push(Prisma.sql`${mprod}.g_code5 ILIKE ${`%${filters.category}%`}`);
    if (filters.brand) conds.push(Prisma.sql`${mprod}.g_code ILIKE ${`%${filters.brand}%`}`);
    if (filters.batch) conds.push(Prisma.sql`${mt}.batch ILIKE ${`%${filters.batch}%`}`);
    if (filters.user) {
      const userTerm = `%${filters.user}%`;
      const salesmanCode = Prisma.sql`COALESCE(NULLIF(TRIM(${mv}.salesman), ''), NULLIF(TRIM(${mv}.mr), ''), NULLIF(TRIM(${mp}.mr), ''))`;
      conds.push(Prisma.sql`(
        COALESCE(${mv}.salesman, '') ILIKE ${userTerm}
        OR COALESCE(${mv}.mr, '') ILIKE ${userTerm}
        OR COALESCE(${mp}.mr, '') ILIKE ${userTerm}
        OR EXISTS (
          SELECT 1 FROM salesmen sf
          WHERE sf.tenant_id = ${mv}.tenant_id
            AND sf.code = ${salesmanCode}
            AND sf.name ILIKE ${userTerm}
        )
        OR EXISTS (
          SELECT 1 FROM marg_parties spf
          WHERE spf.tenant_id = ${mv}.tenant_id
            AND spf.company_id = ${mv}.company_id
            AND spf.cid = ${salesmanCode}
            AND spf.par_name ILIKE ${userTerm}
        )
      )`);
    }
    if (filters.taxType) conds.push(Prisma.sql`${mt}.gst::text = ${filters.taxType}`);
    if (filters.paymentMode) {
      if (filters.paymentMode === 'CASH') conds.push(Prisma.sql`COALESCE(${mv}.cash, 0) > 0 AND COALESCE(${mv}.others, 0) = 0`);
      if (filters.paymentMode === 'CREDIT') conds.push(Prisma.sql`COALESCE(${mv}.cash, 0) = 0`);
      if (filters.paymentMode === 'MIXED') conds.push(Prisma.sql`COALESCE(${mv}.cash, 0) > 0 AND COALESCE(${mv}.others, 0) > 0`);
    }
    // Legacy 'status' filter. Empty result for status='RETURN' under the
    // default invoice scope (every loaded row is POSTED); no-op under
    // return/net scope where returns are explicitly requested.
    if (scope === 'invoice' && filters.status === 'RETURN') {
      conds.push(Prisma.sql`FALSE`);
    }
    if (filters.minAmount !== undefined) conds.push(Prisma.sql`COALESCE(${mv}.final_amt, 0) >= ${filters.minAmount}`);
    if (filters.maxAmount !== undefined) conds.push(Prisma.sql`COALESCE(${mv}.final_amt, 0) <= ${filters.maxAmount}`);
    if (filters.minQuantity !== undefined) conds.push(Prisma.sql`ABS(COALESCE(${mt}.qty, 0)) >= ${filters.minQuantity}`);
    if (filters.maxQuantity !== undefined) conds.push(Prisma.sql`ABS(COALESCE(${mt}.qty, 0)) <= ${filters.maxQuantity}`);

    return Prisma.sql`${Prisma.join(conds, ' AND ')}`;
  }

  private documentTypes(kind: AnalysisKind, scope: ReportScope = 'invoice'): string[] {
    // Header types to LOAD for the given scope. The family filter applied in
    // buildRollupWhere / buildHeaderWhere is the second, decisive gate
    // (e.g. it excludes a type=S voucher whose add_field marks it a challan).
    // Default scope 'invoice' returns exactly the Part-1 pure-invoice types,
    // so legacy callers (e.g. getBillDrilldown) are unchanged.
    const invoiceTypes = kind === 'sales' ? [...SALES_TYPES] : [...PURCHASE_TYPES];
    const returnTypes = kind === 'sales' ? ['R', 'W'] : ['B', 'Q'];
    if (kind !== 'sales' && kind !== 'purchase') throw new BadRequestException('Invalid analysis kind');
    if (scope === 'invoice') return invoiceTypes;
    if (scope === 'return') return returnTypes;
    return [...invoiceTypes, ...returnTypes]; // net
  }

  // ── Scope (Part 2: returns + net) ──────────────────────────────────────
  // resolveScope defaults to 'invoice' so every legacy caller is unchanged.
  private resolveScope(filters: SalesPurchaseAnalysisFilterDto): ReportScope {
    return filters.scope ?? 'invoice';
  }

  /** Families a row must carry to appear, for the given kind + scope. */
  private scopeFamilies(kind: AnalysisKind, scope: ReportScope): string[] {
    const invoice = kind === 'sales' ? [PURE_SALES_FAMILY] : [PURE_PURCHASE_FAMILY];
    const returns = kind === 'sales' ? SALES_RETURN_FAMILIES : PURCHASE_RETURN_FAMILIES;
    if (scope === 'invoice') return invoice;
    if (scope === 'return') return returns;
    return [...invoice, ...returns]; // net
  }

  /**
   * Family filter SQL for the given column (e.g. `b.family` / `mv.family`).
   * Emits a single `= 'X'` for the invoice scope (byte-identical to Part 1,
   * so the Part 1 contract tests still hold) and `= ANY(...)` for the
   * multi-family return / net scopes.
   */
  private scopeFamilyFilterSql(familyColumn: Prisma.Sql, kind: AnalysisKind, scope: ReportScope): Prisma.Sql {
    const fams = this.scopeFamilies(kind, scope);
    return fams.length === 1
      ? Prisma.sql`${familyColumn} = ${fams[0]}`
      : Prisma.sql`${familyColumn} = ANY(${fams}::text[])`;
  }

  /**
   * Per-row amount-sign expression for the LIVE (line-level) path. Multiplies
   * an ABS magnitude before summing:
   *   - invoice: family sign (+1 invoice; other families 0 — but only invoice
   *     family passes the WHERE, so effectively +1)
   *   - net:     family sign (+1 invoice, -1 return) → SUM = invoices − returns
   *   - return:  +1 (only return families pass the WHERE) → SUM = positive
   *              returns magnitude
   * Centralising the scope rule here means billRollupSql, topItems,
   * taxSummary, dimension, and comparison all become scope-correct by
   * threading this one expression instead of familyAwareAmountSignSql.
   */
  private scopeAmountSignSql(kind: AnalysisKind, scope: ReportScope, voucherAlias = 'mv'): Prisma.Sql {
    if (scope === 'return') return Prisma.sql`1`;
    return this.familyAwareAmountSignSql(kind, voucherAlias);
  }

  /**
   * Pre-signed amount column to SUM on the ROLLUP path. The rollup stores
   * family-signed amounts (invoice +1, return -1) at sync time, so:
   *   - invoice / net: use the signed column (net for invoices, contra for
   *     returns → correct net-of-returns when both families are loaded)
   *   - return: the stored sign is -1, but a returns report counts UP, so we
   *     read the unsigned net_amount column instead.
   */
  private scopeRollupAmountColumn(kind: AnalysisKind, scope: ReportScope): Prisma.Sql {
    return scope === 'return' ? Prisma.raw('net_amount') : this.signedAmountColumn(kind);
  }

  private scopeRollupQuantityColumn(kind: AnalysisKind, scope: ReportScope): Prisma.Sql {
    return scope === 'return' ? Prisma.raw('quantity') : this.signedQuantityColumn(kind);
  }

  /**
   * Rollup cost expression (b-aliased). For invoice/net, cost is family-signed
   * so it nets the same way as the amount; for return it's the unsigned cost
   * of the returned goods (positive).
   */
  private scopeRollupCostExpr(kind: AnalysisKind, scope: ReportScope): Prisma.Sql {
    if (scope === 'return') return Prisma.sql`b.cost_amount`;
    const sign = this.amountSignColumn(kind);
    return Prisma.sql`b.cost_amount * b.${sign}`;
  }

  private lineTypesForHeader(headerType: string | null | undefined): string[] {
    const type = String(headerType || '').trim().toUpperCase();
    switch (type) {
      case 'S':
        return ['G', 'S', 'O'];
      case 'R':
        return ['R'];
      case 'T':
        return ['X', 'T'];
      case 'P':
        return ['P'];
      case 'B':
        return ['B'];
      // Q (BRK/EXP Return) — Q-lines dominate (92,768 rows in production
      // audit), with rare P-line cross-pairs (25 rows) kept for safety.
      case 'Q':
        return ['Q', 'P'];
      // W (BRK/EXP Receive) — W-lines dominate (61,370 rows), with rare
      // R-line cross-pairs (1 row) kept for safety. L-line pairs (726 rows
      // under L header) are handled separately by header L.
      case 'W':
        return ['W', 'R'];
      // U (price-diff DN) — U-line type rare; production audit shows X-lines.
      // Included for header-drilldown completeness even though U is excluded
      // from commercial document loads.
      case 'U':
        return ['X', 'U'];
      default:
        return [...SALES_LINE_TYPES, ...PURCHASE_LINE_TYPES];
    }
  }

  private compatibleLineTypeSql(voucherAlias: string, transactionAlias: string): Prisma.Sql {
    const mv = Prisma.raw(voucherAlias);
    const mt = Prisma.raw(transactionAlias);
    // Header→line type compatibility. UPPER on mv.type so lowercase header
    // rows (Marg auto-generated 'v' / 'u' variants) match their uppercase
    // counterpart classifier — keeps this join expression aligned with the
    // GENERATED `family` column which already UPPER-normalises type.
    //
    // Pairings sourced from the V2 audit on production data (`SELECT
    // mv.type, mt.type, COUNT(*) FROM marg_vouchers mv JOIN
    // marg_transactions mt ...`). Each branch is the dominant pair plus
    // the rare cross-pair (≤25 rows) kept defensively so edge-case
    // vouchers don't get their lines dropped.
    return Prisma.sql`(
      (UPPER(${mv}.type) = 'S' AND ${mt}.type IN ('G', 'S', 'O'))
      OR (UPPER(${mv}.type) = 'R' AND ${mt}.type IN ('R', 'W'))
      OR (UPPER(${mv}.type) = 'T' AND ${mt}.type IN ('X', 'T'))
      OR (UPPER(${mv}.type) = 'P' AND ${mt}.type IN ('P', 'Q'))
      OR (UPPER(${mv}.type) = 'B' AND ${mt}.type = 'B')
      OR (UPPER(${mv}.type) = 'Q' AND ${mt}.type IN ('Q', 'B'))
      OR (UPPER(${mv}.type) = 'W' AND ${mt}.type IN ('W', 'R'))
      OR (UPPER(${mv}.type) = 'U' AND ${mt}.type IN ('X', 'U'))
    )`;
  }

  private parseBillKey(billKey: string): { companyId: number; voucher: string } {
    const [companyIdRaw, ...voucherParts] = decodeURIComponent(billKey).split(':');
    const companyId = Number(companyIdRaw);
    const voucher = voucherParts.join(':');
    if (!Number.isInteger(companyId) || !voucher) throw new BadRequestException('Invalid bill key');
    return { companyId, voucher };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Dimensional analysis (salesman / salt / company / group / product / hsn)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Resolve a dimension key into the SQL group expression + label expression.
   * `salesman` reads from the voucher (no product join needed). The remaining
   * dimensions resolve from the canonical `products` table joined via
   * `marg_products.product_id`. We coalesce to a stable "Unmapped" bucket so
   * un-linked Marg pids still appear in the report rather than vanishing.
   */
  private dimensionExpressions(dimension: string): {
    keyExpr: Prisma.Sql;
    labelExpr: Prisma.Sql;
    needsProduct: boolean;
    // Optional extra JOIN spliced into the `lines` CTE (used by both
    // getDimensionAnalysis and dimensionComparison). Lets a dimension resolve
    // from a per-bill computed source — e.g. `state`, whose code lives on the
    // transaction lines (add_field segment 20) and must be collapsed to one
    // value per voucher before grouping, otherwise lines that omit the code
    // would fragment a single bill across the real state and an Unmapped
    // bucket. Defaults to empty for the column-resolved dimensions.
    extraJoin?: Prisma.Sql;
  } {
    switch (dimension) {
      case 'salesman':
        return {
          keyExpr: Prisma.sql`COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''), '__UNATTRIBUTED__')`,
          labelExpr: Prisma.sql`CASE
            WHEN COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) IS NULL THEN 'Unattributed'
            ELSE COALESCE((
              SELECT s.name FROM salesmen s
              WHERE s.tenant_id = mv.tenant_id
                AND s.code = COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''))
              LIMIT 1
            ), (
              SELECT NULLIF(TRIM(REGEXP_REPLACE(sp.par_name, '[[:cntrl:]]', '', 'g')), '') FROM marg_parties sp
              WHERE sp.tenant_id = mv.tenant_id
                AND sp.company_id = mv.company_id
                AND sp.cid = COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''))
                AND sp.is_deleted = false
              LIMIT 1
            ), 'Unknown salesman (' || COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) || ')')
          END`,
          needsProduct: false,
        };
      case 'salt':
        return {
          keyExpr: Prisma.sql`COALESCE(NULLIF(TRIM(p.salt), ''), '__UNMAPPED__')`,
          labelExpr: Prisma.sql`CASE
            WHEN NULLIF(TRIM(p.salt), '') IS NULL THEN 'Unmapped salt'
            ELSE COALESCE((SELECT ps.name FROM product_salts ps WHERE ps.tenant_id = p.tenant_id AND ps.code = TRIM(p.salt) LIMIT 1), 'Unknown salt (' || TRIM(p.salt) || ')')
          END`,
          needsProduct: true,
        };
      case 'productCompany':
        return {
          keyExpr: Prisma.sql`COALESCE(NULLIF(TRIM(p.product_company), ''), '__UNMAPPED__')`,
          labelExpr: Prisma.sql`CASE
            WHEN NULLIF(TRIM(p.product_company), '') IS NULL THEN 'Unmapped company'
            ELSE TRIM(p.product_company) || ' - ' || COALESCE((SELECT pc.name FROM product_companies pc WHERE pc.tenant_id = p.tenant_id AND pc.code = TRIM(p.product_company) LIMIT 1), 'Unknown company (' || TRIM(p.product_company) || ')')
          END`,
          needsProduct: true,
        };
      case 'productGroup':
        return {
          keyExpr: Prisma.sql`COALESCE(NULLIF(TRIM(p.product_group), ''), '__UNMAPPED__')`,
          labelExpr: Prisma.sql`CASE
            WHEN NULLIF(TRIM(p.product_group), '') IS NULL THEN 'Unmapped group'
            ELSE COALESCE((SELECT pg.name FROM product_categories pg WHERE pg.tenant_id = p.tenant_id AND pg.code = TRIM(p.product_group) LIMIT 1), 'Unknown group (' || TRIM(p.product_group) || ')')
          END`,
          needsProduct: true,
        };
      case 'hsnCode':
        return {
          keyExpr: Prisma.sql`COALESCE(NULLIF(TRIM(p.hsn_code), ''), '__UNMAPPED__')`,
          labelExpr: Prisma.sql`CASE
            WHEN NULLIF(TRIM(p.hsn_code), '') IS NULL THEN 'Unmapped HSN'
            ELSE COALESCE(
              (SELECT mst.name FROM marg_sale_types mst
               WHERE mst.tenant_id = mv.tenant_id
                 AND mst.company_id = mv.company_id
                 AND mst.sg_code = 'COMMCD'
                 AND mst.s_code = TRIM(p.hsn_code)
               LIMIT 1),
              'Unknown HSN (' || TRIM(p.hsn_code) || ')'
            )
          END`,
          needsProduct: true,
        };
      case 'product':
        return {
          // product_id (UUID) provides a stable key; fall back to the Marg pid
          // when no canonical product mapping exists.
          keyExpr: Prisma.sql`COALESCE(p.id::text, 'marg-pid:' || COALESCE(mt.pid, '__UNMAPPED__'))`,
          labelExpr: Prisma.sql`COALESCE(p.name, mprod.name, 'Unmapped product')`,
          needsProduct: true,
        };
      case 'state':
        return {
          // State = the route/state code carried on the transaction lines
          // (add_field segment 20), resolved to a friendly name via
          // marg_sale_types(sg_code='ROUT'). Identical source + lookup as the
          // overview's topStates(). The code is collapsed to ONE value per
          // voucher in the LATERAL below so a bill never splits across the
          // real state and the Unmapped bucket.
          keyExpr: Prisma.sql`COALESCE(state_dim.state_code, '__UNMAPPED__')`,
          labelExpr: Prisma.sql`COALESCE(state_dim.state_name, state_dim.state_code, 'Unknown state')`,
          needsProduct: false,
          extraJoin: Prisma.sql`
            LEFT JOIN LATERAL (
              SELECT
                sb.state_code,
                (SELECT mst.name FROM marg_sale_types mst
                  WHERE mst.tenant_id = mv.tenant_id
                    AND mst.company_id = mv.company_id
                    AND mst.sg_code = 'ROUT'
                    AND mst.s_code = sb.state_code
                  LIMIT 1) AS state_name
              FROM (
                SELECT MAX(NULLIF(TRIM(SPLIT_PART(COALESCE(mt2.add_field, ''), ';', 20)), '')) AS state_code
                FROM marg_transactions mt2
                WHERE mt2.tenant_id = mv.tenant_id
                  AND mt2.company_id = mv.company_id
                  AND mt2.voucher = mv.voucher
              ) sb
            ) state_dim ON TRUE`,
        };
      case 'city':
        return {
          // City / Area = the transaction-time area code carried on the
          // transaction lines (add_field segment 21), resolved to a name via
          // marg_sale_types(sg_code='AREA'). This is the SAME source the
          // dashboard's regional-breakdown report uses (point-in-time, booked
          // at sale; immutable — unlike the party-master area which drifts when
          // a customer is re-routed). The code is collapsed to ONE value per
          // voucher in the LATERAL so a bill never fragments. Mirrors `state`
          // exactly (segment 20 → ROUT vs segment 21 → AREA).
          keyExpr: Prisma.sql`COALESCE(city_dim.area_code, '__UNMAPPED__')`,
          labelExpr: Prisma.sql`COALESCE(city_dim.area_name, city_dim.area_code, 'Unknown city / area')`,
          needsProduct: false,
          extraJoin: Prisma.sql`
            LEFT JOIN LATERAL (
              SELECT
                sb.area_code,
                (SELECT mst.name FROM marg_sale_types mst
                  WHERE mst.tenant_id = mv.tenant_id
                    AND mst.company_id = mv.company_id
                    AND mst.sg_code = 'AREA'
                    AND mst.s_code = sb.area_code
                  LIMIT 1) AS area_name
              FROM (
                SELECT MAX(NULLIF(TRIM(SPLIT_PART(COALESCE(mt2.add_field, ''), ';', 21)), '')) AS area_code
                FROM marg_transactions mt2
                WHERE mt2.tenant_id = mv.tenant_id
                  AND mt2.company_id = mv.company_id
                  AND mt2.voucher = mv.voucher
              ) sb
            ) city_dim ON TRUE`,
        };
      case 'supplier':
        return {
          // Supplier = the party on the purchase voucher (mv.cid). mp is always
          // LEFT JOINed in both dimensionComparison and getDimensionAnalysis so
          // mp.par_name is safe to reference here without needsProduct.
          keyExpr: Prisma.sql`COALESCE(NULLIF(TRIM(mv.cid), ''), '__UNMAPPED__')`,
          labelExpr: Prisma.sql`COALESCE(NULLIF(TRIM(mp.par_name), ''), mv.cid, 'Unmapped supplier')`,
          needsProduct: false,
        };
      default:
        throw new BadRequestException(`Unsupported dimension: ${dimension}`);
    }
  }

  async getDimensionAnalysis(
    tenantId: string,
    kind: AnalysisKind,
    dimension: string,
    filters: SalesPurchaseAnalysisFilterDto,
  ) {
    const limit = Math.min(500, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    const dim = this.dimensionExpressions(dimension);

    // Dimension-aware key. We aggregate at the (bill_key, dimension_key) grain
    // first so each bill contributes once per dimension, then roll up to the
    // dimension. This yields stable "bills" counts even when a single voucher
    // crosses multiple groups (e.g., one bill with products from two companies).
    // Scope sign: invoice → +1, return → +1 (positive magnitudes), net →
    // +1 invoice / -1 return so dimension net_amount nets correctly. Applied
    // at the line level so all downstream sums inherit it.
    const dimSign = this.scopeAmountSignSql(kind, this.resolveScope(filters), 'mv');
    const cte = Prisma.sql`
      WITH lines AS (
        SELECT
          mv.company_id,
          mv.voucher,
          mv.type,
          mv.cid,
          ${dim.keyExpr} AS dim_key,
          ${dim.labelExpr} AS dim_label,
          ABS(COALESCE(mt.qty, 0)) * ${dimSign} AS qty,
          ABS(COALESCE(mt.amount, 0)) * ${dimSign} AS amount,
          ABS(COALESCE(mt.gst_amount, 0)) * ${dimSign} AS gst_amount,
          ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0) * ${dimSign} AS line_cost,
          mt.pid
        FROM marg_vouchers mv
        LEFT JOIN marg_transactions mt
          ON mt.tenant_id = mv.tenant_id
          AND mt.company_id = mv.company_id
          AND mt.voucher = mv.voucher
          AND ${this.compatibleLineTypeSql('mv', 'mt')}
        LEFT JOIN marg_products mprod
          ON mprod.tenant_id = mv.tenant_id
          AND mprod.company_id = mv.company_id
          AND mprod.pid = mt.pid
        LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mv.tenant_id
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
        ${dim.extraJoin ?? Prisma.empty}
        WHERE ${where}
      ),
      bill_grain AS (
        SELECT
          dim_key,
          MAX(dim_label) AS dim_label,
          company_id,
          voucher,
          type,
          cid,
          SUM(qty) AS qty,
          SUM(amount) AS amount,
          SUM(gst_amount) AS gst_amount,
          SUM(line_cost) AS line_cost,
          COUNT(DISTINCT pid) FILTER (WHERE pid IS NOT NULL) AS items
        FROM lines
        GROUP BY dim_key, company_id, voucher, type, cid
      ),
      rolled AS (
        SELECT
          dim_key,
          MAX(dim_label) AS dim_label,
          COUNT(DISTINCT company_id || ':' || voucher)::int AS bill_count,
          COUNT(DISTINCT cid) FILTER (WHERE cid IS NOT NULL)::int AS party_count,
          SUM(qty)::float8 AS quantity,
          SUM(amount + gst_amount)::float8 AS net_amount,
          SUM(line_cost)::float8 AS cost_amount,
          SUM(amount + gst_amount - line_cost)::float8 AS profit,
          SUM(items)::int AS item_count
        FROM bill_grain
        GROUP BY dim_key
      )
    `;

    const detailFilterConds = buildPharmaFilterSql(parsePharmaFilters(filters.filters), DIMENSION_COLUMNS);
    const detailWhere = detailFilterConds.length
      ? Prisma.sql`WHERE ${Prisma.join(detailFilterConds, ' AND ')}`
      : Prisma.empty;
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy,
      filters.sortDir,
      DIMENSION_COLUMNS,
      Prisma.sql`net_amount DESC NULLS LAST, dim_label ASC`,
    );

    const rows = await this.prisma.$queryRaw<
      Array<{
        dim_key: string;
        dim_label: string;
        bill_count: number;
        party_count: number;
        quantity: number;
        net_amount: number;
        cost_amount: number;
        profit: number;
        item_count: number;
      }>
    >(Prisma.sql`
      ${cte}
      SELECT *
      FROM rolled
      ${detailWhere}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `);

    const totalRow = await this.prisma.$queryRaw<[{ cnt: bigint; net_total: number }]>(Prisma.sql`
      ${cte}
      SELECT COUNT(*)::bigint AS cnt, COALESCE(SUM(net_amount), 0)::float8 AS net_total FROM rolled ${detailWhere}
    `);

    return {
      data: rows.map((r) => ({
        key: r.dim_key,
        label: r.dim_label,
        billCount: Number(r.bill_count ?? 0),
        partyCount: Number(r.party_count ?? 0),
        quantity: Number(r.quantity ?? 0),
        netAmount: Number(r.net_amount ?? 0),
        costAmount: Number(r.cost_amount ?? 0),
        profit: Number(r.profit ?? 0),
        marginPct:
          Number(r.net_amount ?? 0) > 0
            ? (Number(r.profit ?? 0) / Number(r.net_amount)) * 100
            : null,
        itemCount: Number(r.item_count ?? 0),
      })),
      total: Number(totalRow[0]?.cnt ?? 0),
      grandTotal: Number(totalRow[0]?.net_total ?? 0),
      dimension,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Comparison (growth / degrowth)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Compares two periods of sales/purchase activity. Returns a top-line summary
   * with growth %, plus an optional per-dimension breakdown sorted by the
   * change in net amount (largest gainers first, largest losers last).
   */
  async getComparison(
    tenantId: string,
    kind: AnalysisKind,
    filters: SalesPurchaseAnalysisFilterDto & {
      compareStartDate?: string;
      compareEndDate?: string;
      dimension?: string;
    },
  ) {
    if (!filters.startDate || !filters.endDate) {
      throw new BadRequestException('startDate and endDate are required for comparison');
    }
    if (!filters.compareStartDate || !filters.compareEndDate) {
      throw new BadRequestException('compareStartDate and compareEndDate are required for comparison');
    }
    const dimension = filters.dimension && filters.dimension !== 'none' ? filters.dimension : null;

    const summaryA = await this.summaryForRange(tenantId, kind, filters, filters.startDate, filters.endDate);
    const summaryB = await this.summaryForRange(
      tenantId,
      kind,
      filters,
      filters.compareStartDate,
      filters.compareEndDate,
    );

    let breakdown: Array<{
      key: string;
      label: string;
      currentAmount: number;
      compareAmount: number;
      delta: number;
      growthPct: number | null;
      currentBills: number;
      compareBills: number;
      currentQty: number;
      compareQty: number;
    }> = [];

    if (dimension) {
      const dim = this.dimensionExpressions(dimension);
      breakdown = await this.dimensionComparison(tenantId, kind, filters, dim);
    }

    const computeGrowth = (curr: number, comp: number) => {
      if (Math.abs(comp) < 0.005) return null;
      return ((curr - comp) / comp) * 100;
    };

    return {
      kind,
      currentRange: { startDate: filters.startDate, endDate: filters.endDate },
      compareRange: { startDate: filters.compareStartDate, endDate: filters.compareEndDate },
      summary: {
        current: summaryA,
        compare: summaryB,
        delta: {
          netAmount: summaryA.netAmount - summaryB.netAmount,
          quantity: summaryA.quantity - summaryB.quantity,
          billCount: summaryA.billCount - summaryB.billCount,
          itemCount: summaryA.itemCount - summaryB.itemCount,
          profit: summaryA.profit - summaryB.profit,
          marginPct:
            summaryA.marginPct !== null && summaryB.marginPct !== null
              ? summaryA.marginPct - summaryB.marginPct
              : null,
        },
        growthPct: {
          netAmount: computeGrowth(summaryA.netAmount, summaryB.netAmount),
          quantity: computeGrowth(summaryA.quantity, summaryB.quantity),
          billCount: computeGrowth(summaryA.billCount, summaryB.billCount),
          itemCount: computeGrowth(summaryA.itemCount, summaryB.itemCount),
          profit: computeGrowth(summaryA.profit, summaryB.profit),
        },
      },
      breakdown,
      dimension,
    };
  }

  private async summaryForRange(
    tenantId: string,
    kind: AnalysisKind,
    baseFilters: SalesPurchaseAnalysisFilterDto,
    startDate: string,
    endDate: string,
  ): Promise<{
    netAmount: number;
    quantity: number;
    billCount: number;
    itemCount: number;
    cost: number;
    profit: number;
    marginPct: number | null;
  }> {
    const filters = { ...baseFilters, startDate, endDate };
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    const cmpSign = this.scopeAmountSignSql(kind, this.resolveScope(filters), 'mv');
    const [row] = await this.prisma.$queryRaw<
      Array<{
        net_amount: number;
        quantity: number;
        bill_count: number;
        item_count: number;
        cost_amount: number;
        profit: number;
      }>
    >(Prisma.sql`
      WITH lines AS (
        SELECT
          mv.company_id,
          mv.voucher,
          ABS(COALESCE(mt.qty, 0)) * ${cmpSign} AS qty,
          ABS(COALESCE(mt.amount, 0)) * ${cmpSign} AS amount,
          ABS(COALESCE(mt.gst_amount, 0)) * ${cmpSign} AS gst_amount,
          ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0) * ${cmpSign} AS line_cost,
          mt.pid
        FROM marg_vouchers mv
        LEFT JOIN marg_transactions mt
          ON mt.tenant_id = mv.tenant_id
          AND mt.company_id = mv.company_id
          AND mt.voucher = mv.voucher
          AND ${this.compatibleLineTypeSql('mv', 'mt')}
        LEFT JOIN marg_products mprod
          ON mprod.tenant_id = mv.tenant_id
          AND mprod.company_id = mv.company_id
          AND mprod.pid = mt.pid
        LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mv.tenant_id
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
      )
      SELECT
        COALESCE(SUM(amount + gst_amount), 0)::float8 AS net_amount,
        COALESCE(SUM(qty), 0)::float8 AS quantity,
        COUNT(DISTINCT company_id || ':' || voucher)::int AS bill_count,
        COUNT(DISTINCT pid) FILTER (WHERE pid IS NOT NULL)::int AS item_count,
        COALESCE(SUM(line_cost), 0)::float8 AS cost_amount,
        COALESCE(SUM(amount + gst_amount - line_cost), 0)::float8 AS profit
      FROM lines
    `);

    const net = Number(row?.net_amount ?? 0);
    const profit = Number(row?.profit ?? 0);
    return {
      netAmount: net,
      quantity: Number(row?.quantity ?? 0),
      billCount: Number(row?.bill_count ?? 0),
      itemCount: Number(row?.item_count ?? 0),
      cost: Number(row?.cost_amount ?? 0),
      profit,
      marginPct: net > 0 ? (profit / net) * 100 : null,
    };
  }

  private async dimensionComparison(
    tenantId: string,
    kind: AnalysisKind,
    filters: SalesPurchaseAnalysisFilterDto & {
      compareStartDate?: string;
      compareEndDate?: string;
    },
    dim: { keyExpr: Prisma.Sql; labelExpr: Prisma.Sql; needsProduct: boolean; extraJoin?: Prisma.Sql },
  ): Promise<
    Array<{
      key: string;
      label: string;
      currentAmount: number;
      compareAmount: number;
      delta: number;
      growthPct: number | null;
      currentBills: number;
      compareBills: number;
      currentQty: number;
      compareQty: number;
    }>
  > {
    // For comparison we widen the date filter to the union of both ranges, then
    // bucket in SQL with a CASE so a single scan emits both period totals.
    const widenedFilters = {
      ...filters,
      startDate: undefined,
      endDate: undefined,
    };
    const baseWhere = this.buildHeaderWhere(tenantId, kind, widenedFilters, 'mv', 'mt', 'mp', 'mprod');
    const cmpDimSign = this.scopeAmountSignSql(kind, this.resolveScope(filters), 'mv');
    const dateGuard = Prisma.sql`(
      (mv.date >= ${filters.startDate}::date AND mv.date <= ${filters.endDate}::date)
      OR (mv.date >= ${filters.compareStartDate}::date AND mv.date <= ${filters.compareEndDate}::date)
    )`;

    const rows = await this.prisma.$queryRaw<
      Array<{
        dim_key: string;
        dim_label: string;
        current_amount: number;
        compare_amount: number;
        current_bills: number;
        compare_bills: number;
        current_qty: number;
        compare_qty: number;
      }>
    >(Prisma.sql`
      WITH lines AS (
        SELECT
          mv.company_id,
          mv.voucher,
          mv.date,
          ${dim.keyExpr} AS dim_key,
          ${dim.labelExpr} AS dim_label,
          ABS(COALESCE(mt.qty, 0)) * ${cmpDimSign} AS qty,
          (ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0))) * ${cmpDimSign} AS net_line
        FROM marg_vouchers mv
        LEFT JOIN marg_transactions mt
          ON mt.tenant_id = mv.tenant_id
          AND mt.company_id = mv.company_id
          AND mt.voucher = mv.voucher
          AND ${this.compatibleLineTypeSql('mv', 'mt')}
        LEFT JOIN marg_products mprod
          ON mprod.tenant_id = mv.tenant_id
          AND mprod.company_id = mv.company_id
          AND mprod.pid = mt.pid
        LEFT JOIN products p ON p.id = mprod.product_id AND p.tenant_id = mv.tenant_id
        LEFT JOIN marg_parties mp
          ON mp.tenant_id = mv.tenant_id
          AND mp.company_id = mv.company_id
          AND mp.cid = mv.cid
        ${dim.extraJoin ?? Prisma.empty}
        WHERE ${baseWhere} AND ${dateGuard}
      ),
      buckets AS (
        SELECT
          dim_key,
          MAX(dim_label) AS dim_label,
          company_id,
          voucher,
          CASE
            WHEN MAX(date) >= ${filters.startDate}::date AND MAX(date) <= ${filters.endDate}::date THEN 'A'
            WHEN MAX(date) >= ${filters.compareStartDate}::date AND MAX(date) <= ${filters.compareEndDate}::date THEN 'B'
            ELSE NULL
          END AS bucket,
          SUM(qty) AS qty,
          SUM(net_line) AS amount
        FROM lines
        GROUP BY dim_key, company_id, voucher
      )
      SELECT
        dim_key,
        MAX(dim_label) AS dim_label,
        COALESCE(SUM(amount) FILTER (WHERE bucket = 'A'), 0)::float8 AS current_amount,
        COALESCE(SUM(amount) FILTER (WHERE bucket = 'B'), 0)::float8 AS compare_amount,
        COUNT(DISTINCT company_id || ':' || voucher) FILTER (WHERE bucket = 'A')::int AS current_bills,
        COUNT(DISTINCT company_id || ':' || voucher) FILTER (WHERE bucket = 'B')::int AS compare_bills,
        COALESCE(SUM(qty) FILTER (WHERE bucket = 'A'), 0)::float8 AS current_qty,
        COALESCE(SUM(qty) FILTER (WHERE bucket = 'B'), 0)::float8 AS compare_qty
      FROM buckets
      WHERE bucket IS NOT NULL
      GROUP BY dim_key
      ORDER BY (COALESCE(SUM(amount) FILTER (WHERE bucket = 'A'), 0) - COALESCE(SUM(amount) FILTER (WHERE bucket = 'B'), 0)) DESC
      LIMIT 200
    `);

    return rows.map((r) => {
      const current = Number(r.current_amount ?? 0);
      const compare = Number(r.compare_amount ?? 0);
      const delta = current - compare;
      const growthPct = Math.abs(compare) > 0.005 ? (delta / compare) * 100 : null;
      return {
        key: r.dim_key,
        label: r.dim_label,
        currentAmount: current,
        compareAmount: compare,
        delta,
        growthPct,
        currentBills: Number(r.current_bills ?? 0),
        compareBills: Number(r.compare_bills ?? 0),
        currentQty: Number(r.current_qty ?? 0),
        compareQty: Number(r.compare_qty ?? 0),
      };
    });
  }
}
