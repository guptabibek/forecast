import { Prisma } from '@prisma/client';

/**
 * Single source of truth for classifying a Marg voucher (MDis row) into a
 * commercial document family from raw SQL. Mirrors the TypeScript classifier
 * in `marg-ede.service.ts` (resolveMargType2ProjectionDecision) — any change
 * to the canonical mapping must be applied to both the TS classifier AND the
 * Postgres GENERATED expression defined in the
 * `20260520130000_add_marg_voucher_family_generated_column` migration.
 *
 * Families:
 *  - SALES_INVOICE              : MDis.Type=S + VCN starts STR + AddField[0]=I
 *  - SALES_CHALLAN              : MDis.Type=S + VCN starts CHAL/*CHAL (no A/C impact, no sales actual; inventory only)
 *  - SALES_ORDER                : MDis.Type=V + VCN starts OS (no commercial actual)
 *  - PURCHASE_INVOICE           : MDis.Type=P
 *  - SALES_RETURN               : MDis.Type=R + VCN starts CN (negative sales actual + inventory return)
 *  - SALES_RETURN_ADJUSTMENT    : MDis.Type=T + VCN starts SC (accounting-only credit, NO commercial actual, NO inventory)
 *  - PURCHASE_RETURN            : MDis.Type=B + VCN starts DN
 *  - PURCHASE_ORDER             : MDis.Type=X + VCN starts PO-
 *  - STOCK_RECEIVE              : MDis.Type=D + VCN starts AD
 *  - STOCK_ISSUE                : MDis.Type=L
 *  - UNKNOWN                    : any other shape
 */
export type MargVoucherFamily =
  | 'SALES_INVOICE'
  | 'SALES_CHALLAN'
  | 'SALES_ORDER'
  | 'PURCHASE_INVOICE'
  | 'SALES_RETURN'
  | 'SALES_RETURN_ADJUSTMENT'
  | 'PURCHASE_RETURN'
  | 'PURCHASE_ORDER'
  | 'STOCK_RECEIVE'
  | 'STOCK_ISSUE'
  | 'UNKNOWN';

/**
 * Returns a Prisma.Sql expression that yields the voucher family for an
 * aliased `marg_vouchers` row. Pass the alias used by the surrounding query
 * (commonly `'mv'`).
 *
 * Implementation: emits a direct column reference `${alias}.family` because
 * `family` is a Postgres GENERATED ALWAYS STORED column on marg_vouchers
 * (see the 20260520130000 migration). All classification logic lives in
 * the database — callers should never re-derive it inline. The GENERATED
 * column atomically recomputes on every staging upsert that touches `type`
 * or `vcn`, so the value is always in sync with the row's current shape.
 *
 * ⚠️ GROUP BY CONTRACT — read before adding new aggregation queries
 * ------------------------------------------------------------------
 * Postgres does NOT infer functional dependency of a STORED GENERATED
 * column from its source columns. That means: if your query has a
 * GROUP BY clause and references `${alias}.family` (directly OR via
 * `margSalesAmountSignSql` / `margPurchaseAmountSignSql`) OUTSIDE any
 * aggregate, you MUST add `${alias}.family` to the GROUP BY explicitly,
 * even when `type` and `vcn` (the columns the GENERATED expression
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
 *
 * Compatibility: the original implementation emitted a large `CASE WHEN ...`
 * expression that callers spliced into their queries. That worked but
 * forced every aggregation to remember to call this helper and made the
 * classification logic invisible to operators running ad-hoc SQL. The
 * column-reference form keeps the helper's call surface unchanged while
 * collapsing the SQL footprint and the operational complexity.
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
 *  - SALES_RETURN          → -1 (subtracts from sales per QA's "Less from Sales" rule)
 *  - SALES_CHALLAN         →  0 (inventory only, no A/C impact, must not affect sales total)
 *  - SALES_RETURN_ADJUSTMENT → 0 (SC price-diff is accounting-only via Book E)
 *  - everything else       →  0
 */
export function margSalesAmountSignSql(voucherAlias: string): Prisma.Sql {
  const family = margVoucherFamilySql(voucherAlias);
  return Prisma.sql`(
    CASE ${family}
      WHEN 'SALES_INVOICE' THEN 1
      WHEN 'SALES_RETURN'  THEN -1
      ELSE 0
    END
  )`;
}

/**
 * Per-family contribution to a "commercial purchases" headline number, mirror
 * of `margSalesAmountSignSql`.
 *
 *  - PURCHASE_INVOICE  → +1
 *  - PURCHASE_RETURN   → -1
 *  - everything else   →  0
 */
export function margPurchaseAmountSignSql(voucherAlias: string): Prisma.Sql {
  const family = margVoucherFamilySql(voucherAlias);
  return Prisma.sql`(
    CASE ${family}
      WHEN 'PURCHASE_INVOICE' THEN 1
      WHEN 'PURCHASE_RETURN'  THEN -1
      ELSE 0
    END
  )`;
}
