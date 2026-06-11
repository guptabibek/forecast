import * as fs from 'fs';
import * as path from 'path';
import { detectRankingIntent, repairDatasetCoherence, repairGroupingIntent } from './grouping-intent.util';
import { SemanticCatalog, SemanticReportQuery } from './semantic-query.types';

// Tests run against the REAL shipped catalog so they also prove the regional
// dimensions and synonyms this layer depends on actually exist.
const catalog: SemanticCatalog = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../ai-reporting/semantic-catalog.json'), 'utf8'),
);

function degradedQuery(overrides: Partial<SemanticReportQuery> = {}): SemanticReportQuery {
  // The failure shape: metrics chosen, grouping dropped, detail-ish output.
  return {
    queryKind: 'single_report',
    title: 'AI Report',
    datasetId: 'sales_net',
    mode: 'detail',
    metrics: ['sales_net_amount'],
    dimensions: [],
    displayColumns: ['snet_customer_name', 'snet_net_amount'],
    limit: 5,
    ...overrides,
  };
}

describe('detectRankingIntent', () => {
  it.each([
    ['Top 5 routes with most sales', 'desc', 5, 'routes'],
    ['Top 5 cities with most sales', 'desc', 5, 'cities'],
    ['Top 5 areas with most purchase', 'desc', 5, 'areas'],
    ['Top 10 customers by revenue', 'desc', 10, 'customers'],
    ['Bottom 5 customers', 'asc', 5, 'customers'],
    ['Routes with lowest sales', 'asc', null, 'routes'],
    ['Cities with highest purchase', 'desc', null, 'cities'],
    ['Most profitable items', 'desc', null, 'items'],
    ['States contributing highest revenue', 'desc', null, 'states'],
    ['Top selling brands', 'desc', null, 'brands'],
    ['Best performing distributors', 'desc', null, 'distributors'],
    ['Highest growth areas', 'desc', null, 'areas'],
  ])('"%s" → %s limit=%s noun=%s', (question, direction, limit, noun) => {
    const intent = detectRankingIntent(question);
    expect(intent).not.toBeNull();
    expect(intent!.direction).toBe(direction);
    expect(intent!.limit).toBe(limit);
    expect(intent!.noun).toContain(noun);
  });

  it('returns null when there is no ranking vocabulary', () => {
    expect(detectRankingIntent('sales for customer ABC this month')).toBeNull();
  });
});

describe('repairGroupingIntent', () => {
  it('repairs "Top 5 routes with most sales" into a grouped ranking query', () => {
    const { query, repaired } = repairGroupingIntent('Top 5 routes with most sales', degradedQuery(), catalog);
    expect(repaired).toBe(true);
    expect(query.dimensions).toEqual(['sales_net_route']);
    expect(query.mode).toBe('ranking');
    expect(query.displayColumns).toEqual([]);
    expect(query.sort).toEqual([{ metricId: 'sales_net_amount', direction: 'desc' }]);
    expect(query.limit).toBe(5);
    expect(query.assumptions?.some((a) => a.includes('Interpreted as ranking'))).toBe(true);
  });

  it.each([
    ['Top 5 cities with most sales', 'sales_net', 'sales_net_area'],
    ['States contributing highest revenue', 'sales_net', 'sales_net_route'],
    ['Top selling brands', 'sales_net', 'sales_net_company'],
    ['Top 10 customers by revenue', 'sales_net', 'sales_net_customer'],
  ])('"%s" resolves to dimension %s/%s', (question, datasetId, dimensionId) => {
    const { query, repaired } = repairGroupingIntent(question, degradedQuery({ datasetId }), catalog);
    expect(repaired).toBe(true);
    expect(query.dimensions).toEqual([dimensionId]);
  });

  it('repairs purchase-side regional questions', () => {
    const { query, repaired } = repairGroupingIntent(
      'Top 5 routes with most purchase',
      degradedQuery({ datasetId: 'purchase_net', metrics: ['purchase_net_amount'] }),
      catalog,
    );
    expect(repaired).toBe(true);
    expect(query.dimensions).toEqual(['purchase_net_route']);
  });

  it('uses ascending sort for "lowest" questions', () => {
    const { query } = repairGroupingIntent('Routes with lowest sales', degradedQuery(), catalog);
    expect(query.sort).toEqual([{ metricId: 'sales_net_amount', direction: 'asc' }]);
  });

  it('remaps the sibling dataset when only it has the dimension', () => {
    const { query, repaired } = repairGroupingIntent(
      'Top 5 routes with most sales',
      degradedQuery({ datasetId: 'sales_items', metrics: ['net_sales'] }),
      catalog,
    );
    expect(repaired).toBe(true);
    expect(query.datasetId).toBe('sales_net');
    expect(query.metrics).toEqual(['sales_net_amount']);
    expect(query.dimensions).toEqual(['sales_net_route']);
  });

  it('never touches genuine detail questions ("top 5 sales records")', () => {
    const input = degradedQuery();
    const { query, repaired } = repairGroupingIntent('Top 5 sales records', input, catalog);
    expect(repaired).toBe(false);
    expect(query).toBe(input);
  });

  it('never touches queries that already have dimensions', () => {
    const input = degradedQuery({ dimensions: ['sales_net_customer'] });
    const { repaired } = repairGroupingIntent('Top 10 customers by revenue', input, catalog);
    expect(repaired).toBe(false);
  });

  it('flags a known business entity with no catalog dimension as unsupported', () => {
    const stripped: SemanticCatalog = { ...catalog, dimensions: catalog.dimensions.filter((d) => !/route/.test(d.dimensionId)) };
    const { repaired, unsupportedNoun } = repairGroupingIntent('Top 5 routes with most sales', degradedQuery(), stripped);
    expect(repaired).toBe(false);
    expect(unsupportedNoun).toBe('route');
  });

  it('does not flag unknown nouns outside the business-entity vocabulary', () => {
    const { repaired, unsupportedNoun } = repairGroupingIntent('Top 5 gizmos with most sales', degradedQuery(), catalog);
    expect(repaired).toBe(false);
    expect(unsupportedNoun).toBeUndefined();
  });
});

describe('repairDatasetCoherence', () => {
  it('translates sibling-dataset metric ids onto the chosen dataset (the "net_sales on sales_net" failure)', () => {
    // "top 5 routes with maximum sales … bar diagram": LLM picks sales_net
    // (only it has the route dimension) but borrows net_sales from sales_items.
    const repaired = repairDatasetCoherence(
      degradedQuery({
        metrics: ['net_sales'],
        dimensions: ['sales_net_route'],
        mode: 'ranking',
        sort: [{ metricId: 'net_sales', direction: 'desc' }],
        output: { showGrid: true, showChart: true, chartType: 'bar', xField: 'region_route_name', yField: 'net_sales' },
      }),
      catalog,
    );
    expect(repaired.metrics).toEqual(['sales_net_amount']);
    expect(repaired.sort).toEqual([{ metricId: 'sales_net_amount', direction: 'desc' }]);
    expect(repaired.output?.yField).toBe('sales_net_amount');
    expect(repaired.dimensions).toEqual(['sales_net_route']);
    expect(repaired.assumptions).toContain('Adjusted metric/dimension identifiers to the selected dataset.');
  });

  it('translates in the reverse direction and for dimensions', () => {
    const repaired = repairDatasetCoherence(
      degradedQuery({
        datasetId: 'sales_items',
        metrics: ['sales_net_amount'],
        dimensions: ['sales_net_customer'],
      }),
      catalog,
    );
    expect(repaired.metrics).toEqual(['net_sales']);
    expect(repaired.dimensions).toEqual(['sales_item_customer']);
  });

  it('translates purchase-side ids', () => {
    const repaired = repairDatasetCoherence(
      degradedQuery({ datasetId: 'purchase_net', metrics: ['net_purchase'], dimensions: ['purchase_net_route'] }),
      catalog,
    );
    expect(repaired.metrics).toEqual(['purchase_net_amount']);
  });

  it('leaves valid queries and untranslatable ids untouched', () => {
    const valid = degradedQuery({ metrics: ['sales_net_amount'], dimensions: ['sales_net_route'] });
    expect(repairDatasetCoherence(valid, catalog)).toBe(valid);

    const unknown = degradedQuery({ metrics: ['no_such_metric'] });
    expect(repairDatasetCoherence(unknown, catalog).metrics).toEqual(['no_such_metric']);
  });
});
