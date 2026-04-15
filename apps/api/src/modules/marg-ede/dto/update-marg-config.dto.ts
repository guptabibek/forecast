import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

const allowedSyncFrequencies = ['HOURLY', 'DAILY', 'WEEKLY'] as const;

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
}
