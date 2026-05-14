import type { SOPGapAnalysis } from '../../types';
import { apiClient } from './client';

// ============================================================================
// S&OP Gap Analysis Service
// ============================================================================

export const sopGapService = {
  async getAll(params?: {
    cycleId?: string;
    productId?: string;
    status?: string;
    priority?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/sop-gap-analysis', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/sop-gap-analysis/${id}`);
    return response.data;
  },

  async create(dto: {
    cycleId: string;
    productId?: string;
    locationId?: string;
    periodDate: string;
    demandQty: number;
    supplyQty: number;
    gapQty?: number;
    gapRevenue?: number;
    gapCost?: number;
    resolution?: string;
    priority?: string;
    assignedTo?: string;
  }) {
    const response = await apiClient.post('/manufacturing/sop-gap-analysis', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<SOPGapAnalysis>) {
    const response = await apiClient.patch(`/manufacturing/sop-gap-analysis/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/sop-gap-analysis/${id}`);
  },
};
