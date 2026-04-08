import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface NewProductIntroduction {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  brand?: string;
  status: 'CONCEPT' | 'DEVELOPMENT' | 'TESTING' | 'PRE_LAUNCH' | 'LAUNCHED' | 'MATURE' | 'DECLINING' | 'DISCONTINUED';
  launchDate?: string;
  endOfLifeDate?: string;
  launchCurveType?: 'LINEAR' | 'EXPONENTIAL' | 'S_CURVE' | 'HOCKEY_STICK';
  rampUpMonths?: number;
  peakMonthsSinceLaunch?: number;
  peakForecastUnits?: number;
  analogProductId?: string;
  analogProduct?: { id: string; sku: string; name: string };
  analogSimilarityPercent?: number;
  initialPrice?: number;
  targetMargin?: number;
  plannedLocationIds?: string[];
  plannedLocations?: Array<{ id: string; code: string; name: string }>;
  productId?: string;
  product?: { id: string; sku: string; name: string };
  convertedAt?: string;
}

export interface NPIForecast {
  periodDate: string;
  forecast: number;
  cumulative: number;
  rampPercentage: number;
}

export interface NPIAnalogSuggestion {
  product: {
    id: string;
    sku: string;
    name: string;
    category?: string;
    brand?: string;
  };
  similarityScore: number;
  sameCategory: boolean;
  sameBrand: boolean;
  hasActuals: boolean;
  actualsMonths: number;
}

export interface NPIPerformance {
  npi: NewProductIntroduction;
  monthsSinceLaunch: number;
  actualsTotal: number;
  forecastTotal: number;
  variance: number;
  variancePercent: number;
  onTrack: boolean;
}

// ============================================================================
// NPI Service
// ============================================================================

export const npiService = {
  // NPIs
  async getNPIs(params?: {
    status?: string;
    category?: string;
    brand?: string;
    launchDateFrom?: string;
    launchDateTo?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/npi', { params });
    return response.data;
  },

  async getNPI(npiId: string) {
    const response = await apiClient.get(`/manufacturing/npi/${npiId}`);
    return response.data;
  },

  async createNPI(dto: {
    sku: string;
    name: string;
    description?: string;
    category?: string;
    brand?: string;
    launchDate?: string;
    launchCurveType?: string;
    rampUpMonths?: number;
    peakMonthsSinceLaunch?: number;
    peakForecastUnits?: number;
    analogProductId?: string;
    analogSimilarityPercent?: number;
    initialPrice?: number;
    targetMargin?: number;
    plannedLocationIds?: string[];
  }) {
    const response = await apiClient.post('/manufacturing/npi', dto);
    return response.data;
  },

  async updateNPI(npiId: string, dto: Partial<NewProductIntroduction>) {
    const response = await apiClient.put(`/manufacturing/npi/${npiId}`, dto);
    return response.data;
  },

  async updateNPIStatus(npiId: string, status: string) {
    const response = await apiClient.put(`/manufacturing/npi/${npiId}/status`, { status });
    return response.data;
  },

  async deleteNPI(npiId: string) {
    await apiClient.delete(`/manufacturing/npi/${npiId}`);
  },

  // Forecasts
  async generateNPIForecast(npiId: string, options?: {
    months?: number;
    useAnalog?: boolean;
    adjustmentPercent?: number;
  }): Promise<NPIForecast[]> {
    const response = await apiClient.post(`/manufacturing/npi/${npiId}/generate-forecast`, options);
    return response.data;
  },

  // Analog Products
  async findAnalogProducts(npiId: string, params?: {
    limit?: number;
    categoryOnly?: boolean;
    brandOnly?: boolean;
    minActualsMonths?: number;
  }): Promise<NPIAnalogSuggestion[]> {
    const response = await apiClient.get(`/manufacturing/npi/${npiId}/analogs`, { params });
    return response.data;
  },

  async setAnalogProduct(npiId: string, analogProductId: string, similarityPercent?: number) {
    const response = await apiClient.put(`/manufacturing/npi/${npiId}/analog`, {
      analogProductId,
      analogSimilarityPercent: similarityPercent,
    });
    return response.data;
  },

  // Performance
  async getNPIPerformance(npiId: string): Promise<NPIPerformance> {
    const response = await apiClient.get(`/manufacturing/npi/${npiId}/performance`);
    return response.data;
  },

  async compareNPIPerformance(npiIds: string[]): Promise<NPIPerformance[]> {
    const response = await apiClient.post('/manufacturing/npi/compare-performance', { npiIds });
    return response.data;
  },

  // Conversion
  async convertToProduct(npiId: string, options?: {
    createBOM?: boolean;
    createRouting?: boolean;
    createInventoryPolicy?: boolean;
    initialOnHand?: number;
  }) {
    const response = await apiClient.post(`/manufacturing/npi/${npiId}/convert-to-product`, options);
    return response.data;
  },

  // Launch curves
  async getLaunchCurveTypes() {
    return [
      { value: 'LINEAR', label: 'Linear', description: 'Steady ramp up to peak' },
      { value: 'EXPONENTIAL', label: 'Exponential', description: 'Slow start, accelerating growth' },
      { value: 'S_CURVE', label: 'S-Curve', description: 'Slow start, rapid middle, plateau' },
      { value: 'HOCKEY_STICK', label: 'Hockey Stick', description: 'Flat start, sudden rapid growth' },
    ];
  },

  async getStatusTransitions() {
    return [
      { from: 'CONCEPT', to: ['DEVELOPMENT'] },
      { from: 'DEVELOPMENT', to: ['TESTING', 'CONCEPT'] },
      { from: 'TESTING', to: ['PRE_LAUNCH', 'DEVELOPMENT'] },
      { from: 'PRE_LAUNCH', to: ['LAUNCHED', 'TESTING'] },
      { from: 'LAUNCHED', to: ['MATURE'] },
      { from: 'MATURE', to: ['DECLINING'] },
      { from: 'DECLINING', to: ['DISCONTINUED', 'MATURE'] },
    ];
  },
};

export default npiService;
