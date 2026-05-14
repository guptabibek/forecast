import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'First name' })
  @IsString()
  firstName: string;

  @ApiProperty({ description: 'Last name' })
  @IsString()
  lastName: string;

  @ApiProperty({ description: 'User role: ADMIN, PLANNER, FINANCE, VIEWER, FORECAST_PLANNER, FORECAST_VIEWER', enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({ description: 'Custom role ID (dynamic RBAC). If set, overrides the enum role for permissions.' })
  @IsUUID()
  @IsOptional()
  customRoleId?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;
}
