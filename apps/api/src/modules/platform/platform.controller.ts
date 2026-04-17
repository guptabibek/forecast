import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TenantLicenseStatus, TenantStatus, TenantTier } from '@prisma/client';
import { TenantId } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformModuleKey } from './platform.constants';
import { PlatformService } from './platform.service';

@ApiTags('Platform Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  // ─── Dashboard ────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide statistics' })
  async getStats() {
    return { data: await this.platformService.getStats() };
  }

  // ─── Tenants ──────────────────────────────────────────────────

  @Get('tenants')
  @ApiOperation({ summary: 'List all tenants' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELLED'] })
  @ApiQuery({ name: 'tier', required: false, enum: ['STARTER', 'PROFESSIONAL', 'ENTERPRISE'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listTenants(
    @Query('status') status?: TenantStatus,
    @Query('tier') tier?: TenantTier,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.platformService.listTenants({
      status,
      tier,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Get tenant details' })
  async getTenant(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.platformService.getTenant(id) };
  }

  @Patch('tenants/:id')
  @ApiOperation({ summary: 'Update tenant (status, tier, settings)' })
  async updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      status?: TenantStatus;
      tier?: TenantTier;
      domain?: string;
      subdomain?: string;
      timezone?: string;
      defaultCurrency?: string;
      dataRetentionDays?: number;
      licenseStatus?: TenantLicenseStatus;
      licenseExpiresAt?: string | null;
    },
  ) {
    return { data: await this.platformService.updateTenant(id, body) };
  }

  @Post('tenants')
  @ApiOperation({ summary: 'Create a new tenant with admin user' })
  async createTenant(
    @Body()
    body: {
      name: string;
      slug: string;
      adminEmail: string;
      adminPassword: string;
      adminFirstName?: string;
      adminLastName?: string;
      status?: TenantStatus;
      tier?: TenantTier;
      domain?: string;
      timezone?: string;
      defaultCurrency?: string;
    },
  ) {
    return { data: await this.platformService.createTenant(body) };
  }

  @Post('tenants/:id/reset-data')
  @ApiOperation({ summary: 'Delete tenant data but preserve admin logins and tenant config' })
  async resetTenantData(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.platformService.resetTenantData(id) };
  }

  @Post('tenants/:id/reset-domains')
  @ApiOperation({ summary: 'Reset tenant domains to the default workspace subdomain' })
  async resetTenantDomains(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.platformService.resetTenantDomains(id) };
  }

  // ─── Modules ──────────────────────────────────────────────────

  @Get('tenants/:id/modules')
  @ApiOperation({ summary: 'Get modules configuration for a tenant' })
  async getModules(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.platformService.getModulesForTenant(id) };
  }

  @Post('tenants/:id/modules')
  @ApiOperation({ summary: 'Set modules for a tenant (batch upsert)' })
  async setModules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { modules: Array<{ module: PlatformModuleKey; enabled: boolean; config?: Record<string, unknown> }> },
  ) {
    return { data: await this.platformService.setModulesForTenant(id, body.modules) };
  }

  @Patch('tenants/:id/modules/:module')
  @ApiOperation({ summary: 'Toggle a single module for a tenant' })
  async toggleModule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('module') module: PlatformModuleKey,
    @Body() body: { enabled: boolean },
  ) {
    return { data: await this.platformService.toggleModule(id, module, body.enabled) };
  }

  // ─── Tenant Users ─────────────────────────────────────────────

  @Get('tenants/:id/users')
  @ApiOperation({ summary: 'List users of a specific tenant' })
  async listTenantUsers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.platformService.listTenantUsers(id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ─── Current Tenant Modules (non-admin, for any logged-in user) ──

  @Get('modules/me')
  @Roles('SUPER_ADMIN', 'ADMIN', 'PLANNER', 'FORECAST_PLANNER', 'FINANCE', 'VIEWER', 'FORECAST_VIEWER')
  @ApiOperation({ summary: 'Get enabled modules for the current tenant (used by frontend sidebar)' })
  async getMyModules(@TenantId() tenantId: string) {
    return { data: await this.platformService.getEnabledModulesForTenant(tenantId) };
  }
}
