import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateScenarioDto {
  @ApiProperty({ description: 'Scenario name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Scenario description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Plan Version ID' })
  @IsString()
  planVersionId: string;

  @ApiPropertyOptional({ description: 'Scenario type: BASE, OPTIMISTIC, PESSIMISTIC, STRETCH, CONSERVATIVE, CUSTOM' })
  @IsString()
  @IsOptional()
  scenarioType?: string;

  @ApiPropertyOptional({ description: 'Color for UI display (hex code)' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: 'Sort order' })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}
