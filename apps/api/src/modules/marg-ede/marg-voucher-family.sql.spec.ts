import {
  margPurchaseAmountSignSql,
  margSalesAmountSignSql,
  margVoucherFamilySql,
} from './marg-voucher-family.sql';

// These helpers emit Prisma.Sql fragments. We don't have a live Postgres in
// this unit test context, so the assertions verify the *shape* of the emitted
// SQL. The full classification rule itself lives in the GENERATED column
// expression in the latest classifier migration; that's covered by a
// Postgres-level migration test, not here.
//
// The sales / purchase sign helpers wrap the column reference in their own
// CASE so:
//   sales:    SALES_INVOICE → +1, SALES_RETURN → -1, SALES_BRK_EXP_RECEIVE → -1,
//             every other family (challan variants, SC adjustment, orders,
//             purchases, unknown) → 0
//   purchase: PURCHASE_INVOICE → +1, PURCHASE_RETURN → -1,
//             PURCHASE_BRK_EXP_RETURN → -1, every other family → 0
//
// These rules are the single source of truth for any SQL aggregation that
// sums a Marg voucher's amount as "commercial sales" or "commercial purchases".
// They mirror the TypeScript classifier (resolveMargType2ProjectionDecision)
// in marg-ede.service.ts — both must stay aligned with the migration.
describe('margVoucherFamilySql', () => {
  it('emits a direct reference to the GENERATED family column on the given voucher alias', () => {
    const sql = margVoucherFamilySql('mv');
    const rendered = sql.sql;

    expect(rendered).toContain('mv.family');
    expect(rendered).not.toMatch(/\bCASE\b/);
  });

  it('honours a non-default voucher alias', () => {
    const sql = margVoucherFamilySql('hdr');
    expect(sql.sql).toContain('hdr.family');
    expect(sql.sql).not.toMatch(/\bmv\./);
  });
});

describe('margSalesAmountSignSql', () => {
  it('multiplies SALES_INVOICE by +1', () => {
    expect(margSalesAmountSignSql('mv').sql).toContain("'SALES_INVOICE'         THEN 1");
  });

  it('multiplies SALES_RETURN and SALES_BRK_EXP_RECEIVE by -1', () => {
    const rendered = margSalesAmountSignSql('mv').sql;
    expect(rendered).toContain("'SALES_RETURN'          THEN -1");
    expect(rendered).toContain("'SALES_BRK_EXP_RECEIVE' THEN -1");
  });

  it('treats every other family (challan variants, SC adjustment, orders, purchases, unknown) as 0', () => {
    const rendered = margSalesAmountSignSql('mv').sql;
    expect(rendered).toMatch(/ELSE 0/);

    // Negative assertions: the QA regressions we explicitly guard against.
    // Including any of these as non-zero would re-introduce the bugs the
    // migration history fixed (sales inflated by challan amounts, returns
    // double-counted, SC price-diff polluting commercial totals).
    expect(rendered).not.toContain("'SALES_CHALLAN' THEN 1");
    expect(rendered).not.toContain("'SALES_CHALLAN_RETURN' THEN -1");
    expect(rendered).not.toContain("'SALES_BRK_EXP_RECEIVE_CHALLAN' THEN -1");
    expect(rendered).not.toContain("'SALES_RETURN_ADJUSTMENT' THEN -1");
    expect(rendered).not.toContain("'SALES_ORDER' THEN 1");
  });

  it('references the family column so the sign is derived from the voucher row, not the line', () => {
    expect(margSalesAmountSignSql('mv').sql).toContain('mv.family');
  });
});

describe('margPurchaseAmountSignSql', () => {
  it('multiplies PURCHASE_INVOICE by +1', () => {
    expect(margPurchaseAmountSignSql('mv').sql).toContain("'PURCHASE_INVOICE'        THEN 1");
  });

  it('multiplies PURCHASE_RETURN and PURCHASE_BRK_EXP_RETURN by -1', () => {
    const rendered = margPurchaseAmountSignSql('mv').sql;
    expect(rendered).toContain("'PURCHASE_RETURN'         THEN -1");
    expect(rendered).toContain("'PURCHASE_BRK_EXP_RETURN' THEN -1");
  });

  it('treats every other family (challan variants, price-diff adjustment, orders, sales, unknown) as 0', () => {
    const rendered = margPurchaseAmountSignSql('mv').sql;
    expect(rendered).toMatch(/ELSE 0/);

    expect(rendered).not.toContain("'PURCHASE_CHALLAN' THEN 1");
    expect(rendered).not.toContain("'PURCHASE_CHALLAN_RETURN' THEN -1");
    expect(rendered).not.toContain("'PURCHASE_BRK_EXP_RETURN_CHALLAN' THEN -1");
    expect(rendered).not.toContain("'PURCHASE_PRICE_DIFF_ADJUSTMENT' THEN -1");
    expect(rendered).not.toContain("'PURCHASE_ORDER' THEN 1");

    // Sanity: the purchase helper must NOT cross-wire sales families.
    expect(rendered).not.toContain("'SALES_INVOICE' THEN 1");
    expect(rendered).not.toContain("'SALES_RETURN'  THEN -1");
    expect(rendered).not.toContain("'SALES_BRK_EXP_RECEIVE' THEN -1");
  });

  it('references the family column so the sign is derived from the voucher row, not the line', () => {
    expect(margPurchaseAmountSignSql('mv').sql).toContain('mv.family');
  });
});
