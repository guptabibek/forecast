import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
    IsArray,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Max,
    Min,
    ValidateNested
} from 'class-validator';

// Dashboard filter DTO for filtering by products and customers
// Also includes common query params like limit, periods, granularity
export class DashboardFilterDto {
  @ApiPropertyOptional({ description: 'Filter by product IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  productIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by customer IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  customerIds?: string[];

  @ApiPropertyOptional({ description: 'Limit number of results', type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Number of periods to include', type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  periods?: number;

  @ApiPropertyOptional({ description: 'Time granularity', enum: ['daily', 'weekly', 'monthly', 'quarterly'] })
  @IsOptional()
  @IsString()
  granularity?: 'daily' | 'weekly' | 'monthly' | 'quarterly';

  @ApiPropertyOptional({ description: 'Start date for filtering' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for filtering' })
  @IsOptional()
  @IsString()
  endDate?: string;
}

// ABC Analysis specific DTO with mode and thresholds
export class ABCAnalysisDto extends DashboardFilterDto {
  @ApiPropertyOptional({ 
    description: 'ABC classification mode: revenue-based or margin-based',
    enum: ['revenue', 'margin'],
    default: 'revenue'
  })
  @IsOptional()
  @IsString()
  @IsEnum(['revenue', 'margin'])
  mode?: 'revenue' | 'margin';

  @ApiPropertyOptional({ 
    description: 'Cumulative threshold for Class A (default: 80)',
    type: Number,
    default: 80
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  thresholdA?: number;

  @ApiPropertyOptional({ 
    description: 'Cumulative threshold for Class B (default: 95)',
    type: Number,
    default: 95
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  thresholdB?: number;
}

export class ReportConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  metrics?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  dateRange?: {
    start?: string;
    end?: string;
  };
}

export class GenerateReportDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  forecastIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(['product', 'location', 'customer', 'account'])
  dimensionType?: 'product' | 'location' | 'customer' | 'account';

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dimensionIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
  granularity?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

  @ApiPropertyOptional()
  @IsOptional()
  includeActuals?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  includeVariance?: boolean;
}

export class ExportReportDto extends GenerateReportDto {
  @ApiProperty({ enum: ['variance', 'trend', 'comparison', 'summary', 'accuracy'] })
  @IsEnum(['variance', 'trend', 'comparison', 'summary', 'accuracy'])
  type: 'variance' | 'trend' | 'comparison' | 'summary' | 'accuracy';

  @ApiProperty({ enum: ['csv', 'xlsx', 'pdf', 'json'] })
  @IsEnum(['csv', 'xlsx', 'pdf', 'json'])
  format: 'csv' | 'xlsx' | 'pdf' | 'json';
}

export class SaveReportDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ['line', 'bar', 'pie', 'area', 'table'] })
  @IsEnum(['line', 'bar', 'pie', 'area', 'table'])
  type: 'line' | 'bar' | 'pie' | 'area' | 'table';

  @ApiProperty()
  @IsObject()
  @ValidateNested()
  @Type(() => ReportConfigDto)
  config: ReportConfigDto;
}

export class ScheduleReportDto {
  @ApiProperty()
  @IsString()
  reportId: string;

  @ApiProperty({ enum: ['daily', 'weekly', 'monthly'] })
  @IsEnum(['daily', 'weekly', 'monthly'])
  frequency: 'daily' | 'weekly' | 'monthly';

  @ApiProperty()
  @IsArray()
  @IsString({ each: true })
  recipients: string[];

  @ApiProperty({ enum: ['csv', 'xlsx', 'pdf'] })
  @IsEnum(['csv', 'xlsx', 'pdf'])
  format: 'csv' | 'xlsx' | 'pdf';
}
