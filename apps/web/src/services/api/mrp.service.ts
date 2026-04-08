import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface MRPRun {
  id: string;
  name: string;
  runType: 'NET_CHANGE' | 'FULL_REGENERATION';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt?: string;
  completedAt?: string;
  parameters: Record<string, unknown>;
  summary?: {
    totalRequirements: number;
    plannedOrdersCreated: number;
    exceptionsRaised: number;
  };
}

export interface PlannedOrder {
  id: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  locationId: string;
  orderType: 'PURCHASE' | 'MANUFACTURING' | 'TRANSFER';
  status: 'PLANNED' | 'FIRMED' | 'RELEASED' | 'CANCELLED';
  dueDate: string;
  startDate: string;
  quantity: number;
  supplierId?: string;
  workCenterId?: string;
}

export interface MRPException {
  id: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  exceptionType: 'PAST_DUE' | 'EXPEDITE' | 'DEFER' | 'SHORTAGE' | 'EXCESS' | 'CANCEL';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'IGNORED';
  message: string;
  recommendedAction?: string;
  dueDate?: string;
  shortageQty?: number;
}

// ============================================================================
// MRP Service
// ============================================================================

export const mrpService = {
  // MRP Runs
  async getAllRuns(params?: {
    runType?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/mrp/runs', { params });
    return response.data;
  },

  async getRun(runId: string) {
    const response = await apiClient.get(`/manufacturing/mrp/runs/${runId}`);
    return response.data;
  },

  async createRun(dto: {
    name: string;
    runType?: 'NET_CHANGE' | 'FULL_REGENERATION';
    planningHorizonDays?: number;
    frozenPeriodDays?: number;
    productIds?: string[];
    locationIds?: string[];
    respectLeadTime?: boolean;
    considerSafetyStock?: boolean;
  }) {
    const response = await apiClient.post('/manufacturing/mrp/runs', dto);
    return response.data;
  },

  async executeRun(runId: string) {
    const response = await apiClient.post(`/manufacturing/mrp/runs/${runId}/execute`);
    return response.data;
  },

  async getRunRequirements(runId: string, params?: {
    productId?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const response = await apiClient.get(`/manufacturing/mrp/runs/${runId}/requirements`, { params });
    return response.data;
  },

  // Planned Orders
  async getPlannedOrders(params?: {
    status?: string;
    orderType?: string;
    productId?: string;
    locationId?: string;
    dueDateStart?: string;
    dueDateEnd?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/mrp/planned-orders', { params });
    return response.data;
  },

  async getPlannedOrder(orderId: string) {
    const response = await apiClient.get(`/manufacturing/mrp/planned-orders/${orderId}`);
    return response.data;
  },

  async updatePlannedOrder(orderId: string, dto: {
    quantity?: number;
    dueDate?: string;
    startDate?: string;
    supplierId?: string;
  }) {
    const response = await apiClient.put(`/manufacturing/mrp/planned-orders/${orderId}`, dto);
    return response.data;
  },

  async firmPlannedOrder(orderId: string) {
    const response = await apiClient.post(`/manufacturing/mrp/planned-orders/${orderId}/firm`);
    return response.data;
  },

  async releasePlannedOrder(orderId: string) {
    const response = await apiClient.post(`/manufacturing/mrp/planned-orders/${orderId}/release`);
    return response.data;
  },

  async cancelPlannedOrder(orderId: string, reason?: string) {
    const response = await apiClient.post(`/manufacturing/mrp/planned-orders/${orderId}/cancel`, { reason });
    return response.data;
  },

  async bulkUpdateOrders(orderIds: string[], action: 'firm' | 'release' | 'cancel') {
    const response = await apiClient.post('/manufacturing/mrp/planned-orders/bulk', {
      orderIds,
      action,
    });
    return response.data;
  },

  // Exceptions
  async getExceptions(params?: {
    status?: string;
    exceptionType?: string;
    severity?: string;
    productId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/mrp/exceptions', { params });
    return response.data;
  },

  async acknowledgeException(exceptionId: string) {
    const response = await apiClient.post(`/manufacturing/mrp/exceptions/${exceptionId}/acknowledge`);
    return response.data;
  },

  async resolveException(exceptionId: string, resolution?: string) {
    const response = await apiClient.post(`/manufacturing/mrp/exceptions/${exceptionId}/resolve`, { resolution });
    return response.data;
  },

  async ignoreException(exceptionId: string, reason?: string) {
    const response = await apiClient.post(`/manufacturing/mrp/exceptions/${exceptionId}/ignore`, { reason });
    return response.data;
  },

  // Summary
  async getMRPSummary() {
    const response = await apiClient.get('/manufacturing/mrp/summary');
    return response.data;
  },

  // Aliases for hook compatibility
  async getRuns(params?: {
    runType?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/mrp/runs', { params });
    return response.data;
  },

  async getRunSummary(runId: string) {
    const response = await apiClient.get(`/manufacturing/mrp/runs/${runId}`);
    return response.data;
  },

  async runMRP(dto: {
    name: string;
    runType?: 'NET_CHANGE' | 'FULL_REGENERATION';
    planningHorizonDays?: number;
    productIds?: string[];
    locationIds?: string[];
    respectLeadTime?: boolean;
    considerSafetyStock?: boolean;
  }) {
    const createResp = await apiClient.post('/manufacturing/mrp/runs', dto);
    const run = createResp.data;
    const execResp = await apiClient.post(`/manufacturing/mrp/runs/${run.id}/execute`);
    return execResp.data;
  },

  async deleteRun(_runId: string) {
    throw new Error('MRP run deletion is not supported. Runs are immutable audit records.');
  },

  async createPlannedOrder(dto: {
    productId: string;
    locationId: string;
    orderType: string;
    quantity: number;
    dueDate: string;
    startDate?: string;
    supplierId?: string;
  }) {
    const response = await apiClient.post('/manufacturing/mrp/planned-orders', dto);
    return response.data;
  },

  async bulkFirmOrders(orderIds: string[]) {
    const response = await apiClient.post('/manufacturing/mrp/planned-orders/bulk', {
      orderIds,
      action: 'firm',
    });
    return response.data;
  },

  async bulkReleaseOrders(orderIds: string[]) {
    const response = await apiClient.post('/manufacturing/mrp/planned-orders/bulk', {
      orderIds,
      action: 'release',
    });
    return response.data;
  },

  async deletePlannedOrder(orderId: string) {
    const response = await apiClient.post(`/manufacturing/mrp/planned-orders/${orderId}/cancel`, {
      reason: 'Deleted by user',
    });
    return response.data;
  },

  async dismissException(exceptionId: string, reason?: string) {
    const response = await apiClient.post(`/manufacturing/mrp/exceptions/${exceptionId}/ignore`, { reason });
    return response.data;
  },

  async bulkResolveExceptions(dto: { exceptionIds: string[]; resolution?: string }) {
    return Promise.all(
      dto.exceptionIds.map((id) =>
        apiClient.post(`/manufacturing/mrp/exceptions/${id}/resolve`, { resolution: dto.resolution }).then(r => r.data),
      ),
    );
  },

  async getRequirements(runId: string, params?: {
    productId?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const response = await apiClient.get(`/manufacturing/mrp/runs/${runId}/requirements`, { params });
    return response.data;
  },
};

export default mrpService;
