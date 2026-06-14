import { analyzeReportResult, buildPreviousPeriodQuery, sumPrimaryMetric } from './result-analytics.util';
import { SemanticReportQuery } from '../ai-reporting/semantic-query.types';

describe('result-analytics util', () => {
  const now = new Date('2026-06-11T08:00:00Z');

  function query(overrides: Partial<SemanticReportQuery> = {}): SemanticReportQuery {
    return {
      queryKind: 'single_report',
      title: 'Sales by route',
      datasetId: 'sales_net',
      metrics: ['sales_net_amount'],
      dimensions: ['sales_net_route'],
      timeRange: { preset: 'custom', startDate: '2026-05-12', endDate: '2026-06-11' },
      ...overrides,
    };
  }

  function result(rows: Record<string, unknown>[], columns: string[] = ['region_route_name', 'sales_net_amount']) {
    return { columns: columns.map((key) => ({ key, label: key })), rows, rowCount: rows.length };
  }

  describe('buildPreviousPeriodQuery', () => {
    it('builds the immediately preceding window of equal length', () => {
      const previous = buildPreviousPeriodQuery(query(), now);
      expect(previous?.timeRange).toEqual({ preset: 'custom', startDate: '2026-04-11', endDate: '2026-05-11' });
    });

    it('returns null for presets, future windows, and metric-less queries', () => {
      expect(buildPreviousPeriodQuery(query({ timeRange: { preset: 'this_month' } }), now)).toBeNull();
      expect(
        buildPreviousPeriodQuery(query({ timeRange: { preset: 'custom', startDate: '2026-06-11', endDate: '2026-09-09' } }), now),
      ).toBeNull();
      expect(buildPreviousPeriodQuery(query({ metrics: [] }), now)).toBeNull();
    });
  });

  it('computes contribution and Pareto insights for grouped results', () => {
    const analytics = analyzeReportResult({
      query: query(),
      result: result([
        { region_route_name: 'MADHYA PRADESH', sales_net_amount: 4200 },
        { region_route_name: 'MAHARASHTRA', sales_net_amount: 3300 },
        { region_route_name: 'GUJARAT', sales_net_amount: 1500 },
        { region_route_name: 'DELHI', sales_net_amount: 600 },
        { region_route_name: 'PUNJAB', sales_net_amount: 400 },
      ]),
      currentTotal: 10000,
      previousTotal: 8000,
    });

    expect(analytics).not.toBeNull();
    expect(analytics!.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Total Sales net amount', value: '₹10,000' }),
        expect.objectContaining({ label: 'vs previous period', value: '+25.0%', tone: 'positive' }),
      ]),
    );
    expect(analytics!.insights.some((line) => line.includes('"MADHYA PRADESH" contributes 42.0%'))).toBe(true);
    expect(analytics!.insights.some((line) => line.includes('Top 3 account for 90.0%'))).toBe(true);
    expect(analytics!.insights.some((line) => line.includes('drive 80% of the total'))).toBe(true);
    expect(analytics!.insights.some((line) => line.includes('up 25.0%'))).toBe(true);
  });

  it('detects a rising monthly trend from date-bucketed rows', () => {
    const rows = [
      { month: '2026-01-01', sales_net_amount: 100 },
      { month: '2026-02-01', sales_net_amount: 120 },
      { month: '2026-03-01', sales_net_amount: 150 },
      { month: '2026-04-01', sales_net_amount: 190 },
    ];
    const analytics = analyzeReportResult({
      query: query({ dimensions: ['sales_month'] }),
      result: result(rows, ['month', 'sales_net_amount']),
      currentTotal: 560,
      previousTotal: null,
    });
    expect(analytics?.trend?.direction).toBe('rising');
    expect(analytics?.trend?.points).toHaveLength(4);
  });

  it('marks negative growth with a negative tone', () => {
    const analytics = analyzeReportResult({
      query: query({ dimensions: [] }),
      result: result([{ sales_net_amount: 4000 }], ['sales_net_amount']),
      currentTotal: 4000,
      previousTotal: 8000,
    });
    expect(analytics!.kpis).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'vs previous period', value: '-50.0%', tone: 'negative' })]),
    );
  });

  it('returns null for empty results and quantity formatting stays non-currency', () => {
    expect(
      analyzeReportResult({ query: query(), result: result([]), currentTotal: 0, previousTotal: null }),
    ).toBeNull();

    const analytics = analyzeReportResult({
      query: query({ metrics: ['sales_net_quantity'] }),
      result: result([{ region_route_name: 'X', sales_net_quantity: 1200 }]),
      currentTotal: 1200,
      previousTotal: null,
    });
    expect(analytics!.kpis[0]).toEqual(expect.objectContaining({ label: 'Total Sales net quantity', value: '1,200' }));
  });

  it('sums the primary metric across rows', () => {
    expect(
      sumPrimaryMetric(result([{ sales_net_amount: 100 }, { sales_net_amount: 250 }], ['sales_net_amount']), query()),
    ).toBe(350);
    expect(sumPrimaryMetric(result([]), query({ metrics: [] }))).toBeNull();
  });
});
