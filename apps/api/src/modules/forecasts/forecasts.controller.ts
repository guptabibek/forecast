import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AutoSelectPrimaryForecastDto, SetPrimaryForecastDto } from './dto/accuracy-metrics.dto';
import { ApproveOverrideDto } from './dto/approve-override.dto';
import { CreateForecastDto } from './dto/create-forecast.dto';
import { CreateOverrideDto } from './dto/create-override.dto';
import { ForecastQueryDto } from './dto/forecast-query.dto';
import { GenerateForecastDto } from './dto/generate-forecast.dto';
import { ReconcileForecastDto } from './dto/reconcile-forecast.dto';
import { RunForecastDto } from './dto/run-forecast.dto';
import { SnapshotForecastDto } from './dto/snapshot-forecast.dto';
import { ForecastsService } from './forecasts.service';

@ApiTags('Forecasts')
@ApiBearerAuth()
@Controller('forecasts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ForecastsController {
  constructor(private readonly forecastsService: ForecastsService) {}

  // ============================================================================
  // STATIC ROUTES — must come BEFORE parameterized :id routes to avoid shadowing
  // ============================================================================

  @Get('models')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get available forecast models' })
  async getModels() {
    return this.forecastsService.getAvailableModels();
  }

  @Get('models/explainability')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get detailed model explainability information' })
  async getModelExplainability() {
    return this.forecastsService.getModelExplainability();
  }

  @Get('compare')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Compare multiple forecasts' })
  @ApiQuery({ name: 'ids', required: true, description: 'Comma-separated forecast run IDs (max 10)' })
  async compare(
    @Query('ids') ids: string,
    @CurrentUser() user: any,
  ) {
    if (!ids || !ids.trim()) {
      throw new BadRequestException('ids query parameter is required');
    }
    const forecastIds = ids.split(',').map(id => id.trim()).filter(Boolean);
    if (forecastIds.length === 0 || forecastIds.length > 10) {
      throw new BadRequestException('Provide between 1 and 10 forecast IDs');
    }
    return this.forecastsService.compare(forecastIds, user);
  }

  @Get('compare-versions')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Compare multiple forecast run versions' })
  @ApiQuery({ name: 'runIds', required: true, description: 'Comma-separated forecast run IDs (max 10)' })
  async compareVersions(
    @Query('runIds') runIds: string,
    @CurrentUser() user: any,
  ) {
    if (!runIds || !runIds.trim()) {
      throw new BadRequestException('runIds query parameter is required');
    }
    const ids = runIds.split(',').map(id => id.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 10) {
      throw new BadRequestException('Provide between 1 and 10 run IDs');
    }
    return this.forecastsService.compareVersions(ids, user);
  }

  @Get('dashboard-summary')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get forecast dashboard summary across all plans' })
  async getDashboardSummary(@CurrentUser() user: any) {
    return this.forecastsService.getForecastDashboardSummary(user);
  }

  // ============================================================================
  // POST ROUTES (no shadowing risk)
  // ============================================================================

  @Post('generate')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Generate forecasts dynamically from historical data' })
  async generate(
    @Body() generateDto: GenerateForecastDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.generateForecasts(generateDto, user);
  }

  @Post()
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Create and queue a new forecast' })
  async create(
    @Body() createForecastDto: CreateForecastDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.create(createForecastDto, user);
  }

  @Post('overrides')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Request a forecast override (audit-safe)' })
  async requestOverride(
    @Body() dto: CreateOverrideDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.requestOverride(dto, user);
  }

  @Post('overrides/:id/approve')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Approve a forecast override' })
  async approveOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveOverrideDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.approveOverride(id, dto.notes, user);
  }

  @Post('overrides/:id/reject')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Reject a forecast override' })
  async rejectOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveOverrideDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.rejectOverride(id, dto.notes, user);
  }

  @Post('reconcile')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Reconcile actuals vs forecast run' })
  async reconcile(
    @Body() dto: ReconcileForecastDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.reconcileForecastRun(
      dto.forecastRunId,
      dto.thresholdPct ?? 5,
      user,
    );
  }

  @Post('reconciliations/:id/approve')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Approve a reconciliation variance' })
  async approveReconciliation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveOverrideDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.approveReconciliation(id, dto.notes, user);
  }

  @Post('reconciliations/:id/reject')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Reject a reconciliation variance' })
  async rejectReconciliation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveOverrideDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.rejectReconciliation(id, dto.notes, user);
  }

  @Post('primary')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Set primary forecast model for a plan/scenario' })
  async setPrimaryForecast(
    @Body() dto: SetPrimaryForecastDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.setPrimaryForecast(
      dto.planVersionId,
      dto.scenarioId,
      dto.modelName,
      user,
    );
  }

  @Post('primary/auto')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Auto-select and set primary model via backtest' })
  async autoSelectPrimaryForecast(
    @Body() dto: AutoSelectPrimaryForecastDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.autoSelectPrimaryForecast(
      dto.planVersionId,
      dto.scenarioId,
      dto.holdoutPeriods ?? 6,
      dto.models,
      user,
    );
  }

  @Post('snapshot')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Snapshot/freeze current forecast for a plan/scenario' })
  async snapshotForecast(
    @Body() dto: SnapshotForecastDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.snapshotForecast(dto.planVersionId, dto.scenarioId, dto.label, user);
  }

  // ============================================================================
  // PARAMETERIZED GET ROUTES with sub-paths (before :id)
  // ============================================================================

  @Get()
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get all forecasts' })
  async findAll(@Query() query: ForecastQueryDto, @CurrentUser() user: any) {
    return this.forecastsService.findAll(query, user);
  }

  @Get('data/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get forecast data for a plan version and scenario' })
  async getForecastData(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.getForecastData(planVersionId, scenarioId, startDate, endDate, user);
  }

  @Get('plan-version/:planVersionId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get all forecasts for a plan version' })
  async getByPlanVersion(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.getByPlanVersion(planVersionId, user);
  }

  @Get('accuracy/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get forecast accuracy metrics' })
  async getAccuracy(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.getAccuracyMetrics(planVersionId, scenarioId, user);
  }

  @Get('chart-data/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get aggregated chart data for all models' })
  async getChartData(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.getAggregatedChartData(planVersionId, scenarioId, user);
  }

  @Get('accuracy-detailed/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get enhanced accuracy metrics with per-model breakdown' })
  async getEnhancedAccuracy(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.getEnhancedAccuracyMetrics(planVersionId, scenarioId, user);
  }

  @Get('backtest/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Run backtesting on historical data' })
  @ApiQuery({ name: 'holdoutPeriods', required: false, description: 'Number of holdout periods (default: 6, max: 36)' })
  @ApiQuery({ name: 'models', required: false, description: 'Comma-separated list of models to test' })
  async runBacktest(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Query('holdoutPeriods') holdoutPeriods?: string,
    @Query('models') models?: string,
    @CurrentUser() user?: any,
  ) {
    const parsedHoldout = holdoutPeriods ? parseInt(holdoutPeriods, 10) : 6;
    if (isNaN(parsedHoldout) || parsedHoldout < 1 || parsedHoldout > 36) {
      throw new BadRequestException('holdoutPeriods must be between 1 and 36');
    }
    const modelList = models ? models.split(',').map(m => m.trim()).filter(Boolean) : null;
    return this.forecastsService.runBacktest(
      planVersionId,
      scenarioId,
      parsedHoldout,
      modelList,
      user,
    );
  }

  @Get('primary/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get primary forecast model selection' })
  async getPrimaryForecast(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.getPrimaryForecast(planVersionId, scenarioId, user);
  }

  @Get('actuals-chart/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get historical actuals for chart overlay' })
  async getActualsForChart(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.getActualsForChart(planVersionId, scenarioId, user);
  }

  @Get('export/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Export forecast data as CSV or JSON' })
  @ApiQuery({ name: 'format', required: false, description: 'Export format: csv or json (default: csv)' })
  async exportForecasts(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Query('format') format: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const fmt = format === 'json' ? 'json' : 'csv';
    const result = await this.forecastsService.exportForecasts(planVersionId, scenarioId, fmt, user);

    if (fmt === 'csv' && 'csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="forecast-export-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(result.csv);
      return;
    }

    res.json(result);
  }

  @Get('versions/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get all forecast run versions for a plan/scenario' })
  async getForecastVersions(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.getForecastVersions(planVersionId, scenarioId, user);
  }

  @Get('alerts/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get accuracy degradation alerts' })
  @ApiQuery({ name: 'threshold', required: false, description: 'MAPE threshold percentage (default: 25, max: 100)' })
  async getAccuracyAlerts(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Query('threshold') threshold: string,
    @CurrentUser() user: any,
  ) {
    const parsedThreshold = threshold ? parseFloat(threshold) : 25;
    if (isNaN(parsedThreshold) || parsedThreshold < 0 || parsedThreshold > 100) {
      throw new BadRequestException('threshold must be between 0 and 100');
    }
    return this.forecastsService.getAccuracyAlerts(
      planVersionId,
      scenarioId,
      parsedThreshold,
      user,
    );
  }

  @Get('dimensions/:planVersionId/:scenarioId')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get forecast breakdown by dimension (product/location/customer)' })
  @ApiQuery({ name: 'type', required: false, description: 'Dimension type: product, location, customer (default: product)' })
  async getDimensionBreakdown(
    @Param('planVersionId', ParseUUIDPipe) planVersionId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Query('type') dimensionType: string,
    @CurrentUser() user: any,
  ) {
    const validDimensions = ['product', 'location', 'customer'];
    const dim = dimensionType || 'product';
    if (!validDimensions.includes(dim)) {
      throw new BadRequestException(`Invalid dimension type. Must be one of: ${validDimensions.join(', ')}`);
    }
    return this.forecastsService.getDimensionBreakdown(planVersionId, scenarioId, dim, user);
  }

  // ============================================================================
  // PARAMETERIZED :id ROUTES — must come LAST
  // ============================================================================

  @Get(':id')
  @Roles('ADMIN', 'PLANNER', 'VIEWER')
  @ApiOperation({ summary: 'Get a forecast by ID' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.findOne(id, user);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Update a forecast' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: Partial<CreateForecastDto>,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.update(id, updateDto, user);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Delete a forecast' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.remove(id, user);
  }

  @Post(':id/run')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Run/re-run a forecast run' })
  async run(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() runDto: RunForecastDto,
    @CurrentUser() user: any,
  ) {
    return this.forecastsService.runForecast(id, runDto, user);
  }
}
