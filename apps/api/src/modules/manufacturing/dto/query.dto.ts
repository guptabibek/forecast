import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

// ============================================================================
// Shared pagination mixin
// ============================================================================

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

// ============================================================================
// Batches
// ============================================================================

export class GetBatchesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  expiringBefore?: string;

  @IsOptional()
  @IsString()
  expiredOnly?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  daysToExpiry?: number;

  @IsOptional()
  @IsString()
  ageBucket?: string;
}

// ============================================================================
// Inventory Reservations
// ============================================================================

export class GetInventoryReservationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

// ============================================================================
// Inventory Holds
// ============================================================================

export class GetInventoryHoldsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  holdReason?: string;
}

// ============================================================================
// Work Order Costs
// ============================================================================

export class GetWorkOrderCostsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  workOrderId?: string;
}

// ============================================================================
// Inventory Ledger Entries
// ============================================================================

export class GetInventoryLedgerQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsString()
  entryType?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

// ============================================================================
// Journal Entries
// ============================================================================

export class GetJournalEntriesQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

// ============================================================================
// Trial Balance
// ============================================================================

export class GetTrialBalanceQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

// ============================================================================
// Inspection Plans
// ============================================================================

export class GetInspectionPlansQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  inspectionType?: string;

  @IsOptional()
  @IsString()
  isActive?: string;
}

// ============================================================================
// NCRs
// ============================================================================

export class GetNCRsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  workOrderId?: string;
}

// ============================================================================
// CAPAs
// ============================================================================

export class GetCAPAsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  ncrId?: string;
}

// ============================================================================
// Cost Comparison Report
// ============================================================================

export class GetCostComparisonReportQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;
}

// ============================================================================
// Costing Engine Queries
// ============================================================================

export class GetCostingEngineCostLayersQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

export class GetCostingEngineVariancesQueryDto {
  @IsOptional()
  @IsString()
  varianceType?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @IsOptional()
  @IsUUID()
  fiscalPeriodId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

export class GetCostingEngineRevaluationHistoryQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

export class GetPlannedCOGSQueryDto {
  @IsOptional()
  @IsUUID()
  scenarioId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class GetCostProfilesQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
