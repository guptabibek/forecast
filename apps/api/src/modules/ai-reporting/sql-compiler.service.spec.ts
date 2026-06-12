import { ForbiddenException } from '@nestjs/common';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import { ReportingSecurityContext, SemanticReportQuery } from './semantic-query.types';
import { SqlCompilerService } from './sql-compiler.service';
import { SqlSafetyValidator } from './sql-safety.validator';

describe('SqlCompilerService', () => {
  let compiler: SqlCompilerService;
  let safety: SqlSafetyValidator;

  const security: ReportingSecurityContext = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    userRole: 'ADMIN',
    permissions: ['reports.ai.execute', 'reports.sales.view', 'reports.purchase.view', 'reports.inventory.view'],
    requestedCompanyId: 11093,
    requestedBranchIds: ['33333333-3333-4333-8333-333333333333'],
    allowedCompanyIds: [11093, 11094],
    allowedBranchIds: ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'],
    hasExplicitCompanyScope: true,
    hasExplicitBranchScope: true,
    fiscalYear: { startDate: '2026-04-01', endDate: '2027-03-31' },
  };

  beforeEach(() => {
    const loader = new SemanticCatalogLoader();
    loader.onModuleInit();
    compiler = new SqlCompilerService(loader);
    safety = new SqlSafetyValidator(loader);
  });

  const query = (overrides: Partial<SemanticReportQuery>): SemanticReportQuery => ({
    queryKind: 'single_report',
    title: 'Top Selling Products',
    datasetId: 'sales_items',
    analysisType: 'ranking',
    metrics: ['sold_quantity', 'net_sales'],
    dimensions: ['sales_product'],
    filters: [{ column: 'is_cancelled', operator: '=', value: false }],
    timeRange: { preset: 'this_month' },
    sort: [{ metricId: 'sold_quantity', direction: 'desc' }],
    limit: 10,
    visualization: { type: 'bar' },
    ...overrides,
  });

  it('compiles ranking reports to parameterized SELECT SQL over an approved view', () => {
    const compiled = compiler.compile(query({}), security);

    expect(compiled.sql).toMatch(/^SELECT\b/i);
    expect(compiled.sql).toContain('FROM vw_ai_sales_items');
    expect(compiled.sql).toContain('tenant_id = $1::uuid');
    expect(compiled.sql).toMatch(/\bcompany_id = ANY\(\$\d+::int\[\]\)/);
    expect(compiled.sql).toMatch(/\bbranch_id = ANY\(\$\d+::uuid\[\]\)/);
    expect(compiled.sql).toMatch(/\binvoice_date BETWEEN \$\d+::date AND \$\d+::date/);
    expect(compiled.sql).toMatch(/\bORDER BY sold_quantity DESC\b/);
    expect(compiled.sql).toMatch(/\bLIMIT \$\d+\b/);
    expect(compiled.sql).not.toContain(';');
    expect(compiled.params).toEqual([
      security.tenantId,
      [11093],
      ['33333333-3333-4333-8333-333333333333'],
      false,
      expect.any(String),
      expect.any(String),
      10,
    ]);

    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('compiles customer-wise, salesman-wise, purchase, invoice, and stock queries with scoped filters', () => {
    const cases: SemanticReportQuery[] = [
      query({ datasetId: 'sales_invoices', metrics: ['invoice_net_sales'], dimensions: ['sales_customer'] }),
      query({ datasetId: 'sales_invoices', metrics: ['invoice_net_sales'], dimensions: ['sales_salesman'] }),
      query({ datasetId: 'sales_invoices', metrics: ['invoice_net_sales'], dimensions: ['sales_invoice', 'sales_customer'] }),
      query({
        datasetId: 'sales_items',
        metrics: ['net_sales', 'sales_item_invoice_count'],
        dimensions: ['sales_item_customer'],
        filters: [{ filterId: 'product_filter', operator: 'ILIKE', value: 'TICAGRACE 90 10X14 TABS' }],
        sort: [{ metricId: 'net_sales', direction: 'desc' }],
        limit: 5,
      }),
      query({ datasetId: 'purchase_items', metrics: ['purchase_quantity'], dimensions: ['purchase_product'] }),
      query({
        datasetId: 'stock_summary',
        metrics: ['current_stock'],
        dimensions: ['stock_product', 'stock_warehouse'],
        filters: [{ filterId: 'low_stock_filter', operator: '=', value: 'LOW_STOCK' }],
        timeRange: undefined,
      }),
    ];

    for (const item of cases) {
      const compiled = compiler.compile(item, security);
      expect(() => safety.validate(compiled)).not.toThrow();
      expect(compiled.sql).toMatch(/^SELECT\b/i);
      expect(compiled.appliedSecurityFilters).toContain('tenant_id');
      expect(compiled.sql).toMatch(/\bLIMIT \$\d+\b/);
      expect(compiled.params.length).toBeGreaterThan(2);
    }
  });

  it('uses current financial year as the default date range when no explicit range is supplied', () => {
    const compiled = compiler.compile(query({ timeRange: undefined }), security);

    expect(compiled.sql).toContain('invoice_date BETWEEN');
    expect(compiled.params).toContain('2026-04-01');
    expect(compiled.params).toContain('2027-03-31');
  });

  it('compiles text product filters without comparing UUID columns to text values', () => {
    const compiled = compiler.compile(query({
      filters: [{ filterId: 'product_filter', operator: '=', value: 'TICAGRACE 90 10X14 TABS' }],
      limit: 5,
    }), security);

    expect(compiled.sql).not.toMatch(/\bproduct_id\s*=/);
    expect(compiled.sql).toContain('product_code =');
    expect(compiled.sql).toContain('product_name =');
    expect(compiled.params).toContain('TICAGRACE 90 10X14 TABS');
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('compiles contribution percentage for top sold items', () => {
    const compiled = compiler.compile(query({
      metrics: ['sold_quantity', 'sales_contribution_pct'],
      dimensions: ['sales_product'],
    }), security);

    expect(compiled.sql).toContain('SUM(SUM(quantity)) OVER ()');
    expect(compiled.sql).toContain('AS sales_contribution_pct');
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('does not cast text business IDs such as invoice_id to UUID', () => {
    const compiled = compiler.compile(query({
      datasetId: 'sales_invoices',
      metrics: ['invoice_net_sales'],
      dimensions: ['sales_invoice'],
      filters: [{ column: 'invoice_id', operator: '=', value: '11093:INV-1' }],
      timeRange: undefined,
    }), security);

    expect(compiled.sql).toContain('invoice_id =');
    expect(compiled.sql).not.toContain('invoice_id = $4::uuid');
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('compiles detail display-column reports without requiring a fixed report template', () => {
    const compiled = compiler.compile(query({
      mode: 'detail',
      datasetId: 'sales_invoices',
      metrics: [],
      dimensions: [],
      displayColumns: ['sales_invoice_date', 'sales_invoice_no', 'sales_customer_name', 'sales_invoice_net_amount'],
      filters: [{ filterId: 'customer_filter', operator: 'ILIKE', value: 'apollo' }],
      sort: [{ columnId: 'sales_invoice_date', direction: 'desc' }],
      limit: 50,
      visualization: { type: 'table' },
    }), security);

    expect(compiled.sql).toContain('SELECT invoice_date AS invoice_date, invoice_no AS invoice_no, customer_name AS customer_name, net_amount AS net_amount');
    expect(compiled.sql).toContain('FROM vw_ai_sales_invoices');
    expect(compiled.sql).not.toContain('GROUP BY');
    expect(compiled.sql).toMatch(/\(customer_code ILIKE \$\d+ OR customer_name ILIKE \$\d+\)/);
    expect(compiled.sql).toContain('ORDER BY invoice_date DESC');
    expect(compiled.selectedColumnMetadata).toEqual(expect.arrayContaining([
      { key: 'invoice_date', label: 'Invoice Date', dataType: 'date' },
      { key: 'net_amount', label: 'Net Amount', dataType: 'currency' },
    ]));
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('compiles comparison reports as safe parameterized period subqueries', () => {
    const compiled = compiler.compile(query({
      mode: 'comparison',
      datasetId: 'sales_invoices',
      metrics: ['invoice_net_sales'],
      dimensions: ['sales_customer'],
      timeRange: { preset: 'custom', startDate: '2026-05-01', endDate: '2026-05-31' },
      comparison: { enabled: true, type: 'previous_period', startDate: null, endDate: null },
      sort: [{ metricId: 'invoice_net_sales', direction: 'desc' }],
      limit: 20,
    }), security);

    expect(compiled.sql).toMatch(/^SELECT 'current' AS comparison_period/i);
    expect(compiled.sql).toContain('UNION ALL');
    expect(compiled.sql).toContain("'comparison' AS comparison_period");
    expect(compiled.params).toContain('2026-05-01');
    expect(compiled.params).toContain('2026-05-31');
    expect(compiled.params).toContain('2026-03-31');
    expect(compiled.params).toContain('2026-04-30');
    expect(compiled.selectedColumns[0]).toBe('comparison_period');
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('expands the date_range filter placeholder column to the dataset default date column', () => {
    const compiled = compiler.compile(query({
      filters: [{ filterId: 'date_range', operator: 'BETWEEN', value: { from: '2026-05-01', to: '2026-05-31' } }],
      timeRange: undefined,
    }), security);

    expect(compiled.sql).not.toContain('default_time_field');
    expect(compiled.sql).toMatch(/\binvoice_date BETWEEN \$\d+::date AND \$\d+::date/);
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('compiles "how many items will be expiring in 2027" as an aggregate count query', () => {
    const compiled = compiler.compile(query({
      mode: 'kpi',
      analysisType: 'grouped_summary',
      datasetId: 'stock_batches',
      metrics: ['expiring_item_count'],
      dimensions: [],
      displayColumns: [],
      filters: [],
      timeRange: { preset: 'custom', fieldId: 'batch_expiry_date', startDate: '2027-01-01', endDate: '2027-12-31' },
      sort: [{ metricId: 'expiring_item_count', direction: 'desc' }],
      limit: 1,
      visualization: { type: 'kpi' },
    }), security);

    expect(compiled.sql).toContain('COUNT(DISTINCT product_id) AS expiring_item_count');
    expect(compiled.sql).toContain('FROM vw_ai_stock_batches');
    expect(compiled.sql).not.toContain('GROUP BY');
    expect(compiled.sql).toMatch(/\bexpiry_date BETWEEN \$\d+::date AND \$\d+::date/);
    expect(compiled.params).toContain('2027-01-01');
    expect(compiled.params).toContain('2027-12-31');
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('compiles explicit calendar-year expiry list queries as detail reports', () => {
    const compiled = compiler.compile(query({
      mode: 'detail',
      analysisType: 'exception_list',
      datasetId: 'stock_batches',
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
      filters: [],
      timeRange: { preset: 'custom', fieldId: 'batch_expiry_date', startDate: '2027-01-01', endDate: '2027-12-31' },
      sort: [{ columnId: 'batch_expiry_date', direction: 'asc' }],
      limit: 100,
      visualization: { type: 'table' },
    }), security);

    expect(compiled.sql).toContain('FROM vw_ai_stock_batches');
    expect(compiled.sql).toMatch(/\bexpiry_date BETWEEN \$\d+::date AND \$\d+::date/);
    expect(compiled.sql).toContain('ORDER BY expiry_date ASC');
    expect(compiled.sql).not.toContain('GROUP BY');
    expect(compiled.params).toContain('2027-01-01');
    expect(compiled.params).toContain('2027-12-31');
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('compiles expiry detail queries even when the AI includes dimensions plus detail columns', () => {
    const compiled = compiler.compile(query({
      mode: 'detail',
      analysisType: 'exception_list',
      datasetId: 'stock_batches',
      metrics: [],
      dimensions: ['batch_product'],
      displayColumns: [
        'batch_no',
        'batch_expiry_date',
        'batch_current_stock',
        'batch_stock_value',
      ],
      filters: [],
      timeRange: { preset: 'custom', fieldId: 'batch_expiry_date', startDate: '2027-01-01', endDate: '2027-12-31' },
      sort: [{ columnId: 'batch_no', direction: 'asc' }],
      limit: 100,
      visualization: { type: 'table' },
    }), security);

    expect(compiled.sql).toContain('GROUP BY product_id, product_code, product_name, batch_no, expiry_date, current_stock, stock_value');
    expect(compiled.sql).toContain('ORDER BY batch_no ASC');
    expect(compiled.sql).toMatch(/\bcurrent_stock AS current_stock\b/);
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('aggregates display-column sorts when grouped stock batch queries sort by non-grouped detail fields', () => {
    const compiled = compiler.compile(query({
      datasetId: 'stock_batches',
      metrics: ['batch_stock'],
      dimensions: ['batch_product'],
      displayColumns: [],
      filters: [],
      timeRange: { preset: 'custom', fieldId: 'batch_expiry_date', startDate: '2027-01-01', endDate: '2027-12-31' },
      sort: [{ column: 'current_stock', direction: 'desc' }],
      limit: 100,
    }), security);

    expect(compiled.sql).toContain('GROUP BY product_id, product_code, product_name');
    expect(compiled.sql).toContain('ORDER BY MAX(current_stock) DESC');
    expect(compiled.sql).not.toContain('ORDER BY current_stock DESC');
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('compiles stock value expiring in 2027 using the catalog stock-value expiry metric', () => {
    const compiled = compiler.compile(query({
      mode: 'kpi',
      analysisType: 'grouped_summary',
      datasetId: 'stock_batches',
      metrics: ['expiring_stock_value'],
      dimensions: [],
      displayColumns: [],
      filters: [],
      timeRange: { preset: 'custom', fieldId: 'batch_expiry_date', startDate: '2027-01-01', endDate: '2027-12-31' },
      sort: [{ metricId: 'expiring_stock_value', direction: 'desc' }],
      limit: 1,
      visualization: { type: 'kpi' },
    }), security);

    expect(compiled.sql).toContain('SUM(stock_value) AS expiring_stock_value');
    expect(compiled.sql).toMatch(/\bexpiry_date BETWEEN \$\d+::date AND \$\d+::date/);
    expect(compiled.params).toContain('2027-01-01');
    expect(compiled.params).toContain('2027-12-31');
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('uses aggregate ordering when grouped stock batch queries sort by catalog expiry date field', () => {
    const compiled = compiler.compile(query({
      datasetId: 'stock_batches',
      metrics: ['batch_stock'],
      dimensions: ['batch_product'],
      filters: [],
      timeRange: { preset: 'custom', fieldId: 'batch_expiry_date', startDate: '2027-01-01', endDate: '2027-12-31' },
      sort: [{ fieldId: 'batch_expiry_date', direction: 'asc' }],
      limit: 100,
    }), security);

    expect(compiled.sql).toMatch(/\bexpiry_date BETWEEN \$\d+::date AND \$\d+::date/);
    expect(compiled.sql).toContain('GROUP BY product_id, product_code, product_name');
    expect(compiled.sql).toContain('ORDER BY MIN(expiry_date) ASC');
    expect(compiled.sql).not.toContain('ORDER BY expiry_date ASC');
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('rejects scoped datasets when no allowed branch is available', () => {
    expect(() => compiler.compile(query({}), { ...security, requestedBranchIds: [], allowedBranchIds: [] })).toThrow(ForbiddenException);
  });
});

describe('SqlCompilerService change ranking (delta vs previous period)', () => {
  const security: ReportingSecurityContext = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    userRole: 'ADMIN',
    permissions: ['reports.ai.execute', 'reports.sales.view'],
    requestedCompanyId: 11093,
    requestedBranchIds: ['33333333-3333-4333-8333-333333333333'],
    allowedCompanyIds: [11093],
    allowedBranchIds: ['33333333-3333-4333-8333-333333333333'],
    hasExplicitCompanyScope: true,
    hasExplicitBranchScope: true,
    fiscalYear: { startDate: '2026-04-01', endDate: '2027-03-31' },
  };

  function build() {
    const loader = new SemanticCatalogLoader();
    loader.onModuleInit();
    return { compiler: new SqlCompilerService(loader), safety: new SqlSafetyValidator(loader) };
  }

  const changeQuery: SemanticReportQuery = {
    queryKind: 'single_report',
    title: 'Top 10 items whose sales decreased vs previous month',
    datasetId: 'sales_net',
    mode: 'comparison',
    analysisType: 'ranking',
    metrics: ['sales_net_amount'],
    dimensions: ['sales_net_product'],
    timeRange: { preset: 'this_month' },
    comparison: { enabled: true, type: 'previous_period', startDate: null, endDate: null, rankBy: 'change' },
    sort: [{ metricId: 'sales_net_amount', direction: 'asc' }],
    limit: 10,
  };

  it('joins both periods per dimension value and ranks by the signed delta', () => {
    const { compiler, safety } = build();
    const compiled = compiler.compile(changeQuery, security);

    expect(compiled.sql).toMatch(/^SELECT\b/);
    expect(compiled.sql).toContain('FULL OUTER JOIN');
    // null-safe, hash-joinable dimension join
    expect(compiled.sql).toContain("COALESCE(cur.");
    expect(compiled.sql).toContain("'__null__'");
    expect(compiled.sql).toContain('AS change,');
    expect(compiled.sql).toContain('AS change_pct');
    // decrease → most negative change first
    expect(compiled.sql).toMatch(/ORDER BY change ASC/);
    // the user limit is the FINAL ranked limit, parameterized
    expect(compiled.sql).toMatch(/LIMIT \$\d+$/);
    expect(compiled.params[compiled.params.length - 1]).toBe(10);
    // both periods carry tenant/company/branch security filters
    expect((compiled.sql.match(/tenant_id = \$\d+::uuid/g) ?? []).length).toBe(2);
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('emits typed columns: current/previous metric, change (metric units), change_pct (percentage)', () => {
    const { compiler } = build();
    const compiled = compiler.compile(changeQuery, security);
    const byKey = new Map((compiled.selectedColumnMetadata ?? []).map((column) => [column.key, column]));
    expect(byKey.get('sales_net_amount')?.label).toContain('(Current)');
    expect(byKey.get('previous_sales_net_amount')?.label).toContain('(Previous)');
    expect(byKey.get('change')?.dataType).toBe('currency');
    expect(byKey.get('change_pct')?.dataType).toBe('percentage');
  });

  it('increase questions rank descending', () => {
    const { compiler } = build();
    const compiled = compiler.compile(
      { ...changeQuery, sort: [{ metricId: 'sales_net_amount', direction: 'desc' }] },
      security,
    );
    expect(compiled.sql).toMatch(/ORDER BY change DESC/);
  });

  it('comparison without rankBy keeps the legacy stacked shape', () => {
    const { compiler } = build();
    const compiled = compiler.compile(
      { ...changeQuery, comparison: { enabled: true, type: 'previous_period', startDate: null, endDate: null } },
      security,
    );
    expect(compiled.sql).toContain("'current' AS comparison_period");
    expect(compiled.sql).toContain('UNION ALL');
  });
});
