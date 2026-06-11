import { ForbiddenException } from '@nestjs/common';
import { AiReportingBadRequest } from './ai-reporting.errors';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import { SemanticQueryValidator } from './semantic-query.validator';
import { ReportingSecurityContext, SemanticReportQuery } from './semantic-query.types';

describe('SemanticQueryValidator', () => {
  let loader: SemanticCatalogLoader;
  let validator: SemanticQueryValidator;

  const security: ReportingSecurityContext = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    userRole: 'ADMIN',
    permissions: [
      'reports.ai.view',
      'reports.ai.execute',
      'reports.ai.dashboard',
      'reports.sales.view',
      'reports.purchase.view',
      'reports.inventory.view',
      'reports.outstanding.view',
      'reports.accounting.view',
      'reports.tax.view',
    ],
    requestedCompanyId: 11093,
    requestedBranchIds: ['33333333-3333-4333-8333-333333333333'],
    allowedCompanyIds: [11093],
    allowedBranchIds: ['33333333-3333-4333-8333-333333333333'],
    hasExplicitCompanyScope: true,
    hasExplicitBranchScope: true,
    fiscalYear: { startDate: '2026-04-01', endDate: '2027-03-31', fiscalYear: '2026/27' },
  };

  beforeEach(() => {
    loader = new SemanticCatalogLoader();
    loader.onModuleInit();
    validator = new SemanticQueryValidator(loader);
  });

  const report = (overrides: Partial<SemanticReportQuery>): SemanticReportQuery => ({
    queryKind: 'single_report',
    title: 'Top Selling Products',
    datasetId: 'sales_items',
    analysisType: 'ranking',
    metrics: ['sold_quantity', 'net_sales'],
    dimensions: ['sales_product'],
    filters: [],
    timeRange: { preset: 'this_month' },
    sort: [{ metricId: 'sold_quantity', direction: 'desc' }],
    limit: 25,
    visualization: { type: 'bar' },
    ...overrides,
  });

  it.each([
    ['top selling products this month', report({})],
    ['salesman-wise sales', report({ datasetId: 'sales_invoices', metrics: ['invoice_net_sales'], dimensions: ['sales_salesman'], sort: [{ metricId: 'invoice_net_sales', direction: 'desc' }] })],
    ['customer-wise sales', report({ datasetId: 'sales_invoices', metrics: ['invoice_net_sales'], dimensions: ['sales_customer'], sort: [{ metricId: 'invoice_net_sales', direction: 'desc' }] })],
    ['purchase item ranking', report({ datasetId: 'purchase_items', metrics: ['purchase_quantity', 'net_purchase'], dimensions: ['purchase_product'], sort: [{ metricId: 'purchase_quantity', direction: 'desc' }] })],
    [
      'stock below minimum',
      report({
        datasetId: 'stock_summary',
        metrics: ['current_stock', 'available_stock'],
        dimensions: ['stock_product', 'stock_warehouse'],
        filters: [{ filterId: 'low_stock_filter', operator: '=', value: 'LOW_STOCK' }],
        timeRange: undefined,
        sort: [{ metricId: 'current_stock', direction: 'asc' }],
      }),
    ],
    ['invoice-wise sales', report({ datasetId: 'sales_invoices', metrics: ['invoice_net_sales'], dimensions: ['sales_invoice', 'sales_customer'], sort: [{ metricId: 'invoice_net_sales', direction: 'desc' }] })],
  ])('accepts valid semantic query for %s', (_label, query) => {
    const result = validator.validate(query, security);

    expect(result.queryKind).toBe('single_report');
    expect((result as SemanticReportQuery).limit).toBeGreaterThan(0);
  });

  it('rejects an unknown dataset', () => {
    expect(() => validator.validate(report({ datasetId: 'raw_sales_invoice_items' }), security)).toThrow(AiReportingBadRequest);
  });

  it('rejects an unknown metric', () => {
    expect(() => validator.validate(report({ metrics: ['net_margin_secret'] }), security)).toThrow(AiReportingBadRequest);
  });

  it('rejects an unknown dimension', () => {
    expect(() => validator.validate(report({ dimensions: ['database_table_name'] }), security)).toThrow(AiReportingBadRequest);
  });

  it('rejects unsafe operators and suspicious filter values', () => {
    expect(() =>
      validator.validate(report({ filters: [{ filterId: 'product_filter', operator: 'DROP' as any, value: 'A' }] }), security),
    ).toThrow(AiReportingBadRequest);

    expect(() =>
      validator.validate(report({ filters: [{ filterId: 'product_filter', operator: 'ILIKE', value: "'; delete from x" }] }), security),
    ).toThrow(AiReportingBadRequest);
  });

  it('rejects invalid custom dates and oversized limits', () => {
    expect(() => validator.validate(report({ timeRange: { preset: 'custom', startDate: '2026-05-31', endDate: '2026-05-01' } }), security))
      .toThrow(AiReportingBadRequest);
    expect(() => validator.validate(report({ limit: 1001 }), security)).toThrow(AiReportingBadRequest);
  });

  it('rejects custom date ranges longer than three years', () => {
    expect(() => validator.validate(report({ timeRange: { preset: 'custom', startDate: '2020-01-01', endDate: '2026-05-01' } }), security))
      .toThrow(AiReportingBadRequest);
  });

  it('coerces a catalog filter with a wrong operator instead of failing the query', () => {
    const result = validator.validate(report({
      filters: [{ filterId: 'exclude_cancelled', operator: '=', value: false }],
    }), security) as SemanticReportQuery;

    const cancelFilters = (result.filters ?? []).filter((f) => f.filterId === 'exclude_cancelled' || f.column === 'is_cancelled');
    expect(cancelFilters.length).toBe(1);
    expect(cancelFilters[0].operator.toUpperCase()).toBe('IS DISTINCT FROM');
    expect(cancelFilters[0].value).toBe(true);
  });

  it('dedupes filters when the LLM duplicates a dataset default filter', () => {
    const result = validator.validate(report({
      filters: [
        { filterId: 'exclude_cancelled', operator: 'IS DISTINCT FROM', value: true },
        { filterId: 'exclude_cancelled', operator: '=', value: false },
      ],
    }), security) as SemanticReportQuery;

    const matches = (result.filters ?? []).filter((f) => f.filterId === 'exclude_cancelled' || f.column === 'is_cancelled');
    expect(matches.length).toBe(1);
  });

  it('allows dataset default filters that are intentionally not exposed as user filters', () => {
    const result = validator.validate(report({
      datasetId: 'stock_batches',
      metrics: ['batch_stock', 'expired_stock_value'],
      dimensions: ['batch_product', 'batch_warehouse', 'batch'],
      filters: [{ column: 'expiry_date', operator: '<=', value: { relativeDate: 'today_plus_90_days' } }],
      timeRange: undefined,
      sort: [{ fieldId: 'batch_expiry_date', direction: 'asc' }],
    }), security) as SemanticReportQuery;

    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: 'is_reportable_stock', operator: '=', value: true }),
    ]));
  });

  it('normalizes expiry detail sort ids emitted as metric ids into display-column sorts', () => {
    const result = validator.validate(report({
      datasetId: 'stock_batches',
      analysisType: 'detail',
      mode: 'detail',
      metrics: [],
      dimensions: [],
      displayColumns: [
        'batch_product_name',
        'batch_warehouse_name',
        'batch_no',
        'batch_expiry_date',
        'batch_days_to_expiry',
        'batch_current_stock',
      ],
      filters: [{ column: 'expiry_date', operator: '<=', value: { relativeDate: 'today_plus_90_days' } }],
      timeRange: undefined,
      sort: [{ metricId: 'batch_days_to_expiry', direction: 'asc' }],
    }), security) as SemanticReportQuery;

    expect(result.sort).toEqual([{ metricId: undefined, columnId: 'batch_days_to_expiry', direction: 'asc' }]);
  });

  it('accepts "how many items will be expiring in 2027" as a catalog aggregate expiry query', () => {
    const result = validator.validate(report({
      title: 'Items Expiring in 2027',
      datasetId: 'stock_batches',
      analysisType: 'grouped_summary',
      mode: 'kpi',
      metrics: ['expiring_item_count'],
      dimensions: [],
      displayColumns: [],
      filters: [],
      timeRange: { preset: 'custom', fieldId: 'batch_expiry_date', startDate: '2027-01-01', endDate: '2027-12-31' },
      sort: [{ metricId: 'expiring_item_count', direction: 'desc' }],
      limit: 1,
      visualization: { type: 'kpi' },
    }), security) as SemanticReportQuery;

    expect(result.datasetId).toBe('stock_batches');
    expect(result.mode).toBe('kpi');
    expect(result.metrics).toEqual(['expiring_item_count']);
    expect(result.dimensions).toEqual([]);
    expect(result.timeRange).toEqual(expect.objectContaining({
      fieldId: 'batch_expiry_date',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
    }));
  });

  it('accepts product and batch expiry detail queries with catalog display columns', () => {
    const result = validator.validate(report({
      title: 'Products Expiring in 2027',
      datasetId: 'stock_batches',
      analysisType: 'exception_list',
      mode: 'detail',
      metrics: [],
      dimensions: [],
      displayColumns: [
        'batch_product_name',
        'batch_no',
        'batch_expiry_date',
        'batch_current_stock',
        'batch_stock_value',
      ],
      filters: [],
      timeRange: { preset: 'custom', fieldId: 'expiry_date', startDate: '2027-01-01', endDate: '2027-12-31' },
      sort: [{ columnId: 'batch_expiry_date', direction: 'asc' }],
      limit: 100,
      visualization: { type: 'table' },
    }), security) as SemanticReportQuery;

    expect(result.mode).toBe('detail');
    expect(result.metrics).toEqual([]);
    expect(result.displayColumns).toEqual(expect.arrayContaining([
      'batch_product_name',
      'batch_no',
      'batch_expiry_date',
      'batch_current_stock',
      'batch_stock_value',
    ]));
    expect(result.timeRange?.fieldId).toBe('expiry_date');
  });

  it('accepts stock value expiring in 2027 as a catalog stock-value expiry metric', () => {
    const result = validator.validate(report({
      title: 'Stock Value Expiring in 2027',
      datasetId: 'stock_batches',
      analysisType: 'grouped_summary',
      mode: 'kpi',
      metrics: ['expiring_stock_value'],
      dimensions: [],
      displayColumns: [],
      filters: [],
      timeRange: { preset: 'custom', fieldId: 'batch_expiry_date', startDate: '2027-01-01', endDate: '2027-12-31' },
      sort: [{ metricId: 'expiring_stock_value', direction: 'desc' }],
      limit: 1,
      visualization: { type: 'kpi' },
    }), security) as SemanticReportQuery;

    expect(result.metrics).toEqual(['expiring_stock_value']);
    expect(result.timeRange?.fieldId).toBe('batch_expiry_date');
  });

  it('enforces report family permissions for the selected dataset', () => {
    const restricted = { ...security, userRole: 'SALES', permissions: ['reports.ai.execute', 'reports.sales.view'] };

    expect(() =>
      validator.validate(report({ datasetId: 'purchase_items', metrics: ['purchase_quantity'], dimensions: ['purchase_product'] }), restricted),
    ).toThrow(ForbiddenException);
  });

  it('allows tenant admins even when an older token is missing newly added report-family permissions', () => {
    const adminWithStalePermissions = { ...security, userRole: 'ADMIN', permissions: ['report:read', 'reports.ai.execute'] };

    expect(() =>
      validator.validate(report({ datasetId: 'sales_items' }), adminWithStalePermissions),
    ).not.toThrow();
  });

  it('uses the item-level sales dataset when customer-wise sales has a product filter', () => {
    const result = validator.validate(report({
      templateId: 'customer_wise_sales',
      datasetId: 'sales_invoices',
      metrics: ['invoice_net_sales', 'sales_invoice_count'],
      dimensions: ['sales_customer'],
      filters: [{ filterId: 'product_filter', operator: 'ILIKE', value: 'TICAGRACE 90 10X14 TABS' }],
      sort: [{ metricId: 'invoice_net_sales', direction: 'desc' }],
      limit: 5,
    }), security) as SemanticReportQuery;

    expect(result.datasetId).toBe('sales_items');
    expect(result.metrics).toEqual(['net_sales', 'sales_item_invoice_count']);
    expect(result.dimensions).toEqual(['sales_item_customer']);
    expect(result.sort).toEqual([{ metricId: 'net_sales', direction: 'desc' }]);
    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ filterId: 'product_filter', operator: 'ILIKE', value: 'TICAGRACE 90 10X14 TABS' }),
    ]));
  });

  it('returns clarification queries without compiling a dataset', () => {
    const result = validator.validate({
      queryKind: 'clarification',
      title: 'Clarification',
      reason: 'Party wise could mean customer or supplier',
      followUpQuestions: ['Do you mean sales customers or purchase suppliers?'],
    }, security);

    expect(result.queryKind).toBe('clarification');
  });

  it('accepts dynamic detail semantic JSON with display columns and no fixed template', () => {
    const result = validator.validate({
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
        { columnId: 'sales_invoice_net_amount' },
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
      comparison: {
        enabled: false,
        type: 'none',
        startDate: null,
        endDate: null,
      },
      sort: [
        { byColumnId: 'sales_invoice_date', direction: 'desc' },
      ],
      limit: 50,
      output: {
        showGrid: true,
        showChart: false,
        chartType: 'none',
      },
      assumptions: ['Customer name resolved with a contains filter.'],
      clarifyingQuestion: null,
      unsupportedReason: null,
    }, security);

    expect(result.queryKind).toBe('single_report');
    expect((result as SemanticReportQuery).templateId).toBeUndefined();
    expect((result as SemanticReportQuery).mode).toBe('detail');
    expect((result as SemanticReportQuery).metrics).toEqual([]);
    expect((result as SemanticReportQuery).displayColumns).toEqual([
      'sales_invoice_date',
      'sales_invoice_no',
      'sales_customer_name',
      'sales_invoice_net_amount',
    ]);
    expect((result as SemanticReportQuery).filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ filterId: 'customer_filter', operator: 'ILIKE', value: 'apollo' }),
    ]));
  });

  it('preserves between filter objects during dynamic semantic normalization', () => {
    const result = validator.validate({
      status: 'ok',
      queryKind: 'single_report',
      mode: 'detail',
      domain: 'sales',
      datasetId: 'sales_invoices',
      metrics: [],
      dimensions: [],
      displayColumns: [{ columnId: 'sales_invoice_no' }],
      filters: [
        { filterId: 'date_range', operator: 'between', value: { from: '2026-05-01', to: '2026-05-31' } },
      ],
      time: {
        dateFieldId: null,
        rangeType: 'unspecified',
        startDate: null,
        endDate: null,
      },
      comparison: {
        enabled: false,
        type: 'none',
        startDate: null,
        endDate: null,
      },
      sort: [],
      limit: 50,
      output: {
        showGrid: true,
        showChart: false,
        chartType: 'none',
      },
      assumptions: [],
      clarifyingQuestion: null,
      unsupportedReason: null,
    }, security) as SemanticReportQuery;

    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ filterId: 'date_range', operator: 'BETWEEN', value: { from: '2026-05-01', to: '2026-05-31' } }),
    ]));
  });

  it('keeps unsupported dynamic semantic JSON distinct from clarification', () => {
    const result = validator.validate({
      status: 'unsupported',
      queryKind: 'single_report',
      mode: 'aggregate',
      domain: 'mixed',
      datasetId: null,
      metrics: [],
      dimensions: [],
      displayColumns: [],
      filters: [],
      time: {
        dateFieldId: null,
        rangeType: 'unspecified',
        startDate: null,
        endDate: null,
      },
      sort: [],
      limit: 50,
      output: {
        showGrid: true,
        showChart: false,
        chartType: 'none',
      },
      assumptions: [],
      clarifyingQuestion: null,
      errorCode: 'MISSING_CAPABILITY',
      missingCapabilities: ['payroll_dataset'],
      availableAlternatives: ['Use approved accounting reports'],
      recommendedSchemaFix: 'Add payroll dataset metadata',
      unsupportedReason: 'No approved payroll dataset is available.',
    }, security);

    expect(result.queryKind).toBe('unsupported');
    expect((result as any).reason).toBe('No approved payroll dataset is available.');
    expect((result as any).errorCode).toBe('MISSING_CAPABILITY');
    expect((result as any).missingCapabilities).toEqual(['payroll_dataset']);
    expect((result as any).availableAlternatives).toEqual(['Use approved accounting reports']);
    expect((result as any).recommendedSchemaFix).toBe('Add payroll dataset metadata');
  });
});

describe('SemanticQueryValidator custom range repair and re-validation', () => {
  let loader: SemanticCatalogLoader;
  let validator: SemanticQueryValidator;

  const security: ReportingSecurityContext = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    userRole: 'ADMIN',
    permissions: [
      'reports.ai.view',
      'reports.ai.execute',
      'reports.sales.view',
      'reports.inventory.view',
    ],
    allowedCompanyIds: [11093],
    allowedBranchIds: ['33333333-3333-4333-8333-333333333333'],
    hasExplicitCompanyScope: true,
    hasExplicitBranchScope: true,
  };

  beforeEach(() => {
    loader = new SemanticCatalogLoader();
    loader.onModuleInit();
    validator = new SemanticQueryValidator(loader);
  });

  const expiryReport = (timeRange: SemanticReportQuery['timeRange']): SemanticReportQuery => ({
    queryKind: 'single_report',
    title: 'Expiring stock in next 90 days',
    datasetId: 'stock_batches',
    metrics: ['expiring_stock_value', 'expiring_batch_count'],
    dimensions: [],
    filters: [],
    timeRange,
    limit: 100,
  });

  it('repairs a custom range missing endDate by anchoring it to today (no hard failure)', () => {
    const result = validator.validate(
      expiryReport({ preset: 'custom', startDate: '2026-06-01', endDate: undefined, fieldId: 'expiry_date' }),
      security,
    ) as SemanticReportQuery;
    expect(result.queryKind).toBe('single_report');
    expect(result.timeRange?.preset).toBe('custom');
    expect(result.timeRange?.startDate).toBe('2026-06-01');
    expect(result.timeRange?.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('repairs a custom range missing startDate (future expiry window) by anchoring to today', () => {
    const future = new Date();
    future.setDate(future.getDate() + 90);
    const futureIso = future.toISOString().slice(0, 10);
    const result = validator.validate(
      expiryReport({ preset: 'custom', startDate: undefined, endDate: futureIso, fieldId: 'expiry_date' }),
      security,
    ) as SemanticReportQuery;
    expect(result.timeRange?.preset).toBe('custom');
    expect(result.timeRange?.endDate).toBe(futureIso);
    expect(String(result.timeRange?.startDate) <= futureIso).toBe(true);
  });

  it('falls back to a default range when both custom dates are missing', () => {
    const result = validator.validate(
      expiryReport({ preset: 'custom', startDate: undefined, endDate: undefined, fieldId: 'expiry_date' }),
      security,
    ) as SemanticReportQuery;
    expect(result.queryKind).toBe('single_report');
    expect(result.timeRange?.preset).not.toBe('custom');
  });

  it('still rejects malformed (present but invalid) custom dates', () => {
    expect(() =>
      validator.validate(expiryReport({ preset: 'custom', startDate: 'not-a-date', endDate: '2026-09-01' }), security),
    ).toThrow(AiReportingBadRequest);
  });

  it('is idempotent: re-validating a validated query (the pinned-widget path) succeeds and is stable', () => {
    const first = validator.validate(
      {
        queryKind: 'single_report',
        title: 'Top Selling Products',
        datasetId: 'sales_items',
        analysisType: 'ranking',
        metrics: ['sold_quantity', 'net_sales'],
        dimensions: ['sales_product'],
        filters: [],
        timeRange: { preset: 'custom', startDate: '2026-05-01', endDate: '2026-05-31' },
        sort: [{ metricId: 'sold_quantity', direction: 'desc' }],
        limit: 25,
      },
      security,
    ) as SemanticReportQuery;
    const second = validator.validate(first, security) as SemanticReportQuery;
    expect(second.queryKind).toBe('single_report');
    expect(second.datasetId).toBe(first.datasetId);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.dimensions).toEqual(first.dimensions);
    expect(second.timeRange).toEqual(first.timeRange);
    expect(second.filters).toEqual(first.filters);
  });
});
