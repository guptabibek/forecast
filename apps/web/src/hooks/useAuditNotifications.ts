import { useAuthStore } from '@stores/auth.store';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuditLogParams, auditService } from '../services/api/audit.service';
import { NotificationParams, notificationService } from '../services/api/notification.service';

// ============================================================================
// Audit Query Keys
// ============================================================================

export const auditKeys = {
  all: ['audit'] as const,
  logs: (params?: AuditLogParams) => [...auditKeys.all, 'logs', params] as const,
  stats: (days?: number) => [...auditKeys.all, 'stats', days] as const,
  entityHistory: (entityType: string, entityId: string) =>
    [...auditKeys.all, 'entity', entityType, entityId] as const,
};

// ============================================================================
// Notification Query Keys
// ============================================================================

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (params?: NotificationParams) => [...notificationKeys.all, 'list', params] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
};

// ============================================================================
// Audit Hooks
// ============================================================================

export function useAuditTrail(params?: AuditLogParams) {
  return useQuery({
    queryKey: auditKeys.logs(params),
    queryFn: () => auditService.getAuditLogs(params),
  });
}

export function useAuditTrailStats(days?: number) {
  return useQuery({
    queryKey: auditKeys.stats(days),
    queryFn: () => auditService.getAuditStats(days),
  });
}

export function useEntityHistory(entityType: string, entityId: string) {
  return useQuery({
    queryKey: auditKeys.entityHistory(entityType, entityId),
    queryFn: () => auditService.getEntityHistory(entityType, entityId),
    enabled: !!entityType && !!entityId,
  });
}

// ============================================================================
// Notification Hooks
// ============================================================================

export function useNotifications(params?: NotificationParams) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => notificationService.getNotifications(params),
    refetchInterval: 30000, // Poll every 30 seconds
    enabled: isAuthenticated,
  });
}

export function useUnreadCount() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationService.getUnreadCount(),
    refetchInterval: 15000, // Poll every 15 seconds
    enabled: isAuthenticated,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => notificationService.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => notificationService.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => notificationService.deleteNotification(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useClearReadNotifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => notificationService.deleteAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
