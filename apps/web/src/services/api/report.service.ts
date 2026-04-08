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

export interface ReportConfig {
  type: 'variance' | 'trend' | 'comparison' | 'summary' | 'accuracy';
  planId?: string;
  forecastIds?: string[];
  dimensionType?: 'product' | 'location' | 'customer' | 'account';
  dimensionIds?: string[];
  startDate?: string;
  endDate?: string;
  granularity?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  includeActuals?: boolean;
  includeVariance?: boolean;
}

export interface VarianceReport {
  periods: {
    period: string;
    forecast: number;
    actual: number;
    variance: number;
    variancePercent: number;
  }[];
  summary: {
    totalForecast: number;
    totalActual: number;
    totalVariance: number;
    averageVariancePercent: number;
    mape: number;
    rmse: number;
  };
  byDimension?: {
    dimensionId: string;
    dimensionName: string;
    forecast: number;
    actual: number;
    variance: number;
    variancePercent: number;
  }[];
}

export interface TrendReport {
  periods: {
    period: string;
    value: number;
    trend: number;
    seasonality: number;
    residual: number;
  }[];
  summary: {
    overallTrend: 'increasing' | 'decreasing' | 'stable';
    trendStrength: number;
    seasonalityStrength: number;
    seasonalPeaks: string[];
    seasonalTroughs: string[];
  };
}

export interface ComparisonReport {
  periods: {
    period: string;
    values: { forecastId: string; forecastName: string; value: number }[];
  }[];
  summary: {
    forecasts: {
      id: string;
      name: string;
      total: number;
      average: number;
      min: number;
      max: number;
    }[];
    differences: {
      forecastId1: string;
      forecastId2: string;
      absoluteDiff: number;
      percentDiff: number;
    }[];
  };
}

export interface SummaryReport {
  overview: {
    totalPlans: number;
    activePlans: number;
    totalForecasts: number;
    pendingApprovals: number;
  };
  recentActivity: {
    type: string;
    description: string;
    userId: string;
    userName: string;
    timestamp: string;
  }[];
  topPerformers: {
    dimensionId: string;
    dimensionName: string;
    dimensionType: string;
    value: number;
    growth: number;
  }[];
  alerts: {
    type: 'warning' | 'error' | 'info';
    message: string;
    relatedId?: string;
    relatedType?: string;
  }[];
}

export interface AccuracyReport {
  overall: {
    mape: number;
    rmse: number;
    mae: number;
    bias: number;
    hitRate: number;
  };
  byModel: {
    model: string;
    mape: number;
    rmse: number;
    mae: number;
    bias: number;
    forecastCount: number;
  }[];
  byPeriod: {
    period: string;
    mape: number;
    rmse: number;
    mae: number;
    bias: number;
  }[];
  byDimension: {
    dimensionType: string;
    dimensions: {
      id: string;
      name: string;
      mape: number;
      rmse: number;
    }[];
  }[];
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

  async generateVarianceReport(config: ReportConfig): Promise<VarianceReport> {
    const { data } = await apiClient.post<{ data: VarianceReport }>('/reports/variance', config);
    return data.data;
  },

  async generateTrendReport(config: ReportConfig): Promise<TrendReport> {
    const { data } = await apiClient.post<{ data: TrendReport }>('/reports/trend', config);
    return data.data;
  },

  async generateComparisonReport(config: ReportConfig): Promise<ComparisonReport> {
    const { data } = await apiClient.post<{ data: ComparisonReport }>('/reports/comparison', config);
    return data.data;
  },

  async generateSummaryReport(): Promise<SummaryReport> {
    const { data } = await apiClient.get<{ data: SummaryReport }>('/reports/summary');
    return data.data;
  },

  async generateAccuracyReport(config: ReportConfig): Promise<AccuracyReport> {
    const { data } = await apiClient.post<{ data: AccuracyReport }>('/reports/accuracy', config);
    return data.data;
  },

  async exportReport(config: ReportConfig, format: 'csv' | 'xlsx' | 'pdf'): Promise<Blob> {
    const { data } = await apiClient.post('/reports/export', { ...config, format }, {
      responseType: 'blob',
    });
    return data;
  },

  async getSavedReports(): Promise<SavedReport[]> {
    const { data } = await apiClient.get<{ data: SavedReport[] }>('/reports');
    return data.data;
  },

  async saveReport(report: { name: string; config: ReportConfig }): Promise<SavedReport> {
    const { data } = await apiClient.post<{ data: SavedReport }>('/reports/save', report);
    return data.data;
  },

  async deleteSavedReport(id: string): Promise<void> {
    await apiClient.delete(`/reports/${id}`);
  },

  async scheduleReport(schedule: {
    reportId: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    recipients: string[];
    format: 'csv' | 'xlsx' | 'pdf';
  }): Promise<void> {
    await apiClient.post('/reports/schedule', schedule);
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

export interface SavedReport {
  id: string;
  name: string;
  config: ReportConfig;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}
