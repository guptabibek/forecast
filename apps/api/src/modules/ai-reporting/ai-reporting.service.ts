import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { AiProviderService } from './ai-provider.service';
import { AiReportingAuditService } from './ai-reporting.audit';
import { AiReportingUsageGuard } from './ai-reporting-usage.guard';
import { AiReportingBadRequest } from './ai-reporting.errors';
import { NlqParserService } from './nlq-parser.service';
import { PromptInjectionValidator } from './prompt-injection.validator';
import { ReportExecutorService } from './report-executor.service';
import { ResultSummarizerService } from './result-summarizer.service';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import { SemanticQueryValidator } from './semantic-query.validator';
import {
  CatalogDimension,
  ExecutedReportResult,
  ReportingSecurityContext,
  SemanticDashboardQuery,
  SemanticReportQuery,
  SemanticTimeRange,
} from './semantic-query.types';
import { SqlCompilerService } from './sql-compiler.service';
import { SqlSafetyValidator } from './sql-safety.validator';

export interface AiReportRequest {
  question: string;
  outputMode?: 'auto' | 'table' | 'chart';
  includeSummary?: boolean;
  companyId?: number;
  branchIds?: string[];
}

interface AiReportingRuntimeSettings {
  enabled: boolean;
  summariesEnabled: boolean;
  maxRows: number;
  monthlyUsageCap: number;
  maskSensitiveFields: boolean;
  timeoutMs: number;
  allowedRoles: string[];
}

export interface CanonicalGridColumn {
  field: string;
  label: string;
  dataType?: string;
}

export interface CanonicalGrid {
  columns: CanonicalGridColumn[];
  rows: Record<string, unknown>[];
  totals: Record<string, number>;
}

export interface CanonicalChart {
  enabled: boolean;
  type: 'bar' | 'line' | 'pie' | 'kpi' | 'none';
  xField: string | null;
  yField: string | null;
  data: Record<string, unknown>[];
}

export interface CanonicalKpi {
  label: string;
  value: unknown;
  dataType?: string;
  hint?: string;
}

export interface CanonicalReportPayload {
  metadata: {
    metricLabel: string;
    groupedBy: string;
    periodLabel: string;
  };
  kpis: CanonicalKpi[];
  grid: CanonicalGrid;
  chart: CanonicalChart;
  visualization: { type: 'table' | 'bar' | 'line' | 'pie' | 'kpi'; x?: string | null; y?: string | null };
  columns: Array<{ key: string; label: string; dataType?: string }>;
  rows: Record<string, unknown>[];
}

@Injectable()
export class AiReportingService {
  private readonly logger = new Logger(AiReportingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: SemanticCatalogLoader,
    private readonly parser: NlqParserService,
    private readonly semanticValidator: SemanticQueryValidator,
    private readonly compiler: SqlCompilerService,
    private readonly safetyValidator: SqlSafetyValidator,
    private readonly executor: ReportExecutorService,
    private readonly summarizer: ResultSummarizerService,
    private readonly audit: AiReportingAuditService,
    private readonly usageGuard: AiReportingUsageGuard,
    private readonly promptInjection: PromptInjectionValidator,
    private readonly aiProvider: AiProviderService,
  ) {}

  async getCatalogMetadata(user: any) {
    const runtime = await this.resolveRuntimeSettings(user?.tenantId);
    this.assertFeatureEnabled(runtime);
    const security = await this.resolveSecurityContext(user, { question: '' });
    this.assertRoleAllowed(security, runtime);
    this.assertAiPermission(security, 'reports.ai.view');
    const metadata = this.catalog.getLimitedMetadata();
    return {
      ...metadata,
      reportAreas: this.uniqueReportAreas(metadata.datasets),
      suggestedQuestions: this.catalogDrivenSuggestions(metadata),
      feature: {
        enabled: runtime.enabled,
        summariesEnabled: runtime.summariesEnabled,
        maxRows: runtime.maxRows,
      },
    };
  }

  async history(user: any, limit?: number) {
    const runtime = await this.resolveRuntimeSettings(user?.tenantId);
    this.assertFeatureEnabled(runtime);
    const security = await this.resolveSecurityContext(user, { question: '' });
    this.assertRoleAllowed(security, runtime);
    this.assertAiPermission(security, 'reports.ai.view');
    return this.audit.history(user.tenantId, user.id, limit);
  }

  async query(user: any, request: AiReportRequest) {
    const requestId = randomUUID();
    const security = await this.resolveSecurityContext(user, request);
    let semanticQuery: any;
    let compiledSql: string | null = null;
    let lease: { release: () => void } | null = null;
    let aiCallCount = 0;
    let summaryCallCount = 0;
    const started = Date.now();
    const runtime = await this.resolveRuntimeSettings(user.tenantId);

    try {
      this.assertFeatureEnabled(runtime);
      this.assertRoleAllowed(security, runtime);
      this.assertAiPermission(security, 'reports.ai.execute');
      this.promptInjection.validateQuestion(request.question);
      lease = await this.usageGuard.acquire(security, request.companyId);
      aiCallCount += 1;
      semanticQuery = await this.parser.parseQuestion({
        question: request.question,
        outputMode: request.outputMode,
        currentDate: new Date().toISOString().slice(0, 10),
        securityContext: security,
        requestId,
      });
      const validated = this.semanticValidator.validate(semanticQuery, security);
      if (validated.queryKind === 'clarification' || validated.queryKind === 'unsupported') {
        await this.audit.log({
          requestId,
          tenantId: security.tenantId,
          userId: this.auditUserId(user),
          companyId: request.companyId ?? null,
          branchIds: request.branchIds ?? null,
          question: request.question,
          outputMode: request.outputMode,
          queryKind: validated.queryKind,
          semanticQuery: validated,
          executionTimeMs: Date.now() - started,
          rowCount: 0,
          status: 'success',
          aiCallCount,
          summaryCallCount,
        });
        const unsupported = validated.queryKind === 'unsupported';
        return {
          requestId,
          status: unsupported ? 'unsupported' : 'clarification_required',
          title: validated.title ?? (unsupported ? 'Unsupported Report Request' : 'Clarification Required'),
          queryKind: validated.queryKind,
          mode: unsupported ? 'aggregate' : 'detail',
          metadata: { metricLabel: '', groupedBy: '', periodLabel: '' },
          kpis: [],
          grid: { columns: [], rows: [], totals: {} },
          chart: { enabled: false, type: 'none', xField: null, yField: null, data: [] },
          columns: [],
          rows: [],
          summary: null,
          assumptions: validated.assumptions ?? [],
          followUpQuestions: validated.followUpQuestions,
          clarification: unsupported ? null : validated.reason,
          unsupportedReason: unsupported ? validated.reason : null,
          availableAlternatives: validated.followUpQuestions ?? [],
          missingCapabilities: [],
          recommendedSchemaFix: null,
        };
      }
      if (validated.queryKind !== 'single_report') {
        throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Expected a single report semantic query');
      }

      const limited = this.applyRuntimeLimits(validated, runtime);
      const compiled = this.compiler.compile(limited, security);
      compiledSql = compiled.sql;
      this.safetyValidator.validate(compiled);
      const result = await this.executor.execute(compiled, { timeoutMs: runtime.timeoutMs });
      const safeResult = this.sanitizeResult(limited, result, security, runtime);
      const reportPayload = this.buildReportPayload(limited, safeResult);
      const allowSummary = request.includeSummary && runtime.summariesEnabled;
      const summary = allowSummary
        ? await this.summarizer.summarize({
            question: request.question,
            semanticQuery: limited,
            columns: reportPayload.columns,
            rows: reportPayload.rows,
            securityContext: security,
            requestId,
          })
        : null;
      if (allowSummary) summaryCallCount += 1;

      await this.audit.log({
        requestId,
        tenantId: security.tenantId,
        userId: this.auditUserId(user),
        companyId: request.companyId ?? null,
        branchIds: request.branchIds ?? null,
        question: request.question,
        outputMode: request.outputMode,
        queryKind: validated.queryKind,
        semanticQuery: limited,
        sql: compiled.sql,
        executionTimeMs: result.executionTimeMs,
        rowCount: safeResult.rowCount,
        status: 'success',
        aiCallCount,
        summaryCallCount,
      });
      this.logger.log(`AI report query succeeded: requestId=${requestId}, tenantId=${security.tenantId}, userId=${security.userId}, dataset=${limited.datasetId}, rows=${safeResult.rowCount}, durationMs=${result.executionTimeMs}, aiCalls=${aiCallCount}, summaryCalls=${summaryCallCount}`);

      return {
        requestId,
        status: 'success',
        title: validated.title,
        queryKind: limited.queryKind,
        mode: limited.mode ?? this.modeFromAnalysisType(limited.analysisType),
        metadata: reportPayload.metadata,
        kpis: reportPayload.kpis,
        grid: reportPayload.grid,
        chart: reportPayload.chart,
        visualization: reportPayload.visualization,
        columns: reportPayload.columns,
        rows: reportPayload.rows,
        summary,
        assumptions: limited.assumptions ?? [],
        followUpQuestions: limited.followUpQuestions ?? [],
        clarification: null,
        unsupportedReason: null,
        availableAlternatives: [],
        missingCapabilities: [],
        recommendedSchemaFix: null,
        interpretation: this.summarizeIntent(limited),
      };
    } catch (error: any) {
      await this.audit.log({
        requestId,
        tenantId: security.tenantId,
        userId: this.auditUserId(user),
        companyId: request.companyId ?? null,
        branchIds: request.branchIds ?? null,
        question: request.question,
        outputMode: request.outputMode,
        queryKind: semanticQuery?.queryKind ?? null,
        semanticQuery,
        sql: compiledSql,
        executionTimeMs: Date.now() - started,
        rowCount: 0,
        status: 'error',
        errorCode: error?.response?.code ?? error?.response?.error ?? error?.name ?? 'AI_REPORTING_ERROR',
        errorMessage: error?.response?.message ?? error?.message ?? 'AI report failed',
        aiCallCount,
        summaryCallCount,
      });
      this.logger.warn(`AI report query failed: requestId=${requestId}, tenantId=${security.tenantId}, userId=${security.userId}, code=${error?.response?.code ?? error?.name ?? 'AI_REPORTING_ERROR'}, durationMs=${Date.now() - started}`);
      throw error;
    } finally {
      lease?.release();
    }
  }

  async dashboard(user: any, request: AiReportRequest) {
    const requestId = randomUUID();
    const security = await this.resolveSecurityContext(user, request);
    const started = Date.now();
    let semanticQuery: any;
    let sqlForAudit: string | null = null;
    let lease: { release: () => void } | null = null;
    let aiCallCount = 0;
    let summaryCallCount = 0;
    const runtime = await this.resolveRuntimeSettings(user.tenantId);

    try {
      this.assertFeatureEnabled(runtime);
      this.assertRoleAllowed(security, runtime);
      this.assertAiPermission(security, 'reports.ai.execute');
      this.assertAiPermission(security, 'reports.ai.dashboard');
      this.promptInjection.validateQuestion(request.question);
      lease = await this.usageGuard.acquire(security, request.companyId);
      aiCallCount += 1;
      semanticQuery = await this.parser.parseQuestion({
        question: request.question,
        outputMode: 'auto',
        currentDate: new Date().toISOString().slice(0, 10),
        securityContext: security,
        dashboardOnly: true,
        requestId,
      });
      const validated = this.semanticValidator.validate(semanticQuery, security);
      if (validated.queryKind === 'clarification' || validated.queryKind === 'unsupported') {
        await this.audit.log({
          requestId,
          tenantId: security.tenantId,
          userId: this.auditUserId(user),
          companyId: request.companyId ?? null,
          branchIds: request.branchIds ?? null,
          question: request.question,
          outputMode: 'dashboard',
          queryKind: validated.queryKind,
          semanticQuery: validated,
          executionTimeMs: Date.now() - started,
          rowCount: 0,
          status: 'success',
          aiCallCount,
          summaryCallCount,
        });
        const unsupported = validated.queryKind === 'unsupported';
        return {
          requestId,
          status: unsupported ? 'unsupported' : 'clarification_required',
          title: validated.title ?? (unsupported ? 'Unsupported Report Request' : 'Clarification Required'),
          queryKind: validated.queryKind,
          widgets: [],
          metadata: { metricLabel: '', groupedBy: '', periodLabel: '' },
          kpis: [],
          grid: { columns: [], rows: [], totals: {} },
          chart: { enabled: false, type: 'none', xField: null, yField: null, data: [] },
          assumptions: validated.assumptions ?? [],
          followUpQuestions: validated.followUpQuestions,
          clarification: unsupported ? null : validated.reason,
          unsupportedReason: unsupported ? validated.reason : null,
          availableAlternatives: validated.followUpQuestions ?? [],
          missingCapabilities: [],
          recommendedSchemaFix: null,
        };
      }
      if (validated.queryKind !== 'dashboard') {
        throw new AiReportingBadRequest('INVALID_SEMANTIC_QUERY', 'Expected a dashboard semantic query');
      }

      const dashboard = validated as SemanticDashboardQuery;
      const widgets = [];
      let totalRows = 0;
      let totalExecution = 0;
      for (const widget of dashboard.widgets ?? []) {
        const limitedWidget = this.applyRuntimeLimits(widget, runtime);
        const compiled = this.compiler.compile(limitedWidget, security);
        sqlForAudit = sqlForAudit ? `${sqlForAudit}\n${compiled.sql}` : compiled.sql;
        this.safetyValidator.validate(compiled);
        const result = await this.executor.execute(compiled, { timeoutMs: runtime.timeoutMs });
        const safeResult = this.sanitizeResult(limitedWidget, result, security, runtime);
        const reportPayload = this.buildReportPayload(limitedWidget, safeResult);
        totalRows += safeResult.rowCount;
        totalExecution += result.executionTimeMs;
        const allowSummary = request.includeSummary && runtime.summariesEnabled;
        const summary = allowSummary
          ? await this.summarizer.summarize({
              question: request.question,
              semanticQuery: limitedWidget,
              columns: reportPayload.columns,
              rows: reportPayload.rows,
              securityContext: security,
              requestId,
            })
          : null;
        widgets.push({
          widgetId: limitedWidget.templateId ?? limitedWidget.datasetId,
          title: limitedWidget.title,
          mode: limitedWidget.mode ?? this.modeFromAnalysisType(limitedWidget.analysisType),
          metadata: reportPayload.metadata,
          kpis: reportPayload.kpis,
          grid: reportPayload.grid,
          chart: reportPayload.chart,
          visualization: reportPayload.visualization,
          columns: reportPayload.columns,
          rows: reportPayload.rows,
          summary,
          assumptions: limitedWidget.assumptions ?? [],
          interpretation: this.summarizeIntent(limitedWidget),
        });
        if (allowSummary) summaryCallCount += 1;
      }

      await this.audit.log({
        requestId,
        tenantId: security.tenantId,
        userId: this.auditUserId(user),
        companyId: request.companyId ?? null,
        branchIds: request.branchIds ?? null,
        question: request.question,
        outputMode: 'dashboard',
        queryKind: dashboard.queryKind,
        semanticQuery: dashboard,
        sql: sqlForAudit,
        executionTimeMs: totalExecution,
        rowCount: totalRows,
        status: 'success',
        aiCallCount,
        summaryCallCount,
      });
      this.logger.log(`AI dashboard query succeeded: requestId=${requestId}, tenantId=${security.tenantId}, userId=${security.userId}, widgets=${widgets.length}, rows=${totalRows}, durationMs=${totalExecution}, aiCalls=${aiCallCount}, summaryCalls=${summaryCallCount}`);

      return {
        requestId,
        status: 'success',
        title: dashboard.title,
        queryKind: dashboard.queryKind,
        widgets,
        metadata: { metricLabel: '', groupedBy: 'Dashboard', periodLabel: this.describePeriodLabel(dashboard.timeRange) },
        kpis: [],
        grid: { columns: [], rows: [], totals: {} },
        chart: { enabled: false, type: 'none', xField: null, yField: null, data: [] },
        assumptions: dashboard.assumptions ?? [],
        followUpQuestions: dashboard.followUpQuestions ?? [],
        clarification: null,
        unsupportedReason: null,
        availableAlternatives: [],
        missingCapabilities: [],
        recommendedSchemaFix: null,
      };
    } catch (error: any) {
      await this.audit.log({
        requestId,
        tenantId: security.tenantId,
        userId: this.auditUserId(user),
        companyId: request.companyId ?? null,
        branchIds: request.branchIds ?? null,
        question: request.question,
        outputMode: 'dashboard',
        queryKind: semanticQuery?.queryKind ?? null,
        semanticQuery,
        sql: sqlForAudit,
        executionTimeMs: Date.now() - started,
        rowCount: 0,
        status: 'error',
        errorCode: error?.response?.code ?? error?.name ?? 'AI_REPORTING_ERROR',
        errorMessage: error?.response?.message ?? error?.message ?? 'AI dashboard failed',
        aiCallCount,
        summaryCallCount,
      });
      this.logger.warn(`AI dashboard query failed: requestId=${requestId}, tenantId=${security.tenantId}, userId=${security.userId}, code=${error?.response?.code ?? error?.name ?? 'AI_REPORTING_ERROR'}, durationMs=${Date.now() - started}`);
      throw error;
    } finally {
      lease?.release();
    }
  }

  private assertAiPermission(security: ReportingSecurityContext, permission: string) {
    if (security.userRole === 'SUPER_ADMIN' || security.userRole === 'ADMIN') return;
    const compatibilityPermission = permission === 'reports.ai.execute'
      ? 'reports.ai_reporting.execute'
      : permission === 'reports.ai.view'
        ? 'reports.ai_reporting.view'
        : undefined;
    if (security.permissions.includes(permission) || (compatibilityPermission && security.permissions.includes(compatibilityPermission))) {
      return;
    }
    throw new ForbiddenException('You do not have permission to use AI reporting');
  }

  private sanitizeResult(
    query: SemanticReportQuery,
    result: { columns: Array<{ key: string; label: string; dataType?: string }>; rows: Record<string, unknown>[]; rowCount: number; executionTimeMs: number },
    security: ReportingSecurityContext,
    runtime: AiReportingRuntimeSettings,
  ) {
    const heuristic = /(pan|vat|gst|phone|address|email|bank|license|secret|token)/i;
    const catalogSensitive = new Set<string>();
    for (const displayColumn of this.catalog.getCatalog().displayColumns ?? []) {
      if (displayColumn.datasetId === query.datasetId && displayColumn.sensitive) {
        catalogSensitive.add(displayColumn.column);
      }
    }
    const dataset = this.catalog.getDataset(query.datasetId);
    for (const column of dataset?.sensitiveColumns ?? []) catalogSensitive.add(column);

    const isSensitiveKey = (key: string) => catalogSensitive.has(key) || heuristic.test(key);
    const elevated = ['ADMIN', 'FINANCE', 'SUPER_ADMIN'].includes(security.userRole);
    const authorizedDataset = ['tax_register', 'ledger_entries', 'party_outstanding', 'sales_items', 'sales_invoices', 'purchase_items', 'purchase_invoices'].includes(query.datasetId);
    const explicitlyRequestedColumnIds = new Set(query.displayColumns ?? []);
    const explicitSensitiveRequested = (catalog: typeof this.catalog) => {
      for (const columnId of explicitlyRequestedColumnIds) {
        const column = catalog.getDisplayColumn(columnId);
        if (column?.sensitive) return true;
      }
      return false;
    };
    const canSeeSensitive = elevated && authorizedDataset && explicitSensitiveRequested(this.catalog);
    if (canSeeSensitive && !runtime.maskSensitiveFields) return result;

    const columns = result.columns.filter((column) => !isSensitiveKey(column.key));
    if (columns.length === result.columns.length) return result;
    const allowed = new Set(columns.map((column) => column.key));
    const rows = result.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key))));
    return { ...result, columns, rows };
  }

  private applyRuntimeLimits(query: SemanticReportQuery, runtime: AiReportingRuntimeSettings): SemanticReportQuery {
    return {
      ...query,
      limit: Math.min(Number(query.limit) || runtime.maxRows, runtime.maxRows),
    };
  }

  private buildReportPayload(query: SemanticReportQuery, result: ExecutedReportResult): CanonicalReportPayload {
    const rows = this.enrichRowsForDisplay(query, result.rows);
    const gridColumns = this.buildGridColumns(result.columns, rows);
    const grid: CanonicalGrid = {
      columns: gridColumns,
      rows,
      totals: this.calculateTotals(gridColumns, rows),
    };
    const chart = this.buildChart(query, grid);
    const kpis = this.buildKpis(query, grid, chart);

    return {
      metadata: {
        metricLabel: this.metricLabel(query),
        groupedBy: this.groupedByLabel(query),
        periodLabel: this.describePeriodLabel(query.timeRange),
      },
      kpis,
      grid,
      chart,
      visualization: chart.enabled && chart.type !== 'none'
        ? { type: chart.type, x: chart.xField, y: chart.yField }
        : { type: 'table' },
      columns: grid.columns.map((column) => ({
        key: column.field,
        label: column.label,
        dataType: column.dataType,
      })),
      rows,
    };
  }

  private enrichRowsForDisplay(query: SemanticReportQuery, rows: Record<string, unknown>[]) {
    return rows.map((row) => {
      const output: Record<string, unknown> = { ...row };
      if ('month' in output && !this.hasDisplayValue(output.month)) {
        output.month_label = 'Unknown Month';
      } else if ('month' in output && !this.hasDisplayValue(output.month_label)) {
        output.month_label = this.formatMonthLabel(output.month);
      }
      if ('date' in output && !this.hasDisplayValue(output.date_label)) {
        output.date_label = this.formatDayLabel(output.date);
      }

      for (const dimensionId of query.dimensions) {
        const dimension = this.catalog.getDimension(dimensionId);
        if (!dimension) continue;
        const fallbackColumn = this.fallbackLabelColumn(dimension);
        const labelColumn = this.dimensionLabelColumn(dimension);
        if (!labelColumn || !(labelColumn in output)) continue;
        if (!this.hasDisplayValue(output[labelColumn])) {
          output[labelColumn] = this.hasDisplayValue(output[fallbackColumn])
            ? output[fallbackColumn]
            : this.unknownLabel(dimension);
        }
      }
      return output;
    });
  }

  private buildGridColumns(
    columns: Array<{ key: string; label: string; dataType?: string }>,
    rows: Record<string, unknown>[],
  ): CanonicalGridColumn[] {
    const mapped: CanonicalGridColumn[] = [];
    const used = new Set<string>();
    for (const column of columns) {
      const field = this.displayFieldForColumn(column.key, rows);
      if (used.has(field)) continue;
      used.add(field);
      mapped.push({
        field,
        label: field === 'month_label' ? 'Month' : field === 'date_label' ? 'Date' : column.label,
        dataType: field.endsWith('_label')
          ? 'text'
          : this.normalizeDataType(column.dataType) ?? (this.isNumericField(field) ? 'number' : 'text'),
      });
    }
    return mapped;
  }

  private displayFieldForColumn(key: string, rows: Record<string, unknown>[]): string {
    if (key === 'month' && rows.some((row) => 'month_label' in row)) return 'month_label';
    if (key === 'date' && rows.some((row) => 'date_label' in row)) return 'date_label';
    return key;
  }

  private calculateTotals(columns: CanonicalGridColumn[], rows: Record<string, unknown>[]) {
    const totals: Record<string, number> = {};
    for (const column of columns) {
      if (!['currency', 'number', 'quantity'].includes(column.dataType ?? '') && !this.isNumericField(column.field)) continue;
      let sum = 0;
      let hasValue = false;
      for (const row of rows) {
        const value = Number(row[column.field]);
        if (Number.isFinite(value)) {
          sum += value;
          hasValue = true;
        }
      }
      if (hasValue) totals[column.field] = Number(sum.toFixed(6));
    }
    return totals;
  }

  private buildChart(query: SemanticReportQuery, grid: CanonicalGrid): CanonicalChart {
    const chartType = this.resolveChartType(query);
    if (chartType === 'none' || !grid.rows.length) {
      return { enabled: false, type: 'none', xField: null, yField: null, data: [] };
    }
    if (chartType === 'kpi') {
      return { enabled: true, type: 'kpi', xField: null, yField: this.resolveMetricField(query, grid), data: grid.rows.slice(0, 1) };
    }

    const xField = this.resolveDimensionLabelField(query, grid);
    const yField = this.resolveMetricField(query, grid, xField);
    if (!xField || !yField) {
      this.logger.warn(`AI chart disabled because compatible fields were not present: dataset=${query.datasetId}, title=${query.title}`);
      return { enabled: false, type: 'none', xField: null, yField: null, data: [] };
    }

    const data = grid.rows
      .slice(0, chartType === 'pie' ? 12 : 50)
      .map((row) => ({
        ...row,
        [xField]: this.hasDisplayValue(row[xField]) ? row[xField] : 'Unknown',
        [yField]: this.numberOrZero(row[yField]),
      }));
    return { enabled: true, type: chartType, xField, yField, data };
  }

  private resolveChartType(query: SemanticReportQuery): CanonicalChart['type'] {
    if (query.output?.showChart === false) return 'none';
    const requested = query.output?.chartType ?? query.visualization?.type ?? 'none';
    if (requested === 'table' || requested === 'none') return 'none';
    if (['bar', 'line', 'pie', 'kpi'].includes(requested)) return requested as CanonicalChart['type'];
    return query.dimensions.length ? 'bar' : 'kpi';
  }

  private resolveDimensionLabelField(query: SemanticReportQuery, grid: CanonicalGrid): string | null {
    const preferred = [query.output?.xField, query.visualization?.x].filter(Boolean) as string[];
    for (const field of preferred) {
      const usable = this.usableGridField(field, grid);
      if (usable) return usable;
    }

    const dimension = query.dimensions.map((id) => this.catalog.getDimension(id)).find(Boolean) as CatalogDimension | undefined;
    if (!dimension) {
      return grid.columns.find((column) => column.dataType === 'text' || column.dataType === 'date')?.field ?? null;
    }

    const candidates = [
      this.dimensionLabelColumn(dimension),
      this.fallbackLabelColumn(dimension),
      ...this.knownLabelFallbacks(dimension),
      ...(Array.isArray(dimension.columns) ? dimension.columns : []),
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
      const field = this.usableGridField(candidate, grid);
      if (field) return field;
    }

    this.logger.warn(`AI chart label field was not available: dataset=${query.datasetId}, dimension=${dimension.dimensionId}`);
    return null;
  }

  private usableGridField(field: string, grid: CanonicalGrid): string | null {
    const normalized = field === 'month' && this.fieldExists('month_label', grid) ? 'month_label'
      : field === 'date' && this.fieldExists('date_label', grid) ? 'date_label'
        : field;
    if (!this.fieldExists(normalized, grid)) return null;
    if (grid.rows.length && grid.rows.every((row) => !this.hasDisplayValue(row[normalized]))) return null;
    return normalized;
  }

  private fieldExists(field: string, grid: CanonicalGrid): boolean {
    return grid.columns.some((column) => column.field === field) || grid.rows.some((row) => field in row);
  }

  private resolveMetricField(query: SemanticReportQuery, grid: CanonicalGrid, excludeField?: string | null): string | null {
    const candidates = [
      query.output?.yField,
      query.visualization?.y,
      ...query.metrics,
      ...grid.columns.filter((column) => column.field !== excludeField).map((column) => column.field),
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
      if (candidate === excludeField || !this.fieldExists(candidate, grid)) continue;
      if (grid.rows.some((row) => Number.isFinite(Number(row[candidate])))) return candidate;
    }
    return null;
  }

  private buildKpis(query: SemanticReportQuery, grid: CanonicalGrid, chart: CanonicalChart): CanonicalKpi[] {
    const rows = grid.rows;
    if (!rows.length) return [];
    const metricField = this.resolveMetricField(query, grid, chart.xField);
    if (!metricField) return [];
    const metricColumn = grid.columns.find((column) => column.field === metricField);
    const metricLabel = metricColumn?.label ?? this.metricLabel(query) ?? metricField;
    const metricDataType = metricColumn?.dataType ?? this.catalog.getMetric(metricField)?.dataType;

    if (query.mode === 'kpi' || !query.dimensions.length) {
      return grid.columns
        .filter((column) => rows.some((row) => Number.isFinite(Number(row[column.field]))))
        .slice(0, 8)
        .map((column) => ({
          label: column.label,
          value: rows[0][column.field],
          dataType: column.dataType,
        }));
    }

    if (query.mode === 'trend' || query.dimensions.includes('month')) {
      const values = rows
        .map((row) => ({ row, value: Number(row[metricField]) }))
        .filter((item) => Number.isFinite(item.value));
      if (!values.length) return [];
      const total = values.reduce((sum, item) => sum + item.value, 0);
      const highest = values.reduce((best, item) => (item.value > best.value ? item : best), values[0]);
      const lowest = values.reduce((best, item) => (item.value < best.value ? item : best), values[0]);
      const dimensionLabel = chart.xField ? (grid.columns.find((column) => column.field === chart.xField)?.label ?? 'Rows') : 'Rows';
      const itemName = dimensionLabel.toLowerCase() === 'month' ? 'Months' : dimensionLabel;
      const baseMetric = metricLabel.replace(/^Net\s+/i, '').replace(/^Gross\s+/i, '');
      return [
        { label: `Total ${baseMetric}`, value: Number(total.toFixed(6)), dataType: metricDataType },
        { label: `Number of ${itemName}`, value: values.length, dataType: 'number' },
        { label: `Highest ${baseMetric} ${dimensionLabel}`, value: highest.value, dataType: metricDataType, hint: chart.xField ? String(highest.row[chart.xField] ?? '') : undefined },
        { label: `Lowest ${baseMetric} ${dimensionLabel}`, value: lowest.value, dataType: metricDataType, hint: chart.xField ? String(lowest.row[chart.xField] ?? '') : undefined },
      ];
    }

    return [];
  }

  private assertFeatureEnabled(runtime: AiReportingRuntimeSettings) {
    if (!runtime.enabled) {
      throw new AiReportingBadRequest('AI_REPORTING_DISABLED', 'AI reporting is disabled for this environment or tenant');
    }
  }

  private assertRoleAllowed(security: ReportingSecurityContext, runtime: AiReportingRuntimeSettings) {
    if (security.userRole === 'SUPER_ADMIN') return;
    if (runtime.allowedRoles.length && !runtime.allowedRoles.includes(security.userRole)) {
      throw new ForbiddenException('Your role is not allowed to use AI reporting');
    }
  }

  private async resolveRuntimeSettings(tenantId: string): Promise<AiReportingRuntimeSettings> {
    const operational = await this.aiProvider.getTenantOperationalConfig(tenantId);
    let allowedRoles: string[] = [];
    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      const aiReporting = ((tenant?.settings as Record<string, any> | null)?.aiReporting ?? {}) as Record<string, any>;
      if (Array.isArray(aiReporting.allowedRoles)) {
        allowedRoles = aiReporting.allowedRoles.map(String).filter(Boolean);
      }
    }
    return {
      enabled: operational.enabled,
      summariesEnabled: operational.summariesEnabled,
      maxRows: operational.maxResultRows,
      monthlyUsageCap: operational.monthlyCompanyCallLimit,
      maskSensitiveFields: operational.maskSensitiveFields,
      timeoutMs: operational.timeoutMs,
      allowedRoles,
    };
  }

  private async resolveSecurityContext(user: any, request: AiReportRequest): Promise<ReportingSecurityContext> {
    if (!user?.tenantId || !user?.id) throw new ForbiddenException('User context is missing');

    const explicitCompanies = this.numberArray(user.allowedCompanyIds ?? user.companyIds ?? user.companies);
    const explicitBranches = this.uuidArray(user.allowedBranchIds ?? user.branchIds ?? user.locationIds ?? user.locations);

    const [branches, configs, locations, fiscalYear] = await Promise.all([
      this.prisma.margBranch.findMany({
        where: { tenantId: user.tenantId },
        select: { companyId: true, locationId: true },
      }),
      this.prisma.margSyncConfig.findMany({
        where: { tenantId: user.tenantId, isActive: true },
        select: { companyId: true },
      }),
      this.prisma.location.findMany({
        where: { tenantId: user.tenantId },
        select: { id: true },
      }),
      this.resolveFiscalYear(user.tenantId),
    ]);

    const tenantCompanyIds = [...new Set([...branches.map((b) => b.companyId), ...configs.map((c) => c.companyId)].filter((n) => Number.isInteger(n) && n > 0))];
    const tenantBranchIds = [...new Set([...branches.map((b) => b.locationId).filter(Boolean), ...locations.map((l) => l.id)])] as string[];

    const hasExplicitCompanyScope = explicitCompanies.length > 0;
    const hasExplicitBranchScope = explicitBranches.length > 0;
    const allowedCompanyIds = hasExplicitCompanyScope ? explicitCompanies : tenantCompanyIds;
    const allowedBranchIds = hasExplicitBranchScope ? explicitBranches : tenantBranchIds;

    if (request.companyId != null && hasExplicitCompanyScope && !allowedCompanyIds.includes(request.companyId)) {
      throw new ForbiddenException('Requested company is not allowed');
    }
    if (request.branchIds?.length && hasExplicitBranchScope) {
      const allowed = new Set(allowedBranchIds);
      if (request.branchIds.some((id) => !allowed.has(id))) throw new ForbiddenException('Requested branch is not allowed');
    }

    return {
      tenantId: user.tenantId,
      userId: user.id,
      userRole: user.role,
      permissions: user.permissions ?? [],
      requestedCompanyId: request.companyId,
      requestedBranchIds: request.branchIds,
      allowedCompanyIds,
      allowedBranchIds,
      hasExplicitCompanyScope,
      hasExplicitBranchScope,
      fiscalYear,
    };
  }

  private async resolveFiscalYear(tenantId: string) {
    const today = new Date();
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: {
        startDate: { lte: today },
        endDate: { gte: today },
        calendar: { tenantId, isDefault: true },
      },
      select: { calendarId: true, fiscalYear: true },
    });
    if (!period) return undefined;
    const periods = await this.prisma.fiscalPeriod.findMany({
      where: { calendarId: period.calendarId, fiscalYear: period.fiscalYear },
      select: { startDate: true, endDate: true },
      orderBy: { startDate: 'asc' },
    });
    if (!periods.length) return undefined;
    return {
      startDate: periods[0].startDate.toISOString().slice(0, 10),
      endDate: periods[periods.length - 1].endDate.toISOString().slice(0, 10),
      fiscalYear: String(period.fiscalYear),
    };
  }

  private uniqueReportAreas(datasets: Array<{ domain: string }>) {
    const seen = new Set<string>();
    return datasets
      .map((dataset) => this.titleCase(dataset.domain))
      .filter((domain) => {
        const key = domain.toLowerCase();
        if (!domain || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private catalogDrivenSuggestions(metadata: ReturnType<SemanticCatalogLoader['getLimitedMetadata']>) {
    const datasetIds = new Set(metadata.datasets.map((dataset) => dataset.datasetId));
    const suggestions = [
      datasetIds.has('purchase_items') ? 'Total purchase this fiscal year month-wise' : null,
      datasetIds.has('purchase_items') ? 'Supplier-wise purchase this month' : null,
      datasetIds.has('purchase_items') ? 'Item-wise purchase last month' : null,
      datasetIds.has('sales_items') ? 'Top selling products this month' : null,
      datasetIds.has('sales_items') ? 'Customer-wise sales this fiscal year' : null,
      datasetIds.has('stock_summary') ? 'Stock below minimum' : null,
      datasetIds.has('stock_batches') ? 'Expiring stock in next 90 days' : null,
      datasetIds.has('party_outstanding') ? 'Customer outstanding summary' : null,
      datasetIds.has('tax_register') ? 'Sales register with VAT details' : null,
      datasetIds.has('purchase_invoices') ? 'Purchase register with VAT details' : null,
      ...metadata.reportTemplates.map((template) => template.displayName),
      ...metadata.dashboardTemplates.map((template) => template.displayName),
    ].filter(Boolean) as string[];

    const seen = new Set<string>();
    return suggestions.filter((suggestion) => {
      const key = suggestion.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
  }

  private metricLabel(query: SemanticReportQuery) {
    return query.metrics
      .map((metricId) => this.catalog.getMetric(metricId)?.displayName ?? metricId)
      .join(', ');
  }

  private groupedByLabel(query: SemanticReportQuery) {
    if (query.dimensions.length) {
      return query.dimensions
        .map((dimensionId) => this.catalog.getDimension(dimensionId)?.displayName ?? dimensionId)
        .join(', ');
    }
    return query.mode === 'detail' ? 'Detail Rows' : 'Overall';
  }

  private describePeriodLabel(range: SemanticTimeRange | undefined) {
    if (!range || !range.preset || range.preset === 'unspecified') return 'Unspecified Period';
    if (range.preset === 'custom') return this.customPeriodLabel(range.startDate, range.endDate);
    if (range.preset === 'current_financial_year') return 'Current Financial Year';
    if (range.preset === 'last_financial_year') return 'Last Financial Year';
    if (range.preset === 'this_month') return this.formatMonthLabel(new Date());
    if (range.preset === 'last_month') {
      const date = new Date();
      date.setMonth(date.getMonth() - 1, 1);
      return this.formatMonthLabel(date);
    }
    return this.titleCase(range.preset.replace(/_/g, ' '));
  }

  private customPeriodLabel(startDate?: string | null, endDate?: string | null) {
    if (!startDate || !endDate) return 'Custom Period';
    const start = this.parseDate(startDate);
    const end = this.parseDate(endDate);
    if (!start || !end) return `${startDate} to ${endDate}`;
    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      return this.formatMonthLabel(start);
    }
    return `${this.formatDayLabel(start)} to ${this.formatDayLabel(end)}`;
  }

  private formatMonthLabel(value: unknown) {
    const date = this.parseDate(value);
    if (!date) return String(value ?? '');
    return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }

  private formatDayLabel(value: unknown) {
    const date = this.parseDate(value);
    if (!date) return String(value ?? '');
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private parseDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private dimensionLabelColumn(dimension: CatalogDimension): string | null {
    if (dimension.transform === 'calendar_month' || dimension.labelColumn === 'month') return 'month_label';
    if (dimension.labelColumn === 'date') return 'date_label';
    return dimension.labelColumn;
  }

  private fallbackLabelColumn(dimension: CatalogDimension): string {
    const explicit = (dimension as CatalogDimension & { fallbackLabelColumn?: string }).fallbackLabelColumn;
    if (explicit) return explicit;
    if (dimension.labelColumn === 'product_name') return 'product_code';
    if (dimension.labelColumn === 'customer_name') return 'customer_code';
    if (dimension.labelColumn === 'supplier_name') return 'supplier_code';
    if (dimension.labelColumn === 'branch_name') return 'branch_code';
    if (dimension.labelColumn === 'warehouse_name') return 'warehouse_code';
    const columns = Array.isArray(dimension.columns) ? dimension.columns : [];
    return columns.find((column) => column !== dimension.labelColumn && !column.endsWith('_id')) ?? dimension.labelColumn;
  }

  private knownLabelFallbacks(dimension: CatalogDimension) {
    const id = (dimension.dimensionId ?? dimension.labelColumn ?? '').toLowerCase();
    if (id.includes('product') || id.includes('item')) return ['product_name', 'product_code'];
    if (id.includes('customer')) return ['customer_name', 'customer_code'];
    if (id.includes('supplier')) return ['supplier_name', 'supplier_code'];
    if (id.includes('salesman')) return ['salesman_name', 'salesman_code'];
    if (id.includes('branch')) return ['branch_name', 'branch_code'];
    if (id.includes('warehouse')) return ['warehouse_name', 'warehouse_code'];
    if (id.includes('invoice')) return ['invoice_no', 'purchase_invoice_no', 'bill_no'];
    if (id.includes('batch')) return ['batch_no'];
    if (id === 'month') return ['month_label', 'month'];
    if (id === 'date') return ['date_label', 'date'];
    return [];
  }

  private unknownLabel(dimension: CatalogDimension) {
    const id = (dimension.dimensionId ?? dimension.labelColumn ?? '').toLowerCase();
    if (id.includes('product') || id.includes('item')) return 'Unknown Product';
    if (id.includes('customer')) return 'Unknown Customer';
    if (id.includes('supplier')) return 'Unknown Supplier';
    if (id.includes('salesman')) return 'Unknown Salesman';
    if (id.includes('branch')) return 'Unknown Branch';
    if (id.includes('warehouse')) return 'Unknown Warehouse';
    if (id.includes('invoice')) return 'Unknown Invoice';
    if (id.includes('batch')) return 'Unknown Batch';
    return `Unknown ${dimension.displayName}`;
  }

  private hasDisplayValue(value: unknown) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '' && value.trim() !== '-';
    return true;
  }

  private normalizeDataType(type?: string) {
    if (!type) return undefined;
    const normalized = type.toLowerCase();
    if (normalized === 'string') return 'text';
    if (['integer', 'int', 'decimal', 'numeric', 'quantity'].includes(normalized)) return 'number';
    return normalized;
  }

  private isNumericField(field: string) {
    return /(amount|value|sales|purchase|outstanding|balance|quantity|qty|rate|count|tax|discount|gross|net|stock|total|months)$/i.test(field);
  }

  private numberOrZero(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  private modeFromAnalysisType(analysisType?: SemanticReportQuery['analysisType']) {
    if (analysisType === 'ranking') return 'ranking';
    if (analysisType === 'detail' || analysisType === 'exception_list' || analysisType === 'ledger_detail') return 'detail';
    return 'aggregate';
  }

  private titleCase(value: string) {
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private summarizeIntent(query: SemanticReportQuery) {
    const dataset = this.catalog.getDataset(query.datasetId);
    return {
      datasetId: query.datasetId,
      datasetLabel: dataset?.description ?? query.datasetId,
      mode: query.mode,
      analysisType: query.analysisType,
      metrics: query.metrics
        .map((id) => {
          const metric = this.catalog.getMetric(id);
          return metric ? { metricId: metric.metricId, label: metric.displayName, dataType: metric.dataType } : null;
        })
        .filter((m): m is { metricId: string; label: string; dataType: string } => m !== null),
      dimensions: query.dimensions
        .map((id) => {
          const dimension = this.catalog.getDimension(id);
          return dimension ? { dimensionId: dimension.dimensionId, label: dimension.displayName } : null;
        })
        .filter((d): d is { dimensionId: string; label: string } => d !== null),
      timeRange: this.describeTimeRange(query.timeRange),
      limit: query.limit,
      sort: (query.sort ?? []).map((s) => ({
        metricId: s.metricId,
        dimensionId: s.dimensionId,
        columnId: s.columnId,
        direction: s.direction,
      })),
    };
  }

  private describeTimeRange(range: SemanticTimeRange | undefined) {
    if (!range) return null;
    if (range.preset === 'custom') {
      return { type: 'custom', startDate: range.startDate ?? null, endDate: range.endDate ?? null, fieldId: range.fieldId ?? null };
    }
    return { type: range.preset ?? 'unspecified', fieldId: range.fieldId ?? null };
  }

  private numberArray(value: unknown): number[] {
    return Array.isArray(value) ? value.map(Number).filter((n) => Number.isInteger(n)) : [];
  }

  private uuidArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v)) : [];
  }

  private auditUserId(user: any): string | null {
    return user?.role === 'SUPER_ADMIN' ? null : user?.id ?? null;
  }
}
