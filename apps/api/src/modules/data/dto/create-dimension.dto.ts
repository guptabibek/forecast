import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateDimensionDto {
  @ApiProperty({ description: 'Dimension code (unique)' })
  @IsString()
  code: string;

  @ApiProperty({ description: 'Dimension name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Dimension description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Parent dimension ID for hierarchy' })
  @IsString()
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Custom attributes' })
  @IsObject()
  @IsOptional()
  attributes?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Is active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // Account-specific fields
  @ApiPropertyOptional({ description: 'Account type (for accounts): REVENUE, COST_OF_GOODS, OPERATING_EXPENSE, OTHER_INCOME, OTHER_EXPENSE, ASSET, LIABILITY, EQUITY' })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ description: 'Category' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Level in hierarchy' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  level?: number;

  @ApiPropertyOptional({ description: 'Is rollup account' })
  @IsBoolean()
  @IsOptional()
  isRollup?: boolean;

  @ApiPropertyOptional({ description: 'Sign: 1 for debit, -1 for credit' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  sign?: number;

  // Product-specific fields
  @ApiPropertyOptional({ description: 'Subcategory' })
  @IsString()
  @IsOptional()
  subcategory?: string;

  @ApiPropertyOptional({ description: 'Brand' })
  @IsString()
  @IsOptional()
  brand?: string;

  @ApiPropertyOptional({ description: 'Unit of measure' })
  @IsString()
  @IsOptional()
  unitOfMeasure?: string;

  @ApiPropertyOptional({ description: 'Standard cost' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  standardCost?: number;

  @ApiPropertyOptional({ description: 'List price' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  listPrice?: number;

  // Location-specific fields
  @ApiPropertyOptional({ description: 'Address' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ description: 'State' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ description: 'Country' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ description: 'Postal code' })
  @IsString()
  @IsOptional()
  postalCode?: string;

  @ApiPropertyOptional({ description: 'Region' })
  @IsString()
  @IsOptional()
  region?: string;

  @ApiPropertyOptional({ description: 'Timezone' })
  @IsString()
  @IsOptional()
  timezone?: string;

  // Customer-specific fields
  @ApiPropertyOptional({ description: 'Segment' })
  @IsString()
  @IsOptional()
  segment?: string;

  @ApiPropertyOptional({ description: 'Industry' })
  @IsString()
  @IsOptional()
  industry?: string;

  @ApiPropertyOptional({ description: 'Credit limit' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  creditLimit?: number;

  @ApiPropertyOptional({ description: 'Payment terms' })
  @IsString()
  @IsOptional()
  paymentTerms?: string;

  // External reference
  @ApiPropertyOptional({ description: 'External system ID (ERP reference)' })
  @IsString()
  @IsOptional()
  externalId?: string;
}
