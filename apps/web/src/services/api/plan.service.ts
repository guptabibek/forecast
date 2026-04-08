import type {
    CreatePlanRequest,
    PaginatedResponse,
    PlanVersion,
    QueryParams,
} from '@/types';
import { api } from './client';

export const planService = {
  getAll: async (params?: QueryParams): Promise<PaginatedResponse<PlanVersion>> => {
    // Flatten nested filters object for backend compatibility
    const flatParams: Record<string, unknown> = {};
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (key === 'filters' && typeof value === 'object' && value !== null) {
          // Flatten filters object
          Object.entries(value as Record<string, unknown>).forEach(([filterKey, filterValue]) => {
            flatParams[filterKey] = filterValue;
          });
        } else {
          flatParams[key] = value;
        }
      });
    }
    return api.get<PaginatedResponse<PlanVersion>>('/plans', flatParams);
  },

  getById: async (id: string): Promise<PlanVersion> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    const result = await api.get<PlanVersion>(`/plans/${id}`);
    return result;
  },

  create: async (data: CreatePlanRequest): Promise<PlanVersion> => {
    if (!data.name?.trim()) {
      throw new Error('Plan name is required');
    }
    if (!data.startDate) {
      throw new Error('Start date is required');
    }
    if (!data.endDate) {
      throw new Error('End date is required');
    }
    return api.post<PlanVersion>('/plans', data);
  },

  update: async (id: string, data: Partial<PlanVersion>): Promise<PlanVersion> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    return api.patch<PlanVersion>(`/plans/${id}`, data);
  },

  delete: async (id: string): Promise<void> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    return api.delete(`/plans/${id}`);
  },

  submitForReview: async (id: string): Promise<PlanVersion> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    return api.post<PlanVersion>(`/plans/${id}/submit`);
  },

  approve: async (id: string): Promise<PlanVersion> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    return api.post<PlanVersion>(`/plans/${id}/approve`);
  },

  reject: async (id: string, reason: string): Promise<PlanVersion> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    return api.post<PlanVersion>(`/plans/${id}/reject`, { reason });
  },

  archive: async (id: string): Promise<PlanVersion> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    return api.post<PlanVersion>(`/plans/${id}/archive`);
  },

  clone: async (id: string, name: string): Promise<PlanVersion> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    if (!name?.trim()) {
      throw new Error('New plan name is required');
    }
    return api.post<PlanVersion>(`/plans/${id}/clone`, { name });
  },

  export: (id: string, format: 'excel' | 'csv'): Promise<Blob> =>
    api.get(`/plans/${id}/export`, { format }),

  lock: async (id: string, reason: string): Promise<PlanVersion> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    return api.post<PlanVersion>(`/plans/${id}/lock`, { reason });
  },

  unlock: async (id: string): Promise<PlanVersion> => {
    if (!id) {
      throw new Error('Plan ID is required');
    }
    return api.post<PlanVersion>(`/plans/${id}/unlock`);
  },
};
