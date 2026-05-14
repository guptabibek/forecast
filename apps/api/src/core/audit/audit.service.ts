import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { applyGridQuery } from '../filtering/grid-query.helper';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuditService {
  private static readonly AUDIT_LOG_ALLOWED_FIELDS = {
    entityType: 'string',
    entityId: 'string',
    action: 'enum',
    description: 'string',
    ipAddress: 'string',
    createdAt: 'date',
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  async log(
    tenantId: string,
    userId: string | null,
    action: AuditAction,
    entityType: string,
    entityId: string,
    oldValues?: Record<string, any> | null,
    newValues?: Record<string, any> | null,
    changedFields?: string[],
    metadata?: Record<string, any>,
  ) {
    const clsRequestId = this.cls.isActive()
      ? this.cls.get<string>('requestId')
      : undefined;
    const clsIpAddress = this.cls.isActive()
      ? this.cls.get<string>('ipAddress')
      : undefined;
    const clsUserAgent = this.cls.isActive()
      ? this.cls.get<string>('userAgent')
      : undefined;

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        entityType,
        entityId,
        oldValues: oldValues || undefined,
        newValues: newValues || undefined,
        changedFields: changedFields || [],
        requestId: clsRequestId,
        ipAddress: clsIpAddress,
        userAgent: clsUserAgent,
        metadata: metadata || undefined,
      },
    });
  }

  async getAuditLogs(
    tenantId: string,
    params: {
      entityType?: string;
      entityId?: string;
      action?: string;
      userId?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
      filters?: string;
    },
  ) {
    const baseWhere: any = { tenantId };
    if (params.entityType) baseWhere.entityType = params.entityType;
    if (params.entityId) baseWhere.entityId = params.entityId;
    if (params.action) baseWhere.action = params.action;
    if (params.userId) baseWhere.userId = params.userId;
    if (params.startDate || params.endDate) {
      baseWhere.createdAt = {};
      if (params.startDate) baseWhere.createdAt.gte = new Date(params.startDate);
      if (params.endDate) baseWhere.createdAt.lte = new Date(params.endDate);
    }

    return applyGridQuery<any>(this.prisma.auditLog, params, {
      baseWhere,
      allowedFields: AuditService.AUDIT_LOG_ALLOWED_FIELDS,
      defaultOrderBy: { createdAt: 'desc' },
      defaultPageSize: 50,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  async getEntityHistory(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { tenantId, entityType, entityId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAuditStats(tenantId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [totalActions, actionBreakdown, topUsers, topEntities] = await Promise.all([
      this.prisma.auditLog.count({ where: { tenantId, createdAt: { gte: since } } }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where: { tenantId, createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.auditLog.groupBy({
        by: ['userId'],
        where: { tenantId, createdAt: { gte: since }, userId: { not: null } },
        _count: true,
        orderBy: { _count: { userId: 'desc' } },
        take: 10,
      }),
      this.prisma.auditLog.groupBy({
        by: ['entityType'],
        where: { tenantId, createdAt: { gte: since } },
        _count: true,
        orderBy: { _count: { entityType: 'desc' } },
        take: 10,
      }),
    ]);

    return { totalActions, actionBreakdown, topUsers, topEntities, periodDays: days };
  }
}
