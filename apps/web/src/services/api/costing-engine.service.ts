import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface CostLayer {
  id: string;
  tenantId: string;
  productId: string;
  locationId: string;
  batchId?: string;
  costingMethod: string;
  layerDate: string;
  referenceType: string;
  referenceId: string;
  referenceNumber?: string;
  originalQty: number;
  remainingQty: number;
  unitCost: number;
  landedCost: number;
  totalCost: number;
  currency: string;
  exchangeRate?: number;
  baseCurrCost?: number;
  fiscalPeriodId?: string;
  status: 'OPEN' | 'DEPLETED' | 'FROZEN';
  version: number;
  createdAt: string;
  depletions?: CostLayerDepletion[];
}

export interface CostLayerDepletion {
  id: string;
  costLayerId: string;
  depletedQty: number;
  unitCost: number;
  totalCost: number;
  referenceType: string;
  referenceId: string;
  referenceNumber?: string;
  depletedAt: string;
}

export interface ItemCost {
  id: string;
  tenantId: string;
  productId: string;
  locationId: string;
  currentUnitCost: number;
  currentTotalQty: number;
  currentTotalValue: number;
  standardCost: number;
  lastReceiptCost?: number;
  lastReceiptDate?: string;
  lastIssueCost?: number;
  lastIssueDate?: string;
  currency?: string;
  version: number;
}

export interface WIPCostAccumulation {
  id: string;
  workOrderId: string;
  costElement: string;
  accumulatedAmount: number;
  absorbedAmount?: number;
  varianceAmount?: number;
  lastTransactionDate?: string;
}

export interface CostVariance {
  id: string;
  varianceType: string;
  referenceType: string;
  referenceId: string;
  productId?: string;
  fiscalPeriodId?: string;
  standardAmount: number;
  actualAmount: number;
  varianceAmount: number;
  variancePct?: number;
  favorability?: string;
  notes?: string;
  createdAt: string;
}

export interface InventoryValuationItem {
  productId: string;
  productCode: string;
  productName: string;
  category?: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  onHandQty: number;
  unitCost: number;
  totalValue: number;
  costingMethod: string;
  standardCost: number;
  movingAvgCost: number;
}

export interface InventoryValuationResult {
  items: InventoryValuationItem[];
  totalValuation: number;
  itemCount: number;
}

export interface RevaluationHistory {
  id: string;
  revaluationNumber: string;
  revaluationType: string;
  productId: string;
  locationId?: string;
  fiscalPeriodId?: string;
  oldUnitCost: number;
  newUnitCost: number;
  affectedQty: number;
  revaluationAmount: number;
  journalEntryId?: string;
  status: string;
  reason?: string;
  performedAt: string;
}

export interface PeriodCloseCheckpoint {
  id: string;
  fiscalPeriodId: string;
  status: 'OPEN' | 'CLOSING' | 'CLOSED' | 'REOPENED';
  inventoryValuationTotal?: number;
  glInventoryTotal?: number;
  discrepancy?: number;
  varianceSummary?: Record<string, number>;
  closedAt?: string;
  reopenedAt?: string;
  reopenReason?: string;
}

export interface ItemCostProfile {
  id: string;
  productId: string;
  locationId?: string;
  costingMethod: string;
  standardCostVersion?: string;
  enableLandedCost: boolean;
  overheadRate?: number;
  laborRate?: number;
}

export interface PlannedCOGSItem {
  periodDate: string;
  productId: string;
  productCode?: string;
  productName?: string;
  forecastQty: number;
  forecastRevenue: number;
  unitCost: number;
  plannedCOGS: number;
  contributionMargin: number;
  marginPct: number;
}

export interface PlannedCOGSResult {
  items: PlannedCOGSItem[];
  summary: {
    totalRevenue: number;
    totalPlannedCOGS: number;
    contributionMargin: number;
    marginPct: number;
  };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

// ============================================================================
// Costing Engine API Service
// ============================================================================

export const costingEngineService = {
  // ─── Cost Layers ───────────────────────────────────────────────────────
  async getCostLayers(params?: {
    productId?: string;
    locationId?: string;
    status?: string;
    skip?: number;
    take?: number;
  }): Promise<PaginatedResult<CostLayer>> {
    const response = await apiClient.get('/manufacturing/costing-engine/cost-layers', { params });
    return response.data;
  },

  // ─── Item Costs ────────────────────────────────────────────────────────
  async getItemCosts(params?: {
    productId?: string;
    locationId?: string;
  }): Promise<ItemCost[]> {
    const response = await apiClient.get('/manufacturing/costing-engine/item-costs', { params });
    return response.data;
  },

  // ─── WIP Accumulation ─────────────────────────────────────────────────
  async getWIPAccumulation(workOrderId: string): Promise<WIPCostAccumulation[]> {
    const response = await apiClient.get(`/manufacturing/costing-engine/wip/${workOrderId}`);
    return response.data;
  },

  // ─── Cost Variances ───────────────────────────────────────────────────
  async getCostVariances(params?: {
    varianceType?: string;
    referenceType?: string;
    referenceId?: string;
    fiscalPeriodId?: string;
    productId?: string;
    skip?: number;
    take?: number;
  }): Promise<PaginatedResult<CostVariance>> {
    const response = await apiClient.get('/manufacturing/costing-engine/variances', { params });
    return response.data;
  },

  // ─── Inventory Valuation ──────────────────────────────────────────────
  async getInventoryValuation(params?: {
    productId?: string;
    locationId?: string;
  }): Promise<InventoryValuationResult> {
    const response = await apiClient.get('/manufacturing/costing-engine/inventory-valuation', { params });
    return response.data;
  },

  // ─── Standard Cost Rollup ─────────────────────────────────────────────
  async rollupStandardCost(dto: {
    productId: string;
    effectiveDate?: string;
    locationId?: string;
    version?: string;
  }) {
    const response = await apiClient.post('/manufacturing/costing-engine/rollup-standard-cost', dto);
    return response.data;
  },

  // ─── Landed Cost Allocation ───────────────────────────────────────────
  async allocateLandedCost(dto: {
    goodsReceiptId: string;
    allocations: Array<{
      goodsReceiptLineId: string;
      costLayerId?: string;
      productId: string;
      locationId: string;
      costCategory: string;
      amount: number;
    }>;
    allocationMethod: string;
    vendorInvoiceRef?: string;
    fiscalPeriodId?: string;
  }) {
    const response = await apiClient.post('/manufacturing/costing-engine/landed-cost', dto);
    return response.data;
  },

  // ─── Revaluation ──────────────────────────────────────────────────────
  async revalueInventory(dto: {
    productId: string;
    locationId: string;
    newUnitCost: number;
    reason: string;
    fiscalPeriodId?: string;
  }) {
    const response = await apiClient.post('/manufacturing/costing-engine/revalue', dto);
    return response.data;
  },

  async getRevaluationHistory(params?: {
    productId?: string;
    status?: string;
    skip?: number;
    take?: number;
  }): Promise<PaginatedResult<RevaluationHistory>> {
    const response = await apiClient.get('/manufacturing/costing-engine/revaluation-history', { params });
    return response.data;
  },

  // ─── Period Close ─────────────────────────────────────────────────────
  async snapshotPeriodValuation(fiscalPeriodId: string) {
    const response = await apiClient.post('/manufacturing/costing-engine/period-snapshot', { fiscalPeriodId });
    return response.data;
  },

  async closePeriod(fiscalPeriodId: string) {
    const response = await apiClient.post('/manufacturing/costing-engine/period-close', { fiscalPeriodId });
    return response.data;
  },

  async reopenPeriod(fiscalPeriodId: string, reason: string) {
    const response = await apiClient.post('/manufacturing/costing-engine/period-reopen', { fiscalPeriodId, reason });
    return response.data;
  },

  async getPeriodCloseStatus(fiscalPeriodId: string): Promise<PeriodCloseCheckpoint | null> {
    const response = await apiClient.get(`/manufacturing/costing-engine/period-close-status/${fiscalPeriodId}`);
    return response.data;
  },

  // ─── S&OP / Scenario Cost Projections ─────────────────────────────────
  async getPlannedCOGS(params: {
    scenarioId?: string;
    productId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PlannedCOGSResult> {
    const response = await apiClient.get('/manufacturing/costing-engine/planned-cogs', { params });
    return response.data;
  },

  async getScenarioCostComparison(dto: {
    scenarioIds: string[];
    productId?: string;
    startDate: string;
    endDate: string;
  }) {
    const response = await apiClient.post('/manufacturing/costing-engine/scenario-cost-comparison', dto);
    return response.data;
  },

  // ─── Cost Profiles ────────────────────────────────────────────────────
  async getCostProfiles(productId?: string): Promise<ItemCostProfile[]> {
    const response = await apiClient.get('/manufacturing/costing-engine/cost-profiles', { params: { productId } });
    return response.data;
  },

  async upsertCostProfile(dto: {
    productId: string;
    locationId?: string;
    costingMethod: string;
    standardCostVersion?: string;
    enableLandedCost?: boolean;
    overheadRate?: number;
    laborRate?: number;
  }): Promise<ItemCostProfile> {
    const response = await apiClient.post('/manufacturing/costing-engine/cost-profiles', dto);
    return response.data;
  },

  // ─── Transaction Reversals ────────────────────────────────────────────
  async reverseTransaction(dto: { journalEntryId: string; reason: string }) {
    const response = await apiClient.post('/manufacturing/costing-engine/reverse-transaction', dto);
    return response.data;
  },
};
