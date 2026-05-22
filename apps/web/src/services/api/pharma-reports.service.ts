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
  /** Column sort key (alias of a projected column) */
  sortBy?: string;
  /** Sort direction */
  sortDir?: 'asc' | 'desc';
  /** JSON-encoded ColumnFilter[] (per-column filters from useTableFilters) */
  filters?: string;
  /**
   * Document scope for sales/purchase analysis:
   *  - 'invoice' (default): pure commercial invoices
   *  - 'return': returns / credit & debit notes / breakage-expiry (positive)
   *  - 'net': invoices minus returns
   */
  scope?: 'invoice' | 'return' | 'net';
}

export interface CurrentStockRow {
  product_id: string;
  sku: string;
  product_name: string;
  company?: string | null;
  company_code?: string | null;
  company_name?: string | null;
  company_display?: string | null;
  salt?: string | null;
  salt_code?: string | null;
  salt_name?: string | null;
  salt_display?: string | null;
  product_group?: string | null;
  product_group_code?: string | null;
  product_group_name?: string | null;
  product_group_display?: string | null;
  hsn_code?: string | null;
  uom_code?: string | null;
  uom_name?: string | null;
  uom_display?: string | null;
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
  purchase_invoice_count: number;
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

export interface SupplierPerformancePurchaseOrderDetailRow {
  id: string;
  document_number: string;
  document_date: string;
  expected_date: string | null;
  supplier_id: string;
  supplier_code: string | null;
  supplier_name: string;
  status: string;
  total_amount: number;
  currency: string;
  line_count: number;
  ordered_qty: number;
  received_qty: number;
  pending_qty: number;
  source: 'LOCAL_PURCHASE_ORDER';
  open_path: string;
}

export interface SupplierPerformancePurchaseInvoiceDetailRow {
  id: string;
  supplier_key: string;
  company_id: number;
  document_number: string;
  document_date: string;
  order_date: string | null;
  voucher: string;
  vcn: string | null;
  orn: string | null;
  supplier_id: string | null;
  supplier_code: string | null;
  supplier_name: string;
  status: 'POSTED';
  total_amount: number;
  currency: string;
  line_count: number;
  total_qty: number;
  source: 'CORE_PURCHASE_INVOICE_GRN';
  open_path: string;
}

export interface StockOutReportResponse {
  analysis: ProcurementDataSyncAnalysis;
  data: StockOutRow[];
  total: number;
}

export type SalesPurchaseAnalysisKind = 'sales' | 'purchase';

export interface SalesPurchaseOverviewResponse {
  kind: SalesPurchaseAnalysisKind;
  summary: {
    totalAmount: number;
    totalBills: number;
    totalCustomers?: number;
    totalSuppliers?: number;
    totalQuantity: number;
    averageBillValue: number;
    averageQuantityPerBill: number;
    itemCount: number;
    cost?: number;
    grossProfit?: number;
    marginPct?: number | null;
  };
  trend: Array<{ period: string; bills: number; amount: number; quantity: number }>;
  topParties: Array<{ rank: number; party_code: string; name: string; bills: number; value: number; share: number }>;
  topItems: Array<{ rank: number; item_key: string; item_code: string; item_name: string; quantity: number; value: number }>;
  taxSummary: Array<{ tax_pct: number; tax_amount: number; taxable_amount: number }>;
  paymentModeSummary: Array<{ payment_mode: string; bills: number; amount: number }>;
}

export interface SalesPurchaseBillRow {
  bill_key: string;
  company_id: number;
  voucher: string;
  type: string;
  invoice_number: string;
  date: string;
  party_code: string | null;
  party_name: string;
  branch_name: string;
  branch_id: string | null;
  salesman: string | null;
  salesman_code?: string | null;
  salesman_name?: string | null;
  salesman_display?: string | null;
  user_name: string | null;
  payment_mode: 'CASH' | 'CREDIT' | 'MIXED';
  gross_amount: number;
  discount: number;
  discount_pct: number | null;
  tax_amount: number;
  round_off: number;
  net_amount: number;
  cost_amount: number;
  profit: number;
  margin_pct: number | null;
  quantity: number;
  item_count: number;
  status: 'POSTED' | 'RETURN';
}

export interface SalesPurchaseBillDrilldown {
  header: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  totals: { quantity: number; lineTotal: number; tax: number; cost: number; profit: number };
}

export interface SalesPurchaseItemDrilldown {
  metrics: Record<string, number | string | null>;
  stockByWarehouse: Array<Record<string, unknown>>;
  batchStock: Array<Record<string, unknown>>;
  movementHistory: Array<Record<string, unknown>>;
  relatedBills: Array<Record<string, unknown>>;
}

export interface SalesPurchasePartyDrilldown {
  metrics: Record<string, number | string | null>;
  outstanding: Record<string, unknown> | null;
  topItems: SalesPurchaseOverviewResponse['topItems'];
  billHistory: SalesPurchaseBillRow[];
}

export type FinancialPartyType = 'CUSTOMER' | 'SUPPLIER' | 'ALL';

export interface FinancialBucketDefinition {
  key: string;
  label: string;
  fromDays: number;
  toDays: number | null;
}

export interface FinancialDsoMetric {
  days: number;
  totalCreditSales: number;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
}

export interface FinancialTopOverdueRow {
  partyCode: string;
  partyName: string | null;
  companyId: number;
  overdueAmount: number;
  totalOutstanding: number;
}

export interface FinancialOutstandingSummary {
  partyCount: number;
  openInvoiceCount: number;
  totalOutstanding: number;
  creditBalance: number;
  signedBalance: number;
  /** Legacy fixed buckets kept for backwards compatibility; new code reads bucketTotals. */
  currentBucket: number;
  days31To60Bucket: number;
  days61To90Bucket: number;
  days91PlusBucket: number;
  /** Sum of post-dated cheque amounts across all open bills in the portfolio. */
  pdLessTotal: number;
  /** Per-bucket totals aligned with the response's bucketDefinitions. */
  bucketTotals: number[];
  /** DSO when receivables are present and credit sales exist in the window; else null. */
  dso: FinancialDsoMetric | null;
  /** Top 10 most-overdue parties by exposure outside the first (current) bucket. */
  topOverdue: FinancialTopOverdueRow[];
}

export interface FinancialOutstandingPartyRow {
  partyCode: string;
  partyName: string | null;
  groupCode: string | null;
  groupName: string | null;
  companyId: number;
  openInvoiceCount: number;
  totalOutstanding: number;
  creditBalance: number;
  signedBalance: number;
  pdLess: number;
  /** Legacy fixed-bucket fields (positions 0..3 of bucketAmounts under the default 30/60/90 scheme). */
  currentBucket: number;
  days31To60: number;
  days61To90: number;
  days91Plus: number;
  /** Canonical per-row bucket amounts aligned with response.bucketDefinitions. */
  bucketAmounts: number[];
  /** Amount-weighted average days outstanding for this party (null when totalOutstanding is 0). */
  avgDaysOutstanding: number | null;
  lastInvoiceDate: string | null;
}

export interface FinancialOutstandingResponse {
  asOf: string;
  asOfExplicit: boolean;
  partyType: FinancialPartyType;
  bucketDefinitions: FinancialBucketDefinition[];
  summary: FinancialOutstandingSummary;
  rows: FinancialOutstandingPartyRow[];
  total: number;
}

export interface FinancialOutstandingGroupRow {
  groupCode: string | null;
  groupName: string | null;
  partyCount: number;
  openInvoiceCount: number;
  totalOutstanding: number;
  creditBalance: number;
  pdLess: number;
  bucketAmounts: number[];
  avgDaysOutstanding: number | null;
  /** Legacy fixed-bucket fields preserved for parity with the by-party row shape. */
  currentBucket: number;
  days31To60: number;
  days61To90: number;
  days91Plus: number;
  lastInvoiceDate: string | null;
}

export interface FinancialOutstandingGroupResponse {
  asOf: string;
  asOfExplicit: boolean;
  partyType: FinancialPartyType;
  bucketDefinitions: FinancialBucketDefinition[];
  rows: FinancialOutstandingGroupRow[];
  total: number;
  grandTotals: {
    partyCount: number;
    openInvoiceCount: number;
    totalOutstanding: number;
    creditBalance: number;
    pdLess: number;
    bucketTotals: number[];
  };
}

export interface FinancialOutstandingInvoiceRow {
  vcn: string | null;
  date: string;
  days: number;
  finalAmt: number;
  balance: number;
  pdLess: number;
  voucher: string | null;
  sVoucher: string | null;
  bucket: 'CURRENT' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_91_PLUS';
  bucketIndex: number;
}

export interface FinancialOutstandingDetailResponse {
  partyCode: string;
  partyName: string | null;
  groupCode: string | null;
  groupName: string | null;
  asOf: string;
  asOfExplicit: boolean;
  bucketDefinitions: FinancialBucketDefinition[];
  invoices: FinancialOutstandingInvoiceRow[];
  totals: {
    finalAmt: number;
    balance: number;
    pdLess: number;
    openCount: number;
    bucketTotals: number[];
  };
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
}

export interface FinancialLedgerTransactionRow {
  date: string;
  voucher: string | null;
  vcn: string | null;
  book: string | null;
  bookName: string | null;
  counterpartyCode: string | null;
  counterpartyName: string | null;
  remark: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface FinancialPartyLedgerResponse {
  partyCode: string;
  partyName: string | null;
  groupCode: string | null;
  groupName: string | null;
  companyId: number | null;
  period: { fromDate: string | null; toDate: string | null };
  opening: {
    fromPartyBalance: number | null;
    computed: number;
    source: 'MARG_PARTY_BALANCE' | 'COMPUTED_FROM_POSTINGS';
  };
  closing: {
    fromPartyBalance: number | null;
    computed: number;
    source: 'MARG_PARTY_BALANCE' | 'COMPUTED_FROM_POSTINGS';
  };
  totals: {
    openingBalance: number;
    debit: number;
    credit: number;
    closingBalance: number;
    transactionCount: number;
  };
  transactions: FinancialLedgerTransactionRow[];
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
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

export type ThreeSixtyPeriod = 'fy' | 'calendar' | 'last12';
export type ThreeSixtySearchType = 'item' | 'customer' | 'supplier';

export interface ThreeSixtySearchOption {
  value: string;
  label: string;
  code: string | null;
  description: string | null;
  source: 'LOCAL' | 'MARG';
}

export interface ThreeSixtyMetricTrendPoint {
  month: string;
  sales_value?: number;
  purchase_value?: number;
  sales_qty?: number;
  receipt_qty?: number;
  issue_qty?: number;
  delay_days?: number;
  on_time_delivery_pct?: number | null;
}

export interface ThreeSixtyContributionRow {
  rank: number;
  name: string;
  code?: string | null;
  company?: string | null;
  salt?: string | null;
  productGroup?: string | null;
  hsnCode?: string | null;
  mappingStatus?: string | null;
  missingReason?: string | null;
  quantity?: number;
  value: number;
  share: number;
}

export interface ThreeSixtyItemMappingDiagnostic {
  companyId: number | null;
  margPid: string | null;
  itemCode: string | null;
  stagedName: string | null;
  reason: string;
  lineCount: number;
  value: number;
}

export interface ThreeSixtyAgeingRow {
  bucket: string;
  countLabel?: string;
  count?: number;
  amount: number;
  status: string;
}

export interface Item360Report {
  asOf: string;
  profile: Record<string, unknown>;
  kpis: Record<string, number | null>;
  charts: {
    monthlyTrend: ThreeSixtyMetricTrendPoint[];
    locationSales: { location: string; sales_value: number }[];
    stockMovement?: ThreeSixtyMetricTrendPoint[];
  };
  tables: {
    topBuyers: ThreeSixtyContributionRow[];
    batches: Array<Record<string, unknown>>;
    stockAgeing?: Array<Record<string, unknown>>;
    openPurchaseOrders?: Array<Record<string, unknown>>;
  };
  insights: string[];
}

export interface Customer360Report {
  asOf: string;
  profile: Record<string, unknown>;
  kpis: Record<string, number | null>;
  ageing: ThreeSixtyAgeingRow[];
  charts: { monthlyTrend: ThreeSixtyMetricTrendPoint[]; paymentDelayTrend?: ThreeSixtyMetricTrendPoint[] };
  tables: { topItems: ThreeSixtyContributionRow[]; returnInsight?: Record<string, unknown>; profitability?: Record<string, unknown>; loyalty?: Record<string, unknown> };
  diagnostics?: { unmappedItems?: ThreeSixtyItemMappingDiagnostic[] };
  insights: string[];
}

export interface Supplier360Report {
  asOf: string;
  profile: Record<string, unknown>;
  kpis: Record<string, number | null>;
  ageing: ThreeSixtyAgeingRow[];
  charts: { monthlyTrend: ThreeSixtyMetricTrendPoint[]; deliveryTrend?: ThreeSixtyMetricTrendPoint[] };
  tables: {
    topItems: ThreeSixtyContributionRow[];
    openOrders: Array<Record<string, unknown>>;
    deliveryPerformance?: Record<string, unknown>;
    quality?: Record<string, unknown>;
    priceVariance?: Record<string, unknown>;
  };
  insights: string[];
}

// ── Sales/Purchase analytics extensions ────────────────────────────────────

export type SalesPurchaseDimension =
  | 'salesman'
  | 'salt'
  | 'productCompany'
  | 'productGroup'
  | 'product'
  | 'hsnCode';

export interface SalesPurchaseDimensionRow {
  key: string;
  label: string;
  billCount: number;
  partyCount: number;
  quantity: number;
  netAmount: number;
  costAmount: number;
  profit: number;
  marginPct: number | null;
  itemCount: number;
}

export interface SalesPurchaseDimensionResponse {
  data: SalesPurchaseDimensionRow[];
  total: number;
  grandTotal: number;
  dimension: SalesPurchaseDimension;
}

export interface SalesPurchaseComparisonSummary {
  netAmount: number;
  quantity: number;
  billCount: number;
  itemCount: number;
  cost: number;
  profit: number;
  marginPct: number | null;
}

export interface SalesPurchaseComparisonBreakdownRow {
  key: string;
  label: string;
  currentAmount: number;
  compareAmount: number;
  delta: number;
  growthPct: number | null;
  currentBills: number;
  compareBills: number;
  currentQty: number;
  compareQty: number;
}

export interface SalesPurchaseComparisonResponse {
  kind: SalesPurchaseAnalysisKind;
  currentRange: { startDate: string; endDate: string };
  compareRange: { startDate: string; endDate: string };
  summary: {
    current: SalesPurchaseComparisonSummary;
    compare: SalesPurchaseComparisonSummary;
    delta: {
      netAmount: number;
      quantity: number;
      billCount: number;
      itemCount: number;
      profit: number;
      marginPct: number | null;
    };
    growthPct: {
      netAmount: number | null;
      quantity: number | null;
      billCount: number | null;
      itemCount: number | null;
      profit: number | null;
    };
  };
  breakdown: SalesPurchaseComparisonBreakdownRow[];
  dimension: SalesPurchaseDimension | null;
}

// ── Accounting (Trial Balance + Account Ledger) ────────────────────────────

export interface TrialBalanceRow {
  id: string;
  accountNumber: string;
  name: string;
  accountType: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  netBalance: number;
  closingBalance: number;
  debitBalance: number;
  creditBalance: number;
}

export interface TrialBalanceSummary {
  accountsShown: number;
  totalDebits: number;
  totalCredits: number;
  sumDebitBalance: number;
  sumCreditBalance: number;
  netDifference: number;
  isBalanced: boolean;
}

export interface TrialBalanceResponse {
  rows: TrialBalanceRow[];
  total: number;
  summary: TrialBalanceSummary;
}

export interface AccountLedgerRow {
  id: string;
  lineId: string;
  entryDate: string;
  entryNumber: string;
  description: string | null;
  status: string;
  referenceType: string | null;
  debitAmount: number;
  creditAmount: number;
  runningBalance: number;
}

export interface AccountLedgerResponse {
  account: { id: string; accountNumber: string; name: string; normalBalance: string; accountType: string };
  rows: AccountLedgerRow[];
  total: number;
  openingBalance: number;
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

  getItem360: (filters?: { search?: string; period?: ThreeSixtyPeriod; locationId?: string }) =>
    apiClient.get<Item360Report>(`${BASE}/360/item`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getCustomer360: (filters?: { search?: string; period?: ThreeSixtyPeriod; locationId?: string }) =>
    apiClient.get<Customer360Report>(`${BASE}/360/customer`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getSupplier360: (filters?: { search?: string; period?: ThreeSixtyPeriod; locationId?: string }) =>
    apiClient.get<Supplier360Report>(`${BASE}/360/supplier`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  search360Options: (filters: { type: ThreeSixtySearchType; search?: string; limit?: number }) =>
    apiClient.get<ThreeSixtySearchOption[]>(`${BASE}/360/search`, { params: toParams(filters) }).then((r) => r.data),

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

  getSupplierPerformancePurchaseOrders: (supplierKey: string, filters?: PharmaFilters & { supplierIds?: string[] }) =>
    apiClient
      .get<PaginatedResponse<SupplierPerformancePurchaseOrderDetailRow>>(`/reports/supplier-performance/${encodeURIComponent(supplierKey)}/purchase-orders`, { params: toParams(filters ?? {}) })
      .then((r) => r.data),

  getSupplierPerformancePurchaseInvoices: (supplierKey: string, filters?: PharmaFilters & { supplierIds?: string[] }) =>
    apiClient
      .get<PaginatedResponse<SupplierPerformancePurchaseInvoiceDetailRow>>(`/reports/supplier-performance/${encodeURIComponent(supplierKey)}/purchase-invoices`, { params: toParams(filters ?? {}) })
      .then((r) => r.data),

  getStockOuts: (filters?: PharmaFilters) =>
    apiClient.get<StockOutReportResponse>('/reports/stock-out', { params: toParams(filters ?? {}) }).then((r) => r.data),

  getSalesPurchaseOverview: (kind: SalesPurchaseAnalysisKind, filters?: PharmaFilters) =>
    apiClient.get<SalesPurchaseOverviewResponse>(`${BASE}/analysis/${kind}/overview`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getSalesPurchaseBills: (kind: SalesPurchaseAnalysisKind, filters?: PharmaFilters) =>
    apiClient.get<PaginatedResponse<SalesPurchaseBillRow>>(`${BASE}/analysis/${kind}/bills`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getSalesPurchaseBillDrilldown: (kind: SalesPurchaseAnalysisKind, billKey: string) =>
    apiClient.get<SalesPurchaseBillDrilldown>(`${BASE}/analysis/${kind}/bills/${encodeURIComponent(billKey)}`).then((r) => r.data),

  getSalesPurchaseItemDrilldown: (kind: SalesPurchaseAnalysisKind, itemKey: string, filters?: PharmaFilters) =>
    apiClient.get<SalesPurchaseItemDrilldown>(`${BASE}/analysis/${kind}/items/${encodeURIComponent(itemKey)}`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getSalesPurchasePartyDrilldown: (kind: SalesPurchaseAnalysisKind, partyCode: string, filters?: PharmaFilters) =>
    apiClient.get<SalesPurchasePartyDrilldown>(`${BASE}/analysis/${kind}/parties/${encodeURIComponent(partyCode)}`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getFinancialOutstanding: (
    filters?: PharmaFilters & {
      partyType?: FinancialPartyType;
      companyId?: number | string;
      asOfDate?: string;
      bucketBoundaries?: string;
      dsoDays?: number;
    },
  ) =>
    apiClient.get<FinancialOutstandingResponse>(`${BASE}/financial/outstanding`, { params: toParams(filters ?? {}) }).then((r) => r.data),

  getFinancialOutstandingByGroup: (
    filters?: PharmaFilters & {
      partyType?: FinancialPartyType;
      companyId?: number | string;
      asOfDate?: string;
      bucketBoundaries?: string;
    },
  ) =>
    apiClient
      .get<FinancialOutstandingGroupResponse>(`${BASE}/financial/outstanding-groups`, { params: toParams(filters ?? {}) })
      .then((r) => r.data),

  getFinancialOutstandingDetail: (
    partyCode: string,
    filters?: PharmaFilters & {
      companyId?: number | string;
      includeSettled?: boolean;
      asOfDate?: string;
      bucketBoundaries?: string;
      bucketIndex?: number;
    },
  ) =>
    apiClient
      .get<FinancialOutstandingDetailResponse>(`${BASE}/financial/outstanding/${encodeURIComponent(partyCode)}`, { params: toParams(filters ?? {}) })
      .then((r) => r.data),

  getFinancialPartyLedger: (
    partyCode: string,
    filters?: PharmaFilters & { companyId?: number | string; fromDate?: string; toDate?: string },
  ) =>
    apiClient
      .get<FinancialPartyLedgerResponse>(`${BASE}/financial/ledger/${encodeURIComponent(partyCode)}`, { params: toParams(filters ?? {}) })
      .then((r) => r.data),

  // ── Alerts ─────────────────────────────────────────────────────────────
  getAlerts: (config?: { nearExpiryDays?: number; aClassOnly?: boolean; alertLimit?: number }) =>
    apiClient.get<AlertItem[]>(`${BASE}/alerts`, { params: toParams(config ?? {}) }).then((r) => r.data),

  // ── Sales/Purchase analytics extensions ────────────────────────────────
  getSalesPurchaseDimension: (
    kind: SalesPurchaseAnalysisKind,
    dimension: SalesPurchaseDimension,
    filters?: PharmaFilters,
  ) =>
    apiClient
      .get<SalesPurchaseDimensionResponse>(
        `${BASE}/analysis/${kind}/dimension/${dimension}`,
        { params: toParams(filters ?? {}) },
      )
      .then((r) => r.data),

  getSalesPurchaseComparison: (
    kind: SalesPurchaseAnalysisKind,
    filters: PharmaFilters & {
      startDate: string;
      endDate: string;
      compareStartDate: string;
      compareEndDate: string;
      dimension?: SalesPurchaseDimension | 'none';
    },
  ) =>
    apiClient
      .get<SalesPurchaseComparisonResponse>(`${BASE}/analysis/${kind}/comparison`, {
        params: toParams(filters),
      })
      .then((r) => r.data),

  // ── Accounting Reports (Trial Balance + Account Ledger) ────────────────
  getTrialBalance: (
    filters?: PharmaFilters & { startDate?: string; endDate?: string; accountType?: string; showZero?: boolean },
  ) =>
    apiClient
      .get<TrialBalanceResponse>(`${BASE}/accounting/trial-balance`, { params: toParams(filters ?? {}) })
      .then((r) => r.data),

  getAccountLedger: (
    accountId: string,
    filters?: PharmaFilters & { startDate?: string; endDate?: string },
  ) =>
    apiClient
      .get<AccountLedgerResponse>(`${BASE}/accounting/trial-balance/${encodeURIComponent(accountId)}/ledger`, {
        params: toParams(filters ?? {}),
      })
      .then((r) => r.data),

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
