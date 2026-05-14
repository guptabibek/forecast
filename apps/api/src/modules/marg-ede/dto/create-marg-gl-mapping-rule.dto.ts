import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateMargGlMappingRuleDto {
  @IsString()
  @MaxLength(100)
  ruleName: string;

  @IsOptional()
  @IsInt()
  companyId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bookCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  groupCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  partyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  counterpartyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  remarkContains?: string;

  @IsUUID()
  glAccountId: string;

  @IsOptional()
  @IsBoolean()
  isReceivableControl?: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsString()
  description?: string;
}