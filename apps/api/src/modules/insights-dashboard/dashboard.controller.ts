import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../platform/require-module.decorator';
import { DashboardService, WIDGET_SIZES, WidgetSize } from './dashboard.service';
import { InsightGenerationService } from './insight-generation.service';
import { WidgetExecutorService } from './widget-executor.service';

class CreateDashboardDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

class UpdateDashboardDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class CloneDashboardDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

class PinReportDto {
  @IsUUID('4')
  requestId!: string;

  @IsOptional()
  @IsUUID('4')
  dashboardId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(WIDGET_SIZES as readonly string[])
  size?: WidgetSize;

  @IsOptional()
  @IsInt()
  @Min(0)
  refreshIntervalSec?: number;
}

class UpdateWidgetDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(WIDGET_SIZES as readonly string[])
  size?: WidgetSize;

  @IsOptional()
  @IsIn(['auto', 'table', 'bar', 'line', 'pie', 'kpi'])
  vizType?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  refreshIntervalSec?: number | null;
}

class LayoutItemDto {
  @IsUUID('4')
  widgetId!: string;

  @IsInt()
  @Min(0)
  position!: number;

  @IsOptional()
  @IsIn(WIDGET_SIZES as readonly string[])
  size?: WidgetSize;
}

class UpdateLayoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LayoutItemDto)
  items!: LayoutItemDto[];
}

class ExecuteWidgetDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@ApiTags('AI Insights Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireModule('ai-reporting')
@RequirePermissions('report:read')
@Controller('ai-dashboard')
export class DashboardController {
  constructor(
    private readonly dashboards: DashboardService,
    private readonly widgetExecutor: WidgetExecutorService,
    private readonly insightGeneration: InsightGenerationService,
  ) {}

  /**
   * Refreshes ONLY the pinned-report analysis insight for this tenant so a
   * just-pinned report shows up in the insights feed immediately instead of
   * waiting for the 6-hourly cycle. Fire-and-forget: analysis failures must
   * never fail the pin/unpin request itself.
   */
  private refreshPinnedReportInsights(tenantId: string) {
    void this.insightGeneration
      .generateForTenant(tenantId, { providerIds: ['pinned-reports'] })
      .catch(() => undefined);
  }

  @Get()
  @ApiOperation({ summary: 'List the current user dashboards (creates a default on first use)' })
  @ApiResponse({ status: 200, description: 'User dashboards' })
  list(@CurrentUser() user: any) {
    return this.dashboards.listDashboards(user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a dashboard' })
  @ApiResponse({ status: 201, description: 'Created dashboard' })
  create(@CurrentUser() user: any, @Body() body: CreateDashboardDto) {
    return this.dashboards.createDashboard(user, body);
  }

  @Patch(':dashboardId')
  @ApiOperation({ summary: 'Rename a dashboard or set it as default' })
  @ApiResponse({ status: 200, description: 'Updated dashboard' })
  update(
    @CurrentUser() user: any,
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Body() body: UpdateDashboardDto,
  ) {
    return this.dashboards.updateDashboard(user, dashboardId, body);
  }

  @Delete(':dashboardId')
  @ApiOperation({ summary: 'Delete a dashboard and its widgets' })
  @ApiResponse({ status: 200, description: 'Deletion result' })
  remove(@CurrentUser() user: any, @Param('dashboardId', ParseUUIDPipe) dashboardId: string) {
    return this.dashboards.deleteDashboard(user, dashboardId);
  }

  @Post(':dashboardId/clone')
  @ApiOperation({ summary: 'Clone a dashboard including its widgets' })
  @ApiResponse({ status: 201, description: 'Cloned dashboard' })
  clone(
    @CurrentUser() user: any,
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Body() body: CloneDashboardDto,
  ) {
    return this.dashboards.cloneDashboard(user, dashboardId, body.name);
  }

  @Get(':dashboardId/widgets')
  @ApiOperation({ summary: 'Get dashboard layout and widget definitions (no data — widgets load async)' })
  @ApiResponse({ status: 200, description: 'Dashboard widgets' })
  widgets(@CurrentUser() user: any, @Param('dashboardId', ParseUUIDPipe) dashboardId: string) {
    return this.dashboards.getWidgets(user, dashboardId);
  }

  @Patch(':dashboardId/layout')
  @ApiOperation({ summary: 'Persist widget order and sizes' })
  @ApiResponse({ status: 200, description: 'Updated layout' })
  layout(
    @CurrentUser() user: any,
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Body() body: UpdateLayoutDto,
  ) {
    return this.dashboards.updateLayout(user, dashboardId, body.items);
  }

  @Post('widgets/pin')
  @ApiOperation({ summary: 'Pin a previously executed AI report to a dashboard' })
  @ApiResponse({ status: 201, description: 'Created widget' })
  async pin(@CurrentUser() user: any, @Body() body: PinReportDto) {
    const widget = await this.dashboards.pinReport(user, body);
    this.refreshPinnedReportInsights(user.tenantId);
    return widget;
  }

  @Patch('widgets/:widgetId')
  @ApiOperation({ summary: 'Update widget title, size, visualization, or refresh frequency' })
  @ApiResponse({ status: 200, description: 'Updated widget' })
  async updateWidget(
    @CurrentUser() user: any,
    @Param('widgetId', ParseUUIDPipe) widgetId: string,
    @Body() body: UpdateWidgetDto,
  ) {
    const widget = await this.dashboards.updateWidget(user, widgetId, body);
    // Settings like vizType change the rendered payload — drop the cached execution.
    await this.widgetExecutor.invalidate(user.tenantId, widgetId);
    return widget;
  }

  @Post('widgets/:widgetId/duplicate')
  @ApiOperation({ summary: 'Duplicate a widget' })
  @ApiResponse({ status: 201, description: 'Duplicated widget' })
  duplicate(@CurrentUser() user: any, @Param('widgetId', ParseUUIDPipe) widgetId: string) {
    return this.dashboards.duplicateWidget(user, widgetId);
  }

  @Delete('widgets/:widgetId')
  @ApiOperation({ summary: 'Unpin (delete) a widget' })
  @ApiResponse({ status: 200, description: 'Deletion result' })
  async unpin(@CurrentUser() user: any, @Param('widgetId', ParseUUIDPipe) widgetId: string) {
    const result = await this.dashboards.unpinWidget(user, widgetId);
    await this.widgetExecutor.invalidate(user.tenantId, widgetId);
    // Re-running the analysis with the widget gone archives its insight.
    this.refreshPinnedReportInsights(user.tenantId);
    return result;
  }

  @Post('widgets/:widgetId/execute')
  @ApiOperation({ summary: 'Execute a pinned widget under the current user security context' })
  @ApiResponse({ status: 200, description: 'Widget report payload' })
  execute(
    @CurrentUser() user: any,
    @Param('widgetId', ParseUUIDPipe) widgetId: string,
    @Body() body: ExecuteWidgetDto,
  ) {
    return this.widgetExecutor.execute(user, widgetId, { force: body.force === true });
  }
}
