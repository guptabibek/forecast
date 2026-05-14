import { apiClient } from './client';

type BackendSOPStatus = 'PLANNING' | 'DEMAND_REVIEW' | 'SUPPLY_REVIEW' | 'PRE_SOP' | 'EXECUTIVE_SOP' | 'APPROVED' | 'CLOSED';

type BackendUserSummary = {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
};

type BackendSOPCycle = {
  id: string;
  name: string;
  fiscalYear?: number;
  fiscalPeriod?: number;
  year?: number;
  month?: number;
  status: BackendSOPStatus;
  notes?: string;
  description?: string;
  planningStart?: string;
  planningEnd?: string;
  demandReviewDate?: string;
  supplyReviewDate?: string;
  preSopDate?: string;
  executiveSopDate?: string;
  executiveMeetingDate?: string;
  demandManager?: string | null;
  supplyManager?: string | null;
  financeManager?: string | null;
  executiveSponsor?: string | null;
  demandManagerUser?: BackendUserSummary | null;
  supplyManagerUser?: BackendUserSummary | null;
  financeManagerUser?: BackendUserSummary | null;
  executiveSponsorUser?: BackendUserSummary | null;
  createdById?: string;
  createdBy?: { id: string; name?: string; email: string };
  _count?: { forecasts?: number; assumptions?: number };
};

function toUserSummary(user?: BackendUserSummary | null) {
  if (!user) {
    return undefined;
  }

  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    id: user.id,
    email: user.email,
    name: name || user.email,
  };
}

function calculateHorizonMonths(startDate?: string, endDate?: string): number | undefined {
  if (!startDate || !endDate) {
    return undefined;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return undefined;
  }

  return Math.max(
    1,
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1,
  );
}

function mapSOPCycle(raw: BackendSOPCycle): SOPCycle {
  const planningStart = raw.planningStart;
  const planningEnd = raw.planningEnd;

  return {
    id: raw.id,
    name: raw.name,
    year: raw.year ?? raw.fiscalYear ?? 0,
    month: raw.month ?? raw.fiscalPeriod ?? 0,
    description: raw.description ?? raw.notes,
    status: raw.status,
    planningStart,
    planningEnd,
    horizonMonths: calculateHorizonMonths(planningStart, planningEnd),
    demandReviewDate: raw.demandReviewDate,
    supplyReviewDate: raw.supplyReviewDate,
    preSopDate: raw.preSopDate,
    executiveMeetingDate: raw.executiveMeetingDate ?? raw.executiveSopDate,
    demandManagerId: raw.demandManager ?? undefined,
    supplyManagerId: raw.supplyManager ?? undefined,
    financeManagerId: raw.financeManager ?? undefined,
    executiveSponsorId: raw.executiveSponsor ?? undefined,
    demandManagerUser: toUserSummary(raw.demandManagerUser),
    supplyManagerUser: toUserSummary(raw.supplyManagerUser),
    financeManagerUser: toUserSummary(raw.financeManagerUser),
    executiveSponsorUser: toUserSummary(raw.executiveSponsorUser),
    createdById: raw.createdById,
    createdBy: raw.createdBy,
    _count: raw._count,
  };
}

// ============================================================================
// Types
// ============================================================================

export interface SOPCycle {
  id: string;
  name: string;
  year: number;
  month: number;
  description?: string;
  status: BackendSOPStatus;
  planningStart?: string;
  planningEnd?: string;
  horizonMonths?: number;
  demandReviewDate?: string;
  supplyReviewDate?: string;
  preSopDate?: string;
  executiveMeetingDate?: string;
  demandManagerId?: string;
  supplyManagerId?: string;
  financeManagerId?: string;
  executiveSponsorId?: string;
  demandManagerUser?: { id: string; name: string; email: string };
  supplyManagerUser?: { id: string; name: string; email: string };
  financeManagerUser?: { id: string; name: string; email: string };
  executiveSponsorUser?: { id: string; name: string; email: string };
  createdById?: string;
  createdBy?: { id: string; name?: string; email: string };
  _count?: { forecasts?: number; assumptions?: number };
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
    if (Array.isArray(response.data)) {
      return response.data.map((cycle: BackendSOPCycle) => mapSOPCycle(cycle));
    }

    if (Array.isArray(response.data?.items)) {
      return {
        ...response.data,
        items: response.data.items.map((cycle: BackendSOPCycle) => mapSOPCycle(cycle)),
      };
    }

    return response.data;
  },

  async getCycle(cycleId: string) {
    const response = await apiClient.get(`/manufacturing/sop/cycles/${cycleId}`);
    return mapSOPCycle(response.data);
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
    demandManagerId?: string;
    supplyManagerId?: string;
    financeManagerId?: string;
    executiveSponsorId?: string;
  }) {
    const response = await apiClient.post('/manufacturing/sop/cycles', dto);
    return mapSOPCycle(response.data);
  },

  async updateCycle(cycleId: string, dto: Partial<SOPCycle>) {
    const response = await apiClient.put(`/manufacturing/sop/cycles/${cycleId}`, dto);
    return mapSOPCycle(response.data);
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
