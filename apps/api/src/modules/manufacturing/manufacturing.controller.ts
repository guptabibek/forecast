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
    Put,
    Query,
    Request,
    UseGuards
} from '@nestjs/common';
import { BOMStatus, PlannedOrderStatus, PlannedOrderType, RiskLevel, SOPForecastSource, SOPStatus, WorkCenterType } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
    AddBomComponentDto,
    AddWorkflowStepDto,
    AdjustInventoryDto,
    AllocateLandedCostDto,
    BatchCostRollUpDto,
    BulkLinkSupplierProductsDto,
    BulkUpdatePlannedOrdersDto,
    BulkUpsertPromotionLiftFactorsDto,
    BulkUpsertSOPForecastsDto,
    CalculateEOQDto,
    CalculateWorkingDaysDto,
    CompleteOperationDto,
    ConvertNPIToProductDto,
    CopyBomDto,
    CopyPromotionDto,
    CopySOPForecastsDto,
    CostRollUpDto,
    CreateBatchDto,
    CreateBomDto,
    CreateBomFromApiDto,
    CreateCapacityDto,
    CreateCapacityPlanBucketDto,
    CreateCapacityPlanDto,
    CreateCAPADto,
    CreateCostProfileDto,
    CreateDowntimeReasonDto,
    CreateDowntimeRecordDto,
    CreateFiscalCalendarDto,
    CreateFiscalPeriodDto,
    CreateForecastAccuracyMetricDto,
    CreateGLAccountDto,
    CreateGoodsReceiptDto,
    CreateInspectionPlanDto,
    CreateInventoryPolicyDto,
    CreateInventoryTransactionDto,
    CreateJournalEntryDto,
    CreateLocationHierarchyDto,
    CreateMRPRunDto,
    CreateNPIDto,
    CreatePlannedOrderDto,
    CreatePostingProfileDto,
    CreateProductCategoryDto,
    CreateProductCostingDto,
    CreateProductionLineDto,
    CreateProductionLineStationDto,
    CreatePromotionDto,
    CreatePurchaseContractDto,
    CreatePurchaseContractLineDto,
    CreatePurchaseOrderDto,
    CreateQualityInspectionDto,
    CreateScrapReasonDto,
    CreateShiftDto,
    CreateSOPAssumptionDto,
    CreateSOPCycleDto,
    CreateSOPCycleV2Dto,
    CreateSOPGapAnalysisDto,
    CreateSupplierDto,
    CreateUomConversionDto,
    CreateUomDto,
    CreateWorkCenterDto,
    CreateWorkflowTemplateDto,
    CreateWorkOrderDto,
    GenerateFiscalPeriodsV2Dto,
    GenerateNPIForecastDto,
    GetBatchesQueryDto,
    GetCAPAsQueryDto,
    GetCostComparisonReportQueryDto,
    GetCostingEngineCostLayersQueryDto,
    GetCostingEngineRevaluationHistoryQueryDto,
    GetCostingEngineVariancesQueryDto,
    GetCostProfilesQueryDto,
    GetInspectionPlansQueryDto,
    GetInventoryHoldsQueryDto,
    GetInventoryLedgerQueryDto,
    GetInventoryReservationsQueryDto,
    GetJournalEntriesQueryDto,
    GetNCRsQueryDto,
    GetPlannedCOGSQueryDto,
    GetTrialBalanceQueryDto,
    GetWorkOrderCostsQueryDto,
    ImportSOPStatisticalDto,
    IssueMaterialDto,
    LinkSupplierProductDto,
    PeriodActionDto,
    ReconcileInventoryDto,
    RecordLaborDto,
    ReleaseInventoryHoldDto,
    ReopenPeriodDto,
    ReportProductionCompletionDto,
    RevalueInventoryDto,
    ReverseTransactionDto,
    RollupStandardCostDto,
    RunABCClassificationDto,
    RunXYZClassificationDto,
    ScenarioCostComparisonDto,
    SetNPIAnalogDto,
    SimulateLoadBalancingDto,
    StartWorkflowDto,
    TransferInventoryDto,
    UpdateBatchDto,
    UpdateBomComponentDto,
    UpdateBomDto,
    UpdateCapacityDto,
    UpdateCapacityPlanBucketDto,
    UpdateCapacityPlanDto,
    UpdateCAPAStatusDto,
    UpdateDowntimeReasonDto,
    UpdateDowntimeRecordDto,
    UpdateFiscalCalendarDto,
    UpdateFiscalPeriodDto,
    UpdateForecastAccuracyMetricDto,
    UpdateGLAccountDto,
    UpdateLocationHierarchyDto,
    UpdateNCRStatusDto,
    UpdateNPIDto,
    UpdatePlannedOrderDto,
    UpdateProductCategoryDto,
    UpdateProductCostingDto,
    UpdateProductionLineDto,
    UpdatePromotionDto,
    UpdatePurchaseContractDto,
    UpdatePurchaseContractLineDto,
    UpdatePurchaseOrderDto,
    UpdateQualityInspectionDto,
    UpdateQualityInspectionStatusDto,
    UpdateScrapReasonDto,
    UpdateShiftDto,
    UpdateSOPAssumptionDto,
    UpdateSOPCycleDto,
    UpdateSOPGapAnalysisDto,
    UpdateSupplierDto,
    UpdateSupplierProductDto,
    UpdateUomConversionDto,
    UpdateUomDto,
    UpdateWorkCenterDto,
    UpdateWorkflowStepDto,
    UpdateWorkflowTemplateDto,
    UpsertInventoryLevelDto,
    UpsertInventoryPolicyDto,
    UpsertPromotionLiftFactorDto,
    UpsertSOPForecastDto,
} from './dto';
import { ManufacturingService } from './manufacturing.service';
import { AccountingService } from './services/accounting.service';
import { CostingEngineService } from './services/costing-engine.service';
import { CostingService } from './services/costing.service';
import { InventoryLedgerService } from './services/inventory-ledger.service';
import { QualityService } from './services/quality.service';

@Controller({ path: 'manufacturing', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ManufacturingController {
  constructor(
    private readonly manufacturingService: ManufacturingService,
    private readonly inventoryLedger: InventoryLedgerService,
    private readonly accounting: AccountingService,
    private readonly quality: QualityService,
    private readonly costing: CostingService,
    private readonly costingEngine: CostingEngineService,
    private readonly prisma: PrismaService,
  ) {}

  // ============================================================================
  // Dashboard
  // ============================================================================

  @Get('dashboard')
  async getDashboard(@Request() req: any) {
    return this.manufacturingService.getDashboardMetrics(req.user.tenantId);
  }

  // ============================================================================
  // BOM Endpoints
  // ============================================================================

  @Get('boms')
  async getBOMs(
    @Request() req: any,
    @Query('status') status?: BOMStatus,
    @Query('productId') productId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getBOMs(req.user.tenantId, {
      status,
      productId,
      search,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('boms/:id')
  async getBOM(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getBOM(req.user.tenantId, id);
  }

  @Get('boms/:id/explode')
  async explodeBOM(
    @Request() req: any,
    @Param('id') id: string,
    @Query('levels') levels?: string,
  ) {
    return this.manufacturingService.explodeBOM(
      req.user.tenantId,
      id,
      levels ? parseInt(levels) : undefined,
    );
  }

  @Post('boms')
  @Roles('ADMIN', 'PLANNER')
  async createBOM(@Request() req: any, @Body() dto: CreateBomDto) {
    return this.manufacturingService.createBOM(req.user.tenantId, dto);
  }

  @Put('boms/:id/status')
  @Roles('ADMIN', 'PLANNER')
  async updateBOMStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body('status') status: BOMStatus,
  ) {
    return this.manufacturingService.updateBOMStatus(req.user.tenantId, id, status);
  }

  // ============================================================================
  // Work Center Endpoints
  // ============================================================================

  @Get('work-centers')
  async getWorkCenters(
    @Request() req: any,
    @Query('type') type?: WorkCenterType,
    @Query('isActive') isActive?: string,
    @Query('locationId') locationId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getWorkCenters(req.user.tenantId, {
      type,
      isActive: isActive ? isActive === 'true' : undefined,
      locationId,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Post('work-centers')
  @Roles('ADMIN')
  async createWorkCenter(@Request() req: any, @Body() dto: CreateWorkCenterDto) {
    return this.manufacturingService.createWorkCenter(req.user.tenantId, dto);
  }

  // ============================================================================
  // Inventory Policy Endpoints
  // ============================================================================

  @Get('inventory-policies')
  async getInventoryPolicies(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getInventoryPolicies(req.user.tenantId, {
      productId,
      locationId,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Post('inventory-policies')
  @Roles('ADMIN', 'PLANNER')
  async createInventoryPolicy(@Request() req: any, @Body() dto: CreateInventoryPolicyDto) {
    return this.manufacturingService.createInventoryPolicy(req.user.tenantId, dto);
  }

  // ============================================================================
  // Planned Order Endpoints
  // ============================================================================

  @Get('planned-orders')
  async getPlannedOrders(
    @Request() req: any,
    @Query('status') status?: PlannedOrderStatus,
    @Query('orderType') orderType?: PlannedOrderType,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getPlannedOrders(req.user.tenantId, {
      status,
      orderType,
      productId,
      locationId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Put('planned-orders/:id/firm')
  @Roles('ADMIN', 'PLANNER')
  async firmPlannedOrder(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.firmPlannedOrder(req.user.tenantId, id);
  }

  @Put('planned-orders/:id/release')
  @Roles('ADMIN', 'PLANNER')
  async releasePlannedOrder(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.releasePlannedOrder(req.user.tenantId, id);
  }

  // ============================================================================
  // Fiscal Calendar Endpoints
  // ============================================================================

  @Get('fiscal-calendars')
  async getFiscalCalendars(@Request() req: any) {
    return this.manufacturingService.getFiscalCalendars(req.user.tenantId);
  }

  @Post('fiscal-calendars')
  @Roles('ADMIN')
  async createFiscalCalendar(@Request() req: any, @Body() dto: CreateFiscalCalendarDto) {
    return this.manufacturingService.createFiscalCalendar(req.user.tenantId, dto);
  }

  // ============================================================================
  // S&OP Endpoints
  // ============================================================================

  @Get('sop-cycles')
  async getSOPCycles(
    @Request() req: any,
    @Query('year') year?: string,
    @Query('status') status?: SOPStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getSOPCycles(req.user.tenantId, {
      year: year ? parseInt(year) : undefined,
      status,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Post('sop-cycles')
  @Roles('ADMIN', 'PLANNER')
  async createSOPCycle(@Request() req: any, @Body() dto: CreateSOPCycleDto) {
    return this.manufacturingService.createSOPCycle(
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  @Put('sop-cycles/:id/status')
  @Roles('ADMIN', 'PLANNER')
  async updateSOPCycleStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body('status') status: SOPStatus,
  ) {
    return this.manufacturingService.updateSOPCycleStatus(req.user.tenantId, id, status);
  }

  // ============================================================================
  // BOM API Compatibility (singular path + components)
  // ============================================================================

  @Get('bom')
  async getBOMsV2(
    @Request() req: any,
    @Query('status') status?: BOMStatus,
    @Query('productId') productId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getBOMs(req.user.tenantId, {
      status,
      productId,
      search,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('bom/:id')
  async getBOMV2(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getBOM(req.user.tenantId, id);
  }

  @Post('bom')
  @Roles('ADMIN', 'PLANNER')
  async createBOMV2(@Request() req: any, @Body() dto: CreateBomFromApiDto) {
    return this.manufacturingService.createBOMFromApi(req.user.tenantId, dto);
  }

  @Put('bom/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateBOMV2(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateBomDto) {
    return this.manufacturingService.updateBOM(req.user.tenantId, id, dto);
  }

  @Delete('bom/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteBOMV2(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteBOM(req.user.tenantId, id);
  }

  @Put('bom/:id/status')
  @Roles('ADMIN', 'PLANNER')
  async updateBOMStatusV2(
    @Request() req: any,
    @Param('id') id: string,
    @Body('status') status: BOMStatus,
  ) {
    return this.manufacturingService.updateBOMStatus(req.user.tenantId, id, status);
  }

  @Post('bom/:id/components')
  @Roles('ADMIN', 'PLANNER')
  async addBOMComponent(@Request() req: any, @Param('id') id: string, @Body() dto: AddBomComponentDto) {
    return this.manufacturingService.addBOMComponent(req.user.tenantId, id, dto);
  }

  @Put('bom/components/:componentId')
  @Roles('ADMIN', 'PLANNER')
  async updateBOMComponent(
    @Request() req: any,
    @Param('componentId') componentId: string,
    @Body() dto: UpdateBomComponentDto,
  ) {
    return this.manufacturingService.updateBOMComponent(req.user.tenantId, componentId, dto);
  }

  @Delete('bom/components/:componentId')
  @Roles('ADMIN', 'PLANNER')
  async deleteBOMComponent(@Request() req: any, @Param('componentId') componentId: string) {
    return this.manufacturingService.deleteBOMComponent(req.user.tenantId, componentId);
  }

  @Post('bom/:id/explode')
  async explodeBOMV2(
    @Request() req: any,
    @Param('id') id: string,
    @Body('levels') levels?: number,
  ) {
    return this.manufacturingService.explodeBOM(req.user.tenantId, id, levels);
  }

  @Post('bom/:id/cost-rollup')
  @Roles('ADMIN', 'PLANNER')
  async rollupCost(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.rollupCost(req.user.tenantId, id, req.user.id);
  }

  @Get('bom/where-used/:productId')
  async getWhereUsed(@Request() req: any, @Param('productId') productId: string) {
    return this.manufacturingService.getWhereUsed(req.user.tenantId, productId);
  }

  @Post('bom/:id/copy')
  @Roles('ADMIN', 'PLANNER')
  async copyBOM(@Request() req: any, @Param('id') id: string, @Body() dto: CopyBomDto) {
    return this.manufacturingService.copyBOM(req.user.tenantId, id, dto);
  }

  @Get('bom/compare/:bomId1/:bomId2')
  async compareBOMs(
    @Request() req: any,
    @Param('bomId1') bomId1: string,
    @Param('bomId2') bomId2: string,
  ) {
    return this.manufacturingService.compareBOMs(req.user.tenantId, bomId1, bomId2);
  }

  // ============================================================================
  // Capacity Planning Endpoints
  // ============================================================================

  @Get('capacity/work-centers')
  async getWorkCentersV2(
    @Request() req: any,
    @Query('type') type?: WorkCenterType,
    @Query('isActive') isActive?: string,
    @Query('locationId') locationId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getWorkCenters(req.user.tenantId, {
      type,
      isActive: isActive ? isActive === 'true' : undefined,
      locationId,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('capacity/work-centers/:id')
  async getWorkCenterV2(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getWorkCenter(req.user.tenantId, id);
  }

  @Post('capacity/work-centers')
  @Roles('ADMIN')
  async createWorkCenterV2(@Request() req: any, @Body() dto: CreateWorkCenterDto) {
    return this.manufacturingService.createWorkCenter(req.user.tenantId, dto);
  }

  @Put('capacity/work-centers/:id')
  @Roles('ADMIN')
  async updateWorkCenterV2(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateWorkCenterDto) {
    return this.manufacturingService.updateWorkCenter(req.user.tenantId, id, dto);
  }

  @Put('capacity/work-centers/:id/toggle-status')
  @Roles('ADMIN')
  async toggleWorkCenterStatus(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.toggleWorkCenterStatus(req.user.tenantId, id);
  }

  @Delete('capacity/work-centers/:id')
  @Roles('ADMIN')
  async deleteWorkCenterV2(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteWorkCenter(req.user.tenantId, id);
  }

  @Get('capacity/work-centers/:id/capacities')
  async getCapacities(
    @Request() req: any,
    @Param('id') id: string,
    @Query('effectiveDate') effectiveDate?: string,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.manufacturingService.getCapacities(req.user.tenantId, id, {
      effectiveDate,
      includeExpired: includeExpired ? includeExpired === 'true' : undefined,
    });
  }

  @Get('capacity/work-centers/:id/capacities/current')
  async getCurrentCapacity(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getCurrentCapacity(req.user.tenantId, id);
  }

  @Post('capacity/work-centers/:id/capacities')
  @Roles('ADMIN')
  async createCapacity(@Request() req: any, @Param('id') id: string, @Body() dto: CreateCapacityDto) {
    return this.manufacturingService.createCapacity(req.user.tenantId, id, dto);
  }

  @Put('capacity/capacities/:capacityId')
  @Roles('ADMIN')
  async updateCapacity(@Request() req: any, @Param('capacityId') capacityId: string, @Body() dto: UpdateCapacityDto) {
    return this.manufacturingService.updateCapacity(req.user.tenantId, capacityId, dto);
  }

  @Delete('capacity/capacities/:capacityId')
  @Roles('ADMIN')
  async deleteCapacity(@Request() req: any, @Param('capacityId') capacityId: string) {
    return this.manufacturingService.deleteCapacity(req.user.tenantId, capacityId);
  }

  @Get('capacity/work-centers/:id/shifts')
  async getShifts(
    @Request() req: any,
    @Param('id') id: string,
    @Query('effectiveDate') effectiveDate?: string,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.manufacturingService.getShifts(req.user.tenantId, id, {
      effectiveDate,
      includeExpired: includeExpired ? includeExpired === 'true' : undefined,
    });
  }

  @Post('capacity/work-centers/:id/shifts')
  @Roles('ADMIN')
  async createShift(@Request() req: any, @Param('id') id: string, @Body() dto: CreateShiftDto) {
    return this.manufacturingService.createShift(req.user.tenantId, id, dto);
  }

  @Put('capacity/shifts/:shiftId')
  @Roles('ADMIN')
  async updateShift(@Request() req: any, @Param('shiftId') shiftId: string, @Body() dto: UpdateShiftDto) {
    return this.manufacturingService.updateShift(req.user.tenantId, shiftId, dto);
  }

  @Delete('capacity/shifts/:shiftId')
  @Roles('ADMIN')
  async deleteShift(@Request() req: any, @Param('shiftId') shiftId: string) {
    return this.manufacturingService.deleteShift(req.user.tenantId, shiftId);
  }

  @Get('capacity/utilization')
  async getCapacityUtilization(
    @Request() req: any,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.manufacturingService.getCapacityUtilization(req.user.tenantId, {
      startDate,
      endDate,
      granularity,
    });
  }

  @Get('capacity/work-centers/:id/utilization')
  async getWorkCenterUtilization(
    @Request() req: any,
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.manufacturingService.getCapacityUtilization(req.user.tenantId, {
      workCenterIds: [id],
      startDate,
      endDate,
      granularity,
    });
  }

  @Get('capacity/bottlenecks')
  async getCapacityBottlenecks(
    @Request() req: any,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('threshold') threshold?: string,
  ) {
    return this.manufacturingService.getCapacityBottlenecks(req.user.tenantId, {
      startDate,
      endDate,
      threshold: threshold ? parseFloat(threshold) : undefined,
    });
  }

  @Post('capacity/simulate-load-balancing')
  @Roles('ADMIN', 'PLANNER')
  async simulateLoadBalancing(@Request() req: any, @Body() dto: SimulateLoadBalancingDto) {
    return this.manufacturingService.simulateLoadBalancing(req.user.tenantId, dto);
  }

  @Get('capacity/work-centers/:id/plan')
  async getCapacityPlan(
    @Request() req: any,
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.manufacturingService.getCapacityPlan(req.user.tenantId, id, {
      startDate,
      endDate,
      granularity,
    });
  }

  @Get('capacity/aggregate-plan')
  async getAggregateCapacityPlan(
    @Request() req: any,
    @Query('workCenterIds') workCenterIds?: string,
    @Query('locationId') locationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.manufacturingService.getAggregateCapacityPlan(req.user.tenantId, {
      workCenterIds: workCenterIds ? workCenterIds.split(',').map(id => id.trim()) : undefined,
      locationId,
      startDate,
      endDate,
      granularity,
    });
  }

  // ============================================================================
  // Inventory Planning Endpoints
  // ============================================================================

  @Get('inventory/policies')
  async getInventoryPoliciesV2(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('abcClass') abcClass?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getInventoryPoliciesV2(req.user.tenantId, {
      productId,
      locationId,
      abcClass,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('inventory/policies/:productId/:locationId')
  async getInventoryPolicy(
    @Request() req: any,
    @Param('productId') productId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.manufacturingService.getInventoryPolicy(req.user.tenantId, productId, locationId);
  }

  @Post('inventory/policies')
  @Roles('ADMIN', 'PLANNER')
  async upsertInventoryPolicy(@Request() req: any, @Body() dto: UpsertInventoryPolicyDto) {
    return this.manufacturingService.upsertInventoryPolicy(req.user.tenantId, dto);
  }

  @Delete('inventory/policies/:productId/:locationId')
  @Roles('ADMIN', 'PLANNER')
  async deleteInventoryPolicy(
    @Request() req: any,
    @Param('productId') productId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.manufacturingService.deleteInventoryPolicy(req.user.tenantId, productId, locationId);
  }

  @Get('inventory/levels')
  async getInventoryLevels(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('belowSafetyStock') belowSafetyStock?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getInventoryLevels(req.user.tenantId, {
      productId,
      locationId,
      belowSafetyStock: belowSafetyStock ? belowSafetyStock === 'true' : undefined,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('inventory/levels/:productId/:locationId')
  async getInventoryLevel(
    @Request() req: any,
    @Param('productId') productId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.manufacturingService.getInventoryLevel(req.user.tenantId, productId, locationId);
  }

  @Post('inventory/levels')
  @Roles('ADMIN', 'PLANNER')
  async upsertInventoryLevel(@Request() req: any, @Body() dto: UpsertInventoryLevelDto) {
    return this.manufacturingService.upsertInventoryLevel(req.user.tenantId, dto);
  }

  @Get('inventory/calculate/safety-stock/:productId/:locationId')
  async calculateSafetyStock(
    @Request() req: any,
    @Param('productId') productId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.manufacturingService.calculateSafetyStock(req.user.tenantId, productId, locationId);
  }

  @Get('inventory/calculate/reorder-point/:productId/:locationId')
  async calculateReorderPoint(
    @Request() req: any,
    @Param('productId') productId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.manufacturingService.calculateReorderPoint(req.user.tenantId, productId, locationId);
  }

  @Post('inventory/calculate/eoq/:productId/:locationId')
  async calculateEOQ(
    @Request() req: any,
    @Param('productId') productId: string,
    @Param('locationId') locationId: string,
    @Body() dto: CalculateEOQDto,
  ) {
    return this.manufacturingService.calculateEOQ(req.user.tenantId, productId, locationId, dto);
  }

  @Post('inventory/classification/abc')
  @Roles('ADMIN', 'PLANNER')
  async runABCClassification(@Request() req: any, @Body() dto: RunABCClassificationDto) {
    return this.manufacturingService.runABCClassification(req.user.tenantId, dto);
  }

  @Post('inventory/classification/xyz')
  @Roles('ADMIN', 'PLANNER')
  async runXYZClassification(@Request() req: any, @Body() dto: RunXYZClassificationDto) {
    return this.manufacturingService.runXYZClassification(req.user.tenantId, dto);
  }

  @Get('inventory/summary')
  async getInventorySummary(@Request() req: any, @Query('locationId') locationId?: string) {
    return this.manufacturingService.getInventorySummary(req.user.tenantId, locationId);
  }

  @Get('inventory/turnover')
  async getInventoryTurnover(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.manufacturingService.getInventoryTurnover(req.user.tenantId, {
      productId,
      locationId,
      startDate,
      endDate,
    });
  }

  // ============================================================================
  // MRP Endpoints
  // ============================================================================

  @Get('mrp/runs')
  async getMRPRuns(
    @Request() req: any,
    @Query('runType') runType?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getMRPRuns(req.user.tenantId, {
      runType,
      status,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('mrp/runs/:id')
  async getMRPRun(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.getMRPRun(req.user.tenantId, id);
  }

  @Post('mrp/runs')
  @Roles('ADMIN', 'PLANNER')
  async createMRPRun(@Request() req: any, @Body() dto: CreateMRPRunDto) {
    return this.manufacturingService.createMRPRun(req.user.tenantId, dto);
  }

  @Post('mrp/runs/:id/execute')
  @Roles('ADMIN', 'PLANNER')
  async executeMRPRun(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.executeMRPRun(req.user.tenantId, id, req.user.id);
  }

  @Get('mrp/runs/:id/requirements')
  async getMRPRequirements(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.manufacturingService.getMRPRequirements(req.user.tenantId, id, {
      productId,
      locationId,
      startDate,
      endDate,
    });
  }

  @Get('mrp/planned-orders')
  async getPlannedOrdersV2(
    @Request() req: any,
    @Query('status') status?: PlannedOrderStatus,
    @Query('orderType') orderType?: PlannedOrderType,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('dueDateStart') dueDateStart?: string,
    @Query('dueDateEnd') dueDateEnd?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getPlannedOrders(req.user.tenantId, {
      status,
      orderType,
      productId,
      locationId,
      startDate: dueDateStart ? new Date(dueDateStart) : undefined,
      endDate: dueDateEnd ? new Date(dueDateEnd) : undefined,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('mrp/planned-orders/:id')
  async getPlannedOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.getPlannedOrder(req.user.tenantId, id);
  }

  @Put('mrp/planned-orders/:id')
  @Roles('ADMIN', 'PLANNER')
  async updatePlannedOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlannedOrderDto) {
    return this.manufacturingService.updatePlannedOrder(req.user.tenantId, id, dto);
  }

  @Post('mrp/planned-orders/:id/firm')
  @Roles('ADMIN', 'PLANNER')
  async firmPlannedOrderV2(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.firmPlannedOrder(req.user.tenantId, id);
  }

  @Post('mrp/planned-orders/:id/release')
  @Roles('ADMIN', 'PLANNER')
  async releasePlannedOrderV2(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.releasePlannedOrder(req.user.tenantId, id);
  }

  @Post('mrp/planned-orders')
  @Roles('ADMIN', 'PLANNER')
  async createPlannedOrder(@Request() req: any, @Body() dto: CreatePlannedOrderDto) {
    return this.manufacturingService.createPlannedOrder(req.user.tenantId, dto);
  }

  @Post('mrp/planned-orders/:id/cancel')
  @Roles('ADMIN', 'PLANNER')
  async cancelPlannedOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    return this.manufacturingService.cancelPlannedOrder(req.user.tenantId, id, reason);
  }

  @Post('mrp/planned-orders/bulk')
  @Roles('ADMIN', 'PLANNER')
  async bulkUpdatePlannedOrders(@Request() req: any, @Body() dto: BulkUpdatePlannedOrdersDto) {
    return this.manufacturingService.bulkUpdatePlannedOrders(req.user.tenantId, dto);
  }

  @Get('mrp/exceptions')
  async getMRPExceptions(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('exceptionType') exceptionType?: string,
    @Query('severity') severity?: string,
    @Query('productId') productId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getMRPExceptions(req.user.tenantId, {
      status,
      exceptionType,
      severity,
      productId,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Post('mrp/exceptions/:id/acknowledge')
  @Roles('ADMIN', 'PLANNER')
  async acknowledgeMRPException(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.acknowledgeMRPException(req.user.tenantId, id, req.user.id);
  }

  @Post('mrp/exceptions/:id/resolve')
  @Roles('ADMIN', 'PLANNER')
  async resolveMRPException(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('resolution') resolution?: string) {
    return this.manufacturingService.resolveMRPException(req.user.tenantId, id, req.user.id, resolution);
  }

  @Post('mrp/exceptions/:id/ignore')
  @Roles('ADMIN', 'PLANNER')
  async ignoreMRPException(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    return this.manufacturingService.ignoreMRPException(req.user.tenantId, id, req.user.id, reason);
  }

  @Get('mrp/summary')
  async getMRPSummary(@Request() req: any) {
    return this.manufacturingService.getMRPSummary(req.user.tenantId);
  }

  // ============================================================================
  // Supplier Endpoints
  // ============================================================================

  @Get('suppliers')
  async getSuppliers(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('isPreferred') isPreferred?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getSuppliers(req.user.tenantId, {
      search,
      isActive: isActive ? isActive === 'true' : undefined,
      isPreferred: isPreferred ? isPreferred === 'true' : undefined,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('suppliers/summary')
  async getSupplierSummary(@Request() req: any) {
    return this.manufacturingService.getSupplierSummary(req.user.tenantId);
  }

  @Get('suppliers/:id')
  async getSupplier(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.getSupplier(req.user.tenantId, id);
  }

  @Post('suppliers')
  @Roles('ADMIN', 'PLANNER')
  async createSupplier(@Request() req: any, @Body() dto: CreateSupplierDto) {
    return this.manufacturingService.createSupplier(req.user.tenantId, dto);
  }

  @Put('suppliers/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateSupplier(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.manufacturingService.updateSupplier(req.user.tenantId, id, dto);
  }

  @Delete('suppliers/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteSupplier(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.deleteSupplier(req.user.tenantId, id);
  }

  @Get('suppliers/:id/products')
  async getSupplierProducts(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('search') search?: string,
    @Query('supplyType') supplyType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getSupplierProducts(req.user.tenantId, id, {
      search,
      supplyType,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('suppliers/products/:productId/suppliers')
  async getProductSuppliers(@Request() req: any, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.manufacturingService.getProductSuppliers(req.user.tenantId, productId);
  }

  @Get('suppliers/products/:productId/compare')
  async compareSuppliers(@Request() req: any, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.manufacturingService.compareSuppliers(req.user.tenantId, productId);
  }

  @Post('suppliers/:id/products')
  @Roles('ADMIN', 'PLANNER')
  async linkSupplierProduct(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkSupplierProductDto) {
    return this.manufacturingService.linkSupplierProduct(req.user.tenantId, id, dto);
  }

  @Post('suppliers/:id/products/bulk')
  @Roles('ADMIN', 'PLANNER')
  async bulkLinkSupplierProducts(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BulkLinkSupplierProductsDto) {
    return this.manufacturingService.bulkLinkSupplierProducts(req.user.tenantId, id, dto);
  }

  @Put('suppliers/:id/products/:productId')
  @Roles('ADMIN', 'PLANNER')
  async updateSupplierProduct(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateSupplierProductDto,
  ) {
    return this.manufacturingService.updateSupplierProduct(req.user.tenantId, id, productId, dto);
  }

  @Delete('suppliers/:id/products/:productId')
  @Roles('ADMIN', 'PLANNER')
  async unlinkSupplierProduct(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.manufacturingService.unlinkSupplierProduct(req.user.tenantId, id, productId);
  }

  @Put('suppliers/:id/products/:productId/set-primary')
  @Roles('ADMIN', 'PLANNER')
  async setPrimarySupplier(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.manufacturingService.setPrimarySupplier(req.user.tenantId, id, productId);
  }

  @Get('suppliers/:id/performance')
  async getSupplierPerformance(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.manufacturingService.getSupplierPerformance(req.user.tenantId, id, { startDate, endDate });
  }

  // ============================================================================
  // Promotions Endpoints
  // ============================================================================

  @Get('promotions')
  async getPromotions(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('startDateFrom') startDateFrom?: string,
    @Query('startDateTo') startDateTo?: string,
    @Query('endDateFrom') endDateFrom?: string,
    @Query('endDateTo') endDateTo?: string,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getPromotions(req.user.tenantId, {
      status,
      type,
      startDateFrom,
      startDateTo,
      endDateFrom,
      endDateTo,
      productId,
      locationId,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('promotions/active')
  async getActivePromotions(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.manufacturingService.getActivePromotions(req.user.tenantId, { productId, locationId });
  }

  @Get('promotions/upcoming')
  async getUpcomingPromotions(
    @Request() req: any,
    @Query('days') days?: string,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.manufacturingService.getUpcomingPromotions(req.user.tenantId, {
      days: days ? parseInt(days) : undefined,
      productId,
      locationId,
    });
  }

  @Get('promotions/adjusted-forecast')
  async getPromotionAdjustedForecast(
    @Request() req: any,
    @Query('productId') productId: string,
    @Query('locationId') locationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('includePromotions') includePromotions?: string,
  ) {
    return this.manufacturingService.getPromotionAdjustedForecast(req.user.tenantId, {
      productId,
      locationId,
      startDate,
      endDate,
      includePromotions: includePromotions ? includePromotions === 'true' : undefined,
    });
  }

  @Get('promotions/calendar')
  async getPromotionCalendar(
    @Request() req: any,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.manufacturingService.getPromotionCalendar(req.user.tenantId, {
      startDate,
      endDate,
      productId,
      locationId,
      type,
      status,
    });
  }

  @Get('promotions/:id')
  async getPromotion(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getPromotion(req.user.tenantId, id);
  }

  @Post('promotions')
  @Roles('ADMIN', 'PLANNER')
  async createPromotion(@Request() req: any, @Body() dto: CreatePromotionDto) {
    return this.manufacturingService.createPromotion(req.user.tenantId, dto);
  }

  @Put('promotions/:id')
  @Roles('ADMIN', 'PLANNER')
  async updatePromotion(@Request() req: any, @Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.manufacturingService.updatePromotion(req.user.tenantId, id, dto);
  }

  @Put('promotions/:id/status')
  @Roles('ADMIN', 'PLANNER')
  async updatePromotionStatus(@Request() req: any, @Param('id') id: string, @Body('status') status: string) {
    return this.manufacturingService.updatePromotionStatus(req.user.tenantId, id, status);
  }

  @Delete('promotions/:id')
  @Roles('ADMIN', 'PLANNER')
  async deletePromotion(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deletePromotion(req.user.tenantId, id);
  }

  @Get('promotions/:id/lift-factors')
  async getPromotionLiftFactors(
    @Request() req: any,
    @Param('id') id: string,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.manufacturingService.getPromotionLiftFactors(req.user.tenantId, id, { productId, locationId });
  }

  @Post('promotions/:id/lift-factors')
  @Roles('ADMIN', 'PLANNER')
  async upsertPromotionLiftFactor(@Request() req: any, @Param('id') id: string, @Body() dto: UpsertPromotionLiftFactorDto) {
    return this.manufacturingService.upsertPromotionLiftFactor(req.user.tenantId, id, dto);
  }

  @Post('promotions/:id/lift-factors/bulk')
  @Roles('ADMIN', 'PLANNER')
  async bulkUpsertPromotionLiftFactors(@Request() req: any, @Param('id') id: string, @Body() dto: BulkUpsertPromotionLiftFactorsDto) {
    return this.manufacturingService.bulkUpsertPromotionLiftFactors(req.user.tenantId, id, dto);
  }

  @Delete('promotions/lift-factors/:id')
  @Roles('ADMIN', 'PLANNER')
  async deletePromotionLiftFactor(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deletePromotionLiftFactor(req.user.tenantId, id);
  }

  @Get('promotions/:id/impact')
  async getPromotionImpact(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getPromotionImpact(req.user.tenantId, id);
  }

  @Post('promotions/:id/copy')
  @Roles('ADMIN', 'PLANNER')
  async copyPromotion(@Request() req: any, @Param('id') id: string, @Body() dto: CopyPromotionDto) {
    return this.manufacturingService.copyPromotion(req.user.tenantId, id, dto);
  }

  // ============================================================================
  // NPI Endpoints
  // ============================================================================

  @Get('npi')
  async getNPIs(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('launchDateFrom') launchDateFrom?: string,
    @Query('launchDateTo') launchDateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getNPIs(req.user.tenantId, {
      status,
      category,
      brand,
      launchDateFrom,
      launchDateTo,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('npi/:id')
  async getNPI(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getNPI(req.user.tenantId, id);
  }

  @Post('npi')
  @Roles('ADMIN', 'PLANNER')
  async createNPI(@Request() req: any, @Body() dto: CreateNPIDto) {
    return this.manufacturingService.createNPI(req.user.tenantId, dto);
  }

  @Put('npi/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateNPI(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateNPIDto) {
    return this.manufacturingService.updateNPI(req.user.tenantId, id, dto);
  }

  @Put('npi/:id/status')
  @Roles('ADMIN', 'PLANNER')
  async updateNPIStatus(@Request() req: any, @Param('id') id: string, @Body('status') status: string) {
    return this.manufacturingService.updateNPIStatus(req.user.tenantId, id, status);
  }

  @Delete('npi/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteNPI(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteNPI(req.user.tenantId, id);
  }

  @Post('npi/:id/generate-forecast')
  @Roles('ADMIN', 'PLANNER')
  async generateNPIForecast(@Request() req: any, @Param('id') id: string, @Body() dto: GenerateNPIForecastDto) {
    return this.manufacturingService.generateNPIForecast(req.user.tenantId, id, dto);
  }

  @Get('npi/:id/analogs')
  async findNPIAnalogs(
    @Request() req: any,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('categoryOnly') categoryOnly?: string,
    @Query('brandOnly') brandOnly?: string,
    @Query('minActualsMonths') minActualsMonths?: string,
  ) {
    return this.manufacturingService.findNPIAnalogs(req.user.tenantId, id, {
      limit: limit ? parseInt(limit) : undefined,
      categoryOnly: categoryOnly ? categoryOnly === 'true' : undefined,
      brandOnly: brandOnly ? brandOnly === 'true' : undefined,
      minActualsMonths: minActualsMonths ? parseInt(minActualsMonths) : undefined,
    });
  }

  @Put('npi/:id/analog')
  @Roles('ADMIN', 'PLANNER')
  async setNPIAnalog(@Request() req: any, @Param('id') id: string, @Body() dto: SetNPIAnalogDto) {
    return this.manufacturingService.setNPIAnalog(req.user.tenantId, id, dto);
  }

  @Get('npi/:id/performance')
  async getNPIPerformance(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getNPIPerformance(req.user.tenantId, id);
  }

  @Post('npi/compare-performance')
  async compareNPIPerformance(@Request() req: any, @Body('npiIds') npiIds: string[]) {
    return this.manufacturingService.compareNPIPerformance(req.user.tenantId, npiIds || []);
  }

  @Post('npi/:id/convert-to-product')
  @Roles('ADMIN', 'PLANNER')
  async convertNPIToProduct(@Request() req: any, @Param('id') id: string, @Body() dto: ConvertNPIToProductDto) {
    return this.manufacturingService.convertNPIToProduct(req.user.tenantId, id, dto);
  }

  // ============================================================================
  // Workflow & Approvals Endpoints
  // ============================================================================

  @Get('workflows/templates')
  async getWorkflowTemplates(
    @Request() req: any,
    @Query('entityType') entityType?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getWorkflowTemplates(req.user.tenantId, {
      entityType,
      isActive: isActive ? isActive === 'true' : undefined,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('workflows/templates/:id')
  async getWorkflowTemplate(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.getWorkflowTemplate(req.user.tenantId, id);
  }

  @Post('workflows/templates')
  @Roles('ADMIN')
  async createWorkflowTemplate(@Request() req: any, @Body() dto: CreateWorkflowTemplateDto) {
    return this.manufacturingService.createWorkflowTemplate(req.user.tenantId, dto);
  }

  @Put('workflows/templates/:id')
  @Roles('ADMIN')
  async updateWorkflowTemplate(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkflowTemplateDto) {
    return this.manufacturingService.updateWorkflowTemplate(req.user.tenantId, id, dto);
  }

  @Delete('workflows/templates/:id')
  @Roles('ADMIN')
  async deleteWorkflowTemplate(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.deleteWorkflowTemplate(req.user.tenantId, id);
  }

  @Post('workflows/templates/:id/steps')
  @Roles('ADMIN')
  async addWorkflowStep(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddWorkflowStepDto) {
    return this.manufacturingService.addWorkflowStep(req.user.tenantId, id, dto);
  }

  @Put('workflows/steps/:id')
  @Roles('ADMIN')
  async updateWorkflowStep(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkflowStepDto) {
    return this.manufacturingService.updateWorkflowStep(req.user.tenantId, id, dto);
  }

  @Delete('workflows/steps/:id')
  @Roles('ADMIN')
  async deleteWorkflowStep(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.deleteWorkflowStep(req.user.tenantId, id);
  }

  @Get('workflows/instances')
  async getWorkflowInstances(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('requestedById') requestedById?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getWorkflowInstances(req.user.tenantId, {
      status,
      entityType,
      requestedById,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('workflows/instances/my-pending')
  async getMyPendingApprovals(@Request() req: any) {
    return this.manufacturingService.getMyPendingApprovals(req.user.tenantId, req.user.id);
  }

  @Get('workflows/instances/:id')
  async getWorkflowInstance(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.getWorkflowInstance(req.user.tenantId, id);
  }

  @Post('workflows/instances')
  @Roles('ADMIN', 'PLANNER')
  async startWorkflow(@Request() req: any, @Body() dto: StartWorkflowDto) {
    return this.manufacturingService.startWorkflow(req.user.tenantId, req.user.id, dto);
  }

  @Post('workflows/instances/:id/approve')
  @Roles('ADMIN', 'PLANNER')
  async approveWorkflow(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('comments') comments?: string) {
    return this.manufacturingService.approveWorkflow(req.user.tenantId, id, req.user.id, comments);
  }

  @Post('workflows/instances/:id/reject')
  @Roles('ADMIN', 'PLANNER')
  async rejectWorkflow(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('comments') comments?: string) {
    return this.manufacturingService.rejectWorkflow(req.user.tenantId, id, req.user.id, comments);
  }

  @Post('workflows/instances/:id/request-changes')
  @Roles('ADMIN', 'PLANNER')
  async requestWorkflowChanges(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('comments') comments?: string,
  ) {
    return this.manufacturingService.requestWorkflowChanges(req.user.tenantId, id, req.user.id, comments);
  }

  @Post('workflows/instances/:id/cancel')
  @Roles('ADMIN', 'PLANNER')
  async cancelWorkflow(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    return this.manufacturingService.cancelWorkflow(req.user.tenantId, id, req.user.id, reason);
  }

  @Post('workflows/instances/:id/resubmit')
  @Roles('ADMIN', 'PLANNER')
  async resubmitWorkflow(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('notes') notes?: string) {
    return this.manufacturingService.resubmitWorkflow(req.user.tenantId, id, req.user.id, notes);
  }

  @Get('workflows/metrics')
  async getWorkflowMetrics(
    @Request() req: any,
    @Query('entityType') entityType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.manufacturingService.getWorkflowMetrics(req.user.tenantId, { entityType, startDate, endDate });
  }

  @Get('workflows/approver-workload')
  async getApproverWorkload(@Request() req: any) {
    return this.manufacturingService.getApproverWorkload(req.user.tenantId);
  }

  // ============================================================================
  // S&OP Endpoints (v2 paths)
  // ============================================================================

  @Get('sop/cycles')
  async getSOPCyclesV2(
    @Request() req: any,
    @Query('status') status?: SOPStatus,
    @Query('year') year?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getSOPCycles(req.user.tenantId, {
      status,
      year: year ? parseInt(year) : undefined,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('sop/cycles/:id')
  async getSOPCycle(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getSOPCycle(req.user.tenantId, id);
  }

  @Get('sop/cycles/:id/summary')
  async getSOPCycleSummary(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getSOPCycleSummary(req.user.tenantId, id);
  }

  @Post('sop/cycles')
  @Roles('ADMIN', 'PLANNER')
  async createSOPCycleV2(@Request() req: any, @Body() dto: CreateSOPCycleV2Dto) {
    return this.manufacturingService.createSOPCycleV2(req.user.tenantId, req.user.id, dto);
  }

  @Put('sop/cycles/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateSOPCycle(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateSOPCycleDto,
  ) {
    return this.manufacturingService.updateSOPCycle(req.user.tenantId, id, dto);
  }

  @Put('sop/cycles/:id/status')
  @Roles('ADMIN', 'PLANNER')
  async updateSOPCycleStatusV2(
    @Request() req: any,
    @Param('id') id: string,
    @Body('status') status: SOPStatus,
  ) {
    return this.manufacturingService.updateSOPCycleStatus(req.user.tenantId, id, status);
  }

  @Delete('sop/cycles/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteSOPCycle(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteSOPCycle(req.user.tenantId, id);
  }

  @Get('sop/cycles/:id/forecasts')
  async getSOPForecasts(
    @Request() req: any,
    @Param('id') id: string,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('source') source?: string,
  ) {
    return this.manufacturingService.getSOPForecasts(req.user.tenantId, id, {
      productId,
      locationId,
      source: source as SOPForecastSource,
    });
  }

  @Get('sop/cycles/:id/forecasts/comparison')
  async getSOPForecastComparison(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getSOPForecastComparison(req.user.tenantId, id);
  }

  @Post('sop/cycles/:id/forecasts')
  @Roles('ADMIN', 'PLANNER')
  async upsertSOPForecast(@Request() req: any, @Param('id') id: string, @Body() dto: UpsertSOPForecastDto) {
    return this.manufacturingService.upsertSOPForecast(req.user.tenantId, id, req.user.id, dto);
  }

  @Post('sop/cycles/:id/forecasts/bulk')
  @Roles('ADMIN', 'PLANNER')
  async bulkUpsertSOPForecasts(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: BulkUpsertSOPForecastsDto,
  ) {
    return this.manufacturingService.bulkUpsertSOPForecasts(req.user.tenantId, id, req.user.id, dto);
  }

  @Delete('sop/forecasts/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteSOPForecast(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteSOPForecast(req.user.tenantId, id);
  }

  @Post('sop/cycles/:id/copy-from/:sourceId')
  @Roles('ADMIN', 'PLANNER')
  async copySOPForecasts(
    @Request() req: any,
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: CopySOPForecastsDto,
  ) {
    return this.manufacturingService.copySOPForecasts(req.user.tenantId, sourceId, id, dto);
  }

  @Post('sop/cycles/:id/import-statistical')
  @Roles('ADMIN', 'PLANNER')
  async importSOPStatistical(@Request() req: any, @Param('id') id: string, @Body() dto: ImportSOPStatisticalDto) {
    return this.manufacturingService.importSOPStatistical(req.user.tenantId, id, req.user.id, dto);
  }

  @Get('sop/cycles/:id/assumptions')
  async getSOPAssumptions(
    @Request() req: any,
    @Param('id') id: string,
    @Query('category') category?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('status') status?: string,
  ) {
    return this.manufacturingService.getSOPAssumptions(req.user.tenantId, id, {
      category,
      riskLevel: riskLevel as RiskLevel,
      status,
    });
  }

  @Post('sop/cycles/:id/assumptions')
  @Roles('ADMIN', 'PLANNER')
  async createSOPAssumption(@Request() req: any, @Param('id') id: string, @Body() dto: CreateSOPAssumptionDto) {
    return this.manufacturingService.createSOPAssumption(req.user.tenantId, id, req.user.id, dto);
  }

  @Put('sop/assumptions/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateSOPAssumption(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateSOPAssumptionDto) {
    return this.manufacturingService.updateSOPAssumption(req.user.tenantId, id, dto);
  }

  @Delete('sop/assumptions/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteSOPAssumption(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteSOPAssumption(req.user.tenantId, id);
  }

  // ============================================================================
  // Fiscal Calendar Endpoints (v2)
  // ============================================================================

  @Get('fiscal-calendars/active')
  async getActiveFiscalCalendar(@Request() req: any) {
    return this.manufacturingService.getActiveFiscalCalendar(req.user.tenantId);
  }

  @Get('fiscal-calendars/:id')
  async getFiscalCalendar(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getFiscalCalendar(req.user.tenantId, id);
  }

  @Put('fiscal-calendars/:id')
  @Roles('ADMIN')
  async updateFiscalCalendar(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateFiscalCalendarDto) {
    return this.manufacturingService.updateFiscalCalendar(req.user.tenantId, id, dto);
  }

  @Put('fiscal-calendars/:id/activate')
  @Roles('ADMIN')
  async activateFiscalCalendar(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.activateFiscalCalendar(req.user.tenantId, id);
  }

  @Delete('fiscal-calendars/:id')
  @Roles('ADMIN')
  async deleteFiscalCalendar(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteFiscalCalendar(req.user.tenantId, id);
  }

  @Get('fiscal-calendars/:id/periods')
  async getFiscalPeriods(
    @Request() req: any,
    @Param('id') id: string,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('fiscalQuarter') fiscalQuarter?: string,
    @Query('fiscalMonth') fiscalMonth?: string,
    @Query('isOpen') isOpen?: string,
    @Query('startDateFrom') startDateFrom?: string,
    @Query('startDateTo') startDateTo?: string,
  ) {
    return this.manufacturingService.getFiscalPeriods(req.user.tenantId, id, {
      fiscalYear: fiscalYear ? parseInt(fiscalYear) : undefined,
      fiscalQuarter: fiscalQuarter ? parseInt(fiscalQuarter) : undefined,
      fiscalMonth: fiscalMonth ? parseInt(fiscalMonth) : undefined,
      isOpen: isOpen ? isOpen === 'true' : undefined,
      startDateFrom,
      startDateTo,
    });
  }

  @Get('fiscal-periods/:id')
  async getFiscalPeriod(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getFiscalPeriod(req.user.tenantId, id);
  }

  @Get('fiscal-calendars/:id/periods/current')
  async getCurrentFiscalPeriod(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getCurrentFiscalPeriod(req.user.tenantId, id);
  }

  @Post('fiscal-calendars/:id/periods')
  @Roles('ADMIN')
  async createFiscalPeriod(@Request() req: any, @Param('id') id: string, @Body() dto: CreateFiscalPeriodDto) {
    return this.manufacturingService.createFiscalPeriod(req.user.tenantId, id, dto);
  }

  @Put('fiscal-periods/:id')
  @Roles('ADMIN')
  async updateFiscalPeriod(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateFiscalPeriodDto) {
    return this.manufacturingService.updateFiscalPeriod(req.user.tenantId, id, dto);
  }

  @Put('fiscal-periods/:id/toggle-status')
  @Roles('ADMIN')
  async toggleFiscalPeriodStatus(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.toggleFiscalPeriodStatus(req.user.tenantId, id);
  }

  @Delete('fiscal-periods/:id')
  @Roles('ADMIN')
  async deleteFiscalPeriod(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteFiscalPeriod(req.user.tenantId, id);
  }

  @Post('fiscal-calendars/:id/generate-periods')
  @Roles('ADMIN')
  async generateFiscalPeriodsV2(@Request() req: any, @Param('id') id: string, @Body() dto: GenerateFiscalPeriodsV2Dto) {
    return this.manufacturingService.generateFiscalPeriodsV2(req.user.tenantId, id, dto);
  }

  @Get('fiscal-calendars/:id/date-to-fiscal')
  async dateToFiscal(@Request() req: any, @Param('id') id: string, @Query('date') date: string) {
    return this.manufacturingService.dateToFiscal(req.user.tenantId, id, date);
  }

  @Post('fiscal-calendars/:id/dates-to-fiscal')
  async datesToFiscal(@Request() req: any, @Param('id') id: string, @Body('dates') dates: string[]) {
    return this.manufacturingService.datesToFiscal(req.user.tenantId, id, dates || []);
  }

  @Get('fiscal-calendars/:id/fiscal-to-date-range')
  async fiscalToDateRange(
    @Request() req: any,
    @Param('id') id: string,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('fiscalQuarter') fiscalQuarter?: string,
    @Query('fiscalMonth') fiscalMonth?: string,
    @Query('fiscalWeek') fiscalWeek?: string,
  ) {
    return this.manufacturingService.fiscalToDateRange(req.user.tenantId, id, {
      fiscalYear: fiscalYear ? parseInt(fiscalYear) : undefined,
      fiscalQuarter: fiscalQuarter ? parseInt(fiscalQuarter) : undefined,
      fiscalMonth: fiscalMonth ? parseInt(fiscalMonth) : undefined,
      fiscalWeek: fiscalWeek ? parseInt(fiscalWeek) : undefined,
    });
  }

  @Get('fiscal-calendars/:id/period-range')
  async getFiscalPeriodRange(
    @Request() req: any,
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.manufacturingService.getFiscalPeriodRange(req.user.tenantId, id, { startDate, endDate });
  }

  @Get('fiscal-calendars/:id/years/:year/summary')
  async getFiscalYearSummary(
    @Request() req: any,
    @Param('id') id: string,
    @Param('year') year: string,
  ) {
    return this.manufacturingService.getFiscalYearSummary(req.user.tenantId, id, parseInt(year));
  }

  @Post('fiscal-calendars/:id/working-days')
  async calculateWorkingDays(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CalculateWorkingDaysDto,
  ) {
    return this.manufacturingService.calculateWorkingDaysBetween(req.user.tenantId, id, dto);
  }

  // ============================================================================
  // Purchase Order Endpoints
  // ============================================================================

  @Get('purchase-orders')
  async getPurchaseOrders(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.manufacturingService.getPurchaseOrders(req.user.tenantId, {
      status,
      supplierId,
      startDate,
      endDate,
    });
  }

  @Get('purchase-orders/:id')
  async getPurchaseOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.getPurchaseOrder(req.user.tenantId, id);
  }

  @Post('purchase-orders')
  @Roles('ADMIN', 'PLANNER')
  async createPurchaseOrder(@Request() req: any, @Body() dto: CreatePurchaseOrderDto) {
    return this.manufacturingService.createPurchaseOrder(req.user.tenantId, req.user.id, dto);
  }

  @Put('purchase-orders/:id')
  @Roles('ADMIN', 'PLANNER')
  async updatePurchaseOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.manufacturingService.updatePurchaseOrder(req.user.tenantId, id, dto);
  }

  @Post('purchase-orders/:id/release')
  @Roles('ADMIN', 'PLANNER')
  async releasePurchaseOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.releasePurchaseOrder(req.user.tenantId, id);
  }

  @Post('purchase-orders/:id/cancel')
  @Roles('ADMIN', 'PLANNER')
  async cancelPurchaseOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    return this.manufacturingService.cancelPurchaseOrder(req.user.tenantId, id, reason);
  }

  @Post('purchase-orders/convert-from-planned')
  @Roles('ADMIN', 'PLANNER')
  async convertPlannedOrdersToPurchaseOrders(@Request() req: any, @Body('plannedOrderIds') ids: string[]) {
    return this.manufacturingService.convertPlannedOrdersToPurchaseOrders(req.user.tenantId, req.user.id, ids);
  }

  // ============================================================================
  // Goods Receipt Endpoints
  // ============================================================================

  @Post('goods-receipts')
  @Roles('ADMIN', 'PLANNER')
  async createGoodsReceipt(@Request() req: any, @Body() dto: CreateGoodsReceiptDto) {
    return this.manufacturingService.createGoodsReceipt(req.user.tenantId, req.user.id, dto);
  }

  @Post('goods-receipts/:id/confirm')
  @Roles('ADMIN', 'PLANNER')
  async confirmGoodsReceipt(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.confirmGoodsReceipt(req.user.tenantId, id);
  }

  // ============================================================================
  // Work Order Endpoints
  // ============================================================================

  @Get('work-orders')
  async getWorkOrders(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('workCenterId') workCenterId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.manufacturingService.getWorkOrders(req.user.tenantId, {
      status,
      workCenterId,
      startDate,
      endDate,
    });
  }

  @Get('work-orders/:id')
  async getWorkOrderById(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.getWorkOrder(req.user.tenantId, id);
  }

  @Post('work-orders')
  @Roles('ADMIN', 'PLANNER')
  async createWorkOrder(@Request() req: any, @Body() dto: CreateWorkOrderDto) {
    return this.manufacturingService.createWorkOrder(req.user.tenantId, req.user.id, dto);
  }

  @Post('work-orders/:id/release')
  @Roles('ADMIN', 'PLANNER')
  async releaseWorkOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.releaseWorkOrder(req.user.tenantId, id);
  }

  @Post('work-orders/:id/start')
  @Roles('ADMIN', 'PLANNER')
  async startWorkOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.startWorkOrder(req.user.tenantId, id);
  }

  @Post('work-orders/:id/complete')
  @Roles('ADMIN', 'PLANNER')
  async completeWorkOrderEndpoint(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.completeWorkOrder(req.user.tenantId, id);
  }

  @Post('work-orders/:id/cancel')
  @Roles('ADMIN', 'PLANNER')
  async cancelWorkOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    return this.manufacturingService.cancelWorkOrder(req.user.tenantId, id, reason);
  }

  @Post('work-orders/convert-from-planned')
  @Roles('ADMIN', 'PLANNER')
  async convertPlannedOrdersToWorkOrders(@Request() req: any, @Body('plannedOrderIds') ids: string[]) {
    return this.manufacturingService.convertPlannedOrdersToWorkOrders(req.user.tenantId, req.user.id, ids);
  }

  // ============================================================================
  // Work Order Operations
  // ============================================================================

  @Post('operations/:id/start')
  @Roles('ADMIN', 'PLANNER')
  async startOperation(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.startOperation(req.user.tenantId, id);
  }

  @Post('operations/:id/complete')
  @Roles('ADMIN', 'PLANNER')
  async completeOperation(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteOperationDto) {
    return this.manufacturingService.completeOperation(req.user.tenantId, id, dto);
  }

  // ============================================================================
  // Material Issue & Production
  // ============================================================================

  @Post('material-issues')
  @Roles('ADMIN', 'PLANNER')
  async issueMaterial(@Request() req: any, @Body() dto: IssueMaterialDto) {
    return this.manufacturingService.issueMaterial(req.user.tenantId, req.user.id, dto);
  }

  @Post('work-orders/:id/backflush')
  @Roles('ADMIN', 'PLANNER')
  async backflushMaterials(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body('completedQty') qty: number) {
    return this.manufacturingService.backflushMaterials(req.user.tenantId, id, qty, req.user.id);
  }

  @Post('production-completions')
  @Roles('ADMIN', 'PLANNER')
  async reportProductionCompletion(@Request() req: any, @Body() dto: ReportProductionCompletionDto) {
    return this.manufacturingService.reportProductionCompletion(req.user.tenantId, req.user.id, dto);
  }

  // ============================================================================
  // Labor Tracking
  // ============================================================================

  @Post('labor-entries')
  @Roles('ADMIN', 'PLANNER')
  async recordLabor(@Request() req: any, @Body() dto: RecordLaborDto) {
    return this.manufacturingService.recordLabor(req.user.tenantId, req.user.id, dto);
  }

  @Get('work-orders/:id/labor-entries')
  async getLaborEntriesForWorkOrder(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.manufacturingService.getLaborEntriesForWorkOrder(req.user.tenantId, id);
  }

  // ============================================================================
  // Inventory Transactions
  // ============================================================================

  @Get('inventory-transactions')
  async getInventoryTransactions(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('transactionType') transactionType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.manufacturingService.getInventoryTransactions(req.user.tenantId, {
      productId,
      transactionType,
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Post('inventory-transactions')
  @Roles('ADMIN', 'PLANNER')
  async createInventoryTransaction(@Request() req: any, @Body() dto: CreateInventoryTransactionDto) {
    return this.manufacturingService.createInventoryTransaction(req.user.tenantId, dto);
  }

  @Post('inventory-adjustments')
  @Roles('ADMIN', 'PLANNER')
  async adjustInventory(@Request() req: any, @Body() dto: AdjustInventoryDto) {
    return this.manufacturingService.adjustInventory(req.user.tenantId, dto);
  }

  @Post('inventory-transfers')
  @Roles('ADMIN', 'PLANNER')
  async transferInventory(@Request() req: any, @Body() dto: TransferInventoryDto) {
    return this.manufacturingService.transferInventory(req.user.tenantId, dto);
  }

  // ============================================================================
  // MRP Advanced Features
  // ============================================================================

  @Get('action-messages')
  async getActionMessages(@Request() req: any) {
    return this.manufacturingService.generateActionMessages(req.user.tenantId);
  }

  @Get('pegging/:productId')
  async getPegging(@Request() req: any, @Param('productId') productId: string) {
    return this.manufacturingService.getPegging(req.user.tenantId, productId);
  }

  @Get('scheduled-receipts')
  async getScheduledReceipts(@Request() req: any, @Query('productId') productId?: string) {
    return this.manufacturingService.getScheduledReceipts(req.user.tenantId, productId);
  }

  // ============================================================================
  // Forecast Accuracy Metrics
  // ============================================================================

  @Get('forecast-accuracy')
  async getForecastAccuracyMetrics(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getForecastAccuracyMetrics(req.user.tenantId, {
      productId,
      locationId,
      startDate,
      endDate,
      granularity,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('forecast-accuracy/:id')
  async getForecastAccuracyMetric(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getForecastAccuracyMetric(req.user.tenantId, id);
  }

  @Post('forecast-accuracy')
  @Roles('ADMIN', 'PLANNER')
  async createForecastAccuracyMetric(@Request() req: any, @Body() dto: CreateForecastAccuracyMetricDto) {
    return this.manufacturingService.createForecastAccuracyMetric(req.user.tenantId, dto);
  }

  @Patch('forecast-accuracy/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateForecastAccuracyMetric(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateForecastAccuracyMetricDto) {
    return this.manufacturingService.updateForecastAccuracyMetric(req.user.tenantId, id, dto);
  }

  @Delete('forecast-accuracy/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteForecastAccuracyMetric(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteForecastAccuracyMetric(req.user.tenantId, id);
  }

  // ============================================================================
  // Quality Inspections
  // ============================================================================

  @Get('quality-inspections')
  async getQualityInspections(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('inspectionType') inspectionType?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('purchaseOrderId') purchaseOrderId?: string,
    @Query('productId') productId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getQualityInspections(req.user.tenantId, {
      status,
      inspectionType,
      workOrderId,
      purchaseOrderId,
      productId,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('quality-inspections/:id')
  async getQualityInspection(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getQualityInspection(req.user.tenantId, id);
  }

  @Post('quality-inspections')
  @Roles('ADMIN', 'PLANNER')
  async createQualityInspection(@Request() req: any, @Body() dto: CreateQualityInspectionDto) {
    return this.manufacturingService.createQualityInspection(req.user.tenantId, dto);
  }

  @Patch('quality-inspections/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateQualityInspection(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateQualityInspectionDto) {
    return this.manufacturingService.updateQualityInspection(req.user.tenantId, id, dto);
  }

  @Patch('quality-inspections/:id/status')
  @Roles('ADMIN', 'PLANNER')
  async updateQualityInspectionStatus(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateQualityInspectionStatusDto) {
    return this.manufacturingService.updateQualityInspectionStatus(req.user.tenantId, id, dto.status, req.user.id);
  }

  @Delete('quality-inspections/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteQualityInspection(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteQualityInspection(req.user.tenantId, id);
  }

  // ============================================================================
  // UOM Master
  // ============================================================================

  @Get('uoms')
  async getUoms(
    @Request() req: any,
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getUoms(req.user.tenantId, {
      category,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      search,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('uoms/:id')
  async getUom(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getUom(req.user.tenantId, id);
  }

  @Post('uoms')
  @Roles('ADMIN', 'PLANNER')
  async createUom(@Request() req: any, @Body() dto: CreateUomDto) {
    return this.manufacturingService.createUom(req.user.tenantId, dto);
  }

  @Patch('uoms/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateUom(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateUomDto) {
    return this.manufacturingService.updateUom(req.user.tenantId, id, dto);
  }

  @Delete('uoms/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteUom(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteUom(req.user.tenantId, id);
  }

  // ============================================================================
  // UOM Conversions
  // ============================================================================

  @Get('uom-conversions')
  async getUomConversions(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('fromUom') fromUom?: string,
    @Query('toUom') toUom?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getUomConversions(req.user.tenantId, {
      productId,
      fromUom,
      toUom,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('uom-conversions/convert')
  async convertUom(
    @Request() req: any,
    @Query('fromUom') fromUom: string,
    @Query('toUom') toUom: string,
    @Query('quantity') quantity: string,
    @Query('productId') productId?: string,
  ) {
    return this.manufacturingService.convertUom(req.user.tenantId, fromUom, toUom, parseFloat(quantity), productId);
  }

  @Get('uom-conversions/:id')
  async getUomConversion(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getUomConversion(req.user.tenantId, id);
  }

  @Post('uom-conversions')
  @Roles('ADMIN', 'PLANNER')
  async createUomConversion(@Request() req: any, @Body() dto: CreateUomConversionDto) {
    return this.manufacturingService.createUomConversion(req.user.tenantId, dto);
  }

  @Patch('uom-conversions/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateUomConversion(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateUomConversionDto) {
    return this.manufacturingService.updateUomConversion(req.user.tenantId, id, dto);
  }

  @Delete('uom-conversions/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteUomConversion(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteUomConversion(req.user.tenantId, id);
  }

  // ============================================================================
  // Location Hierarchy
  // ============================================================================

  @Get('location-hierarchy')
  async getLocationHierarchies(
    @Request() req: any,
    @Query('hierarchyType') hierarchyType?: string,
    @Query('parentId') parentId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getLocationHierarchies(req.user.tenantId, {
      hierarchyType,
      parentId,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('location-hierarchy/tree')
  async getHierarchyTree(@Request() req: any, @Query('hierarchyType') hierarchyType?: string) {
    return this.manufacturingService.getHierarchyTree(req.user.tenantId, hierarchyType);
  }

  @Get('location-hierarchy/:id')
  async getLocationHierarchyNode(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getLocationHierarchyNode(req.user.tenantId, id);
  }

  @Post('location-hierarchy')
  @Roles('ADMIN', 'PLANNER')
  async createLocationHierarchy(@Request() req: any, @Body() dto: CreateLocationHierarchyDto) {
    return this.manufacturingService.createLocationHierarchy(req.user.tenantId, dto);
  }

  @Patch('location-hierarchy/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateLocationHierarchy(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateLocationHierarchyDto) {
    return this.manufacturingService.updateLocationHierarchy(req.user.tenantId, id, dto);
  }

  @Delete('location-hierarchy/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteLocationHierarchy(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteLocationHierarchy(req.user.tenantId, id);
  }

  // ============================================================================
  // Capacity Plans
  // ============================================================================

  @Get('capacity-plans')
  async getCapacityPlans(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('planType') planType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getCapacityPlans(req.user.tenantId, {
      status,
      planType,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('capacity-plans/:id')
  async getCapacityPlanById(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getCapacityPlanById(req.user.tenantId, id);
  }

  @Post('capacity-plans')
  @Roles('ADMIN', 'PLANNER')
  async createCapacityPlanRecord(@Request() req: any, @Body() dto: CreateCapacityPlanDto) {
    return this.manufacturingService.createCapacityPlanRecord(req.user.tenantId, dto);
  }

  @Patch('capacity-plans/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateCapacityPlanRecord(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateCapacityPlanDto) {
    return this.manufacturingService.updateCapacityPlanRecord(req.user.tenantId, id, dto);
  }

  @Delete('capacity-plans/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteCapacityPlanRecord(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteCapacityPlanRecord(req.user.tenantId, id);
  }

  @Get('capacity-plans/:planId/buckets')
  async getCapacityPlanBuckets(@Request() req: any, @Param('planId') planId: string) {
    return this.manufacturingService.getCapacityPlanBuckets(req.user.tenantId, planId);
  }

  @Post('capacity-plans/:planId/buckets')
  @Roles('ADMIN', 'PLANNER')
  async createCapacityPlanBucket(@Request() req: any, @Param('planId') planId: string, @Body() dto: CreateCapacityPlanBucketDto) {
    return this.manufacturingService.createCapacityPlanBucket(req.user.tenantId, planId, dto);
  }

  @Delete('capacity-plans/:planId/buckets/:bucketId')
  @Roles('ADMIN', 'PLANNER')
  async deleteCapacityPlanBucket(@Request() req: any, @Param('planId') planId: string, @Param('bucketId') bucketId: string) {
    return this.manufacturingService.deleteCapacityPlanBucket(req.user.tenantId, planId, bucketId);
  }

  @Get('capacity-plans/:planId/buckets/:bucketId')
  async getCapacityPlanBucket(@Request() req: any, @Param('planId') planId: string, @Param('bucketId') bucketId: string) {
    return this.manufacturingService.getCapacityPlanBucket(req.user.tenantId, planId, bucketId);
  }

  @Patch('capacity-plans/:planId/buckets/:bucketId')
  @Roles('ADMIN', 'PLANNER')
  async updateCapacityPlanBucket(@Request() req: any, @Param('planId') planId: string, @Param('bucketId') bucketId: string, @Body() dto: UpdateCapacityPlanBucketDto) {
    return this.manufacturingService.updateCapacityPlanBucket(req.user.tenantId, planId, bucketId, dto);
  }

  // ============================================================================
  // SOP Gap Analysis
  // ============================================================================

  @Get('sop-gap-analysis')
  async getSOPGapAnalyses(
    @Request() req: any,
    @Query('cycleId') cycleId?: string,
    @Query('productId') productId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getSOPGapAnalyses(req.user.tenantId, {
      cycleId,
      productId,
      status,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('sop-gap-analysis/:id')
  async getSOPGapAnalysis(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getSOPGapAnalysisById(req.user.tenantId, id);
  }

  @Post('sop-gap-analysis')
  @Roles('ADMIN', 'PLANNER')
  async createSOPGapAnalysis(@Request() req: any, @Body() dto: CreateSOPGapAnalysisDto) {
    return this.manufacturingService.createSOPGapAnalysis(req.user.tenantId, dto);
  }

  @Patch('sop-gap-analysis/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateSOPGapAnalysis(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateSOPGapAnalysisDto) {
    return this.manufacturingService.updateSOPGapAnalysis(req.user.tenantId, id, dto);
  }

  @Delete('sop-gap-analysis/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteSOPGapAnalysis(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteSOPGapAnalysis(req.user.tenantId, id);
  }

  // ============================================================================
  // Purchase Contracts
  // ============================================================================

  @Get('purchase-contracts')
  async getPurchaseContracts(
    @Request() req: any,
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('contractType') contractType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getPurchaseContracts(req.user.tenantId, {
      supplierId,
      status,
      contractType,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('purchase-contracts/:id')
  async getPurchaseContractById(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getPurchaseContractById(req.user.tenantId, id);
  }

  @Post('purchase-contracts')
  @Roles('ADMIN', 'PLANNER')
  async createPurchaseContractRecord(@Request() req: any, @Body() dto: CreatePurchaseContractDto) {
    return this.manufacturingService.createPurchaseContractRecord(req.user.tenantId, dto);
  }

  @Patch('purchase-contracts/:id')
  @Roles('ADMIN', 'PLANNER')
  async updatePurchaseContractRecord(@Request() req: any, @Param('id') id: string, @Body() dto: UpdatePurchaseContractDto) {
    return this.manufacturingService.updatePurchaseContractRecord(req.user.tenantId, id, dto);
  }

  @Delete('purchase-contracts/:id')
  @Roles('ADMIN', 'PLANNER')
  async deletePurchaseContractRecord(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deletePurchaseContractRecord(req.user.tenantId, id);
  }

  @Get('purchase-contracts/:contractId/lines')
  async getPurchaseContractLines(@Request() req: any, @Param('contractId') contractId: string) {
    return this.manufacturingService.getPurchaseContractLines(req.user.tenantId, contractId);
  }

  @Post('purchase-contracts/:contractId/lines')
  @Roles('ADMIN', 'PLANNER')
  async createPurchaseContractLine(@Request() req: any, @Param('contractId') contractId: string, @Body() dto: CreatePurchaseContractLineDto) {
    return this.manufacturingService.createPurchaseContractLine(req.user.tenantId, contractId, dto);
  }

  @Delete('purchase-contracts/:contractId/lines/:lineId')
  @Roles('ADMIN', 'PLANNER')
  async deletePurchaseContractLine(@Request() req: any, @Param('contractId') contractId: string, @Param('lineId') lineId: string) {
    return this.manufacturingService.deletePurchaseContractLine(req.user.tenantId, contractId, lineId);
  }

  @Get('purchase-contracts/:contractId/lines/:lineId')
  async getPurchaseContractLine(@Request() req: any, @Param('contractId') contractId: string, @Param('lineId') lineId: string) {
    return this.manufacturingService.getPurchaseContractLine(req.user.tenantId, contractId, lineId);
  }

  @Patch('purchase-contracts/:contractId/lines/:lineId')
  @Roles('ADMIN', 'PLANNER')
  async updatePurchaseContractLine(@Request() req: any, @Param('contractId') contractId: string, @Param('lineId') lineId: string, @Body() dto: UpdatePurchaseContractLineDto) {
    return this.manufacturingService.updatePurchaseContractLine(req.user.tenantId, contractId, lineId, dto);
  }

  // ============================================================================
  // Product Costings
  // ============================================================================

  @Get('product-costings')
  async getProductCostings(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('costType') costType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getProductCostings(req.user.tenantId, {
      productId,
      locationId,
      costType,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('product-costings/:id')
  async getProductCostingById(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getProductCostingById(req.user.tenantId, id);
  }

  @Post('product-costings')
  @Roles('ADMIN', 'PLANNER')
  async createProductCosting(@Request() req: any, @Body() dto: CreateProductCostingDto) {
    return this.manufacturingService.createProductCosting(req.user.tenantId, dto);
  }

  @Patch('product-costings/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateProductCosting(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateProductCostingDto) {
    return this.manufacturingService.updateProductCosting(req.user.tenantId, id, dto);
  }

  @Delete('product-costings/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteProductCosting(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteProductCosting(req.user.tenantId, id);
  }

  // ──── Batches ────

  @Get('batches')
  async getBatches(@Request() req: any, @Query() query: GetBatchesQueryDto) {
    return this.manufacturingService.getBatches(req.user.tenantId, query);
  }

  @Get('batches/:id')
  async getBatch(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getBatch(req.user.tenantId, id);
  }

  @Post('batches')
  @Roles('ADMIN', 'PLANNER', 'OPERATOR')
  async createBatch(@Request() req: any, @Body() dto: CreateBatchDto) {
    return this.manufacturingService.createBatch(req.user.tenantId, dto);
  }

  @Patch('batches/:id')
  @Roles('ADMIN', 'PLANNER', 'OPERATOR')
  async updateBatch(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateBatchDto) {
    return this.manufacturingService.updateBatch(req.user.tenantId, id, dto);
  }

  @Delete('batches/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteBatch(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteBatch(req.user.tenantId, id);
  }

  // ============================================================================
  // Inventory Reservations
  // ============================================================================

  @Get('inventory-reservations')
  async getInventoryReservations(@Request() req: any, @Query() query: GetInventoryReservationsQueryDto) {
    return this.manufacturingService.getInventoryReservations(req.user.tenantId, {
      productId: query.productId,
      referenceType: query.referenceType,
      referenceId: query.referenceId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('inventory-reservations/:id')
  async getInventoryReservation(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getInventoryReservation(req.user.tenantId, id);
  }

  // ============================================================================
  // Inventory Holds
  // ============================================================================

  @Get('inventory-holds')
  async getInventoryHolds(@Request() req: any, @Query() query: GetInventoryHoldsQueryDto) {
    return this.manufacturingService.getInventoryHolds(req.user.tenantId, {
      productId: query.productId,
      status: query.status,
      holdReason: query.holdReason,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('inventory-holds/:id')
  async getInventoryHold(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getInventoryHold(req.user.tenantId, id);
  }

  @Put('inventory-holds/:id/release')
  @Roles('ADMIN', 'PLANNER')
  async releaseInventoryHold(@Request() req: any, @Param('id') id: string, @Body() dto: ReleaseInventoryHoldDto) {
    return this.manufacturingService.releaseInventoryHold(req.user.tenantId, id, dto.releaseQty);
  }

  // ============================================================================
  // Work Order Costs
  // ============================================================================

  @Get('work-order-costs')
  async getWorkOrderCosts(@Request() req: any, @Query() query: GetWorkOrderCostsQueryDto) {
    return this.manufacturingService.getWorkOrderCosts(req.user.tenantId, {
      workOrderId: query.workOrderId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('work-order-costs/:workOrderId')
  async getWorkOrderCost(@Request() req: any, @Param('workOrderId') workOrderId: string) {
    return this.manufacturingService.getWorkOrderCost(req.user.tenantId, workOrderId);
  }

  // ============================================================================
  // Inventory Ledger
  // ============================================================================

  @Get('inventory-ledger')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  async getInventoryLedgerEntries(@Request() req: any, @Query() query: GetInventoryLedgerQueryDto) {
    return this.inventoryLedger.getLedgerEntries(req.user.tenantId, {
      productId: query.productId,
      locationId: query.locationId,
      batchId: query.batchId,
      entryType: query.entryType as any,
      fromDate: query.startDate ? new Date(query.startDate) : undefined,
      toDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Get('inventory-ledger/balance/:productId/:locationId')
  async getInventoryBalance(
    @Request() req: any,
    @Param('productId') productId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.inventoryLedger.getBalance(req.user.tenantId, productId, locationId);
  }

  @Post('inventory-ledger/reconcile')
  @Roles('ADMIN')
  async reconcileInventory(@Request() req: any, @Body() dto: ReconcileInventoryDto) {
    return this.inventoryLedger.reconcileBalance(req.user.tenantId, dto.productId, dto.locationId);
  }

  // ============================================================================
  // General Ledger / Accounting
  // ============================================================================

  @Get('gl-accounts')
  @Roles('ADMIN', 'FINANCE')
  async getGLAccounts(@Request() req: any) {
    return this.accounting.getGLAccounts(req.user.tenantId);
  }

  @Get('gl-accounts/:id')
  @Roles('ADMIN', 'FINANCE')
  async getGLAccount(@Request() req: any, @Param('id') id: string) {
    return this.accounting.getGLAccount(req.user.tenantId, id);
  }

  @Post('gl-accounts')
  @Roles('ADMIN')
  async createGLAccount(@Request() req: any, @Body() dto: CreateGLAccountDto) {
    return this.accounting.createGLAccount(req.user.tenantId, dto);
  }

  @Put('gl-accounts/:id')
  @Roles('ADMIN')
  async updateGLAccount(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateGLAccountDto) {
    return this.accounting.updateGLAccount(req.user.tenantId, id, dto);
  }

  @Get('posting-profiles')
  @Roles('ADMIN', 'FINANCE')
  async getPostingProfiles(@Request() req: any) {
    return this.accounting.getPostingProfiles(req.user.tenantId);
  }

  @Post('posting-profiles')
  @Roles('ADMIN')
  async createPostingProfile(@Request() req: any, @Body() dto: CreatePostingProfileDto) {
    return this.accounting.createPostingProfile(req.user.tenantId, dto);
  }

  @Get('journal-entries')
  @Roles('ADMIN', 'FINANCE')
  async getJournalEntries(@Request() req: any, @Query() query: GetJournalEntriesQueryDto) {
    return this.accounting.getJournalEntries(req.user.tenantId, {
      status: query.status as any,
      fromDate: query.startDate ? new Date(query.startDate) : undefined,
      toDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Post('journal-entries')
  @Roles('ADMIN', 'FINANCE')
  async createJournalEntry(@Request() req: any, @Body() dto: CreateJournalEntryDto) {
    return this.prisma.$transaction(async (tx) => {
      return this.accounting.createJournalEntry(tx, {
        tenantId: req.user.tenantId,
        entryDate: new Date(dto.entryDate),
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        description: dto.description,
        postedById: req.user.id,
        idempotencyKey: dto.idempotencyKey,
        currency: dto.currency,
        lines: dto.lines,
      });
    });
  }

  @Post('journal-entries/:id/reverse')
  @Roles('ADMIN')
  async reverseJournalEntry(@Param('id') id: string, @Request() req: any) {
    return this.accounting.reverseJournalEntryById(req.user.tenantId, id, req.user.id);
  }

  @Get('trial-balance')
  @Roles('ADMIN', 'PLANNER')
  async getTrialBalance(@Request() req: any, @Query() query: GetTrialBalanceQueryDto) {
    return this.accounting.getTrialBalance(req.user.tenantId, {
      fromDate: query.startDate ? new Date(query.startDate) : undefined,
      toDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Post('fiscal-periods/:id/lock')
  @Roles('ADMIN')
  async lockFiscalPeriodAccounting(@Param('id') id: string, @Request() req: any) {
    return this.accounting.lockFiscalPeriod(req.user.tenantId, id, req.user.id);
  }

  @Post('fiscal-periods/:id/unlock')
  @Roles('ADMIN')
  async unlockFiscalPeriodAccounting(@Param('id') id: string, @Request() req: any) {
    return this.accounting.unlockFiscalPeriod(req.user.tenantId, id);
  }

  // ============================================================================
  // Inspection Plans
  // ============================================================================

  @Get('inspection-plans')
  async getInspectionPlans(@Request() req: any, @Query() query: GetInspectionPlansQueryDto) {
    return this.quality.getInspectionPlans(req.user.tenantId, {
      productId: query.productId,
      inspectionType: query.inspectionType as any,
      isActive: query.isActive === 'true' ? true : query.isActive === 'false' ? false : undefined,
    });
  }

  @Get('inspection-plans/:id')
  async getInspectionPlan(@Request() req: any, @Param('id') id: string) {
    return this.quality.getInspectionPlan(req.user.tenantId, id);
  }

  @Post('inspection-plans')
  @Roles('ADMIN', 'PLANNER')
  async createInspectionPlan(@Request() req: any, @Body() dto: CreateInspectionPlanDto) {
    return this.quality.createInspectionPlan(req.user.tenantId, {
      ...dto,
      createdById: req.user.id,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
    });
  }

  // ============================================================================
  // NCRs (Non-Conformance Reports)
  // ============================================================================

  @Get('ncrs')
  async getNCRs(@Request() req: any, @Query() query: GetNCRsQueryDto) {
    return this.quality.getNCRs(req.user.tenantId, {
      status: query.status as any,
      productId: query.productId,
      workOrderId: query.workOrderId,
    });
  }

  @Get('ncrs/:id')
  async getNCR(@Request() req: any, @Param('id') id: string) {
    return this.quality.getNCR(req.user.tenantId, id);
  }

  @Put('ncrs/:id/status')
  @Roles('ADMIN', 'PLANNER')
  async updateNCRStatus(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateNCRStatusDto) {
    return this.quality.updateNCRStatus(req.user.tenantId, id, {
      ...dto,
      closedById: dto.status === 'NCR_CLOSED' ? req.user.id : undefined,
    });
  }

  // ============================================================================
  // CAPAs (Corrective/Preventive Actions)
  // ============================================================================

  @Get('capas')
  async getCAPAs(@Request() req: any, @Query() query: GetCAPAsQueryDto) {
    return this.quality.getCAPAs(req.user.tenantId, {
      status: query.status as any,
      ncrId: query.ncrId,
    });
  }

  @Get('capas/:id')
  async getCAPA(@Request() req: any, @Param('id') id: string) {
    return this.quality.getCAPA(req.user.tenantId, id);
  }

  @Post('capas')
  @Roles('ADMIN', 'PLANNER')
  async createCAPA(@Request() req: any, @Body() dto: CreateCAPADto) {
    return this.quality.createCAPA(req.user.tenantId, {
      ...dto,
      dueDate: new Date(dto.dueDate),
      createdById: req.user.id,
    });
  }

  @Put('capas/:id/status')
  @Roles('ADMIN', 'PLANNER')
  async updateCAPAStatus(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateCAPAStatusDto) {
    return this.quality.updateCAPAStatus(req.user.tenantId, id, {
      ...dto,
      verifiedById: dto.status === 'CAPA_CLOSED' ? req.user.id : undefined,
      completedDate: dto.completedDate ? new Date(dto.completedDate) : undefined,
    });
  }

  @Get('quality-dashboard')
  async getQualityDashboard(@Request() req: any) {
    return this.quality.getQualityDashboard(req.user.tenantId);
  }

  // ============================================================================
  // Costing Engine
  // ============================================================================

  @Post('cost-rollup/:productId')
  @Roles('ADMIN', 'PLANNER')
  async rollUpStandardCost(
    @Request() req: any,
    @Param('productId') productId: string,
    @Body() dto: CostRollUpDto,
  ) {
    return this.costing.rollUpStandardCost(req.user.tenantId, productId, {
      effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : undefined,
      locationId: dto.locationId,
      version: dto.version,
    });
  }

  @Post('cost-rollup-batch')
  @Roles('ADMIN')
  async batchCostRollUp(@Request() req: any, @Body() dto: BatchCostRollUpDto) {
    return this.costing.batchRollUp(
      req.user.tenantId,
      dto.effectiveDate ? new Date(dto.effectiveDate) : undefined,
    );
  }

  @Post('work-orders/:id/aggregate-costs')
  @Roles('ADMIN', 'PLANNER')
  async aggregateWorkOrderCosts(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.costing.aggregateWorkOrderActuals(req.user.tenantId, id);
  }

  @Post('work-orders/:id/calculate-variance')
  @Roles('ADMIN', 'PLANNER')
  async calculateVariance(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.costing.calculateVariance(req.user.tenantId, id);
  }

  @Get('cost-comparison')
  @Roles('ADMIN', 'PLANNER')
  async getCostComparisonReport(@Request() req: any, @Query() query: GetCostComparisonReportQueryDto) {
    return this.costing.getCostComparisonReport(req.user.tenantId, {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      productId: query.productId,
    });
  }

  // ==========================================================================
  // Product Category Master
  // ==========================================================================

  @Get('product-categories')
  async getProductCategories(
    @Request() req: any,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
    @Query('parentId') parentId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.manufacturingService.getProductCategories(req.user.tenantId, {
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      search: search || undefined,
      parentId,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('product-categories/:id')
  async getProductCategory(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getProductCategory(req.user.tenantId, id);
  }

  @Post('product-categories')
  @Roles('ADMIN', 'PLANNER')
  async createProductCategory(@Request() req: any, @Body() dto: CreateProductCategoryDto) {
    return this.manufacturingService.createProductCategory(req.user.tenantId, dto);
  }

  @Patch('product-categories/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateProductCategory(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateProductCategoryDto) {
    return this.manufacturingService.updateProductCategory(req.user.tenantId, id, dto);
  }

  @Delete('product-categories/:id')
  @Roles('ADMIN', 'PLANNER')
  async deleteProductCategory(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteProductCategory(req.user.tenantId, id);
  }

  // ==========================================================================
  // Costing Engine — Cost Layers
  // ==========================================================================

  @Get('costing-engine/cost-layers')
  async getCostLayers(@Request() req: any, @Query() query: GetCostingEngineCostLayersQueryDto) {
    return this.costingEngine.getCostLayers(req.user.tenantId, {
      productId: query.productId,
      locationId: query.locationId,
      status: query.status,
      skip: query.skip,
      take: query.take,
    });
  }

  // ==========================================================================
  // Costing Engine — Item Costs (Moving Average / Standard)
  // ==========================================================================

  @Get('costing-engine/item-costs')
  async getItemCosts(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.costingEngine.getItemCosts(req.user.tenantId, { productId, locationId });
  }

  // ==========================================================================
  // Costing Engine — WIP Accumulation
  // ==========================================================================

  @Get('costing-engine/wip/:workOrderId')
  async getWIPAccumulation(@Request() req: any, @Param('workOrderId') workOrderId: string) {
    return this.costingEngine.getWIPAccumulation(req.user.tenantId, workOrderId);
  }

  // ==========================================================================
  // Costing Engine — Cost Variances
  // ==========================================================================

  @Get('costing-engine/variances')
  async getCostVariances(@Request() req: any, @Query() query: GetCostingEngineVariancesQueryDto) {
    return this.costingEngine.getCostVariances(req.user.tenantId, {
      varianceType: query.varianceType,
      referenceType: query.referenceType,
      referenceId: query.referenceId,
      fiscalPeriodId: query.fiscalPeriodId,
      productId: query.productId,
      skip: query.skip,
      take: query.take,
    });
  }

  // ==========================================================================
  // Costing Engine — Inventory Valuation
  // ==========================================================================

  @Get('costing-engine/inventory-valuation')
  async getInventoryValuation(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.costingEngine.getInventoryValuation(req.user.tenantId, { productId, locationId });
  }

  // ==========================================================================
  // Costing Engine — Standard Cost Rollup
  // ==========================================================================

  @Post('costing-engine/rollup-standard-cost')
  @Roles('ADMIN', 'PLANNER')
  async rollupStandardCost(@Request() req: any, @Body() dto: RollupStandardCostDto) {
    return this.costingEngine.rollupStandardCost({
      tenantId: req.user.tenantId,
      productId: dto.productId,
      effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : undefined,
      locationId: dto.locationId,
      version: dto.version,
      userId: req.user.id,
    });
  }

  // ==========================================================================
  // Costing Engine — Landed Cost Allocation
  // ==========================================================================

  @Post('costing-engine/landed-cost')
  @Roles('ADMIN', 'PLANNER')
  async allocateLandedCost(@Request() req: any, @Body() dto: AllocateLandedCostDto) {
    return this.costingEngine.allocateLandedCost({
      tenantId: req.user.tenantId,
      goodsReceiptId: dto.goodsReceiptId,
      allocations: dto.allocations,
      allocationMethod: dto.allocationMethod,
      vendorInvoiceRef: dto.vendorInvoiceRef,
      fiscalPeriodId: dto.fiscalPeriodId,
      userId: req.user.id,
    });
  }

  // ==========================================================================
  // Costing Engine — Revaluation
  // ==========================================================================

  @Post('costing-engine/revalue')
  @Roles('ADMIN')
  async revalueInventory(@Request() req: any, @Body() dto: RevalueInventoryDto) {
    return this.costingEngine.revalueInventory({
      tenantId: req.user.tenantId,
      productId: dto.productId,
      locationId: dto.locationId,
      newUnitCost: dto.newUnitCost,
      reason: dto.reason,
      fiscalPeriodId: dto.fiscalPeriodId,
      userId: req.user.id,
    });
  }

  @Get('costing-engine/revaluation-history')
  async getRevaluationHistory(@Request() req: any, @Query() query: GetCostingEngineRevaluationHistoryQueryDto) {
    return this.costingEngine.getRevaluationHistory(req.user.tenantId, {
      productId: query.productId,
      status: query.status,
      skip: query.skip,
      take: query.take,
    });
  }

  // ==========================================================================
  // Costing Engine — Period Close
  // ==========================================================================

  @Post('costing-engine/period-snapshot')
  @Roles('ADMIN')
  async snapshotPeriodValuation(@Request() req: any, @Body() dto: PeriodActionDto) {
    return this.costingEngine.snapshotPeriodValuation({
      tenantId: req.user.tenantId,
      fiscalPeriodId: dto.fiscalPeriodId,
      userId: req.user.id,
    });
  }

  @Post('costing-engine/period-close')
  @Roles('ADMIN')
  async closePeriod(@Request() req: any, @Body() dto: PeriodActionDto) {
    return this.costingEngine.closePeriod({
      tenantId: req.user.tenantId,
      fiscalPeriodId: dto.fiscalPeriodId,
      userId: req.user.id,
    });
  }

  @Post('costing-engine/period-reopen')
  @Roles('ADMIN')
  async reopenPeriod(@Request() req: any, @Body() dto: ReopenPeriodDto) {
    return this.costingEngine.reopenPeriod({
      tenantId: req.user.tenantId,
      fiscalPeriodId: dto.fiscalPeriodId,
      reason: dto.reason,
      userId: req.user.id,
    });
  }

  @Get('costing-engine/period-close-status/:fiscalPeriodId')
  async getPeriodCloseStatus(@Request() req: any, @Param('fiscalPeriodId') fiscalPeriodId: string) {
    return this.costingEngine.getPeriodCloseStatus(req.user.tenantId, fiscalPeriodId);
  }

  // ==========================================================================
  // Costing Engine — S&OP / Scenario Cost Projections
  // ==========================================================================

  @Get('costing-engine/planned-cogs')
  async getPlannedCOGS(@Request() req: any, @Query() query: GetPlannedCOGSQueryDto) {
    const startDate = query.startDate ? new Date(query.startDate) : new Date();
    const endDate = query.endDate ? new Date(query.endDate) : new Date(Date.now() + 365 * 86400000);

    if (endDate < startDate) {
      throw new BadRequestException('endDate must be greater than or equal to startDate');
    }

    return this.costingEngine.getPlannedCOGS(req.user.tenantId, {
      scenarioId: query.scenarioId,
      productId: query.productId,
      startDate,
      endDate,
    });
  }

  @Post('costing-engine/scenario-cost-comparison')
  async getScenarioCostComparison(@Request() req: any, @Body() dto: ScenarioCostComparisonDto) {
    return this.costingEngine.getScenarioCostComparison(req.user.tenantId, {
      scenarioIds: dto.scenarioIds,
      productId: dto.productId,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    });
  }

  // ==========================================================================
  // Costing Engine — Item Cost Profile Management
  // ==========================================================================

  @Get('costing-engine/cost-profiles')
  async getCostProfiles(@Request() req: any, @Query() query: GetCostProfilesQueryDto) {
    return this.costingEngine.getCostProfiles(req.user.tenantId, {
      productId: query.productId,
      locationId: query.locationId,
    });
  }

  @Post('costing-engine/cost-profiles')
  @Roles('ADMIN', 'PLANNER')
  async createCostProfile(@Request() req: any, @Body() dto: CreateCostProfileDto) {
    return this.costingEngine.upsertCostProfile(req.user.tenantId, dto);
  }

  // ==========================================================================
  // Costing Engine — Transaction Reversals
  // ==========================================================================

  @Post('costing-engine/reverse-transaction')
  @Roles('ADMIN')
  async reverseTransaction(@Request() req: any, @Body() dto: ReverseTransactionDto) {
    return this.costingEngine.reverseTransaction({
      tenantId: req.user.tenantId,
      journalEntryId: dto.journalEntryId,
      reason: dto.reason,
      userId: req.user.id,
    });
  }

  // ==========================================================================
  // Production Lines
  // ==========================================================================

  @Get('production-lines')
  async getProductionLines(@Request() req: any) {
    return this.manufacturingService.getProductionLines(req.user.tenantId);
  }

  @Get('production-lines/:id')
  async getProductionLine(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.getProductionLine(req.user.tenantId, id);
  }

  @Post('production-lines')
  @Roles('ADMIN', 'PLANNER')
  async createProductionLine(@Request() req: any, @Body() dto: CreateProductionLineDto) {
    return this.manufacturingService.createProductionLine(req.user.tenantId, dto);
  }

  @Patch('production-lines/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateProductionLine(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateProductionLineDto) {
    return this.manufacturingService.updateProductionLine(req.user.tenantId, id, dto);
  }

  @Delete('production-lines/:id')
  @Roles('ADMIN')
  async deleteProductionLine(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteProductionLine(req.user.tenantId, id);
  }

  // ==========================================================================
  // Production Line Stations
  // ==========================================================================

  @Post('production-lines/:id/stations')
  @Roles('ADMIN', 'PLANNER')
  async addProductionLineStation(@Request() req: any, @Param('id') id: string, @Body() dto: CreateProductionLineStationDto) {
    return this.manufacturingService.addProductionLineStation(req.user.tenantId, id, dto);
  }

  @Delete('production-lines/:lineId/stations/:stationId')
  @Roles('ADMIN', 'PLANNER')
  async removeProductionLineStation(@Request() req: any, @Param('lineId') lineId: string, @Param('stationId') stationId: string) {
    return this.manufacturingService.removeProductionLineStation(req.user.tenantId, lineId, stationId);
  }

  // ==========================================================================
  // Downtime Reasons
  // ==========================================================================

  @Get('downtime-reasons')
  async getDowntimeReasons(@Request() req: any) {
    return this.manufacturingService.getDowntimeReasons(req.user.tenantId);
  }

  @Post('downtime-reasons')
  @Roles('ADMIN', 'PLANNER')
  async createDowntimeReason(@Request() req: any, @Body() dto: CreateDowntimeReasonDto) {
    return this.manufacturingService.createDowntimeReason(req.user.tenantId, dto);
  }

  @Patch('downtime-reasons/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateDowntimeReason(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateDowntimeReasonDto) {
    return this.manufacturingService.updateDowntimeReason(req.user.tenantId, id, dto);
  }

  @Delete('downtime-reasons/:id')
  @Roles('ADMIN')
  async deleteDowntimeReason(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteDowntimeReason(req.user.tenantId, id);
  }

  // ==========================================================================
  // Downtime Records
  // ==========================================================================

  @Get('downtime-records')
  async getDowntimeRecords(
    @Request() req: any,
    @Query('productionLineId') productionLineId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.manufacturingService.getDowntimeRecords(req.user.tenantId, {
      productionLineId,
      startDate,
      endDate,
    });
  }

  @Post('downtime-records')
  @Roles('ADMIN', 'PLANNER', 'OPERATOR')
  async createDowntimeRecord(@Request() req: any, @Body() dto: CreateDowntimeRecordDto) {
    return this.manufacturingService.createDowntimeRecord(req.user.tenantId, req.user.id, dto);
  }

  @Patch('downtime-records/:id')
  @Roles('ADMIN', 'PLANNER', 'OPERATOR')
  async updateDowntimeRecord(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateDowntimeRecordDto) {
    return this.manufacturingService.updateDowntimeRecord(req.user.tenantId, id, dto);
  }

  @Delete('downtime-records/:id')
  @Roles('ADMIN')
  async deleteDowntimeRecord(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteDowntimeRecord(req.user.tenantId, id);
  }

  // ==========================================================================
  // Scrap Reasons
  // ==========================================================================

  @Get('scrap-reasons')
  async getScrapReasons(@Request() req: any) {
    return this.manufacturingService.getScrapReasons(req.user.tenantId);
  }

  @Post('scrap-reasons')
  @Roles('ADMIN', 'PLANNER')
  async createScrapReason(@Request() req: any, @Body() dto: CreateScrapReasonDto) {
    return this.manufacturingService.createScrapReason(req.user.tenantId, dto);
  }

  @Patch('scrap-reasons/:id')
  @Roles('ADMIN', 'PLANNER')
  async updateScrapReason(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateScrapReasonDto) {
    return this.manufacturingService.updateScrapReason(req.user.tenantId, id, dto);
  }

  @Delete('scrap-reasons/:id')
  @Roles('ADMIN')
  async deleteScrapReason(@Request() req: any, @Param('id') id: string) {
    return this.manufacturingService.deleteScrapReason(req.user.tenantId, id);
  }

  // ==========================================================================
  // Production KPIs
  // ==========================================================================

  @Get('production-kpis')
  async getProductionKPIs(
    @Request() req: any,
    @Query('productionLineId') productionLineId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.manufacturingService.getProductionKPIs(req.user.tenantId, {
      productionLineId,
      startDate,
      endDate,
    });
  }
}
