import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

const allowedSyncFrequencies = ['HOURLY', 'DAILY', 'WEEKLY'] as const;

export class CreateMargConfigDto {
  @ApiProperty({ description: 'Marg CompanyCode provided by Marg ERP' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  companyCode: string;

  @ApiProperty({ description: 'Marg 36-digit sync key' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  margKey: string;

  @ApiProperty({ description: 'Decryption key for response payload' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  decryptionKey: string;

  @ApiPropertyOptional({ description: 'Marg API base URL', default: 'https://corporate.margerp.com' })
  @IsOptional()
  @IsUrl({ require_tld: true, require_protocol: true })
  @MaxLength(500)
  apiBaseUrl?: string;

  @ApiPropertyOptional({ description: 'Branch CompanyID (0 for all branches)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  companyId?: number;

  @ApiPropertyOptional({ description: 'Sync frequency: HOURLY | DAILY | WEEKLY', default: 'DAILY' })
  @IsOptional()
  @IsString()
  @IsIn(allowedSyncFrequencies)
  syncFrequency?: string;
}
