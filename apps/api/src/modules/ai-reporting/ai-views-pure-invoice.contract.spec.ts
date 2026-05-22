import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PURE_SALES_FAMILY,
  PURE_PURCHASE_FAMILY,
} from '../pharma-reports/services/sales-purchase-analysis.service';

// ---------------------------------------------------------------------------
// NLQ ↔ Dashboard consistency contract
//
// The Sales/Purchase Analysis dashboard and the AI/NLQ reporting views must
// return the SAME numbers for the same scope. They achieve this by filtering
// on the IDENTICAL voucher family:
//   * dashboard: PURE_SALES_FAMILY / PURE_PURCHASE_FAMILY (exported consts)
//   * NLQ views: vw_ai_sales_items / vw_ai_purchase_items (migration SQL)
//
// This structural test reads the NLQ views migration and asserts it filters on
// exactly those family values and excludes cancelled vouchers. It runs in the
// normal unit suite (no DB needed) and FAILS LOUDLY if a future edit changes
// one surface's family filter without the other — the drift that would make
// NLQ and the dashboard disagree.
//
// A complementary numeric parity test (actually running both queries and
// comparing totals) lives at the bottom, guarded by DATABASE_URL so it runs
// only where a Postgres instance is available (non-prod / CI-with-DB).
// ---------------------------------------------------------------------------

const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../../../prisma/migrations/20260522100000_ai_views_family_pure_invoice/migration.sql',
  ),
  'utf8',
);

describe('AI/NLQ views — pure-invoice contract', () => {
  it('pins the dashboard family constants so a rename forces this test to be revisited', () => {
    expect(PURE_SALES_FAMILY).toBe('SALES_INVOICE');
    expect(PURE_PURCHASE_FAMILY).toBe('PURCHASE_INVOICE');
  });

  it('vw_ai_sales_items filters on the SAME family the sales dashboard uses', () => {
    expect(MIGRATION_SQL).toContain(`WHERE mv.family = '${PURE_SALES_FAMILY}'`);
  });

  it('vw_ai_purchase_items filters on the SAME family the purchase dashboard uses', () => {
    expect(MIGRATION_SQL).toContain(`WHERE mv.family = '${PURE_PURCHASE_FAMILY}'`);
  });

  it('both item views hard-exclude cancelled vouchers (real is_cancelled, not the old NULL)', () => {
    // Two pure-invoice WHERE blocks, each ANDing is_cancelled = FALSE.
    const cancelledGuards = MIGRATION_SQL.match(/AND mv\.is_cancelled = FALSE/g) ?? [];
    expect(cancelledGuards.length).toBeGreaterThanOrEqual(2);
    // And the views must expose the real column, not the old NULL::boolean.
    expect(MIGRATION_SQL).toContain('mv.is_cancelled AS is_cancelled');
    expect(MIGRATION_SQL).not.toContain('NULL::boolean AS is_cancelled');
  });

  it('does NOT reintroduce the stale raw-type filters that bypassed the classifier', () => {
    // The old views used `WHERE mv.type IN ('S','R','T')` / `('P','B')`, which
    // counted challans as sales and made type W/Q invisible. The family filter
    // replaces them entirely.
    expect(MIGRATION_SQL).not.toContain("mv.type IN ('S', 'R', 'T')");
    expect(MIGRATION_SQL).not.toContain("mv.type IN ('P', 'B')");
  });

  it('case-normalises the header type in the line-type join (lowercase v/u safety)', () => {
    expect(MIGRATION_SQL).toContain("UPPER(mv.type) = 'S' AND mt.type IN ('G', 'S', 'O')");
    expect(MIGRATION_SQL).toContain("UPPER(mv.type) = 'P' AND mt.type = 'P'");
  });
});

// ---------------------------------------------------------------------------
// DB-guarded numeric parity. Skipped automatically when DATABASE_URL is absent
// (e.g. the local unit run). In an environment with a synced tenant, set
// AI_PARITY_TENANT_ID / AI_PARITY_FROM / AI_PARITY_TO to assert that NLQ
// net_sales == dashboard headline total to the rupee.
// ---------------------------------------------------------------------------
const dbAvailable = Boolean(process.env.DATABASE_URL && process.env.AI_PARITY_TENANT_ID);
(dbAvailable ? describe : describe.skip)('AI/NLQ views — numeric parity vs dashboard (DB)', () => {
  // Intentionally minimal: the harness wiring (Prisma client, tenant fixture)
  // is environment-specific. This block documents the exact assertion to run
  // in non-prod and keeps it from silently passing when no DB is present.
  it('net_sales from vw_ai_sales_items equals dashboard pure-invoice total for the same scope', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const tenantId = process.env.AI_PARITY_TENANT_ID as string;
      const from = process.env.AI_PARITY_FROM ?? '2026-04-01';
      const to = process.env.AI_PARITY_TO ?? '2026-04-30';

      const [nlq] = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COALESCE(SUM(net_amount), 0)::float8 AS total
         FROM vw_ai_sales_items
         WHERE tenant_id = $1::uuid AND invoice_date BETWEEN $2::date AND $3::date`,
        tenantId, from, to,
      );
      const [dash] = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COALESCE(SUM(b.net_amount * b.sales_amount_sign), 0)::float8 AS total
         FROM marg_bill_rollup b
         WHERE b.tenant_id = $1::uuid AND b.family = '${PURE_SALES_FAMILY}'
           AND b.date BETWEEN $2::date AND $3::date`,
        tenantId, from, to,
      );
      // Allow sub-rupee float drift only.
      expect(Math.abs(Number(nlq.total) - Number(dash.total))).toBeLessThan(1);
    } finally {
      await prisma.$disconnect();
    }
  });
});
