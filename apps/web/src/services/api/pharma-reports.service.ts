import { apiClient } from './client';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

export interface PharmaFilters {
  [key: string]: unknown;
  limit?: number;
  offset?: number;
  productIds?: string[];
  locationIds?: string[];
  batchIds?: string[];
  category?: string;
  startDate?: string;
  endDate?: string;
}

export interface CurrentStockRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  location_name: string;
  on_hand_qty: number;
  available_qty: number;
  allocated_qty: number;
  reserved_qty: number;
  quarantine_qty: number;
  in_transit_qty: number;
  on_order_qty: number;
  unit_cost: number;
  inventory_value: number;
  last_updated: string;
}

export interface BatchInventoryRow {
  product_id: string;
  sku: string;
  product_name: string;
  batch_id: string;
  batch_number: string;
  location_id: string;
  location_code: string;
  location_name: string;
  quantity: number;
  available_qty: number;
  cost_per_unit: number;
  batch_value: number;
  manufacturing_date: string | null;
  expiry_date: string | null;
  days_to_expiry: number | null;
  batch_status: string;
}

export interface MovementLedgerRow {
  id: string;
  sequence_number: string;
  transaction_date: string;
  product_id: string;
  sku: string;
  product_name: string;
  location_code: string;
  batch_number: string | null;
  entry_type: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  running_balance: number;
  reference_type: string | null;
  reference_number: string | null;
  notes: string | null;
}

export interface ReorderRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  on_hand_qty: number;
  available_qty: number;
  reorder_point: number;
  safety_stock_qty: number;
  lead_time_days: number;
  avg_daily_sales: number;
  suggested_order_qty: number;
  abc_class: string | null;
  days_of_stock: number | null;
}

export interface StockAgeingRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_code: string;
  batch_number: string;
  inward_date: string | null;
  age_days: number;
  age_bucket: string;
  quantity: number;
  batch_value: number;
}

export interface NearExpiryRow {
  product_id: string;
  sku: string;
  product_name: string;
  batch_id: string;
  batch_number: string;
  location_code: string;
  location_name: string;
  expiry_date: string;
  remaining_days: number;
  quantity: number;
  available_qty: number;
  cost_per_unit: number;
  at_risk_value: number;
  batch_status: string;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ExpiredStockRow {
  product_id: string;
  sku: string;
  product_name: string;
  batch_id: string;
  batch_number: string;
  location_code: string;
  location_name: string;
  expiry_date: string;
  days_expired: number;
  quantity: number;
  cost_per_unit: number;
  expired_value: number;
  batch_status: string;
}

export interface FEFOPickingRow {
  product_id: string;
  sku: string;
  product_name: string;
  picking_sequence: number;
  batch_id: string;
  batch_number: string;
  location_code: string;
  expiry_date: string | null;
  remaining_days: number | null;
  available_qty: number;
  batch_status: string;
}

export interface ExpiryRiskSummary {
  total_inventory_value: number;
  expired_value: number;
  expired_pct: number;
  near_expiry_value_30d: number;
  near_expiry_pct_30d: number;
  near_expiry_value_90d: number;
  near_expiry_pct_90d: number;
  near_expiry_value_180d: number;
  near_expiry_pct_180d: number;
  near_expiry_value_270d: number;
  near_expiry_pct_270d: number;
  monthly_trend: ExpiryTrendPoint[];
}

export interface ExpiryTrendPoint {
  month: string;
  expiring_value: number;
  expiring_qty: number;
  batch_count: number;
}

export interface DeadSlowRow {
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  location_code: string;
  on_hand_qty: number;
  inventory_value: number;
  last_sale_date: string | null;
  days_since_last_sale: number | null;
  classification: 'DEAD' | 'SLOW';
}

export interface ABCRow {
  product_id: string;
  sku: string;
  product_name: string;
  consumption_value: number;
  consumption_qty: number;
  pct_of_total: number;
  cumulative_pct: number;
  on_hand_qty: number;
  inventory_value: number;
  abc_class: 'A' | 'B' | 'C';
}

export interface XYZRow {
  product_id: string;
  sku: string;
  product_name: string;
  avg_monthly_demand: number;
  stddev_monthly_demand: number;
  coefficient_of_variation: number;
  xyz_class: 'X' | 'Y' | 'Z';
  months_analyzed: number;
}

export interface TurnoverRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_code: string;
  cogs: number;
  avg_inventory: number;
  turnover_ratio: number | null;
  days_of_inventory: number | null;
}

export interface SuggestedPurchaseRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  current_stock: number;
  available_stock: number;
  on_order_qty: number;
  avg_daily_demand: number;
  lead_time_days: number;
  safety_stock: number;
  reorder_point: number;
  demand_during_lead_time: number;
  suggested_purchase_qty: number;
  abc_class: string | null;
  preferred_supplier: string | null;
  estimated_cost: number;
}

export interface SupplierPerformanceRow {
  supplier_key: string;
  supplier_name: string;
  supplier_code: string | null;
  total_orders: number;
  on_time_delivery_pct: number | null;
  avg_lead_time_days: number | null;
  fulfillment_rate_pct: number | null;
  rejection_rate_pct: number | null;
  total_spend: number | null;
  has_explicit_marg_mapping: boolean;
  mapping_status: 'EXPLICIT_MARG_MAPPING' | 'LOCAL_ONLY_UNMAPPED' | 'MARG_ONLY_UNMAPPED';
  order_source: string;
  lead_time_source: string;
  spend_source: string;
  spend_note: string | null;
  rejection_source: string;
  last_activity_date: string | null;
}

export interface StockOutRow {
  product_id: string;
  sku: string;
  item_name: string;
  stock_out_count: number;
  total_duration_days: number;
  last_stock_out_date: string | null;
  current_stock: number;
  marg_current_stock: number;
  current_stock_delta: number;
  current_stock_source: 'ALIGNED_WITH_MARG' | 'DIVERGES_FROM_MARG';
}

export interface ProcurementDataAvailability {
  syncedFromMarg: boolean;
  margRecordCount: number;
  localRecordCount: number;
  tables: string[];
  notes: string[];
}

export interface ProcurementDataSyncAnalysis {
  purchaseOrders: ProcurementDataAvailability;
  purchaseInvoices: ProcurementDataAvailability;
  goodsReceipts: ProcurementDataAvailability;
  stockTransactions: ProcurementDataAvailability;
  sourceOfTruth: {
    supplierPerformanceMetrics: string;
    leadTimeCalculation: string;
    spendCalculation: string;
  };
  risks: string[];
  fallbackLogic: string[];
  syncImprovements: string[];
}

export interface SupplierPerformanceReportResponse {
  analysis: ProcurementDataSyncAnalysis;
  data: SupplierPerformanceRow[];
  total: number;
}

export interface StockOutReportResponse {
  analysis: ProcurementDataSyncAnalysis;
  data: StockOutRow[];
  total: number;
}

export interface DashboardKPIs {
  total_inventory_value: number;
  total_sku_count: number;
  total_batch_count: number;
  total_location_count: number;
  turnover_ratio: number | null;
  pct_near_expiry_90d: number;
  pct_dead_stock: number;
  days_of_inventory: number | null;
  avg_days_to_expiry: number | null;
  negative_stock_count: number;
}

export interface AlertItem {
  alert_type: 'NEAR_EXPIRY' | 'LOW_STOCK' | 'NEWLY_EXPIRED';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  product_id: string;
  sku: string;
  product_name: string;
  location_code: string;
  batch_number: string | null;
  message: string;
  value_at_risk: number;
  details: Record<string, unknown>;
}

export interface InventoryValueTrendPoint {
  date: string;
  total_value: number;
  receipt_value: number;
  issue_value: number;
}

export interface ExpiryLossTrendPoint {
  month: string;
  expired_value: number;
  expired_qty: number;
  batch_count: number;
  cumulative_loss: number;
}

// ── API Service ────────────────────────────────────────────────────────────

const BASE = '/pharma-reports';

function toParams(filters: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      v.forEach((item) => {
        params[k] = String(item); // will be handled by axios paramsSerializer
      });
    } else {
      params[k] = String(v);
    }
  }
  return params;
}

export const pharmaReportsService = {
  // ── Dashboard ──────────────────────────────────────────────────────────
  getDashboardKPIs: (filters?: PharmaFilters) =>
    apiClient.get<DashboardKPIs>(`${BASE}/dashboard/kpis`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getExpiryLossTrend: (filters?: PharmaFilters) =>
    apiClient.get<ExpiryLossTrendPoint[]>(`${BASE}/dashboard/expiry-loss-trend`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getInventoryValueTrend: () =>
    apiClient.get<InventoryValueTrendPoint[]>(`${BASE}/dashboard/inventory-value-trend`).then((r) => r.data),

  // ── Inventory ──────────────────────────────────────────────────────────
  getCurrentStock: (filters?: PharmaFilters) =>
    apiClient.get<PaginatedResponse<CurrentStockRow>>(`${BASE}/inventory/current-stock`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getBatchInventory: (filters?: PharmaFilters) =>
    apiClient.get<PaginatedResponse<BatchInventoryRow>>(`${BASE}/inventory/batch-wise`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getMovementLedger: (filters?: PharmaFilters) =>
    apiClient.get<PaginatedResponse<MovementLedgerRow>>(`${BASE}/inventory/movement-ledger`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getReorderReport: (filters?: PharmaFilters & { avgSalesDays?: number }) =>
    apiClient.get<PaginatedResponse<ReorderRow>>(`${BASE}/inventory/reorder`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getStockAgeing: (filters?: PharmaFilters & { bucketDays?: number[] }) =>
    apiClient.get<{ data: StockAgeingRow[]; summary: { bucket: string; total_qty: number; total_value: number }[]; total: number }>(`${BASE}/inventory/ageing`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  // ── Expiry ─────────────────────────────────────────────────────────────
  getNearExpiry: (filters?: PharmaFilters & { thresholdDays?: number }) =>
    apiClient.get<PaginatedResponse<NearExpiryRow>>(`${BASE}/expiry/near`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getExpiredStock: (filters?: PharmaFilters) =>
    apiClient.get<PaginatedResponse<ExpiredStockRow>>(`${BASE}/expiry/expired`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getFEFOPicking: (filters?: PharmaFilters) =>
    apiClient.get<PaginatedResponse<FEFOPickingRow>>(`${BASE}/expiry/fefo`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getExpiryRisk: (filters?: PharmaFilters) =>
    apiClient.get<ExpiryRiskSummary>(`${BASE}/expiry/risk`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  // ── Stock Analysis ─────────────────────────────────────────────────────
  getDeadSlowStock: (filters?: PharmaFilters & { deadMonths?: number }) =>
    apiClient.get<PaginatedResponse<DeadSlowRow>>(`${BASE}/analysis/dead-slow`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getABCAnalysis: (filters?: PharmaFilters & { thresholdA?: number; thresholdB?: number; periodMonths?: number }) =>
    apiClient.get<{ data: ABCRow[]; summary: { class: string; count: number; value: number; pct: number }[] }>(`${BASE}/analysis/abc`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getXYZAnalysis: (filters?: PharmaFilters & { thresholdX?: number; thresholdY?: number; periodMonths?: number }) =>
    apiClient.get<{ data: XYZRow[] }>(`${BASE}/analysis/xyz`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getInventoryTurnover: (filters?: PharmaFilters) =>
    apiClient.get<PaginatedResponse<TurnoverRow>>(`${BASE}/analysis/turnover`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  // ── Procurement ────────────────────────────────────────────────────────
  getSuggestedPurchase: (filters?: PharmaFilters) =>
    apiClient.get<PaginatedResponse<SuggestedPurchaseRow>>(`${BASE}/procurement/suggested-purchase`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getSupplierPerformance: (filters?: PharmaFilters & { supplierIds?: string[] }) =>
    apiClient.get<SupplierPerformanceReportResponse>('/reports/supplier-performance', { params: toParams(filters ?? {}) }).then((r) => r.data),

  getStockOuts: (filters?: PharmaFilters) =>
    apiClient.get<StockOutReportResponse>('/reports/stock-out', { params: toParams(filters ?? {}) }).then((r) => r.data),

  // ── Alerts ─────────────────────────────────────────────────────────────
  getAlerts: (config?: { nearExpiryDays?: number; aClassOnly?: boolean; alertLimit?: number }) =>
    apiClient.get<AlertItem[]>(`${BASE}/alerts`, { params: toParams(config ?? {}) }).then((r) => r.data),

  // ── Export ─────────────────────────────────────────────────────────────
  exportReport: async (reportType: string, format: 'csv' | 'xlsx', filters?: Record<string, unknown>): Promise<Blob> => {
    const params = toParams({ ...filters, report: reportType, format });
    const response = await apiClient.get(`${BASE}/export`, {
      params,
      responseType: 'blob',
      timeout: 300000, // 5 minutes for large exports
    });
    return response.data;
  },
};
