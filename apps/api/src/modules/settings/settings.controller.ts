import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth()
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get tenant settings' })
  async getSettings(@CurrentUser() user: any) {
    return this.settingsService.getSettings(user);
  }

  @Patch()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update tenant settings' })
  async updateSettings(
    @Body() updateSettingsDto: UpdateSettingsDto,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.updateSettings(updateSettingsDto, user);
  }

  @Get('domains')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get domain mappings' })
  async getDomainMappings(@CurrentUser() user: any) {
    return this.settingsService.getDomainMappings(user);
  }

  @Post('domains')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Add domain mapping' })
  async addDomainMapping(
    @Body('domain') domain: string,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.addDomainMapping(domain, user);
  }

  @Delete('domains/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remove domain mapping' })
  async removeDomainMapping(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.removeDomainMapping(id, user);
  }

  @Post('domains/:id/verify')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Verify domain ownership' })
  async verifyDomain(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.verifyDomain(id, user);
  }

  @Get('audit-logs')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get audit logs' })
  async getAuditLogs(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 50,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.getAuditLogs(user, page, pageSize);
  }

  @Get('audit-logs/export')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Export audit logs' })
  async exportAuditLogs(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('format') format: string = 'csv',
    @CurrentUser() user: any,
  ) {
    const logs = await this.settingsService.getAuditLogs(user, 1, 10000);
    return { data: logs.data, total: logs.meta?.total ?? logs.data?.length ?? 0, format, exportedAt: new Date().toISOString() };
  }

  @Get('api-keys')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get API keys' })
  async getApiKeys(@CurrentUser() user: any) {
    return this.settingsService.getApiKeys(user);
  }

  @Post('api-keys')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create API key' })
  async createApiKey(@Body() dto: any, @CurrentUser() user: any) {
    return this.settingsService.createApiKey(dto, user);
  }

  @Delete('api-keys/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Revoke API key' })
  async revokeApiKey(@Param('id') id: string, @CurrentUser() user: any) {
    return this.settingsService.revokeApiKey(id, user);
  }

  @Get('integrations')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get integrations' })
  async getIntegrations(@CurrentUser() user: any) {
    return this.settingsService.getIntegrations(user);
  }

  @Patch('integrations/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update integration' })
  async updateIntegration(
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.updateIntegration(id, dto, user);
  }

  @Post('integrations/:id/test')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Test integration connection' })
  async testIntegration(@Param('id') id: string, @CurrentUser() user: any) {
    return this.settingsService.testIntegration(id, user);
  }
}
