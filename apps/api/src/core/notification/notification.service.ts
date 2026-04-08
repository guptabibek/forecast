import { Injectable, Logger } from '@nestjs/common';
import { NotificationPriority, NotificationType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    tenantId: string;
    userId: string;
    type: NotificationType;
    priority?: NotificationPriority;
    title: string;
    message: string;
    entityType?: string;
    entityId?: string;
    actionUrl?: string;
    metadata?: Record<string, any>;
  }) {
    return this.prisma.notification.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        type: params.type,
        priority: params.priority || 'NORMAL',
        title: params.title,
        message: params.message,
        entityType: params.entityType,
        entityId: params.entityId,
        actionUrl: params.actionUrl,
        metadata: params.metadata || undefined,
      },
    });
  }

  async notifyMany(params: {
    tenantId: string;
    userIds: string[];
    type: NotificationType;
    priority?: NotificationPriority;
    title: string;
    message: string;
    entityType?: string;
    entityId?: string;
    actionUrl?: string;
  }) {
    const data = params.userIds.map((userId) => ({
      tenantId: params.tenantId,
      userId,
      type: params.type,
      priority: params.priority || ('NORMAL' as NotificationPriority),
      title: params.title,
      message: params.message,
      entityType: params.entityType,
      entityId: params.entityId,
      actionUrl: params.actionUrl,
    }));

    return this.prisma.notification.createMany({ data });
  }

  async getNotifications(
    tenantId: string,
    userId: string,
    params: {
      isRead?: boolean;
      type?: string;
      priority?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const skip = (page - 1) * pageSize;

    const where: any = { tenantId, userId };
    if (params.isRead !== undefined) where.isRead = params.isRead;
    if (params.type) where.type = params.type;
    if (params.priority) where.priority = params.priority;

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { tenantId, userId, isRead: false } }),
    ]);

    return { items, total, unreadCount, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getUnreadCount(tenantId: string, userId: string) {
    const count = await this.prisma.notification.count({
      where: { tenantId, userId, isRead: false },
    });
    return { unreadCount: count };
  }

  async markAsRead(tenantId: string, userId: string, notificationId: string) {
    return this.prisma.notification.update({
      where: { id: notificationId, tenantId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(tenantId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  }

  async deleteNotification(tenantId: string, userId: string, notificationId: string) {
    return this.prisma.notification.delete({
      where: { id: notificationId, tenantId, userId },
    });
  }

  async deleteAllRead(tenantId: string, userId: string) {
    const result = await this.prisma.notification.deleteMany({
      where: { tenantId, userId, isRead: true },
    });
    return { deleted: result.count };
  }

  // ==============================
  // Trigger helpers for common events
  // ==============================

  async notifyApprovalRequired(tenantId: string, approverId: string, entityType: string, entityId: string, entityName: string) {
    return this.create({
      tenantId,
      userId: approverId,
      type: 'APPROVAL_REQUIRED',
      priority: 'HIGH',
      title: `Approval Required: ${entityType}`,
      message: `"${entityName}" requires your approval.`,
      entityType,
      entityId,
      actionUrl: `/manufacturing/workflow`,
    });
  }

  async notifyApprovalCompleted(tenantId: string, requesterId: string, entityType: string, entityId: string, entityName: string, approved: boolean) {
    return this.create({
      tenantId,
      userId: requesterId,
      type: 'APPROVAL_COMPLETED',
      priority: 'NORMAL',
      title: `${entityType} ${approved ? 'Approved' : 'Rejected'}`,
      message: `"${entityName}" has been ${approved ? 'approved' : 'rejected'}.`,
      entityType,
      entityId,
    });
  }

  async notifyLowInventory(tenantId: string, userId: string, productName: string, currentQty: number, reorderPoint: number) {
    return this.create({
      tenantId,
      userId,
      type: 'INVENTORY_LOW',
      priority: 'HIGH',
      title: 'Low Inventory Alert',
      message: `${productName}: ${currentQty} units remaining (reorder point: ${reorderPoint}).`,
      actionUrl: '/manufacturing/inventory',
    });
  }

  async notifyMRPException(tenantId: string, userId: string, exceptionType: string, productName: string, details: string) {
    return this.create({
      tenantId,
      userId,
      type: 'MRP_EXCEPTION',
      priority: 'HIGH',
      title: `MRP Exception: ${exceptionType}`,
      message: `${productName} — ${details}`,
      actionUrl: '/manufacturing/mrp',
    });
  }

  async notifyWorkOrderDelay(tenantId: string, userId: string, woNumber: string, daysLate: number) {
    return this.create({
      tenantId,
      userId,
      type: 'WORK_ORDER_DELAY',
      priority: daysLate > 3 ? 'URGENT' : 'HIGH',
      title: 'Work Order Delayed',
      message: `WO ${woNumber} is ${daysLate} day(s) behind schedule.`,
      actionUrl: '/manufacturing/work-orders',
    });
  }

  async notifyPODue(tenantId: string, userId: string, poNumber: string, dueDate: string) {
    return this.create({
      tenantId,
      userId,
      type: 'PO_DUE',
      priority: 'NORMAL',
      title: 'Purchase Order Due Soon',
      message: `PO ${poNumber} is due on ${dueDate}.`,
      actionUrl: '/manufacturing/purchase-orders',
    });
  }

  async notifyImportComplete(tenantId: string, userId: string, fileName: string, recordCount: number) {
    return this.create({
      tenantId,
      userId,
      type: 'IMPORT_COMPLETE',
      priority: 'LOW',
      title: 'Data Import Complete',
      message: `"${fileName}" imported successfully with ${recordCount} records.`,
      actionUrl: '/data/import',
    });
  }

  async notifyForecastComplete(tenantId: string, userId: string, planName: string) {
    return this.create({
      tenantId,
      userId,
      type: 'FORECAST_COMPLETE',
      priority: 'NORMAL',
      title: 'Forecast Complete',
      message: `Forecast for "${planName}" has been completed.`,
      actionUrl: '/forecasts',
    });
  }
}
