// ============================================================================
// PHARMA REPORTS CONTROLLER
// REST API for all pharmaceutical inventory analytics and reporting
// ============================================================================

import {
    Controller,
    Get,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
    ABCAnalysisFilterDto,
    AlertConfigDto,
    DeadSlowFilterDto,
    ExpiryFilterDto,
    InventoryBaseFilterDto,
    ReorderFilterDto,
    StockAgeingFilterDto,
    StockOutFilterDto,
    SuggestedPurchaseFilterDto,
    SupplierPerformanceFilterDto,
    XYZAnalysisFilterDto,
} from './dto';
import {
    DashboardKpiService,
    ExpiryReportsService,
    InventoryAlertsService,
    InventoryReportsService,
    ProcurementReportsService,
    ReportExportService,
    StockAnalysisService,
} from './services';

@ApiTags('Pharma Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pharma-reports')
export class PharmaReportsController {
  constructor(
    private readonly inventoryReports: InventoryReportsService,
    private readonly expiryReports: ExpiryReportsService,
    private readonly stockAnalysis: StockAnalysisService,
    private readonly procurementReports: ProcurementReportsService,
    private readonly dashboardKpi: DashboardKpiService,
    private readonly inventoryAlerts: InventoryAlertsService,
    private readonly reportExport: ReportExportService,
  ) {}

  // =====================================================================
  // MODULE 5: EXECUTIVE DASHBOARD (top-level, before parameterized routes)
  // =====================================================================

  @Get('dashboard/kpis')
  @ApiOperation({ summary: 'Executive dashboard KPIs' })
  @ApiResponse({ status: 200, description: 'KPI summary' })
  async getDashboardKPIs(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.dashboardKpi.getDashboardKPIs(user.tenantId, filters);
  }

  @Get('dashboard/expiry-loss-trend')
  @ApiOperation({ summary: 'Monthly expiry loss trend (12 months)' })
  @ApiResponse({ status: 200, description: 'Expiry loss trend data' })
  async getExpiryLossTrend(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.dashboardKpi.getExpiryLossTrend(user.tenantId, filters);
  }

  @Get('dashboard/inventory-value-trend')
  @ApiOperation({ summary: 'Monthly inventory value trend' })
  @ApiResponse({ status: 200, description: 'Inventory value trend data' })
  async getInventoryValueTrend(@CurrentUser() user: any) {
    return this.dashboardKpi.getInventoryValueTrend(user.tenantId);
  }

  // =====================================================================
  // MODULE 1: INVENTORY & STOCK REPORTS
  // =====================================================================

  @Get('inventory/current-stock')
  @ApiOperation({ summary: 'Real-time current stock by product & location' })
  @ApiResponse({ status: 200, description: 'Paginated current stock data' })
  async getCurrentStock(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.inventoryReports.getCurrentStock(user.tenantId, filters);
  }

  @Get('inventory/batch-wise')
  @ApiOperation({ summary: 'Batch-wise inventory sorted by expiry' })
  @ApiResponse({ status: 200, description: 'Paginated batch inventory' })
  async getBatchInventory(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.inventoryReports.getBatchInventory(user.tenantId, filters);
  }

  @Get('inventory/movement-ledger')
  @ApiOperation({ summary: 'Stock movement ledger (full transaction history)' })
  @ApiResponse({ status: 200, description: 'Paginated movement ledger' })
  async getMovementLedger(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.inventoryReports.getMovementLedger(user.tenantId, filters);
  }

  @Get('inventory/reorder')
  @ApiOperation({ summary: 'Reorder / low stock report with suggested quantities' })
  @ApiResponse({ status: 200, description: 'Reorder report data' })
  async getReorderReport(
    @CurrentUser() user: any,
    @Query() filters: ReorderFilterDto,
  ) {
    return this.inventoryReports.getReorderReport(user.tenantId, filters);
  }

  @Get('inventory/ageing')
  @ApiOperation({ summary: 'Stock ageing analysis with configurable buckets' })
  @ApiResponse({ status: 200, description: 'Ageing data with summary' })
  async getStockAgeing(
    @CurrentUser() user: any,
    @Query() filters: StockAgeingFilterDto,
  ) {
    return this.inventoryReports.getStockAgeing(user.tenantId, filters);
  }

  // =====================================================================
  // MODULE 2: EXPIRY MANAGEMENT
  // =====================================================================

  @Get('expiry/near')
  @ApiOperation({ summary: 'Near-expiry stock with urgency classification' })
  @ApiResponse({ status: 200, description: 'Near-expiry batch data' })
  async getNearExpiry(
    @CurrentUser() user: any,
    @Query() filters: ExpiryFilterDto,
  ) {
    return this.expiryReports.getNearExpiry(user.tenantId, filters);
  }

  @Get('expiry/expired')
  @ApiOperation({ summary: 'Expired stock still in inventory' })
  @ApiResponse({ status: 200, description: 'Expired stock data' })
  async getExpiredStock(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.expiryReports.getExpiredStock(user.tenantId, filters);
  }

  @Get('expiry/fefo')
  @ApiOperation({ summary: 'FEFO picking sequence per product' })
  @ApiResponse({ status: 200, description: 'FEFO sorted batch data' })
  async getFEFOPicking(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.expiryReports.getFEFOPickingSequence(user.tenantId, filters);
  }

  @Get('expiry/risk')
  @ApiOperation({ summary: 'Expiry risk analysis with value at risk' })
  @ApiResponse({ status: 200, description: 'Expiry risk summary with trend' })
  async getExpiryRisk(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.expiryReports.getExpiryRiskAnalysis(user.tenantId, filters);
  }

  // =====================================================================
  // MODULE 3: DEAD / SLOW STOCK ANALYSIS
  // =====================================================================

  @Get('analysis/dead-slow')
  @ApiOperation({ summary: 'Dead & slow stock identification' })
  @ApiResponse({ status: 200, description: 'Dead/slow stock data' })
  async getDeadSlowStock(
    @CurrentUser() user: any,
    @Query() filters: DeadSlowFilterDto,
  ) {
    return this.stockAnalysis.getDeadSlowStock(user.tenantId, filters);
  }

  @Get('analysis/abc')
  @ApiOperation({ summary: 'ABC analysis by consumption value' })
  @ApiResponse({ status: 200, description: 'ABC classified products' })
  async getABCAnalysis(
    @CurrentUser() user: any,
    @Query() filters: ABCAnalysisFilterDto,
  ) {
    return this.stockAnalysis.getABCAnalysis(user.tenantId, filters);
  }

  @Get('analysis/xyz')
  @ApiOperation({ summary: 'XYZ analysis by demand variability' })
  @ApiResponse({ status: 200, description: 'XYZ classified products' })
  async getXYZAnalysis(
    @CurrentUser() user: any,
    @Query() filters: XYZAnalysisFilterDto,
  ) {
    return this.stockAnalysis.getXYZAnalysis(user.tenantId, filters);
  }

  @Get('analysis/turnover')
  @ApiOperation({ summary: 'Inventory turnover ratio per product' })
  @ApiResponse({ status: 200, description: 'Turnover analysis data' })
  async getInventoryTurnover(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.stockAnalysis.getInventoryTurnover(user.tenantId, filters);
  }

  // =====================================================================
  // MODULE 4: PROCUREMENT / ORDERING
  // =====================================================================

  @Get('procurement/suggested-purchase')
  @ApiOperation({ summary: 'Suggested purchase orders based on demand & policy' })
  @ApiResponse({ status: 200, description: 'Suggested purchase data' })
  async getSuggestedPurchase(
    @CurrentUser() user: any,
    @Query() filters: SuggestedPurchaseFilterDto,
  ) {
    return this.procurementReports.getSuggestedPurchase(user.tenantId, filters);
  }

  @Get('procurement/supplier-performance')
  @ApiOperation({ summary: 'Supplier performance metrics' })
  @ApiResponse({ status: 200, description: 'Supplier performance data' })
  async getSupplierPerformance(
    @CurrentUser() user: any,
    @Query() filters: SupplierPerformanceFilterDto,
  ) {
    return this.procurementReports.getSupplierPerformance(user.tenantId, filters);
  }

  @Get('procurement/stockouts')
  @ApiOperation({ summary: 'Stock-out detection and history' })
  @ApiResponse({ status: 200, description: 'Stock-out periods' })
  async getStockOuts(
    @CurrentUser() user: any,
    @Query() filters: StockOutFilterDto,
  ) {
    return this.procurementReports.getStockOuts(user.tenantId, filters);
  }

  // =====================================================================
  // MODULE 6: ALERTS
  // =====================================================================

  @Get('alerts')
  @ApiOperation({ summary: 'Active inventory alerts (expiry, low stock, newly expired)' })
  @ApiResponse({ status: 200, description: 'Sorted alert list' })
  async getActiveAlerts(
    @CurrentUser() user: any,
    @Query() config: AlertConfigDto,
  ) {
    return this.inventoryAlerts.getActiveAlerts(user.tenantId, config);
  }

  // =====================================================================
  // EXPORT — Streaming CSV / XLSX
  // =====================================================================

  @Get('export')
  @ApiOperation({ summary: 'Export report as CSV or XLSX (streaming)' })
  @ApiResponse({ status: 200, description: 'File download' })
  async exportReport(
    @CurrentUser() user: any,
    @Query('report') reportType: string,
    @Query('format') format: 'csv' | 'xlsx' = 'csv',
    @Query() filters: InventoryBaseFilterDto,
    @Res() res: Response,
  ) {
    const result = await this.reportExport.exportReport({
      tenantId: user.tenantId,
      reportType,
      format: format === 'xlsx' ? 'xlsx' : 'csv',
      filters: filters as unknown as Record<string, unknown>,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    result.stream.getStream().pipe(res);
  }
}
