import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  userId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW' | 'EXPORT' | 'IMPORT' | 'LOGIN' | 'LOGOUT' | 'APPROVE' | 'LOCK' | 'UNLOCK';
  entityType: string;
  entityId: string;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface AuditLogParams {
  page?: number;
  pageSize?: number;
  entityType?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditStats {
  totalActions: number;
  actionBreakdown: Array<{ action: string; _count: { action: number } }>;
  topUsers: Array<{ userId: string; _count: { userId: number }; user?: { firstName: string; lastName: string; email: string } }>;
  topEntities: Array<{ entityType: string; _count: { entityType: number } }>;
}

// ============================================================================
// Audit Service
// ============================================================================

export const auditService = {
  async getAuditLogs(params?: AuditLogParams): Promise<{
    data: AuditLogEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const response = await apiClient.get('/audit', { params });
    const payload = response.data;
    return {
      data: payload.items ?? payload.data ?? [],
      total: payload.total ?? 0,
      page: payload.page ?? 1,
      pageSize: payload.pageSize ?? 25,
      totalPages: payload.totalPages ?? 1,
    };
  },

  async getAuditStats(days?: number): Promise<AuditStats> {
    const response = await apiClient.get('/audit/stats', { params: { days } });
    return response.data;
  },

  async getEntityHistory(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
    const response = await apiClient.get(`/audit/entity/${entityType}/${entityId}`);
    return response.data;
  },
};
