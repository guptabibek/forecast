import { PinnedReportInsightProvider } from './pinned-report-insight.provider';
import { InsightProviderContext, InsightReportRows } from '../insight-provider.interface';

describe('PinnedReportInsightProvider', () => {
  const now = new Date('2026-06-11T08:00:00Z');

  function isoDaysAgo(days: number): string {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  }

  function widget(overrides: Partial<{ id: string; title: string; createdAt: Date; semanticQuery: any }> = {}) {
    return {
      id: 'widget-1',
      tenantId: 'tenant-1',
      title: 'Sales last 30 days',
      createdAt: now,
      semanticQuery: {
        queryKind: 'single_report',
        title: 'Sales last 30 days',
        datasetId: 'sales_net',
        metrics: ['sales_net_amount'],
        dimensions: ['sales_net_product'],
        timeRange: { preset: 'custom', startDate: isoDaysAgo(30), endDate: isoDaysAgo(0) },
        limit: 50,
      },
      ...overrides,
    };
  }

  function buildProvider(widgets: any[], runReport: jest.Mock) {
    const prisma = { aiDashboardWidget: { findMany: jest.fn().mockResolvedValue(widgets) } } as any;
    const provider = new PinnedReportInsightProvider(prisma);
    const ctx: InsightProviderContext = { tenantId: 'tenant-1', now, config: {}, runReport };
    return { provider, ctx, prisma };
  }

  function result(rows: Record<string, unknown>[], columns: string[] = []): InsightReportRows {
    return { columns: columns.map((key) => ({ key, label: key })), rows, rowCount: rows.length };
  }

  it('produces a comparison insight for a past-facing metric query', async () => {
    const runReport = jest
      .fn()
      .mockResolvedValueOnce(result([{ product_name: 'AIRFLOW 250', sales_net_amount: 60000 }]))
      .mockResolvedValueOnce(result([{ product_name: 'AIRFLOW 250', sales_net_amount: 40000 }]));
    const { provider, ctx } = buildProvider([widget()], runReport);

    const candidates = await provider.generate(ctx);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].dedupeKey).toBe('widget:widget-1');
    expect(candidates[0].title).toBe('Pinned report: Sales last 30 days');
    expect(candidates[0].metrics).toMatchObject({
      headline: '₹60,000',
      currentTotal: 60000,
      previousTotal: 40000,
      changePct: 50,
    });
    // +50% → medium magnitude severity, neutral wording
    expect(candidates[0].severity).toBe('medium');
    expect(candidates[0].summary).toContain('up 50.0%');
    expect(candidates[0].evidence).toEqual(['AIRFLOW 250: ₹60,000']);
    // The comparison window directly precedes the current one with equal span.
    const previousQuery = runReport.mock.calls[1][0];
    expect(previousQuery.timeRange).toEqual({
      preset: 'custom',
      startDate: isoDaysAgo(61),
      endDate: isoDaysAgo(31),
    });
  });

  it('does not compare future-facing windows (e.g. expiring in next 90 days)', async () => {
    const futureWidget = widget({
      id: 'widget-2',
      title: 'Expiring stock in next 90 days',
      semanticQuery: {
        queryKind: 'single_report',
        title: 'Expiring stock in next 90 days',
        datasetId: 'expiry',
        metrics: [],
        dimensions: [],
        timeRange: {
          preset: 'custom',
          startDate: isoDaysAgo(0),
          endDate: (() => {
            const d = new Date(now);
            d.setUTCDate(d.getUTCDate() + 90);
            return d.toISOString().slice(0, 10);
          })(),
        },
      },
    });
    const runReport = jest.fn().mockResolvedValue(result([{ product: 'URICRABE D' }, { product: 'QT-PINE 50' }]));
    const { provider, ctx } = buildProvider([futureWidget], runReport);

    const candidates = await provider.generate(ctx);

    expect(runReport).toHaveBeenCalledTimes(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].severity).toBe('info');
    expect(candidates[0].metrics).toMatchObject({ headline: '2 rows', rowCount: 2 });
    expect(candidates[0].summary).toContain('matches 2 record(s)');
  });

  it('skips a failing widget but still analyzes the rest', async () => {
    const runReport = jest
      .fn()
      .mockRejectedValueOnce(new Error('dataset removed'))
      .mockResolvedValueOnce(result([{ sales_net_amount: 1000 }]))
      .mockResolvedValueOnce(result([{ sales_net_amount: 1000 }]));
    const { provider, ctx } = buildProvider([widget({ id: 'broken' }), widget({ id: 'healthy' })], runReport);

    const candidates = await provider.generate(ctx);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].dedupeKey).toBe('widget:healthy');
    // Flat (0% change) → informational only.
    expect(candidates[0].severity).toBe('info');
  });

  it('skips widgets whose query returns no rows and has nothing to compare', async () => {
    const runReport = jest
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([]));
    const { provider, ctx } = buildProvider([widget()], runReport);

    await expect(provider.generate(ctx)).resolves.toEqual([]);
  });

  it('returns nothing when the tenant has no pinned widgets', async () => {
    const runReport = jest.fn();
    const { provider, ctx } = buildProvider([], runReport);

    await expect(provider.generate(ctx)).resolves.toEqual([]);
    expect(runReport).not.toHaveBeenCalled();
  });
});
