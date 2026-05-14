import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SemanticCatalogLoader } from './semantic-catalog.loader';

describe('SemanticCatalogLoader', () => {
  let loader: SemanticCatalogLoader;

  beforeEach(() => {
    delete process.env.AI_SEMANTIC_CATALOG_PATH;
    loader = new SemanticCatalogLoader();
    loader.onModuleInit();
  });

  it('loads the production semantic catalog with approved NLQ datasets', () => {
    const catalog = loader.getCatalog();

    expect(catalog.catalogVersion).toBeTruthy();
    expect(catalog.datasets.length).toBeGreaterThanOrEqual(8);
    expect(catalog.datasets.every((dataset) => dataset.allowedForNlq)).toBe(true);
    expect(catalog.datasets.every((dataset) => /^vw_ai_[a-z0-9_]+$/.test(dataset.viewName))).toBe(true);
    expect(catalog.disallowedOperations.length).toBeGreaterThan(0);
  });

  it('keeps catalog IDs unique across datasets, metrics, dimensions, filters, and templates', () => {
    const catalog = loader.getCatalog();
    const assertUnique = (label: string, values: string[]) => {
      expect(new Set(values).size).toBe(values.length);
      expect(values).not.toContain('');
      expect(values.length).toBeGreaterThan(0);
    };

    assertUnique('datasets', catalog.datasets.map((item) => item.datasetId));
    assertUnique('metrics', catalog.metrics.map((item) => item.metricId));
    assertUnique('dimensions', catalog.dimensions.map((item) => item.dimensionId));
    assertUnique('filters', catalog.filters.map((item) => item.filterId));
    assertUnique('report templates', catalog.reportTemplates.map((item) => item.templateId));
  });

  it('validates report and dashboard templates reference existing catalog IDs', () => {
    const catalog = loader.getCatalog();
    const datasetIds = new Set(catalog.datasets.map((item) => item.datasetId));
    const metricIds = new Set(catalog.metrics.map((item) => item.metricId));
    const dimensionIds = new Set(catalog.dimensions.map((item) => item.dimensionId));
    const templateIds = new Set(catalog.reportTemplates.map((item) => item.templateId));

    for (const template of catalog.reportTemplates) {
      expect(datasetIds.has(template.datasetId)).toBe(true);
      for (const metricId of template.defaultMetrics) expect(metricIds.has(metricId)).toBe(true);
      for (const dimensionId of template.defaultDimensions) expect(dimensionIds.has(dimensionId)).toBe(true);
    }

    for (const dashboard of catalog.dashboardTemplates) {
      expect(dashboard.components.length).toBeGreaterThan(0);
      for (const component of dashboard.components) {
        expect(templateIds.has(component.templateId)).toBe(true);
      }
    }
  });

  it('defines dynamic detail display columns and dataset defaults for every approved dataset', () => {
    const catalog = loader.getCatalog();
    const datasetIds = new Set(catalog.datasets.map((item) => item.datasetId));
    const metricIds = new Set(catalog.metrics.map((item) => item.metricId));
    const displayColumnIds = new Set(catalog.displayColumns.map((item) => item.columnId));
    const safeColumn = /^[a-z][a-z0-9_]*$/i;

    expect(catalog.displayColumns.length).toBeGreaterThan(catalog.datasets.length);

    for (const dataset of catalog.datasets) {
      expect(dataset.defaultAggregateMetrics?.length).toBeGreaterThan(0);
      expect(dataset.defaultDetailColumns?.length).toBeGreaterThan(0);
      expect(dataset.synonyms?.length).toBeGreaterThan(0);
      for (const metricId of dataset.defaultAggregateMetrics ?? []) expect(metricIds.has(metricId)).toBe(true);
      for (const columnId of dataset.defaultDetailColumns ?? []) expect(displayColumnIds.has(columnId)).toBe(true);
    }

    for (const column of catalog.displayColumns) {
      expect(datasetIds.has(column.datasetId)).toBe(true);
      expect(column.column).toMatch(safeColumn);
      expect(column.label).toBeTruthy();
      expect(column.dataType).toBeTruthy();
    }
  });

  it('fails loudly on boot when the configured catalog file is structurally invalid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-catalog-invalid-'));
    const path = join(dir, 'semantic-catalog.json');
    try {
      writeFileSync(path, JSON.stringify({
        catalogVersion: '0.1',
        datasets: [{ datasetId: 'sales_items', viewName: 'vw_ai_sales_items', domain: 'sales', grain: 'item_level', description: '', allowedForNlq: true, requiredSecurityFilters: ['tenant_id'] }],
        metrics: [{ metricId: 'fake_metric', displayName: 'Fake', datasetId: 'nonexistent_dataset', expression: 'SUM(x)', aggregation: 'sum', dataType: 'number' }],
        dimensions: [],
        filters: [],
        timeFields: [],
        reportTemplates: [],
        dashboardTemplates: [],
      }), 'utf8');
      process.env.AI_SEMANTIC_CATALOG_PATH = path;
      const bad = new SemanticCatalogLoader();
      expect(() => bad.onModuleInit()).toThrow(/invalid/i);
    } finally {
      delete process.env.AI_SEMANTIC_CATALOG_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps filter columns bound to catalog datasets and does not expose raw internals to prompts', () => {
    const catalog = loader.getCatalog();
    const datasetIds = new Set(catalog.datasets.map((item) => item.datasetId));
    const safeColumn = /^[a-z][a-z0-9_]*$/i;

    for (const filter of catalog.filters) {
      expect(filter.datasetIds.length).toBeGreaterThan(0);
      for (const datasetId of filter.datasetIds) {
        expect(datasetId === '*' || datasetIds.has(datasetId)).toBe(true);
      }
      if (filter.column) expect(filter.column).toMatch(safeColumn);
      for (const column of filter.columns ?? []) expect(column).toMatch(safeColumn);
    }

    const promptCatalog = loader.getPromptCatalog();
    const promptCatalogText = JSON.stringify(promptCatalog);
    expect(promptCatalogText).not.toContain('viewName');
    expect(promptCatalogText).not.toContain('sourceTables');
    expect(promptCatalogText).not.toContain('marg_');

    for (const tf of promptCatalog.timeFields) {
      expect((tf as Record<string, unknown>).column).toBeUndefined();
    }
    for (const dataset of promptCatalog.datasets) {
      for (const dateField of dataset.dateFields ?? []) {
        expect((dateField as Record<string, unknown>).column).toBeUndefined();
      }
    }
    for (const filter of promptCatalog.filters) {
      expect((filter as Record<string, unknown>).column).toBeUndefined();
      expect((filter as Record<string, unknown>).columns).toBeUndefined();
    }
  });
});
