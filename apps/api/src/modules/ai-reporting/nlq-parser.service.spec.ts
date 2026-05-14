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

  it('uses exact simple report templates only as shortcuts', async () => {
    const result = await parser.parseQuestion({
      question: 'Top Selling Products',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).not.toHaveBeenCalled();
    expect(result.queryKind).toBe('single_report');
    expect((result as SemanticReportQuery).templateId).toBe('top_selling_products');
    expect((result as SemanticReportQuery).timeRange).toBeUndefined();
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
      question: 'Top 5 Selling Products',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).not.toHaveBeenCalled();
    expect(result.queryKind).toBe('single_report');
    expect((result as SemanticReportQuery).templateId).toBe('top_selling_products');
    expect((result as SemanticReportQuery).limit).toBe(5);
    expect((result as SemanticReportQuery).timeRange).toBeUndefined();
  });

  it('does not shortcut template-like queries with date ranges', async () => {
    aiProvider.generateJson.mockResolvedValueOnce({
      status: 'ok',
      queryKind: 'single_report',
      mode: 'ranking',
      domain: 'sales',
      datasetId: 'sales_items',
      metrics: [{ metricId: 'sold_quantity' }],
      dimensions: [{ dimensionId: 'sales_product' }],
      displayColumns: [],
      filters: [],
      time: {
        dateFieldId: 'invoice_date',
        rangeType: 'custom',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
      },
      sort: [{ byMetricId: 'sold_quantity', direction: 'desc' }],
      limit: 10,
      output: {
        showGrid: true,
        showChart: true,
        chartType: 'bar',
        xField: 'product_name',
        yField: 'sold_quantity',
      },
      assumptions: [],
      clarifyingQuestion: null,
      unsupportedReason: null,
    });

    const result = await parser.parseQuestion({
      question: 'Show top selling products from 2026-04-01 to 2026-04-10',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).toHaveBeenCalled();
    expect((result as SemanticReportQuery).timeRange).toEqual({
      preset: 'custom',
      fieldId: 'invoice_date',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
    });
  });

  it('routes "top N items wise sales for the month of <month>" through the AI parser', async () => {
    aiProvider.generateJson.mockResolvedValueOnce({
      status: 'ok',
      queryKind: 'single_report',
      mode: 'ranking',
      domain: 'sales',
      datasetId: 'sales_items',
      metrics: [{ metricId: 'net_sales' }],
      dimensions: [{ dimensionId: 'sales_product' }],
      displayColumns: [],
      filters: [],
      time: {
        dateFieldId: 'invoice_date',
        rangeType: 'custom',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      },
      sort: [{ byMetricId: 'net_sales', direction: 'desc' }],
      limit: 20,
      output: {
        showGrid: true,
        showChart: true,
        chartType: 'bar',
        xField: 'product_name',
        yField: 'net_sales',
      },
      assumptions: [],
      clarifyingQuestion: null,
      unsupportedReason: null,
    });

    const result = await parser.parseQuestion({
      question: 'top 20 items wise sales for the month of may',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).toHaveBeenCalled();
    const report = result as SemanticReportQuery;
    expect(report.queryKind).toBe('single_report');
    expect(report.datasetId).toBe('sales_items');
    expect(report.metrics).toEqual(['net_sales']);
    expect(report.dimensions).toEqual(['sales_product']);
    expect(report.limit).toBe(20);
    expect(report.timeRange).toEqual({ preset: 'custom', fieldId: 'invoice_date', startDate: '2026-05-01', endDate: '2026-05-31' });
  });

  it('normalizes "how many items will be expiring in 2027" as an aggregate expiry query from AI output', async () => {
    aiProvider.generateJson.mockResolvedValueOnce({
      status: 'ok',
      queryKind: 'single_report',
      mode: 'kpi',
      domain: 'inventory',
      datasetId: 'stock_batches',
      metrics: [{ metricId: 'expiring_item_count' }],
      dimensions: [],
      displayColumns: [],
      filters: [],
      time: {
        dateFieldId: 'batch_expiry_date',
        rangeType: 'custom',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
      },
      sort: [{ byMetricId: 'expiring_item_count', direction: 'desc' }],
      limit: 1,
      output: {
        showGrid: true,
        showChart: true,
        chartType: 'kpi',
        xField: null,
        yField: 'expiring_item_count',
      },
      assumptions: [],
      clarifyingQuestion: null,
      unsupportedReason: null,
    });

    const result = await parser.parseQuestion({
      question: 'how many items will be expiring in 2027',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).toHaveBeenCalled();
    const report = result as SemanticReportQuery;
    expect(report.queryKind).toBe('single_report');
    expect(report.datasetId).toBe('stock_batches');
    expect(report.mode).toBe('kpi');
    expect(report.metrics).toEqual(['expiring_item_count']);
    expect(report.displayColumns).toEqual([]);
    expect(report.timeRange).toEqual({
      preset: 'custom',
      fieldId: 'batch_expiry_date',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
    });
    expect(report.sort).toEqual([{ metricId: 'expiring_item_count', direction: 'desc' }]);
  });

  it('preserves between filter objects emitted by the AI parser', async () => {
    aiProvider.generateJson.mockResolvedValueOnce({
      status: 'ok',
      queryKind: 'single_report',
      mode: 'detail',
      domain: 'sales',
      datasetId: 'sales_invoices',
      metrics: [],
      dimensions: [],
      displayColumns: [{ columnId: 'sales_invoice_no' }],
      filters: [{ filterId: 'date_range', operator: 'between', value: { from: '2026-05-01', to: '2026-05-31' } }],
      time: { dateFieldId: null, rangeType: 'unspecified', startDate: null, endDate: null },
      sort: [],
      limit: 25,
      output: { showGrid: true, showChart: false, chartType: 'none' },
      assumptions: [],
      clarifyingQuestion: null,
      unsupportedReason: null,
    });

    const result = await parser.parseQuestion({
      question: 'show sales invoices between 2026-05-01 and 2026-05-31',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect((result as SemanticReportQuery).filters?.[0].value).toEqual({ from: '2026-05-01', to: '2026-05-31' });
  });

  it('returns unsupported for future sales transaction queries unless a forecast dataset exists', async () => {
    const result = await parser.parseQuestion({
      question: 'show sales for 2027',
      outputMode: 'auto',
      currentDate: '2026-05-13',
      securityContext: security,
    });

    expect(aiProvider.generateJson).not.toHaveBeenCalled();
    expect(result.queryKind).toBe('unsupported');
    expect((result as any).errorCode).toBe('FUTURE_TRANSACTION_UNSUPPORTED');
    expect((result as any).missingCapabilities).toContain('sales_forecast_or_projection_dataset');
  });

  it('returns unsupported as a first-class semantic state', async () => {
    aiProvider.generateJson.mockResolvedValueOnce({
      status: 'unsupported',
      queryKind: 'single_report',
      errorCode: 'MISSING_DATASET',
      missingCapabilities: ['payroll_dataset'],
      availableAlternatives: ['Use staff attendance export outside AI reporting'],
      recommendedSchemaFix: 'Add a payroll dataset to the semantic catalog',
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
    expect((result as any).errorCode).toBe('MISSING_DATASET');
    expect((result as any).missingCapabilities).toEqual(['payroll_dataset']);
    expect((result as any).availableAlternatives).toEqual(['Use staff attendance export outside AI reporting']);
    expect((result as any).recommendedSchemaFix).toBe('Add a payroll dataset to the semantic catalog');
  });
});
