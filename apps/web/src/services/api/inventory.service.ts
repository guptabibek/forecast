import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface InventoryPolicy {
  id: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  locationId: string;
  location?: { id: string; code: string; name: string };
  planningMethod: 'MRP' | 'REORDER_POINT' | 'MIN_MAX' | 'KANBAN' | 'MANUAL';
  lotSizingRule: 'LOT_FOR_LOT' | 'FIXED_ORDER_QTY' | 'EOQ' | 'PERIODS_OF_SUPPLY';
  safetyStockMethod: 'FIXED' | 'DAYS_OF_SUPPLY' | 'SERVICE_LEVEL';
  safetyStockQty?: number;
  safetyStockDays?: number;
  serviceLevel?: number;
  reorderPoint?: number;
  reorderQty?: number;
  minOrderQty?: number;
  maxOrderQty?: number;
  leadTimeDays?: number;
  abcClass?: string;
  xyzClass?: string;
}

export interface InventoryLevel {
  id: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  locationId: string;
  location?: { id: string; code: string; name: string };
  onHandQty: number;
  allocatedQty: number;
  inTransitQty: number;
  onOrderQty: number;
  availableQty: number;
  standardCost?: number;
  averageCost?: number;
}

// ============================================================================
// Inventory Service
// ============================================================================

export const inventoryService = {
  // Policies
  async getPolicies(params?: {
    productId?: string;
    locationId?: string;
    abcClass?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/inventory/policies', { params });
    return response.data;
  },

  async getPolicy(productId: string, locationId: string) {
    const response = await apiClient.get(`/manufacturing/inventory/policies/${productId}/${locationId}`);
    return response.data;
  },

  async upsertPolicy(dto: {
    productId: string;
    locationId: string;
    planningMethod?: string;
    lotSizingRule?: string;
    safetyStockMethod?: string;
    safetyStockQty?: number;
    safetyStockDays?: number;
    serviceLevel?: number;
    reorderPoint?: number;
    reorderQty?: number;
    minOrderQty?: number;
    maxOrderQty?: number;
    leadTimeDays?: number;
    abcClass?: string;
    xyzClass?: string;
  }) {
    const response = await apiClient.post('/manufacturing/inventory/policies', dto);
    return response.data;
  },

  async deletePolicy(productId: string, locationId: string) {
    await apiClient.delete(`/manufacturing/inventory/policies/${productId}/${locationId}`);
  },

  // Levels
  async getLevels(params?: {
    productId?: string;
    locationId?: string;
    belowSafetyStock?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/inventory/levels', { params });
    return response.data;
  },

  async getLevel(productId: string, locationId: string) {
    const response = await apiClient.get(`/manufacturing/inventory/levels/${productId}/${locationId}`);
    return response.data;
  },

  async upsertLevel(dto: {
    productId: string;
    locationId: string;
    onHandQty?: number;
    allocatedQty?: number;
    inTransitQty?: number;
    onOrderQty?: number;
    standardCost?: number;
    averageCost?: number;
  }) {
    const response = await apiClient.post('/manufacturing/inventory/levels', dto);
    return response.data;
  },

  // Calculations
  async calculateSafetyStock(productId: string, locationId: string) {
    const response = await apiClient.get(`/manufacturing/inventory/calculate/safety-stock/${productId}/${locationId}`);
    return response.data;
  },

  async calculateReorderPoint(productId: string, locationId: string) {
    const response = await apiClient.get(`/manufacturing/inventory/calculate/reorder-point/${productId}/${locationId}`);
    return response.data;
  },

  async calculateEOQ(productId: string, locationId: string, params?: {
    annualDemand?: number;
    orderCost?: number;
    holdingCostPercent?: number;
  }) {
    const response = await apiClient.post(`/manufacturing/inventory/calculate/eoq/${productId}/${locationId}`, params);
    return response.data;
  },

  // Classification
  async runABCClassification(params?: {
    locationId?: string;
    dateRange?: { start: string; end: string };
    aThreshold?: number;
    bThreshold?: number;
  }) {
    const response = await apiClient.post('/manufacturing/inventory/classification/abc', params);
    return response.data;
  },

  async runXYZClassification(params?: {
    locationId?: string;
    dateRange?: { start: string; end: string };
    xThreshold?: number;
    yThreshold?: number;
  }) {
    const response = await apiClient.post('/manufacturing/inventory/classification/xyz', params);
    return response.data;
  },

  // Analytics
  async getSummary(locationId?: string) {
    const response = await apiClient.get('/manufacturing/inventory/summary', {
      params: { locationId },
    });
    return response.data;
  },

  async getTurnover(params?: {
    productId?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const response = await apiClient.get('/manufacturing/inventory/turnover', { params });
    return response.data;
  },

  // Aliases for hook compatibility
  async createPolicy(dto: {
    productId: string;
    locationId: string;
    planningMethod?: string;
    lotSizingRule?: string;
    safetyStockMethod?: string;
    safetyStockQty?: number;
    safetyStockDays?: number;
    serviceLevel?: number;
    reorderPoint?: number;
    reorderQty?: number;
    minOrderQty?: number;
    maxOrderQty?: number;
    leadTimeDays?: number;
    abcClass?: string;
    xyzClass?: string;
  }) {
    const response = await apiClient.post('/manufacturing/inventory/policies', dto);
    return response.data;
  },

  async updatePolicy(_policyId: string, dto: Partial<InventoryPolicy>) {
    const response = await apiClient.post('/manufacturing/inventory/policies', dto);
    return response.data;
  },

  async getCurrentLevel(productId: string, locationId?: string) {
    if (locationId) {
      const response = await apiClient.get(`/manufacturing/inventory/levels/${productId}/${locationId}`);
      return response.data;
    }

    const response = await apiClient.get('/manufacturing/inventory/levels', {
      params: {
        productId,
        page: 1,
        pageSize: 1,
      },
    });

    return response.data?.items?.[0] ?? null;
  },

  async getLevelHistory(productId: string, locationId?: string, _days?: number) {
    if (locationId) {
      const response = await apiClient.get(`/manufacturing/inventory/levels/${productId}/${locationId}`);
      return [response.data];
    }

    const response = await apiClient.get('/manufacturing/inventory/levels', {
      params: {
        productId,
      },
    });

    return response.data?.items ?? [];
  },

  async bulkUpsertLevels(levels: Array<{
    productId: string;
    locationId: string;
    onHandQty?: number;
    allocatedQty?: number;
    inTransitQty?: number;
    onOrderQty?: number;
    standardCost?: number;
    averageCost?: number;
  }>) {
    return Promise.all(levels.map((l) => apiClient.post('/manufacturing/inventory/levels', l).then(r => r.data)));
  },

  async deleteLevel(_productId: string, _locationId?: string) {
    throw new Error('Inventory level deletion is not supported. Use policy adjustments instead.');
  },

  async getABCAnalysis(params?: {
    locationId?: string;
    dateRange?: { start: string; end: string };
    aThreshold?: number;
    bThreshold?: number;
  }) {
    const response = await apiClient.post('/manufacturing/inventory/classification/abc', params);
    return response.data;
  },

  async getXYZAnalysis(params?: {
    locationId?: string;
    dateRange?: { start: string; end: string };
    xThreshold?: number;
    yThreshold?: number;
  }) {
    const response = await apiClient.post('/manufacturing/inventory/classification/xyz', params);
    return response.data;
  },

  async getTurnoverAnalysis(params?: {
    productId?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const response = await apiClient.get('/manufacturing/inventory/turnover', { params });
    return response.data;
  },
};

export default inventoryService;
