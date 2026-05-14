import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

const allowedSyncFrequencies = ['HOURLY', 'DAILY', 'WEEKLY'] as const;
const allowedStockProjectionModes = ['STOCK', 'OPENING', 'COMPUTED'] as const;

export class UpdateMargConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  companyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  margKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  decryptionKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: true, require_protocol: true })
  @MaxLength(500)
  apiBaseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  companyId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsIn(allowedSyncFrequencies)
  syncFrequency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Which Marg metric becomes inventory_levels.on_hand_qty. STOCK = Marg API current physical (default). OPENING = Marg ERP F8 display value. COMPUTED = Opening + ledger movements.',
    enum: allowedStockProjectionModes,
  })
  @IsOptional()
  @IsString()
  @IsIn(allowedStockProjectionModes)
  stockProjectionMode?: string;
}
