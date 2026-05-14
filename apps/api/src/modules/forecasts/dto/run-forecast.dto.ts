import { IsOptional, IsObject, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RunForecastDto {
  @ApiPropertyOptional({ description: 'Override model parameters' })
  @IsObject()
  @IsOptional()
  parameters?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Force refresh even if cached', default: false })
  @IsBoolean()
  @IsOptional()
  forceRefresh?: boolean;

  @ApiPropertyOptional({ description: 'Job priority (1-10)', default: 1 })
  @IsNumber()
  @Min(1)
  @Max(10)
  @IsOptional()
  priority?: number;
}
