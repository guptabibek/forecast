import { SemanticCatalogLoader } from './semantic-catalog.loader';
import { CompiledSql } from './semantic-query.types';
import { SqlSafetyValidator } from './sql-safety.validator';

describe('SqlSafetyValidator', () => {
  let validator: SqlSafetyValidator;

  const safeCompiled: CompiledSql = {
    sql: 'SELECT product_name, SUM(quantity) AS sold_quantity FROM vw_ai_sales_items WHERE tenant_id = $1::uuid AND company_id = ANY($2::int[]) AND branch_id = ANY($3::uuid[]) LIMIT $4',
    params: ['11111111-1111-4111-8111-111111111111', [11093], ['33333333-3333-4333-8333-333333333333'], 50],
    datasetId: 'sales_items',
    viewName: 'vw_ai_sales_items',
    expectsRowsLimit: true,
    appliedSecurityFilters: ['tenant_id', 'company_id', 'branch_id'],
    selectedColumns: ['product_name', 'sold_quantity'],
  };

  beforeEach(() => {
    const loader = new SemanticCatalogLoader();
    loader.onModuleInit();
    validator = new SqlSafetyValidator(loader);
  });

  it('accepts compiler-shaped read-only SQL over approved views', () => {
    expect(() => validator.validate(safeCompiled)).not.toThrow();
  });

  it.each([
    ['write keyword', { sql: safeCompiled.sql.replace('SELECT', 'DELETE') }],
    ['semicolon', { sql: `${safeCompiled.sql}; SELECT 1` }],
    ['raw table access', { sql: safeCompiled.sql.replace('vw_ai_sales_items', 'marg_sales_invoice_items') }],
    ['system table access', { sql: safeCompiled.sql.replace('vw_ai_sales_items', 'pg_catalog.pg_tables') }],
    ['dangerous function', { sql: safeCompiled.sql.replace('product_name', 'pg_sleep') }],
    ['literal limit', { sql: safeCompiled.sql.replace('LIMIT $4', 'LIMIT 5000') }],
    ['missing tenant filter', { appliedSecurityFilters: ['company_id', 'branch_id'] }],
  ])('rejects unsafe SQL: %s', (_label, override) => {
    expect(() => validator.validate({ ...safeCompiled, ...override })).toThrow();
  });
});
