import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SALES_RETURN_FAMILIES,
  PURCHASE_RETURN_FAMILIES,
} from '../pharma-reports/services/sales-purchase-analysis.service';
import { SemanticCatalogLoader } from './semantic-catalog.loader';

// ---------------------------------------------------------------------------
// NLQ returns datasets (Part 2b) ↔ dashboard scope=return consistency contract.
//
// The NLQ returns views must filter on the SAME families the dashboard uses
// for scope=return (SALES_RETURN_FAMILIES / PURCHASE_RETURN_FAMILIES), so a
// returns question via NLQ matches the dashboard's returns total. This
// structural test reads the returns-views migration and asserts the family
// filter, cancellation guard, and document_type. It also asserts the catalog
// exposes the returns datasets pointed at the right views.
// ---------------------------------------------------------------------------

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../prisma/migrations/20260522110000_ai_views_returns_datasets/migration.sql'),
  'utf8',
);

describe('AI/NLQ returns views — contract', () => {
  it('vw_ai_sales_returns filters on exactly the dashboard sales-return families', () => {
    expect(SALES_RETURN_FAMILIES).toEqual(['SALES_RETURN', 'SALES_BRK_EXP_RECEIVE']);
    const famList = SALES_RETURN_FAMILIES.map((f) => `'${f}'`).join(', ');
    expect(MIGRATION_SQL).toContain(`mv.family IN (${famList})`);
  });

  it('vw_ai_purchase_returns filters on exactly the dashboard purchase-return families', () => {
    expect(PURCHASE_RETURN_FAMILIES).toEqual(['PURCHASE_RETURN', 'PURCHASE_BRK_EXP_RETURN']);
    const famList = PURCHASE_RETURN_FAMILIES.map((f) => `'${f}'`).join(', ');
    expect(MIGRATION_SQL).toContain(`mv.family IN (${famList})`);
  });

  it('both returns views hard-exclude cancelled vouchers and expose the real flag', () => {
    const guards = MIGRATION_SQL.match(/AND mv\.is_cancelled = FALSE/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
    expect(MIGRATION_SQL).toContain('mv.is_cancelled AS is_cancelled');
  });

  it('returns views label document_type as the return family and status RETURN', () => {
    expect(MIGRATION_SQL).toContain(`'SALES_RETURN'::varchar AS document_type`);
    expect(MIGRATION_SQL).toContain(`'PURCHASE_RETURN'::varchar AS document_type`);
    expect(MIGRATION_SQL).toContain(`'RETURN'::text AS status`);
  });

  it('catalog exposes sales_returns / purchase_returns datasets pointed at the new views', () => {
    const loader = new SemanticCatalogLoader();
    const catalog = loader.getCatalog();
    const sret = catalog.datasets.find((d) => d.datasetId === 'sales_returns');
    const pret = catalog.datasets.find((d) => d.datasetId === 'purchase_returns');
    expect(sret?.viewName).toBe('vw_ai_sales_returns');
    expect(pret?.viewName).toBe('vw_ai_purchase_returns');
    // Security must be enforced on the new datasets.
    expect(sret?.requiredSecurityFilters).toEqual(expect.arrayContaining(['tenant_id', 'company_id', 'branch_id']));
    expect(pret?.requiredSecurityFilters).toEqual(expect.arrayContaining(['tenant_id', 'company_id', 'branch_id']));
    // Return metrics exist and bind to the returns datasets.
    expect(catalog.metrics.find((m) => m.metricId === 'sales_return_value')?.datasetId).toBe('sales_returns');
    expect(catalog.metrics.find((m) => m.metricId === 'purchase_return_value')?.datasetId).toBe('purchase_returns');
  });
});
