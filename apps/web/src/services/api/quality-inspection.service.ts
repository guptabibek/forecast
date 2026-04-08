import type { QualityInspection, QualityInspectionStatus, QualityInspectionType } from '../../types';
import { apiClient } from './client';

// ============================================================================
// Quality Inspection Service
// ============================================================================

export const qualityInspectionService = {
  async getAll(params?: {
    productId?: string;
    workOrderId?: string;
    purchaseOrderId?: string;
    inspectionType?: QualityInspectionType;
    status?: QualityInspectionStatus;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/quality-inspections', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/quality-inspections/${id}`);
    return response.data;
  },

  async create(dto: {
    workOrderId?: string;
    purchaseOrderId?: string;
    goodsReceiptId?: string;
    productId: string;
    locationId?: string;
    inspectionType: QualityInspectionType;
    inspectedQty: number;
    defectType?: string;
    defectDescription?: string;
    inspectorId?: string;
    notes?: string;
  }) {
    const response = await apiClient.post('/manufacturing/quality-inspections', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<QualityInspection>) {
    const response = await apiClient.patch(`/manufacturing/quality-inspections/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/quality-inspections/${id}`);
  },

  async updateStatus(id: string, status: QualityInspectionStatus) {
    const response = await apiClient.patch(`/manufacturing/quality-inspections/${id}/status`, { status });
    return response.data;
  },
};
