import type { UnitOfMeasure } from '../../types';
import { apiClient } from './client';

// ============================================================================
// UoM Master Service
// ============================================================================

export const uomService = {
  async getAll(params?: {
    category?: string;
    isActive?: boolean;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/uoms', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/uoms/${id}`);
    return response.data;
  },

  async create(dto: {
    code: string;
    name: string;
    symbol?: string;
    category?: string;
    description?: string;
    decimals?: number;
    isBase?: boolean;
    isActive?: boolean;
    sortOrder?: number;
  }) {
    const response = await apiClient.post('/manufacturing/uoms', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<UnitOfMeasure>) {
    const response = await apiClient.patch(`/manufacturing/uoms/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/uoms/${id}`);
  },
};
