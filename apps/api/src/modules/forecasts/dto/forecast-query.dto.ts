import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ForecastQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 5000 })
  @IsNumber()
  @Min(1)
  @Max(5000)
  @Type(() => Number)
  @IsOptional()
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: 'Plan Version ID filter' })
  @IsUUID()
  @IsOptional()
  planVersionId?: string;

  @ApiPropertyOptional({ description: 'Scenario ID filter' })
  @IsUUID()
  @IsOptional()
  scenarioId?: string;

  @ApiPropertyOptional({ description: 'Forecast Run ID filter' })
  @IsUUID()
  @IsOptional()
  forecastRunId?: string;

  @ApiPropertyOptional({ description: 'Forecast model filter' })
  @IsString()
  @IsOptional()
  forecastModel?: string;

  @ApiPropertyOptional({ description: 'Product ID filter' })
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional({ description: 'Location ID filter' })
  @IsString()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Start date filter' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date filter' })
  @IsString()
  @IsOptional()
  endDate?: string;
}
