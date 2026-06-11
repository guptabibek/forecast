import { WidgetExecutorService } from './widget-executor.service';

describe('WidgetExecutorService', () => {
  const user = { id: 'user-1', tenantId: 'tenant-1', role: 'MEMBER', permissions: ['reports.ai.view'] };

  const successResult = {
    status: 'success',
    title: 'Report',
    mode: 'aggregate',
    metadata: { metricLabel: '', groupedBy: '', periodLabel: '' },
    kpis: [],
    grid: { columns: [], rows: [], totals: {} },
    chart: { enabled: false, type: 'none', xField: null, yField: null, data: [] },
    visualization: { type: 'table' },
    columns: [],
    rows: [],
    rowCount: 0,
    executionTimeMs: 5,
    unsupportedReason: null,
  };

  function isoDaysFromNow(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function buildService(widget: any) {
    const dashboardService = { requireWidget: jest.fn().mockResolvedValue(widget) } as any;
    const aiReporting = { executeStoredReport: jest.fn().mockResolvedValue(successResult) } as any;
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    } as any;
    return { service: new WidgetExecutorService(dashboardService, aiReporting, cache), aiReporting, cache };
  }

  function widgetWith(timeRange: any, pinnedDaysAgo: number) {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - pinnedDaysAgo);
    return {
      id: 'widget-1',
      tenantId: user.tenantId,
      userId: user.id,
      title: 'My widget',
      vizType: null,
      filters: null,
      refreshIntervalSec: null,
      createdAt,
      semanticQuery: {
        queryKind: 'single_report',
        title: 'Report',
        datasetId: 'sales_net',
        metrics: ['sales_net_amount'],
        dimensions: [],
        timeRange,
      },
    };
  }

  it('rolls a past window pinned as "last 30 days" forward so it still ends today', async () => {
    // Pinned 10 days ago with a window ending on the pin date.
    const { service, aiReporting } = buildService(
      widgetWith({ preset: 'custom', startDate: isoDaysFromNow(-40), endDate: isoDaysFromNow(-10) }, 10),
    );
    await service.execute(user, 'widget-1');
    const executed = aiReporting.executeStoredReport.mock.calls[0][1].semanticQuery;
    expect(executed.timeRange.startDate).toBe(isoDaysFromNow(-30));
    expect(executed.timeRange.endDate).toBe(isoDaysFromNow(0));
  });

  it('rolls a future window ("next 90 days") forward so it still starts today', async () => {
    const { service, aiReporting } = buildService(
      widgetWith({ preset: 'custom', startDate: isoDaysFromNow(-7), endDate: isoDaysFromNow(83) }, 7),
    );
    await service.execute(user, 'widget-1');
    const executed = aiReporting.executeStoredReport.mock.calls[0][1].semanticQuery;
    expect(executed.timeRange.startDate).toBe(isoDaysFromNow(0));
    expect(executed.timeRange.endDate).toBe(isoDaysFromNow(90));
  });

  it('leaves genuinely historical fixed ranges untouched', async () => {
    const { service, aiReporting } = buildService(
      widgetWith({ preset: 'custom', startDate: '2025-01-01', endDate: '2025-03-31' }, 10),
    );
    await service.execute(user, 'widget-1');
    const executed = aiReporting.executeStoredReport.mock.calls[0][1].semanticQuery;
    expect(executed.timeRange).toEqual({ preset: 'custom', startDate: '2025-01-01', endDate: '2025-03-31' });
  });

  it('leaves preset ranges untouched (they re-resolve at compile time)', async () => {
    const { service, aiReporting } = buildService(widgetWith({ preset: 'this_month' }, 30));
    await service.execute(user, 'widget-1');
    const executed = aiReporting.executeStoredReport.mock.calls[0][1].semanticQuery;
    expect(executed.timeRange).toEqual({ preset: 'this_month' });
  });

  it('returns the cached payload without executing when present', async () => {
    const widget = widgetWith({ preset: 'this_month' }, 0);
    const { service, aiReporting, cache } = buildService(widget);
    cache.get.mockResolvedValue({ ...successResult, widgetId: 'widget-1', cached: false, cachedAt: 'x' });
    const result = await service.execute(user, 'widget-1');
    expect(result.cached).toBe(true);
    expect(aiReporting.executeStoredReport).not.toHaveBeenCalled();
  });
});
