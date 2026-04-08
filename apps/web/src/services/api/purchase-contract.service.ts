import type { PurchaseContract, PurchaseContractLine, PurchaseContractType } from '../../types';
import { apiClient } from './client';

// ============================================================================
// Purchase Contract Service
// ============================================================================

export const purchaseContractService = {
  // ---- Contracts ----
  async getAll(params?: {
    supplierId?: string;
    contractType?: PurchaseContractType;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/purchase-contracts', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/purchase-contracts/${id}`);
    return response.data;
  },

  async create(dto: {
    contractNumber: string;
    supplierId: string;
    contractType?: PurchaseContractType;
    startDate: string;
    endDate: string;
    totalValue?: number;
    currency?: string;
    paymentTerms?: string;
    notes?: string;
  }) {
    const response = await apiClient.post('/manufacturing/purchase-contracts', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<PurchaseContract>) {
    const response = await apiClient.patch(`/manufacturing/purchase-contracts/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/purchase-contracts/${id}`);
  },

  // ---- Contract Lines ----
  async getLines(contractId: string, params?: {
    productId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get(`/manufacturing/purchase-contracts/${contractId}/lines`, { params });
    return response.data;
  },

  async getLine(contractId: string, lineId: string) {
    const response = await apiClient.get(`/manufacturing/purchase-contracts/${contractId}/lines/${lineId}`);
    return response.data;
  },

  async createLine(contractId: string, dto: {
    productId: string;
    agreedPrice: number;
    agreedQty?: number;
    minOrderQty?: number;
    leadTimeDays?: number;
    uom?: string;
  }) {
    const response = await apiClient.post(`/manufacturing/purchase-contracts/${contractId}/lines`, dto);
    return response.data;
  },

  async updateLine(contractId: string, lineId: string, dto: Partial<PurchaseContractLine>) {
    const response = await apiClient.patch(`/manufacturing/purchase-contracts/${contractId}/lines/${lineId}`, dto);
    return response.data;
  },

  async deleteLine(contractId: string, lineId: string) {
    await apiClient.delete(`/manufacturing/purchase-contracts/${contractId}/lines/${lineId}`);
  },
};
