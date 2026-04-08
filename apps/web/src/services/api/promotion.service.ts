import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface Promotion {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: 'DISCOUNT' | 'BOGO' | 'BUNDLE' | 'SEASONAL' | 'CLEARANCE' | 'TRADE' | 'NEW_PRODUCT' | 'LOYALTY' | 'OTHER';
  status: 'DRAFT' | 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  startDate: string;
  endDate: string;
  productIds: string[];
  products?: Array<{ id: string; sku: string; name: string }>;
  locationIds: string[];
  locations?: Array<{ id: string; code: string; name: string }>;
  discountPercent?: number;
  discountAmount?: number;
  marketingSpend?: number;
  notes?: string;
  liftFactors?: PromotionLiftFactor[];
}

export interface PromotionLiftFactor {
  id: string;
  promotionId: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  locationId?: string;
  location?: { id: string; code: string; name: string };
  weekNumber: number;
  liftPercent: number;
  cannibalizationPercent?: number;
  haloPercent?: number;
  baselineForecast?: number;
  adjustedForecast?: number;
}

export interface PromotionImpact {
  promotion: Promotion;
  totalBaselineForecast: number;
  totalAdjustedForecast: number;
  totalLiftUnits: number;
  totalLiftPercent: number;
  revenueImpact: number;
  roi?: number;
  impactByProduct: Array<{
    productId: string;
    sku: string;
    name: string;
    baselineForecast: number;
    adjustedForecast: number;
    liftUnits: number;
    liftPercent: number;
  }>;
  impactByWeek: Array<{
    weekNumber: number;
    startDate: string;
    baselineForecast: number;
    adjustedForecast: number;
    liftUnits: number;
    liftPercent: number;
  }>;
}

// ============================================================================
// Promotion Service
// ============================================================================

export const promotionService = {
  // Promotions
  async getPromotions(params?: {
    status?: string;
    type?: string;
    startDateFrom?: string;
    startDateTo?: string;
    endDateFrom?: string;
    endDateTo?: string;
    productId?: string;
    locationId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/promotions', { params });
    return response.data;
  },

  async getPromotion(promotionId: string) {
    const response = await apiClient.get(`/manufacturing/promotions/${promotionId}`);
    return response.data;
  },

  async createPromotion(dto: {
    code?: string;
    name: string;
    description?: string;
    type: string;
    startDate: string;
    endDate: string;
    productIds?: string[];
    locationIds?: string[];
    discountPercent?: number;
    discountAmount?: number;
    marketingSpend?: number;
    notes?: string;
  }) {
    const response = await apiClient.post('/manufacturing/promotions', dto);
    return response.data;
  },

  async updatePromotion(promotionId: string, dto: Partial<Promotion>) {
    const response = await apiClient.put(`/manufacturing/promotions/${promotionId}`, dto);
    return response.data;
  },

  async updatePromotionStatus(promotionId: string, status: string) {
    const response = await apiClient.put(`/manufacturing/promotions/${promotionId}/status`, { status });
    return response.data;
  },

  async deletePromotion(promotionId: string) {
    await apiClient.delete(`/manufacturing/promotions/${promotionId}`);
  },

  // Active/Upcoming Promotions
  async getActivePromotions(params?: {
    productId?: string;
    locationId?: string;
  }) {
    const response = await apiClient.get('/manufacturing/promotions/active', { params });
    return response.data;
  },

  async getUpcomingPromotions(params?: {
    days?: number;
    productId?: string;
    locationId?: string;
  }) {
    const response = await apiClient.get('/manufacturing/promotions/upcoming', { params });
    return response.data;
  },

  // Lift Factors
  async getLiftFactors(promotionId: string, params?: {
    productId?: string;
    locationId?: string;
  }) {
    const response = await apiClient.get(`/manufacturing/promotions/${promotionId}/lift-factors`, { params });
    return response.data;
  },

  async upsertLiftFactor(promotionId: string, dto: {
    productId: string;
    locationId?: string;
    weekNumber: number;
    liftPercent: number;
    cannibalizationPercent?: number;
    haloPercent?: number;
  }) {
    const response = await apiClient.post(`/manufacturing/promotions/${promotionId}/lift-factors`, dto);
    return response.data;
  },

  async bulkUpsertLiftFactors(promotionId: string, liftFactors: Array<{
    productId: string;
    locationId?: string;
    weekNumber: number;
    liftPercent: number;
    cannibalizationPercent?: number;
    haloPercent?: number;
  }>) {
    const response = await apiClient.post(`/manufacturing/promotions/${promotionId}/lift-factors/bulk`, { liftFactors });
    return response.data;
  },

  async deleteLiftFactor(liftFactorId: string) {
    await apiClient.delete(`/manufacturing/promotions/lift-factors/${liftFactorId}`);
  },

  // Impact Analysis
  async getPromotionImpact(promotionId: string): Promise<PromotionImpact> {
    const response = await apiClient.get(`/manufacturing/promotions/${promotionId}/impact`);
    return response.data;
  },

  async getAdjustedForecast(params: {
    productId: string;
    locationId?: string;
    startDate: string;
    endDate: string;
    includePromotions?: boolean;
  }) {
    const response = await apiClient.get('/manufacturing/promotions/adjusted-forecast', { params });
    return response.data;
  },

  // Promotion Types
  async getPromotionTypes() {
    return [
      { value: 'DISCOUNT', label: 'Discount', description: 'Percentage or fixed amount off' },
      { value: 'BOGO', label: 'Buy One Get One', description: 'Buy X get Y free' },
      { value: 'BUNDLE', label: 'Bundle', description: 'Multi-product package deal' },
      { value: 'SEASONAL', label: 'Seasonal', description: 'Holiday or seasonal promotion' },
      { value: 'CLEARANCE', label: 'Clearance', description: 'End of life / inventory reduction' },
      { value: 'TRADE', label: 'Trade Promotion', description: 'B2B / channel promotion' },
      { value: 'NEW_PRODUCT', label: 'New Product', description: 'Launch promotion' },
      { value: 'LOYALTY', label: 'Loyalty', description: 'Customer loyalty program' },
      { value: 'OTHER', label: 'Other', description: 'Other promotion type' },
    ];
  },

  // Calendar view
  async getPromotionCalendar(params: {
    startDate: string;
    endDate: string;
    productId?: string;
    locationId?: string;
    type?: string;
    status?: string;
  }) {
    const response = await apiClient.get('/manufacturing/promotions/calendar', { params });
    return response.data;
  },

  // Copy promotion
  async copyPromotion(promotionId: string, dto: {
    code: string;
    name: string;
    startDate: string;
    endDate: string;
    copyLiftFactors?: boolean;
  }) {
    const response = await apiClient.post(`/manufacturing/promotions/${promotionId}/copy`, dto);
    return response.data;
  },
};

export default promotionService;
