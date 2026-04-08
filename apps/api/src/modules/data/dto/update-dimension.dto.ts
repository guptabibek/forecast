import { PartialType } from '@nestjs/swagger';
import { CreateDimensionDto } from './create-dimension.dto';

export class UpdateDimensionDto extends PartialType(CreateDimensionDto) {}
