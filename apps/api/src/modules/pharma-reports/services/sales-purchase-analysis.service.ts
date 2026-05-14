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

type AnalysisKind = 'sales' | 'purchase';

const SALES_TYPES = ['S'];
const PURCHASE_TYPES = ['P'];
const SALES_RETURN_TYPES = ['R', 'T'];
const PURCHASE_RETURN_TYPES = ['B'];
const SALES_LINE_TYPES = ['G', 'S', 'O', 'R', 'X'];
const PURCHASE_LINE_TYPES = ['P', 'B'];

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
    const documentTypes = this.documentTypes(kind);
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    const returnTypes = kind === 'sales' ? SALES_RETURN_TYPES : PURCHASE_RETURN_TYPES;

    const [summary] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
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
          SUM(ABS(COALESCE(qty, 0)))::float8 AS quantity,
          COUNT(DISTINCT pid) FILTER (WHERE pid IS NOT NULL)::int AS item_count,
          COALESCE(SUM(ABS(COALESCE(qty, 0)) * COALESCE(rate, 0)), 0)::float8 AS gross_amount,
          COALESCE(SUM(GREATEST(ABS(COALESCE(qty, 0)) * COALESCE(rate, 0) - ABS(COALESCE(amount, 0)), 0)), 0)::float8 AS discount,
          COALESCE(SUM(ABS(COALESCE(gst_amount, 0))), 0)::float8 AS tax_amount,
          COALESCE(SUM(ABS(COALESCE(qty, 0)) * COALESCE(p_rate, lp_rate, 0)), 0)::float8 AS cost_amount
        FROM filtered_lines
        GROUP BY company_id, voucher, type
      )
      SELECT
        COALESCE(SUM(COALESCE(final_amt, gross_amount)), 0)::float8 AS total_amount,
        COUNT(*)::int AS total_bills,
        COUNT(DISTINCT cid)::int AS total_parties,
        COALESCE(SUM(quantity), 0)::float8 AS total_quantity,
        COUNT(DISTINCT company_id || ':' || COALESCE(NULLIF(voucher, ''), vcn, ''))::int AS voucher_count,
        COALESCE(SUM(item_count), 0)::int AS item_count,
        COALESCE(SUM(cost_amount), 0)::float8 AS cost_amount,
        COALESCE(SUM(COALESCE(final_amt, gross_amount) - cost_amount), 0)::float8 AS gross_profit,
        CASE WHEN COALESCE(SUM(COALESCE(final_amt, gross_amount)), 0) > 0
          THEN (COALESCE(SUM(COALESCE(final_amt, gross_amount) - cost_amount), 0) / COALESCE(SUM(COALESCE(final_amt, gross_amount)), 0) * 100)::float8
          ELSE NULL
        END AS margin_pct,
        COALESCE(SUM(COALESCE(final_amt, gross_amount)) FILTER (WHERE type = ANY(${returnTypes}::text[])), 0)::float8 AS return_amount
      FROM bill_rollup
    `);

    const [trend, topParties, topItems, taxSummary, paymentModeSummary] = await Promise.all([
      this.trend(tenantId, kind, filters),
      this.topParties(tenantId, kind, filters),
      this.topItems(tenantId, kind, filters),
      this.taxSummary(tenantId, kind, filters),
      this.paymentSummary(tenantId, kind, filters),
    ]);

    const totalAmount = Number(summary?.total_amount ?? 0);
    const totalBills = Number(summary?.total_bills ?? 0);
    const totalQuantity = Number(summary?.total_quantity ?? 0);

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
        returnImpact: Number(summary?.return_amount ?? 0),
      },
      trend,
      topParties,
      topItems,
      taxSummary,
      paymentModeSummary,
    };
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
      WITH b AS (${this.billRollupSql(tenantId, kind, baseWhere)})
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
    const scopedFilters = { ...filters, item: undefined, productIds: undefined };
    const where = this.buildHeaderWhere(tenantId, kind, scopedFilters, 'mv', 'mt', 'mp', 'mprod');
    const allTypeConds: Prisma.Sql[] = [
      Prisma.sql`mv.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`mv.type IN ('S', 'P', 'R', 'T', 'B')`,
    ];
    if (scopedFilters.startDate) allTypeConds.push(Prisma.sql`mv.date >= ${scopedFilters.startDate}::date`);
    if (scopedFilters.endDate) allTypeConds.push(Prisma.sql`mv.date <= ${scopedFilters.endDate}::date`);
    if (scopedFilters.companyId !== undefined && scopedFilters.companyId !== null) allTypeConds.push(Prisma.sql`mv.company_id = ${Number(scopedFilters.companyId)}`);
    const allTypesWhere = Prisma.sql`${Prisma.join(allTypeConds, ' AND ')}`;

    const [metrics] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(ABS(mt.qty)) FILTER (WHERE mv.type IN ('S', 'R', 'T')), 0)::float8 AS sales_quantity,
        COALESCE(SUM(ABS(mt.qty)) FILTER (WHERE mv.type IN ('P', 'B')), 0)::float8 AS purchase_quantity,
        COALESCE(SUM(ABS(mt.amount)) FILTER (WHERE mv.type IN ('S', 'R', 'T')), 0)::float8 AS sales_amount,
        COALESCE(SUM(ABS(mt.amount)) FILTER (WHERE mv.type IN ('P', 'B')), 0)::float8 AS purchase_amount,
        AVG(mt.rate) FILTER (WHERE mv.type IN ('S', 'R', 'T') AND mt.rate IS NOT NULL AND mt.rate > 0)::float8 AS average_sale_rate,
        AVG(mt.rate) FILTER (WHERE mv.type IN ('P', 'B') AND mt.rate IS NOT NULL AND mt.rate > 0)::float8 AS average_purchase_rate,
        COALESCE(SUM(ABS(mt.qty)) FILTER (WHERE mv.type IN ('R', 'T')), 0)::float8 AS sales_return_quantity,
        COALESCE(SUM(ABS(mt.qty)) FILTER (WHERE mv.type = 'B'), 0)::float8 AS purchase_return_quantity,
        AVG(COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0))::float8 AS cost_rate
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
    const where = this.buildHeaderWhere(tenantId, kind, scopedFilters, 'mv', 'mt', 'mp', 'mprod');

    const [metrics] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where)})
      SELECT
        COALESCE(SUM(net_amount), 0)::float8 AS total_amount,
        COUNT(*)::int AS total_bills,
        CASE WHEN COUNT(*) > 0 THEN (COALESCE(SUM(net_amount), 0) / COUNT(*))::float8 ELSE 0 END AS average_bill_value
      FROM bills
    `);
    const topItems = await this.topItems(tenantId, kind, scopedFilters);
    const billHistory = await this.getBills(tenantId, kind, { ...scopedFilters, limit: 25, offset: 0, sortBy: 'date', sortDir: 'desc' });

    return {
      metrics,
      outstanding: null,
      topItems,
      billHistory: billHistory.data,
    };
  }

  private async trend(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where)})
      SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS period,
        COUNT(*)::int AS bills,
        COALESCE(SUM(net_amount), 0)::float8 AS amount,
        COALESCE(SUM(quantity), 0)::float8 AS quantity
      FROM bills
      GROUP BY date_trunc('month', date)
      ORDER BY date_trunc('month', date)
    `);
  }

  private async topParties(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where)}),
      ranked AS (
        SELECT party_code, party_name, COUNT(*)::int AS bills, COALESCE(SUM(net_amount), 0)::float8 AS value
        FROM bills GROUP BY party_code, party_name
      )
      SELECT ROW_NUMBER() OVER (ORDER BY value DESC)::int AS rank, party_code, party_name AS name, bills, value,
        CASE WHEN SUM(value) OVER () > 0 THEN (value / SUM(value) OVER () * 100)::float8 ELSE 0 END AS share
      FROM ranked
      ORDER BY value DESC
      LIMIT 10
    `);
  }

  private async topItems(tenantId: string, kind: AnalysisKind, filters: SalesPurchaseAnalysisFilterDto) {
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT ROW_NUMBER() OVER (ORDER BY SUM(ABS(COALESCE(mt.amount, 0))) DESC)::int AS rank,
        COALESCE(p.id::text, mprod.product_id::text, mt.pid) AS item_key,
        COALESCE(p.code, mprod.code, mt.pid) AS item_code,
        COALESCE(p.name, mprod.name, 'Unmapped Item') AS item_name,
        COALESCE(SUM(ABS(mt.qty)), 0)::float8 AS quantity,
        COALESCE(SUM(ABS(mt.amount)), 0)::float8 AS value
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
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(mt.gst, 0)::float8 AS tax_pct,
        COALESCE(SUM(ABS(mt.gst_amount)), 0)::float8 AS tax_amount,
        COALESCE(SUM(ABS(mt.amount)), 0)::float8 AS taxable_amount
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
    const where = this.buildHeaderWhere(tenantId, kind, filters, 'mv', 'mt', 'mp', 'mprod');
    return this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH bills AS (${this.billRollupSql(tenantId, kind, where)})
      SELECT payment_mode, COUNT(*)::int AS bills, COALESCE(SUM(net_amount), 0)::float8 AS amount
      FROM bills
      GROUP BY payment_mode
      ORDER BY amount DESC
    `);
  }

  private billRollupSql(_tenantId: string, _kind: AnalysisKind, where: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
      SELECT
        mv.company_id || ':' || mv.voucher AS bill_key,
        mv.company_id,
        mv.voucher,
        mv.type,
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
        CASE WHEN mv.type IN ('R', 'T', 'B') THEN 'RETURN' ELSE 'POSTED' END AS status
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
      GROUP BY mv.company_id, mv.voucher, mv.type, mv.vcn, mv.date, mv.cid, mp.par_name, mb.name, mb.branch, mb.location_id, mv.salesman, mv.mr, sm.name, smp.par_name, mv.cash, mv.others
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
    const types = this.documentTypes(kind);
    const conds: Prisma.Sql[] = [
      Prisma.sql`${mv}.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`${mv}.type = ANY(${types}::text[])`,
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
    if (filters.status) {
      if (filters.status === 'RETURN') conds.push(Prisma.sql`${mv}.type IN ('R', 'T', 'B')`);
      if (filters.status === 'POSTED') conds.push(Prisma.sql`${mv}.type NOT IN ('R', 'T', 'B')`);
    }
    if (filters.minAmount !== undefined) conds.push(Prisma.sql`COALESCE(${mv}.final_amt, 0) >= ${filters.minAmount}`);
    if (filters.maxAmount !== undefined) conds.push(Prisma.sql`COALESCE(${mv}.final_amt, 0) <= ${filters.maxAmount}`);
    if (filters.minQuantity !== undefined) conds.push(Prisma.sql`ABS(COALESCE(${mt}.qty, 0)) >= ${filters.minQuantity}`);
    if (filters.maxQuantity !== undefined) conds.push(Prisma.sql`ABS(COALESCE(${mt}.qty, 0)) <= ${filters.maxQuantity}`);

    return Prisma.sql`${Prisma.join(conds, ' AND ')}`;
  }

  private documentTypes(kind: AnalysisKind): string[] {
    if (kind === 'sales') return [...SALES_TYPES, ...SALES_RETURN_TYPES];
    if (kind === 'purchase') return [...PURCHASE_TYPES, ...PURCHASE_RETURN_TYPES];
    throw new BadRequestException('Invalid analysis kind');
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
      default:
        return [...SALES_LINE_TYPES, ...PURCHASE_LINE_TYPES];
    }
  }

  private compatibleLineTypeSql(voucherAlias: string, transactionAlias: string): Prisma.Sql {
    const mv = Prisma.raw(voucherAlias);
    const mt = Prisma.raw(transactionAlias);
    return Prisma.sql`(
      (${mv}.type = 'S' AND ${mt}.type IN ('G', 'S', 'O'))
      OR (${mv}.type = 'R' AND ${mt}.type = 'R')
      OR (${mv}.type = 'T' AND ${mt}.type IN ('X', 'T'))
      OR (${mv}.type = 'P' AND ${mt}.type = 'P')
      OR (${mv}.type = 'B' AND ${mt}.type = 'B')
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
  } {
    switch (dimension) {
      case 'salesman':
        return {
          keyExpr: Prisma.sql`COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), ''), '__UNATTRIBUTED__')`,
          labelExpr: Prisma.sql`CASE
            WHEN COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) IS NULL THEN 'Unattributed'
            ELSE COALESCE(NULLIF(TRIM(mv.salesman), ''), NULLIF(TRIM(mv.mr), '')) || ' - ' || COALESCE((
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
            ELSE TRIM(p.salt) || ' - ' || COALESCE((SELECT ps.name FROM product_salts ps WHERE ps.tenant_id = p.tenant_id AND ps.code = TRIM(p.salt) LIMIT 1), 'Unknown salt (' || TRIM(p.salt) || ')')
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
            ELSE TRIM(p.product_group) || ' - ' || COALESCE((SELECT pg.name FROM product_categories pg WHERE pg.tenant_id = p.tenant_id AND pg.code = TRIM(p.product_group) LIMIT 1), 'Unknown group (' || TRIM(p.product_group) || ')')
          END`,
          needsProduct: true,
        };
      case 'hsnCode':
        return {
          keyExpr: Prisma.sql`COALESCE(NULLIF(TRIM(p.hsn_code), ''), '__UNMAPPED__')`,
          labelExpr: Prisma.sql`COALESCE(NULLIF(TRIM(p.hsn_code), ''), 'Unmapped HSN')`,
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
    const cte = Prisma.sql`
      WITH lines AS (
        SELECT
          mv.company_id,
          mv.voucher,
          mv.type,
          mv.cid,
          ${dim.keyExpr} AS dim_key,
          ${dim.labelExpr} AS dim_label,
          ABS(COALESCE(mt.qty, 0)) AS qty,
          ABS(COALESCE(mt.amount, 0)) AS amount,
          ABS(COALESCE(mt.gst_amount, 0)) AS gst_amount,
          ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0) AS line_cost,
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
          ABS(COALESCE(mt.qty, 0)) AS qty,
          ABS(COALESCE(mt.amount, 0)) AS amount,
          ABS(COALESCE(mt.gst_amount, 0)) AS gst_amount,
          ABS(COALESCE(mt.qty, 0)) * COALESCE(ms.p_rate, ms.lp_rate, p.standard_cost, 0) AS line_cost,
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
    dim: { keyExpr: Prisma.Sql; labelExpr: Prisma.Sql; needsProduct: boolean },
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
          ABS(COALESCE(mt.qty, 0)) AS qty,
          ABS(COALESCE(mt.amount, 0)) + ABS(COALESCE(mt.gst_amount, 0)) AS net_line
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
