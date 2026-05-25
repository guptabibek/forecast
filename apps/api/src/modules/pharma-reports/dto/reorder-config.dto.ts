import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ReorderPolicyScopeType {
  PRODUCT_COMPANY = 'PRODUCT_COMPANY',
  HSN_CODE = 'HSN_CODE',
  SALT = 'SALT',
  PRODUCT_GROUP = 'PRODUCT_GROUP',
  SUPPLIER = 'SUPPLIER',
}

/**
 * One reorder-policy override row. A row identifies its product×location by
 * UUID (`productId`/`locationId`) OR by human code (`productCode`/`locationCode`)
 * — the latter is what a CSV import naturally carries. At least one of each
 * pair must be present; the service resolves codes to IDs.
 *
 * Every numeric field is OPTIONAL: an override only sets the fields provided,
 * leaving the rest to the demand-driven computation. All map 1:1 onto
 * inventory_policies columns.
 */
export class ReorderPolicyRowDto {
  @ApiPropertyOptional({ description: 'Product UUID (or supply productCode).' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ description: 'Product code / SKU (resolved to productId).' })
  @IsOptional()
  @IsString()
  productCode?: string;

  @ApiPropertyOptional({ description: 'Location UUID (or supply locationCode).' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Location code (resolved to locationId).' })
  @IsOptional()
  @IsString()
  locationCode?: string;

  @ApiPropertyOptional({ description: 'Reorder point / minimum level. When stock ≤ this, reorder.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  reorderPoint?: number;

  @ApiPropertyOptional({ description: 'Fixed reorder lot size. When set, used as the order qty instead of the computed need.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  reorderQty?: number;

  @ApiPropertyOptional({ description: 'Minimum order quantity (suggested qty is floored up to this).' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  minOrderQty?: number;

  @ApiPropertyOptional({ description: 'Maximum order quantity (suggested qty is capped at this).' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  maxOrderQty?: number;

  @ApiPropertyOptional({ description: 'Order pack/multiple (suggested qty is rounded up to a multiple of this).' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  multipleOrderQty?: number;

  @ApiPropertyOptional({ description: 'Fixed safety stock quantity (overrides safety-days computation).' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  safetyStockQty?: number;

  @ApiPropertyOptional({ description: 'Safety stock expressed as days of cover (× avg daily demand).' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  safetyStockDays?: number;

  @ApiPropertyOptional({ description: 'Supplier lead time in days for this product×location.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional({ description: 'Optional ABC class label (A/B/C).' })
  @IsOptional() @IsString()
  abcClass?: string;
}

/** Bulk upsert payload (e.g. a parsed CSV). Capped to keep one request bounded. */
export class ReorderPolicyBulkDto {
  @ApiPropertyOptional({ type: [ReorderPolicyRowDto], description: 'Rows to upsert (1–5000).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ReorderPolicyRowDto)
  rows!: ReorderPolicyRowDto[];
}

/**
 * Dimension-level reorder policy. These rows are intentionally separate from
 * product-location policies because one scoped policy can apply to many SKUs.
 */
export class ReorderPolicyScopeRowDto {
  @ApiPropertyOptional({
    enum: ReorderPolicyScopeType,
    description: 'Policy scope dimension.',
  })
  @IsEnum(ReorderPolicyScopeType)
  scopeType!: ReorderPolicyScopeType;

  @ApiPropertyOptional({
    description:
      'Code for PRODUCT_COMPANY, HSN_CODE, SALT, or PRODUCT_GROUP scopes. Not used for SUPPLIER.',
  })
  @IsOptional()
  @IsString()
  scopeCode?: string;

  @ApiPropertyOptional({ description: 'Supplier UUID for SUPPLIER scope.' })
  @IsOptional()
  @IsUUID('4')
  scopeId?: string;

  @ApiPropertyOptional({ description: 'Supplier code for SUPPLIER scope CSV/import resolution.' })
  @IsOptional()
  @IsString()
  supplierCode?: string;

  @ApiPropertyOptional({ description: 'Location UUID. Blank means all locations.' })
  @IsOptional()
  @IsUUID('4')
  locationId?: string;

  @ApiPropertyOptional({ description: 'Location code. Blank means all locations.' })
  @IsOptional()
  @IsString()
  locationCode?: string;

  @ApiPropertyOptional({ description: 'Higher priority wins when more than one scope matches.', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ description: 'Reorder point / minimum level. When stock <= this, reorder.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  reorderPoint?: number;

  @ApiPropertyOptional({ description: 'Fixed reorder lot size. When set, used as the order qty instead of computed need.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  reorderQty?: number;

  @ApiPropertyOptional({ description: 'Minimum order quantity.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  minOrderQty?: number;

  @ApiPropertyOptional({ description: 'Maximum order quantity.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  maxOrderQty?: number;

  @ApiPropertyOptional({ description: 'Order pack/multiple.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  multipleOrderQty?: number;

  @ApiPropertyOptional({ description: 'Fixed safety stock quantity.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  safetyStockQty?: number;

  @ApiPropertyOptional({ description: 'Safety stock as days of cover.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  safetyStockDays?: number;

  @ApiPropertyOptional({ description: 'Lead time in days.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional({ description: 'Optional ABC class label (A/B/C).' })
  @IsOptional() @IsString()
  abcClass?: string;
}

export class ReorderPolicyScopeBulkDto {
  @ApiPropertyOptional({ type: [ReorderPolicyScopeRowDto], description: 'Scoped policy rows to upsert.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ReorderPolicyScopeRowDto)
  rows!: ReorderPolicyScopeRowDto[];
}
