import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
}
