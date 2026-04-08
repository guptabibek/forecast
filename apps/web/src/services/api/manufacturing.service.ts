import { apiClient } from './client';

export interface ManufacturingDashboardMetrics {
  boms: {
    total: number;
    pendingApproval: number;
  };
  workCenters: {
    active: number;
  };
  inventoryPolicies: {
    total: number;
    belowSafetyStock: number;
  };
  plannedOrders: {
    pending: number;
  };
  sopCycles: {
    active: number;
    currentCycle: string | null;
    currentStatus: string | null;
  };
  pendingApprovals: number;
  activeWorkflows: number;
  suppliers: {
    active: number;
    avgLeadTimeDays: number;
  };
  npi: {
    inDevelopment: number;
    preLaunch: number;
  };
  promotions: {
    active: number;
    upcoming: number;
  };
  fiscalCalendar: {
    type: string | null;
  };
}

export const manufacturingService = {
  async getDashboard(): Promise<ManufacturingDashboardMetrics> {
    const { data } = await apiClient.get<ManufacturingDashboardMetrics>('/manufacturing/dashboard');
    return data;
  },
};
