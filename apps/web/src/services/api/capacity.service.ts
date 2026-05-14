import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface WorkCenter {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: 'MACHINE' | 'LABOR' | 'ASSEMBLY' | 'PACKAGING' | 'QUALITY' | 'WAREHOUSE';
  costPerHour?: number;
  setupCostPerHour?: number;
  efficiencyPercent?: number;
  isActive: boolean;
  locationId?: string;
  location?: { id: string; code: string; name: string };
  capacities?: WorkCenterCapacity[];
  shifts?: WorkCenterShift[];
}

export interface WorkCenterCapacity {
  id: string;
  workCenterId: string;
  workCenter?: WorkCenter;
  effectiveDate: string;
  endDate?: string;
  standardCapacityPerHour: number;
  maxCapacityPerHour?: number;
  availableHoursPerDay?: number;
  availableDaysPerWeek?: number;
  plannedDowntimePercent?: number;
  unplannedDowntimePercent?: number;
}

export interface WorkCenterShift {
  id: string;
  workCenterId: string;
  workCenter?: WorkCenter;
  name: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  effectiveDate: string;
  endDate?: string;
  breakMinutes?: number;
  capacityFactor?: number;
}

export interface CapacityUtilization {
  workCenterId: string;
  workCenterCode: string;
  workCenterName: string;
  period: string;
  availableCapacity: number;
  plannedCapacity: number;
  utilizationPercent: number;
  remainingCapacity: number;
  isOverloaded: boolean;
}

export interface CapacityBottleneck {
  workCenterId: string;
  workCenterCode: string;
  workCenterName: string;
  period: string;
  utilizationPercent: number;
  overloadHours: number;
  impactedOrders: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendations: string[];
}

export interface CapacityPlan {
  workCenterId: string;
  periods: Array<{
    period: string;
    availableCapacity: number;
    plannedLoad: number;
    utilizationPercent: number;
  }>;
  summary: {
    totalAvailableCapacity: number;
    totalPlannedLoad: number;
    averageUtilization: number;
    peakUtilization: number;
    peakPeriod: string;
  };
}

// ============================================================================
// Capacity Service
// ============================================================================

export const capacityService = {
  // Work Centers
  async getWorkCenters(params?: {
    type?: string;
    locationId?: string;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/capacity/work-centers', { params });
    return response.data;
  },

  async getWorkCenter(workCenterId: string) {
    const response = await apiClient.get(`/manufacturing/capacity/work-centers/${workCenterId}`);
    return response.data;
  },

  async createWorkCenter(dto: {
    code: string;
    name: string;
    description?: string;
    type: string;
    costPerHour?: number;
    setupCostPerHour?: number;
    efficiencyPercent?: number;
    locationId?: string;
  }) {
    const response = await apiClient.post('/manufacturing/capacity/work-centers', dto);
    return response.data;
  },

  async updateWorkCenter(workCenterId: string, dto: Partial<WorkCenter>) {
    const response = await apiClient.put(`/manufacturing/capacity/work-centers/${workCenterId}`, dto);
    return response.data;
  },

  async toggleWorkCenterStatus(workCenterId: string) {
    const response = await apiClient.put(`/manufacturing/capacity/work-centers/${workCenterId}/toggle-status`);
    return response.data;
  },

  async deleteWorkCenter(workCenterId: string) {
    await apiClient.delete(`/manufacturing/capacity/work-centers/${workCenterId}`);
  },

  // Capacities
  async getCapacities(workCenterId: string, params?: {
    effectiveDate?: string;
    includeExpired?: boolean;
  }) {
    const response = await apiClient.get(`/manufacturing/capacity/work-centers/${workCenterId}/capacities`, { params });
    return response.data;
  },

  async getCurrentCapacity(workCenterId: string) {
    const response = await apiClient.get(`/manufacturing/capacity/work-centers/${workCenterId}/capacities/current`);
    return response.data;
  },

  async createCapacity(workCenterId: string, dto: {
    effectiveDate: string;
    endDate?: string;
    standardCapacityPerHour: number;
    maxCapacityPerHour?: number;
    availableHoursPerDay?: number;
    availableDaysPerWeek?: number;
    plannedDowntimePercent?: number;
    unplannedDowntimePercent?: number;
  }) {
    const response = await apiClient.post(`/manufacturing/capacity/work-centers/${workCenterId}/capacities`, dto);
    return response.data;
  },

  async updateCapacity(capacityId: string, dto: Partial<WorkCenterCapacity>) {
    const response = await apiClient.put(`/manufacturing/capacity/capacities/${capacityId}`, dto);
    return response.data;
  },

  async deleteCapacity(capacityId: string) {
    await apiClient.delete(`/manufacturing/capacity/capacities/${capacityId}`);
  },

  // Shifts
  async getShifts(workCenterId: string, params?: {
    effectiveDate?: string;
    includeExpired?: boolean;
  }) {
    const response = await apiClient.get(`/manufacturing/capacity/work-centers/${workCenterId}/shifts`, { params });
    return response.data;
  },

  async createShift(workCenterId: string, dto: {
    name: string;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    effectiveDate: string;
    endDate?: string;
    breakMinutes?: number;
    capacityFactor?: number;
  }) {
    const response = await apiClient.post(`/manufacturing/capacity/work-centers/${workCenterId}/shifts`, dto);
    return response.data;
  },

  async updateShift(shiftId: string, dto: Partial<WorkCenterShift>) {
    const response = await apiClient.put(`/manufacturing/capacity/shifts/${shiftId}`, dto);
    return response.data;
  },

  async deleteShift(shiftId: string) {
    await apiClient.delete(`/manufacturing/capacity/shifts/${shiftId}`);
  },

  // Utilization Analysis
  async getUtilization(params: {
    workCenterIds?: string[];
    startDate: string;
    endDate: string;
    granularity?: 'DAY' | 'WEEK' | 'MONTH';
  }): Promise<CapacityUtilization[]> {
    const response = await apiClient.get('/manufacturing/capacity/utilization', { params });
    return response.data;
  },

  async getUtilizationByWorkCenter(workCenterId: string, params: {
    startDate: string;
    endDate: string;
    granularity?: 'DAY' | 'WEEK' | 'MONTH';
  }): Promise<CapacityUtilization[]> {
    const response = await apiClient.get(`/manufacturing/capacity/work-centers/${workCenterId}/utilization`, { params });
    return response.data;
  },

  // Bottleneck Detection
  async detectBottlenecks(params: {
    startDate: string;
    endDate: string;
    threshold?: number;
  }): Promise<CapacityBottleneck[]> {
    const response = await apiClient.get('/manufacturing/capacity/bottlenecks', { params });
    return response.data;
  },

  // Capacity Planning
  async getCapacityPlan(workCenterId: string, params: {
    startDate: string;
    endDate: string;
    granularity?: 'DAY' | 'WEEK' | 'MONTH';
    includeFinitePlanning?: boolean;
  }): Promise<CapacityPlan> {
    const response = await apiClient.get(`/manufacturing/capacity/work-centers/${workCenterId}/plan`, { params });
    return response.data;
  },

  async getAggregateCapacityPlan(params: {
    workCenterIds?: string[];
    locationId?: string;
    startDate: string;
    endDate: string;
    granularity?: 'DAY' | 'WEEK' | 'MONTH';
  }) {
    const response = await apiClient.get('/manufacturing/capacity/aggregate-plan', { params });
    return response.data;
  },

  // Load Balancing
  async simulateLoadBalancing(params: {
    sourceWorkCenterId: string;
    targetWorkCenterIds: string[];
    startDate: string;
    endDate: string;
    maxShiftPercent?: number;
  }) {
    const response = await apiClient.post('/manufacturing/capacity/simulate-load-balancing', params);
    return response.data;
  },

  // Work Center Types
  async getWorkCenterTypes() {
    return [
      { value: 'MACHINE', label: 'Machine', description: 'Automated machinery' },
      { value: 'LABOR', label: 'Labor', description: 'Manual labor station' },
      { value: 'ASSEMBLY', label: 'Assembly', description: 'Assembly line/station' },
      { value: 'PACKAGING', label: 'Packaging', description: 'Packaging station' },
      { value: 'QUALITY', label: 'Quality', description: 'Quality control/inspection' },
      { value: 'WAREHOUSE', label: 'Warehouse', description: 'Warehouse operations' },
    ];
  },
};

export default capacityService;
