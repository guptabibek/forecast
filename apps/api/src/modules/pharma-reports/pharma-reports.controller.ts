// ============================================================================
// PHARMA REPORTS CONTROLLER
// REST API for all pharmaceutical inventory analytics and reporting
// ============================================================================

import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiQuery,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MargOutstandingService } from '../marg-ede/marg-outstanding.service';
import {
    ABCAnalysisFilterDto,
    AlertConfigDto,
    DeadSlowFilterDto,
    ExpiryFilterDto,
    InventoryBaseFilterDto,
    ReorderFilterDto,
    ReorderPolicyBulkDto,
    ReorderPolicyScopeBulkDto,
    SalesPurchaseAnalysisFilterDto,
    SalesPurchaseComparisonFilterDto,
    StockAgeingFilterDto,
    StockOutFilterDto,
    SuggestedPurchaseFilterDto,
    SupplierPerformanceFilterDto,
    XYZAnalysisFilterDto,
} from './dto';
import {
    AccountingReportsService,
    DashboardKpiService,
    ExpiryReportsService,
    InventoryAlertsService,
    InventoryReportsService,
    ProcurementReportsService,
    ReportExportService,
    SalesPurchaseAnalysisService,
    StockAnalysisService,
    ThreeSixtyReportsService,
} from './services';
import { PdfShareService, type GeneratePdfPayload } from './services/pdf-share.service';

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
    private readonly margOutstanding: MargOutstandingService,
    private readonly threeSixtyReports: ThreeSixtyReportsService,
    private readonly salesPurchaseAnalysis: SalesPurchaseAnalysisService,
    private readonly accountingReports: AccountingReportsService,
    private readonly pdfShare: PdfShareService,
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

  @Get('inventory/reorder-config')
  @ApiOperation({ summary: 'List reorder-policy overrides (min/max/reorder point/lead time) per product×location' })
  @ApiResponse({ status: 200, description: 'Configured reorder policies' })
  async getReorderConfig(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.inventoryReports.getReorderPolicies(user.tenantId, {
      productIds: filters.productIds,
      locationIds: filters.locationIds,
      limit: filters.limit,
      offset: filters.offset,
    });
  }

  @Get('inventory/reorder-config/scopes')
  @ApiOperation({ summary: 'List scoped reorder policies by company, HSN, salt, group, or supplier' })
  @ApiResponse({ status: 200, description: 'Configured scoped reorder policies' })
  async getReorderPolicyScopes(
    @CurrentUser() user: any,
    @Query('scopeType') scopeType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inventoryReports.getReorderPolicyScopes(user.tenantId, {
      scopeType,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('inventory/reorder-config/scope-options')
  @ApiOperation({ summary: 'Search supported reorder policy scope values' })
  @ApiQuery({ name: 'scopeType', required: true, enum: ['PRODUCT_COMPANY', 'HSN_CODE', 'SALT', 'PRODUCT_GROUP', 'SUPPLIER'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Scope value options' })
  async getReorderScopeOptions(
    @CurrentUser() user: any,
    @Query('scopeType') scopeType: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryReports.getReorderScopeOptions(user.tenantId, scopeType, search, limit ? Number(limit) : undefined);
  }

  @Post('inventory/reorder-config/scopes')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Create/update scoped reorder policies in bulk' })
  @ApiResponse({ status: 200, description: 'Upsert result: { upserted, skipped[] }' })
  async upsertReorderPolicyScopes(
    @CurrentUser() user: any,
    @Body() dto: ReorderPolicyScopeBulkDto,
  ) {
    return this.inventoryReports.upsertReorderPolicyScopes(user.tenantId, dto.rows);
  }

  @Delete('inventory/reorder-config/scopes/:id')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Delete one scoped reorder policy' })
  @ApiResponse({ status: 200, description: 'Delete result: { deleted }' })
  async deleteReorderPolicyScope(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.inventoryReports.deleteReorderPolicyScope(user.tenantId, id);
  }

  @Get('inventory/reorder-config/template')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({
    summary: 'Reorder-config template covering every active product × stock location',
    description:
      'Returns one row per product×location that can hold stock (same universe as ' +
      'the reorder report), with any existing override pre-filled. Intended as a ' +
      'download → edit → re-import template so the client can configure all products.',
  })
  @ApiResponse({ status: 200, description: 'Template rows (product/location codes + names + policy fields)' })
  async getReorderConfigTemplate(
    @CurrentUser() user: any,
    @Query() filters: InventoryBaseFilterDto,
  ) {
    return this.inventoryReports.getReorderConfigTemplate(user.tenantId, {
      productIds: filters.productIds,
      locationIds: filters.locationIds,
    });
  }

  @Post('inventory/reorder-config')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({
    summary: 'Create/update reorder-policy overrides (bulk). Accepts a parsed CSV as rows[].',
    description:
      'Each row identifies its product×location by UUID or by code (SKU / location code). ' +
      'Only the fields supplied are written; the rest fall back to the demand-driven ' +
      'computation in the reorder report. Unresolved product/location codes are returned ' +
      'in `skipped` rather than silently dropped.',
  })
  @ApiResponse({ status: 200, description: 'Upsert result: { upserted, skipped[] }' })
  async upsertReorderConfig(
    @CurrentUser() user: any,
    @Body() dto: ReorderPolicyBulkDto,
  ) {
    return this.inventoryReports.upsertReorderPolicies(user.tenantId, dto.rows);
  }

  @Delete('inventory/reorder-config')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({
    summary: 'Delete a reorder-policy override for one product×location',
    description:
      'Removes the stored override so the reorder report falls back to the ' +
      'demand-driven computation for that product×location.',
  })
  @ApiQuery({ name: 'productId', required: true })
  @ApiQuery({ name: 'locationId', required: true })
  @ApiResponse({ status: 200, description: 'Delete result: { deleted }' })
  async deleteReorderConfig(
    @CurrentUser() user: any,
    @Query('productId') productId: string,
    @Query('locationId') locationId: string,
  ) {
    return this.inventoryReports.deleteReorderPolicy(user.tenantId, productId, locationId);
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
  // MODULE 1B: 360 VIEW REPORTS
  // =====================================================================

  @Get('360/search')
  @ApiOperation({ summary: 'Search 360 report entities for dropdown selection' })
  @ApiResponse({ status: 200, description: '360 search options' })
  @ApiQuery({ name: 'type', required: true, enum: ['item', 'customer', 'supplier', 'route', 'city', 'salesman'] })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async search360Options(
    @CurrentUser() user: any,
    @Query('type') type: 'item' | 'customer' | 'supplier' | 'route' | 'city' | 'salesman',
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.threeSixtyReports.searchOptions(user.tenantId, type, search, Number(limit || 25));
  }

  @Get('360/item')
  @ApiOperation({ summary: 'Item 360 report with stock, sales, purchase, PO, expiry, and buyer insights' })
  @ApiResponse({ status: 200, description: 'Item 360 report' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'fy', 'last_fy', 'calendar', 'last12'] })
  @ApiQuery({ name: 'locationId', required: false, type: String })
  async getItem360(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('period') period?: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'fy' | 'last_fy' | 'calendar' | 'last12',
    @Query('locationId') locationId?: string,
  ) {
    return this.threeSixtyReports.getItem360(user.tenantId, search, period, locationId);
  }

  @Get('360/customer')
  @ApiOperation({ summary: 'Customer 360 report with sales, outstanding, ageing, buying pattern, and risk insights' })
  @ApiResponse({ status: 200, description: 'Customer 360 report' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'fy', 'last_fy', 'calendar', 'last12'] })
  @ApiQuery({ name: 'locationId', required: false, type: String })
  async getCustomer360(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('period') period?: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'fy' | 'last_fy' | 'calendar' | 'last12',
    @Query('locationId') locationId?: string,
  ) {
    return this.threeSixtyReports.getCustomer360(user.tenantId, search, period, locationId);
  }

  @Get('360/supplier')
  @ApiOperation({ summary: 'Supplier 360 report with purchase, payable, PO, delivery, and item contribution insights' })
  @ApiResponse({ status: 200, description: 'Supplier 360 report' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'fy', 'last_fy', 'calendar', 'last12'] })
  @ApiQuery({ name: 'locationId', required: false, type: String })
  async getSupplier360(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('period') period?: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'fy' | 'last_fy' | 'calendar' | 'last12',
    @Query('locationId') locationId?: string,
  ) {
    return this.threeSixtyReports.getSupplier360(user.tenantId, search, period, locationId);
  }

  @Get('360/route')
  @ApiOperation({ summary: 'Route 360 report with sales KPIs, trends, top items and customers by route' })
  @ApiResponse({ status: 200, description: 'Route 360 report' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'fy', 'last_fy', 'calendar', 'last12'] })
  async getRoute360(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('period') period?: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'fy' | 'last_fy' | 'calendar' | 'last12',
  ) {
    return this.threeSixtyReports.getRoute360(user.tenantId, search, period);
  }

  @Get('360/city')
  @ApiOperation({ summary: 'City 360 report with sales KPIs, trends, top items and customers by city/area' })
  @ApiResponse({ status: 200, description: 'City 360 report' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'fy', 'last_fy', 'calendar', 'last12'] })
  async getCity360(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('period') period?: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'fy' | 'last_fy' | 'calendar' | 'last12',
  ) {
    return this.threeSixtyReports.getCity360(user.tenantId, search, period);
  }

  @Get('360/salesman')
  @ApiOperation({ summary: 'Sales Team 360 report with sales KPIs, trends, top items and customers by salesman' })
  @ApiResponse({ status: 200, description: 'Sales Team 360 report' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'fy', 'last_fy', 'calendar', 'last12'] })
  async getSalesTeam360(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('period') period?: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'fy' | 'last_fy' | 'calendar' | 'last12',
  ) {
    return this.threeSixtyReports.getSalesTeam360(user.tenantId, search, period);
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
  // MODULE 3B: SALES / PURCHASE ANALYSIS
  // =====================================================================

  @Get('analysis/:kind/overview')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Sales or purchase analysis overview with KPIs, trends, tax and payment summaries' })
  @ApiResponse({ status: 200, description: 'Sales/purchase overview analysis' })
  async getSalesPurchaseOverview(
    @CurrentUser() user: any,
    @Param('kind') kind: 'sales' | 'purchase',
    @Query() filters: SalesPurchaseAnalysisFilterDto,
  ) {
    return this.salesPurchaseAnalysis.getOverview(user.tenantId, this.normalizeAnalysisKind(kind), filters);
  }

  @Get('analysis/:kind/bills')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Paginated sales or purchase bill-wise analysis' })
  @ApiResponse({ status: 200, description: 'Bill-wise analysis rows' })
  async getSalesPurchaseBills(
    @CurrentUser() user: any,
    @Param('kind') kind: 'sales' | 'purchase',
    @Query() filters: SalesPurchaseAnalysisFilterDto,
  ) {
    return this.salesPurchaseAnalysis.getBills(user.tenantId, this.normalizeAnalysisKind(kind), filters);
  }

  @Get('analysis/:kind/bills/:billKey')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Sales or purchase bill drilldown with header and item lines' })
  @ApiResponse({ status: 200, description: 'Bill header and item lines' })
  async getSalesPurchaseBillDrilldown(
    @CurrentUser() user: any,
    @Param('kind') kind: 'sales' | 'purchase',
    @Param('billKey') billKey: string,
  ) {
    return this.salesPurchaseAnalysis.getBillDrilldown(user.tenantId, this.normalizeAnalysisKind(kind), billKey);
  }

  @Get('analysis/:kind/items/:itemKey')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Item analytics drilldown from sales/purchase analysis' })
  @ApiResponse({ status: 200, description: 'Item analytics detail' })
  async getSalesPurchaseItemDrilldown(
    @CurrentUser() user: any,
    @Param('kind') kind: 'sales' | 'purchase',
    @Param('itemKey') itemKey: string,
    @Query() filters: SalesPurchaseAnalysisFilterDto,
  ) {
    return this.salesPurchaseAnalysis.getItemDrilldown(user.tenantId, this.normalizeAnalysisKind(kind), itemKey, filters);
  }

  @Get('analysis/:kind/parties/:partyCode')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Customer or supplier analytics drilldown from sales/purchase analysis' })
  @ApiResponse({ status: 200, description: 'Party analytics detail' })
  async getSalesPurchasePartyDrilldown(
    @CurrentUser() user: any,
    @Param('kind') kind: 'sales' | 'purchase',
    @Param('partyCode') partyCode: string,
    @Query() filters: SalesPurchaseAnalysisFilterDto,
  ) {
    return this.salesPurchaseAnalysis.getPartyDrilldown(user.tenantId, this.normalizeAnalysisKind(kind), partyCode, filters);
  }

  @Get('analysis/:kind/dimension/:dimension')
  @ApiOperation({ summary: 'Top-N analysis grouped by dimension (salesman / salt / company / group / product / hsn / state / city / supplier)' })
  @ApiResponse({ status: 200, description: 'Grouped analytical rollup' })
  async getSalesPurchaseDimension(
    @CurrentUser() user: any,
    @Param('kind') kind: 'sales' | 'purchase',
    @Param('dimension') dimension: string,
    @Query() filters: SalesPurchaseAnalysisFilterDto,
  ) {
    return this.salesPurchaseAnalysis.getDimensionAnalysis(
      user.tenantId,
      this.normalizeAnalysisKind(kind),
      dimension,
      filters,
    );
  }

  @Get('analysis/:kind/comparison')
  @ApiOperation({ summary: 'Period-over-period growth/degrowth comparison for sales or purchase' })
  @ApiResponse({ status: 200, description: 'Comparison summary + optional dimension breakdown' })
  async getSalesPurchaseComparison(
    @CurrentUser() user: any,
    @Param('kind') kind: 'sales' | 'purchase',
    @Query() filters: SalesPurchaseComparisonFilterDto,
  ) {
    return this.salesPurchaseAnalysis.getComparison(
      user.tenantId,
      this.normalizeAnalysisKind(kind),
      filters,
    );
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

  @Get('procurement/supplier-performance/:supplierKey/purchase-orders')
  @ApiOperation({ summary: 'Supplier performance purchase-order drill-down' })
  @ApiResponse({ status: 200, description: 'Purchase orders related to the supplier performance context' })
  async getSupplierPerformancePurchaseOrders(
    @CurrentUser() user: any,
    @Param('supplierKey') supplierKey: string,
    @Query() filters: SupplierPerformanceFilterDto,
  ) {
    return this.procurementReports.getSupplierPerformancePurchaseOrders(user.tenantId, supplierKey, filters);
  }

  @Get('procurement/supplier-performance/:supplierKey/purchase-invoices')
  @ApiOperation({ summary: 'Supplier performance purchase-invoice drill-down' })
  @ApiResponse({ status: 200, description: 'Purchase invoices related to the supplier performance context' })
  async getSupplierPerformancePurchaseInvoices(
    @CurrentUser() user: any,
    @Param('supplierKey') supplierKey: string,
    @Query() filters: SupplierPerformanceFilterDto,
  ) {
    return this.procurementReports.getSupplierPerformancePurchaseInvoices(user.tenantId, supplierKey, filters);
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
  // MODULE 4B: FINANCIAL REPORTS FROM MARG EDE
  // =====================================================================

  @Get('financial/outstanding')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'Outstanding receivables / payables summary by party' })
  @ApiResponse({ status: 200, description: 'Outstanding party summary' })
  @ApiQuery({ name: 'partyType', required: false, enum: ['CUSTOMER', 'SUPPLIER', 'ALL'] })
  @ApiQuery({ name: 'companyId', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'filters', required: false, type: String })
  async getFinancialOutstandingSummary(
    @CurrentUser() user: any,
    @Query('partyType') partyType?: string,
    @Query('companyId') companyId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: string,
    @Query('asOfDate') asOfDate?: string,
    @Query('bucketBoundaries') bucketBoundaries?: string,
    @Query('dsoDays') dsoDays?: string,
  ) {
    const normalizedType = partyType === 'CUSTOMER' || partyType === 'SUPPLIER' || partyType === 'ALL'
      ? partyType
      : 'ALL';

    return this.margOutstanding.getMargOutstandingSummary(user.tenantId, {
      partyType: normalizedType,
      companyId: companyId ? Number(companyId) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      sortBy,
      sortDir: sortDir === 'asc' || sortDir === 'desc' ? sortDir : undefined,
      filters,
      asOfDate: asOfDate || undefined,
      bucketBoundaries: bucketBoundaries || undefined,
      dsoDays: dsoDays != null && dsoDays !== '' ? Number(dsoDays) : undefined,
    });
  }

  @Get('financial/outstanding-groups')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'Outstanding rolled up by Marg account group (e.g., debtors / creditors)' })
  @ApiResponse({ status: 200, description: 'Group rollup with per-bucket totals' })
  @ApiQuery({ name: 'partyType', required: false, enum: ['CUSTOMER', 'SUPPLIER', 'ALL'] })
  @ApiQuery({ name: 'companyId', required: false, type: Number })
  @ApiQuery({ name: 'asOfDate', required: false, type: String })
  @ApiQuery({ name: 'bucketBoundaries', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'filters', required: false, type: String })
  async getFinancialOutstandingGroups(
    @CurrentUser() user: any,
    @Query('partyType') partyType?: string,
    @Query('companyId') companyId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: string,
    @Query('asOfDate') asOfDate?: string,
    @Query('bucketBoundaries') bucketBoundaries?: string,
  ) {
    const normalizedType = partyType === 'CUSTOMER' || partyType === 'SUPPLIER' || partyType === 'ALL'
      ? partyType
      : 'ALL';

    return this.margOutstanding.getMargOutstandingByGroup(user.tenantId, {
      partyType: normalizedType,
      companyId: companyId ? Number(companyId) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      sortBy,
      sortDir: sortDir === 'asc' || sortDir === 'desc' ? sortDir : undefined,
      filters,
      asOfDate: asOfDate || undefined,
      bucketBoundaries: bucketBoundaries || undefined,
    });
  }

  @Get('financial/outstanding/:partyCode')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'Outstanding invoice detail for a single Marg party' })
  @ApiResponse({ status: 200, description: 'Outstanding party invoice detail' })
  @ApiQuery({ name: 'companyId', required: false, type: Number })
  @ApiQuery({ name: 'includeSettled', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'filters', required: false, type: String })
  async getFinancialOutstandingDetail(
    @CurrentUser() user: any,
    @Param('partyCode') partyCode: string,
    @Query('companyId') companyId?: string,
    @Query('includeSettled') includeSettled?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: string,
    @Query('asOfDate') asOfDate?: string,
    @Query('bucketBoundaries') bucketBoundaries?: string,
    @Query('bucketIndex') bucketIndex?: string,
  ) {
    return this.margOutstanding.getMargOutstandingDetail(user.tenantId, partyCode, {
      companyId: companyId ? Number(companyId) : undefined,
      includeSettled: includeSettled === 'true' || includeSettled === '1',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      sortBy,
      sortDir: sortDir === 'asc' || sortDir === 'desc' ? sortDir : undefined,
      filters,
      asOfDate: asOfDate || undefined,
      bucketBoundaries: bucketBoundaries || undefined,
      bucketIndex: bucketIndex != null && bucketIndex !== '' ? Number(bucketIndex) : undefined,
    });
  }

  @Get('financial/ledger/:partyCode')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'Tally-style Marg party ledger' })
  @ApiResponse({ status: 200, description: 'Party ledger with opening, transactions, and closing balance' })
  @ApiQuery({ name: 'companyId', required: false, type: Number })
  @ApiQuery({ name: 'fromDate', required: false, type: String })
  @ApiQuery({ name: 'toDate', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'filters', required: false, type: String })
  async getFinancialPartyLedger(
    @CurrentUser() user: any,
    @Param('partyCode') partyCode: string,
    @Query('companyId') companyId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: string,
  ) {
    return this.margOutstanding.getMargPartyLedger(user.tenantId, partyCode, {
      companyId: companyId ? Number(companyId) : undefined,
      fromDate,
      toDate,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      sortBy,
      sortDir: sortDir === 'asc' || sortDir === 'desc' ? sortDir : undefined,
      filters,
    });
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
    @Query() filters: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const result = await this.reportExport.exportReport({
      tenantId: user.tenantId,
      reportType,
      format: format === 'xlsx' ? 'xlsx' : 'csv',
      filters,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    result.stream.getStream().pipe(res);
  }

  private normalizeAnalysisKind(kind: string): 'sales' | 'purchase' {
    return kind === 'purchase' ? 'purchase' : 'sales';
  }

  // =====================================================================
  // ACCOUNTING REPORTS (Trial Balance + Account Ledger drill-through)
  // Visible to ADMIN/FINANCE/PLANNER/SUPER_ADMIN; sidebar gates further by role.
  // =====================================================================

  @Get('accounting/trial-balance')
  @Roles('ADMIN', 'FINANCE', 'PLANNER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Trial balance with opening/period/closing per active GL account' })
  async getTrialBalance(
    @CurrentUser() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountType') accountType?: string,
    @Query('showZero') showZero?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('filters') filters?: string,
  ) {
    return this.accountingReports.getTrialBalance(user.tenantId, {
      startDate,
      endDate,
      accountType,
      showZero: showZero === 'true',
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      sortBy,
      sortDir,
      filters,
    });
  }

  @Get('accounting/trial-balance/:accountId/ledger')
  @Roles('ADMIN', 'FINANCE', 'PLANNER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Account-scoped journal activity with running balance (drill-through)' })
  async getAccountLedger(
    @CurrentUser() user: any,
    @Param('accountId') accountId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('filters') filters?: string,
  ) {
    return this.accountingReports.getAccountLedger(user.tenantId, accountId, {
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      sortBy,
      sortDir,
      filters,
    });
  }

  // =====================================================================
  // PDF SHARE — Generate, save, and serve tenant-scoped PDFs
  // =====================================================================

  @Post('share-pdf')
  @ApiOperation({ summary: 'Generate PDF from report data and return a shareable link' })
  @ApiResponse({ status: 201, description: 'PDF generated and shareable link returned' })
  async generateSharePdf(
    @CurrentUser() user: any,
    @Body() payload: GeneratePdfPayload,
    @Req() req: Request,
  ) {
    const origin = (req.headers as any).origin
      || (req.headers as any).referer?.replace(/\/[^/]*$/, '')
      || `${(req as any).protocol}://${(req.headers as any).host}`;
    return this.pdfShare.generateAndSave(user.tenantId, {
      ...payload,
      tenantName: user.tenantName || undefined,
      generatedBy: user.email || user.name || undefined,
    }, origin);
  }

  @Post('share-report-pdf')
  @ApiOperation({ summary: 'Generate PDF from a full report and return a shareable link' })
  @ApiResponse({ status: 201, description: 'Report PDF generated with download link' })
  async generateReportSharePdf(
    @CurrentUser() user: any,
    @Body() body: { reportType: string; filters?: Record<string, unknown> },
    @Req() req: Request,
  ) {
    const origin = (req.headers as any).origin
      || (req.headers as any).referer?.replace(/\/[^/]*$/, '')
      || `${(req as any).protocol}://${(req.headers as any).host}`;
    return this.pdfShare.generateReportPdf(user.tenantId, body.reportType, body.filters || {}, {
      tenantName: user.tenantName || undefined,
      generatedBy: user.email || user.name || undefined,
    }, origin);
  }

  @Post('export-pdf')
  @ApiOperation({ summary: 'Generate PDF from visible report data and return as direct download' })
  @ApiResponse({ status: 200, description: 'PDF file returned as binary stream' })
  async exportPdf(
    @CurrentUser() user: any,
    @Body() payload: GeneratePdfPayload,
    @Res() res: Response,
  ) {
    const result = await this.pdfShare.generatePdfDownload(user.tenantId, {
      ...payload,
      tenantName: user.tenantName || undefined,
      generatedBy: user.email || user.name || undefined,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Content-Length', result.buffer.length.toString());
    res.end(result.buffer);
  }

}
