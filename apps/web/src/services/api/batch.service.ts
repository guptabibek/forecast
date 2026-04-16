import type { Batch } from '../../types';
import { apiClient } from './client';

export interface BatchListSummary {
  totalBatches: number;
  totalQty: number;
  totalAvailableQty: number;
  totalValue: number;
  expiredQty: number;
  expiredValue: number;
  nearExpiry30Qty: number;
  nearExpiry30Value: number;
  nearExpiry90Qty: number;
  nearExpiry90Value: number;
  ageBuckets: {
    '0-3m': number;
    '3-6m': number;
    '6-12m': number;
    '>12m': number;
  };
}

export interface BatchListResponse {
  items: Batch[];
  total: number;
  page: number;
  pageSize: number;
  summary: BatchListSummary;
}

// ============================================================================
// Batch Management Service
// ============================================================================

export const batchService = {
  async getAll(params?: {
    status?: string;
    productId?: string;
    locationId?: string;
    expiringBefore?: string;
    expiredOnly?: boolean;
    daysToExpiry?: number;
    ageBucket?: string;
    page?: number;
    pageSize?: number;
  }): Promise<BatchListResponse> {
    const response = await apiClient.get('/manufacturing/batches', { params });
    return response.data;
  },

  async getById(id: string): Promise<Batch> {
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
  }): Promise<Batch> {
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
  }): Promise<Batch> {
    const response = await apiClient.patch(`/manufacturing/batches/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    const response = await apiClient.delete(`/manufacturing/batches/${id}`);
    return response.data;
  },
};
