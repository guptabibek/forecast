import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateOverrideDto {
  @ApiProperty({ description: 'Forecast Result ID to override' })
  @IsUUID()
  forecastResultId: string;

  @ApiProperty({ description: 'Override amount' })
  @IsNumber()
  overrideAmount: number;

  @ApiProperty({ description: 'Override reason (required)' })
  @IsString()
  reason: string;

  @ApiProperty({ description: 'Override quantity', required: false })
  @IsNumber()
  @IsOptional()
  overrideQuantity?: number;

  @ApiProperty({ description: 'Override currency', required: false })
  @IsString()
  @IsOptional()
  currency?: string;
}
