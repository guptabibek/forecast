import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../platform/require-module.decorator';
import { AiProviderService } from './ai-provider.service';
import { AiReportingService } from './ai-reporting.service';

class AiReportQueryDto {
  @IsString()
  @MaxLength(1000)
  question!: string;

  @IsOptional()
  @IsIn(['auto', 'table', 'chart'])
  outputMode?: 'auto' | 'table' | 'chart';

  @IsOptional()
  @IsBoolean()
  includeSummary?: boolean;

  @IsOptional()
  @IsInt()
  companyId?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  branchIds?: string[];
}

class AiDashboardQueryDto {
  @IsString()
  @MaxLength(1000)
  question!: string;

  @IsOptional()
  @IsBoolean()
  includeSummary?: boolean;

  @IsOptional()
  @IsInt()
  companyId?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  branchIds?: string[];
}

class AiHistoryQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

class AiProviderSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['openai'])
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  summaryModel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  apiKey?: string | null;

  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  endpointUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  organizationId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200000)
  maxTokens?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  monthlyTokenLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  monthlyCostLimitCents?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  inputTokenCostPer1mCents?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  outputTokenCostPer1mCents?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600000)
  timeoutMs?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxResultRows?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxSummaryRows?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  dailyUserCallLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  dailyTenantCallLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000000)
  monthlyCompanyCallLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  maskSensitiveFields?: boolean | null;

  @IsOptional()
  @IsBoolean()
  summariesEnabled?: boolean | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  ratePerUserPerMinute?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  ratePerTenantPerHour?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxConcurrentPerUser?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxConcurrentPerTenant?: number | null;
}

@ApiTags('AI Reporting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireModule('ai-reporting')
@RequirePermissions('report:read')
@Controller('ai-reporting')
export class AiReportingController {
  constructor(
    private readonly aiReporting: AiReportingService,
    private readonly aiProvider: AiProviderService,
  ) {}

  @Post('query')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Ask a natural-language AI report question' })
  @ApiResponse({ status: 200, description: 'AI report result' })
  async query(@CurrentUser() user: any, @Body() body: AiReportQueryDto) {
    return this.aiReporting.query(user, {
      question: body.question,
      outputMode: body.outputMode ?? 'auto',
      includeSummary: body.includeSummary === true,
      companyId: body.companyId,
      branchIds: body.branchIds,
    });
  }

  @Post('dashboard')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Generate a natural-language AI dashboard' })
  @ApiResponse({ status: 200, description: 'AI dashboard result' })
  async dashboard(@CurrentUser() user: any, @Body() body: AiDashboardQueryDto) {
    return this.aiReporting.dashboard(user, {
      question: body.question,
      outputMode: 'auto',
      includeSummary: body.includeSummary === true,
      companyId: body.companyId,
      branchIds: body.branchIds,
    });
  }

  @Get('catalog')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Get safe AI reporting catalog metadata' })
  @ApiResponse({ status: 200, description: 'Limited semantic catalog metadata' })
  async catalog(@CurrentUser() user: any) {
    return this.aiReporting.getCatalogMetadata(user);
  }

  @Get('history')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Get AI reporting query history for current user' })
  @ApiResponse({ status: 200, description: 'AI report query history' })
  async history(@CurrentUser() user: any, @Query() query: AiHistoryQueryDto) {
    return this.aiReporting.history(user, query.limit);
  }

  @Get('settings')
  @Roles('ADMIN')
  @RequirePermissions()
  @ApiOperation({ summary: 'Get tenant AI provider settings and current usage' })
  @ApiResponse({ status: 200, description: 'Tenant AI provider settings' })
  async providerSettings(@CurrentUser() user: any) {
    return this.aiProvider.getPublicTenantProviderSettings(user.tenantId);
  }

  @Patch('settings')
  @Roles('ADMIN')
  @RequirePermissions()
  @ApiOperation({ summary: 'Update tenant AI provider settings' })
  @ApiResponse({ status: 200, description: 'Updated tenant AI provider settings' })
  async updateProviderSettings(@CurrentUser() user: any, @Body() body: AiProviderSettingsDto) {
    return this.aiProvider.saveTenantProviderSettings(user.tenantId, user.id ?? null, body);
  }

  @Post('settings/test')
  @Roles('ADMIN')
  @RequirePermissions()
  @ApiOperation({ summary: 'Test tenant AI provider connection' })
  @ApiResponse({ status: 200, description: 'AI provider connection test result' })
  async testProviderSettings(@CurrentUser() user: any) {
    return this.aiProvider.testTenantProviderSettings(user.tenantId, user.id);
  }

  @Get('usage')
  @Roles('ADMIN')
  @RequirePermissions()
  @ApiOperation({ summary: 'Get tenant AI provider usage for the current month' })
  @ApiResponse({ status: 200, description: 'Tenant AI provider usage summary' })
  async usage(@CurrentUser() user: any) {
    return this.aiProvider.getTenantUsageSummary(user.tenantId);
  }
}
