import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
    IsBoolean,
    IsArray,
    IsDateString,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Min
} from 'class-validator';

export class PaginationDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({ description: 'Column to sort by (alias of a projected column)' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'JSON-encoded ColumnFilter[] (per-column filters)' })
  @IsOptional()
  @IsString()
  filters?: string;
}

export class DateRangeDto {
  @ApiPropertyOptional({ description: 'Start date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class InventoryBaseFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by product IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  productIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by location IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  locationIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by batch IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  batchIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by product category' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export enum AgeingBucket {
  ZERO_TO_THREE = '0-3m',
  THREE_TO_SIX = '3-6m',
  SIX_TO_TWELVE = '6-12m',
  OVER_TWELVE = '>12m',
}

export class StockAgeingFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description: 'Custom ageing bucket boundaries in days',
    example: [90, 180, 365],
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  bucketDays?: number[];
}

export class ReorderFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description:
      'Demand window — number of trailing days of net sales used to compute ' +
      'average daily demand. Larger windows smooth out spikes. Alias: avgSalesDays.',
    default: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(730)
  lookbackDays?: number = 90;

  @ApiPropertyOptional({
    description:
      'Coverage horizon — number of days of demand the reorder should cover ' +
      '(i.e. "stock me up for the next N days"). The order-up-to / max level ' +
      'is computed for lead time + this horizon.',
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  coverageDays?: number = 30;

  @ApiPropertyOptional({
    description:
      'Default supplier lead time in days, used when a product has no ' +
      'per-product lead time configured in its inventory policy.',
    default: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number = 7;

  @ApiPropertyOptional({
    description:
      'Default safety-stock cover in days, used when a product has no ' +
      'safety-stock qty/days configured. Safety stock = safetyDays × avg daily demand.',
    default: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  safetyDays?: number = 7;

  @ApiPropertyOptional({
    description:
      'When true, return every product×location (with its computed numbers); ' +
      'when false (default) return only items that need reordering ' +
      '(on hand at or below the reorder point, or a positive suggested qty).',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeAll?: boolean = false;

  /** @deprecated alias of lookbackDays, kept for API backward compatibility. */
  @ApiPropertyOptional({ description: 'Deprecated alias of lookbackDays.', deprecated: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(730)
  avgSalesDays?: number;

  @ApiPropertyOptional({ description: 'Filter by product company code.' })
  @IsOptional()
  @IsString()
  productCompany?: string;

  @ApiPropertyOptional({ description: 'Filter by HSN code.' })
  @IsOptional()
  @IsString()
  hsnCode?: string;

  @ApiPropertyOptional({ description: 'Filter by salt code.' })
  @IsOptional()
  @IsString()
  salt?: string;

  @ApiPropertyOptional({ description: 'Filter by product group/category code.' })
  @IsOptional()
  @IsString()
  productGroup?: string;

  @ApiPropertyOptional({ description: 'Filter by supplier IDs.' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  supplierIds?: string[];
}

export class ExpiryFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description: 'Expiry threshold in days (items expiring within this window)',
    default: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  thresholdDays?: number = 90;
}

export class DeadSlowFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description: 'Number of months with no sales to classify as dead stock',
    default: 6,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  deadMonths?: number = 6;
}

export class ABCAnalysisFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({ description: 'A-class threshold (%)', default: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(95)
  thresholdA?: number = 80;

  @ApiPropertyOptional({ description: 'B-class cumulative threshold (%)', default: 95 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(80)
  @Max(99)
  thresholdB?: number = 95;

  @ApiPropertyOptional({
    description: 'Number of months of consumption to analyze',
    default: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(36)
  periodMonths?: number = 12;
}

export class XYZAnalysisFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({ description: 'X-class max CV threshold', default: 0.5 })
  @IsOptional()
  @Type(() => Number)
  @Min(0.1)
  @Max(1.0)
  thresholdX?: number = 0.5;

  @ApiPropertyOptional({ description: 'Y-class max CV threshold', default: 1.0 })
  @IsOptional()
  @Type(() => Number)
  @Min(0.3)
  @Max(2.0)
  thresholdY?: number = 1.0;

  @ApiPropertyOptional({
    description: 'Number of months of consumption to analyze',
    default: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(36)
  periodMonths?: number = 12;
}

export class SupplierPerformanceFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by supplier IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  supplierIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter Marg-backed data by company ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  companyId?: number;

  @ApiPropertyOptional({
    description: 'Filter purchase orders by status',
    enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED', 'SYNCED', 'POSTED'],
  })
  @IsOptional()
  @IsIn(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED', 'SYNCED', 'POSTED'])
  status?: string;

  @ApiPropertyOptional({ description: 'Include fallback purchase orders synthesized from Marg purchase invoices' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeFallbackPurchaseOrders?: boolean;
}

export class StockOutFilterDto extends InventoryBaseFilterDto {}

export class SuggestedPurchaseFilterDto extends InventoryBaseFilterDto {
  @ApiPropertyOptional({
    description: 'Demand window — trailing days of net sales used for average daily demand.',
    default: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(730)
  lookbackDays?: number = 90;

  @ApiPropertyOptional({
    description: 'Coverage horizon — days of demand the purchase should cover (order-up-to = lead time + this).',
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  coverageDays?: number = 30;

  @ApiPropertyOptional({
    description: 'Default supplier lead time in days when a product has no per-product lead time configured.',
    default: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number = 7;

  @ApiPropertyOptional({
    description: 'Default safety-stock cover in days when none is configured. Safety stock = safetyDays × avg daily demand.',
    default: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  safetyDays?: number = 7;

  @ApiPropertyOptional({
    description: 'Deprecated. Retained for backward compatibility; superseded by safetyDays / policy safety stock.',
    default: 1.5,
  })
  @IsOptional()
  @Type(() => Number)
  @Min(1.0)
  @Max(5.0)
  safetyMultiplier?: number = 1.5;

  @ApiPropertyOptional({ description: 'Filter by product company code.' })
  @IsOptional()
  @IsString()
  productCompany?: string;

  @ApiPropertyOptional({ description: 'Filter by HSN code.' })
  @IsOptional()
  @IsString()
  hsnCode?: string;

  @ApiPropertyOptional({ description: 'Filter by salt code.' })
  @IsOptional()
  @IsString()
  salt?: string;

  @ApiPropertyOptional({ description: 'Filter by product group/category code.' })
  @IsOptional()
  @IsString()
  productGroup?: string;

  @ApiPropertyOptional({ description: 'Filter by supplier IDs.' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  supplierIds?: string[];
}

export class SalesPurchaseAnalysisFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Start date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter Marg-backed data by company ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  companyId?: number;

  @ApiPropertyOptional({ description: 'Filter by branch/location ID where Marg branch is mapped' })
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @ApiPropertyOptional({ description: 'Alias for branch/location filter' })
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Filter by customer/supplier Marg party code' })
  @IsOptional()
  @IsString()
  partyCode?: string;

  @ApiPropertyOptional({ description: 'Filter by customer Marg party code' })
  @IsOptional()
  @IsString()
  customerCode?: string;

  @ApiPropertyOptional({ description: 'Filter by supplier Marg party code' })
  @IsOptional()
  @IsString()
  supplierCode?: string;

  @ApiPropertyOptional({ description: 'Filter by product IDs' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  productIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by Marg item code or PID' })
  @IsOptional()
  @IsString()
  item?: string;

  @ApiPropertyOptional({ description: 'Filter by product category/group' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by product company/brand' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ description: 'Filter by batch number' })
  @IsOptional()
  @IsString()
  batch?: string;

  @ApiPropertyOptional({ description: 'Filter by user/salesman/MR' })
  @IsOptional()
  @IsString()
  user?: string;

  @ApiPropertyOptional({ description: 'Filter by payment mode', enum: ['CASH', 'CREDIT', 'MIXED'] })
  @IsOptional()
  @IsIn(['CASH', 'CREDIT', 'MIXED'])
  paymentMode?: 'CASH' | 'CREDIT' | 'MIXED';

  @ApiPropertyOptional({ description: 'Filter by tax percentage/type' })
  @IsOptional()
  @IsString()
  taxType?: string;

  @ApiPropertyOptional({ description: 'Filter by bill status', enum: ['POSTED', 'RETURN'] })
  @IsOptional()
  @IsIn(['POSTED', 'RETURN'])
  status?: 'POSTED' | 'RETURN';

  @ApiPropertyOptional({
    description:
      'Document scope. "invoice" (default) = pure commercial invoices only ' +
      '(matches the classic Sales/Purchase Analysis). "return" = returns / ' +
      'credit & debit notes / breakage-expiry receipts, shown as positive ' +
      'magnitudes. "net" = invoices minus returns (net-of-returns).',
    enum: ['invoice', 'return', 'net'],
    default: 'invoice',
  })
  @IsOptional()
  @IsIn(['invoice', 'return', 'net'])
  scope?: 'invoice' | 'return' | 'net';

  @ApiPropertyOptional({ description: 'Minimum bill amount' })
  @IsOptional()
  @Type(() => Number)
  minAmount?: number;

  @ApiPropertyOptional({ description: 'Maximum bill amount' })
  @IsOptional()
  @Type(() => Number)
  maxAmount?: number;

  @ApiPropertyOptional({ description: 'Minimum bill quantity' })
  @IsOptional()
  @Type(() => Number)
  minQuantity?: number;

  @ApiPropertyOptional({ description: 'Maximum bill quantity' })
  @IsOptional()
  @Type(() => Number)
  maxQuantity?: number;
}

/** Comparison report — adds a second date range to a base sales/purchase analysis filter. */
export class SalesPurchaseComparisonFilterDto extends SalesPurchaseAnalysisFilterDto {
  @ApiPropertyOptional({ description: 'Comparison period start date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  compareStartDate?: string;

  @ApiPropertyOptional({ description: 'Comparison period end date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  compareEndDate?: string;

  @ApiPropertyOptional({
    description: 'Optional dimension to break the comparison down by',
    enum: ['none', 'salesman', 'salt', 'productCompany', 'productGroup', 'product', 'hsnCode', 'state', 'city', 'supplier'],
  })
  @IsOptional()
  @IsIn(['none', 'salesman', 'salt', 'productCompany', 'productGroup', 'product', 'hsnCode', 'state', 'city', 'supplier'])
  dimension?: 'none' | 'salesman' | 'salt' | 'productCompany' | 'productGroup' | 'product' | 'hsnCode' | 'state' | 'city' | 'supplier';
}

/** Top-N analysis grouped by a chosen dimension (salt, company, product group, etc.) */
export class SalesPurchaseDimensionFilterDto extends SalesPurchaseAnalysisFilterDto {
  @ApiPropertyOptional({
    description: 'Dimension to group by',
    enum: ['salesman', 'salt', 'productCompany', 'productGroup', 'product', 'hsnCode', 'state', 'city', 'supplier'],
    default: 'salesman',
  })
  @IsOptional()
  @IsIn(['salesman', 'salt', 'productCompany', 'productGroup', 'product', 'hsnCode', 'state', 'city', 'supplier'])
  dimension?: 'salesman' | 'salt' | 'productCompany' | 'productGroup' | 'product' | 'hsnCode' | 'state' | 'city' | 'supplier';
}

export class AlertConfigDto {
  @ApiPropertyOptional({ description: 'Near-expiry threshold in days', default: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  nearExpiryDays?: number = 90;

  @ApiPropertyOptional({
    description: 'Only alert for A-category low stock',
    default: true,
  })
  @IsOptional()
  aClassOnly?: boolean = true;

  @ApiPropertyOptional({ description: 'Max alerts per category', default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  alertLimit?: number = 200;
}
