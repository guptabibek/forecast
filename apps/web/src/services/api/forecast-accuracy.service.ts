import type { ForecastAccuracyMetric } from '../../types';
import { apiClient } from './client';

// ============================================================================
// Forecast Accuracy Service
// ============================================================================

export const forecastAccuracyService = {
  async getAll(params?: {
    productId?: string;
    locationId?: string;
    granularity?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/forecast-accuracy', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/forecast-accuracy/${id}`);
    return response.data;
  },

  async create(dto: {
    productId: string;
    locationId?: string;
    periodDate: string;
    forecastQty: number;
    actualQty: number;
    mape?: number;
    bias?: number;
    trackingSignal?: number;
    mad?: number;
    forecastModel?: string;
    forecastVersion?: string;
    granularity?: string;
  }) {
    const response = await apiClient.post('/manufacturing/forecast-accuracy', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<ForecastAccuracyMetric>) {
    const response = await apiClient.patch(`/manufacturing/forecast-accuracy/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/forecast-accuracy/${id}`);
  },
};
