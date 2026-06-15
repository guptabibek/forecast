import { Injectable } from '@nestjs/common';
import { AiReportingBadRequest, AiReportingForbidden } from './ai-reporting.errors';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import {
  CatalogDataset,
  CatalogDimension,
  CatalogDisplayColumn,
  CatalogFilter,
  CompiledSql,
  ReportingSecurityContext,
  SemanticFilter,
  SemanticReportQuery,
  SemanticSort,
  SemanticTimeRange,
} from './semantic-query.types';

const DATE_FILTER_DATASETS = new Set([
  'sales_items',
  'sales_invoices',
  'purchase_items',
  'purchase_invoices',
  // Net-of-returns rollups carry invoice_date and are the canonical targets
  // for period comparisons and change rankings.
  'sales_net',
  'purchase_net',
  'sales_returns',
  'purchase_returns',
  'stock_ledger',
  'tax_register',
  'ledger_entries',
]);
const UUID_FILTER_COLUMNS = new Set([
  'tenant_id',
  'branch_id',
  'warehouse_id',
  'location_id',
  'product_id',
  'customer_id',
  'supplier_id',
  'batch_id',
  'account_id',
  'cost_center_id',
  'journal_entry_id',
  'created_by_id',
  'purchase_order_id',
  'work_order_id',
  'source_voucher_id',
  'source_transaction_id',
  'source_outstanding_id',
  'source_entry_id',
  'source_line_id',
]);

@Injectable()
export class SqlCompilerService {
  constructor(private readonly catalog: SemanticCatalogLoader) {}

  compile(query: SemanticReportQuery, security: ReportingSecurityContext): CompiledSql {
    const dataset = this.required(this.catalog.getDataset(query.datasetId), `Unknown dataset ${query.datasetId}`);
    if (query.comparison?.enabled) {
      if (query.comparison.rankBy === 'change' && query.dimensions?.length && query.metrics?.length) {
        return this.compileChangeRanking(query, dataset, security);
      }
      return this.compileComparison(query, dataset, security);
    }
    const select: string[] = [];
    const groupBy: string[] = [];
    const selectedColumns: string[] = [];
    const selectedColumnMetadata: Array<{ key: string; label: string; dataType?: string }> = [];
    const params: unknown[] = [];
    const where: string[] = [];
    const appliedSecurityFilters: string[] = [];

    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const addSelectedColumn = (key: string, label?: string, dataType?: string) => {
      if (!selectedColumns.includes(key)) selectedColumns.push(key);
      if (!selectedColumnMetadata.some((column) => column.key === key)) {
        selectedColumnMetadata.push({ key, label: label ?? this.toLabel(key), dataType });
      }
    };

    this.addSecurityFilters(dataset, query, security, where, params, appliedSecurityFilters);
    this.addDefaultAndSemanticFilters(dataset, query.filters ?? [], where, addParam);
    this.addDateFilter(dataset, query.timeRange, security, where, addParam);

    for (const dimensionId of query.dimensions) {
      const dimension = this.required(this.catalog.getDimension(dimensionId), `Unknown dimension ${dimensionId}`);
      const compiled = this.compileDimension(dimension, dataset);
      for (const item of compiled.select) {
        if (!select.includes(item)) select.push(item);
      }
      for (const item of compiled.groupBy) {
        if (!groupBy.includes(item)) groupBy.push(item);
      }
      for (const alias of compiled.aliases) addSelectedColumn(alias.key, alias.label, alias.dataType);
    }

    const hasMetrics = query.metrics.length > 0;
    for (const columnId of query.displayColumns ?? []) {
      const displayColumn = this.required(this.catalog.getDisplayColumn(columnId), `Unknown display column ${columnId}`);
      const compiled = this.compileDisplayColumn(displayColumn, dataset, hasMetrics || groupBy.length > 0);
      if (!selectedColumns.includes(compiled.alias)) {
        select.push(compiled.select);
        if (compiled.groupBy && !groupBy.includes(compiled.groupBy)) groupBy.push(compiled.groupBy);
      }
      addSelectedColumn(compiled.alias, displayColumn.label, displayColumn.dataType);
    }

    for (const metricId of query.metrics) {
      const metric = this.required(this.catalog.getMetric(metricId), `Unknown metric ${metricId}`);
      // A display column already selected under this alias (e.g. raw tax_amount
      // alongside the SUM(tax_amount) metric) would create two output columns
      // with the same name and make ORDER BY <alias> ambiguous (42702). Keep the
      // first-selected column and skip the duplicate projection.
      if (!selectedColumns.includes(metric.metricId)) {
        select.push(`${metric.expression} AS ${this.ident(metric.metricId)}`);
      }
      addSelectedColumn(metric.metricId, metric.displayName, metric.dataType);
    }

    if (!select.length) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Compiled report has no selected columns');
    }

    const sqlParts = [
      `SELECT ${select.join(', ')}`,
      `FROM ${this.ident(dataset.viewName)}`,
      where.length ? `WHERE ${where.join(' AND ')}` : '',
      groupBy.length ? `GROUP BY ${groupBy.join(', ')}` : '',
      this.compileOrderBy(query.sort ?? [], query, dataset, groupBy),
      `LIMIT ${addParam(query.limit ?? 100)}`,
    ].filter(Boolean);

    return {
      sql: sqlParts.join(' '),
      params,
      datasetId: dataset.datasetId,
      viewName: dataset.viewName,
      expectsRowsLimit: true,
      appliedSecurityFilters,
      selectedColumns,
      selectedColumnMetadata,
    };
  }

  private compileComparison(query: SemanticReportQuery, dataset: CatalogDataset, security: ReportingSecurityContext): CompiledSql {
    if (!DATE_FILTER_DATASETS.has(dataset.datasetId)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Comparison reports require a dataset date field');
    }
    const currentRange = this.resolveDateRange(query.timeRange, security);
    if (!currentRange) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Comparison reports require a current date range');
    }
    const comparisonRange = this.resolveComparisonRange(currentRange, query.comparison);
    const current = this.compile({
      ...query,
      comparison: { enabled: false, type: 'none', startDate: null, endDate: null },
      timeRange: { ...query.timeRange, preset: 'custom', startDate: currentRange.startDate, endDate: currentRange.endDate },
    }, security);
    const previous = this.compile({
      ...query,
      comparison: { enabled: false, type: 'none', startDate: null, endDate: null },
      timeRange: { ...query.timeRange, preset: 'custom', startDate: comparisonRange.startDate, endDate: comparisonRange.endDate },
    }, security);
    const offsetPreviousSql = previous.sql.replace(/\$(\d+)/g, (_match, index) => `$${Number(index) + current.params.length}`);
    const sql = [
      `SELECT 'current' AS comparison_period, current_result.* FROM (${current.sql}) current_result`,
      'UNION ALL',
      `SELECT 'comparison' AS comparison_period, comparison_result.* FROM (${offsetPreviousSql}) comparison_result`,
    ].join(' ');

    return {
      sql,
      params: [...current.params, ...previous.params],
      datasetId: dataset.datasetId,
      viewName: dataset.viewName,
      expectsRowsLimit: true,
      appliedSecurityFilters: [...new Set([...current.appliedSecurityFilters, ...previous.appliedSecurityFilters])],
      selectedColumns: ['comparison_period', ...current.selectedColumns],
      selectedColumnMetadata: [
        { key: 'comparison_period', label: 'Comparison Period', dataType: 'string' },
        ...(current.selectedColumnMetadata ?? []),
      ],
    };
  }

  /**
   * Rank dimension values by their CHANGE between the current and previous
   * period ("top 10 items whose sales decreased vs previous month"). Both
   * periods are aggregated per dimension value, FULL OUTER JOINed (so items
   * that vanished or are new still rank), and ordered by the signed delta of
   * the primary metric — ascending = biggest decreases first. Adds `change`
   * (metric units) and `change_pct` columns.
   */
  private compileChangeRanking(query: SemanticReportQuery, dataset: CatalogDataset, security: ReportingSecurityContext): CompiledSql {
    if (!DATE_FILTER_DATASETS.has(dataset.datasetId)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Change-ranking reports require a dataset date field');
    }
    const currentRange = this.resolveDateRange(query.timeRange, security);
    if (!currentRange) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Change-ranking reports require a current date range');
    }
    const comparisonRange = this.resolveComparisonRange(currentRange, query.comparison);

    // Per-period aggregation must cover EVERY dimension value (ranking is on
    // the join), so the user's limit applies only to the final ranked output.
    const INNER_GROUP_LIMIT = 50000;
    const innerQuery = (range: { startDate: string; endDate: string }): SemanticReportQuery => ({
      ...query,
      comparison: { enabled: false, type: 'none', startDate: null, endDate: null },
      displayColumns: [],
      sort: undefined,
      limit: INNER_GROUP_LIMIT,
      output: undefined,
      timeRange: { ...query.timeRange, preset: 'custom', startDate: range.startDate, endDate: range.endDate },
    });
    const current = this.compile(innerQuery(currentRange), security);
    const previous = this.compile(innerQuery(comparisonRange), security);
    const offsetPreviousSql = previous.sql.replace(/\$(\d+)/g, (_match, index) => `$${Number(index) + current.params.length}`);

    const metricIds = query.metrics;
    const keyColumns = current.selectedColumns.filter((column) => !metricIds.includes(column));
    if (!keyColumns.length) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Change-ranking reports require a grouping dimension');
    }
    const primary = metricIds[0];
    const primaryMetric = this.catalog.getMetric(primary);
    const metaByKey = new Map((current.selectedColumnMetadata ?? []).map((column) => [column.key, column]));

    // NULL-safe join: dimension columns can legitimately be NULL (unmapped
    // ids). Spelled as a COALESCE equality because (a) the SQL safety
    // validator reads "IS NOT DISTINCT FROM prev" as a table reference and
    // (b) Postgres FULL JOIN requires hash-joinable conditions — OR-based
    // null checks are rejected with 0A000.
    const NULL_SENTINEL = `'__null__'`;
    const joinCondition = keyColumns
      .map((column) =>
        `COALESCE(cur.${this.ident(column)}::text, ${NULL_SENTINEL}) = COALESCE(prev.${this.ident(column)}::text, ${NULL_SENTINEL})`)
      .join(' AND ');
    const selectKeys = keyColumns.map((column) => `COALESCE(cur.${this.ident(column)}, prev.${this.ident(column)}) AS ${this.ident(column)}`);
    const selectMetrics = metricIds.flatMap((metricId) => [
      `COALESCE(cur.${this.ident(metricId)}, 0) AS ${this.ident(metricId)}`,
      `COALESCE(prev.${this.ident(metricId)}, 0) AS ${this.ident(`previous_${metricId}`)}`,
    ]);
    const changeExpr = `(COALESCE(cur.${this.ident(primary)}, 0) - COALESCE(prev.${this.ident(primary)}, 0))`;
    const direction = String(query.sort?.[0]?.direction ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const params = [...current.params, ...previous.params];
    const sql = [
      `SELECT ${[...selectKeys, ...selectMetrics].join(', ')},`,
      `${changeExpr} AS change,`,
      `CASE WHEN COALESCE(prev.${this.ident(primary)}, 0) <> 0 THEN (${changeExpr} / ABS(prev.${this.ident(primary)}) * 100)::float8 END AS change_pct`,
      `FROM (${current.sql}) cur`,
      `FULL OUTER JOIN (${offsetPreviousSql}) prev ON ${joinCondition}`,
      `ORDER BY change ${direction}, ${this.ident(keyColumns[0])}`,
      `LIMIT $${params.length + 1}`,
    ].join(' ');
    params.push(query.limit ?? 10);

    const metricLabel = primaryMetric?.displayName ?? this.toLabel(primary);
    return {
      sql,
      params,
      datasetId: dataset.datasetId,
      viewName: dataset.viewName,
      expectsRowsLimit: true,
      appliedSecurityFilters: [...new Set([...current.appliedSecurityFilters, ...previous.appliedSecurityFilters])],
      selectedColumns: [...keyColumns, ...metricIds.flatMap((metricId) => [metricId, `previous_${metricId}`]), 'change', 'change_pct'],
      selectedColumnMetadata: [
        ...keyColumns.map((column) => metaByKey.get(column) ?? { key: column, label: this.toLabel(column) }),
        ...metricIds.flatMap((metricId) => {
          const metric = this.catalog.getMetric(metricId);
          const label = metric?.displayName ?? this.toLabel(metricId);
          return [
            { key: metricId, label: `${label} (Current)`, dataType: metric?.dataType },
            { key: `previous_${metricId}`, label: `${label} (Previous)`, dataType: metric?.dataType },
          ];
        }),
        { key: 'change', label: `Change in ${metricLabel}`, dataType: primaryMetric?.dataType ?? 'number' },
        { key: 'change_pct', label: 'Change %', dataType: 'percentage' },
      ],
    };
  }

  private addSecurityFilters(
    dataset: CatalogDataset,
    query: SemanticReportQuery,
    security: ReportingSecurityContext,
    where: string[],
    params: unknown[],
    applied: string[],
  ) {
    params.push(security.tenantId);
    where.push(`tenant_id = $${params.length}::uuid`);
    applied.push('tenant_id');

    const requiresCompany = dataset.requiredSecurityFilters.includes('company_id');
    const coreGlOnly = dataset.datasetId === 'ledger_entries'
      && (query.filters ?? []).some((f) => f.column === 'ledger_source' && f.operator === '=' && f.value === 'CORE_GL');
    if (requiresCompany && !coreGlOnly) {
      const companyIds = this.intersectCompany(security);
      if (!companyIds.length) throw new AiReportingForbidden('No allowed company is available for this report');
      params.push(companyIds);
      where.push(`company_id = ANY($${params.length}::int[])`);
      applied.push('company_id');
    }

    const branchColumn = dataset.requiredSecurityFilters.includes('warehouse_id') ? 'warehouse_id' : 'branch_id';
    const requiresBranch = dataset.requiredSecurityFilters.includes('branch_id') || dataset.requiredSecurityFilters.includes('warehouse_id');
    const branchIds = this.intersectBranches(security);
    if (requiresBranch && branchIds.length) {
      params.push(branchIds);
      where.push(`${branchColumn} = ANY($${params.length}::uuid[])`);
      applied.push(branchColumn);
    }
    if (requiresBranch && !branchIds.length) {
      throw new AiReportingForbidden('No allowed branch is available for this report');
    }
  }

  private addDefaultAndSemanticFilters(
    dataset: CatalogDataset,
    filters: SemanticFilter[],
    where: string[],
    addParam: (value: unknown) => string,
  ) {
    for (const filter of filters) {
      const compiled = this.compileFilter(dataset, filter, addParam);
      if (compiled) where.push(compiled);
    }
  }

  private addDateFilter(
    dataset: CatalogDataset,
    timeRange: SemanticTimeRange | undefined,
    security: ReportingSecurityContext,
    where: string[],
    addParam: (value: unknown) => string,
  ) {
    if (!this.shouldApplyDateFilter(dataset, timeRange)) return;
    const dateColumn = this.defaultDateColumn(dataset, timeRange?.fieldId);
    if (!dateColumn) return;
    const range = this.resolveDateRange(timeRange, security);
    if (!range) return;
    where.push(`${this.ident(dateColumn)} BETWEEN ${addParam(range.startDate)}::date AND ${addParam(range.endDate)}::date`);
  }

  private compileDimension(dimension: CatalogDimension, dataset: CatalogDataset): { select: string[]; groupBy: string[]; aliases: Array<{ key: string; label: string; dataType?: string }> } {
    if (dimension.transform === 'calendar_month') {
      const dateColumn = this.defaultDateColumn(dataset);
      if (!dateColumn) throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Month dimension requires a dataset date field');
      const expr = `date_trunc('month', ${this.ident(dateColumn)})::date`;
      return { select: [`${expr} AS month`], groupBy: [expr], aliases: [{ key: 'month', label: 'Month', dataType: 'date' }] };
    }
    if (dimension.columns.includes('default_time_field')) {
      const dateColumn = this.defaultDateColumn(dataset);
      if (!dateColumn) throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Date dimension requires a dataset date field');
      return {
        select: [`${this.ident(dateColumn)}::date AS date`],
        groupBy: [`${this.ident(dateColumn)}::date`],
        aliases: [{ key: 'date', label: 'Date', dataType: 'date' }],
      };
    }

    const select: string[] = [];
    const groupBy: string[] = [];
    const aliases: Array<{ key: string; label: string; dataType?: string }> = [];
    for (const column of dimension.columns) {
      if (!this.isColumnAllowedForDataset(dataset, column)) continue;
      select.push(`${this.ident(column)} AS ${this.ident(column)}`);
      groupBy.push(this.ident(column));
      aliases.push({ key: column, label: column === dimension.labelColumn ? dimension.displayName : this.toLabel(column) });
    }
    if (!select.length) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Dimension has no allowed columns: ${dimension.dimensionId}`);
    }
    return { select, groupBy, aliases };
  }

  private compileDisplayColumn(displayColumn: CatalogDisplayColumn, dataset: CatalogDataset, grouped: boolean): { select: string; groupBy?: string; alias: string } {
    if (displayColumn.datasetId !== dataset.datasetId || !this.isColumnAllowedForDataset(dataset, displayColumn.column)) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', `Display column is not allowed for dataset: ${displayColumn.columnId}`);
    }
    const column = this.ident(displayColumn.column);
    const alias = this.ident(displayColumn.column);
    return {
      select: `${column} AS ${alias}`,
      groupBy: grouped ? column : undefined,
      alias,
    };
  }

  private compileFilter(dataset: CatalogDataset, filter: SemanticFilter, addParam: (value: unknown) => string): string | null {
    const operator = filter.operator.toUpperCase();
    const catalogFilter = filter.filterId ? this.catalog.getFilter(filter.filterId) : undefined;
    const columns = this.compatibleFilterColumns(this.filterColumns(dataset, filter, catalogFilter), operator, filter.value);
    if (!columns.length) return null;

    if (columns.length > 1 && operator === 'ILIKE') {
      const value = `%${String(filter.value ?? '').replace(/%/g, '')}%`;
      const param = addParam(value);
      return `(${columns.map((c) => `${this.ident(c)} ILIKE ${param}`).join(' OR ')})`;
    }

    // Exclusion across synonym columns: drop the row if ANY column matches, so
    // the per-column NOT ILIKE predicates are AND-joined. COALESCE keeps NULL
    // columns (e.g. a missing product name) from nulling out the whole row.
    if (columns.length > 1 && operator === 'NOT ILIKE') {
      const value = `%${String(filter.value ?? '').replace(/%/g, '')}%`;
      const param = addParam(value);
      return `(${columns.map((c) => `COALESCE(${this.ident(c)}, '') NOT ILIKE ${param}`).join(' AND ')})`;
    }

    if (columns.length > 1 && ['=', '!=', 'IN', 'NOT IN'].includes(operator)) {
      const joiner = operator === '!=' || operator === 'NOT IN' ? ' AND ' : ' OR ';
      return `(${columns.map((column) => this.compileSingleColumnFilter(dataset, column, operator, filter.value, addParam)).join(joiner)})`;
    }

    const columnName = columns[0];
    return this.compileSingleColumnFilter(dataset, columnName, operator, filter.value, addParam);
  }

  private compileSingleColumnFilter(
    dataset: CatalogDataset,
    columnName: string,
    operator: string,
    value: unknown,
    addParam: (value: unknown) => string,
  ): string {
    const column = this.ident(columnName);
    const isDate = this.isDateColumn(dataset, columnName);
    // A {from,to} range object is a bounded range. The LLM sometimes pairs it
    // with a scalar operator (e.g. expiry <= {from,to}); binding the object as
    // jsonb and casting ::date then fails (42846). Resolve it to the relevant
    // bound, or a BETWEEN when both sides are present and the operator isn't
    // one-sided.
    if (value && typeof value === 'object' && !Array.isArray(value) && ('from' in (value as any) || 'to' in (value as any))) {
      const from = (value as any).from;
      const to = (value as any).to;
      if (operator === '<' || operator === '<=') {
        value = to ?? from;
      } else if (operator === '>' || operator === '>=') {
        value = from ?? to;
      } else if (from != null && to != null) {
        const cast = this.isUuidColumn(columnName) ? '::uuid' : (isDate ? '::date' : '');
        return `${column} BETWEEN ${addParam(from)}${cast} AND ${addParam(to)}${cast}`;
      } else {
        value = from ?? to;
      }
    }
    // An equality/inequality carrying a list value is membership, not a scalar
    // comparison. Postgres rejects `varchar = text[]` (42883), so coerce it to
    // ANY/ALL. This happens when the LLM emits `=` with an array, or when the
    // validator downgrades an `IN` to a catalog filter's canonical `=`/`!=`
    // operator while keeping the original array value.
    if (Array.isArray(value) && (operator === '=' || operator === '!=')) {
      operator = operator === '=' ? 'IN' : 'NOT IN';
    }
    if (operator === 'IN' || operator === 'NOT IN') {
      const arrayValue = Array.isArray(value) ? value : [value];
      const cast = this.isUuidColumn(columnName) ? '::uuid[]' : (isDate ? '::date[]' : '');
      const param = `${addParam(arrayValue)}${cast}`;
      return operator === 'NOT IN' ? `${column} <> ALL(${param})` : `${column} = ANY(${param})`;
    }
    if (operator === 'BETWEEN') {
      const arrayValue = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' ? [(value as any).from, (value as any).to].filter((item) => item != null) : []);
      if (arrayValue.length !== 2) throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'BETWEEN filter requires exactly two values');
      const cast = isDate ? '::date' : '';
      return `${column} BETWEEN ${addParam(arrayValue[0])}${cast} AND ${addParam(arrayValue[1])}${cast}`;
    }
    if (operator === 'ILIKE') {
      const pattern = `%${String(value ?? '').replace(/%/g, '')}%`;
      return `${column} ILIKE ${addParam(pattern)}`;
    }
    if (operator === 'NOT ILIKE') {
      const pattern = `%${String(value ?? '').replace(/%/g, '')}%`;
      // COALESCE so NULL text columns are treated as non-matching (kept), not
      // dropped — `NULL NOT ILIKE x` is NULL, which would exclude the row.
      return `COALESCE(${column}, '') NOT ILIKE ${addParam(pattern)}`;
    }
    if (operator === 'IS DISTINCT FROM') {
      return `${column} IS DISTINCT FROM ${addParam(value)}`;
    }
    const cast = this.isUuidColumn(columnName) ? '::uuid' : (isDate ? '::date' : '');
    return `${column} ${operator} ${addParam(this.resolveFilterValue(value))}${cast}`;
  }

  private isDateColumn(dataset: CatalogDataset, column: string): boolean {
    if (dataset.dateFields?.some((f) => f.column === column)) return true;
    return this.catalog.getCatalog().timeFields.some((t) => t.datasetId === dataset.datasetId && t.column === column);
  }

  private filterColumns(dataset: CatalogDataset, filter: SemanticFilter, catalogFilter?: CatalogFilter): string[] {
    const rawColumns = catalogFilter?.columns ?? (catalogFilter?.column ? [catalogFilter.column] : (filter.column ? [filter.column] : []));
    const resolved: string[] = [];
    for (const column of rawColumns) {
      if (column === 'default_time_field') {
        const dateColumn = this.defaultDateColumn(dataset);
        if (dateColumn) resolved.push(dateColumn);
        continue;
      }
      resolved.push(column);
    }
    return resolved.filter((c) => this.isColumnAllowedForDataset(dataset, c));
  }

  private compatibleFilterColumns(columns: string[], operator: string, value: unknown): string[] {
    if (operator === 'ILIKE' || operator === 'NOT ILIKE') return columns.filter((column) => !this.isUuidColumn(column));
    if (['=', '!='].includes(operator) && !this.isUuidLike(value)) return columns.filter((column) => !this.isUuidColumn(column));
    if (['IN', 'NOT IN'].includes(operator) && !this.allValuesUuidLike(value)) return columns.filter((column) => !this.isUuidColumn(column));
    return columns;
  }

  private isUuidColumn(column: string): boolean {
    return UUID_FILTER_COLUMNS.has(column);
  }

  private isUuidLike(value: unknown): boolean {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private allValuesUuidLike(value: unknown): boolean {
    const values = Array.isArray(value) ? value : [value];
    return values.length > 0 && values.every((item) => this.isUuidLike(item));
  }

  private compileOrderBy(sort: SemanticSort[], query: SemanticReportQuery, dataset: CatalogDataset, groupBy: string[]): string {
    const parts: string[] = [];
    const hasAggregateMetrics = query.metrics.length > 0;
    const requiresGroupedSort = hasAggregateMetrics || groupBy.length > 0;
    for (const item of sort.slice(0, 3)) {
      const direction = item.direction.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      if (item.metricId && query.metrics.includes(item.metricId)) parts.push(`${this.ident(item.metricId)} ${direction}`);
      else if (item.dimensionId && query.dimensions.includes(item.dimensionId)) {
        const dim = this.catalog.getDimension(item.dimensionId);
        const column = dim?.transform === 'calendar_month' ? 'month' : dim?.labelColumn;
        if (column) parts.push(`${this.ident(column)} ${direction}`);
      } else if (item.columnId && query.displayColumns?.includes(item.columnId)) {
        const displayColumn = this.catalog.getDisplayColumn(item.columnId);
        if (displayColumn && this.isColumnAllowedForDataset(dataset, displayColumn.column)) {
          parts.push(`${this.compileSortableColumn(displayColumn.column, direction, groupBy, requiresGroupedSort)} ${direction}`);
        }
      } else if (item.fieldId) {
        const dateColumn = this.dateColumnForFieldId(dataset, item.fieldId);
        if (dateColumn && this.isColumnAllowedForDataset(dataset, dateColumn)) {
          parts.push(`${this.compileSortableColumn(dateColumn, direction, groupBy, requiresGroupedSort)} ${direction}`);
        }
      } else if (item.column && this.isColumnAllowedForDataset(dataset, item.column)) {
        parts.push(`${this.compileSortableColumn(item.column, direction, groupBy, requiresGroupedSort)} ${direction}`);
      }
    }
    return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
  }

  private compileSortableColumn(columnName: string, direction: 'ASC' | 'DESC', groupBy: string[], hasAggregateMetrics: boolean): string {
    const column = this.ident(columnName);
    if (!hasAggregateMetrics) return column;
    if (groupBy.includes(column)) return column;
    const dateExpression = `${column}::date`;
    if (groupBy.includes(dateExpression)) return dateExpression;
    return `${direction === 'ASC' ? 'MIN' : 'MAX'}(${column})`;
  }

  private shouldApplyDateFilter(dataset: CatalogDataset, timeRange: SemanticTimeRange | undefined): boolean {
    if (DATE_FILTER_DATASETS.has(dataset.datasetId)) return true;
    if (!timeRange || !this.defaultDateColumn(dataset, timeRange.fieldId)) return false;
    if (timeRange.preset === 'custom') return true;
    return Boolean(timeRange.fieldId) && !['current_financial_year', 'unspecified'].includes(timeRange.preset ?? 'current_financial_year');
  }

  private isColumnAllowedForDataset(dataset: CatalogDataset, column: string): boolean {
    if (/^[a-z][a-z0-9_]*$/i.test(column) === false) return false;
    if (['tenant_id', 'company_id', 'branch_id', 'warehouse_id'].includes(column)) return true;
    const catalog = this.catalog.getCatalog();
    return catalog.dimensions.some((d) => (d.datasetId === dataset.datasetId || d.datasetId === '*') && d.columns.includes(column))
      || catalog.timeFields.some((t) => t.datasetId === dataset.datasetId && t.column === column)
      || catalog.filters.some((f) => (f.datasetIds.includes(dataset.datasetId) || f.datasetIds.includes('*')) && (f.column === column || f.columns?.includes(column)))
      || catalog.displayColumns.some((c) => c.datasetId === dataset.datasetId && c.column === column)
      || catalog.metrics.some((m) => m.datasetId === dataset.datasetId && new RegExp(`\\b${column}\\b`).test(m.expression))
      || dataset.defaultFilters?.some((f) => f.column === column) === true
      || dataset.dateFields?.some((d) => d.column === column) === true;
  }

  private defaultDateColumn(dataset: CatalogDataset, fieldId?: string): string | null {
    if (fieldId) {
      const dateColumn = this.dateColumnForFieldId(dataset, fieldId);
      if (dateColumn) return dateColumn;
    }
    const tf = this.catalog.getCatalog().timeFields.find((t) => t.datasetId === dataset.datasetId && t.default);
    return tf?.column ?? dataset.dateFields?.find((d) => d.default)?.column ?? null;
  }

  private dateColumnForFieldId(dataset: CatalogDataset, fieldId: string): string | null {
    const tf = this.catalog.getTimeField(fieldId);
    if (tf?.datasetId === dataset.datasetId) return tf.column;
    const dateField = dataset.dateFields?.find((field) => field.fieldId === fieldId);
    if (dateField) return dateField.column;
    const displayColumn = this.catalog.getDisplayColumn(fieldId);
    if (displayColumn?.datasetId === dataset.datasetId && displayColumn.dataType === 'date') return displayColumn.column;
    return null;
  }

  private resolveDateRange(timeRange: SemanticTimeRange | undefined, security: ReportingSecurityContext): { startDate: string; endDate: string } | null {
    const today = new Date();
    const iso = (d: Date) => this.formatDate(d);
    const preset = timeRange?.preset ?? 'current_financial_year';
    if (preset === 'custom') return { startDate: String(timeRange?.startDate), endDate: String(timeRange?.endDate) };
    if (preset === 'today') return { startDate: iso(today), endDate: iso(today) };
    if (preset === 'yesterday') {
      const d = new Date(today); d.setDate(d.getDate() - 1);
      return { startDate: iso(d), endDate: iso(d) };
    }
    if (preset === 'last_7_days' || preset === 'last_30_days') {
      const d = new Date(today); d.setDate(d.getDate() - (preset === 'last_7_days' ? 6 : 29));
      return { startDate: iso(d), endDate: iso(today) };
    }
    if (preset === 'this_week') {
      const d = new Date(today); d.setDate(d.getDate() - today.getDay());
      return { startDate: iso(d), endDate: iso(today) };
    }
    if (preset === 'last_week') {
      const start = new Date(today); start.setDate(start.getDate() - start.getDay() - 7);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return { startDate: iso(start), endDate: iso(end) };
    }
    if (preset === 'this_month') {
      return { startDate: iso(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: iso(today) };
    }
    if (preset === 'last_month') {
      return {
        startDate: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        endDate: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    }
    if (preset === 'this_quarter') {
      const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
      return { startDate: iso(new Date(today.getFullYear(), quarterStartMonth, 1)), endDate: iso(today) };
    }
    if (preset === 'last_quarter') {
      const currentQuarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
      const start = new Date(today.getFullYear(), currentQuarterStartMonth - 3, 1);
      const end = new Date(today.getFullYear(), currentQuarterStartMonth, 0);
      return { startDate: iso(start), endDate: iso(end) };
    }
    if (preset === 'last_financial_year' && security.fiscalYear) {
      const start = new Date(`${security.fiscalYear.startDate}T00:00:00`);
      const end = new Date(`${security.fiscalYear.endDate}T00:00:00`);
      start.setFullYear(start.getFullYear() - 1);
      end.setFullYear(end.getFullYear() - 1);
      return { startDate: iso(start), endDate: iso(end) };
    }
    if (security.fiscalYear) return { startDate: security.fiscalYear.startDate, endDate: security.fiscalYear.endDate };
    return { startDate: `${today.getFullYear()}-01-01`, endDate: iso(today) };
  }

  private resolveComparisonRange(
    current: { startDate: string; endDate: string },
    comparison: SemanticReportQuery['comparison'],
  ): { startDate: string; endDate: string } {
    const type = comparison?.type ?? 'previous_period';
    if (type === 'custom') {
      if (!comparison?.startDate || !comparison?.endDate) {
        throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Custom comparison requires startDate and endDate');
      }
      return { startDate: comparison.startDate, endDate: comparison.endDate };
    }

    const start = new Date(`${current.startDate}T00:00:00`);
    const end = new Date(`${current.endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Comparison report has an invalid current date range');
    }

    if (type === 'previous_year') {
      const previousStart = new Date(start);
      const previousEnd = new Date(end);
      previousStart.setFullYear(previousStart.getFullYear() - 1);
      previousEnd.setFullYear(previousEnd.getFullYear() - 1);
      return { startDate: this.formatDate(previousStart), endDate: this.formatDate(previousEnd) };
    }

    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    const previousEnd = new Date(start);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - days + 1);
    return { startDate: this.formatDate(previousStart), endDate: this.formatDate(previousEnd) };
  }

  private resolveFilterValue(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const token = (value as any).relativeDate;
      if (token === 'today_plus_90_days') {
        const d = new Date(); d.setDate(d.getDate() + 90);
        return this.formatDate(d);
      }
    }
    return value;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private intersectCompany(security: ReportingSecurityContext): number[] {
    const allowed = new Set(security.allowedCompanyIds);
    if (security.requestedCompanyId != null) {
      return allowed.has(security.requestedCompanyId) || !security.hasExplicitCompanyScope ? [security.requestedCompanyId] : [];
    }
    return [...allowed];
  }

  private intersectBranches(security: ReportingSecurityContext): string[] {
    const allowed = new Set(security.allowedBranchIds);
    if (security.requestedBranchIds?.length) {
      return security.requestedBranchIds.filter((id) => allowed.has(id) || !security.hasExplicitBranchScope);
    }
    return [...allowed];
  }

  private required<T>(value: T | undefined, message: string): T {
    if (!value) throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', message);
    return value;
  }

  private ident(value: string): string {
    if (!/^[a-z][a-z0-9_]*$/i.test(value)) {
      throw new AiReportingBadRequest('UNSAFE_SQL', `Unsafe identifier: ${value}`);
    }
    return value;
  }

  private toLabel(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
