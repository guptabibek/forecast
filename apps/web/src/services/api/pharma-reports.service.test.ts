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

  it('requests stock-out data through the reports endpoint', async () => {
    get.mockResolvedValueOnce({ data: { analysis: {}, data: [], total: 0 } });

    await pharmaReportsService.getStockOuts({ offset: 50 });

    expect(get).toHaveBeenCalledWith('/reports/stock-out', {
      params: { offset: '50' },
    });
  });
});