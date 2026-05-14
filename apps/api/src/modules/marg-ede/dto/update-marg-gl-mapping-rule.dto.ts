import { PartialType } from '@nestjs/swagger';
import { CreateMargGlMappingRuleDto } from './create-marg-gl-mapping-rule.dto';

export class UpdateMargGlMappingRuleDto extends PartialType(CreateMargGlMappingRuleDto) {}