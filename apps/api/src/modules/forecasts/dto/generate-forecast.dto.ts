import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ForecastModel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class ExternalSignalDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0.01)
  @Max(10)
  factor: number;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class GenerateForecastDto {
  @ApiProperty({ description: 'Plan version ID' })
  @IsUUID()
  planVersionId: string;

  @ApiProperty({ description: 'Scenario ID' })
  @IsUUID()
  scenarioId: string;

  @ApiProperty({ 
    description: 'Forecast models to use', 
    enum: ForecastModel,
    isArray: true,
    example: ['HOLT_WINTERS', 'MOVING_AVERAGE']
  })
  @IsArray()
  @IsEnum(ForecastModel, { each: true })
  models: ForecastModel[];

  @ApiPropertyOptional({ description: 'Start date for forecast period (defaults to plan start date)' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for forecast period (defaults to plan end date)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Number of forecast periods (defaults to 12)', minimum: 1, maximum: 120 })
  @IsNumber()
  @Min(1)
  @Max(120)
  @Type(() => Number)
  @IsOptional()
  periods?: number;

  @ApiPropertyOptional({ description: 'Period granularity override (DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY)' })
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'])
  @IsOptional()
  periodType?: string;

  @ApiPropertyOptional({ description: 'Product IDs to filter (empty = all)' })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  productIds?: string[];

  @ApiPropertyOptional({ description: 'Location IDs to filter (empty = all)' })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  locationIds?: string[];

  @ApiPropertyOptional({ description: 'Customer IDs to filter (empty = all)' })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  customerIds?: string[];

  @ApiPropertyOptional({ description: 'Dimension keys to forecast by (default: productId, locationId)' })
  @IsArray()
  @IsIn(['productId', 'locationId', 'customerId', 'accountId', 'costCenterId'], { each: true })
  @IsOptional()
  dimensions?: string[];

  @ApiPropertyOptional({ description: 'Model-specific parameters' })
  @IsObject()
  @IsOptional()
  parameters?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Save generated forecasts to database', default: true })
  @IsBoolean()
  @IsOptional()
  persist?: boolean;

  @ApiPropertyOptional({ description: 'Historical data lookback in months (auto-calculated if omitted)', minimum: 1, maximum: 120 })
  @IsNumber()
  @Min(1)
  @Max(120)
  @IsOptional()
  historyMonths?: number;

  @ApiPropertyOptional({ description: 'Rolling forecast mode - start from today instead of plan start date' })
  @IsBoolean()
  @IsOptional()
  rolling?: boolean;

  @ApiPropertyOptional({ description: 'Ensemble model weights override: { MODEL_NAME: weight }' })
  @IsObject()
  @IsOptional()
  ensembleWeights?: Record<string, number>;

  @ApiPropertyOptional({ description: 'External signal adjustments: [{ name, factor, startDate?, endDate? }]' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExternalSignalDto)
  @IsOptional()
  externalSignals?: ExternalSignalDto[];

  @ApiPropertyOptional({ description: 'Snapshot label to freeze this forecast version' })
  @IsString()
  @IsOptional()
  snapshotLabel?: string;
}
