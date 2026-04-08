import type { UnitOfMeasureConversion } from '../../types';
import { apiClient } from './client';

// ============================================================================
// UoM Conversion Service
// ============================================================================

export const uomConversionService = {
  async getAll(params?: {
    fromUom?: string;
    toUom?: string;
    productId?: string;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/uom-conversions', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/uom-conversions/${id}`);
    return response.data;
  },

  async create(dto: {
    fromUom: string;
    toUom: string;
    fromUomId?: string;
    toUomId?: string;
    productId?: string;
    factor: number;
    isActive?: boolean;
  }) {
    const response = await apiClient.post('/manufacturing/uom-conversions', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<UnitOfMeasureConversion>) {
    const response = await apiClient.patch(`/manufacturing/uom-conversions/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/uom-conversions/${id}`);
  },

  async convert(fromUom: string, toUom: string, quantity: number, productId?: string) {
    const response = await apiClient.get('/manufacturing/uom-conversions/convert', {
      params: { fromUom, toUom, quantity, productId },
    });
    return response.data;
  },
};
