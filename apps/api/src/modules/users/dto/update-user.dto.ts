import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/**
 * Extends the base create-DTO (minus email) with profile fields the
 * frontend sends on PATCH /users/me  (email, phone, timezone, language).
 * `forbidNonWhitelisted` is on globally so every accepted field must be
 * declared here.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['email'] as const),
) {
  @ApiPropertyOptional({ description: 'User email (read-only on profile, accepted but ignored)' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: 'IANA timezone, e.g. America/New_York' })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ description: 'Preferred UI language code, e.g. en' })
  @IsString()
  @IsOptional()
  language?: string;
}
