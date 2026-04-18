// ============================================================================
// STREAMING REPORT EXPORT SERVICE
// Handles CSV and XLSX export for pharma reports (1-2GB capable)
// Uses streaming to avoid memory pressure on large datasets
// ============================================================================

import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PassThrough, Readable } from 'stream';
import { PrismaService } from '../../../core/database/prisma.service';

export type ExportFormat = 'csv' | 'xlsx';

export interface ExportColumn {
  key: string;
  header: string;
  width?: number;
}

interface ExportRequest {
  tenantId: string;
  reportType: string;
  format: ExportFormat;
  filters: Record<string, unknown>;
}

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Main export entry point — dispatches to the correct report query
  // and streams CSV or XLSX back
  // ─────────────────────────────────────────────────────────────────────────
  async exportReport(req: ExportRequest): Promise<{
    stream: StreamableFile;
    contentType: string;
    filename: string;
  }> {
    const { tenantId, reportType, format, filters } = req;
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${reportType}_${timestamp}.${format}`;

    const { columns, query } = this.getReportQuery(tenantId, reportType, filters);

    if (format === 'csv') {
      const stream = await this.streamCsv(query, columns);
      return {
        stream: new StreamableFile(stream),
        contentType: 'text/csv; charset=utf-8',
        filename,
      };
    }

    const stream = await this.streamXlsx(query, columns, reportType);
    return {
      stream: new StreamableFile(stream),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CSV streaming — writes BOM + header + rows in chunks
  // ─────────────────────────────────────────────────────────────────────────
  private async streamCsv(
    query: Prisma.Sql,
    columns: ExportColumn[],
  ): Promise<Readable> {
    const pass = new PassThrough();

    // UTF-8 BOM for Excel compatibility
    pass.write('\uFEFF');
    pass.write(columns.map((c) => this.escapeCsv(c.header)).join(',') + '\n');

    // Stream in batches to avoid memory pressure
    const BATCH_SIZE = 5000;
    let offset = 0;
    let hasMore = true;

    (async () => {
      try {
        while (hasMore) {
          const batchQuery = Prisma.sql`${query} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
          const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(batchQuery);

          for (const row of rows) {
            const line = columns
              .map((col) => this.escapeCsv(this.formatValue(row[col.key])))
              .join(',');
            pass.write(line + '\n');
          }

          offset += BATCH_SIZE;
          hasMore = rows.length === BATCH_SIZE;
        }
        pass.end();
      } catch (err) {
        this.logger.error('CSV export error', err);
        pass.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return pass;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // XLSX streaming — uses ExcelJS streaming workbook writer
  // ─────────────────────────────────────────────────────────────────────────
  private async streamXlsx(
    query: Prisma.Sql,
    columns: ExportColumn[],
    sheetName: string,
  ): Promise<Readable> {
    const pass = new PassThrough();

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: pass,
      useStyles: true,
    });

    const sheet = workbook.addWorksheet(
      sheetName.replace(/[^a-zA-Z0-9_ -]/g, '').slice(0, 31) || 'Report',
    );

    // Set columns
    sheet.columns = columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width ?? 18,
    }));

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' },
    };
    headerRow.commit();

    // Stream data in batches
    const BATCH_SIZE = 5000;
    let offset = 0;
    let hasMore = true;

    (async () => {
      try {
        while (hasMore) {
          const batchQuery = Prisma.sql`${query} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
          const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(batchQuery);

          for (const row of rows) {
            const rowData: Record<string, unknown> = {};
            for (const col of columns) {
              rowData[col.key] = this.formatValue(row[col.key]);
            }
            sheet.addRow(rowData).commit();
          }

          offset += BATCH_SIZE;
          hasMore = rows.length === BATCH_SIZE;
        }

        sheet.commit();
        await workbook.commit();
      } catch (err) {
        this.logger.error('XLSX export error', err);
        pass.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return pass;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Report query dispatcher — returns columns + parameterized SQL
  // All queries are WITHOUT LIMIT/OFFSET (export streams everything)
  // ─────────────────────────────────────────────────────────────────────────
  private getReportQuery(
    tenantId: string,
    reportType: string,
    filters: Record<string, unknown>,
  ): { columns: ExportColumn[]; query: Prisma.Sql } {
    switch (reportType) {
      case 'current-stock':
        return this.currentStockExportQuery(tenantId, filters);
      case 'batch-inventory':
        return this.batchInventoryExportQuery(tenantId, filters);
      case 'near-expiry':
        return this.nearExpiryExportQuery(tenantId, filters);
      case 'expired-stock':
        return this.expiredStockExportQuery(tenantId, filters);
      case 'dead-slow':
        return this.deadSlowExportQuery(tenantId, filters);
      case 'reorder':
        return this.reorderExportQuery(tenantId, filters);
      case 'suggested-purchase':
        return this.suggestedPurchaseExportQuery(tenantId, filters);
      case 'supplier-performance':
        return this.supplierPerformanceExportQuery(tenantId, filters);
      case 'abc-analysis':
        return this.abcAnalysisExportQuery(tenantId, filters);
      case 'inventory-turnover':
        return this.turnoverExportQuery(tenantId, filters);
      default:
        throw new Error(`Unknown export report type: ${reportType}`);
    }
  }

  // ── CURRENT STOCK ───────────────────────────────────────────────────────
  private currentStockExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const extraConds = this.buildProductLocationConds(filters);
    const where = this.buildWhere(
      Prisma.sql`il.tenant_id = ${tenantId}::uuid`,
      extraConds,
    );

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'on_hand_qty', header: 'On Hand', width: 12 },
        { key: 'available_qty', header: 'Available', width: 12 },
        { key: 'allocated_qty', header: 'Allocated', width: 12 },
        { key: 'reserved_qty', header: 'Reserved', width: 12 },
        { key: 'in_transit_qty', header: 'In Transit', width: 12 },
        { key: 'on_order_qty', header: 'On Order', width: 12 },
        { key: 'unit_cost', header: 'Unit Cost', width: 12 },
        { key: 'inventory_value', header: 'Value', width: 14 },
      ],
      query: Prisma.sql`
        SELECT
          p.code AS sku,
          p.name AS product_name,
          l.code AS location_code,
          COALESCE(il.on_hand_qty, 0)::float8 AS on_hand_qty,
          COALESCE(il.available_qty, 0)::float8 AS available_qty,
          COALESCE(il.allocated_qty, 0)::float8 AS allocated_qty,
          COALESCE(il.reserved_qty, 0)::float8 AS reserved_qty,
          COALESCE(il.in_transit_qty, 0)::float8 AS in_transit_qty,
          COALESCE(il.on_order_qty, 0)::float8 AS on_order_qty,
          COALESCE(il.average_cost, il.standard_cost, 0)::float8 AS unit_cost,
          COALESCE(il.inventory_value, 0)::float8 AS inventory_value
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        WHERE ${where}
        ORDER BY p.code, l.code
      `,
    };
  }

  // ── BATCH INVENTORY ─────────────────────────────────────────────────────
  private batchInventoryExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const extraConds = this.buildProductLocationConds(filters);
    const where = this.buildWhere(
      Prisma.sql`b.tenant_id = ${tenantId}::uuid AND b.quantity > 0 AND b.status NOT IN ('CONSUMED','RECALLED')`,
      extraConds,
      'b',
    );

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'batch_number', header: 'Batch', width: 18 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'quantity', header: 'Qty', width: 10 },
        { key: 'available_qty', header: 'Available', width: 10 },
        { key: 'cost_per_unit', header: 'Unit Cost', width: 12 },
        { key: 'batch_value', header: 'Value', width: 14 },
        { key: 'manufacturing_date', header: 'Mfg Date', width: 12 },
        { key: 'expiry_date', header: 'Expiry Date', width: 12 },
        { key: 'days_to_expiry', header: 'Days to Expiry', width: 14 },
        { key: 'batch_status', header: 'Status', width: 12 },
      ],
      query: Prisma.sql`
        SELECT
          p.code AS sku,
          p.name AS product_name,
          b.batch_number,
          l.code AS location_code,
          b.quantity::float8,
          COALESCE(b.available_qty,0)::float8 AS available_qty,
          COALESCE(b.cost_per_unit,0)::float8 AS cost_per_unit,
          (COALESCE(b.quantity,0)*COALESCE(b.cost_per_unit,0))::float8 AS batch_value,
          b.manufacturing_date,
          b.expiry_date,
          CASE WHEN b.expiry_date IS NOT NULL THEN (b.expiry_date::date - CURRENT_DATE) ELSE NULL END AS days_to_expiry,
          b.status::text AS batch_status
        FROM batches b
        JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
        JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
        WHERE ${where}
        ORDER BY p.code, b.expiry_date ASC NULLS LAST
      `,
    };
  }

  // ── NEAR EXPIRY ─────────────────────────────────────────────────────────
  private nearExpiryExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const thresholdDays = Number(filters.thresholdDays) || 90;
    const extraConds = this.buildProductLocationConds(filters);
    const where = this.buildWhere(
      Prisma.sql`b.tenant_id = ${tenantId}::uuid AND b.expiry_date IS NOT NULL AND b.expiry_date::date >= CURRENT_DATE AND b.expiry_date::date <= (CURRENT_DATE + ${thresholdDays}::int) AND b.quantity > 0 AND b.status NOT IN ('CONSUMED','RECALLED')`,
      extraConds,
      'b',
    );

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'batch_number', header: 'Batch', width: 18 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'expiry_date', header: 'Expiry Date', width: 12 },
        { key: 'remaining_days', header: 'Days Left', width: 10 },
        { key: 'quantity', header: 'Qty', width: 10 },
        { key: 'at_risk_value', header: 'Value at Risk', width: 14 },
        { key: 'urgency', header: 'Urgency', width: 12 },
      ],
      query: Prisma.sql`
        SELECT
          p.code AS sku, p.name AS product_name, b.batch_number, l.code AS location_code,
          b.expiry_date, (b.expiry_date::date - CURRENT_DATE) AS remaining_days,
          b.quantity::float8, (b.quantity * COALESCE(b.cost_per_unit,0))::float8 AS at_risk_value,
          CASE WHEN (b.expiry_date::date - CURRENT_DATE) <= 30 THEN 'CRITICAL'
               WHEN (b.expiry_date::date - CURRENT_DATE) <= 90 THEN 'HIGH'
               WHEN (b.expiry_date::date - CURRENT_DATE) <= 180 THEN 'MEDIUM'
               ELSE 'LOW' END AS urgency
        FROM batches b
        JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
        JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
        WHERE ${where}
        ORDER BY remaining_days ASC
      `,
    };
  }

  // ── EXPIRED STOCK ───────────────────────────────────────────────────────
  private expiredStockExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const extraConds = this.buildProductLocationConds(filters);
    const where = this.buildWhere(
      Prisma.sql`b.tenant_id = ${tenantId}::uuid AND b.expiry_date IS NOT NULL AND b.expiry_date::date < CURRENT_DATE AND b.quantity > 0 AND b.status NOT IN ('CONSUMED','RECALLED')`,
      extraConds,
      'b',
    );

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'batch_number', header: 'Batch', width: 18 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'expiry_date', header: 'Expiry Date', width: 12 },
        { key: 'days_expired', header: 'Days Expired', width: 12 },
        { key: 'quantity', header: 'Qty', width: 10 },
        { key: 'expired_value', header: 'Expired Value', width: 14 },
        { key: 'batch_status', header: 'Status', width: 12 },
      ],
      query: Prisma.sql`
        SELECT
          p.code AS sku, p.name AS product_name, b.batch_number, l.code AS location_code,
          b.expiry_date, (CURRENT_DATE - b.expiry_date::date) AS days_expired,
          b.quantity::float8, (b.quantity * COALESCE(b.cost_per_unit,0))::float8 AS expired_value,
          b.status::text AS batch_status
        FROM batches b
        JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
        JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
        WHERE ${where}
        ORDER BY days_expired DESC
      `,
    };
  }

  // ── DEAD/SLOW STOCK ─────────────────────────────────────────────────────
  private deadSlowExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const deadDays = (Number(filters.deadMonths) || 6) * 30;
    const extraConds = this.buildProductLocationConds(filters, 'il');
    const where = this.buildWhere(
      Prisma.sql`il.tenant_id = ${tenantId}::uuid AND il.on_hand_qty > 0`,
      extraConds,
      'il',
    );

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'category', header: 'Category', width: 15 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'on_hand_qty', header: 'On Hand', width: 10 },
        { key: 'inventory_value', header: 'Value', width: 14 },
        { key: 'last_sale_date', header: 'Last Sale', width: 12 },
        { key: 'days_since_last_sale', header: 'Days Since Sale', width: 14 },
        { key: 'classification', header: 'Classification', width: 14 },
      ],
      query: Prisma.sql`
        WITH last_sales AS (
          SELECT it.product_id, it.location_id,
            MAX(it.transaction_date) AS last_sale_date,
            SUM(it.quantity)::float8 AS total_issued,
            COUNT(DISTINCT DATE_TRUNC('month', it.transaction_date))::int AS active_months
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid AND it.transaction_type IN ('ISSUE','PRODUCTION_ISSUE')
          GROUP BY it.product_id, it.location_id
        )
        SELECT p.code AS sku, p.name AS product_name, p.category, l.code AS location_code,
          COALESCE(il.on_hand_qty,0)::float8 AS on_hand_qty,
          COALESCE(il.inventory_value,0)::float8 AS inventory_value,
          ls.last_sale_date,
          CASE WHEN ls.last_sale_date IS NOT NULL THEN (CURRENT_DATE - ls.last_sale_date::date) ELSE NULL END AS days_since_last_sale,
          CASE WHEN ls.last_sale_date IS NULL THEN 'DEAD'
               WHEN (CURRENT_DATE - ls.last_sale_date::date) > ${deadDays} THEN 'DEAD'
               WHEN ls.active_months > 0 AND (ls.total_issued / ls.active_months) < 1 THEN 'SLOW'
               ELSE 'DEAD' END AS classification
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN last_sales ls ON ls.product_id = il.product_id AND ls.location_id = il.location_id
        WHERE ${where}
          AND (ls.last_sale_date IS NULL OR (CURRENT_DATE - ls.last_sale_date::date) > ${deadDays}
               OR (ls.active_months > 0 AND (ls.total_issued / ls.active_months) < 1))
        ORDER BY inventory_value DESC
      `,
    };
  }

  // ── REORDER ─────────────────────────────────────────────────────────────
  private reorderExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const avgDays = Number(filters.avgSalesDays) || 30;
    const extraConds = this.buildProductLocationConds(filters, 'il');
    const where = this.buildWhere(
      Prisma.sql`il.tenant_id = ${tenantId}::uuid`,
      extraConds,
      'il',
    );

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'on_hand_qty', header: 'On Hand', width: 10 },
        { key: 'reorder_point', header: 'Reorder Pt', width: 12 },
        { key: 'safety_stock_qty', header: 'Safety Stock', width: 12 },
        { key: 'avg_daily_sales', header: 'Avg Daily Sales', width: 14 },
        { key: 'suggested_order_qty', header: 'Suggested Qty', width: 14 },
        { key: 'abc_class', header: 'ABC Class', width: 10 },
        { key: 'days_of_stock', header: 'Days of Stock', width: 12 },
      ],
      query: Prisma.sql`
        WITH daily_sales AS (
          SELECT it.product_id, it.location_id,
            COALESCE(SUM(it.quantity),0)::float8 AS total_issued
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE','PRODUCTION_ISSUE')
            AND it.transaction_date >= (CURRENT_DATE - ${avgDays}::int)
          GROUP BY it.product_id, it.location_id
        )
        SELECT p.code AS sku, p.name AS product_name, l.code AS location_code,
          COALESCE(il.on_hand_qty,0)::float8 AS on_hand_qty,
          COALESCE(ip.reorder_point,0)::float8 AS reorder_point,
          COALESCE(ip.safety_stock_qty,0)::float8 AS safety_stock_qty,
          CASE WHEN ${avgDays}::int > 0 THEN COALESCE(ds.total_issued,0)::float8 / ${avgDays}::float8 ELSE 0 END AS avg_daily_sales,
          GREATEST((COALESCE(ds.total_issued,0)::float8 / NULLIF(${avgDays}::float8,0)) * COALESCE(ip.lead_time_days,7)::float8 + COALESCE(ip.safety_stock_qty,0)::float8 - COALESCE(il.on_hand_qty,0)::float8, 0)::float8 AS suggested_order_qty,
          ip.abc_class,
          CASE WHEN COALESCE(ds.total_issued,0) > 0 THEN (COALESCE(il.on_hand_qty,0)::float8 / (COALESCE(ds.total_issued,0)::float8 / ${avgDays}::float8)) ELSE NULL END AS days_of_stock
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN inventory_policies ip ON ip.tenant_id = il.tenant_id AND ip.product_id = il.product_id AND ip.location_id = il.location_id
        LEFT JOIN daily_sales ds ON ds.product_id = il.product_id AND ds.location_id = il.location_id
        WHERE ${where}
          AND (COALESCE(il.on_hand_qty,0) <= COALESCE(ip.reorder_point,0)
               OR COALESCE(il.on_hand_qty,0) <= COALESCE(ip.safety_stock_qty,0)
               OR ip.id IS NULL)
        ORDER BY suggested_order_qty DESC
      `,
    };
  }

  // ── SUGGESTED PURCHASE ──────────────────────────────────────────────────
  private suggestedPurchaseExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const extraConds = this.buildProductLocationConds(filters, 'il');
    const where = this.buildWhere(
      Prisma.sql`il.tenant_id = ${tenantId}::uuid`,
      extraConds,
      'il',
    );

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'current_stock', header: 'Current Stock', width: 12 },
        { key: 'on_order_qty', header: 'On Order', width: 10 },
        { key: 'avg_daily_demand', header: 'Avg Daily Demand', width: 14 },
        { key: 'lead_time_days', header: 'Lead Time', width: 10 },
        { key: 'safety_stock', header: 'Safety Stock', width: 12 },
        { key: 'suggested_purchase_qty', header: 'Suggested Qty', width: 14 },
        { key: 'estimated_cost', header: 'Est. Cost', width: 14 },
        { key: 'preferred_supplier', header: 'Supplier', width: 20 },
      ],
      query: Prisma.sql`
        WITH demand_90d AS (
          SELECT it.product_id, it.location_id,
            (SUM(it.quantity)::float8 / 90.0) AS avg_daily_demand
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE','PRODUCTION_ISSUE')
            AND it.transaction_date >= (CURRENT_DATE - 90)
          GROUP BY it.product_id, it.location_id
        ),
        preferred_supplier AS (
          SELECT DISTINCT ON (pol.product_id) pol.product_id, s.name AS supplier_name
          FROM purchase_order_lines pol
          JOIN purchase_orders po ON po.id = pol.purchase_order_id
          JOIN suppliers s ON s.id = po.supplier_id
          WHERE po.tenant_id = ${tenantId}::uuid AND po.status NOT IN ('CANCELLED','DRAFT')
          ORDER BY pol.product_id, po.order_date DESC
        )
        SELECT p.code AS sku, p.name AS product_name, l.code AS location_code,
          COALESCE(il.on_hand_qty,0)::float8 AS current_stock,
          COALESCE(il.on_order_qty,0)::float8 AS on_order_qty,
          COALESCE(d.avg_daily_demand,0)::float8 AS avg_daily_demand,
          COALESCE(ip.lead_time_days,7)::int AS lead_time_days,
          COALESCE(ip.safety_stock_qty,0)::float8 AS safety_stock,
          GREATEST((COALESCE(d.avg_daily_demand,0) * COALESCE(ip.lead_time_days,7)) + COALESCE(ip.safety_stock_qty,0) - COALESCE(il.on_hand_qty,0) - COALESCE(il.on_order_qty,0), 0)::float8 AS suggested_purchase_qty,
          (GREATEST((COALESCE(d.avg_daily_demand,0) * COALESCE(ip.lead_time_days,7)) + COALESCE(ip.safety_stock_qty,0) - COALESCE(il.on_hand_qty,0) - COALESCE(il.on_order_qty,0), 0) * COALESCE(il.average_cost, p.standard_cost, 0))::float8 AS estimated_cost,
          ps.supplier_name AS preferred_supplier
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN inventory_policies ip ON ip.tenant_id = il.tenant_id AND ip.product_id = il.product_id AND ip.location_id = il.location_id
        LEFT JOIN demand_90d d ON d.product_id = il.product_id AND d.location_id = il.location_id
        LEFT JOIN preferred_supplier ps ON ps.product_id = il.product_id
        WHERE ${where}
          AND (COALESCE(il.on_hand_qty,0) + COALESCE(il.on_order_qty,0) < (COALESCE(d.avg_daily_demand,0) * COALESCE(ip.lead_time_days,7)) + COALESCE(ip.safety_stock_qty,0))
        ORDER BY suggested_purchase_qty DESC
      `,
    };
  }

  // ── SUPPLIER PERFORMANCE ────────────────────────────────────────────────
  private supplierPerformanceExportQuery(
    tenantId: string,
    _filters: Record<string, unknown>,
  ) {
    return {
      columns: [
        { key: 'supplier_code', header: 'Code', width: 12 },
        { key: 'supplier_name', header: 'Supplier', width: 25 },
        { key: 'total_orders', header: 'Total Orders', width: 12 },
        { key: 'received_orders', header: 'Received', width: 10 },
        { key: 'avg_lead_time_days', header: 'Avg Lead Time', width: 14 },
        { key: 'on_time_pct', header: 'On Time %', width: 10 },
        { key: 'total_order_value', header: 'Total Value', width: 14 },
        { key: 'quality_rating', header: 'Quality', width: 10 },
      ],
      query: Prisma.sql`
        WITH po_receipts AS (
          SELECT po.id AS po_id, po.supplier_id, po.order_date, po.expected_date, po.total_amount,
            MIN(gr.receipt_date) AS first_receipt_date
          FROM purchase_orders po
          LEFT JOIN goods_receipts gr ON gr.purchase_order_id = po.id AND gr.status = 'POSTED'
          WHERE po.tenant_id = ${tenantId}::uuid AND po.status != 'CANCELLED'
          GROUP BY po.id, po.supplier_id, po.order_date, po.expected_date, po.total_amount
        )
        SELECT s.code AS supplier_code, s.name AS supplier_name,
          COUNT(pr.po_id)::int AS total_orders,
          COUNT(pr.first_receipt_date)::int AS received_orders,
          COALESCE(AVG(CASE WHEN pr.first_receipt_date IS NOT NULL THEN (pr.first_receipt_date::date - pr.order_date::date) END),0)::float8 AS avg_lead_time_days,
          CASE WHEN COUNT(pr.first_receipt_date) > 0 THEN (COUNT(CASE WHEN pr.first_receipt_date IS NOT NULL AND pr.expected_date IS NOT NULL AND pr.first_receipt_date::date <= pr.expected_date::date THEN 1 END)::float8 / COUNT(pr.first_receipt_date)::float8 * 100) ELSE 0 END::float8 AS on_time_pct,
          COALESCE(SUM(pr.total_amount),0)::float8 AS total_order_value,
          s.quality_rating::float8
        FROM suppliers s
        LEFT JOIN po_receipts pr ON pr.supplier_id = s.id
        WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'ACTIVE'
        GROUP BY s.id, s.code, s.name, s.quality_rating
        HAVING COUNT(pr.po_id) > 0
        ORDER BY on_time_pct DESC
      `,
    };
  }

  // ── ABC ANALYSIS ────────────────────────────────────────────────────────
  private abcAnalysisExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const periodMonths = Number(filters.periodMonths) || 12;
    const thresholdA = Number(filters.thresholdA) || 80;
    const thresholdB = Number(filters.thresholdB) || 95;

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'consumption_value', header: 'Consumption Value', width: 16 },
        { key: 'pct_of_total', header: '% of Total', width: 10 },
        { key: 'cumulative_pct', header: 'Cumulative %', width: 12 },
        { key: 'abc_class', header: 'ABC Class', width: 10 },
        { key: 'on_hand_qty', header: 'On Hand', width: 10 },
        { key: 'inventory_value', header: 'Inv. Value', width: 14 },
      ],
      query: Prisma.sql`
        WITH consumption AS (
          SELECT it.product_id,
            SUM(it.quantity * COALESCE(it.unit_cost,0))::float8 AS consumption_value,
            SUM(it.quantity)::float8 AS consumption_qty
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE','PRODUCTION_ISSUE')
            AND it.transaction_date >= (CURRENT_DATE - (${periodMonths}::int || ' months')::interval)
          GROUP BY it.product_id
        ),
        inv_agg AS (
          SELECT il2.product_id, SUM(il2.on_hand_qty)::float8 AS on_hand_qty, SUM(il2.inventory_value)::float8 AS inventory_value
          FROM inventory_levels il2 WHERE il2.tenant_id = ${tenantId}::uuid GROUP BY il2.product_id
        ),
        ranked AS (
          SELECT p.id AS product_id, p.code AS sku, p.name AS product_name,
            COALESCE(c.consumption_value,0)::float8 AS consumption_value,
            CASE WHEN SUM(COALESCE(c.consumption_value,0)) OVER () > 0 THEN (COALESCE(c.consumption_value,0) / SUM(COALESCE(c.consumption_value,0)) OVER () * 100) ELSE 0 END::float8 AS pct_of_total,
            SUM(CASE WHEN SUM(COALESCE(c.consumption_value,0)) OVER () > 0 THEN COALESCE(c.consumption_value,0) / SUM(COALESCE(c.consumption_value,0)) OVER () * 100 ELSE 0 END) OVER (ORDER BY COALESCE(c.consumption_value,0) DESC)::float8 AS cumulative_pct,
            COALESCE(ia.on_hand_qty,0)::float8 AS on_hand_qty,
            COALESCE(ia.inventory_value,0)::float8 AS inventory_value
          FROM products p
          LEFT JOIN consumption c ON c.product_id = p.id
          LEFT JOIN inv_agg ia ON ia.product_id = p.id
          WHERE p.tenant_id = ${tenantId}::uuid AND p.status = 'ACTIVE'
        )
        SELECT r.sku, r.product_name, r.consumption_value, r.pct_of_total, r.cumulative_pct,
          CASE WHEN r.cumulative_pct <= ${thresholdA}::float8 THEN 'A' WHEN r.cumulative_pct <= ${thresholdB}::float8 THEN 'B' ELSE 'C' END AS abc_class,
          r.on_hand_qty, r.inventory_value
        FROM ranked r
        ORDER BY r.consumption_value DESC
      `,
    };
  }

  // ── INVENTORY TURNOVER ──────────────────────────────────────────────────
  private turnoverExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const startDate = (filters.startDate as string) || new Date(new Date().setMonth(new Date().getMonth() - 12)).toISOString().slice(0, 10);
    const endDate = (filters.endDate as string) || new Date().toISOString().slice(0, 10);
    const extraConds = this.buildProductLocationConds(filters, 'il');
    const where = this.buildWhere(
      Prisma.sql`il.tenant_id = ${tenantId}::uuid AND il.on_hand_qty > 0`,
      extraConds,
      'il',
    );

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'cogs', header: 'COGS', width: 14 },
        { key: 'avg_inventory', header: 'Avg Inventory', width: 14 },
        { key: 'turnover_ratio', header: 'Turnover Ratio', width: 14 },
        { key: 'days_of_inventory', header: 'Days of Inv.', width: 12 },
      ],
      query: Prisma.sql`
        WITH cogs AS (
          SELECT it.product_id, it.location_id,
            SUM(it.quantity * COALESCE(it.unit_cost,0))::float8 AS cogs_value
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE','PRODUCTION_ISSUE')
            AND it.transaction_date >= ${startDate}::timestamp
            AND it.transaction_date <= ${endDate}::timestamp
          GROUP BY it.product_id, it.location_id
        )
        SELECT p.code AS sku, p.name AS product_name, l.code AS location_code,
          COALESCE(c.cogs_value,0)::float8 AS cogs,
          COALESCE(il.inventory_value,0)::float8 AS avg_inventory,
          CASE WHEN COALESCE(il.inventory_value,0) > 0 THEN (COALESCE(c.cogs_value,0) / il.inventory_value)::float8 ELSE NULL END AS turnover_ratio,
          CASE WHEN COALESCE(c.cogs_value,0) > 0 AND COALESCE(il.inventory_value,0) > 0 THEN (365.0 * il.inventory_value / c.cogs_value)::float8 ELSE NULL END AS days_of_inventory
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN cogs c ON c.product_id = il.product_id AND c.location_id = il.location_id
        WHERE ${where}
        ORDER BY turnover_ratio ASC NULLS LAST
      `,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private buildProductLocationConds(
    filters: Record<string, unknown>,
    alias: string = 'p',
  ): Prisma.Sql[] {
    const conds: Prisma.Sql[] = [];
    const pIds = filters.productIds as string[] | undefined;
    const lIds = filters.locationIds as string[] | undefined;
    const cat = filters.category as string | undefined;

    if (pIds?.length) {
      const pAlias = alias === 'il' || alias === 'b' ? 'p' : alias;
      conds.push(Prisma.sql`${Prisma.raw(pAlias)}.id = ANY(${pIds}::uuid[])`);
    }
    if (lIds?.length) {
      conds.push(Prisma.sql`l.id = ANY(${lIds}::uuid[])`);
    }
    if (cat) {
      const pAlias = alias === 'il' || alias === 'b' ? 'p' : alias;
      conds.push(Prisma.sql`${Prisma.raw(pAlias)}.category = ${cat}`);
    }
    return conds;
  }

  private buildWhere(
    base: Prisma.Sql,
    extra: Prisma.Sql[],
    _alias?: string,
  ): Prisma.Sql {
    if (!extra.length) return base;
    return Prisma.sql`${base} AND ${Prisma.join(extra, ' AND ')}`;
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private formatValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    if (typeof val === 'bigint') return val.toString();
    if (typeof val === 'number') {
      return Number.isInteger(val) ? val.toString() : val.toFixed(2);
    }
    return String(val);
  }
}
