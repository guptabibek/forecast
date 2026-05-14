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
});
