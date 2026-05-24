import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

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
