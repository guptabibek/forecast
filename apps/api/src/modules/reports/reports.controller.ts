import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiResponse,
    ApiTags
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
    ABCAnalysisDto,
    DashboardFilterDto,
    ExportReportDto,
    GenerateReportDto,
    SaveReportDto,
    ScheduleReportDto,
} from './dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // =====================
  // Dashboard Endpoints (MUST be before :id routes)
  // =====================

  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard stats retrieved' })
  async getDashboardStats(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getDashboardStats(user.tenantId, filters);
  }

  @Get('dashboard/forecast-trend')
  @ApiOperation({ summary: 'Get forecast vs actual trend for dashboard' })
  @ApiResponse({ status: 200, description: 'Forecast trend data retrieved' })
  async getDashboardForecastTrend(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getForecastTrend(user.tenantId, filters.periods || 12, filters);
  }

  @Get('dashboard/model-accuracy')
  @ApiOperation({ summary: 'Get model accuracy comparison for dashboard' })
  @ApiResponse({ status: 200, description: 'Model accuracy data retrieved' })
  async getDashboardModelAccuracy(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getModelAccuracyComparison(user.tenantId, filters);
  }

  @Get('dashboard/activity')
  @ApiOperation({ summary: 'Get recent activity for dashboard' })
  @ApiResponse({ status: 200, description: 'Recent activity retrieved' })
  async getDashboardActivity(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getRecentActivity(user.tenantId, filters.limit || 10);
  }

  @Get('dashboard/revenue')
  @ApiOperation({ summary: 'Get revenue metrics for dashboard' })
  @ApiResponse({ status: 200, description: 'Revenue metrics retrieved' })
  async getDashboardRevenue(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getRevenueMetrics(user.tenantId, filters);
  }

  @Get('dashboard/top-products')
  @ApiOperation({ summary: 'Get top performing products' })
  @ApiResponse({ status: 200, description: 'Top products retrieved' })
  async getDashboardTopProducts(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getTopProducts(user.tenantId, filters.limit || 5, filters);
  }

  @Get('dashboard/regional')
  @ApiOperation({ summary: 'Get regional breakdown' })
  @ApiResponse({ status: 200, description: 'Regional breakdown retrieved' })
  async getDashboardRegional(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getRegionalBreakdown(user.tenantId, filters);
  }

  @Get('dashboard/variance-alerts')
  @ApiOperation({ summary: 'Get variance alerts' })
  @ApiResponse({ status: 200, description: 'Variance alerts retrieved' })
  async getDashboardVarianceAlerts(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getVarianceAlerts(user.tenantId, filters);
  }

  @Get('dashboard/forecast-health')
  @ApiOperation({ summary: 'Get forecast health metrics' })
  @ApiResponse({ status: 200, description: 'Forecast health metrics retrieved' })
  async getDashboardForecastHealth(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getForecastHealthMetrics(user.tenantId, filters);
  }

  @Get('dashboard/monthly-trend')
  @ApiOperation({ summary: 'Get trend comparison with flexible period' })
  @ApiResponse({ status: 200, description: 'Trend data retrieved' })
  async getDashboardMonthlyTrend(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getTrendComparison(user.tenantId, {
      granularity: (filters.granularity as 'daily' | 'weekly' | 'monthly' | 'quarterly') || 'monthly',
      periods: filters.periods || 6,
      startDate: filters.startDate,
      endDate: filters.endDate,
    }, filters);
  }

  @Get('dashboard/demand-supply')
  @ApiOperation({ summary: 'Get demand vs supply analysis' })
  @ApiResponse({ status: 200, description: 'Demand supply data retrieved' })
  async getDemandSupply(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getDemandSupplyAnalysis(user.tenantId, filters.periods || 6, filters);
  }

  @Get('dashboard/inventory-metrics')
  @ApiOperation({ summary: 'Get inventory metrics' })
  @ApiResponse({ status: 200, description: 'Inventory metrics retrieved' })
  async getInventoryMetrics(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getInventoryMetrics(user.tenantId, filters);
  }

  @Get('dashboard/forecast-bias')
  @ApiOperation({ summary: 'Get forecast bias analysis' })
  @ApiResponse({ status: 200, description: 'Forecast bias data retrieved' })
  async getForecastBias(
    @CurrentUser() user: any,
    @Query() filters: DashboardFilterDto,
  ) {
    return this.reportsService.getForecastBiasAnalysis(user.tenantId, filters);
  }

  @Get('dashboard/abc-analysis')
  @ApiOperation({ summary: 'Get ABC/XYZ analysis for products with mode and threshold support' })
  @ApiResponse({ status: 200, description: 'ABC analysis retrieved' })
  async getABCAnalysis(
    @CurrentUser() user: any,
    @Query() filters: ABCAnalysisDto,
  ) {
    return this.reportsService.getABCAnalysis(user.tenantId, filters);
  }

  // =====================
  // Standard Reports (before :id routes)
  // =====================

  @Get('summary')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Get summary dashboard report' })
  @ApiResponse({ status: 200, description: 'Summary report retrieved' })
  async getSummaryReport(@CurrentUser() user: any) {
    return this.reportsService.generateSummaryReport(user.tenantId);
  }

  // =====================
  // Reports List Endpoint
  // =====================

  @Get()
  @ApiOperation({ summary: 'Get all saved reports' })
  @ApiResponse({ status: 200, description: 'List of saved reports' })
  async getReports(@CurrentUser() user: any) {
    return this.reportsService.getReports(user.tenantId);
  }

  @Post()
  @Roles('ADMIN', 'PLANNER', 'FINANCE')
  @ApiOperation({ summary: 'Create a new report' })
  @ApiResponse({ status: 201, description: 'Report created' })
  async createReport(
    @CurrentUser() user: any,
    @Body() dto: SaveReportDto,
  ) {
    return this.reportsService.createReport(user.tenantId, dto, user);
  }

  // =====================
  // Reports with :id (MUST be AFTER specific routes)
  // =====================

  @Get(':id')
  @ApiOperation({ summary: 'Get a report by ID' })
  @ApiResponse({ status: 200, description: 'Report retrieved' })
  async getReport(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.reportsService.getReportById(user.tenantId, id);
  }

  @Get(':id/data')
  @ApiOperation({ summary: 'Get report data by ID' })
  @ApiResponse({ status: 200, description: 'Report data retrieved' })
  async getReportData(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.reportsService.getReportData(user.tenantId, id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PLANNER', 'FINANCE')
  @ApiOperation({ summary: 'Update a report' })
  @ApiResponse({ status: 200, description: 'Report updated' })
  async updateReport(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SaveReportDto,
  ) {
    return this.reportsService.updateReport(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PLANNER', 'FINANCE')
  @ApiOperation({ summary: 'Delete a report' })
  @ApiResponse({ status: 200, description: 'Report deleted' })
  async deleteReport(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.reportsService.deleteReport(user.tenantId, id);
  }

  // =====================
  // POST Report Operations
  // =====================

  @Post('variance')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Generate variance report' })
  @ApiResponse({ status: 200, description: 'Variance report generated' })
  async generateVarianceReport(
    @CurrentUser() user: any,
    @Body() dto: GenerateReportDto,
  ) {
    return this.reportsService.generateVarianceReport(user.tenantId, dto);
  }

  @Post('trend')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Generate trend report' })
  @ApiResponse({ status: 200, description: 'Trend report generated' })
  async generateTrendReport(
    @CurrentUser() user: any,
    @Body() dto: GenerateReportDto,
  ) {
    // Delegates to dimension report with trend-specific formatting
    return this.reportsService.generateDimensionReport(user.tenantId, { ...dto, type: 'trend' } as any);
  }

  @Post('comparison')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Generate comparison report' })
  @ApiResponse({ status: 200, description: 'Comparison report generated' })
  async generateComparisonReport(
    @CurrentUser() user: any,
    @Body() dto: GenerateReportDto,
  ) {
    return this.reportsService.generateDimensionReport(user.tenantId, { ...dto, type: 'comparison' } as any);
  }

  @Post('accuracy')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Generate accuracy report' })
  @ApiResponse({ status: 200, description: 'Accuracy report generated' })
  async generateAccuracyReport(
    @CurrentUser() user: any,
    @Body() dto: GenerateReportDto,
  ) {
    return this.reportsService.generateDimensionReport(user.tenantId, { ...dto, type: 'accuracy' } as any);
  }

  @Post('dimension')
  @Roles('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER')
  @ApiOperation({ summary: 'Generate dimension analysis report' })
  @ApiResponse({ status: 200, description: 'Dimension report generated' })
  async generateDimensionReport(
    @CurrentUser() user: any,
    @Body() dto: GenerateReportDto,
  ) {
    return this.reportsService.generateDimensionReport(user.tenantId, dto);
  }

  @Post('save')
  @Roles('ADMIN', 'PLANNER', 'FINANCE')
  @ApiOperation({ summary: 'Save a report configuration' })
  @ApiResponse({ status: 201, description: 'Report saved' })
  async saveReport(
    @CurrentUser() user: any,
    @Body() dto: SaveReportDto,
  ) {
    return this.reportsService.saveReport(dto, user);
  }

  @Post('export')
  @Roles('ADMIN', 'PLANNER', 'FINANCE')
  @ApiOperation({ summary: 'Export report to file' })
  @ApiResponse({ status: 200, description: 'Report exported' })
  async exportReport(
    @CurrentUser() user: any,
    @Body() dto: ExportReportDto,
  ) {
    return this.reportsService.exportReport(dto, user);
  }

  @Post('schedule')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Schedule a report' })
  @ApiResponse({ status: 201, description: 'Report scheduled' })
  async scheduleReport(
    @CurrentUser() user: any,
    @Body() dto: ScheduleReportDto,
  ) {
    return this.reportsService.scheduleReport(dto, user);
  }
}
