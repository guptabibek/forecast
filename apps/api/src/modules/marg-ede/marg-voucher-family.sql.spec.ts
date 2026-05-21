import {
  margPurchaseAmountSignSql,
  margSalesAmountSignSql,
  margVoucherFamilySql,
} from './marg-voucher-family.sql';

// These helpers emit Prisma.Sql fragments. We don't have a live Postgres in
// this unit test context, so the assertions verify the *shape* of the emitted
// SQL.
//
// Since the family classification is now materialised as a Postgres
// GENERATED ALWAYS STORED column (see the 20260520130000 migration), the
// helper just emits a column reference. The CASE-arm logic that used to be
// inline in the helper now lives in the migration's GENERATED expression;
// keeping the two aligned is the single most important contract in this
// module. The sales / purchase sign helpers wrap the column reference in
// their own CASE so:
//   sales  : SALES_INVOICE → +1, SALES_RETURN → -1, others (SALES_CHALLAN /
//            SALES_RETURN_ADJUSTMENT / SALES_ORDER / unknown) → 0
//   purchase: PURCHASE_INVOICE → +1, PURCHASE_RETURN → -1, others → 0
//
// These rules are the single source of truth for any SQL aggregation that
// sums a Marg voucher's amount as "commercial sales" or "commercial purchases".
// They mirror the TypeScript classifier (resolveMargType2ProjectionDecision)
// in marg-ede.service.ts — both must stay aligned with the migration.
describe('margVoucherFamilySql', () => {
  it('emits a direct reference to the GENERATED family column on the given voucher alias', () => {
    const sql = margVoucherFamilySql('mv');
    const rendered = sql.sql;

    // The helper is now a thin pointer at the materialised column. The
    // family branches themselves live in the GENERATED expression in
    // 20260520130000_add_marg_voucher_family_generated_column/migration.sql.
    // Asserting only the column reference here means the test stays valid
    // regardless of how the underlying classification evolves.
    expect(rendered).toContain('mv.family');
    // No inline CASE — that would imply the helper is still doing the
    // classification, which would re-introduce the two-sources-of-truth
    // problem this refactor was meant to solve.
    expect(rendered).not.toMatch(/\bCASE\b/);
  });

  it('honours a non-default voucher alias', () => {
    const sql = margVoucherFamilySql('hdr');
    expect(sql.sql).toContain('hdr.family');
    expect(sql.sql).not.toMatch(/\bmv\./);
  });
});

describe('margSalesAmountSignSql', () => {
  it('multiplies SALES_INVOICE by +1, SALES_RETURN by -1, everything else by 0', () => {
    const rendered = margSalesAmountSignSql('mv').sql;

    // The CASE arms must contain the three QA-mandated branches. Anything
    // matched as SALES_CHALLAN, SALES_RETURN_ADJUSTMENT, or UNKNOWN falls
    // through to the ELSE 0 — the property that excludes challans and SC
    // price-adjustments from commercial sales totals.
    expect(rendered).toContain("'SALES_INVOICE' THEN 1");
    expect(rendered).toContain("'SALES_RETURN'  THEN -1");
    expect(rendered).toMatch(/ELSE 0/);

    // It must NOT emit a positive multiplier for challan or SC families —
    // those are the regressions QA flagged ("you included CH and SC in
    // sales values").
    expect(rendered).not.toContain("'SALES_CHALLAN' THEN 1");
    expect(rendered).not.toContain("'SALES_RETURN_ADJUSTMENT' THEN -1");
  });

  it('references the family column so the sign is derived from the voucher row, not the line', () => {
    const rendered = margSalesAmountSignSql('mv').sql;
    expect(rendered).toContain('mv.family');
  });
});

describe('margPurchaseAmountSignSql', () => {
  it('multiplies PURCHASE_INVOICE by +1, PURCHASE_RETURN by -1, everything else by 0', () => {
    const rendered = margPurchaseAmountSignSql('mv').sql;
    expect(rendered).toContain("'PURCHASE_INVOICE' THEN 1");
    expect(rendered).toContain("'PURCHASE_RETURN'  THEN -1");
    expect(rendered).toMatch(/ELSE 0/);

    // Sanity: the purchase helper must NOT cross-wire sales families.
    expect(rendered).not.toContain("'SALES_INVOICE' THEN 1");
    expect(rendered).not.toContain("'SALES_RETURN'  THEN -1");
  });

  it('references the family column so the sign is derived from the voucher row, not the line', () => {
    const rendered = margPurchaseAmountSignSql('mv').sql;
    expect(rendered).toContain('mv.family');
  });
});
