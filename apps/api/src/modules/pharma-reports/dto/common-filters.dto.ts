import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
    IsArray,
    IsDateString,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Min
} from 'class-validator';

export class PaginationDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class DateRangeDto {
  @ApiPropertyOptional({ description: 'Start date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class InventoryBaseFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by product IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  productIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by location IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  locationIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by batch IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  batchIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by product category' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export enum AgeingBucket {
  ZERO_TO_THREE = '0-3m',
  THREE_TO_SIX = '3-6m',
  SIX_TO_TWELVE = '6-12m',
  OVER_TWELVE = '>12m',
}

export class StockAgeingFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description: 'Custom ageing bucket boundaries in days',
    example: [90, 180, 365],
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  bucketDays?: number[];
}

export class ReorderFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description: 'Number of days to compute average daily sales',
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  avgSalesDays?: number = 30;
}

export class ExpiryFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description: 'Expiry threshold in days (items expiring within this window)',
    default: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  thresholdDays?: number = 90;
}

export class DeadSlowFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description: 'Number of months with no sales to classify as dead stock',
    default: 6,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  deadMonths?: number = 6;
}

export class ABCAnalysisFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({ description: 'A-class threshold (%)', default: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(95)
  thresholdA?: number = 80;

  @ApiPropertyOptional({ description: 'B-class cumulative threshold (%)', default: 95 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(80)
  @Max(99)
  thresholdB?: number = 95;

  @ApiPropertyOptional({
    description: 'Number of months of consumption to analyze',
    default: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(36)
  periodMonths?: number = 12;
}

export class XYZAnalysisFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({ description: 'X-class max CV threshold', default: 0.5 })
  @IsOptional()
  @Type(() => Number)
  @Min(0.1)
  @Max(1.0)
  thresholdX?: number = 0.5;

  @ApiPropertyOptional({ description: 'Y-class max CV threshold', default: 1.0 })
  @IsOptional()
  @Type(() => Number)
  @Min(0.3)
  @Max(2.0)
  thresholdY?: number = 1.0;

  @ApiPropertyOptional({
    description: 'Number of months of consumption to analyze',
    default: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(36)
  periodMonths?: number = 12;
}

export class SupplierPerformanceFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by supplier IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  supplierIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class StockOutFilterDto extends InventoryBaseFilterDto {}

export class SuggestedPurchaseFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description: 'Safety stock multiplier for demand variability',
    default: 1.5,
  })
  @IsOptional()
  @Type(() => Number)
  @Min(1.0)
  @Max(5.0)
  safetyMultiplier?: number = 1.5;
}

export class AlertConfigDto {
  @ApiPropertyOptional({ description: 'Near-expiry threshold in days', default: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  nearExpiryDays?: number = 90;

  @ApiPropertyOptional({
    description: 'Only alert for A-category low stock',
    default: true,
  })
  @IsOptional()
  aClassOnly?: boolean = true;

  @ApiPropertyOptional({ description: 'Max alerts per category', default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(1000)
  alertLimit?: number = 200;
}
