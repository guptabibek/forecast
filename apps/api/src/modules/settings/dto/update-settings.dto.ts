import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ description: 'Company name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Custom domain' })
  @IsString()
  @IsOptional()
  domain?: string;

  @ApiPropertyOptional({ description: 'Subdomain' })
  @IsString()
  @IsOptional()
  subdomain?: string;

  @ApiPropertyOptional({ description: 'Logo URL' })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Primary brand color (hex)' })
  @IsString()
  @IsOptional()
  primaryColor?: string;

  @ApiPropertyOptional({ description: 'Timezone' })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ description: 'Default currency code' })
  @IsString()
  @IsOptional()
  defaultCurrency?: string;

  @ApiPropertyOptional({ description: 'Date format' })
  @IsString()
  @IsOptional()
  dateFormat?: string;

  @ApiPropertyOptional({ description: 'Fiscal year start month (1-12)' })
  @IsNumber()
  @Min(1)
  @Max(12)
  @IsOptional()
  fiscalYearStart?: number;

  @ApiPropertyOptional({ description: 'Default forecast model' })
  @IsString()
  @IsOptional()
  defaultForecastModel?: string;

  @ApiPropertyOptional({ description: 'Enable email notifications' })
  @IsBoolean()
  @IsOptional()
  emailNotifications?: boolean;

  @ApiPropertyOptional({ description: 'Slack webhook URL for notifications' })
  @IsUrl()
  @IsOptional()
  slackWebhookUrl?: string;

  @ApiPropertyOptional({ description: 'Enable SSO' })
  @IsBoolean()
  @IsOptional()
  ssoEnabled?: boolean;

  @ApiPropertyOptional({ description: 'SSO provider name' })
  @IsString()
  @IsOptional()
  ssoProvider?: string;

  @ApiPropertyOptional({ description: 'Data retention period in days' })
  @IsNumber()
  @Min(30)
  @Max(3650)
  @IsOptional()
  dataRetentionDays?: number;

  /* ─── Branding & Appearance ─── */

  @ApiPropertyOptional({ description: 'Favicon URL' })
  @IsString()
  @IsOptional()
  faviconUrl?: string;

  @ApiPropertyOptional({ description: 'Brand tagline shown in sidebar/login' })
  @IsString()
  @IsOptional()
  brandTagline?: string;

  @ApiPropertyOptional({ description: 'Accent / secondary brand color (hex)' })
  @IsString()
  @IsOptional()
  accentColor?: string;

  @ApiPropertyOptional({ description: 'Sidebar background color (hex)' })
  @IsString()
  @IsOptional()
  sidebarBg?: string;

  @ApiPropertyOptional({ description: 'Sidebar text color (hex)' })
  @IsString()
  @IsOptional()
  sidebarText?: string;

  @ApiPropertyOptional({ description: 'Header background color (hex)' })
  @IsString()
  @IsOptional()
  headerBg?: string;

  @ApiPropertyOptional({ description: 'Header text color (hex)' })
  @IsString()
  @IsOptional()
  headerText?: string;

  /* ─── Typography ─── */

  @ApiPropertyOptional({ description: 'Heading font family (Google Fonts name)' })
  @IsString()
  @IsOptional()
  headingFont?: string;

  @ApiPropertyOptional({ description: 'Body font family (Google Fonts name)' })
  @IsString()
  @IsOptional()
  bodyFont?: string;

  @ApiPropertyOptional({ description: 'Base font size in px (12-20)' })
  @IsNumber()
  @Min(12)
  @Max(20)
  @IsOptional()
  baseFontSize?: number;

  @ApiPropertyOptional({ description: 'Heading font weight (400-900)' })
  @IsNumber()
  @Min(400)
  @Max(900)
  @IsOptional()
  headingWeight?: number;

  /* ─── Theme & Layout ─── */

  @ApiPropertyOptional({ description: 'Default theme mode: light | dark | system' })
  @IsString()
  @IsOptional()
  defaultTheme?: string;

  @ApiPropertyOptional({ description: 'UI border radius in px (0-16)' })
  @IsNumber()
  @Min(0)
  @Max(16)
  @IsOptional()
  borderRadius?: number;

  @ApiPropertyOptional({ description: 'Enable compact UI mode' })
  @IsBoolean()
  @IsOptional()
  compactMode?: boolean;

  @ApiPropertyOptional({ description: 'Login page background image URL' })
  @IsString()
  @IsOptional()
  loginBgUrl?: string;

  @ApiPropertyOptional({ description: 'Custom CSS overrides (advanced)' })
  @IsString()
  @IsOptional()
  customCss?: string;
}
