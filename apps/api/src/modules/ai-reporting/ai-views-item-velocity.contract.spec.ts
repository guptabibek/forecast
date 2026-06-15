import { readFileSync } from 'fs';
import { join } from 'path';
import { SemanticCatalogLoader } from './semantic-catalog.loader';

// ---------------------------------------------------------------------------
// item_velocity (non-moving / not-sold / days-since-last-sold) dataset contract.
//
// This is the only AI dataset that lists items that did NOT sell, so it is
// backed by the Marg item master (marg_products) LEFT JOINed to sales history —
// not a transaction list. These structural assertions lock the view shape and
// the catalog wiring (correct view, company-only security, absence filters).
// ---------------------------------------------------------------------------

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../prisma/migrations/20260615140000_ai_views_item_velocity/migration.sql'),
  'utf8',
);

describe('AI/NLQ item_velocity view — contract', () => {
  it('builds on the Marg item master with LEFT joins so never-sold items still appear', () => {
    expect(MIGRATION_SQL).toContain('CREATE OR REPLACE VIEW vw_ai_item_velocity');
    expect(MIGRATION_SQL).toContain('FROM marg_products mprod');
    // sales/stock joined as LEFT so items with no sales/stock are retained
    expect(MIGRATION_SQL).toMatch(/LEFT JOIN \(\s*SELECT[\s\S]*?GROUP BY mt\.tenant_id, mt\.company_id, mt\.pid/);
  });

  it('derives last_sold_date, days_since_last_sold, never_sold and movement_status', () => {
    expect(MIGRATION_SQL).toContain('MAX(mv.date)::date AS last_sold_date');
    expect(MIGRATION_SQL).toContain('(CURRENT_DATE - sold.last_sold_date) ELSE NULL END AS days_since_last_sold');
    expect(MIGRATION_SQL).toContain('(sold.last_sold_date IS NULL) AS never_sold');
    expect(MIGRATION_SQL).toContain("'NEVER_SOLD'");
    expect(MIGRATION_SQL).toContain("'NON_MOVING'");
    expect(MIGRATION_SQL).toContain('AS movement_status');
  });

  it('counts only pure sale vouchers (type S / line G,S,O), excluding cancelled lines and returns', () => {
    expect(MIGRATION_SQL).toContain("mv.type = 'S'");
    expect(MIGRATION_SQL).toContain("mt.type IN ('G', 'S', 'O')");
    expect(MIGRATION_SQL).toContain('mt.is_cancelled IS DISTINCT FROM true');
  });

  it('catalog exposes item_velocity pointed at the view with company-only security', () => {
    const loader = new SemanticCatalogLoader();
    loader.onModuleInit();
    const catalog = loader.getCatalog();

    const ds = catalog.datasets.find((d) => d.datasetId === 'item_velocity');
    expect(ds?.viewName).toBe('vw_ai_item_velocity');
    expect(ds?.allowedForNlq).toBe(true);
    // company-grain master: tenant + company, NEVER branch/warehouse
    expect(ds?.requiredSecurityFilters).toEqual(['tenant_id', 'company_id']);
    expect(ds?.requiredSecurityFilters).not.toContain('branch_id');
    expect(ds?.requiredSecurityFilters).not.toContain('warehouse_id');
  });

  it('catalog exposes the absence filters, days-since metric, and velocity display columns', () => {
    const loader = new SemanticCatalogLoader();
    loader.onModuleInit();

    expect(loader.getFilter('never_sold_filter')?.column).toBe('never_sold');
    // The days filter targets days_idle (non-null), so "not sold in N days"
    // includes never-sold items instead of excluding them.
    expect(loader.getFilter('days_since_last_sold_filter')?.column).toBe('days_idle');
    expect(loader.getFilter('movement_status_filter')?.column).toBe('movement_status');

    const daysMetric = loader.getMetric('max_days_since_last_sold');
    expect(daysMetric?.datasetId).toBe('item_velocity');
    expect(daysMetric?.expression).toBe('MAX(days_since_last_sold)');

    const daysColumn = loader.getDisplayColumn('velocity_days_since_last_sold');
    expect(daysColumn?.datasetId).toBe('item_velocity');
    expect(daysColumn?.column).toBe('days_since_last_sold');
  });

  it('product_filter is available on item_velocity and supports NOT ILIKE exclusion', () => {
    const loader = new SemanticCatalogLoader();
    loader.onModuleInit();
    const productFilter = loader.getFilter('product_filter');
    expect(productFilter?.datasetIds).toContain('item_velocity');
    expect(productFilter?.operators.map((o) => o.toUpperCase())).toContain('NOT ILIKE');
  });
});
