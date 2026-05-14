import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pharmaReportsService } from './pharma-reports.service';

const { get } = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('./client', () => ({
  apiClient: {
    get,
  },
}));

describe('pharmaReportsService procurement reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests supplier performance through the reports endpoint', async () => {
    get.mockResolvedValueOnce({ data: { analysis: {}, data: [], total: 0 } });

    await pharmaReportsService.getSupplierPerformance({ limit: 25 });

    expect(get).toHaveBeenCalledWith('/reports/supplier-performance', {
      params: { limit: '25' },
    });
  });

  it('requests supplier performance purchase-order drill-down with encoded supplier key', async () => {
    get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

    await pharmaReportsService.getSupplierPerformancePurchaseOrders('supplier:abc 123', { limit: 25 });

    expect(get).toHaveBeenCalledWith('/reports/supplier-performance/supplier%3Aabc%20123/purchase-orders', {
      params: { limit: '25' },
    });
  });

  it('requests supplier performance purchase-invoice drill-down with encoded supplier key', async () => {
    get.mockResolvedValueOnce({ data: { data: [], total: 0 } });

    await pharmaReportsService.getSupplierPerformancePurchaseInvoices('marg:11093:C001', { offset: 25 });

    expect(get).toHaveBeenCalledWith('/reports/supplier-performance/marg%3A11093%3AC001/purchase-invoices', {
      params: { offset: '25' },
    });
  });

  it('requests stock-out data through the reports endpoint', async () => {
    get.mockResolvedValueOnce({ data: { analysis: {}, data: [], total: 0 } });

    await pharmaReportsService.getStockOuts({ offset: 50 });

    expect(get).toHaveBeenCalledWith('/reports/stock-out', {
      params: { offset: '50' },
    });
  });

  it('requests financial outstanding through the pharma reports endpoint', async () => {
    get.mockResolvedValueOnce({ data: { rows: [], total: 0 } });

    await pharmaReportsService.getFinancialOutstanding({ partyType: 'CUSTOMER', companyId: 11093 });

    expect(get).toHaveBeenCalledWith('/pharma-reports/financial/outstanding', {
      params: { partyType: 'CUSTOMER', companyId: '11093' },
    });
  });

  it('requests party outstanding detail with encoded party code', async () => {
    get.mockResolvedValueOnce({ data: { invoices: [], totals: {} } });

    await pharmaReportsService.getFinancialOutstandingDetail('ABC 123', { companyId: 11093, includeSettled: true });

    expect(get).toHaveBeenCalledWith('/pharma-reports/financial/outstanding/ABC%20123', {
      params: { companyId: '11093', includeSettled: 'true' },
    });
  });

  it('requests party ledger with date range and pagination', async () => {
    get.mockResolvedValueOnce({ data: { transactions: [], pagination: { total: 0 } } });

    await pharmaReportsService.getFinancialPartyLedger('SUP1', {
      companyId: 11093,
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
      limit: 50,
      offset: 100,
    });

    expect(get).toHaveBeenCalledWith('/pharma-reports/financial/ledger/SUP1', {
      params: {
        companyId: '11093',
        fromDate: '2026-04-01',
        toDate: '2026-04-30',
        limit: '50',
        offset: '100',
      },
    });
  });
});
