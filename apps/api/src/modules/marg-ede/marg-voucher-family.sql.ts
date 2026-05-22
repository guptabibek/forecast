import { Prisma } from '@prisma/client';

/**
 * Single source of truth for classifying a Marg voucher (MDis row) into a
 * commercial document family from raw SQL. Mirrors the TypeScript classifier
 * in `marg-ede.service.ts` (resolveMargType2ProjectionDecision) — any change
 * to the canonical mapping must be applied to ALL THREE places that hold
 * the rule:
 *
 *   1. resolveMargType2ProjectionDecision (TS) — for projection decisions
 *   2. marg_vouchers.family GENERATED expression — for SQL aggregations
 *   3. The unit tests in marg-voucher-family.sql.spec.ts
 *
 * CLASSIFIER CONTRACT
 * -------------------
 * The classifier uses ONLY two columns Marg emits identically for every
 * tenant — `type` and the first character of `add_field` (`I` for invoice
 * / commercial actual, `C` for challan / inventory-only). VCN prefixes are
 * NOT consulted — they are tenant-specific (one tenant's `STR` is another
 * tenant's `INV` / `BILL` / `AE-` / custom series) and treating them as
 * classifier inputs has caused two prior incidents:
 *
 *   - 20260520130000 gated SALES_INVOICE on `vcn LIKE 'STR%'` → tenants
 *     with non-STR series saw NEGATIVE reported sales (returns -1, invoices 0).
 *     Fixed by 20260521080000.
 *   - The 20260521080000 fix still gated SALES_CHALLAN on `vcn LIKE 'CHAL%'`,
 *     which missed every tenant whose challans use a different VCN series
 *     (CA*, L*, SN*, CCN*, CCNB*, etc.). Sales inflated by ~₹22.6 lakh on
 *     a single test tenant. Replaced by the (type, add_field[0]) rule in
 *     the migration that ships this file.
 *
 * Families (mapping — see migration for the canonical CASE expression):
 *  - SALES_INVOICE                       : S + add_field='I'
 *  - SALES_CHALLAN                       : S + add_field='C' (inventory only)
 *  - SALES_RETURN                        : R + add_field='I' (Credit Note: stock + A/R)
 *  - SALES_CHALLAN_RETURN                : R + add_field='C' (challan reversal, no A/R)
 *  - SALES_RETURN_ADJUSTMENT             : T (SC price-diff: A/R only, no stock)
 *  - SALES_BRK_EXP_RECEIVE               : W + add_field='I' (BRK/EXP CN: stock + A/R)
 *  - SALES_BRK_EXP_RECEIVE_CHALLAN       : W + add_field='C' (BRK/EXP challan: stock only)
 *  - SALES_ORDER                         : V
 *  - PURCHASE_INVOICE                    : P + add_field='I'
 *  - PURCHASE_CHALLAN                    : P + add_field='C' (inventory only)
 *  - PURCHASE_RETURN                     : B + add_field='I' (Debit Note: stock + A/P)
 *  - PURCHASE_CHALLAN_RETURN             : B + add_field='C' (challan reversal, no A/P)
 *  - PURCHASE_BRK_EXP_RETURN             : Q + add_field='I' (BRK/EXP DN: stock + A/P)
 *  - PURCHASE_BRK_EXP_RETURN_CHALLAN     : Q + add_field='C' (BRK/EXP challan: stock only)
 *  - PURCHASE_PRICE_DIFF_ADJUSTMENT      : U (price-diff DN: A/P only, no stock)
 *  - PURCHASE_ORDER                      : X
 *  - STOCK_RECEIVE                       : D
 *  - STOCK_ISSUE                         : L
 *  - REPLACEMENT_ISSUE                   : (line-level — set by TS classifier, never by SQL GENERATED column)
 *  - UNKNOWN_S_NO_AF / R / P / B / Q / W : header type known, add_field missing/junk — diagnostic bucket
 *  - UNKNOWN_U_UNEXPECTED_CID            : type=U with customer cid (per Marg, U is always supplier-side)
 *  - UNKNOWN                             : any header type we don't classify (Marg add-on document type)
 *
 * Both signed-amount helpers map every non-commercial family (challan,
 * adjustment, order, stock, unknown) to 0. Only the five "+1" / "-1"
 * families touch commercial sales / purchase headlines.
 */
export type MargVoucherFamily =
  | 'SALES_INVOICE'
  | 'SALES_CHALLAN'
  | 'SALES_ORDER'
  | 'PURCHASE_INVOICE'
  | 'PURCHASE_CHALLAN'
  | 'SALES_RETURN'
  | 'SALES_CHALLAN_RETURN'
  | 'SALES_RETURN_ADJUSTMENT'
  | 'SALES_BRK_EXP_RECEIVE'
  | 'SALES_BRK_EXP_RECEIVE_CHALLAN'
  | 'PURCHASE_RETURN'
  | 'PURCHASE_CHALLAN_RETURN'
  | 'PURCHASE_BRK_EXP_RETURN'
  | 'PURCHASE_BRK_EXP_RETURN_CHALLAN'
  | 'PURCHASE_PRICE_DIFF_ADJUSTMENT'
  | 'PURCHASE_ORDER'
  | 'STOCK_RECEIVE'
  | 'STOCK_ISSUE'
  | 'REPLACEMENT_ISSUE'
  | 'UNKNOWN_S_NO_AF'
  | 'UNKNOWN_R_NO_AF'
  | 'UNKNOWN_P_NO_AF'
  | 'UNKNOWN_B_NO_AF'
  | 'UNKNOWN_Q_NO_AF'
  | 'UNKNOWN_W_NO_AF'
  | 'UNKNOWN_U_UNEXPECTED_CID'
  | 'UNKNOWN';

/**
 * Returns a Prisma.Sql expression that yields the voucher family for an
 * aliased `marg_vouchers` row. Pass the alias used by the surrounding query
 * (commonly `'mv'`).
 *
 * Implementation: emits a direct column reference `${alias}.family` because
 * `family` is a Postgres GENERATED ALWAYS STORED column on marg_vouchers
 * (see the latest classifier migration). All classification logic lives in
 * the database — callers should never re-derive it inline. The GENERATED
 * column atomically recomputes on every staging upsert that touches `type`,
 * `add_field`, or `cid`, so the value is always in sync with the row's
 * current shape.
 *
 * ⚠️ GROUP BY CONTRACT — read before adding new aggregation queries
 * ------------------------------------------------------------------
 * Postgres does NOT infer functional dependency of a STORED GENERATED
 * column from its source columns. That means: if your query has a
 * GROUP BY clause and references `${alias}.family` (directly OR via
 * `margSalesAmountSignSql` / `margPurchaseAmountSignSql`) OUTSIDE any
 * aggregate, you MUST add `${alias}.family` to the GROUP BY explicitly,
 * even when `type` and `add_field` (the columns the GENERATED expression
 * derives from) are already in the GROUP BY. Otherwise the query fails
 * with error 42803 ("column must appear in the GROUP BY clause or be
 * used in an aggregate function") at runtime — not at typecheck time.
 *
 * Safe patterns (no GROUP BY change needed):
 *   - `SUM(amount * ${margSalesAmountSignSql('mv')})` — sign is inside SUM
 *   - `COUNT(*) FILTER (WHERE ${margVoucherFamilySql('mv')} = 'X')`
 *   - `WHERE ${margVoucherFamilySql('mv')} = 'X'` — pre-GROUP BY
 *
 * Unsafe patterns (require `${alias}.family` in GROUP BY):
 *   - `MAX(amount) * ${margSalesAmountSignSql('mv')}` — sign is outside MAX
 *   - `SELECT ${margVoucherFamilySql('mv')}, COUNT(*) … GROUP BY …`
 *
 * Adding `family` to the GROUP BY does not change result cardinality —
 * the column is functionally constant within any `(company_id, voucher,
 * type)` bucket.
 */
export function margVoucherFamilySql(voucherAlias: string): Prisma.Sql {
  const mv = Prisma.raw(voucherAlias);
  return Prisma.sql`${mv}.family`;
}

/**
 * Per-family contribution to a "commercial sales" headline number, in units of
 * the underlying amount column. Use as a multiplier:
 *
 *   SUM(net_amount * ${margSalesAmountSignSql('mv')})
 *
 *  - SALES_INVOICE         → +1 (counts toward gross sales)
 *  - SALES_RETURN          → -1 (subtracts per QA's "Less from Sales" rule)
 *  - SALES_BRK_EXP_RECEIVE → -1 (BRK/EXP CN reduces sales just like a normal return)
 *  - SALES_CHALLAN, SALES_CHALLAN_RETURN, SALES_BRK_EXP_RECEIVE_CHALLAN → 0
 *    (inventory-only, no A/C impact)
 *  - SALES_RETURN_ADJUSTMENT → 0 (SC price-diff is accounting-only via Book E,
 *    surfaced separately in financial reports — must not double-count here)
 *  - everything else (orders, stock, purchase families, unknown) → 0
 */
export function margSalesAmountSignSql(voucherAlias: string): Prisma.Sql {
  const family = margVoucherFamilySql(voucherAlias);
  return Prisma.sql`(
    CASE ${family}
      WHEN 'SALES_INVOICE'         THEN 1
      WHEN 'SALES_RETURN'          THEN -1
      WHEN 'SALES_BRK_EXP_RECEIVE' THEN -1
      ELSE 0
    END
  )`;
}

/**
 * Per-family contribution to a "commercial purchases" headline number, mirror
 * of `margSalesAmountSignSql`.
 *
 *  - PURCHASE_INVOICE          → +1
 *  - PURCHASE_RETURN           → -1
 *  - PURCHASE_BRK_EXP_RETURN   → -1 (BRK/EXP DN reduces purchases just like a normal return)
 *  - PURCHASE_CHALLAN, PURCHASE_CHALLAN_RETURN, PURCHASE_BRK_EXP_RETURN_CHALLAN → 0
 *    (inventory-only, no A/C impact)
 *  - PURCHASE_PRICE_DIFF_ADJUSTMENT → 0 (mirror of SALES_RETURN_ADJUSTMENT —
 *    accounting-only, surfaced separately in financial reports)
 *  - everything else → 0
 */
export function margPurchaseAmountSignSql(voucherAlias: string): Prisma.Sql {
  const family = margVoucherFamilySql(voucherAlias);
  return Prisma.sql`(
    CASE ${family}
      WHEN 'PURCHASE_INVOICE'        THEN 1
      WHEN 'PURCHASE_RETURN'         THEN -1
      WHEN 'PURCHASE_BRK_EXP_RETURN' THEN -1
      ELSE 0
    END
  )`;
}
