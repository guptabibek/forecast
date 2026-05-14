import { IsOptional, IsNumber, IsString, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlanStatus } from '@prisma/client';

export class PlanQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: PlanStatus })
  @IsEnum(PlanStatus)
  @IsOptional()
  status?: PlanStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsEnum(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}
