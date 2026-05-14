import { Injectable } from '@nestjs/common';
import { AiReportingBadRequest, AiReportingForbidden } from './ai-reporting.errors';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import {
  CatalogDashboardTemplate,
  CatalogDataset,
  CatalogReportTemplate,
  DynamicSemanticQuery,
  ReportingSecurityContext,
  SemanticClarificationQuery,
  SemanticDashboardQuery,
  SemanticFilter,
  SemanticOutput,
  SemanticQuery,
  SemanticQueryInput,
  SemanticQueryMode,
  SemanticReportQuery,
  SemanticSort,
  SemanticTimeRange,
  SemanticUnsupportedQuery,
  SemanticVisualization,
} from './semantic-query.types';

const VALID_OPERATORS = new Set(['=', '!=', 'IN', 'NOT IN', 'ILIKE', 'BETWEEN', '>=', '<=', '>', '<', 'IS DISTINCT FROM']);
const VALID_QUERY_KINDS = new Set(['single_report', 'dashboard', 'clarification', 'unsupported', 'follow_up', 'explanation']);
const FINANCIAL_DATASETS = new Set(['party_outstanding', 'ledger_entries', 'tax_register']);
const DOMAIN_PERMISSIONS: Record<string, string> = {
  sales: 'reports.sales.view',
  purchase: 'reports.purchase.view',
  inventory: 'reports.inventory.view',
  outstanding: 'reports.outstanding.view',
  accounting: 'reports.accounting.view',
  tax: 'reports.tax.view',
};
const SALES_INVOICE_TO_ITEM_METRICS: Record<string, string> = {
  invoice_net_sales: 'net_sales',
  invoice_gross_sales: 'gross_sales',
  invoice_sales_tax: 'sales_tax',
  sales_invoice_count: 'sales_item_invoice_count',
};
const SALES_INVOICE_TO_ITEM_DIMENSIONS: Record<string, string> = {
  sales_customer: 'sales_item_customer',
  sales_salesman: 'sales_item_salesman',
  sales_invoice: 'sales_item_invoice',
  sales_branch: 'sales_item_branch',
};
const SALES_INVOICE_TO_ITEM_TIME_FIELDS: Record<string, string> = {
  sales_bill_date: 'sales_invoice_date',
};
const SALES_INVOICE_TO_ITEM_DISPLAY_COLUMNS: Record<string, string> = {
  sales_invoice_no: 'sales_item_invoice_no',
  sales_invoice_date: 'sales_item_invoice_date',
  sales_customer_name: 'sales_item_customer_name',
  sales_salesman_name: 'sales_item_salesman_name',
  sales_branch_name: 'sales_item_branch_name',
};

@Injectable()
export class SemanticQueryValidator {
  constructor(private readonly catalog: SemanticCatalogLoader) {}

  validate(input: SemanticQueryInput, security: ReportingSecurityContext): SemanticQuery {
    const normalized = this.normalizeDynamicQuery(input);
    if (normalized) return this.validate(normalized, security);

    if (!input || typeof input !== 'object' || !VALID_QUERY_KINDS.has((input as any).queryKind)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'AI returned an unsupported query kind');
    }
    if (input.queryKind === 'clarification') {
      return {
        queryKind: 'clarification',
        title: input.title ?? 'Clarification required',
        reason: String(input.reason || 'The report request needs clarification'),
        followUpQuestions: Array.isArray(input.followUpQuestions) ? input.followUpQuestions.slice(0, 3).map(String) : [],
        assumptions: Array.isArray(input.assumptions) ? input.assumptions.map(String) : [],
      };
    }
    if (input.queryKind === 'unsupported' || input.queryKind === 'follow_up' || input.queryKind === 'explanation') {
      const raw = input as any;
      return {
        queryKind: 'unsupported',
        title: raw.title ?? 'Unsupported report request',
        reason: String(raw.reason || raw.unsupportedReason || 'The approved AI reporting catalog cannot answer this request'),
        followUpQuestions: Array.isArray(raw.followUpQuestions)
          ? raw.followUpQuestions.slice(0, 3).map(String)
          : [],
        assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
      };
    }
    if (input.queryKind === 'dashboard') {
      return this.validateDashboard(input as SemanticDashboardQuery, security);
    }
    return this.validateReport(input as SemanticReportQuery, security);
  }

  validateReport(input: SemanticReportQuery, security: ReportingSecurityContext, inheritedTimeRange?: SemanticTimeRange): SemanticReportQuery {
    const template = input.templateId ? this.catalog.getTemplate(input.templateId) : undefined;
    const datasetId = input.datasetId || template?.datasetId;
    if (!datasetId) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Semantic query is missing datasetId');
    }

    let normalizedDatasetId = datasetId;
    const baseDataset = this.requireDataset(datasetId);
    const mode = input.mode ?? this.modeFromAnalysisType(input.analysisType ?? template?.analysisType);
    let metrics = this.resolveMetrics(input.metrics, template, baseDataset, mode);
    let dimensions = input.dimensions?.length ? input.dimensions : (template?.defaultDimensions ?? []);
    let displayColumns = this.resolveDisplayColumns(input.displayColumns, template, baseDataset, mode);
    const filters = this.dedupeFilters(
      this.mergeFilters(baseDataset.defaultFilters, template?.defaultFilters, input.filters),
    );
    let sort = input.sort?.length ? input.sort : (template?.defaultSort ?? this.defaultSort(metrics));
    const limit = this.validateLimit(input.limit ?? template?.defaultLimit, template);
    let timeRange = this.validateTimeRange(input.timeRange ?? inheritedTimeRange);

    if (this.requiresSalesItemDataset(normalizedDatasetId, filters)) {
      normalizedDatasetId = 'sales_items';
      metrics = metrics.map((metricId) => SALES_INVOICE_TO_ITEM_METRICS[metricId] ?? metricId);
      dimensions = dimensions.map((dimensionId) => SALES_INVOICE_TO_ITEM_DIMENSIONS[dimensionId] ?? dimensionId);
      displayColumns = displayColumns.map((columnId) => SALES_INVOICE_TO_ITEM_DISPLAY_COLUMNS[columnId] ?? columnId);
      sort = sort.map((item) => ({
        ...item,
        metricId: item.metricId ? (SALES_INVOICE_TO_ITEM_METRICS[item.metricId] ?? item.metricId) : item.metricId,
        dimensionId: item.dimensionId ? (SALES_INVOICE_TO_ITEM_DIMENSIONS[item.dimensionId] ?? item.dimensionId) : item.dimensionId,
        columnId: item.columnId ? (SALES_INVOICE_TO_ITEM_DISPLAY_COLUMNS[item.columnId] ?? item.columnId) : item.columnId,
        fieldId: item.fieldId ? (SALES_INVOICE_TO_ITEM_TIME_FIELDS[item.fieldId] ?? item.fieldId) : item.fieldId,
      }));
      if (timeRange?.fieldId) {
        timeRange = {
          ...timeRange,
          fieldId: SALES_INVOICE_TO_ITEM_TIME_FIELDS[timeRange.fieldId] ?? timeRange.fieldId,
        };
      }
    }

    const dataset = this.requireDataset(normalizedDatasetId);
    this.assertDatasetPermission(dataset, security);

    for (const metricId of metrics) {
      const metric = this.catalog.getMetric(metricId);
      if (!metric || metric.datasetId !== dataset.datasetId) {
        throw new AiReportingBadRequest('MISSING_METRIC', `Metric is not available on dataset ${dataset.datasetId}: ${metricId}`);
      }
    }

    for (const dimensionId of dimensions) {
      const dim = this.catalog.getDimension(dimensionId);
      if (!dim || (dim.datasetId !== dataset.datasetId && dim.datasetId !== '*')) {
        throw new AiReportingBadRequest('MISSING_DIMENSION', `Dimension is not available on dataset ${dataset.datasetId}: ${dimensionId}`);
      }
    }

    displayColumns = displayColumns.filter((columnId) => {
      const column = this.catalog.getDisplayColumn(columnId);
      return column?.datasetId === dataset.datasetId;
    });
    for (const columnId of displayColumns) {
      const column = this.catalog.getDisplayColumn(columnId);
      if (!column || column.datasetId !== dataset.datasetId) {
        throw new AiReportingBadRequest('MISSING_DISPLAY_COLUMN', `Display column is not available on dataset ${dataset.datasetId}: ${columnId}`);
      }
    }
    if (!metrics.length && !dimensions.length && !displayColumns.length) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Semantic query must include metrics, dimensions, or display columns');
    }

    sort = sort.map((item) => this.normalizeSortReference(item, dataset, metrics, dimensions, displayColumns));

    const validatedFilters: SemanticFilter[] = [];
    for (const filter of filters) {
      const coerced = this.validateFilter(filter, dataset);
      if (coerced) validatedFilters.push(coerced);
    }

    for (const item of sort) {
      this.validateSort(item, dataset, metrics, dimensions, displayColumns);
    }

    const visualization = this.resolveVisualization(input.visualization, input.output, mode, dimensions, metrics);

    return {
      queryKind: 'single_report',
      title: this.safeTitle(input.title || template?.displayName || 'AI Report'),
      templateId: template?.templateId ?? input.templateId,
      datasetId: dataset.datasetId,
      domain: dataset.domain as any,
      mode,
      analysisType: input.analysisType ?? template?.analysisType ?? 'grouped_summary',
      metrics,
      dimensions,
      displayColumns,
      filters: validatedFilters,
      timeRange,
      comparison: input.comparison,
      sort,
      limit,
      visualization,
      output: input.output,
      assumptions: Array.isArray(input.assumptions) ? input.assumptions.map(String).slice(0, 10) : [],
      followUpQuestions: Array.isArray(input.followUpQuestions) ? input.followUpQuestions.map(String).slice(0, 3) : [],
    };
  }

  private validateDashboard(input: SemanticDashboardQuery, security: ReportingSecurityContext): SemanticDashboardQuery {
    const dashboard = this.catalog.getDashboard(input.dashboardId);
    if (!dashboard) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Unknown dashboard template: ${input.dashboardId}`);
    }

    const timeRange = this.validateTimeRange(input.timeRange);
    const widgets = input.widgets?.length
      ? input.widgets.map((w) => this.validateReport(w, security, timeRange))
      : this.widgetsFromDashboard(dashboard, security, timeRange);

    return {
      queryKind: 'dashboard',
      title: this.safeTitle(input.title || dashboard.displayName),
      dashboardId: dashboard.dashboardId,
      widgets,
      timeRange,
      assumptions: Array.isArray(input.assumptions) ? input.assumptions.map(String).slice(0, 10) : [],
      followUpQuestions: Array.isArray(input.followUpQuestions) ? input.followUpQuestions.map(String).slice(0, 3) : [],
    };
  }

  private widgetsFromDashboard(dashboard: CatalogDashboardTemplate, security: ReportingSecurityContext, timeRange?: SemanticTimeRange): SemanticReportQuery[] {
    return dashboard.components.map((component) => {
      const template = this.requireTemplate(component.templateId);
      return this.validateReport({
        queryKind: 'single_report',
        title: template.displayName,
        templateId: template.templateId,
        datasetId: template.datasetId,
        mode: this.modeFromAnalysisType(template.analysisType),
        metrics: template.defaultMetrics,
        dimensions: template.defaultDimensions,
        displayColumns: template.defaultDisplayColumns,
        filters: component.filters ?? template.defaultFilters ?? [],
        timeRange,
        sort: template.defaultSort,
        limit: template.defaultLimit,
        visualization: { type: (template.visualization as any) || 'table' },
      }, security, timeRange);
    });
  }

  private requireDataset(datasetId: string): CatalogDataset {
    const dataset = this.catalog.getDataset(datasetId);
    if (!dataset || !dataset.allowedForNlq) {
      throw new AiReportingBadRequest('MISSING_DATASET', `Dataset is not available: ${datasetId}`);
    }
    return dataset;
  }

  private requireTemplate(templateId: string): CatalogReportTemplate {
    const template = this.catalog.getTemplate(templateId);
    if (!template) {
      throw new AiReportingBadRequest('MISSING_DATASET', `Unknown report template: ${templateId}`);
    }
    return template;
  }

  private requiresSalesItemDataset(datasetId: string, filters: SemanticFilter[]): boolean {
    return datasetId === 'sales_invoices' && filters.some((filter) => filter.filterId === 'product_filter');
  }

  private assertDatasetPermission(dataset: CatalogDataset, security: ReportingSecurityContext) {
    const domainPermission = DOMAIN_PERMISSIONS[dataset.domain];
    if (domainPermission && !this.hasPermission(security, domainPermission)) {
      throw new AiReportingForbidden(`AI reports for ${dataset.domain} require ${domainPermission}`);
    }
    if (FINANCIAL_DATASETS.has(dataset.datasetId)) {
      const allowed = ['ADMIN', 'FINANCE', 'PLANNER', 'SUPER_ADMIN'].includes(security.userRole);
      if (!allowed) throw new AiReportingForbidden('Financial AI reports require finance/report permissions');
    }
  }

  private hasPermission(security: ReportingSecurityContext, permission: string): boolean {
    return ['SUPER_ADMIN', 'ADMIN'].includes(security.userRole) || security.permissions.includes(permission);
  }

  private mergeFilters(...groups: Array<SemanticFilter[] | undefined>): SemanticFilter[] {
    return groups.flatMap((g) => g ?? []).slice(0, 20);
  }

  private resolveMetrics(
    inputMetrics: string[] | undefined,
    template: CatalogReportTemplate | undefined,
    dataset: CatalogDataset,
    mode: SemanticQueryMode,
  ): string[] {
    const metrics = inputMetrics && (inputMetrics.length > 0 || this.isDetailMode(mode))
      ? inputMetrics
      : (template?.defaultMetrics?.length ? template.defaultMetrics : (dataset.defaultAggregateMetrics ?? []));
    if (!metrics.length && !this.isDetailMode(mode)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Semantic query must include at least one metric');
    }
    return metrics.slice(0, 8).map(String);
  }

  private resolveDisplayColumns(
    inputColumns: string[] | undefined,
    template: CatalogReportTemplate | undefined,
    dataset: CatalogDataset,
    mode: SemanticQueryMode,
  ): string[] {
    const columns = inputColumns?.length
      ? inputColumns
      : (template?.defaultDisplayColumns?.length ? template.defaultDisplayColumns : (this.isDetailMode(mode) ? dataset.defaultDetailColumns ?? [] : []));
    return columns.slice(0, 30).map(String);
  }

  private validateFilter(filter: SemanticFilter, dataset: CatalogDataset): SemanticFilter | null {
    let operator = String(filter.operator || '').toUpperCase();
    if (!VALID_OPERATORS.has(operator)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Unsupported filter operator: ${filter.operator}`);
    }
    const catalogFilter = filter.filterId ? this.catalog.getFilter(filter.filterId) : undefined;
    if (filter.filterId && !catalogFilter) {
      throw new AiReportingBadRequest('MISSING_FILTER', `Unknown filterId: ${filter.filterId}`);
    }
    if (catalogFilter && !catalogFilter.datasetIds.includes('*') && !catalogFilter.datasetIds.includes(dataset.datasetId)) {
      throw new AiReportingBadRequest('MISSING_FILTER', `Filter is not available on dataset ${dataset.datasetId}: ${filter.filterId}`);
    }
    let value = filter.value;
    if (catalogFilter && !catalogFilter.operators.map((o) => o.toUpperCase()).includes(operator)) {
      const canonical = catalogFilter.operators[0]?.toUpperCase();
      if (!canonical || !VALID_OPERATORS.has(canonical)) {
        throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Operator is not allowed for filter: ${filter.filterId}`);
      }
      operator = canonical;
      if (catalogFilter.defaultValue != null) value = catalogFilter.defaultValue;
    }
    if (!catalogFilter && filter.column && !this.datasetColumns(dataset).has(filter.column)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Filter column is not allowed: ${filter.column}`);
    }
    this.validateValue(value);
    return { ...filter, operator, value };
  }

  private dedupeFilters(filters: SemanticFilter[]): SemanticFilter[] {
    const seen = new Set<string>();
    const result: SemanticFilter[] = [];
    for (const filter of filters) {
      const catalogFilter = filter.filterId ? this.catalog.getFilter(filter.filterId) : undefined;
      const canonicalColumn = filter.column ?? catalogFilter?.column ?? (catalogFilter?.columns && catalogFilter.columns.length === 1 ? catalogFilter.columns[0] : undefined);
      const key = canonicalColumn ?? filter.filterId;
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      result.push(filter);
    }
    return result;
  }

  private validateSort(sort: SemanticSort, dataset: CatalogDataset, metrics: string[], dimensions: string[], displayColumns: string[]) {
    if (!['asc', 'desc'].includes(String(sort.direction).toLowerCase())) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Sort direction must be asc or desc');
    }
    if (sort.metricId && !metrics.includes(sort.metricId)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Sort metric is not selected: ${sort.metricId}`);
    }
    if (sort.dimensionId && !dimensions.includes(sort.dimensionId)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Sort dimension is not selected: ${sort.dimensionId}`);
    }
    if (sort.columnId) {
      const column = this.catalog.getDisplayColumn(sort.columnId);
      if (!column || column.datasetId !== dataset.datasetId || (displayColumns.length && !displayColumns.includes(sort.columnId))) {
        throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Sort display column is not selected: ${sort.columnId}`);
      }
    }
    if (sort.fieldId && !this.catalog.getTimeField(sort.fieldId)) {
      throw new AiReportingBadRequest('MISSING_DATE_FIELD', `Unknown sort field: ${sort.fieldId}`);
    }
    if (sort.column && !this.datasetColumns(dataset).has(sort.column)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Sort column is not allowed: ${sort.column}`);
    }
  }

  private normalizeSortReference(sort: SemanticSort, dataset: CatalogDataset, metrics: string[], dimensions: string[], displayColumns: string[]): SemanticSort {
    if (sort.metricId && !metrics.includes(sort.metricId)) {
      const displayColumn = this.catalog.getDisplayColumn(sort.metricId);
      if (displayColumn?.datasetId === dataset.datasetId) {
        return displayColumns.includes(displayColumn.columnId)
          ? { ...sort, metricId: undefined, columnId: displayColumn.columnId }
          : { ...sort, metricId: undefined, column: displayColumn.column };
      }

      const timeField = this.catalog.getTimeField(sort.metricId);
      if (timeField?.datasetId === dataset.datasetId) {
        return { ...sort, metricId: undefined, fieldId: timeField.fieldId };
      }

      const dimension = this.catalog.getDimension(sort.metricId);
      if (dimension && (dimension.datasetId === dataset.datasetId || dimension.datasetId === '*')) {
        return dimensions.includes(dimension.dimensionId)
          ? { ...sort, metricId: undefined, dimensionId: dimension.dimensionId }
          : { ...sort, metricId: undefined, column: dimension.labelColumn };
      }
    }

    if (sort.dimensionId && !dimensions.includes(sort.dimensionId)) {
      const displayColumn = this.catalog.getDisplayColumn(sort.dimensionId);
      if (displayColumn?.datasetId === dataset.datasetId) {
        return displayColumns.includes(displayColumn.columnId)
          ? { ...sort, dimensionId: undefined, columnId: displayColumn.columnId }
          : { ...sort, dimensionId: undefined, column: displayColumn.column };
      }
    }

    if (sort.columnId && displayColumns.length && !displayColumns.includes(sort.columnId)) {
      const displayColumn = this.catalog.getDisplayColumn(sort.columnId);
      if (displayColumn?.datasetId === dataset.datasetId) {
        return { ...sort, columnId: undefined, column: displayColumn.column };
      }
    }

    return sort;
  }

  private validateLimit(limit: number | undefined, template?: CatalogReportTemplate): number {
    const parsed = Number(limit ?? template?.defaultLimit ?? 100);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Limit must be a positive integer');
    }
    if (parsed > 1000) {
      throw new AiReportingBadRequest('QUERY_TOO_BROAD', 'AI report limit is too large');
    }
    return parsed;
  }

  private validateTimeRange(input?: SemanticTimeRange): SemanticTimeRange {
    if (!input) return { preset: 'current_financial_year' };
    if (input.preset === 'unspecified') {
      return input.fieldId ? { fieldId: input.fieldId, preset: 'unspecified' } : { preset: 'current_financial_year' };
    }
    if (input.preset === 'custom') {
      if (!this.isIsoDate(input.startDate) || !this.isIsoDate(input.endDate)) {
        throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Custom date range requires valid startDate and endDate');
      }
      if (String(input.startDate) > String(input.endDate)) {
        throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Date range startDate cannot be after endDate');
      }
      const start = new Date(`${input.startDate}T00:00:00Z`).getTime();
      const end = new Date(`${input.endDate}T00:00:00Z`).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Custom date range has unparseable dates');
      }
      const spanDays = Math.round((end - start) / 86_400_000) + 1;
      const maxDays = 366 * 3;
      if (spanDays > maxDays) {
        throw new AiReportingBadRequest('QUERY_TOO_BROAD', `Custom date range is too large (max ${maxDays} days)`);
      }
    }
    return input;
  }

  private defaultSort(metrics: string[]): SemanticSort[] {
    return metrics.length ? [{ metricId: metrics[0], direction: 'desc' }] : [];
  }

  private validateValue(value: unknown) {
    if (value == null) return;
    if (Array.isArray(value)) {
      if (value.length > 500) throw new AiReportingBadRequest('QUERY_TOO_BROAD', 'Filter list is too large');
      value.forEach((v) => this.validateValue(v));
      return;
    }
    if (typeof value === 'object') {
      const relative = (value as any).relativeDate;
      if (typeof relative === 'string' && /^[a-z0-9_]+$/i.test(relative)) return;
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Filter values must be scalar, arrays, or approved relative date tokens');
    }
    const text = String(value);
    if (text.length > 300 || /(;|--|\/\*|\*\/|\b(select|insert|update|delete|drop|alter|create|grant|revoke|copy|vacuum|analyze|refresh)\b)/i.test(text)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Filter value was rejected by safety validation');
    }
  }

  private datasetColumns(dataset: CatalogDataset): Set<string> {
    const columns = new Set<string>(['tenant_id', 'company_id', 'branch_id', 'warehouse_id']);
    for (const metric of this.catalog.getCatalog().metrics.filter((m) => m.datasetId === dataset.datasetId)) {
      const matches = metric.expression.match(/\b[a-z][a-z0-9_]*\b/gi) ?? [];
      matches.filter((m) => !['SUM', 'COUNT', 'DISTINCT'].includes(m.toUpperCase())).forEach((m) => columns.add(m));
    }
    for (const dim of this.catalog.getCatalog().dimensions.filter((d) => d.datasetId === dataset.datasetId)) {
      dim.columns.forEach((c) => columns.add(c));
    }
    for (const tf of this.catalog.getCatalog().timeFields.filter((t) => t.datasetId === dataset.datasetId)) {
      columns.add(tf.column);
    }
    for (const filter of this.catalog.getCatalog().filters.filter((f) => f.datasetIds.includes(dataset.datasetId) || f.datasetIds.includes('*'))) {
      if (filter.column) columns.add(filter.column);
      filter.columns?.forEach((c) => columns.add(c));
    }
    for (const displayColumn of this.catalog.getCatalog().displayColumns.filter((c) => c.datasetId === dataset.datasetId)) {
      columns.add(displayColumn.column);
    }
    dataset.dateFields?.forEach((d) => columns.add(d.column));
    dataset.defaultFilters?.forEach((filter) => {
      if (filter.column) columns.add(filter.column);
    });
    return columns;
  }

  private normalizeDynamicQuery(input: SemanticQueryInput): SemanticReportQuery | SemanticClarificationQuery | SemanticUnsupportedQuery | null {
    if (!input || typeof input !== 'object' || !('status' in input)) return null;
    const raw = input as DynamicSemanticQuery;
    if (raw.status === 'clarification_required') {
      return {
        queryKind: 'clarification',
        title: 'Clarification required',
        reason: String(raw.clarifyingQuestion || 'The report request needs clarification'),
        followUpQuestions: raw.clarifyingQuestion ? [raw.clarifyingQuestion] : [],
        assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
      };
    }
    if (raw.status === 'unsupported') {
      return {
        queryKind: 'unsupported',
        title: 'Unsupported report request',
        reason: String(raw.unsupportedReason || 'The approved AI reporting catalog cannot answer this request'),
        followUpQuestions: [],
        assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
      };
    }
    if (raw.status !== 'ok') {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'AI returned an unsupported semantic status');
    }
    if (raw.queryKind !== 'single_report') return null;
    return {
      queryKind: 'single_report',
      title: 'AI Report',
      datasetId: String(raw.datasetId ?? ''),
      domain: raw.domain,
      mode: raw.mode,
      metrics: Array.isArray(raw.metrics) ? raw.metrics.map((m) => String((m as any).metricId ?? '')).filter(Boolean) : [],
      dimensions: Array.isArray(raw.dimensions) ? raw.dimensions.map((d) => String((d as any).dimensionId ?? '')).filter(Boolean) : [],
      displayColumns: Array.isArray(raw.displayColumns) ? raw.displayColumns.map((c) => String((c as any).columnId ?? '')).filter(Boolean) : [],
      filters: this.normalizeDynamicFilters(raw.filters),
      timeRange: this.normalizeDynamicTime(raw.time),
      comparison: raw.comparison,
      sort: Array.isArray(raw.sort)
        ? raw.sort.map((item) => ({
            metricId: item.byMetricId ?? undefined,
            dimensionId: item.byDimensionId ?? undefined,
            columnId: item.byColumnId ?? undefined,
            direction: item.direction === 'asc' ? 'asc' : 'desc',
          }))
        : [],
      limit: raw.limit,
      output: raw.output,
      visualization: this.visualizationFromOutput(raw.output),
      assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
      followUpQuestions: [],
    };
  }

  private normalizeDynamicFilters(filters: DynamicSemanticQuery['filters']): SemanticFilter[] {
    if (!Array.isArray(filters)) return [];
    return filters.slice(0, 20).map((filter) => {
      const operator = String(filter.operator ?? '').toLowerCase();
      const value = filter.value && typeof filter.value === 'object' && !Array.isArray(filter.value) && ('from' in filter.value || 'to' in filter.value)
        ? [(filter.value as any).from, (filter.value as any).to].filter((item) => item != null)
        : filter.value;
      return {
        filterId: filter.filterId,
        operator: operator === 'contains'
          ? 'ILIKE'
          : operator === 'in'
            ? 'IN'
            : operator === 'not_in'
              ? 'NOT IN'
              : operator.toUpperCase(),
        value,
      };
    });
  }

  private normalizeDynamicTime(time: DynamicSemanticQuery['time'] | undefined): SemanticTimeRange | undefined {
    if (!time) return undefined;
    return {
      preset: time.rangeType,
      startDate: time.startDate ?? undefined,
      endDate: time.endDate ?? undefined,
      fieldId: time.dateFieldId ?? undefined,
    };
  }

  private modeFromAnalysisType(analysisType?: string): SemanticQueryMode {
    if (analysisType === 'ranking') return 'ranking';
    if (analysisType === 'detail' || analysisType === 'exception_list' || analysisType === 'ledger_detail') return 'detail';
    if (analysisType === 'accounting_summary' || analysisType === 'grouped_summary') return 'aggregate';
    return 'aggregate';
  }

  private isDetailMode(mode: SemanticQueryMode): boolean {
    return mode === 'detail';
  }

  private resolveVisualization(
    visualization: SemanticVisualization | undefined,
    output: SemanticOutput | undefined,
    mode: SemanticQueryMode,
    dimensions: string[],
    metrics: string[],
  ): SemanticVisualization {
    if (output) return this.visualizationFromOutput(output, dimensions[0], metrics[0]);
    if (visualization) return visualization;
    if (mode === 'trend') return { type: 'line' };
    if (mode === 'ranking') return { type: 'bar' };
    if (mode === 'kpi') return { type: 'kpi' };
    return { type: 'table' };
  }

  private visualizationFromOutput(output: SemanticOutput | undefined, x?: string, y?: string): SemanticVisualization {
    if (!output) return { type: 'table' };
    if (!output.showChart || output.chartType === 'none') return { type: 'table' };
    return {
      type: output.chartType,
      x: output.xField ?? x,
      y: output.yField ?? y,
    };
  }

  private safeTitle(title: string): string {
    return title.replace(/[^\w\s.,:/()-]/g, '').trim().slice(0, 120) || 'AI Report';
  }

  private isIsoDate(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }
}
