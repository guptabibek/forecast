import { SalesPurchaseAnalysisService } from './sales-purchase-analysis.service';

describe('SalesPurchaseAnalysisService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  it('reconciles bill drilldown totals from line rows', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            company_id: 1,
            voucher: 'INV-1',
            type: 'S',
            invoice_number: 'INV-1',
            net_amount: 118,
          },
        ])
        .mockResolvedValueOnce([
          { id: '1', quantity: 2, gross_amount: 100, discount_amount: 10, line_total: 100, tax_amount: 9, cost_rate: 30, profit: 40 },
          { id: '2', quantity: 1, gross_amount: 50, discount_amount: 5, line_total: 18, tax_amount: 9, cost_rate: 10, profit: 8 },
        ]),
    };
    const service = new SalesPurchaseAnalysisService(prisma as any);

    const result = await service.getBillDrilldown(tenantId, 'sales', '1:INV-1');

    expect(result.totals).toEqual({
      quantity: 3,
      gross: 150,
      discount: 15,
      lineTotal: 118,
      tax: 18,
      cost: 70,
      profit: 48,
    });
    expect(result.header.discount_pct).toBe(10);
  });

  it('returns paginated bill rows with the matching total count', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ bill_key: '1:INV-1', net_amount: 100 }])
        .mockResolvedValueOnce([{ cnt: BigInt(1) }]),
    };
    const service = new SalesPurchaseAnalysisService(prisma as any);

    const result = await service.getBills(tenantId, 'sales', { limit: 25, offset: 0 });

    expect(result).toEqual({
      data: [{ bill_key: '1:INV-1', net_amount: 100 }],
      total: 1,
    });
  });

  // Locks the pure-invoice-only contract. Both gates (type + family)
  // must be in every WHERE clause produced for sales/purchase analysis,
  // otherwise returns / challans / adjustments would leak back into the
  // reported totals.
  describe('pure-invoice-only contract', () => {
    const buildService = () => new SalesPurchaseAnalysisService({} as any) as any;

    it('documentTypes(sales) returns ONLY the sales-invoice type (S); never includes return / challan / adjustment types', () => {
      const types: string[] = buildService().documentTypes('sales');
      expect(types).toEqual(['S']);
      // Defensive: enumerate every type that the classifier might
      // route to a non-invoice family. None of them belong in
      // sales analysis load filter.
      for (const banned of ['R', 'W', 'T', 'B', 'Q', 'U', 'V', 'X', 'D', 'L']) {
        expect(types).not.toContain(banned);
      }
    });

    it('documentTypes(purchase) returns ONLY the purchase-invoice type (P)', () => {
      const types: string[] = buildService().documentTypes('purchase');
      expect(types).toEqual(['P']);
      for (const banned of ['B', 'Q', 'U', 'R', 'W', 'T', 'V', 'X', 'D', 'L', 'S']) {
        expect(types).not.toContain(banned);
      }
    });

    it('buildRollupWhere(sales) emits BOTH b.type IN (S) AND b.family = SALES_INVOICE so type=S challans cannot leak in', () => {
      const where = buildService().buildRollupWhere(tenantId, 'sales', {}).sql;
      expect(where).toMatch(/b\.type\s*=\s*ANY/);
      expect(where).toMatch(/b\.family\s*=\s*\?/);
      // Strong assertion: there is no orphan reference to a return / challan
      // family anywhere in the WHERE clause. If a future edit accidentally
      // re-includes them, this trips loudly.
      expect(where).not.toContain('SALES_RETURN');
      expect(where).not.toContain('SALES_CHALLAN');
      expect(where).not.toContain('SALES_BRK_EXP_RECEIVE');
    });

    it('buildRollupWhere(purchase) is the symmetric mirror — type=P + family=PURCHASE_INVOICE only', () => {
      const where = buildService().buildRollupWhere(tenantId, 'purchase', {}).sql;
      expect(where).toMatch(/b\.type\s*=\s*ANY/);
      expect(where).toMatch(/b\.family\s*=\s*\?/);
      expect(where).not.toContain('PURCHASE_RETURN');
      expect(where).not.toContain('PURCHASE_CHALLAN');
      expect(where).not.toContain('PURCHASE_BRK_EXP_RETURN');
      expect(where).not.toContain('PURCHASE_PRICE_DIFF_ADJUSTMENT');
    });

    it('buildHeaderWhere(sales) emits mv.family = SALES_INVOICE so the live aggregation path enforces the same pure-only contract as the rollup path', () => {
      const where = buildService()
        .buildHeaderWhere(tenantId, 'sales', {}, 'mv', 'mt', 'mp', 'mprod')
        .sql;
      expect(where).toMatch(/mv\.type\s*=\s*ANY/);
      expect(where).toMatch(/mv\.family\s*=\s*\?/);
    });

    it('buildHeaderWhere(purchase) emits mv.family = PURCHASE_INVOICE', () => {
      const where = buildService()
        .buildHeaderWhere(tenantId, 'purchase', {}, 'mv', 'mt', 'mp', 'mprod')
        .sql;
      expect(where).toMatch(/mv\.type\s*=\s*ANY/);
      expect(where).toMatch(/mv\.family\s*=\s*\?/);
    });

    it('legacy status=RETURN filter is accepted and coerced to FALSE (empty result) under pure-only mode', () => {
      // API backward compatibility: clients may still pass status=RETURN.
      // We must not throw; we must return zero rows. The cleanest way to
      // do that is to AND a literal FALSE into the WHERE.
      const where = buildService().buildRollupWhere(tenantId, 'sales', { status: 'RETURN' }).sql;
      expect(where).toMatch(/FALSE/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Part 2 — scope: returns + net
  // ─────────────────────────────────────────────────────────────────────
  describe('report scope (returns + net)', () => {
    const svc = () => new SalesPurchaseAnalysisService({} as any) as any;

    it('default scope is invoice (unchanged Part-1 behaviour)', () => {
      expect(svc().resolveScope({})).toBe('invoice');
      expect(svc().resolveScope({ scope: 'return' })).toBe('return');
      expect(svc().resolveScope({ scope: 'net' })).toBe('net');
    });

    it('documentTypes loads the right header types per scope', () => {
      const s = svc();
      expect(s.documentTypes('sales', 'invoice')).toEqual(['S']);
      expect(s.documentTypes('sales', 'return')).toEqual(['R', 'W']);
      expect(s.documentTypes('sales', 'net')).toEqual(['S', 'R', 'W']);
      expect(s.documentTypes('purchase', 'invoice')).toEqual(['P']);
      expect(s.documentTypes('purchase', 'return')).toEqual(['B', 'Q']);
      expect(s.documentTypes('purchase', 'net')).toEqual(['P', 'B', 'Q']);
    });

    it('scopeFamilies returns invoice/return/net family sets', () => {
      const s = svc();
      expect(s.scopeFamilies('sales', 'invoice')).toEqual(['SALES_INVOICE']);
      expect(s.scopeFamilies('sales', 'return')).toEqual(['SALES_RETURN', 'SALES_BRK_EXP_RECEIVE']);
      expect(s.scopeFamilies('sales', 'net')).toEqual(['SALES_INVOICE', 'SALES_RETURN', 'SALES_BRK_EXP_RECEIVE']);
      expect(s.scopeFamilies('purchase', 'return')).toEqual(['PURCHASE_RETURN', 'PURCHASE_BRK_EXP_RETURN']);
    });

    it('invoice scope WHERE is byte-identical to Part 1 (single-value family equality)', () => {
      const where = svc().buildRollupWhere(tenantId, 'sales', { scope: 'invoice' }).sql;
      expect(where).toMatch(/b\.family\s*=\s*\?/);
      expect(where).not.toMatch(/b\.family\s*=\s*ANY/);
    });

    it('return scope WHERE filters on the return families via ANY(array) and does NOT force FALSE', () => {
      const where = svc().buildRollupWhere(tenantId, 'sales', { scope: 'return' }).sql;
      expect(where).toMatch(/b\.family\s*=\s*ANY/);
      expect(where).not.toMatch(/FALSE/);
    });

    it('net scope WHERE spans invoice + return families', () => {
      const fams = svc().scopeFamilies('sales', 'net');
      expect(fams).toContain('SALES_INVOICE');
      expect(fams).toContain('SALES_RETURN');
      expect(fams.length).toBe(3);
      const where = svc().buildHeaderWhere(tenantId, 'sales', { scope: 'net' }, 'mv', 'mt', 'mp', 'mprod').sql;
      expect(where).toMatch(/mv\.family\s*=\s*ANY/);
    });

    it('rollup amount column: return scope reads unsigned net_amount; invoice/net read the signed column', () => {
      const s = svc();
      expect(s.scopeRollupAmountColumn('sales', 'return').sql ?? s.scopeRollupAmountColumn('sales', 'return').text ?? String(s.scopeRollupAmountColumn('sales', 'return'))).toContain('net_amount');
      const invCol = s.scopeRollupAmountColumn('sales', 'invoice');
      const netCol = s.scopeRollupAmountColumn('sales', 'net');
      // Both invoice and net use the family-signed precomputed column.
      expect(String(invCol.sql ?? invCol)).toContain('signed_sales_amount');
      expect(String(netCol.sql ?? netCol)).toContain('signed_sales_amount');
    });

    it('live sign expression: return scope is constant +1 (returns positive); invoice/net use the family sign', () => {
      const s = svc();
      expect(s.scopeAmountSignSql('sales', 'return', 'mv').sql).toContain('1');
      // net uses the family-aware CASE which contains the family column ref.
      expect(s.scopeAmountSignSql('sales', 'net', 'mv').sql).toContain('mv.family');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Customer / Supplier party dimensions (sales = customer, purchase = supplier)
  // ─────────────────────────────────────────────────────────────────────
  describe('party dimensions', () => {
    const svc = () => new SalesPurchaseAnalysisService({} as any) as any;

    it('dimensionExpressions(customer) groups by the voucher party — per-voucher, no product join', () => {
      const dim = svc().dimensionExpressions('customer');
      expect(dim.perVoucher).toBe(true);
      expect(dim.needsProduct).toBe(false);
      expect(dim.keyExpr.sql).toContain('mv.cid');
      expect(dim.labelExpr.sql).toContain('Unmapped customer');
    });

    it('dimensionExpressions(supplier) is the purchase-side mirror of customer', () => {
      const dim = svc().dimensionExpressions('supplier');
      expect(dim.perVoucher).toBe(true);
      expect(dim.needsProduct).toBe(false);
      expect(dim.keyExpr.sql).toContain('mv.cid');
      expect(dim.labelExpr.sql).toContain('Unmapped supplier');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Growth/degrowth comparison — marg_bill_rollup fast path for per-voucher
  // dimensions (the fix for the 30s timeout when viewing By Route / City / etc.)
  // ─────────────────────────────────────────────────────────────────────
  describe('comparison rollup fast path', () => {
    const svc = () => new SalesPurchaseAnalysisService({} as any) as any;

    it('customer/supplier read the party straight off marg_bill_rollup (b.cid) + a marg_parties name join', () => {
      const cust = svc().rollupDimensionParts(tenantId, 'customer');
      expect(cust.keyExpr.sql).toContain('b.cid');
      expect(String(cust.joins?.sql)).toContain('marg_parties');
      expect(cust.labelExpr.sql).toContain('Unmapped customer');

      const supp = svc().rollupDimensionParts(tenantId, 'supplier');
      expect(supp.labelExpr.sql).toContain('Unmapped supplier');
    });

    it('salesman resolves the name without touching the line tables', () => {
      const parts = svc().rollupDimensionParts(tenantId, 'salesman');
      expect(parts.keyExpr.sql).toContain('b.salesman');
      expect(parts.keyExpr.sql).toContain('__UNATTRIBUTED__');
      expect(parts.leadingCtes).toBeUndefined();
    });

    it('state resolves the route name via per-bill add_field segment 20 (sg_code ROUT)', () => {
      const parts = svc().rollupDimensionParts(tenantId, 'state');
      expect(String(parts.leadingCtes?.sql)).toContain('state_per_bill');
      expect(String(parts.leadingCtes?.sql)).toContain('20');
      expect(String(parts.joins?.sql)).toContain('ROUT');
    });

    it('city resolves the area name via per-bill add_field segment 21 (sg_code AREA)', () => {
      const parts = svc().rollupDimensionParts(tenantId, 'city');
      expect(String(parts.leadingCtes?.sql)).toContain('area_per_bill');
      expect(String(parts.leadingCtes?.sql)).toContain('21');
      expect(String(parts.joins?.sql)).toContain('AREA');
    });

    it('rejects a per-line dimension — those must stay on the live aggregation path', () => {
      expect(() => svc().rollupDimensionParts(tenantId, 'productCompany')).toThrow();
      expect(() => svc().rollupDimensionParts(tenantId, 'product')).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Cancelled-line contract: every live line aggregation built on
  // compatibleLineTypeSql must also drop individually-cancelled lines, so it
  // reconciles EXACTLY with marg_bill_rollup (whose refresh applies the same
  // filter) and the overview / dimension rollup fast path. This is the
  // invariant that makes the rollup fast path numerically interchangeable with
  // the live path.
  // ─────────────────────────────────────────────────────────────────────
  describe('cancelled-line exclusion', () => {
    const svc = () => new SalesPurchaseAnalysisService({} as any) as any;

    it('compatibleLineTypeSql ANDs mt.is_cancelled = FALSE into the join predicate', () => {
      const sql = svc().compatibleLineTypeSql('mv', 'mt').sql;
      expect(sql).toMatch(/mt\.is_cancelled\s*=\s*FALSE/i);
      // and still carries the header→line type compatibility pairs
      expect(sql).toMatch(/UPPER\(mv\.type\)\s*=\s*'S'/);
    });
  });
});
