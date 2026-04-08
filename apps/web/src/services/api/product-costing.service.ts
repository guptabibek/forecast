import type { CostType, ProductCosting } from '../../types';
import { apiClient } from './client';

// ============================================================================
// Product Costing Service
// ============================================================================

export const productCostingService = {
  async getAll(params?: {
    productId?: string;
    locationId?: string;
    costType?: CostType;
    effectiveDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/product-costings', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/product-costings/${id}`);
    return response.data;
  },

  async create(dto: {
    productId: string;
    locationId?: string;
    costType?: CostType;
    effectiveFrom: string;
    effectiveTo?: string;
    materialCost?: number;
    laborCost?: number;
    overheadCost?: number;
    subcontractCost?: number;
    currency?: string;
    version?: string;
    notes?: string;
  }) {
    const response = await apiClient.post('/manufacturing/product-costings', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<ProductCosting>) {
    const response = await apiClient.patch(`/manufacturing/product-costings/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/product-costings/${id}`);
  },
};
