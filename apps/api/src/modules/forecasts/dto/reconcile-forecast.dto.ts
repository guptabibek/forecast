import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ReconcileForecastDto {
  @ApiProperty({ description: 'Forecast Run ID' })
  @IsUUID()
  forecastRunId: string;

  @ApiPropertyOptional({ description: 'Variance threshold percentage', default: 5, minimum: 0.1, maximum: 100 })
  @IsNumber()
  @Min(0.1)
  @Max(100)
  @IsOptional()
  thresholdPct?: number;
}
