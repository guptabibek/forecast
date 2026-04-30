import { apiClient } from './client';

// Common filter params for dashboard endpoints
export interface DashboardFilterParams {
  productIds?: string[];
  customerIds?: string[];
}

// ABC Analysis specific params
export interface ABCAnalysisParams extends DashboardFilterParams {
  mode?: 'revenue' | 'margin';
  thresholdA?: number;
  thresholdB?: number;
}

// ABC Analysis response types
export interface ABCProduct {
  id: string;
  name: string;
  code: string;
  category: string;
  revenue: number;
  margin: number;
  metricValue: number;
  contribution: number;
  cumulativeContribution: number;
  class: 'A' | 'B' | 'C';
}

export interface ABCClassDistribution {
  class: string;
  count: number;
  revenue: number;
  margin: number;
  contribution: number;
  label: string;
}

export interface ABCClassBreakdown {
  count: number;
  totalRevenue: number;
  totalMargin: number;
  contributionPercent: number;
  products: ABCProduct[];
}

export interface ABCAnalysisResponse {
  config: {
    mode: 'revenue' | 'margin';
    thresholdA: number;
    thresholdB: number;
    totalProducts: number;
    totalRevenue: number;
    totalMargin: number;
  };
  products: ABCProduct[];
  summary: {
    totalProducts: number;
    classA: number;
    classB: number;
    classC: number;
    classAContribution: number;
    classBContribution: number;
    classCContribution: number;
  };
  distribution: ABCClassDistribution[];
  classBreakdown: {
    A: ABCClassBreakdown;
    B: ABCClassBreakdown;
    C: ABCClassBreakdown;
  };
}

export interface ManagedReport {
  id: string;
  name: string;
  description?: string;
  type: 'line' | 'bar' | 'pie' | 'area' | 'table';
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedReportData {
  data: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
}

export const reportService = {
  // Dashboard-specific methods
  async getDashboardStats(filters?: DashboardFilterParams): Promise<{
    forecastAccuracy: number;
    accuracyChange: number;
    activePlans: number;
    pendingApproval: number;
    totalForecasts: number;
    forecastsChange: number;
    lastDataSync: string;
  }> {
    const { data } = await apiClient.get('/reports/dashboard/stats', { params: filters });
    return data.data;
  },

  async getForecastTrend(params: { periods?: number } & DashboardFilterParams): Promise<{
    period: string;
    actual: number | null;
    forecast: number;
    lowerBound: number;
    upperBound: number;
  }[]> {
    const { data } = await apiClient.get('/reports/dashboard/forecast-trend', { params });
    return data.data;
  },

  async getModelAccuracy(filters?: DashboardFilterParams): Promise<{ model: string; mape: number }[]> {
    const { data } = await apiClient.get('/reports/dashboard/model-accuracy', { params: filters });
    return data.data;
  },

  async getRecentActivity(params: { limit?: number }): Promise<{
    id: string;
    type: string;
    title: string;
    user: string;
    createdAt: string;
  }[]> {
    const { data } = await apiClient.get('/reports/dashboard/activity', { params });
    return data.data;
  },

  // Enterprise dashboard methods
  async getRevenueMetrics(filters?: DashboardFilterParams): Promise<{
    currentMonth: number;
    lastMonth: number;
    momChange: number;
    yoyChange: number;
    ytdRevenue: number;
    ytdForecast: number;
    ytdVariance: number;
  }> {
    const { data } = await apiClient.get('/reports/dashboard/revenue', { params: filters });
    return data.data;
  },

  async getTopProducts(params?: { limit?: number } & DashboardFilterParams): Promise<{
    id: string;
    name: string;
    code: string;
    revenue: number;
    percentage: number;
  }[]> {
    const { data } = await apiClient.get('/reports/dashboard/top-products', { params });
    return data.data;
  },

  async getRegionalBreakdown(filters?: DashboardFilterParams): Promise<{
    id: string;
    name: string;
    code: string;
    revenue: number;
    percentage: number;
  }[]> {
    const { data } = await apiClient.get('/reports/dashboard/regional', { params: filters });
    return data.data;
  },

  async getVarianceAlerts(filters?: DashboardFilterParams): Promise<{
    id: string;
    type: 'over' | 'under';
    entity: string;
    period: string;
    expected: number;
    actual: number;
    variance: number;
    severity: 'high' | 'medium' | 'low';
  }[]> {
    const { data } = await apiClient.get('/reports/dashboard/variance-alerts', { params: filters });
    return data.data;
  },

  async getForecastHealth(filters?: DashboardFilterParams): Promise<{
    totalForecasts: number;
    modelDistribution: { model: string; count: number }[];
    coverage: number;
    accuracy: number;
  }> {
    const { data } = await apiClient.get('/reports/dashboard/forecast-health', { params: filters });
    return data.data;
  },

  async getMonthlyTrend(params?: { months?: number } & DashboardFilterParams): Promise<{
    month: string;
    label: string;
    actual: number;
    forecast: number;
    variance: number;
    variancePercent: number;
  }[]> {
    const { data } = await apiClient.get('/reports/dashboard/monthly-trend', { params });
    return data.data;
  },

  // =====================
  // Enhanced Enterprise Methods with Flexible Periods
  // =====================

  async getTrendComparison(params: {
    granularity: 'daily' | 'weekly' | 'monthly' | 'quarterly';
    periods?: number;
    startDate?: string;
    endDate?: string;
  } & DashboardFilterParams): Promise<{
    data: {
      period: string;
      label: string;
      actual: number;
      forecast: number;
      variance: number;
      variancePercent: number;
    }[];
    meta: {
      granularity: string;
      startDate: string;
      endDate: string;
      totalPeriods: number;
    };
  }> {
    const { data } = await apiClient.get('/reports/dashboard/monthly-trend', { params });
    return data;
  },

  async getDemandSupply(params?: { periods?: number } & DashboardFilterParams): Promise<{
    data: {
      month: string;
      label: string;
      demand: number;
      supply: number;
      gap: number;
      fillRate: number;
    }[];
    summary: {
      totalDemand: number;
      totalSupply: number;
      overallFillRate: number;
      totalGap: number;
    };
  }> {
    const { data } = await apiClient.get('/reports/dashboard/demand-supply', { params });
    return data;
  },

  async getInventoryMetrics(filters?: DashboardFilterParams): Promise<{
    data: {
      id: string;
      name: string;
      code: string;
      totalSales: number;
      avgMonthly: number;
      velocity: number;
      class: 'A' | 'B' | 'C';
      contribution: number;
    }[];
    summary: {
      totalProducts: number;
      classA: number;
      classB: number;
      classC: number;
      avgTurnover: number;
    };
  }> {
    const { data } = await apiClient.get('/reports/dashboard/inventory-metrics', { params: filters });
    return data;
  },

  async getForecastBias(filters?: DashboardFilterParams): Promise<{
    data: {
      model: string;
      avgBias: number;
      overForecastRate: number;
      underForecastRate: number;
      totalForecasts: number;
    }[];
  }> {
    const { data } = await apiClient.get('/reports/dashboard/forecast-bias', { params: filters });
    return data;
  },

  async getABCAnalysis(params?: ABCAnalysisParams): Promise<ABCAnalysisResponse> {
    const { data } = await apiClient.get('/reports/dashboard/abc-analysis', { params });
    return data;
  },

  // CRUD methods for page-managed reports
  async listReports(): Promise<ManagedReport[]> {
    const { data } = await apiClient.get<ManagedReport[]>('/reports');
    return data;
  },

  async getReportData(id: string): Promise<ManagedReportData> {
    const { data } = await apiClient.get<ManagedReportData>(`/reports/${id}/data`);
    return data;
  },

  async createReport(reportData: Record<string, unknown>): Promise<ManagedReport> {
    const { data } = await apiClient.post<ManagedReport>('/reports', reportData);
    return data;
  },

  async updateReport(id: string, reportData: Record<string, unknown>): Promise<ManagedReport> {
    const { data } = await apiClient.patch<ManagedReport>(`/reports/${id}`, reportData);
    return data;
  },

  async deleteReport(id: string): Promise<void> {
    await apiClient.delete(`/reports/${id}`);
  },
};
