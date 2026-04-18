import { Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { NotificationService } from '../../core/notification/notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller({ path: 'notifications', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getNotifications(
    @Request() req: any,
    @Query('isRead') isRead?: string,
    @Query('type') type?: string,
    @Query('priority') priority?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.notificationService.getNotifications(req.user.tenantId, req.user.id, {
      isRead: isRead !== undefined ? isRead === 'true' : undefined,
      type,
      priority,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any) {
    return this.notificationService.getUnreadCount(req.user.tenantId, req.user.id);
  }

  @Put(':id/read')
  async markAsRead(@Request() req: any, @Param('id') id: string) {
    return this.notificationService.markAsRead(req.user.tenantId, req.user.id, id);
  }

  @Post('mark-all-read')
  async markAllAsRead(@Request() req: any) {
    return this.notificationService.markAllAsRead(req.user.tenantId, req.user.id);
  }

  @Delete(':id')
  async deleteNotification(@Request() req: any, @Param('id') id: string) {
    return this.notificationService.deleteNotification(req.user.tenantId, req.user.id, id);
  }

  @Delete('clear-read')
  async deleteAllRead(@Request() req: any) {
    return this.notificationService.deleteAllRead(req.user.tenantId, req.user.id);
  }
}
