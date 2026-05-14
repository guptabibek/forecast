import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNumber, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateForecastDto {
  @ApiProperty({ description: 'Plan Version ID' })
  @IsUUID()
  planVersionId: string;

  @ApiProperty({ description: 'Scenario ID' })
  @IsUUID()
  scenarioId: string;

  @ApiProperty({ description: 'Forecast model to use' })
  @IsString()
  forecastModel: string;

  @ApiProperty({ description: 'Period date for the forecast' })
  @IsDateString()
  periodDate: string;

  @ApiPropertyOptional({ description: 'Period type (DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY)' })
  @IsString()
  @IsOptional()
  periodType?: string;

  @ApiPropertyOptional({ description: 'Forecast amount' })
  @IsNumber()
  @IsOptional()
  forecastAmount?: number;

  @ApiPropertyOptional({ description: 'Forecast quantity' })
  @IsNumber()
  @IsOptional()
  forecastQuantity?: number;

  @ApiPropertyOptional({ description: 'Currency code' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: 'Product ID for dimension' })
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional({ description: 'Location ID for dimension' })
  @IsString()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Customer ID for dimension' })
  @IsString()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Account ID for dimension' })
  @IsString()
  @IsOptional()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Cost Center ID for dimension' })
  @IsString()
  @IsOptional()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Model parameters' })
  @IsObject()
  @IsOptional()
  parameters?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Auto-run forecast after creation', default: true })
  @IsBoolean()
  @IsOptional()
  autoRun?: boolean;

  @ApiPropertyOptional({ description: 'Override reason (required for adjustments)' })
  @IsString()
  @IsOptional()
  overrideReason?: string;
}
