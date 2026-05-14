import { Injectable } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';
import { CLARIFICATION_RESPONSE_RULES } from './prompts/clarification.prompt';
import { buildDashboardPlannerPrompt } from './prompts/dashboard-planner.prompt';
import { NLQ_PROMPT_VERSION, NLQ_SYSTEM_PROMPT } from './prompts/nlq-system.prompt';
import { buildSemanticQueryGenerationPrompt } from './prompts/semantic-query-generation.prompt';
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
    return this.normalizeAiResponse(response, input.question, input.dashboardOnly === true);
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
      return [record.from, record.to].filter((item) => item != null);
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
    return {
      queryKind: 'unsupported',
      title: 'Unsupported report request',
      reason: this.cleanText(raw.unsupportedReason ?? raw.reason ?? 'The approved AI reporting catalog cannot answer this request'),
      followUpQuestions: this.stringArray(raw.followUpQuestions),
      assumptions: this.stringArray(raw.assumptions),
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
      const timeRange = this.shortcutTimeRange(question);
      const chartType = outputMode === 'table' ? 'table' : ((template.visualization as SemanticVisualization['type']) || 'table');
      const limit = rankLimit ?? template.defaultLimit;
      const assumptions = [
        ...(timeRange ? [] : ['Using the default date range from the semantic catalog.']),
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
        timeRange,
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
      .replace(/\s+(for|in|during)?\s*(today|yesterday|this week|current week|previous week|last week|this month|current month|mtd|month to date|last month|previous month|prev month|this quarter|current quarter|qtd|quarter to date|last quarter|previous quarter|current financial year|this financial year|current fiscal year|this fiscal year|current fy|this fy|ytd|year to date|last financial year|previous financial year|last fiscal year|previous fiscal year|last fy|previous fy|last 7 days|last 30 days)\b.*$/, '')
      .replace(/\s+(from|between)\s+.*$/, '')
      .replace(/\s+(for|in|during)\s+(the\s+)?(month of\s+)?(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b.*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private shortcutTimeRange(question: string): SemanticTimeRange | undefined {
    const lowered = question.toLowerCase();
    const custom = this.parseAbsoluteDateRange(lowered);
    if (custom) return { preset: 'custom', startDate: custom.startDate, endDate: custom.endDate };
    const monthName = this.parseMonthName(lowered);
    if (monthName) return { preset: 'custom', startDate: monthName.startDate, endDate: monthName.endDate };
    const text = this.normalizeShortcutText(question);
    if (/\btoday\b/.test(text)) return { preset: 'today' };
    if (/\byesterday\b/.test(text)) return { preset: 'yesterday' };
    if (/\b(this week|current week)\b/.test(text)) return { preset: 'this_week' };
    if (/\b(last week|previous week)\b/.test(text)) return { preset: 'last_week' };
    if (/\b(this month|current month|mtd|month to date)\b/.test(text)) return { preset: 'this_month' };
    if (/\b(last month|previous month|prev month)\b/.test(text)) return { preset: 'last_month' };
    if (/\b(this quarter|current quarter|qtd|quarter to date)\b/.test(text)) return { preset: 'this_quarter' };
    if (/\b(last quarter|previous quarter)\b/.test(text)) return { preset: 'last_quarter' };
    if (/\b(current|this) (financial year|fiscal year|fy|ytd|year to date)\b/.test(text)) return { preset: 'current_financial_year' };
    if (/\b(last|previous) (financial year|fiscal year|fy)\b/.test(text)) return { preset: 'last_financial_year' };
    if (/\blast 7 days\b/.test(text)) return { preset: 'last_7_days' };
    if (/\blast 30 days\b/.test(text)) return { preset: 'last_30_days' };
    return undefined;
  }

  private parseMonthName(text: string): { startDate: string; endDate: string } | null {
    const months: Record<string, number> = {
      january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
      may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
      october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
    };
    const match = text.match(/\b(?:month of|in (?:the month of )?|during|for (?:the month of )?)\s*(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b(?:\s+(\d{4}))?/i);
    if (!match) return null;
    const month = months[match[1].toLowerCase()];
    if (!month) return null;
    const today = new Date();
    let year = match[2] ? Number(match[2]) : today.getFullYear();
    if (!match[2] && month > today.getMonth() + 1) year = today.getFullYear() - 1;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return { startDate: this.formatIsoDate(start), endDate: this.formatIsoDate(end) };
  }

  private formatIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private parseAbsoluteDateRange(text: string): { startDate: string; endDate: string } | null {
    const dateToken = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[\\s/\\-][a-z]{3,9}(?:[\\s/\\-]\\d{2,4})?|[a-z]{3,9}\\s+\\d{1,2}(?:\\s*,?\\s*\\d{2,4})?|\\d{1,2}[\\s/\\-]\\d{1,2}[\\s/\\-]\\d{2,4})';
    const match = text.match(new RegExp(`(?:from|between)\\s+${dateToken}\\s+(?:to|and|\\-)\\s+${dateToken}`, 'i'));
    if (!match) return null;
    const start = this.normalizeDateToken(match[1]);
    const end = this.normalizeDateToken(match[2]);
    if (!start || !end) return null;
    if (start > end) return null;
    return { startDate: start, endDate: end };
  }

  private normalizeDateToken(token: string): string | null {
    const trimmed = token.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const months: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
      may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
      oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    const today = new Date();
    const monthDayYear = trimmed.match(/^([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{2,4}))?$/i);
    if (monthDayYear) {
      const month = months[monthDayYear[1].toLowerCase()];
      const day = Number(monthDayYear[2]);
      const year = monthDayYear[3] ? this.normalizeYear(Number(monthDayYear[3])) : today.getFullYear();
      if (month && day >= 1 && day <= 31) return this.formatDate(year, month, day);
    }
    const dayMonthYear = trimmed.match(/^(\d{1,2})[\s\/\-]([a-z]+)(?:[\s\/\-](\d{2,4}))?$/i);
    if (dayMonthYear) {
      const day = Number(dayMonthYear[1]);
      const month = months[dayMonthYear[2].toLowerCase()];
      const year = dayMonthYear[3] ? this.normalizeYear(Number(dayMonthYear[3])) : today.getFullYear();
      if (month && day >= 1 && day <= 31) return this.formatDate(year, month, day);
    }
    const numeric = trimmed.match(/^(\d{1,2})[\s\/\-](\d{1,2})[\s\/\-](\d{2,4})$/);
    if (numeric) {
      const day = Number(numeric[1]);
      const month = Number(numeric[2]);
      const year = this.normalizeYear(Number(numeric[3]));
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return this.formatDate(year, month, day);
    }
    return null;
  }

  private normalizeYear(year: number): number {
    if (year >= 100) return year;
    return year >= 70 ? 1900 + year : 2000 + year;
  }

  private formatDate(year: number, month: number, day: number): string {
    const d = new Date(year, month - 1, day);
    if (Number.isNaN(d.getTime()) || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  private asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  }
}
