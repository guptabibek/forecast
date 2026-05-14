import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UserQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'User role: ADMIN, PLANNER, FINANCE, VIEWER' })
  @IsString()
  @IsOptional()
  role?: string;

  @ApiPropertyOptional({ description: 'User status: ACTIVE, INACTIVE, PENDING, LOCKED' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Number of results per page', minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Items per page (alias for limit)', minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'JSON-encoded FilterDescriptor[]' })
  @IsOptional()
  @IsString()
  filters?: string;
}
