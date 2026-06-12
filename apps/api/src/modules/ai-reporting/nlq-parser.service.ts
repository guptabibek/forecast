import { Injectable } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';
import { CLARIFICATION_RESPONSE_RULES } from './prompts/clarification.prompt';
import { buildDashboardPlannerPrompt } from './prompts/dashboard-planner.prompt';
import { NLQ_PROMPT_VERSION, NLQ_SYSTEM_PROMPT } from './prompts/nlq-system.prompt';
import { buildSemanticQueryGenerationPrompt } from './prompts/semantic-query-generation.prompt';
import { repairChangeRankingIntent, repairDatasetCoherence, repairGroupingIntent } from './grouping-intent.util';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import {
  AiReportAnalysisType,
  ReportingSecurityContext,
  SemanticDashboardQuery,
  SemanticFilter,
  SemanticOutput,
  SemanticQuery,
  SemanticQueryMode,
  SemanticReportQuery,
  SemanticSort,
  SemanticTimeRange,
  SemanticUnsupportedQuery,
  SemanticVisualization,
} from './semantic-query.types';

const OPERATOR_MAP: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
  in: 'IN',
  not_in: 'NOT IN',
  contains: 'ILIKE',
  between: 'BETWEEN',
  IN: 'IN',
  'NOT IN': 'NOT IN',
  ILIKE: 'ILIKE',
  BETWEEN: 'BETWEEN',
};

const ANALYSIS_MAP: Record<string, AiReportAnalysisType> = {
  summary: 'grouped_summary',
  detail: 'detail',
  ranking: 'ranking',
  trend: 'grouped_summary',
  comparison: 'grouped_summary',
  invoice_wise: 'grouped_summary',
  item_wise: 'grouped_summary',
  customer_wise: 'grouped_summary',
  supplier_wise: 'grouped_summary',
  salesman_wise: 'grouped_summary',
  dashboard: 'grouped_summary',
  grouped_summary: 'grouped_summary',
  exception_list: 'exception_list',
  ledger_detail: 'ledger_detail',
  accounting_summary: 'accounting_summary',
};
const MODE_MAP: Record<string, SemanticQueryMode> = {
  aggregate: 'aggregate',
  summary: 'aggregate',
  grouped_summary: 'aggregate',
  detail: 'detail',
  invoice_wise: 'detail',
  bill_wise: 'detail',
  ledger_detail: 'detail',
  exception_list: 'detail',
  ranking: 'ranking',
  trend: 'trend',
  comparison: 'comparison',
  dashboard: 'dashboard',
  kpi: 'kpi',
  accounting_summary: 'aggregate',
};

@Injectable()
export class NlqParserService {
  constructor(
    private readonly aiProvider: AiProviderService,
    private readonly catalogLoader: SemanticCatalogLoader,
  ) {}

  async parseQuestion(input: {
    question: string;
    outputMode?: string;
    currentDate: string;
    securityContext: ReportingSecurityContext;
    dashboardOnly?: boolean;
    requestId?: string;
  }): Promise<SemanticQuery> {
    if (!input.dashboardOnly) {
      const shortcut = this.tryTemplateShortcut(input.question, input.outputMode);
      if (shortcut) return shortcut;
      const unsupported = this.tryUnsupportedFutureTransactionQuestion(input.question, input.currentDate);
      if (unsupported) return unsupported;
    }

    const catalog = this.catalogLoader.getPromptCatalog();
    const system = [
      NLQ_SYSTEM_PROMPT,
      CLARIFICATION_RESPONSE_RULES,
      `Prompt version: ${NLQ_PROMPT_VERSION}`,
    ].join('\n\n');
    const userContext = {
      outputMode: input.outputMode ?? 'auto',
      currentDate: input.currentDate,
      dashboardOnly: input.dashboardOnly === true,
      requestedCompanyId: input.securityContext.requestedCompanyId,
      requestedBranchIds: input.securityContext.requestedBranchIds,
      allowedCompanyCount: input.securityContext.allowedCompanyIds.length,
      allowedBranchCount: input.securityContext.allowedBranchIds.length,
      userRole: input.securityContext.userRole,
      permissions: input.securityContext.permissions,
      fiscalYear: input.securityContext.fiscalYear,
    };
    const semanticCatalogJson = JSON.stringify(catalog);
    const userContextJson = JSON.stringify(userContext);
    const financialYearJson = JSON.stringify(input.securityContext.fiscalYear ?? null);
    const prompt = input.dashboardOnly
      ? buildDashboardPlannerPrompt({
          userQuestion: input.question,
          userContextJson,
          semanticCatalogJson,
        })
      : buildSemanticQueryGenerationPrompt({
          userQuestion: input.question,
          userContextJson,
          currentDate: input.currentDate,
          financialYearJson,
          semanticCatalogJson,
        });

    const response = await this.aiProvider.generateJson([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ], {
      tenantId: input.securityContext.tenantId,
      userId: input.securityContext.userId,
      requestId: input.requestId,
      callType: 'semantic_parse',
    });
    const normalized = this.normalizeAiResponse(response, input.question, input.dashboardOnly === true);
    return this.applyGroupingIntentGuard(input.question, normalized);
  }

  /**
   * Deterministic backstop for grouped/ranking questions the LLM degraded to
   * ungrouped output ("Top 5 routes with most sales" → top 5 rows). Repairs
   * the query when the ranked noun maps to a catalog dimension; converts to
   * a precise unsupported response when the noun is a known business entity
   * the catalog cannot group by. Leaves every other query untouched.
   */
  private applyGroupingIntentGuard(question: string, query: SemanticQuery): SemanticQuery {
    if (query.queryKind !== 'single_report') return query;
    const catalog = this.catalogLoader.getCatalog();
    // First normalize stray sibling-dataset IDs (dataset right, vocabulary
    // wrong), then shape change-ranking questions (delta vs previous period),
    // then repair dropped grouping intent.
    const coherent = repairChangeRankingIntent(question, repairDatasetCoherence(query, catalog), catalog);
    const result = repairGroupingIntent(question, coherent, catalog);
    if (result.unsupportedNoun) {
      return {
        queryKind: 'unsupported',
        title: 'Unsupported grouping dimension',
        reason: `The question ranks by "${result.unsupportedNoun}", but the reporting catalog has no ${result.unsupportedNoun} dimension to group by.`,
        followUpQuestions: [],
        assumptions: [],
        errorCode: 'MISSING_GROUPING_DIMENSION',
        missingCapabilities: [`${result.unsupportedNoun}_dimension`],
        availableAlternatives: [],
        recommendedSchemaFix: `Add a ${result.unsupportedNoun} dimension to the AI semantic catalog and expose its columns on the reporting views.`,
        unsupportedReason: `No ${result.unsupportedNoun} dimension is available in the reporting catalog.`,
      };
    }
    return result.query;
  }

  private normalizeAiResponse(response: unknown, question: string, dashboardOnly: boolean): SemanticQuery {
    const raw = this.asRecord(response);
    const status = String(raw.status ?? 'ok').toLowerCase();
    if (status === 'clarification_required') {
      return this.clarification(raw, 'Clarification required');
    }
    if (status === 'unsupported') {
      return this.unsupported(raw);
    }
    if (dashboardOnly || raw.queryKind === 'dashboard') {
      return this.normalizeDashboard(raw, question);
    }
    return this.normalizeReport(raw, question);
  }

  private normalizeDashboard(raw: Record<string, any>, question: string): SemanticDashboardQuery {
    const widgets = Array.isArray(raw.widgets)
      ? raw.widgets
          .map((widget) => this.asRecord(widget))
          .map((widget) => {
            const semanticQuery = this.asRecord(widget.semanticQuery ?? widget);
            return this.normalizeReport({
              ...semanticQuery,
              title: widget.title ?? semanticQuery.title,
            }, question);
          })
      : [];

    return {
      queryKind: 'dashboard',
      title: this.cleanText(raw.dashboardTitle ?? raw.title ?? this.titleFromQuestion(question, 'AI Dashboard')),
      dashboardId: this.resolveDashboardId(raw, widgets),
      widgets,
      timeRange: this.normalizeTimeRange(raw.time ?? raw.timeRange),
      assumptions: this.stringArray(raw.assumptions),
      followUpQuestions: this.stringArray(raw.followUpQuestions),
    };
  }

  private normalizeReport(raw: Record<string, any>, question: string): SemanticReportQuery {
    const output = this.normalizeOutput(raw.output, raw.visualization);
    const visualization = this.normalizeVisualization(raw.visualization, output);
    const metrics = this.idArray(raw.metrics, 'metricId');
    const dimensions = this.idArray(raw.dimensions, 'dimensionId');
    const displayColumns = this.idArray(raw.displayColumns, 'columnId');
    const mode = this.normalizeMode(raw.mode ?? raw.analysisType);
    return {
      queryKind: 'single_report',
      title: this.cleanText(raw.title ?? this.titleFromQuestion(question, 'AI Report')),
      templateId: this.optionalString(raw.templateId),
      datasetId: String(raw.datasetId ?? ''),
      domain: this.optionalString(raw.domain) as any,
      mode,
      analysisType: ANALYSIS_MAP[String(raw.analysisType ?? '').toLowerCase()] ?? 'grouped_summary',
      metrics,
      dimensions,
      displayColumns,
      filters: this.normalizeFilters(raw.filters),
      timeRange: this.normalizeTimeRange(raw.time ?? raw.timeRange),
      comparison: this.normalizeComparison(raw.comparison),
      sort: this.normalizeSort(raw.sort),
      limit: this.normalizeLimit(raw.limit),
      visualization,
      output,
      assumptions: this.stringArray(raw.assumptions),
      followUpQuestions: this.stringArray(raw.followUpQuestions),
    };
  }

  private normalizeFilters(filters: unknown): SemanticFilter[] {
    if (!Array.isArray(filters)) return [];
    return filters.slice(0, 20).map((item) => {
      const filter = this.asRecord(item);
      return {
        filterId: this.optionalString(filter.filterId),
        column: this.optionalString(filter.column),
        operator: OPERATOR_MAP[String(filter.operator ?? '').trim()] ?? String(filter.operator ?? '').toUpperCase(),
        value: this.normalizeFilterValue(filter.value),
      };
    });
  }

  private normalizeFilterValue(value: unknown): unknown {
    const record = this.asRecord(value);
    if (Object.keys(record).length && ('from' in record || 'to' in record)) {
      return {
        ...(record.from != null ? { from: record.from } : {}),
        ...(record.to != null ? { to: record.to } : {}),
      };
    }
    return value;
  }

  private normalizeSort(sort: unknown): SemanticSort[] {
    if (!Array.isArray(sort)) return [];
    return sort.slice(0, 3).map((item) => {
      const value = this.asRecord(item);
      return {
        metricId: this.optionalString(value.byMetricId ?? value.metricId),
        dimensionId: this.optionalString(value.byDimensionId ?? value.dimensionId),
        columnId: this.optionalString(value.byColumnId ?? value.columnId),
        fieldId: this.optionalString(value.fieldId),
        column: this.optionalString(value.column),
        direction: String(value.direction).toLowerCase() === 'asc' ? 'asc' : 'desc',
      };
    });
  }

  private normalizeTimeRange(time: unknown): SemanticTimeRange | undefined {
    const value = this.asRecord(time);
    if (!Object.keys(value).length) return undefined;
    const rangeType = String(value.rangeType ?? value.preset ?? 'unspecified').toLowerCase();
    if (rangeType === 'unspecified') {
      return value.dateFieldId || value.fieldId
        ? { fieldId: String(value.dateFieldId ?? value.fieldId), preset: 'unspecified' }
        : { preset: 'unspecified' };
    }
    return {
      preset: this.mapRangeType(rangeType),
      startDate: this.optionalString(value.startDate),
      endDate: this.optionalString(value.endDate),
      fieldId: this.optionalString(value.dateFieldId ?? value.fieldId),
    };
  }

  private normalizeVisualization(visualization: unknown, output?: SemanticOutput): SemanticVisualization {
    if (output) {
      if (!output.showChart || output.chartType === 'none') return { type: 'table' };
      return {
        type: output.chartType,
        x: output.xField ?? undefined,
        y: output.yField ?? undefined,
      };
    }
    const value = this.asRecord(visualization);
    const type = ['table', 'kpi', 'bar', 'line', 'pie', 'none'].includes(String(value.type)) ? value.type : 'table';
    const dimension = this.optionalString(value.xDimensionId);
    const metric = this.optionalString(value.yMetricId);
    return {
      type,
      x: dimension ? this.catalogLoader.getDimension(dimension)?.labelColumn : this.optionalString(value.x),
      y: metric ?? this.optionalString(value.y),
    };
  }

  private normalizeOutput(output: unknown, visualization: unknown): SemanticOutput | undefined {
    const value = this.asRecord(output);
    if (Object.keys(value).length) {
      const chartType = ['bar', 'line', 'pie', 'kpi', 'none'].includes(String(value.chartType)) ? value.chartType : 'none';
      return {
        showGrid: value.showGrid !== false,
        showChart: value.showChart === true && chartType !== 'none',
        chartType,
        xField: this.optionalString(value.xField) ?? null,
        yField: this.optionalString(value.yField) ?? null,
      };
    }
    const vis = this.asRecord(visualization);
    if (!Object.keys(vis).length) return undefined;
    const type = ['bar', 'line', 'pie', 'kpi'].includes(String(vis.type)) ? vis.type : 'none';
    return {
      showGrid: true,
      showChart: type !== 'none',
      chartType: type as SemanticOutput['chartType'],
      xField: this.optionalString(vis.x),
      yField: this.optionalString(vis.y),
    };
  }

  private normalizeComparison(comparison: unknown) {
    const value = this.asRecord(comparison);
    if (!Object.keys(value).length) return undefined;
    const type = ['previous_period', 'previous_year', 'custom', 'none'].includes(String(value.type)) ? value.type : 'none';
    return {
      enabled: value.enabled === true,
      type,
      startDate: this.optionalString(value.startDate) ?? null,
      endDate: this.optionalString(value.endDate) ?? null,
      // 'change' ranks by the period-over-period delta instead of stacking
      // both periods ("top 10 items whose sales decreased vs last month").
      ...(String(value.rankBy) === 'change' ? { rankBy: 'change' as const } : {}),
    };
  }

  private resolveDashboardId(raw: Record<string, any>, widgets: SemanticReportQuery[]): string {
    const provided = this.optionalString(raw.dashboardId);
    if (provided && this.catalogLoader.getDashboard(provided)) return provided;
    const domain = String(raw.domain ?? this.catalogLoader.getDataset(widgets[0]?.datasetId)?.domain ?? '').toLowerCase();
    if (domain === 'purchase') return 'purchase_dashboard';
    if (domain === 'inventory') return 'inventory_dashboard';
    if (['accounting', 'outstanding', 'tax'].includes(domain)) return 'finance_dashboard';
    return 'sales_dashboard';
  }

  private clarification(raw: Record<string, any>, fallbackTitle: string): SemanticQuery {
    const question = this.optionalString(raw.clarifyingQuestion);
    return {
      queryKind: 'clarification',
      title: fallbackTitle,
      reason: this.cleanText(raw.unsupportedReason ?? raw.reason ?? raw.clarifyingQuestion ?? fallbackTitle),
      followUpQuestions: question ? [question] : this.stringArray(raw.followUpQuestions),
      assumptions: this.stringArray(raw.assumptions),
    };
  }

  private unsupported(raw: Record<string, any>): SemanticUnsupportedQuery {
    const reason = this.cleanText(raw.unsupportedReason ?? raw.reason ?? 'The approved AI reporting catalog cannot answer this request');
    return {
      queryKind: 'unsupported',
      title: 'Unsupported report request',
      reason,
      followUpQuestions: this.stringArray(raw.followUpQuestions),
      assumptions: this.stringArray(raw.assumptions),
      errorCode: this.optionalString(raw.errorCode),
      missingCapabilities: this.stringArray(raw.missingCapabilities),
      availableAlternatives: this.stringArray(raw.availableAlternatives),
      recommendedSchemaFix: this.optionalString(raw.recommendedSchemaFix) ?? null,
      unsupportedReason: reason,
    };
  }

  private idArray(value: unknown, key: string): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => typeof item === 'string' ? item : this.optionalString(this.asRecord(item)[key])).filter(Boolean);
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 10) : [];
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private normalizeLimit(value: unknown): number | undefined {
    const limit = Number(value);
    return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : undefined;
  }

  private normalizeMode(value: unknown): SemanticQueryMode {
    return MODE_MAP[String(value ?? '').toLowerCase()] ?? 'aggregate';
  }

  private mapRangeType(rangeType: string): SemanticTimeRange['preset'] {
    if (['today', 'yesterday', 'this_month', 'last_month', 'current_financial_year', 'custom', 'last_7_days', 'last_30_days', 'unspecified'].includes(rangeType)) {
      return rangeType as SemanticTimeRange['preset'];
    }
    if (rangeType === 'this_week' || rangeType === 'last_week' || rangeType === 'this_quarter' || rangeType === 'last_quarter' || rangeType === 'last_financial_year') {
      return rangeType as SemanticTimeRange['preset'];
    }
    return 'current_financial_year';
  }

  private titleFromQuestion(question: string, fallback: string): string {
    const title = this.cleanText(question).replace(/\?+$/g, '');
    return title ? title.slice(0, 120) : fallback;
  }

  private cleanText(value: unknown): string {
    return String(value ?? '').replace(/[^\w\s.,:/()-]/g, '').trim();
  }

  private tryTemplateShortcut(question: string, outputMode?: string): SemanticReportQuery | null {
    const catalog = this.catalogLoader.getCatalog();
    const cleanedQuestion = this.normalizeShortcutText(question);
    if (!cleanedQuestion) return null;
    if (this.hasComplexShortcutSignal(cleanedQuestion)) return null;
    const { text: phraseWithoutRank, rankLimit } = this.extractRankLimit(cleanedQuestion);
    const normalizedQuestion = this.stripShortcutNoise(phraseWithoutRank);
    if (!normalizedQuestion) return null;

    const rankStripped = rankLimit
      ? normalizedQuestion.replace(/^(top|best|highest|bottom|lowest|worst)\s+/, '').trim()
      : '';
    const candidatePhrases = [normalizedQuestion, rankStripped].filter(Boolean);
    for (const template of catalog.reportTemplates) {
      const terms = [template.displayName, ...(template.synonyms ?? [])]
        .map((term) => this.normalizeShortcutText(term))
        .filter(Boolean);
      if (!terms.some((term) => candidatePhrases.some((phrase) => phrase === term || phrase === `${term}s`))) continue;
      const chartType = outputMode === 'table' ? 'table' : ((template.visualization as SemanticVisualization['type']) || 'table');
      const limit = rankLimit ?? template.defaultLimit;
      const assumptions = [
        'Using the default date range from the semantic catalog.',
        ...(rankLimit ? [`Using requested top ${rankLimit} limit.`] : []),
      ];
      return {
        queryKind: 'single_report',
        title: template.displayName,
        templateId: template.templateId,
        datasetId: template.datasetId,
        mode: this.normalizeMode(template.analysisType),
        analysisType: template.analysisType,
        metrics: template.defaultMetrics,
        dimensions: template.defaultDimensions,
        displayColumns: template.defaultDisplayColumns,
        filters: template.defaultFilters ?? [],
        timeRange: undefined,
        sort: template.defaultSort,
        limit,
        visualization: {
          type: outputMode === 'chart' && chartType === 'table' ? 'bar' : chartType,
        },
        output: {
          showGrid: true,
          showChart: outputMode === 'chart' || (outputMode !== 'table' && !['table', 'none'].includes(String(chartType))),
          chartType: outputMode === 'chart' && chartType === 'table' ? 'bar' : (chartType === 'table' ? 'none' : chartType as any),
        },
        assumptions,
        followUpQuestions: [],
      };
    }
    return null;
  }

  private tryUnsupportedFutureTransactionQuestion(question: string, currentDate: string): SemanticUnsupportedQuery | null {
    const text = this.normalizeShortcutText(question);
    const yearRange = this.parseCalendarYearRange(text);
    if (!yearRange) return null;
    const currentYear = Number(String(currentDate).slice(0, 4));
    if (!Number.isInteger(currentYear) || yearRange.year <= currentYear) return null;
    if (/\b(expir|expiry|due|promised|reorder)\b/.test(text)) return null;

    const domain = /\b(purchase|purchases|bought|buying|supplier|vendors?)\b/.test(text)
      ? 'purchase'
      : /\b(sales?|sold|selling|revenue|invoice|bill|customer)\b/.test(text)
        ? 'sales'
        : null;
    if (!domain || this.hasForecastOrProjectionDataset(domain)) return null;

    const capability = `${domain}_forecast_or_projection_dataset`;
    const reason = `${domain === 'sales' ? 'Sales' : 'Purchase'} transaction reports for ${yearRange.year} require an approved forecast/projection dataset; the current catalog only supports actual recorded transactions.`;
    return {
      queryKind: 'unsupported',
      title: 'Unsupported future transaction report',
      reason,
      followUpQuestions: [],
      assumptions: [],
      errorCode: 'FUTURE_TRANSACTION_UNSUPPORTED',
      missingCapabilities: [capability],
      availableAlternatives: [
        `Ask for actual ${domain} transactions in a completed period.`,
        `Expose an approved ${domain} forecast/projection dataset in the semantic catalog.`,
      ],
      recommendedSchemaFix: `Add an allowed ${domain} forecast/projection dataset, metrics, dimensions, and date field to the AI semantic catalog.`,
      unsupportedReason: reason,
    };
  }

  private hasForecastOrProjectionDataset(domain: 'sales' | 'purchase'): boolean {
    return this.catalogLoader.getCatalog().datasets.some((dataset) => {
      if (!dataset.allowedForNlq || dataset.domain !== domain) return false;
      const text = this.normalizeShortcutText([
        dataset.datasetId,
        dataset.description,
        dataset.grain,
        ...(dataset.synonyms ?? []),
      ].join(' '));
      return /\b(forecast|projection|projected|prediction|plan|budget)\b/.test(text);
    });
  }

  private extractRankLimit(text: string): { text: string; rankLimit?: number } {
    const match = text.match(/\b(?:top|best|highest|bottom|lowest|worst)\s+(\d{1,3})\b/);
    if (!match) return { text };
    const limit = Number(match[1]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) return { text };
    const replaced = text.replace(match[0], match[0].replace(/\s+\d{1,3}\b/, '')).replace(/\s+/g, ' ').trim();
    return { text: replaced, rankLimit: limit };
  }

  private normalizeShortcutText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private stripShortcutNoise(value: string): string {
    return value
      .replace(/^(show|list|get|give me|display|generate|create|what are|which are)\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hasComplexShortcutSignal(text: string): boolean {
    const dateSignals = /\b(today|yesterday|week|month|quarter|fy|ytd|mtd|qtd|year|from|between|during|january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec|20\d{2})\b/;
    const sensitiveOrLegal = /\b(vat|gst|pan|tax id|legal|license|registration|bank|phone|email|address)\b/;
    const comparison = /\b(compare|comparison|versus|vs|growth|increase|decrease|previous|last year|same period)\b/;
    const futureOrExpiry = /\b(will|future|forecast|projection|projected|due|expire|expires|expired|expiring|expiry)\b/;
    const namedEntityFilter = /\b(for|with|without|where|filter|only)\s+(customer|supplier|party|product|item|sku|batch|brand|salesman|warehouse|branch)\b/;
    const multiDimension = (text.match(/\bwise\b/g) ?? []).length > 1 || /\bby\s+\w+\s+(and|,)\s+\w+\b/.test(text);
    const extraMetric = /\b(quantity|qty|value|amount|rate|tax|discount|margin|profit|stock value)\s+(and|with)|\b(and|with)\s+(quantity|qty|value|amount|rate|tax|discount|margin|profit|stock value)\b/;
    return dateSignals.test(text)
      || sensitiveOrLegal.test(text)
      || comparison.test(text)
      || futureOrExpiry.test(text)
      || namedEntityFilter.test(text)
      || multiDimension
      || extraMetric.test(text);
  }

  private parseCalendarYearRange(text: string): { year: number; startDate: string; endDate: string } | null {
    const match = this.normalizeShortcutText(text).match(/\b(?:in|for|during|by|year)?\s*(20\d{2})\b/);
    if (!match) return null;
    const year = Number(match[1]);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
    return { year, startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }

  private asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  }
}
