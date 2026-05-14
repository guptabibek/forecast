import { AiProviderService } from './ai-provider.service';
import { NlqParserService } from './nlq-parser.service';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import { ReportingSecurityContext, SemanticReportQuery } from './semantic-query.types';

describe('NlqParserService', () => {
  let aiProvider: jest.Mocked<Pick<AiProviderService, 'generateJson'>>;
  let loader: SemanticCatalogLoader;
  let parser: NlqParserService;

  const security: ReportingSecurityContext = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    userRole: 'ADMIN',
    permissions: ['reports.ai.execute', 'reports.sales.view'],
    allowedCompanyIds: [11093],
    allowedBranchIds: ['33333333-3333-4333-8333-333333333333'],
    hasExplicitCompanyScope: false,
    hasExplicitBranchScope: false,
  };

  beforeEach(() => {
    aiProvider = { generateJson: jest.fn() };
    loader = new SemanticCatalogLoader();
    loader.onModuleInit();
    parser = new NlqParserService(aiProvider as any, loader);
  });

  it('uses exact/common report templates only as shortcuts', async () => {
    const result = await parser.parseQuestion({
      question: 'Show top selling products this month',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).not.toHaveBeenCalled();
    expect(result.queryKind).toBe('single_report');
    expect((result as SemanticReportQuery).templateId).toBe('top_selling_products');
    expect((result as SemanticReportQuery).timeRange).toEqual({ preset: 'this_month' });
  });

  it('normalizes dynamic non-template AI semantic JSON', async () => {
    aiProvider.generateJson.mockResolvedValueOnce({
      status: 'ok',
      queryKind: 'single_report',
      mode: 'detail',
      domain: 'sales',
      datasetId: 'sales_invoices',
      metrics: [],
      dimensions: [],
      displayColumns: [
        { columnId: 'sales_invoice_date' },
        { columnId: 'sales_invoice_no' },
        { columnId: 'sales_customer_name' },
      ],
      filters: [
        { filterId: 'customer_filter', operator: 'contains', value: 'apollo' },
      ],
      time: {
        dateFieldId: 'sales_bill_date',
        rangeType: 'this_month',
        startDate: null,
        endDate: null,
      },
      sort: [
        { byColumnId: 'sales_invoice_date', direction: 'desc' },
      ],
      limit: 25,
      output: {
        showGrid: true,
        showChart: false,
        chartType: 'none',
      },
      assumptions: [],
      clarifyingQuestion: null,
      unsupportedReason: null,
    });

    const result = await parser.parseQuestion({
      question: 'List Apollo sales invoices this month',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(result.queryKind).toBe('single_report');
    expect((result as SemanticReportQuery).templateId).toBeUndefined();
    expect((result as SemanticReportQuery).mode).toBe('detail');
    expect((result as SemanticReportQuery).displayColumns).toEqual([
      'sales_invoice_date',
      'sales_invoice_no',
      'sales_customer_name',
    ]);
    expect((result as SemanticReportQuery).sort).toEqual([
      { columnId: 'sales_invoice_date', direction: 'desc' },
    ]);
  });

  it('uses requested top-N limit via shortcut without calling the LLM', async () => {
    const result = await parser.parseQuestion({
      question: 'Show top 5 selling products this month',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).not.toHaveBeenCalled();
    expect(result.queryKind).toBe('single_report');
    expect((result as SemanticReportQuery).templateId).toBe('top_selling_products');
    expect((result as SemanticReportQuery).limit).toBe(5);
    expect((result as SemanticReportQuery).timeRange).toEqual({ preset: 'this_month' });
  });

  it('parses absolute date ranges in the shortcut path', async () => {
    const result = await parser.parseQuestion({
      question: 'Show top selling products from 2026-04-01 to 2026-04-10',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).not.toHaveBeenCalled();
    expect((result as SemanticReportQuery).timeRange).toEqual({
      preset: 'custom',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
    });
  });

  it('parses MTD and current week period synonyms in the shortcut path', async () => {
    const mtd = await parser.parseQuestion({
      question: 'Show top selling products MTD',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });
    expect((mtd as SemanticReportQuery).timeRange).toEqual({ preset: 'this_month' });

    const currentWeek = await parser.parseQuestion({
      question: 'Show top selling products current week',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });
    expect((currentWeek as SemanticReportQuery).timeRange).toEqual({ preset: 'this_week' });
  });

  it('resolves "top N items wise sales for the month of <month>" without an LLM call', async () => {
    const result = await parser.parseQuestion({
      question: 'top 20 items wise sales for the month of may',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).not.toHaveBeenCalled();
    const report = result as SemanticReportQuery;
    expect(report.queryKind).toBe('single_report');
    expect(report.templateId).toBe('top_sales_value_products');
    expect(report.limit).toBe(20);
    expect(report.timeRange).toEqual({ preset: 'custom', startDate: '2026-05-01', endDate: '2026-05-31' });
  });

  it('returns unsupported as a first-class semantic state', async () => {
    aiProvider.generateJson.mockResolvedValueOnce({
      status: 'unsupported',
      queryKind: 'single_report',
      unsupportedReason: 'No approved payroll dataset is available.',
    });

    const result = await parser.parseQuestion({
      question: 'Show payroll by employee',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(result.queryKind).toBe('unsupported');
    expect((result as any).reason).toBe('No approved payroll dataset is available.');
  });
});
