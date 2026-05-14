import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ImportType {
  ACTUALS = 'actuals',
  PRODUCTS = 'products',
  LOCATIONS = 'locations',
  CUSTOMERS = 'customers',
  ACCOUNTS = 'accounts',
}

export class ImportDataDto {
  @ApiProperty({ enum: ImportType, description: 'Type of data being imported' })
  @IsEnum(ImportType)
  type: ImportType;

  @ApiPropertyOptional({ description: 'Column mapping configuration' })
  @IsObject()
  @IsOptional()
  mapping?: Record<string, string>;
}
