export type AiReportQueryKind = 'single_report' | 'dashboard' | 'follow_up' | 'explanation' | 'clarification' | 'unsupported';
export type AiReportAnalysisType =
  | 'ranking'
  | 'grouped_summary'
  | 'detail'
  | 'exception_list'
  | 'ledger_detail'
  | 'accounting_summary';
export type SemanticQueryStatus = 'ok' | 'clarification_required' | 'unsupported';
export type SemanticQueryMode = 'aggregate' | 'detail' | 'ranking' | 'trend' | 'comparison' | 'dashboard' | 'kpi';
export type SemanticQueryDomain = 'sales' | 'purchase' | 'inventory' | 'accounting' | 'outstanding' | 'tax' | 'mixed';
export type SemanticOutputChartType = 'bar' | 'line' | 'pie' | 'kpi' | 'none';

export interface CatalogDataset {
  datasetId: string;
  viewName: string;
  domain: string;
  grain: string;
  description: string;
  allowedForNlq: boolean;
  requiredSecurityFilters: string[];
  defaultFilters?: SemanticFilter[];
  dateFields?: Array<{ fieldId: string; column: string; default?: boolean }>;
  displayColumns?: string[];
  defaultDetailColumns?: string[];
  defaultAggregateMetrics?: string[];
  synonyms?: string[];
  sensitiveColumns?: string[];
  supportedReportIds?: string[];
}

export interface CatalogMetric {
  metricId: string;
  displayName: string;
  datasetId: string;
  expression: string;
  aggregation: string;
  dataType: string;
  synonyms?: string[];
  defaultSortDirection?: 'asc' | 'desc';
  businessRules?: string[];
}

export interface CatalogDimension {
  dimensionId: string;
  displayName: string;
  datasetId: string;
  columns: string[];
  transform?: 'calendar_month';
  labelColumn: string;
  fallbackLabelColumn?: string;
  synonyms?: string[];
}

export interface CatalogFilter {
  filterId: string;
  displayName: string;
  datasetIds: string[];
  column?: string;
  columns?: string[];
  operators: string[];
  allowedValues?: unknown[];
  required?: boolean;
  requiredWhenAvailable?: boolean;
  requiredWhenScoped?: boolean;
  securityFilter?: boolean;
  valueSource?: string;
  defaultValue?: unknown;
}

export interface CatalogTimeField {
  fieldId: string;
  datasetId: string;
  column: string;
  default?: boolean;
  synonyms?: string[];
}

export interface CatalogDisplayColumn {
  columnId: string;
  datasetId: string;
  column: string;
  label: string;
  dataType: string;
  defaultForDetail: boolean;
  synonyms?: string[];
  sensitive?: boolean;
}

export interface CatalogReportTemplate {
  templateId: string;
  displayName: string;
  datasetId: string;
  analysisType: AiReportAnalysisType;
  defaultMetrics: string[];
  defaultDimensions: string[];
  defaultDisplayColumns?: string[];
  defaultFilters?: SemanticFilter[];
  defaultSort?: SemanticSort[];
  defaultLimit?: number;
  visualization?: string;
  synonyms?: string[];
  sourceReportIds?: string[];
}

export interface CatalogDashboardTemplate {
  dashboardId: string;
  displayName: string;
  description?: string;
  components: Array<{ templateId: string; position: string; filters?: SemanticFilter[] }>;
  synonyms?: string[];
  sourceReportIds?: string[];
}

export interface SemanticCatalog {
  catalogVersion: string;
  datasets: CatalogDataset[];
  metrics: CatalogMetric[];
  dimensions: CatalogDimension[];
  filters: CatalogFilter[];
  timeFields: CatalogTimeField[];
  displayColumns: CatalogDisplayColumn[];
  synonyms: unknown[];
  defaultAssumptions: Array<{ assumptionId: string; description: string; implementation?: string }>;
  reportTemplates: CatalogReportTemplate[];
  dashboardTemplates: CatalogDashboardTemplate[];
  securityRules: unknown[];
  disallowedOperations: unknown[];
}

export interface SemanticFilter {
  filterId?: string;
  column?: string;
  operator: string;
  value?: unknown;
}

export interface SemanticSort {
  metricId?: string;
  dimensionId?: string;
  columnId?: string;
  fieldId?: string;
  column?: string;
  direction: 'asc' | 'desc';
}

export interface SemanticTimeRange {
  preset?: 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'current_financial_year' | 'last_financial_year' | 'custom' | 'unspecified';
  startDate?: string;
  endDate?: string;
  fieldId?: string;
}

export interface SemanticVisualization {
  type: 'table' | 'bar' | 'line' | 'pie' | 'kpi' | 'none';
  x?: string;
  y?: string;
}

export interface SemanticComparison {
  enabled: boolean;
  type: 'previous_period' | 'previous_year' | 'custom' | 'none';
  startDate: string | null;
  endDate: string | null;
  /**
   * Result shape:
   *  - 'current' (default): legacy side-by-side listing — the same query run
   *    for both periods, stacked with a comparison_period label.
   *  - 'change': rank rows BY THE DELTA between the periods (current −
   *    previous per dimension value, with change/change_pct columns) — e.g.
   *    "top 10 items whose sales decreased compared to previous month".
   */
  rankBy?: 'current' | 'change';
}

export interface SemanticOutput {
  showGrid: boolean;
  showChart: boolean;
  chartType: SemanticOutputChartType;
  xField?: string | null;
  yField?: string | null;
}

export interface SemanticReportQuery {
  queryKind: 'single_report';
  title: string;
  datasetId: string;
  templateId?: string;
  domain?: SemanticQueryDomain;
  mode?: SemanticQueryMode;
  analysisType?: AiReportAnalysisType;
  metrics: string[];
  dimensions: string[];
  displayColumns?: string[];
  filters?: SemanticFilter[];
  timeRange?: SemanticTimeRange;
  comparison?: SemanticComparison;
  sort?: SemanticSort[];
  limit?: number;
  visualization?: SemanticVisualization;
  output?: SemanticOutput;
  assumptions?: string[];
  followUpQuestions?: string[];
}

export interface SemanticDashboardQuery {
  queryKind: 'dashboard';
  title: string;
  dashboardId: string;
  widgets?: SemanticReportQuery[];
  timeRange?: SemanticTimeRange;
  assumptions?: string[];
  followUpQuestions?: string[];
}

export interface SemanticClarificationQuery {
  queryKind: 'clarification';
  title?: string;
  reason: string;
  followUpQuestions: string[];
  assumptions?: string[];
}

export interface SemanticUnsupportedQuery {
  queryKind: 'unsupported';
  title?: string;
  reason: string;
  followUpQuestions: string[];
  assumptions?: string[];
  errorCode?: string;
  missingCapabilities?: string[];
  availableAlternatives?: string[];
  recommendedSchemaFix?: string | null;
  unsupportedReason?: string;
}

export interface DynamicSemanticQuery {
  status: SemanticQueryStatus;
  queryKind: 'single_report' | 'dashboard' | 'follow_up' | 'explanation';
  mode: SemanticQueryMode;
  domain: SemanticQueryDomain;
  datasetId: string | null;
  metrics: Array<{ metricId: string; alias?: string | null }>;
  dimensions: Array<{ dimensionId: string }>;
  displayColumns: Array<{ columnId: string }>;
  filters: Array<{
    filterId: string;
    operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in' | 'contains' | 'between';
    value: string | number | boolean | string[] | number[] | { from?: string | number; to?: string | number };
  }>;
  time: {
    dateFieldId: string | null;
    rangeType:
      | 'today'
      | 'yesterday'
      | 'this_week'
      | 'last_week'
      | 'this_month'
      | 'last_month'
      | 'this_quarter'
      | 'last_quarter'
      | 'current_financial_year'
      | 'last_financial_year'
      | 'custom'
      | 'unspecified';
    startDate: string | null;
    endDate: string | null;
  };
  comparison?: SemanticComparison;
  sort: Array<{
    byMetricId?: string | null;
    byDimensionId?: string | null;
    byColumnId?: string | null;
    direction: 'asc' | 'desc';
  }>;
  limit: number;
  output: SemanticOutput;
  assumptions: string[];
  clarifyingQuestion: string | null;
  unsupportedReason: string | null;
  errorCode?: string | null;
  missingCapabilities?: string[];
  availableAlternatives?: string[];
  recommendedSchemaFix?: string | null;
}

export type SemanticQuery =
  | SemanticReportQuery
  | SemanticDashboardQuery
  | SemanticClarificationQuery
  | SemanticUnsupportedQuery;

export type SemanticQueryInput = SemanticQuery | DynamicSemanticQuery;

export interface ReportingSecurityContext {
  tenantId: string;
  userId: string;
  userRole: string;
  permissions: string[];
  requestedCompanyId?: number;
  requestedBranchIds?: string[];
  allowedCompanyIds: number[];
  allowedBranchIds: string[];
  hasExplicitCompanyScope: boolean;
  hasExplicitBranchScope: boolean;
  fiscalYear?: { startDate: string; endDate: string; fiscalYear?: string };
}

export interface CompiledSql {
  sql: string;
  params: unknown[];
  datasetId: string;
  viewName: string;
  expectsRowsLimit: boolean;
  appliedSecurityFilters: string[];
  selectedColumns: string[];
  selectedColumnMetadata?: Array<{ key: string; label: string; dataType?: string }>;
}

export interface ExecutedReportResult {
  columns: Array<{ key: string; label: string; dataType?: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}
