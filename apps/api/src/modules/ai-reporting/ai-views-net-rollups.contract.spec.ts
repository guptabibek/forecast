import { readFileSync } from 'fs';
import { join } from 'path';
import { SemanticCatalogLoader } from './semantic-catalog.loader';

// ---------------------------------------------------------------------------
// Net-of-returns + returns invoice-rollup views (Part 2 completion) contract.
//
// Net views must be the existing invoice views UNION ALL the returns views
// with the amount columns NEGATED in the returns arm — so SUM(net_amount)
// equals invoices − returns (verified numerically on seeded data:
// 1000 invoice − 300 return = 700). This test pins the structure + the
// catalog wiring so a future edit can't silently break the netting.
// ---------------------------------------------------------------------------

const SQL = readFileSync(
  join(__dirname, '../../../prisma/migrations/20260522120000_ai_views_net_and_returns_rollups/migration.sql'),
  'utf8',
);

describe('AI/NLQ net + returns-rollup views — contract', () => {
  it('net views are built as invoice UNION ALL returns', () => {
    expect(SQL).toContain('CREATE OR REPLACE VIEW vw_ai_sales_net AS');
    expect(SQL).toContain('FROM vw_ai_sales_items');
    expect(SQL).toContain('FROM vw_ai_sales_returns');
    expect(SQL).toContain('CREATE OR REPLACE VIEW vw_ai_purchase_net AS');
    expect(SQL).toContain('FROM vw_ai_purchase_items');
    expect(SQL).toContain('FROM vw_ai_purchase_returns');
    expect(SQL.match(/UNION ALL/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('the returns arm negates net_amount / quantity so net = invoices − returns', () => {
    // Both net views negate the core amount + quantity in the returns SELECT.
    expect(SQL).toContain('-net_amount');
    expect(SQL).toContain('-quantity');
    expect(SQL).toContain('-tax_amount');
    // tax_rate (a percentage) must NOT be negated.
    expect(SQL).not.toContain('-tax_rate');
  });

  it('returns invoice rollups roll the returns item views up to one row per document', () => {
    expect(SQL).toContain('CREATE OR REPLACE VIEW vw_ai_sales_returns_invoices AS');
    expect(SQL).toContain('FROM vw_ai_sales_returns');
    expect(SQL).toContain('CREATE OR REPLACE VIEW vw_ai_purchase_returns_invoices AS');
    expect(SQL).toContain('FROM vw_ai_purchase_returns');
    expect(SQL).toContain('COUNT(DISTINCT COALESCE(product_id::text, marg_product_pid))');
  });

  it('catalog exposes net + returns-invoice datasets, pointed at the new views, with metrics', () => {
    const catalog = new SemanticCatalogLoader().getCatalog();
    const byId = Object.fromEntries(catalog.datasets.map((d) => [d.datasetId, d]));
    expect(byId['sales_net']?.viewName).toBe('vw_ai_sales_net');
    expect(byId['purchase_net']?.viewName).toBe('vw_ai_purchase_net');
    expect(byId['sales_returns_invoices']?.viewName).toBe('vw_ai_sales_returns_invoices');
    expect(byId['purchase_returns_invoices']?.viewName).toBe('vw_ai_purchase_returns_invoices');

    const m = Object.fromEntries(catalog.metrics.map((x) => [x.metricId, x]));
    expect(m['sales_net_amount']?.datasetId).toBe('sales_net');
    expect(m['purchase_net_amount']?.datasetId).toBe('purchase_net');
    expect(m['sales_return_doc_count']?.datasetId).toBe('sales_returns_invoices');
    expect(m['purchase_return_doc_count']?.datasetId).toBe('purchase_returns_invoices');

    // Every new dataset must carry the security filters.
    for (const id of ['sales_net', 'purchase_net', 'sales_returns_invoices', 'purchase_returns_invoices']) {
      expect(byId[id]?.requiredSecurityFilters).toEqual(expect.arrayContaining(['tenant_id', 'company_id', 'branch_id']));
    }
  });
});
