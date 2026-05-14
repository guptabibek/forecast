import { IsOptional, IsNumber, IsString, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ActualsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize?: number = 50;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  accountId?: string;
}
