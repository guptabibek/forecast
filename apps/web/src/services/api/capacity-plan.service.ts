import type { CapacityPlan, CapacityPlanBucket, CapacityPlanType } from '../../types';
import { apiClient } from './client';

// ============================================================================
// Capacity Plan Service
// ============================================================================

export const capacityPlanService = {
  // ---- Capacity Plans ----
  async getAll(params?: {
    planType?: CapacityPlanType;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/capacity-plans', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/capacity-plans/${id}`);
    return response.data;
  },

  async create(dto: {
    name: string;
    description?: string;
    planType?: CapacityPlanType;
    planningHorizon?: number;
    granularity?: string;
    startDate: string;
    endDate: string;
  }) {
    const response = await apiClient.post('/manufacturing/capacity-plans', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<CapacityPlan>) {
    const response = await apiClient.patch(`/manufacturing/capacity-plans/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/capacity-plans/${id}`);
  },

  // ---- Capacity Plan Buckets ----
  async getBuckets(planId: string, params?: {
    workCenterId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get(`/manufacturing/capacity-plans/${planId}/buckets`, { params });
    return response.data;
  },

  async getBucket(planId: string, bucketId: string) {
    const response = await apiClient.get(`/manufacturing/capacity-plans/${planId}/buckets/${bucketId}`);
    return response.data;
  },

  async createBucket(planId: string, dto: {
    workCenterId: string;
    periodDate: string;
    availableCapacity: number;
    requiredCapacity?: number;
    notes?: string;
  }) {
    const response = await apiClient.post(`/manufacturing/capacity-plans/${planId}/buckets`, dto);
    return response.data;
  },

  async updateBucket(planId: string, bucketId: string, dto: Partial<CapacityPlanBucket>) {
    const response = await apiClient.patch(`/manufacturing/capacity-plans/${planId}/buckets/${bucketId}`, dto);
    return response.data;
  },

  async deleteBucket(planId: string, bucketId: string) {
    await apiClient.delete(`/manufacturing/capacity-plans/${planId}/buckets/${bucketId}`);
  },
};
