// ============ Auth Types ============
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string;
  avatarUrl?: string;
  lastLoginAt?: string;
  createdAt: string;
}

export type UserRole = 'ADMIN' | 'PLANNER' | 'FINANCE' | 'VIEWER';

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantName: string;
  tenantSubdomain: string;
}

// ============ Tenant Types ============
export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  customDomain?: string;
  status: TenantStatus;
  settings: TenantSettings;
  createdAt: string;
}

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'TRIAL';

export interface TenantSettings {
  fiscalYearStart: number;
  defaultCurrency: string;
  timezone: string;
  dateFormat: string;
  numberFormat: string;
}

// ============ Plan Types ============
export interface PlanVersion {
  id: string;
  name: string;
  description?: string;
  status: PlanStatus;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  planType?: 'BUDGET' | 'FORECAST' | 'STRATEGIC' | 'WHAT_IF';
  periodType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  version?: number;
  isLocked?: boolean;
  settings?: Record<string, unknown>;
  // Related entities
  createdById: string;
  createdBy?: User;
  approvedById?: string;
  approvedBy?: User;
  approvedAt?: string;
  // Nested data - always included in detail view
  scenarios?: Scenario[];
  forecasts?: Forecast[];
  assumptions?: Assumption[];
  // Counts
  _count?: {
    forecasts: number;
    scenarios: number;
    assumptions?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type PlanStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LOCKED' | 'ARCHIVED';

export interface CreatePlanRequest {
  name: string;
  description?: string;
  fiscalYear?: number;
  startDate: string;
  endDate: string;
  planType?: 'BUDGET' | 'FORECAST' | 'STRATEGIC' | 'WHAT_IF';
  periodType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  settings?: Record<string, unknown>;
  copyFromId?: string;
}

// ============ Forecast Types ============
export interface Forecast {
  id: string;
  planVersionId?: string;
  scenarioId?: string;
  forecastRunId?: string;
  forecastModel?: ForecastModel;
  periodDate: string;
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  // Dimensions
  productId?: string;
  locationId?: string;
  customerId?: string;
  accountId?: string;
  costCenterId?: string;
  // Forecast values
  forecastQuantity?: number;
  forecastAmount: number;
  currency: string;
  // Confidence & metrics
  confidenceLower?: number;
  confidenceUpper?: number;
  confidenceLevel?: number;
  // Override support
  isOverride?: boolean;
  originalAmount?: number;
  overrideReason?: string;
  overrideAt?: string;
  // Audit
  createdById?: string;
  modifiedById?: string;
  createdAt?: string;
  updatedAt?: string;
  reportingCurrency?: string;
  reportingAmount?: number;
  // Related entities (optional, depends on include)
  planVersion?: { id: string; name: string };
  scenario?: { id: string; name: string };
  product?: { id: string; name: string; code: string };
  location?: { id: string; name: string; code: string };
  customer?: { id: string; name: string; code: string };
  account?: { id: string; name: string; code: string };
  forecastRun?: {
    id: string;
    planVersionId?: string;
    scenarioId?: string;
    forecastModel?: ForecastModel;
    modelVersion?: string;
    status?: string;
    startPeriod?: string;
    endPeriod?: string;
  };
  createdBy?: { id: string; firstName: string; lastName: string; email: string };
}

export type ForecastModel =
  | 'MOVING_AVERAGE'
  | 'WEIGHTED_AVERAGE'
  | 'LINEAR_REGRESSION'
  | 'HOLT_WINTERS'
  | 'SEASONAL_NAIVE'
  | 'YOY_GROWTH'
  | 'TREND_PERCENT'
  | 'AI_HYBRID'
  | 'ARIMA'
  | 'PROPHET'
  | 'MANUAL';

export interface ForecastModelInfo {
  name: ForecastModel;
  displayName: string;
  description: string;
  minDataPoints: number;
  supportsSeasonality: boolean;
}

export interface ForecastRequest {
  planVersionId: string;
  model: ForecastModel;
  periods: number;
  parameters?: Record<string, unknown>;
  filters?: ForecastFilter;
}

export interface ForecastFilter {
  productIds?: string[];
  locationIds?: string[];
  customerIds?: string[];
  accountIds?: string[];
  scenarioId?: string;
}

export interface ForecastResult {
  jobId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress?: number;
  results?: Forecast[];
  error?: string;
}

// ============ Scenario Types ============
export interface Scenario {
  id: string;
  name: string;
  description?: string;
  scenarioType: ScenarioType;
  planVersionId: string;
  planVersion?: {
    id: string;
    name: string;
    version: number;
  };
  isBaseline: boolean;
  color?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  _count?: {
    forecasts: number;
    assumptions: number;
  };
  // Alias for backwards compatibility
  type?: ScenarioType;
  parentId?: string;
}

export type ScenarioType = 'BASE' | 'OPTIMISTIC' | 'PESSIMISTIC' | 'STRETCH' | 'CONSERVATIVE' | 'CUSTOM';

// ============ Dimension Types ============
export interface Product {
  id: string;
  code: string;
  name: string;
  description?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  unitOfMeasure?: string;
  standardCost?: number;
  listPrice?: number;
  /** @deprecated Use standardCost */
  unitCost?: number;
  /** @deprecated Use listPrice */
  unitPrice?: number;
  status?: 'ACTIVE' | 'INACTIVE';
  isActive: boolean;
  attributes?: Record<string, unknown>;
  externalId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Location {
  id: string;
  code: string;
  name: string;
  type: 'STORE' | 'WAREHOUSE' | 'REGION' | 'COUNTRY';
  parentId?: string;
  address?: string;
  isActive: boolean;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  segment?: string;
  region?: string;
  isActive: boolean;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: 'REVENUE' | 'COGS' | 'OPEX' | 'OTHER';
  parentId?: string;
  isActive: boolean;
}

// ============ Actual Data Types ============
export interface Actual {
  id: string;
  productId?: string;
  locationId?: string;
  customerId?: string;
  accountId?: string;
  // Expanded relations from backend
  product?: { id: string; code: string; name: string };
  location?: { id: string; code: string; name: string };
  customer?: { id: string; code: string; name: string };
  account?: { id: string; code: string; name: string };
  // Data fields - support both period and periodDate from backend
  period?: string;
  periodDate?: string;
  value?: number;
  amount?: number;
  quantity?: number;
  source?: string;
  actualType?: string;
  importId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ActualSummary {
  totalRecords: number;
  dateRange: {
    start: string;
    end: string;
  };
  lastUpdated: string;
  bySource?: Record<string, number>;
  byType?: Record<string, { count: number; total: number }>;
}

// ============ Import Types ============
export interface DataImport {
  id: string;
  importType: string; // Backend uses importType, maps from SALES, PRODUCTS, etc.
  type?: ImportType; // Optional frontend-friendly type
  status: ImportStatus;
  fileName: string;
  fileType: string;
  fileSize: number;
  totalRows: number | null;
  processedRows: number | null;
  successRows: number | null;
  errorRows: number | null;
  errors?: ImportError[] | null;
  startedAt: string | null;
  completedAt?: string | null;
  createdAt: string;
}

export type ImportType = 'ACTUALS' | 'PRODUCTS' | 'LOCATIONS' | 'CUSTOMERS' | 'ACCOUNTS';
export type ImportStatus = 'PENDING' | 'VALIDATING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface ImportError {
  row: number;
  column: string;
  value: string;
  message: string;
}

export interface ImportTemplate {
  type: ImportType;
  columns: ImportColumn[];
  sampleData: Record<string, string>[];
}

export interface ImportColumn {
  name: string;
  required: boolean;
  type: 'string' | 'number' | 'date';
  description: string;
  format?: string;
}

// ============ Report Types ============
export interface Report {
  id: string;
  name: string;
  description?: string;
  type: ReportType;
  config: ReportConfig;
  createdById: string;
  isShared: boolean;
  createdAt: string;
}

export type ReportType = 'FORECAST_VS_ACTUAL' | 'VARIANCE' | 'TREND' | 'COMPARISON' | 'CUSTOM';

export interface ReportConfig {
  dimensions: string[];
  measures: string[];
  filters: Record<string, unknown>;
  chartType?: 'line' | 'bar' | 'area' | 'pie';
  dateRange?: {
    start: string;
    end: string;
  };
}

// ============ Dashboard Types ============
export interface DashboardMetrics {
  forecastAccuracy: number;
  totalPlans: number;
  activePlans: number;
  pendingApprovals: number;
  recentActivity: ActivityItem[];
}

export interface ActivityItem {
  id: string;
  type: 'PLAN_CREATED' | 'PLAN_APPROVED' | 'FORECAST_GENERATED' | 'DATA_IMPORTED';
  description: string;
  userId: string;
  userName: string;
  timestamp: string;
}

// ============ Assumption Types ============
export interface Assumption {
  id: string;
  planVersionId: string;
  category: string;
  name: string;
  value: string | number;
  unit?: string;
  description?: string;
  createdById: string;
  createdAt: string;
}

// ============ API Response Types ============
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
  details?: Record<string, string[]>;
}

// ============ Filter & Sort Types ============
export interface QueryParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, unknown>;
}

// ============ Additional Types ============
export type Role = 'admin' | 'planner' | 'finance' | 'viewer';

export type DimensionType = 'product' | 'location' | 'customer' | 'account';

export interface Dimension {
  id: string;
  code: string;
  name: string;
  description?: string;
  parentId?: string;
  attributes?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  name: string;
  description?: string;
  status: PlanStatus;
  startDate: string;
  endDate: string;
  granularity: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  version: number;
  settings?: Record<string, unknown>;
  createdById: string;
  createdBy?: User;
  createdAt: string;
  updatedAt: string;
  _count?: {
    forecasts: number;
    scenarios: number;
  };
}

// ============ Forecast Accuracy Metric Types ============
export interface ForecastAccuracyMetric {
  id: string;
  tenantId: string;
  productId: string;
  locationId?: string;
  periodDate: string;
  forecastQty: number;
  actualQty: number;
  mape?: number;
  bias?: number;
  trackingSignal?: number;
  mad?: number;
  forecastModel?: string;
  forecastVersion?: string;
  granularity: string;
  createdAt: string;
  product?: { id: string; code: string; name: string };
  location?: { id: string; code: string; name: string };
}

// ============ Quality Inspection Types ============
export type QualityInspectionType = 'INCOMING' | 'IN_PROCESS' | 'FINAL' | 'RECEIVING';
export type QualityInspectionStatus = 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'CONDITIONALLY_ACCEPTED';

export interface QualityInspection {
  id: string;
  tenantId: string;
  workOrderId?: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  inspectionNumber: string;
  productId: string;
  locationId?: string;
  inspectionType: QualityInspectionType;
  status: QualityInspectionStatus;
  inspectedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  defectType?: string;
  defectDescription?: string;
  inspectorId?: string;
  inspectionDate: string;
  completedDate?: string;
  notes?: string;
  results?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; code: string; name: string };
  workOrder?: { id: string; woNumber: string };
  purchaseOrder?: { id: string; poNumber: string };
}

// ============ Batch Types ============
export type BatchStatus = 'CREATED' | 'IN_PROCESS' | 'AVAILABLE' | 'QUARANTINE' | 'EXPIRED' | 'CONSUMED' | 'RECALLED';

export interface Batch {
  id: string;
  batchNumber: string;
  productId: string;
  locationId: string;
  quantity: number;
  availableQty: number;
  uom: string;
  status: BatchStatus;
  manufacturingDate?: string;
  expiryDate?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  workOrderId?: string;
  costPerUnit?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; code: string; name: string; unitOfMeasure?: string };
  location?: { id: string; code: string; name: string };
}

// ============ Unit of Measure Master Types ============
export type UomCategory = 'WEIGHT' | 'LENGTH' | 'VOLUME' | 'AREA' | 'COUNT' | 'TIME' | 'TEMPERATURE' | 'ENERGY' | 'PRESSURE' | 'OTHER';

export interface UnitOfMeasure {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  symbol?: string;
  category: UomCategory;
  description?: string;
  decimals: number;
  isBase: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ============ Product Category Master Types ============
export interface ProductCategory {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  parent?: { id: string; code: string; name: string };
  children?: { id: string; code: string; name: string }[];
}

// ============ Unit of Measure Conversion Types ============
export interface UnitOfMeasureConversion {
  id: string;
  tenantId: string;
  fromUom: string;
  toUom: string;
  fromUomId?: string;
  toUomId?: string;
  productId?: string;
  factor: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; code: string; name: string };
  fromUomRef?: { id: string; code: string; name: string; symbol?: string; category: string };
  toUomRef?: { id: string; code: string; name: string; symbol?: string; category: string };
}

// ============ Location Hierarchy Types ============
export interface LocationHierarchy {
  id: string;
  tenantId: string;
  locationId: string;
  parentId?: string;
  level: number;
  hierarchyType: string;
  path?: string;
  createdAt: string;
  updatedAt: string;
  location?: { id: string; code: string; name: string };
  parent?: LocationHierarchy;
  children?: LocationHierarchy[];
}

// ============ Capacity Plan Types ============
export type CapacityPlanType = 'RCCP' | 'CRP' | 'FINITE' | 'INFINITE';

export interface CapacityPlan {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  planType: CapacityPlanType;
  status: string;
  planningHorizon: number;
  granularity: string;
  startDate: string;
  endDate: string;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
  buckets?: CapacityPlanBucket[];
}

export interface CapacityPlanBucket {
  id: string;
  capacityPlanId: string;
  workCenterId: string;
  periodDate: string;
  availableCapacity: number;
  requiredCapacity: number;
  loadPercent: number;
  overloadFlag: boolean;
  notes?: string;
  workCenter?: { id: string; name: string };
}

// ============ S&OP Gap Analysis Types ============
export interface SOPGapAnalysis {
  id: string;
  tenantId: string;
  cycleId: string;
  productId?: string;
  locationId?: string;
  periodDate: string;
  demandQty: number;
  supplyQty: number;
  gapQty: number;
  gapRevenue: number;
  gapCost: number;
  resolution?: string;
  priority?: string;
  assignedTo?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; code: string; name: string };
  cycle?: { id: string; name: string };
}

// ============ Purchase Contract Types ============
export type PurchaseContractType = 'BLANKET' | 'FRAMEWORK' | 'QUANTITY' | 'VALUE';

export interface PurchaseContract {
  id: string;
  tenantId: string;
  contractNumber: string;
  supplierId: string;
  contractType: PurchaseContractType;
  status: string;
  startDate: string;
  endDate: string;
  totalValue?: number;
  consumedValue: number;
  currency: string;
  paymentTerms?: string;
  notes?: string;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
  supplier?: { id: string; code: string; name: string };
  lines?: PurchaseContractLine[];
}

export interface PurchaseContractLine {
  id: string;
  contractId: string;
  productId: string;
  agreedPrice: number;
  agreedQty?: number;
  consumedQty: number;
  minOrderQty?: number;
  leadTimeDays?: number;
  uom?: string;
  product?: { id: string; code: string; name: string };
}

// ============ Product Costing Types ============
export type CostType = 'STANDARD' | 'ACTUAL' | 'BUDGET' | 'PLANNED';

export interface ProductCosting {
  id: string;
  tenantId: string;
  productId: string;
  locationId?: string;
  costType: CostType;
  effectiveFrom: string;
  effectiveTo?: string;
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  subcontractCost: number;
  totalCost: number;
  currency: string;
  version?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; code: string; name: string };
  location?: { id: string; code: string; name: string };
}
