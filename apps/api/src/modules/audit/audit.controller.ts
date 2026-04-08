import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller({ path: 'audit', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('ADMIN')
  async getAuditLogs(
    @Request() req: any,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.auditService.getAuditLogs(req.user.tenantId, {
      entityType,
      entityId,
      action,
      userId,
      startDate,
      endDate,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('stats')
  @Roles('ADMIN')
  async getAuditStats(@Request() req: any, @Query('days') days?: string) {
    return this.auditService.getAuditStats(req.user.tenantId, days ? parseInt(days) : 30);
  }

  @Get('entity/:entityType/:entityId')
  async getEntityHistory(
    @Request() req: any,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.auditService.getEntityHistory(req.user.tenantId, entityType, entityId);
  }
}
