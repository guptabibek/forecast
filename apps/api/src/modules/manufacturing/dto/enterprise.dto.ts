import { CAPAPriority, CAPAStatus, CAPAType, CharacteristicType, GLAccountType, NCRDisposition, NCRStatus, NormalBalance, PostingTransactionType, QualityInspectionType, SamplingProcedure } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

// ============================================================================
// GL Account DTOs
// ============================================================================

export class CreateGLAccountDto {
  @IsString()
  accountNumber: string;

  @IsString()
  name: string;

  @IsEnum(GLAccountType)
  accountType: GLAccountType;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsEnum(NormalBalance)
  normalBalance?: NormalBalance;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}

export class UpdateGLAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

// ============================================================================
// Posting Profile DTOs
// ============================================================================

export class CreatePostingProfileDto {
  @IsString()
  profileName: string;

  @IsEnum(PostingTransactionType)
  transactionType: PostingTransactionType;

  @IsUUID()
  debitAccountId: string;

  @IsUUID()
  creditAccountId: string;

  @IsOptional()
  @IsString()
  productCategory?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

// ============================================================================
// Journal Entry DTOs
// ============================================================================

export class JournalEntryLineDto {
  @IsUUID()
  glAccountId: string;

  @IsOptional()
  @IsNumber()
  debitAmount?: number;

  @IsOptional()
  @IsNumber()
  creditAmount?: number;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateJournalEntryDto {
  @IsDateString()
  entryDate: string;

  @IsString()
  referenceType: string;

  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines: JournalEntryLineDto[];
}

// ============================================================================
// Inspection Plan DTOs
// ============================================================================

export class InspectionCharacteristicDto {
  @IsString()
  characteristicName: string;

  @IsOptional()
  @IsEnum(CharacteristicType)
  characteristicType?: CharacteristicType;

  @IsOptional()
  @IsString()
  uom?: string;

  @IsOptional()
  @IsNumber()
  lowerLimit?: number;

  @IsOptional()
  @IsNumber()
  upperLimit?: number;

  @IsOptional()
  @IsNumber()
  targetValue?: number;

  @IsOptional()
  @IsBoolean()
  isCritical?: boolean;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  equipment?: string;
}

export class CreateInspectionPlanDto {
  @IsString()
  planNumber: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsEnum(QualityInspectionType)
  inspectionType: QualityInspectionType;

  @IsOptional()
  @IsEnum(SamplingProcedure)
  samplingProcedure?: SamplingProcedure;

  @IsOptional()
  @IsNumber()
  sampleSize?: number;

  @IsOptional()
  @IsNumber()
  samplePercentage?: number;

  @IsOptional()
  @IsString()
  aqlLevel?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionCharacteristicDto)
  characteristics?: InspectionCharacteristicDto[];
}

// ============================================================================
// Inspection Result DTOs
// ============================================================================

export class RecordInspectionResultDto {
  @IsUUID()
  characteristicId: string;

  @IsOptional()
  @IsNumber()
  measuredValue?: number;

  @IsOptional()
  @IsString()
  qualitativeResult?: string;

  @IsOptional()
  @IsString()
  inspectorId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordInspectionResultsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordInspectionResultDto)
  results: RecordInspectionResultDto[];
}

// ============================================================================
// NCR DTOs
// ============================================================================

export class UpdateNCRStatusDto {
  @IsEnum(NCRStatus)
  status: NCRStatus;

  @IsOptional()
  @IsEnum(NCRDisposition)
  disposition?: NCRDisposition;

  @IsOptional()
  @IsNumber()
  dispositionQty?: number;

  @IsOptional()
  @IsString()
  rootCause?: string;

  @IsOptional()
  @IsString()
  containmentAction?: string;

  @IsOptional()
  @IsNumber()
  costImpact?: number;
}

// ============================================================================
// CAPA DTOs
// ============================================================================

export class CreateCAPADto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsEnum(CAPAType)
  capaType?: CAPAType;

  @IsOptional()
  @IsEnum(CAPAPriority)
  priority?: CAPAPriority;

  @IsOptional()
  @IsUUID()
  ncrId?: string;

  @IsString()
  proposedAction: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @IsDateString()
  dueDate: string;
}

export class UpdateCAPAStatusDto {
  @IsEnum(CAPAStatus)
  status: CAPAStatus;

  @IsOptional()
  @IsString()
  actualAction?: string;

  @IsOptional()
  @IsString()
  verificationMethod?: string;

  @IsOptional()
  @IsString()
  verificationResult?: string;

  @IsOptional()
  @IsUUID()
  verifiedById?: string;

  @IsOptional()
  @IsDateString()
  completedDate?: string;

  @IsOptional()
  @IsBoolean()
  effectivenessCheck?: boolean;

  @IsOptional()
  @IsNumber()
  costOfAction?: number;
}

// ============================================================================
// Costing DTOs
// ============================================================================

export class CostRollUpDto {
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  version?: string;
}

export class BatchCostRollUpDto {
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}

// ============================================================================
// Inventory Hold Release DTO
// ============================================================================

export class ReleaseInventoryHoldDto {
  @IsOptional()
  @IsNumber()
  releaseQty?: number;
}

// ============================================================================
// Inventory Ledger Reconcile DTO
// ============================================================================

export class ReconcileInventoryDto {
  @IsUUID()
  productId: string;

  @IsUUID()
  locationId: string;
}

// ============================================================================
// Costing Engine DTOs
// ============================================================================

export class RollupStandardCostDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  version?: string;
}

export class LandedCostAllocationItemDto {
  @IsUUID()
  goodsReceiptLineId: string;

  @IsOptional()
  @IsUUID()
  costLayerId?: string;

  @IsUUID()
  productId: string;

  @IsUUID()
  locationId: string;

  @IsString()
  costCategory: string;

  @IsNumber()
  amount: number;
}

export class AllocateLandedCostDto {
  @IsUUID()
  goodsReceiptId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LandedCostAllocationItemDto)
  allocations: LandedCostAllocationItemDto[];

  @IsString()
  allocationMethod: string;

  @IsOptional()
  @IsString()
  vendorInvoiceRef?: string;

  @IsOptional()
  @IsUUID()
  fiscalPeriodId?: string;
}

export class RevalueInventoryDto {
  @IsUUID()
  productId: string;

  @IsUUID()
  locationId: string;

  @IsNumber()
  newUnitCost: number;

  @IsString()
  reason: string;

  @IsOptional()
  @IsUUID()
  fiscalPeriodId?: string;
}

export class PeriodActionDto {
  @IsUUID()
  fiscalPeriodId: string;
}

export class ReopenPeriodDto {
  @IsUUID()
  fiscalPeriodId: string;

  @IsString()
  reason: string;
}

export class ScenarioCostComparisonDto {
  @IsArray()
  @IsUUID(4, { each: true })
  scenarioIds: string[];

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

export class CreateCostProfileDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsString()
  costingMethod: string;

  @IsOptional()
  @IsString()
  standardCostVersion?: string;

  @IsOptional()
  @IsBoolean()
  enableLandedCost?: boolean;

  @IsOptional()
  @IsNumber()
  overheadRate?: number;

  @IsOptional()
  @IsNumber()
  laborRate?: number;
}

export class ReverseTransactionDto {
  @IsUUID()
  journalEntryId: string;

  @IsString()
  reason: string;
}
