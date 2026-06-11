import * as fs from 'fs';
import * as path from 'path';
import { SemanticCatalogLoader } from './semantic-catalog.loader';
import { SemanticQueryValidator } from './semantic-query.validator';
import { ReportingSecurityContext, SemanticReportQuery } from './semantic-query.types';
import { SqlCompilerService } from './sql-compiler.service';
import { SqlSafetyValidator } from './sql-safety.validator';

// Contract for the regional-dimension migration: route/area come from the
// TRANSACTION-TIME add_field segments (20 = ROUT, 21 = AREA via
// marg_sale_types) — the same source as the dashboard regional breakdowns —
// NOT from the mutable party master (mp.route / mp.area).
const SQL = fs.readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20260611130000_ai_views_regional_dimensions/migration.sql'),
  'utf8',
);

describe('AI views regional dimensions migration contract', () => {
  it('re-creates only the thin net views', () => {
    expect(SQL).toContain('CREATE OR REPLACE VIEW vw_ai_sales_net AS');
    expect(SQL).toContain('CREATE OR REPLACE VIEW vw_ai_purchase_net AS');
    expect(SQL).not.toContain('CREATE OR REPLACE VIEW vw_ai_sales_items');
    expect(SQL).not.toContain('CREATE OR REPLACE VIEW vw_ai_purchase_items');
  });

  it('derives route/area from add_field segments 20/21 with marg_sale_types lookups', () => {
    expect(SQL).toContain("SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 20)");
    expect(SQL).toContain("SPLIT_PART(COALESCE(v.source_transaction_add_field, ''), ';', 21)");
    expect(SQL).toContain("rt.sg_code = 'ROUT'");
    expect(SQL).toContain("ar.sg_code = 'AREA'");
    // Region columns are attributes, never negated in the returns arms.
    expect(SQL).not.toContain('-region_');
    // Both arms of both views project all four columns (4 × 4 = 16 mentions).
    expect((SQL.match(/AS region_route_name/g) ?? []).length).toBe(4);
    expect((SQL.match(/AS region_area_name/g) ?? []).length).toBe(4);
  });

  it('does not source regional data from the mutable party master', () => {
    const sqlWithoutComments = SQL.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
    expect(sqlWithoutComments).not.toContain('mp.route');
    expect(sqlWithoutComments).not.toContain('mp.area');
  });
});

describe('regional dimensions are wired through catalog, validator, and compiler', () => {
  const security: ReportingSecurityContext = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    userRole: 'ADMIN',
    permissions: ['reports.ai.execute', 'reports.sales.view', 'reports.purchase.view'],
    requestedCompanyId: 11093,
    requestedBranchIds: ['33333333-3333-4333-8333-333333333333'],
    allowedCompanyIds: [11093],
    allowedBranchIds: ['33333333-3333-4333-8333-333333333333'],
    hasExplicitCompanyScope: true,
    hasExplicitBranchScope: true,
    fiscalYear: { startDate: '2026-04-01', endDate: '2027-03-31' },
  };

  function buildPipeline() {
    const loader = new SemanticCatalogLoader();
    loader.onModuleInit();
    return {
      loader,
      validator: new SemanticQueryValidator(loader),
      compiler: new SqlCompilerService(loader),
      safety: new SqlSafetyValidator(loader),
    };
  }

  const topRoutesQuery: SemanticReportQuery = {
    queryKind: 'single_report',
    title: 'Top 5 routes with most sales',
    datasetId: 'sales_net',
    mode: 'ranking',
    analysisType: 'ranking',
    metrics: ['sales_net_amount'],
    dimensions: ['sales_net_route'],
    timeRange: { preset: 'this_month' },
    sort: [{ metricId: 'sales_net_amount', direction: 'desc' }],
    limit: 5,
  };

  it('"top 5 routes with most sales" validates and compiles to GROUP BY + ORDER BY + LIMIT', () => {
    const { validator, compiler, safety } = buildPipeline();
    const validated = validator.validate(topRoutesQuery, security);
    expect(validated.queryKind).toBe('single_report');
    const compiled = compiler.compile(validated as SemanticReportQuery, security);

    expect(compiled.sql).toContain('FROM vw_ai_sales_net');
    expect(compiled.sql).toContain('region_route_name');
    expect(compiled.sql).toMatch(/GROUP BY .*region_route_code.*region_route_name/s);
    expect(compiled.sql).toMatch(/SUM\(net_amount\)/i);
    expect(compiled.sql).toMatch(/ORDER BY sales_net_amount DESC/);
    expect(() => safety.validate(compiled)).not.toThrow();
  });

  it('"top 5 routes with maximum sales" with a borrowed sibling metric repairs, validates, and compiles', () => {
    // Regression: the LLM chose sales_net (it has the route dimension) but
    // emitted the sales_items metric id → "Metric is not available on dataset
    // sales_net: net_sales".
    const { validator, compiler } = buildPipeline();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { repairDatasetCoherence } = require('./grouping-intent.util');
    const repaired = repairDatasetCoherence(
      {
        ...topRoutesQuery,
        metrics: ['net_sales'],
        sort: [{ metricId: 'net_sales', direction: 'desc' }],
        output: { showGrid: true, showChart: true, chartType: 'bar', xField: 'region_route_name', yField: 'net_sales' },
      },
      // The validator/compiler load the same shipped catalog.
      JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../ai-reporting/semantic-catalog.json'), 'utf8')),
    );
    const validated = validator.validate(repaired, security);
    expect(validated.queryKind).toBe('single_report');
    const compiled = compiler.compile(validated as SemanticReportQuery, security);
    expect(compiled.sql).toContain('FROM vw_ai_sales_net');
    expect(compiled.sql).toMatch(/GROUP BY .*region_route_name/s);
    expect(compiled.sql).toMatch(/ORDER BY sales_net_amount DESC/);
  });

  it('area/city dimension compiles on the purchase side too', () => {
    const { validator, compiler } = buildPipeline();
    const validated = validator.validate(
      {
        ...topRoutesQuery,
        title: 'Cities with highest purchase',
        datasetId: 'purchase_net',
        metrics: ['purchase_net_amount'],
        dimensions: ['purchase_net_area'],
        sort: [{ metricId: 'purchase_net_amount', direction: 'desc' }],
      },
      security,
    );
    const compiled = compiler.compile(validated as SemanticReportQuery, security);
    expect(compiled.sql).toContain('FROM vw_ai_purchase_net');
    expect(compiled.sql).toContain('region_area_name');
    expect(compiled.sql).toMatch(/GROUP BY .*region_area_code.*region_area_name/s);
  });
});
