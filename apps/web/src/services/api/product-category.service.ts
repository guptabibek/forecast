import type { ProductCategory } from '../../types';
import { apiClient } from './client';

// ============================================================================
// Product Category Master Service
// ============================================================================

export const productCategoryService = {
  async getAll(params?: {
    isActive?: boolean;
    search?: string;
    parentId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/product-categories', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/product-categories/${id}`);
    return response.data;
  },

  async create(dto: {
    code: string;
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    parentId?: string;
    sortOrder?: number;
    isActive?: boolean;
  }) {
    const response = await apiClient.post('/manufacturing/product-categories', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<ProductCategory>) {
    const response = await apiClient.patch(`/manufacturing/product-categories/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/product-categories/${id}`);
  },
};
