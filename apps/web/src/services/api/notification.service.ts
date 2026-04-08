import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export type NotificationType =
  | 'INFO'
  | 'WARNING'
  | 'ERROR'
  | 'SUCCESS'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_COMPLETED'
  | 'INVENTORY_LOW'
  | 'MRP_EXCEPTION'
  | 'WORK_ORDER_DELAY'
  | 'PO_DUE'
  | 'IMPORT_COMPLETE'
  | 'FORECAST_COMPLETE';

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  isRead: boolean;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationParams {
  page?: number;
  pageSize?: number;
  isRead?: boolean;
  type?: NotificationType;
  priority?: NotificationPriority;
}

export interface NotificationListResponse {
  data: Notification[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================================================
// Notification Service
// ============================================================================

export const notificationService = {
  async getNotifications(params?: NotificationParams): Promise<NotificationListResponse> {
    const response = await apiClient.get('/notifications', { params });
    return response.data;
  },

  async getUnreadCount(): Promise<{ count: number }> {
    const response = await apiClient.get('/notifications/unread-count');
    return response.data;
  },

  async markAsRead(id: string): Promise<Notification> {
    const response = await apiClient.put(`/notifications/${id}/read`);
    return response.data;
  },

  async markAllAsRead(): Promise<{ count: number }> {
    const response = await apiClient.post('/notifications/mark-all-read');
    return response.data;
  },

  async deleteNotification(id: string): Promise<void> {
    await apiClient.delete(`/notifications/${id}`);
  },

  async deleteAllRead(): Promise<{ count: number }> {
    const response = await apiClient.delete('/notifications/clear-read');
    return response.data;
  },
};
