// ============================================================================
// STREAMING REPORT EXPORT SERVICE
// Handles CSV and XLSX export for pharma reports (1-2GB capable)
// Uses streaming to avoid memory pressure on large datasets
// ============================================================================

import { BadRequestException, Injectable, Logger, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PassThrough, Readable } from 'stream';
import { PrismaService } from '../../../core/database/prisma.service';
import { MargOutstandingService } from '../../marg-ede/marg-outstanding.service';
import { AccountingReportsService } from './accounting-reports.service';
import { ExpiryReportsService } from './expiry-reports.service';
import { InventoryAlertsService } from './inventory-alerts.service';
import { InventoryReportsService } from './inventory-reports.service';
import { ProcurementReportsService } from './procurement-reports.service';
import { SalesPurchaseAnalysisService } from './sales-purchase-analysis.service';

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

interface ExportDataSet {
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  sheetName?: string;
}

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly margOutstanding: MargOutstandingService,
    private readonly accountingReports: AccountingReportsService,
    private readonly expiryReports: ExpiryReportsService,
    private readonly inventoryAlerts: InventoryAlertsService,
    private readonly inventoryReports: InventoryReportsService,
    private readonly procurementReports: ProcurementReportsService,
    private readonly salesPurchaseAnalysis: SalesPurchaseAnalysisService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Main export entry point — dispatches to the correct report query
  // and streams CSV or XLSX back
  // ─────────────────────────────────────────────────────────────────────────
  // Columns hidden from every exported report file (CSV/XLSX), matching the
  // on-screen report tables: clients run a single branch (Location is redundant)
  // and SKU is hidden by request. Filtered centrally here so the download mirrors
  // the screen without editing each report's column list. The row SQL still
  // selects these fields; they are simply not emitted.
  private static readonly HIDDEN_EXPORT_COLUMN_KEYS = new Set(['sku', 'location_code']);

  private stripHiddenColumns(columns: ExportColumn[]): ExportColumn[] {
    return columns.filter((c) => !ReportExportService.HIDDEN_EXPORT_COLUMN_KEYS.has(c.key));
  }

  async getReportDataForPdf(tenantId: string, reportType: string, filters: Record<string, unknown>): Promise<ExportDataSet | null> {
    const dataSet = await this.getInMemoryReportData(tenantId, reportType, filters);
    if (dataSet) return { ...dataSet, columns: this.stripHiddenColumns(dataSet.columns) };

    try {
      const { columns, query } = this.getReportQuery(tenantId, reportType, filters);
      const limitedQuery = Prisma.sql`${query} LIMIT 5000`;
      const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(limitedQuery);
      return { columns: this.stripHiddenColumns(columns), rows, sheetName: reportType };
    } catch {
      return null;
    }
  }

  async exportReport(req: ExportRequest): Promise<{
    stream: StreamableFile;
    contentType: string;
    filename: string;
  }> {
    const { tenantId, reportType, format, filters } = req;
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${reportType}_${timestamp}.${format}`;

    const dataSet = await this.getInMemoryReportData(tenantId, reportType, filters);
    if (dataSet) {
      const dataSetColumns = this.stripHiddenColumns(dataSet.columns);
      if (format === 'csv') {
        const stream = this.streamRowsCsv(dataSet.rows, dataSetColumns);
        return {
          stream: new StreamableFile(stream),
          contentType: 'text/csv; charset=utf-8',
          filename,
        };
      }

      const stream = await this.streamRowsXlsx(
        dataSet.rows,
        dataSetColumns,
        dataSet.sheetName ?? reportType,
      );
      return {
        stream: new StreamableFile(stream),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename,
      };
    }

    const { columns, query } = this.getReportQuery(tenantId, reportType, filters);
    const visibleColumns = this.stripHiddenColumns(columns);

    if (format === 'csv') {
      const stream = await this.streamCsv(query, visibleColumns);
      return {
        stream: new StreamableFile(stream),
        contentType: 'text/csv; charset=utf-8',
        filename,
      };
    }

    const stream = await this.streamXlsx(query, visibleColumns, reportType);
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
  private streamRowsCsv(
    rows: Record<string, unknown>[],
    columns: ExportColumn[],
  ): Readable {
    const pass = new PassThrough();
    pass.write('\uFEFF');
    pass.write(columns.map((c) => this.escapeCsv(c.header)).join(',') + '\n');

    for (const row of rows) {
      const line = columns
        .map((col) => this.escapeCsv(this.formatValue(row[col.key])))
        .join(',');
      pass.write(line + '\n');
    }

    pass.end();
    return pass;
  }

  private async streamRowsXlsx(
    rows: Record<string, unknown>[],
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
    sheet.columns = columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width ?? 18,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' },
    };
    headerRow.commit();

    (async () => {
      try {
        for (const row of rows) {
          const rowData: Record<string, unknown> = {};
          for (const col of columns) {
            rowData[col.key] = this.formatValue(row[col.key]);
          }
          sheet.addRow(rowData).commit();
        }

        sheet.commit();
        await workbook.commit();
      } catch (err) {
        this.logger.error('XLSX row export error', err);
        pass.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return pass;
  }

  private async getInMemoryReportData(
    tenantId: string,
    reportType: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet | null> {
    switch (reportType) {
      case 'expiry-risk':
        return this.getExpiryRiskExportData(tenantId, filters);
      case 'alerts':
        return this.getAlertsExportData(tenantId, filters);
      case 'reorder':
        return this.getReorderExportData(tenantId, filters);
      case 'suggested-purchase':
        return this.getSuggestedPurchaseExportData(tenantId, filters);
      case 'supplier-performance':
        return this.getSupplierPerformanceExportData(tenantId, filters);
      case 'stock-out':
        return this.getStockOutExportData(tenantId, filters);
      case 'financial-outstanding':
        return this.getFinancialOutstandingExportData(tenantId, filters);
      case 'financial-outstanding-groups':
        return this.getFinancialOutstandingGroupsExportData(tenantId, filters);
      case 'financial-outstanding-detail':
        return this.getFinancialOutstandingDetailExportData(tenantId, filters);
      case 'financial-party-ledger':
        return this.getFinancialLedgerExportData(tenantId, filters);
      case 'sales-analysis-bills':
        return this.getSalesPurchaseBillsExportData(tenantId, 'sales', filters);
      case 'purchase-analysis-bills':
        return this.getSalesPurchaseBillsExportData(tenantId, 'purchase', filters);
      case 'trial-balance':
        return this.getTrialBalanceExportData(tenantId, filters);
      case 'account-ledger':
        return this.getAccountLedgerExportData(tenantId, filters);
      default:
        return null;
    }
  }

  private async getSalesPurchaseBillsExportData(
    tenantId: string,
    kind: 'sales' | 'purchase',
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const report = await this.salesPurchaseAnalysis.getBills(tenantId, kind, {
      ...this.toReportFilters(filters),
      limit: 100000,
      offset: 0,
    } as any);

    const isSales = kind === 'sales';
    return {
      sheetName: isSales ? 'Sales Analysis' : 'Purchase Analysis',
      columns: [
        { key: 'invoice_number', header: isSales ? 'Invoice No.' : 'Purchase Bill No.', width: 18 },
        { key: 'date', header: 'Date', width: 14 },
        { key: 'party_name', header: isSales ? 'Customer' : 'Supplier', width: 28 },
        { key: 'branch_name', header: 'Branch / Warehouse', width: 22 },
        { key: 'salesman_display', header: isSales ? 'Salesman' : 'User', width: 28 },
        { key: 'salesman', header: 'Salesman Code', width: 16 },
        { key: 'salesman_name', header: 'Salesman Name', width: 24 },
        { key: 'payment_mode', header: 'Payment Mode', width: 14 },
        { key: 'gross_amount', header: 'Gross Amount', width: 16 },
        { key: 'discount', header: 'Discount', width: 14 },
        { key: 'discount_pct', header: 'Discount %', width: 12 },
        { key: 'tax_amount', header: 'Tax', width: 14 },
        { key: 'round_off', header: 'Round Off', width: 12 },
        { key: 'net_amount', header: 'Net Amount', width: 16 },
        ...(isSales ? [
          { key: 'cost_amount', header: 'Cost', width: 14 },
          { key: 'profit', header: 'Profit', width: 14 },
          { key: 'margin_pct', header: 'Margin %', width: 12 },
        ] : []),
        { key: 'quantity', header: 'Quantity', width: 12 },
        { key: 'item_count', header: 'Item Count', width: 12 },
        { key: 'status', header: 'Status', width: 12 },
      ],
      rows: report.data as Record<string, unknown>[],
    };
  }

  private async getExpiryRiskExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const report = await this.expiryReports.getExpiryRiskAnalysis(tenantId, this.toReportFilters(filters));
    const rows: Record<string, unknown>[] = [
      { section: 'Summary', metric: 'Total Inventory Value', value: report.total_inventory_value },
      { section: 'Summary', metric: 'Expired Value', value: report.expired_value, percentage: report.expired_pct },
      { section: 'Summary', metric: 'Near Expiry 30 Days', value: report.near_expiry_value_30d, percentage: report.near_expiry_pct_30d },
      { section: 'Summary', metric: 'Near Expiry 90 Days', value: report.near_expiry_value_90d, percentage: report.near_expiry_pct_90d },
      { section: 'Summary', metric: 'Near Expiry 180 Days', value: report.near_expiry_value_180d, percentage: report.near_expiry_pct_180d },
      { section: 'Summary', metric: 'Near Expiry 270 Days', value: report.near_expiry_value_270d, percentage: report.near_expiry_pct_270d },
      ...report.monthly_trend.map((point) => ({
        section: 'Monthly Trend',
        metric: 'Expiring Value',
        month: point.month,
        value: point.expiring_value,
        quantity: point.expiring_qty,
        batch_count: point.batch_count,
      })),
    ];

    return {
      sheetName: 'Expiry Risk',
      columns: [
        { key: 'section', header: 'Section', width: 18 },
        { key: 'metric', header: 'Metric', width: 26 },
        { key: 'month', header: 'Month', width: 12 },
        { key: 'value', header: 'Value', width: 16 },
        { key: 'percentage', header: 'Percentage', width: 14 },
        { key: 'quantity', header: 'Quantity', width: 14 },
        { key: 'batch_count', header: 'Batch Count', width: 14 },
      ],
      rows,
    };
  }

  private async getAlertsExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const alerts = await this.inventoryAlerts.getActiveAlerts(tenantId, {
      alertLimit: this.numberFilter(filters, 'alertLimit') ?? 100000,
      nearExpiryDays: this.numberFilter(filters, 'nearExpiryDays'),
      aClassOnly: this.booleanFilter(filters, 'aClassOnly'),
    });
    const alertType = this.stringFilter(filters, 'alertType');
    const severity = this.stringFilter(filters, 'severity');
    const rows = alerts
      .filter((alert) => !alertType || alertType === 'ALL' || alert.alert_type === alertType)
      .filter((alert) => !severity || severity === 'ALL' || alert.severity === severity)
      .map((alert) => ({
        alert_type: alert.alert_type,
        severity: alert.severity,
        sku: alert.sku,
        product_name: alert.product_name,
        location_code: alert.location_code,
        batch_number: alert.batch_number,
        message: alert.message,
        value_at_risk: alert.value_at_risk,
      }));

    return {
      sheetName: 'Alerts',
      columns: [
        { key: 'alert_type', header: 'Alert Type', width: 18 },
        { key: 'severity', header: 'Severity', width: 12 },
        { key: 'sku', header: 'SKU', width: 16 },
        { key: 'product_name', header: 'Product', width: 32 },
        { key: 'location_code', header: 'Location', width: 14 },
        { key: 'batch_number', header: 'Batch', width: 18 },
        { key: 'message', header: 'Message', width: 60 },
        { key: 'value_at_risk', header: 'Value at Risk', width: 16 },
      ],
      rows,
    };
  }

  private async getReorderExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const report = await this.inventoryReports.getReorderReport(
      tenantId,
      this.toReorderServiceFilters(filters),
    );

    return {
      sheetName: 'Reorder',
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 32 },
        { key: 'product_company_display', header: 'Company', width: 28 },
        { key: 'salt_display', header: 'Salt', width: 28 },
        { key: 'product_group_display', header: 'Product Group', width: 24 },
        { key: 'hsn_code', header: 'HSN', width: 14 },
        { key: 'supplier_display', header: 'Supplier', width: 28 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'on_hand_qty', header: 'On Hand', width: 12 },
        { key: 'available_qty', header: 'Available', width: 12 },
        { key: 'on_order_qty', header: 'On Order', width: 12 },
        { key: 'avg_daily_sales', header: 'Avg Daily Sales', width: 16 },
        { key: 'lead_time_days', header: 'Lead Time', width: 12 },
        { key: 'safety_stock_qty', header: 'Safety Stock', width: 14 },
        { key: 'reorder_point', header: 'Reorder Point', width: 14 },
        { key: 'order_up_to_qty', header: 'Order Up To', width: 14 },
        { key: 'suggested_order_qty', header: 'Suggested Qty', width: 14 },
        { key: 'days_of_stock', header: 'Days of Stock', width: 14 },
        { key: 'reorder_status', header: 'Status', width: 16 },
        { key: 'policy_source', header: 'Policy Source', width: 18 },
        { key: 'policy_scope_label', header: 'Policy Scope', width: 30 },
        { key: 'abc_class', header: 'ABC Class', width: 12 },
      ],
      rows: report.data as unknown as Record<string, unknown>[],
    };
  }

  private async getSuggestedPurchaseExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const report = await this.procurementReports.getSuggestedPurchase(
      tenantId,
      this.toSuggestedPurchaseServiceFilters(filters),
    );

    return {
      sheetName: 'Suggested Purchase',
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 32 },
        { key: 'product_company_display', header: 'Company', width: 28 },
        { key: 'salt_display', header: 'Salt', width: 28 },
        { key: 'product_group_display', header: 'Product Group', width: 24 },
        { key: 'hsn_code', header: 'HSN', width: 14 },
        { key: 'supplier_display', header: 'Supplier', width: 28 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'current_stock', header: 'Current Stock', width: 14 },
        { key: 'available_stock', header: 'Available', width: 12 },
        { key: 'on_order_qty', header: 'On Order', width: 12 },
        { key: 'avg_daily_demand', header: 'Avg Daily Demand', width: 18 },
        { key: 'lead_time_days', header: 'Lead Time', width: 12 },
        { key: 'safety_stock', header: 'Safety Stock', width: 14 },
        { key: 'reorder_point', header: 'Reorder Point', width: 14 },
        { key: 'demand_during_lead_time', header: 'Lead-Time Demand', width: 18 },
        { key: 'suggested_purchase_qty', header: 'Suggested Qty', width: 14 },
        { key: 'estimated_cost', header: 'Estimated Cost', width: 16 },
        { key: 'preferred_supplier', header: 'Preferred Supplier', width: 24 },
        { key: 'policy_source', header: 'Policy Source', width: 18 },
        { key: 'policy_scope_label', header: 'Policy Scope', width: 30 },
        { key: 'abc_class', header: 'ABC Class', width: 12 },
      ],
      rows: report.data as unknown as Record<string, unknown>[],
    };
  }

  private async getSupplierPerformanceExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const report = await this.procurementReports.getSupplierPerformanceReport(tenantId, {
      ...this.toReportFilters(filters),
      limit: 100000,
      offset: 0,
    });

    return {
      sheetName: 'Supplier Performance',
      columns: [
        { key: 'supplier_code', header: 'Supplier Code', width: 16 },
        { key: 'supplier_name', header: 'Supplier', width: 32 },
        { key: 'mapping_status', header: 'Mapping Status', width: 20 },
        { key: 'total_orders', header: 'Total Orders', width: 14 },
        { key: 'purchase_invoice_count', header: 'Purchase Invoices', width: 18 },
        { key: 'on_time_delivery_pct', header: 'On-Time Delivery %', width: 20 },
        { key: 'avg_lead_time_days', header: 'Avg Lead Time Days', width: 20 },
        { key: 'fulfillment_rate_pct', header: 'Fulfillment Rate %', width: 20 },
        { key: 'rejection_rate_pct', header: 'Rejection Rate %', width: 18 },
        { key: 'total_spend', header: 'Total Spend', width: 16 },
        { key: 'spend_source', header: 'Spend Source', width: 28 },
        { key: 'spend_note', header: 'Spend Note', width: 50 },
        { key: 'last_activity_date', header: 'Last Activity', width: 16 },
      ],
      rows: report.data as unknown as Record<string, unknown>[],
    };
  }

  private async getStockOutExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const report = await this.procurementReports.getStockOutReport(tenantId, {
      ...this.toReportFilters(filters),
      limit: 100000,
      offset: 0,
    });

    return {
      sheetName: 'Stock Out',
      columns: [
        { key: 'sku', header: 'SKU', width: 16 },
        { key: 'item_name', header: 'Item', width: 32 },
        { key: 'stock_out_count', header: 'Stock-Out Count', width: 18 },
        { key: 'total_duration_days', header: 'Total Duration Days', width: 20 },
        { key: 'last_stock_out_date', header: 'Last Stock-Out Date', width: 18 },
        { key: 'current_stock', header: 'Current Stock', width: 16 },
        { key: 'marg_current_stock', header: 'Marg Current Stock', width: 20 },
        { key: 'current_stock_delta', header: 'Current Stock Delta', width: 20 },
        { key: 'current_stock_source', header: 'Current Stock Source', width: 24 },
      ],
      rows: report.data as unknown as Record<string, unknown>[],
    };
  }

  private async getFinancialOutstandingExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    // Forward the on-screen aging context so the export matches what the user
    // sees: same as-of anchor, same bucket scheme, same DSO window.
    const report = await this.margOutstanding.getMargOutstandingSummary(tenantId, {
      partyType: this.partyTypeFilter(filters),
      companyId: this.numberFilter(filters, 'companyId'),
      sortBy: this.stringFilter(filters, 'sortBy'),
      sortDir: this.sortDirFilter(filters),
      filters: this.stringFilter(filters, 'filters'),
      asOfDate: this.stringFilter(filters, 'asOfDate'),
      bucketBoundaries: this.stringFilter(filters, 'bucketBoundaries'),
      dsoDays: this.numberFilter(filters, 'dsoDays'),
      limit: 10000,
      offset: 0,
    });

    // Bucket columns are dynamic — labels track the configured scheme so an
    // audit copy of a 15/30/60/90/180 export reads "0-15 / 16-30 …" instead
    // of misleading 30/60/90 headers paired with 15/30/60 values.
    const bucketCols = report.bucketDefinitions.map((def, idx) => ({
      key: `bucket_${idx}`,
      header: def.label,
      width: 14,
    }));

    return {
      sheetName: 'Financial Outstanding',
      columns: [
        { key: 'partyCode', header: 'Party Code', width: 16 },
        { key: 'partyName', header: 'Party', width: 34 },
        { key: 'groupName', header: 'Group', width: 22 },
        { key: 'companyId', header: 'Company', width: 10 },
        { key: 'openInvoiceCount', header: 'Open Bills', width: 12 },
        { key: 'totalOutstanding', header: 'Outstanding', width: 16 },
        { key: 'creditBalance', header: 'Credit / Advance', width: 16 },
        { key: 'pdLess', header: 'PD Cheques', width: 14 },
        ...bucketCols,
        { key: 'avgDaysOutstanding', header: 'Avg Days', width: 12 },
        { key: 'lastInvoiceDate', header: 'Last Bill', width: 14 },
      ],
      rows: report.rows.map((row) => {
        const flatBuckets: Record<string, number> = {};
        for (let i = 0; i < report.bucketDefinitions.length; i += 1) {
          flatBuckets[`bucket_${i}`] = row.bucketAmounts?.[i] ?? 0;
        }
        return {
          partyCode: row.partyCode,
          partyName: row.partyName,
          groupName: row.groupName,
          companyId: row.companyId,
          openInvoiceCount: row.openInvoiceCount,
          totalOutstanding: row.totalOutstanding,
          creditBalance: row.creditBalance,
          pdLess: row.pdLess,
          ...flatBuckets,
          avgDaysOutstanding: row.avgDaysOutstanding,
          lastInvoiceDate: row.lastInvoiceDate,
        };
      }),
    };
  }

  private async getFinancialOutstandingGroupsExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const report = await this.margOutstanding.getMargOutstandingByGroup(tenantId, {
      partyType: this.partyTypeFilter(filters),
      companyId: this.numberFilter(filters, 'companyId'),
      sortBy: this.stringFilter(filters, 'sortBy'),
      sortDir: this.sortDirFilter(filters),
      filters: this.stringFilter(filters, 'filters'),
      asOfDate: this.stringFilter(filters, 'asOfDate'),
      bucketBoundaries: this.stringFilter(filters, 'bucketBoundaries'),
      limit: 10_000,
      offset: 0,
    });

    const bucketCols = report.bucketDefinitions.map((def, idx) => ({
      key: `bucket_${idx}`,
      header: def.label,
      width: 14,
    }));

    return {
      sheetName: 'Outstanding by Group',
      columns: [
        { key: 'groupCode', header: 'Group Code', width: 16 },
        { key: 'groupName', header: 'Group', width: 34 },
        { key: 'partyCount', header: 'Parties', width: 10 },
        { key: 'openInvoiceCount', header: 'Open Bills', width: 12 },
        { key: 'totalOutstanding', header: 'Outstanding', width: 16 },
        { key: 'creditBalance', header: 'Credit / Advance', width: 16 },
        { key: 'pdLess', header: 'PD Cheques', width: 14 },
        ...bucketCols,
        { key: 'avgDaysOutstanding', header: 'Avg Days', width: 12 },
        { key: 'lastInvoiceDate', header: 'Last Bill', width: 14 },
      ],
      rows: report.rows.map((row) => {
        const flatBuckets: Record<string, number> = {};
        for (let i = 0; i < report.bucketDefinitions.length; i += 1) {
          flatBuckets[`bucket_${i}`] = row.bucketAmounts?.[i] ?? 0;
        }
        return {
          groupCode: row.groupCode,
          groupName: row.groupName,
          partyCount: row.partyCount,
          openInvoiceCount: row.openInvoiceCount,
          totalOutstanding: row.totalOutstanding,
          creditBalance: row.creditBalance,
          pdLess: row.pdLess,
          ...flatBuckets,
          avgDaysOutstanding: row.avgDaysOutstanding,
          lastInvoiceDate: row.lastInvoiceDate,
        };
      }),
    };
  }

  private async getFinancialOutstandingDetailExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const partyCode = this.stringFilter(filters, 'partyCode');
    if (!partyCode) throw new BadRequestException('partyCode is required for party outstanding export');

    const report = await this.margOutstanding.getMargOutstandingDetail(tenantId, partyCode, {
      companyId: this.numberFilter(filters, 'companyId'),
      includeSettled: this.booleanFilter(filters, 'includeSettled'),
      sortBy: this.stringFilter(filters, 'sortBy'),
      sortDir: this.sortDirFilter(filters),
      filters: this.stringFilter(filters, 'filters'),
      asOfDate: this.stringFilter(filters, 'asOfDate'),
      bucketBoundaries: this.stringFilter(filters, 'bucketBoundaries'),
      bucketIndex: this.numberFilter(filters, 'bucketIndex'),
    });

    // Resolve the per-bill bucket label from the active scheme rather than the
    // hardcoded 30/60/90 enum names so a "Strict 15/30/60/90" export shows
    // "16-30" not "DAYS_31_60".
    const bucketLabelByIndex = (idx: number): string =>
      report.bucketDefinitions[idx]?.label ?? this.financialBucketLabel(report.invoices[0]?.bucket ?? 'CURRENT');

    return {
      sheetName: 'Party Outstanding',
      columns: [
        { key: 'partyCode', header: 'Party Code', width: 16 },
        { key: 'partyName', header: 'Party', width: 34 },
        { key: 'date', header: 'Date', width: 14 },
        { key: 'vcn', header: 'VCN', width: 16 },
        { key: 'voucher', header: 'Voucher', width: 18 },
        { key: 'sVoucher', header: 'S Voucher', width: 18 },
        { key: 'days', header: 'Days', width: 10 },
        { key: 'bucket', header: 'Bucket', width: 14 },
        { key: 'finalAmt', header: 'Bill Amount', width: 16 },
        { key: 'pdLess', header: 'PD Less', width: 14 },
        { key: 'balance', header: 'Balance', width: 16 },
      ],
      rows: report.invoices.map((invoice) => ({
        partyCode: report.partyCode,
        partyName: report.partyName,
        ...invoice,
        bucket: bucketLabelByIndex(invoice.bucketIndex),
      })),
    };
  }

  private async getFinancialLedgerExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const partyCode = this.stringFilter(filters, 'partyCode');
    if (!partyCode) throw new BadRequestException('partyCode is required for party ledger export');

    const report = await this.margOutstanding.getMargPartyLedger(tenantId, partyCode, {
      companyId: this.numberFilter(filters, 'companyId'),
      fromDate: this.stringFilter(filters, 'fromDate'),
      toDate: this.stringFilter(filters, 'toDate'),
      sortBy: this.stringFilter(filters, 'sortBy'),
      sortDir: this.sortDirFilter(filters),
      filters: this.stringFilter(filters, 'filters'),
      limit: 100000,
      offset: 0,
    });

    return {
      sheetName: 'Party Ledger',
      columns: [
        { key: 'partyCode', header: 'Party Code', width: 16 },
        { key: 'partyName', header: 'Party', width: 34 },
        { key: 'date', header: 'Date', width: 14 },
        { key: 'bookName', header: 'Book', width: 18 },
        { key: 'book', header: 'Book Code', width: 12 },
        { key: 'voucher', header: 'Voucher', width: 18 },
        { key: 'vcn', header: 'VCN', width: 16 },
        { key: 'counterpartyName', header: 'Particulars', width: 34 },
        { key: 'counterpartyCode', header: 'Particular Code', width: 18 },
        { key: 'remark', header: 'Remark', width: 40 },
        { key: 'debit', header: 'Debit', width: 16 },
        { key: 'credit', header: 'Credit', width: 16 },
        { key: 'runningBalance', header: 'Running Balance', width: 18 },
      ],
      rows: report.transactions.map((transaction) => ({
        partyCode: report.partyCode,
        partyName: report.partyName,
        ...transaction,
      })),
    };
  }

  private async getTrialBalanceExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const report = await this.accountingReports.getTrialBalance(tenantId, {
      startDate: this.stringFilter(filters, 'startDate'),
      endDate: this.stringFilter(filters, 'endDate'),
      accountType: this.stringFilter(filters, 'accountType'),
      showZero: filters.showZero === true || filters.showZero === 'true',
      limit: 5000,
      offset: 0,
      sortBy: this.stringFilter(filters, 'sortBy'),
      sortDir: this.sortDirFilter(filters),
      filters: this.stringFilter(filters, 'filters'),
    });

    return {
      sheetName: 'Trial Balance',
      columns: [
        { key: 'accountNumber', header: 'Account Number', width: 18 },
        { key: 'name', header: 'Account Name', width: 34 },
        { key: 'accountType', header: 'Type', width: 16 },
        { key: 'normalBalance', header: 'Normal Balance', width: 14 },
        { key: 'openingBalance', header: 'Opening Balance', width: 18 },
        { key: 'totalDebits', header: 'Total Debits', width: 16 },
        { key: 'totalCredits', header: 'Total Credits', width: 16 },
        { key: 'netBalance', header: 'Net Balance', width: 16 },
        { key: 'closingBalance', header: 'Closing Balance', width: 18 },
      ],
      rows: report.rows as unknown as Record<string, unknown>[],
    };
  }

  private async getAccountLedgerExportData(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ExportDataSet> {
    const accountId = this.stringFilter(filters, 'accountId');
    if (!accountId) throw new BadRequestException('accountId is required for account ledger export');

    const report = await this.accountingReports.getAccountLedger(tenantId, accountId, {
      startDate: this.stringFilter(filters, 'startDate'),
      endDate: this.stringFilter(filters, 'endDate'),
      limit: 100000,
      offset: 0,
      sortBy: this.stringFilter(filters, 'sortBy'),
      sortDir: this.sortDirFilter(filters),
      filters: this.stringFilter(filters, 'filters'),
    });

    return {
      sheetName: 'Account Ledger',
      columns: [
        { key: 'entryDate', header: 'Date', width: 14 },
        { key: 'entryNumber', header: 'Entry No.', width: 16 },
        { key: 'description', header: 'Description', width: 40 },
        { key: 'debitAmount', header: 'Debit', width: 16 },
        { key: 'creditAmount', header: 'Credit', width: 16 },
        { key: 'runningBalance', header: 'Running Balance', width: 18 },
      ],
      rows: report.rows as unknown as Record<string, unknown>[],
    };
  }

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
      case 'movement-ledger':
        return this.movementLedgerExportQuery(tenantId, filters);
      case 'stock-ageing':
        return this.stockAgeingExportQuery(tenantId, filters);
      case 'near-expiry':
        return this.nearExpiryExportQuery(tenantId, filters);
      case 'expired-stock':
        return this.expiredStockExportQuery(tenantId, filters);
      case 'fefo-picking':
        return this.fefoPickingExportQuery(tenantId, filters);
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
      case 'xyz-analysis':
        return this.xyzAnalysisExportQuery(tenantId, filters);
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
      Prisma.sql`il.tenant_id = ${tenantId}::uuid AND il.on_hand_qty != 0`,
      extraConds,
    );

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'company_display', header: 'Product Company', width: 28 },
        { key: 'salt_display', header: 'Product Salt', width: 28 },
        { key: 'product_group_display', header: 'Product Group', width: 28 },
        { key: 'uom_display', header: 'UOM', width: 18 },
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
          CASE WHEN NULLIF(TRIM(p.product_company), '') IS NULL THEN NULL ELSE TRIM(p.product_company) || ' - ' || COALESCE(pc.name, 'Unknown company (' || TRIM(p.product_company) || ')') END AS company_display,
          CASE WHEN NULLIF(TRIM(p.salt), '') IS NULL THEN NULL ELSE TRIM(p.salt) || ' - ' || COALESCE(ps.name, 'Unknown salt (' || TRIM(p.salt) || ')') END AS salt_display,
          CASE WHEN NULLIF(TRIM(p.product_group), '') IS NULL THEN NULL ELSE TRIM(p.product_group) || ' - ' || COALESCE(pg.name, 'Unknown group (' || TRIM(p.product_group) || ')') END AS product_group_display,
          CASE WHEN NULLIF(TRIM(p.unit_of_measure), '') IS NULL THEN NULL ELSE TRIM(p.unit_of_measure) || ' - ' || COALESCE(uom.name, 'Unknown UOM (' || TRIM(p.unit_of_measure) || ')') END AS uom_display,
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
        LEFT JOIN product_companies pc ON pc.tenant_id = p.tenant_id AND pc.code = NULLIF(TRIM(p.product_company), '')
        LEFT JOIN product_salts ps ON ps.tenant_id = p.tenant_id AND ps.code = NULLIF(TRIM(p.salt), '')
        LEFT JOIN product_categories pg ON pg.tenant_id = p.tenant_id AND pg.code = NULLIF(TRIM(p.product_group), '')
        LEFT JOIN unit_of_measures uom ON uom.tenant_id = p.tenant_id AND uom.code = NULLIF(TRIM(p.unit_of_measure), '')
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

  // ── MOVEMENT LEDGER ────────────────────────────────────────────────────
  private movementLedgerExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const conds: Prisma.Sql[] = [];
    const productIds = filters.productIds as string[] | undefined;
    const locationIds = filters.locationIds as string[] | undefined;
    const batchIds = filters.batchIds as string[] | undefined;
    const startDate = filters.startDate as string | undefined;
    const endDate = filters.endDate as string | undefined;

    if (productIds?.length) {
      conds.push(Prisma.sql`il.product_id = ANY(${productIds}::uuid[])`);
    }
    if (locationIds?.length) {
      conds.push(Prisma.sql`il.location_id = ANY(${locationIds}::uuid[])`);
    }
    if (batchIds?.length) {
      conds.push(Prisma.sql`il.batch_id = ANY(${batchIds}::uuid[])`);
    }
    if (startDate) {
      conds.push(Prisma.sql`il.transaction_date >= ${startDate}::timestamp`);
    }
    if (endDate) {
      conds.push(Prisma.sql`il.transaction_date <= ${endDate}::timestamp`);
    }

    const where = this.buildWhere(
      Prisma.sql`il.tenant_id = ${tenantId}::uuid`,
      conds,
    );

    return {
      columns: [
        { key: 'sequence_number', header: 'Sequence', width: 12 },
        { key: 'transaction_date', header: 'Date', width: 16 },
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'batch_number', header: 'Batch', width: 18 },
        { key: 'entry_type', header: 'Type', width: 18 },
        { key: 'quantity', header: 'Qty', width: 10 },
        { key: 'unit_cost', header: 'Unit Cost', width: 12 },
        { key: 'total_cost', header: 'Value', width: 14 },
        { key: 'running_balance', header: 'Balance', width: 12 },
        { key: 'reference_type', header: 'Reference Type', width: 16 },
        { key: 'reference_number', header: 'Reference No.', width: 22 },
        { key: 'notes', header: 'Notes', width: 32 },
      ],
      query: Prisma.sql`
        SELECT
          il.sequence_number::text AS sequence_number,
          il.transaction_date,
          p.code AS sku,
          p.name AS product_name,
          l.code AS location_code,
          bat.batch_number,
          il.entry_type::text AS entry_type,
          il.quantity::float8 AS quantity,
          COALESCE(il.unit_cost, 0)::float8 AS unit_cost,
          COALESCE(il.total_cost, 0)::float8 AS total_cost,
          COALESCE(il.running_balance, 0)::float8 AS running_balance,
          il.reference_type,
          il.reference_number,
          il.notes
        FROM inventory_ledger il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN batches bat ON bat.id = il.batch_id
        WHERE ${where}
        ORDER BY il.sequence_number DESC
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
  private fefoPickingExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const extraConds = this.buildProductLocationConds(filters, 'b');
    const where = this.buildWhere(
      Prisma.sql`b.tenant_id = ${tenantId}::uuid AND b.status = 'AVAILABLE' AND COALESCE(b.available_qty, 0) > 0`,
      extraConds,
      'b',
    );

    return {
      columns: [
        { key: 'picking_sequence', header: 'Pick Sequence', width: 14 },
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'batch_number', header: 'Batch', width: 18 },
        { key: 'location_code', header: 'Location', width: 15 },
        { key: 'expiry_date', header: 'Expiry Date', width: 12 },
        { key: 'remaining_days', header: 'Days Left', width: 10 },
        { key: 'available_qty', header: 'Available Qty', width: 14 },
        { key: 'batch_status', header: 'Status', width: 12 },
      ],
      query: Prisma.sql`
        SELECT
          ROW_NUMBER() OVER (
            PARTITION BY p.id, l.id
            ORDER BY b.expiry_date ASC NULLS LAST, b.manufacturing_date ASC NULLS LAST
          )::int AS picking_sequence,
          p.code AS sku,
          p.name AS product_name,
          b.batch_number,
          l.code AS location_code,
          b.expiry_date,
          CASE
            WHEN b.expiry_date IS NOT NULL THEN (b.expiry_date::date - CURRENT_DATE)
            ELSE NULL
          END AS remaining_days,
          COALESCE(b.available_qty, 0)::float8 AS available_qty,
          b.status::text AS batch_status
        FROM batches b
        JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
        JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
        WHERE ${where}
        ORDER BY p.code, l.code, picking_sequence
      `,
    };
  }

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
               OR COALESCE(il.on_hand_qty,0) <= COALESCE(ip.safety_stock_qty,0))
        ORDER BY CASE ip.abc_class WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
          suggested_order_qty DESC
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

  // ── XYZ ANALYSIS ────────────────────────────────────────────────────────
  private xyzAnalysisExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const periodMonths = Number(filters.periodMonths) || 12;
    const thresholdX = Number(filters.thresholdX) || 0.5;
    const thresholdY = Number(filters.thresholdY) || 1.0;
    const extraConds = this.buildProductLocationConds(filters);
    const prodFilter = extraConds.length
      ? Prisma.sql`AND ${Prisma.join(extraConds, ' AND ')}`
      : Prisma.empty;

    return {
      columns: [
        { key: 'sku', header: 'SKU', width: 15 },
        { key: 'product_name', header: 'Product', width: 30 },
        { key: 'avg_monthly_demand', header: 'Avg Demand/Mo', width: 14 },
        { key: 'stddev_monthly_demand', header: 'Std Dev', width: 12 },
        { key: 'coefficient_of_variation', header: 'CV', width: 12 },
        { key: 'xyz_class', header: 'XYZ Class', width: 10 },
        { key: 'months_analyzed', header: 'Months', width: 10 },
      ],
      query: Prisma.sql`
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
            AVG(md.demand)::float8 AS avg_monthly_demand,
            STDDEV_POP(md.demand)::float8 AS stddev_monthly_demand,
            COUNT(md.month_start)::int AS months_analyzed
          FROM monthly_demand md
          GROUP BY md.product_id
        )
        SELECT
          p.code AS sku,
          p.name AS product_name,
          COALESCE(ps.avg_monthly_demand, 0)::float8 AS avg_monthly_demand,
          COALESCE(ps.stddev_monthly_demand, 0)::float8 AS stddev_monthly_demand,
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
    };
  }

  // ── STOCK AGEING ───────────────────────────────────────────────────────
  private stockAgeingExportQuery(
    tenantId: string,
    filters: Record<string, unknown>,
  ) {
    const bucketValues = Array.isArray(filters.bucketDays)
      ? (filters.bucketDays as Array<string | number>).map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [];
    const b0 = bucketValues[0] ?? 90;
    const b1 = bucketValues[1] ?? 180;
    const b2 = bucketValues[2] ?? 365;
    const extraConds = this.buildProductLocationConds(filters, 'b');
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
        { key: 'inward_date', header: 'Inward Date', width: 14 },
        { key: 'age_days', header: 'Age (Days)', width: 12 },
        { key: 'age_bucket', header: 'Bucket', width: 12 },
        { key: 'quantity', header: 'Qty', width: 10 },
        { key: 'batch_value', header: 'Value', width: 14 },
      ],
      query: Prisma.sql`
        SELECT
          p.code AS sku,
          p.name AS product_name,
          b.batch_number,
          l.code AS location_code,
          b.manufacturing_date AS inward_date,
          CASE
            WHEN b.manufacturing_date IS NULL THEN -1
            ELSE (CURRENT_DATE - b.manufacturing_date::date)
          END AS age_days,
          CASE
            WHEN b.manufacturing_date IS NULL THEN 'UNKNOWN'
            WHEN (CURRENT_DATE - b.manufacturing_date::date) < 0 THEN 'UNKNOWN'
            WHEN (CURRENT_DATE - b.manufacturing_date::date) <= ${b0} THEN ${`0-${b0}d`}
            WHEN (CURRENT_DATE - b.manufacturing_date::date) <= ${b1} THEN ${`${b0 + 1}-${b1}d`}
            WHEN (CURRENT_DATE - b.manufacturing_date::date) <= ${b2} THEN ${`${b1 + 1}-${b2}d`}
            ELSE ${`>${b2}d`}
          END AS age_bucket,
          b.quantity::float8 AS quantity,
          (COALESCE(b.quantity, 0) * COALESCE(b.cost_per_unit, 0))::float8 AS batch_value
        FROM batches b
        JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
        JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
        WHERE ${where}
        ORDER BY age_days DESC NULLS LAST
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

  private toReportFilters(filters: Record<string, unknown>): Record<string, any> {
    const { report: _report, format: _format, ...rest } = filters;
    return rest as Record<string, any>;
  }

  private toReorderServiceFilters(filters: Record<string, unknown>): Record<string, any> {
    return {
      productIds: this.stringArrayFilter(filters, 'productIds'),
      locationIds: this.stringArrayFilter(filters, 'locationIds'),
      category: this.stringFilter(filters, 'category'),
      startDate: this.stringFilter(filters, 'startDate'),
      endDate: this.stringFilter(filters, 'endDate'),
      sortBy: this.stringFilter(filters, 'sortBy'),
      sortDir: this.sortDirFilter(filters),
      filters: this.stringFilter(filters, 'filters'),
      lookbackDays: this.numberFilter(filters, 'lookbackDays'),
      avgSalesDays: this.numberFilter(filters, 'avgSalesDays'),
      coverageDays: this.numberFilter(filters, 'coverageDays'),
      leadTimeDays: this.numberFilter(filters, 'leadTimeDays'),
      safetyDays: this.numberFilter(filters, 'safetyDays'),
      includeAll: this.booleanFilter(filters, 'includeAll'),
      productCompany: this.stringFilter(filters, 'productCompany'),
      hsnCode: this.stringFilter(filters, 'hsnCode'),
      salt: this.stringFilter(filters, 'salt'),
      productGroup: this.stringFilter(filters, 'productGroup'),
      supplierIds: this.stringArrayFilter(filters, 'supplierIds'),
      limit: 100000,
      offset: 0,
    };
  }

  private toSuggestedPurchaseServiceFilters(filters: Record<string, unknown>): Record<string, any> {
    return {
      productIds: this.stringArrayFilter(filters, 'productIds'),
      locationIds: this.stringArrayFilter(filters, 'locationIds'),
      category: this.stringFilter(filters, 'category'),
      startDate: this.stringFilter(filters, 'startDate'),
      endDate: this.stringFilter(filters, 'endDate'),
      sortBy: this.stringFilter(filters, 'sortBy'),
      sortDir: this.sortDirFilter(filters),
      filters: this.stringFilter(filters, 'filters'),
      lookbackDays: this.numberFilter(filters, 'lookbackDays') ?? this.numberFilter(filters, 'avgSalesDays'),
      coverageDays: this.numberFilter(filters, 'coverageDays'),
      leadTimeDays: this.numberFilter(filters, 'leadTimeDays'),
      safetyDays: this.numberFilter(filters, 'safetyDays'),
      safetyMultiplier: this.numberFilter(filters, 'safetyMultiplier'),
      productCompany: this.stringFilter(filters, 'productCompany'),
      hsnCode: this.stringFilter(filters, 'hsnCode'),
      salt: this.stringFilter(filters, 'salt'),
      productGroup: this.stringFilter(filters, 'productGroup'),
      supplierIds: this.stringArrayFilter(filters, 'supplierIds'),
      limit: 100000,
      offset: 0,
    };
  }

  private rawFilterValue(filters: Record<string, unknown>, key: string): unknown {
    const value = filters[key];
    return Array.isArray(value) ? value[0] : value;
  }

  private stringArrayFilter(filters: Record<string, unknown>, key: string): string[] | undefined {
    const value = filters[key];
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value) ? value : String(value).split(',');
    const parsed = raw.map((item) => String(item).trim()).filter(Boolean);
    return parsed.length ? parsed : undefined;
  }

  private stringFilter(filters: Record<string, unknown>, key: string): string | undefined {
    const value = this.rawFilterValue(filters, key);
    if (value === undefined || value === null || value === '') return undefined;
    return String(value);
  }

  private numberFilter(filters: Record<string, unknown>, key: string): number | undefined {
    const value = this.rawFilterValue(filters, key);
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private booleanFilter(filters: Record<string, unknown>, key: string): boolean | undefined {
    const value = this.rawFilterValue(filters, key);
    if (value === undefined || value === null || value === '') return undefined;
    return value === true || value === 'true' || value === '1';
  }

  private sortDirFilter(filters: Record<string, unknown>): 'asc' | 'desc' | undefined {
    const value = this.stringFilter(filters, 'sortDir');
    return value === 'asc' || value === 'desc' ? value : undefined;
  }

  private partyTypeFilter(filters: Record<string, unknown>): 'CUSTOMER' | 'SUPPLIER' | 'ALL' {
    const value = this.stringFilter(filters, 'partyType');
    return value === 'CUSTOMER' || value === 'SUPPLIER' || value === 'ALL' ? value : 'ALL';
  }

  private financialBucketLabel(bucket: string): string {
    switch (bucket) {
      case 'CURRENT':
        return '0-30';
      case 'DAYS_31_60':
        return '31-60';
      case 'DAYS_61_90':
        return '61-90';
      default:
        return '91+';
    }
  }

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
