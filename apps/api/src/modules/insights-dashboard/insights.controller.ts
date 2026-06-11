import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../platform/require-module.decorator';
import { InsightGenerationService } from './insight-generation.service';
import { InsightsService } from './insights.service';

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.map(String);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

class ListInsightsQueryDto {
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  status?: string[];

  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  severity?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

class InsightActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

class UpdateProviderDto {
  @IsBoolean()
  enabled!: boolean;
}

@ApiTags('AI Insights')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireModule('ai-reporting')
@RequirePermissions('report:read')
@Controller('ai-insights')
export class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly generation: InsightGenerationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List AI-generated insights with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated insights' })
  list(@CurrentUser() user: any, @Query() query: ListInsightsQueryDto) {
    return this.insights.list(user, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Open-insight counts by severity for the dashboard header' })
  @ApiResponse({ status: 200, description: 'Insight summary' })
  summary(@CurrentUser() user: any) {
    return this.insights.summary(user);
  }

  @Post(':insightId/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an insight' })
  @ApiResponse({ status: 200, description: 'Updated insight' })
  acknowledge(
    @CurrentUser() user: any,
    @Param('insightId', ParseUUIDPipe) insightId: string,
    @Body() body: InsightActionDto,
  ) {
    return this.insights.acknowledge(user, insightId, body.note);
  }

  @Post(':insightId/resolve')
  @ApiOperation({ summary: 'Resolve an insight' })
  @ApiResponse({ status: 200, description: 'Updated insight' })
  resolve(
    @CurrentUser() user: any,
    @Param('insightId', ParseUUIDPipe) insightId: string,
    @Body() body: InsightActionDto,
  ) {
    return this.insights.resolve(user, insightId, body.note);
  }

  @Post(':insightId/archive')
  @ApiOperation({ summary: 'Archive an insight' })
  @ApiResponse({ status: 200, description: 'Updated insight' })
  archive(
    @CurrentUser() user: any,
    @Param('insightId', ParseUUIDPipe) insightId: string,
    @Body() body: InsightActionDto,
  ) {
    return this.insights.archive(user, insightId, body.note);
  }

  @Post(':insightId/reopen')
  @ApiOperation({ summary: 'Reopen a closed insight' })
  @ApiResponse({ status: 200, description: 'Updated insight' })
  reopen(
    @CurrentUser() user: any,
    @Param('insightId', ParseUUIDPipe) insightId: string,
    @Body() body: InsightActionDto,
  ) {
    return this.insights.reopen(user, insightId, body.note);
  }

  @Post('generate')
  @Roles('ADMIN')
  @RequirePermissions()
  @ApiOperation({ summary: 'Trigger insight generation for the current tenant (admin only)' })
  @ApiResponse({ status: 200, description: 'Generation summary' })
  generate(@CurrentUser() user: any) {
    return this.generation.generateForTenant(user.tenantId);
  }

  @Get('providers')
  @Roles('ADMIN')
  @RequirePermissions()
  @ApiOperation({ summary: 'List insight providers and per-tenant configuration (admin only)' })
  @ApiResponse({ status: 200, description: 'Provider configuration' })
  providers(@CurrentUser() user: any) {
    return this.generation.listProviderConfigs(user.tenantId);
  }

  @Patch('providers/:providerId')
  @Roles('ADMIN')
  @RequirePermissions()
  @ApiOperation({ summary: 'Enable or disable an insight provider for the tenant (admin only)' })
  @ApiResponse({ status: 200, description: 'Updated provider configuration' })
  updateProvider(
    @CurrentUser() user: any,
    @Param('providerId') providerId: string,
    @Body() body: UpdateProviderDto,
  ) {
    return this.generation.setProviderEnabled(user.tenantId, providerId, body.enabled);
  }
}
