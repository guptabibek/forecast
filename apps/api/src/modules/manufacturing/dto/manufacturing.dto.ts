import {
    ApproverType,
    AssumptionStatus,
    BOMStatus,
    BOMType,
    CapacityPlanType,
    CostType,
    FiscalCalendarType,
    PromotionType,
    PurchaseContractType,
    QualityInspectionStatus,
    QualityInspectionType,
    RiskLevel,
    SOPForecastSource,
    SOPStatus,
    SupplyType,
    WorkCenterType,
    WorkflowEntityType
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';

// ============================================================================
// BOM DTOs
// ============================================================================

export class BomComponentItemDto {
  @IsUUID()
  componentProductId: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsString()
  uom: string;

  @IsOptional()
  @IsInt()
  sequence?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  scrapPercent?: number;

  @IsOptional()
  @IsEnum(SupplyType)
  supplyType?: SupplyType;

  @IsOptional()
  @IsInt()
  leadTimeOffset?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateBomDto {
  @IsUUID()
  parentProductId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseQuantity?: number;

  @IsOptional()
  @IsString()
  baseUOM?: string;

  @IsOptional()
  @IsDateString()
  @Type(() => Date)
  effectiveFrom?: Date;

  @IsOptional()
  @IsDateString()
  @Type(() => Date)
  effectiveTo?: Date;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(BOMType)
  type?: BOMType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomComponentItemDto)
  components?: BomComponentItemDto[];
}

export class CreateBomFromApiComponentDto {
  @IsUUID()
  componentProductId: string;

  @IsOptional()
  @IsNumber()
  quantityPer?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsString()
  uom?: string;

  @IsOptional()
  @IsInt()
  position?: number;

  @IsOptional()
  @IsInt()
  sequence?: number;

  @IsOptional()
  @IsNumber()
  wastagePercent?: number;

  @IsOptional()
  @IsNumber()
  scrapPercent?: number;

  @IsOptional()
  @IsString()
  supplyType?: string;

  @IsOptional()
  @IsInt()
  leadTimeOffset?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateBomFromApiDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  parentProductId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  revision?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsNumber()
  baseQuantity?: number;

  @IsOptional()
  @IsString()
  baseUOM?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  bomType?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBomFromApiComponentDto)
  components?: CreateBomFromApiComponentDto[];
}

export class UpdateBomDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  revision?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  bomType?: string;

  @IsOptional()
  @IsEnum(BOMStatus)
  status?: BOMStatus;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsNumber()
  baseQuantity?: number;

  @IsOptional()
  @IsString()
  baseUOM?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddBomComponentDto {
  @IsUUID()
  componentProductId: string;

  @IsOptional()
  @IsNumber()
  quantityPer?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsString()
  uom?: string;

  @IsOptional()
  @IsInt()
  position?: number;

  @IsOptional()
  @IsInt()
  sequence?: number;

  @IsOptional()
  @IsNumber()
  wastagePercent?: number;

  @IsOptional()
  @IsInt()
  leadTimeOffset?: number;

  @IsOptional()
  @IsBoolean()
  isPhantom?: boolean;

  @IsOptional()
  @IsString()
  supplyType?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBomComponentDto {
  @IsOptional()
  @IsNumber()
  quantityPer?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsString()
  uom?: string;

  @IsOptional()
  @IsInt()
  position?: number;

  @IsOptional()
  @IsInt()
  sequence?: number;

  @IsOptional()
  @IsNumber()
  wastagePercent?: number;

  @IsOptional()
  @IsNumber()
  scrapPercent?: number;

  @IsOptional()
  @IsInt()
  leadTimeOffset?: number;

  @IsOptional()
  @IsBoolean()
  isPhantom?: boolean;

  @IsOptional()
  @IsString()
  supplyType?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CopyBomDto {
  @IsOptional()
  @IsUUID()
  targetProductId?: string;

  @IsOptional()
  @IsString()
  newRevision?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  copyComponents?: boolean;
}

export class UpdateBomStatusDto {
  @IsEnum(BOMStatus)
  status: BOMStatus;
}

// ============================================================================
// Work Center DTOs
// ============================================================================

export class CreateWorkCenterDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(WorkCenterType)
  type: WorkCenterType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPerHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  setupCostPerHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  efficiency?: number;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class UpdateWorkCenterDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(WorkCenterType)
  type?: WorkCenterType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPerHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  setupCostPerHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  efficiencyPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  efficiency?: number;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}

// ============================================================================
// Capacity DTOs
// ============================================================================

export class CreateCapacityDto {
  @IsDateString()
  effectiveDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  standardCapacityPerHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capacityPerDay?: number;

  @IsOptional()
  @IsString()
  capacityUOM?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  numberOfMachines?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  numberOfShifts?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  availableHoursPerDay?: number;
}

export class UpdateCapacityDto {
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  standardCapacityPerHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capacityPerDay?: number;

  @IsOptional()
  @IsString()
  capacityUOM?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  numberOfMachines?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  numberOfShifts?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  availableHoursPerDay?: number;
}

// ============================================================================
// Shift DTOs
// ============================================================================

export class CreateShiftDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  daysOfWeek?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  breakMinutes?: number;
}

export class UpdateShiftDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  daysOfWeek?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================================================
// Simulate Load Balancing DTO
// ============================================================================

export class SimulateLoadBalancingDto {
  @IsUUID()
  sourceWorkCenterId: string;

  @IsArray()
  @IsUUID(undefined, { each: true })
  targetWorkCenterIds: string[];

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxShiftPercent?: number;
}

// ============================================================================
// Inventory Policy DTOs
// ============================================================================

export class CreateInventoryPolicyDto {
  @IsUUID()
  productId: string;

  @IsUUID()
  locationId: string;

  @IsString()
  planningMethod: string;

  @IsString()
  lotSizingRule: string;

  @IsString()
  safetyStockMethod: string;

  @IsOptional()
  @IsNumber()
  safetyStockQty?: number;

  @IsOptional()
  @IsInt()
  safetyStockDays?: number;

  @IsOptional()
  @IsNumber()
  serviceLevel?: number;

  @IsOptional()
  @IsNumber()
  reorderPoint?: number;

  @IsOptional()
  @IsNumber()
  reorderQty?: number;

  @IsOptional()
  @IsNumber()
  minOrderQty?: number;

  @IsOptional()
  @IsNumber()
  maxOrderQty?: number;

  @IsOptional()
  @IsInt()
  leadTimeDays?: number;

  @IsOptional()
  @IsDateString()
  @Type(() => Date)
  effectiveFrom?: Date;
}

export class UpsertInventoryPolicyDto {
  @IsUUID()
  productId: string;

  @IsUUID()
  locationId: string;

  @IsOptional()
  @IsString()
  planningMethod?: string;

  @IsOptional()
  @IsString()
  lotSizingRule?: string;

  @IsOptional()
  @IsString()
  safetyStockMethod?: string;

  @IsOptional()
  @IsNumber()
  safetyStockQty?: number;

  @IsOptional()
  @IsInt()
  safetyStockDays?: number;

  @IsOptional()
  @IsNumber()
  serviceLevel?: number;

  @IsOptional()
  @IsNumber()
  reorderPoint?: number;

  @IsOptional()
  @IsNumber()
  reorderQty?: number;

  @IsOptional()
  @IsNumber()
  minOrderQty?: number;

  @IsOptional()
  @IsNumber()
  maxOrderQty?: number;

  @IsOptional()
  @IsInt()
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  abcClass?: string;

  @IsOptional()
  @IsString()
  xyzClass?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

// ============================================================================
// Inventory Level DTOs
// ============================================================================

export class UpsertInventoryLevelDto {
  @IsUUID()
  productId: string;

  @IsUUID()
  locationId: string;

  @IsOptional()
  @IsNumber()
  onHandQty?: number;

  @IsOptional()
  @IsNumber()
  allocatedQty?: number;

  @IsOptional()
  @IsNumber()
  availableQty?: number;

  @IsOptional()
  @IsNumber()
  inTransitQty?: number;

  @IsOptional()
  @IsNumber()
  onOrderQty?: number;

  @IsOptional()
  @IsNumber()
  reservedQty?: number;

  @IsOptional()
  @IsNumber()
  standardCost?: number;

  @IsOptional()
  @IsNumber()
  averageCost?: number;
}

// ============================================================================
// EOQ / ABC / XYZ Classification DTOs
// ============================================================================

export class CalculateEOQDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  annualDemand?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  holdingCostPercent?: number;
}

export class RunABCClassificationDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  aThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  bThreshold?: number;
}

export class RunXYZClassificationDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

// ============================================================================
// MRP DTOs
// ============================================================================

export class CreateMRPRunDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  runType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  planningHorizonDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  frozenPeriodDays?: number;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  locationIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productIds?: string[];

  @IsOptional()
  @IsBoolean()
  respectLeadTime?: boolean;

  @IsOptional()
  @IsBoolean()
  considerSafetyStock?: boolean;
}

// ============================================================================
// Planned Order DTOs
// ============================================================================

export class CreatePlannedOrderDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsString()
  orderType: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

export class UpdatePlannedOrderDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkUpdatePlannedOrdersDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  @ArrayMinSize(1)
  orderIds: string[];

  @IsString()
  @IsNotEmpty()
  action: string;
}

// ============================================================================
// Fiscal Calendar DTOs
// ============================================================================

export class CreateFiscalCalendarDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(FiscalCalendarType)
  type: FiscalCalendarType;

  @IsInt()
  @Min(1)
  @Max(12)
  startMonth: number;

  @IsOptional()
  @IsInt()
  weekStartDay?: number;

  @IsOptional()
  @IsString()
  patternType?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateFiscalCalendarDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEnum(FiscalCalendarType)
  type?: FiscalCalendarType;

  @IsOptional()
  @IsInt()
  yearStartMonth?: number;

  @IsOptional()
  @IsInt()
  yearStartDay?: number;

  @IsOptional()
  @IsInt()
  weekStartDay?: number;

  @IsOptional()
  @IsString()
  patternType?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateFiscalPeriodDto {
  @IsInt()
  fiscalYear: number;

  @IsInt()
  @Min(1)
  @Max(4)
  fiscalQuarter: number;

  @IsInt()
  @Min(1)
  @Max(12)
  fiscalMonth: number;

  @IsOptional()
  @IsInt()
  fiscalWeek?: number;

  @IsString()
  @IsNotEmpty()
  periodName: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  workingDays?: number;

  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;
}

export class UpdateFiscalPeriodDto {
  @IsOptional()
  @IsString()
  periodName?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  workingDays?: number;

  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;
}

export class GenerateFiscalPeriodsV2Dto {
  @IsOptional()
  @IsInt()
  fiscalYear?: number;

  @IsOptional()
  @IsInt()
  year?: number;
}

export class CalculateWorkingDaysDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

// ============================================================================
// S&OP DTOs
// ============================================================================

export class CreateSOPCycleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  fiscalYear: number;

  @IsInt()
  fiscalPeriod: number;

  @IsDateString()
  @Type(() => Date)
  planningStart: Date;

  @IsDateString()
  @Type(() => Date)
  demandReviewDate: Date;

  @IsDateString()
  @Type(() => Date)
  supplyReviewDate: Date;

  @IsDateString()
  @Type(() => Date)
  preSopDate: Date;

  @IsDateString()
  @Type(() => Date)
  executiveSopDate: Date;

  @IsDateString()
  @Type(() => Date)
  planningEnd: Date;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateSOPCycleV2Dto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  year?: number;

  @IsOptional()
  @IsInt()
  fiscalYear?: number;

  @IsOptional()
  @IsInt()
  month?: number;

  @IsOptional()
  @IsInt()
  fiscalPeriod?: number;

  @IsOptional()
  @IsInt()
  horizonMonths?: number;

  @IsOptional()
  @IsDateString()
  planningStart?: string;

  @IsOptional()
  @IsDateString()
  planningEnd?: string;

  @IsOptional()
  @IsDateString()
  demandReviewDate?: string;

  @IsOptional()
  @IsDateString()
  supplyReviewDate?: string;

  @IsOptional()
  @IsDateString()
  preSopDate?: string;

  @IsOptional()
  @IsDateString()
  executiveMeetingDate?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateSOPCycleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  demandReviewDate?: string;

  @IsOptional()
  @IsDateString()
  supplyReviewDate?: string;

  @IsOptional()
  @IsDateString()
  executiveMeetingDate?: string;

  @IsOptional()
  @IsInt()
  horizonMonths?: number;

  @IsOptional()
  @IsDateString()
  planningEnd?: string;
}

export class UpdateSOPCycleStatusDto {
  @IsEnum(SOPStatus)
  status: SOPStatus;
}

export class UpsertSOPForecastDto {
  @IsEnum(SOPForecastSource)
  source: SOPForecastSource;

  @IsOptional()
  @IsNumber()
  quantityUnits?: number;

  @IsOptional()
  @IsNumber()
  quantityRevenue?: number;

  @IsOptional()
  periodForecasts?: any;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkUpsertSOPForecastsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertSOPForecastDto)
  forecasts: UpsertSOPForecastDto[];
}

export class CopySOPForecastsDto {
  // copySOPForecasts doesn't use any specific body fields currently
  // but included for completeness / future use
}

export class ImportSOPStatisticalDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CreateSOPAssumptionDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  assumption: string;

  @IsOptional()
  @IsString()
  impactDescription?: string;

  @IsOptional()
  @IsNumber()
  quantitativeImpact?: number;

  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;

  @IsOptional()
  @IsUUID()
  owner?: string;
}

export class UpdateSOPAssumptionDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  assumption?: string;

  @IsOptional()
  @IsString()
  impactDescription?: string;

  @IsOptional()
  @IsNumber()
  quantitativeImpact?: number;

  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;

  @IsOptional()
  @IsUUID()
  owner?: string;

  @IsOptional()
  @IsEnum(AssumptionStatus)
  status?: AssumptionStatus;
}

// ============================================================================
// Supplier DTOs
// ============================================================================

export class CreateSupplierDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultLeadTimeDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumOrderValue?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isPreferred?: boolean;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultLeadTimeDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumOrderValue?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isPreferred?: boolean;
}

export class LinkSupplierProductDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsString()
  supplierPartNumber?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumOrderQty?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderMultiple?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class BulkLinkSupplierProductsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkSupplierProductDto)
  products: LinkSupplierProductDto[];
}

export class UpdateSupplierProductDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumOrderQty?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderMultiple?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

// ============================================================================
// Promotion DTOs
// ============================================================================

export class CreatePromotionDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(PromotionType)
  type: PromotionType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsNumber()
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  marketingSpend?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  locationIds?: string[];
}

export class UpdatePromotionDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PromotionType)
  type?: PromotionType;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  marketingSpend?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  locationIds?: string[];
}

export class UpdatePromotionStatusDto {
  @IsString()
  @IsNotEmpty()
  status: string;
}

export class UpsertPromotionLiftFactorDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsNumber()
  liftPercent: number;

  @IsOptional()
  @IsNumber()
  cannibalizationPercent?: number;

  @IsOptional()
  @IsNumber()
  haloPercent?: number;
}

export class BulkUpsertPromotionLiftFactorsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertPromotionLiftFactorDto)
  liftFactors: UpsertPromotionLiftFactorDto[];
}

export class CopyPromotionDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

// ============================================================================
// NPI DTOs
// ============================================================================

export class CreateNPIDto {
  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  launchDate?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  plannedLocationIds?: string[];

  @IsOptional()
  @IsUUID()
  analogProductId?: string;

  @IsOptional()
  @IsString()
  launchCurveType?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  rampUpMonths?: number;

  @IsOptional()
  @IsInt()
  peakMonthsSinceLaunch?: number;

  @IsOptional()
  @IsNumber()
  peakForecastUnits?: number;

  @IsOptional()
  @IsNumber()
  initialPrice?: number;

  @IsOptional()
  @IsNumber()
  targetMargin?: number;
}

export class UpdateNPIDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  launchDate?: string;

  @IsOptional()
  @IsUUID()
  analogProductId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  plannedLocationIds?: string[];

  @IsOptional()
  @IsString()
  launchCurveType?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  rampUpMonths?: number;

  @IsOptional()
  @IsInt()
  peakMonthsSinceLaunch?: number;

  @IsOptional()
  @IsNumber()
  peakForecastUnits?: number;

  @IsOptional()
  @IsNumber()
  initialPrice?: number;

  @IsOptional()
  @IsNumber()
  targetMargin?: number;
}

export class UpdateNPIStatusDto {
  @IsString()
  @IsNotEmpty()
  status: string;
}

export class GenerateNPIForecastDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  months?: number;

  @IsOptional()
  @IsBoolean()
  useAnalog?: boolean;

  @IsOptional()
  @IsNumber()
  adjustmentPercent?: number;

  @IsOptional()
  @IsNumber()
  peakForecastUnits?: number;

  @IsOptional()
  @IsString()
  launchCurveType?: string;
}

export class SetNPIAnalogDto {
  @IsUUID()
  analogProductId: string;
}

export class ConvertNPIToProductDto {
  // Currently a passthrough, but included for contract stability
}

// ============================================================================
// Workflow DTOs
// ============================================================================

export class WorkflowStepItemDto {
  @IsInt()
  stepOrder: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ApproverType)
  approverType: ApproverType;

  @IsOptional()
  @IsString()
  approverRole?: string;

  @IsOptional()
  @IsUUID()
  approverId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  requiredApprovals?: number;
}

export class CreateWorkflowTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(WorkflowEntityType)
  entityType: WorkflowEntityType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepItemDto)
  steps?: WorkflowStepItemDto[];
}

export class UpdateWorkflowTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(WorkflowEntityType)
  entityType?: WorkflowEntityType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AddWorkflowStepDto {
  @IsInt()
  stepOrder: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ApproverType)
  approverType: ApproverType;

  @IsOptional()
  @IsString()
  approverRole?: string;

  @IsOptional()
  @IsUUID()
  approverId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  requiredApprovals?: number;
}

export class UpdateWorkflowStepDto {
  @IsOptional()
  @IsInt()
  stepOrder?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ApproverType)
  approverType?: ApproverType;

  @IsOptional()
  @IsString()
  approverRole?: string;

  @IsOptional()
  @IsUUID()
  approverId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  requiredApprovals?: number;
}

export class StartWorkflowDto {
  @IsEnum(WorkflowEntityType)
  entityType: WorkflowEntityType;

  @IsUUID()
  entityId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// Purchase Order DTOs
// ============================================================================

export class PurchaseOrderLineItemDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  supplierId: string;

  @IsDateString()
  expectedDate: string;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => PurchaseOrderLineItemDto)
  lines: PurchaseOrderLineItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class UpdatePurchaseOrderLineItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePurchaseOrderLineItemDto)
  lines?: UpdatePurchaseOrderLineItemDto[];
}

// ============================================================================
// Goods Receipt DTOs
// ============================================================================

export class GoodsReceiptLineItemDto {
  @IsString()
  purchaseOrderLineId: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsString()
  lotNumber?: string;
}

export class CreateGoodsReceiptDto {
  @IsUUID()
  purchaseOrderId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => GoodsReceiptLineItemDto)
  lines: GoodsReceiptLineItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// Work Order DTOs
// ============================================================================

export class CreateWorkOrderDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsDateString()
  scheduledStart: string;

  @IsDateString()
  scheduledEnd: string;

  @IsOptional()
  @IsUUID()
  workCenterId?: string;

  @IsOptional()
  @IsUUID()
  bomId?: string;

  @IsOptional()
  @IsUUID()
  routingId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  priority?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// Operation DTOs
// ============================================================================

export class CompleteOperationDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualSetupTime?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  actualRunTime?: number;
}

// ============================================================================
// Material Issue DTOs
// ============================================================================

export class IssueMaterialDto {
  @IsUUID()
  workOrderId: string;

  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsString()
  lotNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// Production Completion DTOs
// ============================================================================

export class ReportProductionCompletionDto {
  @IsUUID()
  workOrderId: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  scrapQuantity?: number;

  @IsOptional()
  @IsUUID()
  operationId?: string;

  @IsOptional()
  @IsString()
  lotNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// Labor Entry DTOs
// ============================================================================

export class RecordLaborDto {
  @IsUUID()
  operationId: string;

  @IsString()
  @IsNotEmpty()
  laborType: 'SETUP' | 'RUN' | 'IDLE' | 'REWORK' | 'TEARDOWN';

  @IsDateString()
  startTime: string;

  @IsDateString()
  endTime: string;

  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// Inventory Transaction DTOs
// ============================================================================

export class CreateInventoryTransactionDto {
  @IsUUID()
  productId: string;

  @IsString()
  @IsNotEmpty()
  transactionType: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @IsOptional()
  @IsUUID()
  toLocationId?: string;

  @IsOptional()
  @IsString()
  lotNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AdjustInventoryDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class TransferInventoryDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsUUID()
  fromLocation: string;

  @IsUUID()
  toLocation: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// Forecast Accuracy Metric DTOs
// ============================================================================

export class CreateForecastAccuracyMetricDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsDateString()
  periodDate: string;

  @IsNumber()
  forecastQty: number;

  @IsNumber()
  actualQty: number;

  @IsOptional()
  @IsNumber()
  mape?: number;

  @IsOptional()
  @IsNumber()
  bias?: number;

  @IsOptional()
  @IsNumber()
  trackingSignal?: number;

  @IsOptional()
  @IsNumber()
  mad?: number;

  @IsOptional()
  @IsString()
  forecastModel?: string;

  @IsOptional()
  @IsString()
  forecastVersion?: string;

  @IsOptional()
  @IsString()
  granularity?: string;
}

export class UpdateForecastAccuracyMetricDto {
  @IsOptional()
  @IsNumber()
  forecastQty?: number;

  @IsOptional()
  @IsNumber()
  actualQty?: number;

  @IsOptional()
  @IsNumber()
  mape?: number;

  @IsOptional()
  @IsNumber()
  bias?: number;

  @IsOptional()
  @IsNumber()
  trackingSignal?: number;

  @IsOptional()
  @IsNumber()
  mad?: number;

  @IsOptional()
  @IsString()
  forecastModel?: string;

  @IsOptional()
  @IsString()
  forecastVersion?: string;

  @IsOptional()
  @IsString()
  granularity?: string;
}

// ============================================================================
// Quality Inspection DTOs
// ============================================================================

export class CreateQualityInspectionDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  workOrderId?: string;

  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @IsOptional()
  @IsUUID()
  goodsReceiptId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsEnum(QualityInspectionType)
  inspectionType: QualityInspectionType;

  @IsNumber()
  @Min(0)
  inspectedQty: number;

  @IsOptional()
  @IsString()
  defectType?: string;

  @IsOptional()
  @IsString()
  defectDescription?: string;

  @IsOptional()
  @IsUUID()
  inspectorId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateQualityInspectionDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  acceptedQty?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectedQty?: number;

  @IsOptional()
  @IsString()
  defectType?: string;

  @IsOptional()
  @IsString()
  defectDescription?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  results?: any;
}

export class UpdateQualityInspectionStatusDto {
  @IsEnum(QualityInspectionStatus)
  status: QualityInspectionStatus;
}

// ============================================================================
// UOM Master DTOs
// ============================================================================

export class CreateUomDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  decimals?: number;

  @IsOptional()
  @IsBoolean()
  isBase?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateUomDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  decimals?: number;

  @IsOptional()
  @IsBoolean()
  isBase?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

// ============================================================================
// UOM Conversion DTOs
// ============================================================================

export class CreateUomConversionDto {
  @IsString()
  @IsNotEmpty()
  fromUom: string;

  @IsString()
  @IsNotEmpty()
  toUom: string;

  @IsOptional()
  @IsUUID()
  fromUomId?: string;

  @IsOptional()
  @IsUUID()
  toUomId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsNumber()
  factor: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUomConversionDto {
  @IsOptional()
  @IsNumber()
  factor?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================================================
// Location Hierarchy DTOs
// ============================================================================

export class CreateLocationHierarchyDto {
  @IsUUID()
  locationId: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  level?: number;

  @IsOptional()
  @IsString()
  hierarchyType?: string;

  @IsOptional()
  @IsString()
  path?: string;
}

export class UpdateLocationHierarchyDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  level?: number;

  @IsOptional()
  @IsString()
  hierarchyType?: string;

  @IsOptional()
  @IsString()
  path?: string;
}

// ============================================================================
// Capacity Plan DTOs
// ============================================================================

export class CreateCapacityPlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CapacityPlanType)
  planType?: CapacityPlanType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  planningHorizon?: number;

  @IsOptional()
  @IsString()
  granularity?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

export class UpdateCapacityPlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CapacityPlanType)
  planType?: CapacityPlanType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  planningHorizon?: number;

  @IsOptional()
  @IsString()
  granularity?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CreateCapacityPlanBucketDto {
  @IsUUID()
  workCenterId: string;

  @IsDateString()
  periodDate: string;

  @IsOptional()
  @IsNumber()
  availableCapacity?: number;

  @IsOptional()
  @IsNumber()
  requiredCapacity?: number;

  @IsOptional()
  @IsNumber()
  loadPercent?: number;

  @IsOptional()
  @IsBoolean()
  overloadFlag?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCapacityPlanBucketDto {
  @IsOptional()
  @IsDateString()
  periodDate?: string;

  @IsOptional()
  @IsNumber()
  availableCapacity?: number;

  @IsOptional()
  @IsNumber()
  requiredCapacity?: number;

  @IsOptional()
  @IsNumber()
  loadPercent?: number;

  @IsOptional()
  @IsBoolean()
  overloadFlag?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// SOP Gap Analysis DTOs
// ============================================================================

export class CreateSOPGapAnalysisDto {
  @IsUUID()
  cycleId: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsDateString()
  periodDate: string;

  @IsOptional()
  @IsNumber()
  demandQty?: number;

  @IsOptional()
  @IsNumber()
  supplyQty?: number;

  @IsOptional()
  @IsNumber()
  gapQty?: number;

  @IsOptional()
  @IsNumber()
  gapRevenue?: number;

  @IsOptional()
  @IsNumber()
  gapCost?: number;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}

export class UpdateSOPGapAnalysisDto {
  @IsOptional()
  @IsNumber()
  demandQty?: number;

  @IsOptional()
  @IsNumber()
  supplyQty?: number;

  @IsOptional()
  @IsNumber()
  gapQty?: number;

  @IsOptional()
  @IsNumber()
  gapRevenue?: number;

  @IsOptional()
  @IsNumber()
  gapCost?: number;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

// ============================================================================
// Purchase Contract DTOs
// ============================================================================

export class CreatePurchaseContractLineDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  agreedPrice: number;

  @IsOptional()
  @IsNumber()
  agreedQty?: number;

  @IsOptional()
  @IsNumber()
  minOrderQty?: number;

  @IsOptional()
  @IsInt()
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  uom?: string;
}

export class UpdatePurchaseContractLineDto {
  @IsOptional()
  @IsNumber()
  agreedPrice?: number;

  @IsOptional()
  @IsNumber()
  agreedQty?: number;

  @IsOptional()
  @IsNumber()
  consumedQty?: number;

  @IsOptional()
  @IsNumber()
  minOrderQty?: number;

  @IsOptional()
  @IsInt()
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  uom?: string;
}

export class CreatePurchaseContractDto {
  @IsString()
  @IsNotEmpty()
  contractNumber: string;

  @IsUUID()
  supplierId: string;

  @IsOptional()
  @IsEnum(PurchaseContractType)
  contractType?: PurchaseContractType;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsNumber()
  totalValue?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseContractLineDto)
  lines?: CreatePurchaseContractLineDto[];
}

export class UpdatePurchaseContractDto {
  @IsOptional()
  @IsEnum(PurchaseContractType)
  contractType?: PurchaseContractType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  totalValue?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// Product Costing DTOs
// ============================================================================

export class CreateProductCostingDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsEnum(CostType)
  costType?: CostType;

  @IsDateString()
  effectiveFrom: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsNumber()
  materialCost?: number;

  @IsOptional()
  @IsNumber()
  laborCost?: number;

  @IsOptional()
  @IsNumber()
  overheadCost?: number;

  @IsOptional()
  @IsNumber()
  subcontractCost?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateProductCostingDto {
  @IsOptional()
  @IsEnum(CostType)
  costType?: CostType;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsNumber()
  materialCost?: number;

  @IsOptional()
  @IsNumber()
  laborCost?: number;

  @IsOptional()
  @IsNumber()
  overheadCost?: number;

  @IsOptional()
  @IsNumber()
  subcontractCost?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ──── Batch DTOs ────

export class CreateBatchDto {
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @IsNotEmpty()
  @IsUUID()
  locationId: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsNumber()
  availableQty?: number;

  @IsOptional()
  @IsString()
  uom?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  manufacturingDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @IsOptional()
  @IsUUID()
  workOrderId?: string;

  @IsOptional()
  @IsNumber()
  costPerUnit?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBatchDto {
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  availableQty?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsNumber()
  costPerUnit?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ============================================================================
// Product Category Master
// ============================================================================

export class CreateProductCategoryDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================================================
// Production Branch DTOs
// ============================================================================

export class CreateProductionLineDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsNumber()
  outputRate?: number;

  @IsOptional()
  @IsString()
  outputUom?: string;
}

export class UpdateProductionLineDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  outputRate?: number;

  @IsOptional()
  @IsString()
  outputUom?: string;
}

export class CreateProductionLineStationDto {
  @IsString()
  workCenterId: string;

  @IsOptional()
  @IsInt()
  sequence?: number;

  @IsOptional()
  @IsString()
  stationName?: string;

  @IsOptional()
  @IsBoolean()
  isBottleneck?: boolean;
}

export class CreateDowntimeReasonDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isPlanned?: boolean;
}

export class UpdateDowntimeReasonDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isPlanned?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateDowntimeRecordDto {
  @IsString()
  downtimeReasonId: string;

  @IsOptional()
  @IsString()
  productionLineId?: string;

  @IsOptional()
  @IsString()
  workOrderId?: string;

  @IsDateString()
  startTime: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @IsNumber()
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDowntimeRecordDto {
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @IsNumber()
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateScrapReasonDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class UpdateScrapReasonDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
