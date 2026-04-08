import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface SOPCycle {
  id: string;
  name: string;
  year: number;
  month: number;
  description?: string;
  status: 'DRAFT' | 'DEMAND_REVIEW' | 'SUPPLY_REVIEW' | 'EXECUTIVE_REVIEW' | 'FINALIZED';
  horizonMonths?: number;
  demandReviewDate?: string;
  supplyReviewDate?: string;
  executiveMeetingDate?: string;
  finalizedAt?: string;
  createdById: string;
  createdBy?: { id: string; name: string; email: string };
}

export interface SOPForecast {
  id: string;
  cycleId: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  locationId: string;
  location?: { id: string; code: string; name: string };
  periodDate: string;
  source: 'STATISTICAL' | 'SALES' | 'MARKETING' | 'OPERATIONS' | 'FINANCE' | 'CONSENSUS';
  quantityUnits?: number;
  quantityRevenue?: number;
  notes?: string;
}

export interface SOPAssumption {
  id: string;
  cycleId: string;
  category: string;
  assumption: string;
  impactDescription?: string;
  quantitativeImpact?: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'VALIDATED' | 'RESOLVED' | 'DISMISSED';
  mitigationPlan?: string;
  owner?: string;
  dueDate?: string;
  resolution?: string;
  resolvedAt?: string;
  createdById: string;
  createdBy?: { id: string; name: string; email: string };
}

// ============================================================================
// S&OP Service
// ============================================================================

export const sopService = {
  // Cycles
  async getCycles(params?: {
    status?: string;
    year?: number;
    month?: number;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/sop/cycles', { params });
    return response.data;
  },

  async getCycle(cycleId: string) {
    const response = await apiClient.get(`/manufacturing/sop/cycles/${cycleId}`);
    return response.data;
  },

  async getCycleSummary(cycleId: string) {
    const response = await apiClient.get(`/manufacturing/sop/cycles/${cycleId}/summary`);
    return response.data;
  },

  async createCycle(dto: {
    year: number;
    month: number;
    name?: string;
    description?: string;
    demandReviewDate?: string;
    supplyReviewDate?: string;
    executiveMeetingDate?: string;
    horizonMonths?: number;
  }) {
    const response = await apiClient.post('/manufacturing/sop/cycles', dto);
    return response.data;
  },

  async updateCycle(cycleId: string, dto: Partial<SOPCycle>) {
    const response = await apiClient.put(`/manufacturing/sop/cycles/${cycleId}`, dto);
    return response.data;
  },

  async updateCycleStatus(cycleId: string, status: string) {
    const response = await apiClient.put(`/manufacturing/sop/cycles/${cycleId}/status`, { status });
    return response.data;
  },

  async deleteCycle(cycleId: string) {
    await apiClient.delete(`/manufacturing/sop/cycles/${cycleId}`);
  },

  // Forecasts
  async getForecasts(cycleId: string, params?: {
    productId?: string;
    locationId?: string;
    source?: string;
  }) {
    const response = await apiClient.get(`/manufacturing/sop/cycles/${cycleId}/forecasts`, { params });
    return response.data;
  },

  async getForecastComparison(cycleId: string) {
    const response = await apiClient.get(`/manufacturing/sop/cycles/${cycleId}/forecasts/comparison`);
    return response.data;
  },

  async upsertForecast(cycleId: string, dto: {
    productId: string;
    locationId: string;
    periodDate: string;
    source: string;
    quantityUnits?: number;
    quantityRevenue?: number;
    notes?: string;
  }) {
    const response = await apiClient.post(`/manufacturing/sop/cycles/${cycleId}/forecasts`, dto);
    return response.data;
  },

  async bulkUpsertForecasts(cycleId: string, forecasts: Array<{
    productId: string;
    locationId: string;
    periodDate: string;
    source: string;
    quantityUnits?: number;
    quantityRevenue?: number;
    notes?: string;
  }>) {
    const response = await apiClient.post(`/manufacturing/sop/cycles/${cycleId}/forecasts/bulk`, { forecasts });
    return response.data;
  },

  async deleteForecast(forecastId: string) {
    await apiClient.delete(`/manufacturing/sop/forecasts/${forecastId}`);
  },

  async copyForecastsFromCycle(sourceCycleId: string, targetCycleId: string, options?: {
    sources?: string[];
    adjustmentPercent?: number;
  }) {
    const response = await apiClient.post(`/manufacturing/sop/cycles/${targetCycleId}/copy-from/${sourceCycleId}`, options);
    return response.data;
  },

  async importStatisticalForecast(cycleId: string, options?: {
    productIds?: string[];
    locationIds?: string[];
    startDate?: string;
    endDate?: string;
  }) {
    const response = await apiClient.post(`/manufacturing/sop/cycles/${cycleId}/import-statistical`, options);
    return response.data;
  },

  // Assumptions
  async getAssumptions(cycleId: string, params?: {
    category?: string;
    riskLevel?: string;
    status?: string;
  }) {
    const response = await apiClient.get(`/manufacturing/sop/cycles/${cycleId}/assumptions`, { params });
    return response.data;
  },

  async createAssumption(cycleId: string, dto: {
    category: string;
    assumption: string;
    impactDescription?: string;
    quantitativeImpact?: number;
    riskLevel?: string;
    mitigationPlan?: string;
    owner?: string;
    dueDate?: string;
  }) {
    const response = await apiClient.post(`/manufacturing/sop/cycles/${cycleId}/assumptions`, dto);
    return response.data;
  },

  async updateAssumption(assumptionId: string, dto: Partial<SOPAssumption>) {
    const response = await apiClient.put(`/manufacturing/sop/assumptions/${assumptionId}`, dto);
    return response.data;
  },

  async deleteAssumption(assumptionId: string) {
    await apiClient.delete(`/manufacturing/sop/assumptions/${assumptionId}`);
  },
};

export default sopService;
