import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsObject, IsOptional, IsString } from 'class-validator';

export class CreatePlanDto {
  @ApiProperty({ description: 'Plan name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Plan description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Fiscal year' })
  @IsInt()
  @IsOptional()
  fiscalYear?: number;

  @ApiProperty({ description: 'Plan start date' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'Plan end date' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: 'Plan type: BUDGET, FORECAST, STRATEGIC, WHAT_IF' })
  @IsString()
  @IsOptional()
  planType?: string;

  @ApiPropertyOptional({ description: 'Period type: DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY' })
  @IsString()
  @IsOptional()
  periodType?: string;

  @ApiPropertyOptional({ description: 'Plan settings' })
  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Copy from existing plan ID' })
  @IsString()
  @IsOptional()
  copyFromId?: string;
}
