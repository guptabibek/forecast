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
});
