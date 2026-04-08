import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuditService {
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
    },
  ) {
    const page = params.page || 1;
    const pageSize = params.pageSize || 50;
    const skip = (page - 1) * pageSize;

    const where: any = { tenantId };
    if (params.entityType) where.entityType = params.entityType;
    if (params.entityId) where.entityId = params.entityId;
    if (params.action) where.action = params.action;
    if (params.userId) where.userId = params.userId;
    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) where.createdAt.gte = new Date(params.startDate);
      if (params.endDate) where.createdAt.lte = new Date(params.endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
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
