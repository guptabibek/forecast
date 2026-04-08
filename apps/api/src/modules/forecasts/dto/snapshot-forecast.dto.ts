import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SnapshotForecastDto {
  @ApiProperty({ description: 'Plan version ID' })
  @IsUUID()
  planVersionId: string;

  @ApiProperty({ description: 'Scenario ID' })
  @IsUUID()
  scenarioId: string;

  @ApiProperty({ description: 'Snapshot label', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label: string;
}
