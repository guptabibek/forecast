import { apiClient } from './client';

// ============================================================================
// Batch Management Service
// ============================================================================

export const batchService = {
  async getAll(params?: {
    status?: string;
    productId?: string;
    locationId?: string;
    expiringBefore?: string;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/batches', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/batches/${id}`);
    return response.data;
  },

  async create(dto: {
    batchNumber?: string;
    productId: string;
    locationId: string;
    quantity: number;
    availableQty?: number;
    uom?: string;
    status?: string;
    manufacturingDate?: string;
    expiryDate?: string;
    supplierId?: string;
    purchaseOrderId?: string;
    workOrderId?: string;
    costPerUnit?: number;
    notes?: string;
  }) {
    const response = await apiClient.post('/manufacturing/batches', dto);
    return response.data;
  },

  async update(id: string, dto: {
    quantity?: number;
    availableQty?: number;
    status?: string;
    locationId?: string;
    expiryDate?: string;
    costPerUnit?: number;
    notes?: string;
  }) {
    const response = await apiClient.patch(`/manufacturing/batches/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    const response = await apiClient.delete(`/manufacturing/batches/${id}`);
    return response.data;
  },
};
