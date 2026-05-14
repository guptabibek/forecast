import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ApproveOverrideDto {
  @ApiPropertyOptional({ description: 'Approval notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}
