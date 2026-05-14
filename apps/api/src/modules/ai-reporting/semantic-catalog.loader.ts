import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  CatalogDashboardTemplate,
  CatalogDataset,
  CatalogDimension,
  CatalogDisplayColumn,
  CatalogFilter,
  CatalogMetric,
  CatalogReportTemplate,
  CatalogTimeField,
  SemanticCatalog,
} from './semantic-query.types';

@Injectable()
export class SemanticCatalogLoader implements OnModuleInit {
  private readonly logger = new Logger(SemanticCatalogLoader.name);
  private catalog!: SemanticCatalog;
  private datasets = new Map<string, CatalogDataset>();
  private metrics = new Map<string, CatalogMetric>();
  private dimensions = new Map<string, CatalogDimension>();
  private filters = new Map<string, CatalogFilter>();
  private timeFields = new Map<string, CatalogTimeField>();
  private displayColumns = new Map<string, CatalogDisplayColumn>();
  private templates = new Map<string, CatalogReportTemplate>();
  private dashboards = new Map<string, CatalogDashboardTemplate>();

  onModuleInit() {
    this.load();
  }

  getCatalog(): SemanticCatalog {
    if (!this.catalog) this.load();
    return this.catalog;
  }

  getDataset(id: string) {
    return this.datasets.get(id);
  }

  getMetric(id: string) {
    return this.metrics.get(id);
  }

  getDimension(id: string) {
    return this.dimensions.get(id);
  }

  getFilter(id: string) {
    return this.filters.get(id);
  }

  getTimeField(id: string) {
    return this.timeFields.get(id);
  }

  getDisplayColumn(id: string) {
    return this.displayColumns.get(id);
  }

  getTemplate(id: string) {
    return this.templates.get(id);
  }

  getDashboard(id: string) {
    return this.dashboards.get(id);
  }

  getLimitedMetadata() {
    const catalog = this.getCatalog();
    return {
      catalogVersion: catalog.catalogVersion,
      datasets: catalog.datasets
        .filter((d) => d.allowedForNlq)
        .map((d) => ({
          datasetId: d.datasetId,
          domain: d.domain,
          grain: d.grain,
          description: d.description,
          defaultDetailColumns: d.defaultDetailColumns ?? [],
          defaultAggregateMetrics: d.defaultAggregateMetrics ?? [],
          synonyms: d.synonyms ?? [],
        })),
      metrics: catalog.metrics.map((m) => ({
        metricId: m.metricId,
        displayName: m.displayName,
        datasetId: m.datasetId,
        dataType: m.dataType,
        synonyms: m.synonyms ?? [],
      })),
      dimensions: catalog.dimensions.map((d) => ({
        dimensionId: d.dimensionId,
        displayName: d.displayName,
        datasetId: d.datasetId,
        labelColumn: d.labelColumn,
        fallbackLabelColumn: d.fallbackLabelColumn,
        synonyms: d.synonyms ?? [],
      })),
      displayColumns: (catalog.displayColumns ?? []).map((c) => ({
        columnId: c.columnId,
        datasetId: c.datasetId,
        label: c.label,
        dataType: c.dataType,
        defaultForDetail: c.defaultForDetail,
        synonyms: c.synonyms ?? [],
      })),
      reportTemplates: catalog.reportTemplates.map((t) => ({
        templateId: t.templateId,
        displayName: t.displayName,
        analysisType: t.analysisType,
        synonyms: t.synonyms ?? [],
      })),
      dashboardTemplates: catalog.dashboardTemplates.map((d) => ({
        dashboardId: d.dashboardId,
        displayName: d.displayName,
        description: d.description,
        synonyms: d.synonyms ?? [],
      })),
    };
  }

  getPromptCatalog() {
    const catalog = this.getCatalog();
    return {
      catalogVersion: catalog.catalogVersion,
      datasets: catalog.datasets.map((d) => ({
        datasetId: d.datasetId,
        domain: d.domain,
        grain: d.grain,
        description: d.description,
        dateFields: (d.dateFields ?? []).map((f) => ({ fieldId: f.fieldId, default: f.default ?? false })),
        defaultDetailColumns: d.defaultDetailColumns ?? [],
        defaultAggregateMetrics: d.defaultAggregateMetrics ?? [],
        synonyms: d.synonyms ?? [],
      })),
      metrics: catalog.metrics.map((m) => ({
        metricId: m.metricId,
        displayName: m.displayName,
        datasetId: m.datasetId,
        synonyms: m.synonyms,
        businessRules: m.businessRules,
      })),
      dimensions: catalog.dimensions.map((d) => ({
        dimensionId: d.dimensionId,
        displayName: d.displayName,
        datasetId: d.datasetId,
        labelColumn: d.labelColumn,
        fallbackLabelColumn: d.fallbackLabelColumn,
        synonyms: d.synonyms,
      })),
      filters: catalog.filters
        .filter((f) => f.securityFilter !== true)
        .map((f) => ({
          filterId: f.filterId,
          displayName: f.displayName,
          datasetIds: f.datasetIds,
          operators: f.operators,
          allowedValues: f.allowedValues,
        })),
      timeFields: catalog.timeFields.map((t) => ({
        fieldId: t.fieldId,
        datasetId: t.datasetId,
        default: t.default ?? false,
        synonyms: t.synonyms,
      })),
      displayColumns: (catalog.displayColumns ?? []).map((c) => ({
        columnId: c.columnId,
        datasetId: c.datasetId,
        label: c.label,
        dataType: c.dataType,
        defaultForDetail: c.defaultForDetail,
        synonyms: c.synonyms ?? [],
      })),
      synonyms: catalog.synonyms,
      defaultAssumptions: catalog.defaultAssumptions,
      reportTemplates: catalog.reportTemplates.map((t) => ({
        templateId: t.templateId,
        displayName: t.displayName,
        datasetId: t.datasetId,
        analysisType: t.analysisType,
        defaultMetrics: t.defaultMetrics,
        defaultDimensions: t.defaultDimensions,
        defaultDisplayColumns: t.defaultDisplayColumns ?? [],
        defaultLimit: t.defaultLimit,
        visualization: t.visualization,
        synonyms: t.synonyms,
      })),
      dashboardTemplates: catalog.dashboardTemplates.map((d) => ({
        dashboardId: d.dashboardId,
        displayName: d.displayName,
        description: d.description,
        synonyms: d.synonyms,
        components: d.components.map((c) => ({ templateId: c.templateId, position: c.position })),
      })),
    };
  }

  private load() {
    const envPath = process.env.AI_SEMANTIC_CATALOG_PATH;
    const candidates = [
      envPath ? resolve(envPath) : '',
      resolve(process.cwd(), 'ai-reporting/semantic-catalog.json'),
      resolve(process.cwd(), 'apps/api/ai-reporting/semantic-catalog.json'),
      resolve(process.cwd(), 'server/ai-reporting/semantic-catalog.json'),
      resolve(process.cwd(), '../../server/ai-reporting/semantic-catalog.json'),
      join(__dirname, '../../../ai-reporting/semantic-catalog.json'),
      join(__dirname, '../../../../../server/ai-reporting/semantic-catalog.json'),
    ].filter(Boolean);

    let loadedPath: string | null = null;
    let parsed: SemanticCatalog | null = null;
    for (const path of candidates) {
      try {
        parsed = JSON.parse(readFileSync(path, 'utf8')) as SemanticCatalog;
        loadedPath = path;
        break;
      } catch {
        // Try the next known runtime path.
      }
    }

    if (!parsed || !loadedPath) {
      throw new Error('AI semantic catalog could not be loaded from configured paths');
    }

    parsed.displayColumns = parsed.displayColumns ?? [];
    this.validateStructure(parsed, loadedPath);
    this.catalog = parsed;
    this.datasets = new Map(parsed.datasets.map((d) => [d.datasetId, d]));
    this.metrics = new Map(parsed.metrics.map((m) => [m.metricId, m]));
    this.dimensions = new Map(parsed.dimensions.map((d) => [d.dimensionId, d]));
    this.filters = new Map(parsed.filters.map((f) => [f.filterId, f]));
    this.timeFields = new Map(parsed.timeFields.map((t) => [t.fieldId, t]));
    this.displayColumns = new Map(parsed.displayColumns.map((c) => [c.columnId, c]));
    this.templates = new Map(parsed.reportTemplates.map((t) => [t.templateId, t]));
    this.dashboards = new Map(parsed.dashboardTemplates.map((d) => [d.dashboardId, d]));
    this.logger.log(`Loaded AI semantic catalog ${parsed.catalogVersion} from ${loadedPath}`);
  }

  private validateStructure(catalog: SemanticCatalog, path: string) {
    const errors: string[] = [];
    const safeIdentifier = /^[a-z][a-z0-9_]*$/i;

    if (!catalog.catalogVersion || typeof catalog.catalogVersion !== 'string') {
      errors.push('catalogVersion is missing');
    }
    const sections: Array<[string, unknown]> = [
      ['datasets', catalog.datasets],
      ['metrics', catalog.metrics],
      ['dimensions', catalog.dimensions],
      ['filters', catalog.filters],
      ['timeFields', catalog.timeFields],
      ['reportTemplates', catalog.reportTemplates],
      ['dashboardTemplates', catalog.dashboardTemplates],
    ];
    for (const [key, value] of sections) {
      if (!Array.isArray(value)) errors.push(`${key} must be an array`);
      else if (value.length === 0) errors.push(`${key} must not be empty`);
    }

    if (errors.length) {
      throw new Error(`AI semantic catalog at ${path} is invalid: ${errors.join('; ')}`);
    }

    const datasetIds = new Set(catalog.datasets.map((d) => d.datasetId));
    const metricIds = new Set(catalog.metrics.map((m) => m.metricId));
    const dimensionIds = new Set(catalog.dimensions.map((d) => d.dimensionId));
    const templateIds = new Set(catalog.reportTemplates.map((t) => t.templateId));
    const filterIds = new Set(catalog.filters.map((f) => f.filterId));
    const timeFieldIds = new Set(catalog.timeFields.map((t) => t.fieldId));
    const displayColumnIds = new Set((catalog.displayColumns ?? []).map((c) => c.columnId));

    this.requireUnique('datasetId', catalog.datasets.map((d) => d.datasetId), errors);
    this.requireUnique('metricId', catalog.metrics.map((m) => m.metricId), errors);
    this.requireUnique('dimensionId', catalog.dimensions.map((d) => d.dimensionId), errors);
    this.requireUnique('filterId', catalog.filters.map((f) => f.filterId), errors);
    this.requireUnique('timeFieldId', catalog.timeFields.map((t) => t.fieldId), errors);
    this.requireUnique('templateId', catalog.reportTemplates.map((t) => t.templateId), errors);
    this.requireUnique('dashboardId', catalog.dashboardTemplates.map((d) => d.dashboardId), errors);

    for (const dataset of catalog.datasets) {
      if (!safeIdentifier.test(dataset.datasetId)) errors.push(`dataset ${dataset.datasetId} has an unsafe id`);
      if (!safeIdentifier.test(dataset.viewName)) errors.push(`dataset ${dataset.datasetId} has an unsafe viewName ${dataset.viewName}`);
      if (!Array.isArray(dataset.requiredSecurityFilters) || dataset.requiredSecurityFilters.length === 0) {
        errors.push(`dataset ${dataset.datasetId} has no required security filters`);
      }
      for (const dateField of dataset.dateFields ?? []) {
        if (!safeIdentifier.test(dateField.column)) errors.push(`dataset ${dataset.datasetId} dateField has an unsafe column`);
      }
    }

    for (const metric of catalog.metrics) {
      if (!datasetIds.has(metric.datasetId)) errors.push(`metric ${metric.metricId} references unknown dataset ${metric.datasetId}`);
      if (!metric.expression || typeof metric.expression !== 'string') errors.push(`metric ${metric.metricId} has no expression`);
    }

    for (const dimension of catalog.dimensions) {
      if (dimension.datasetId !== '*' && !datasetIds.has(dimension.datasetId)) {
        errors.push(`dimension ${dimension.dimensionId} references unknown dataset ${dimension.datasetId}`);
      }
      for (const column of dimension.columns) {
        if (column !== 'default_time_field' && !safeIdentifier.test(column)) {
          errors.push(`dimension ${dimension.dimensionId} has unsafe column ${column}`);
        }
      }
    }

    for (const filter of catalog.filters) {
      for (const datasetId of filter.datasetIds) {
        if (datasetId !== '*' && !datasetIds.has(datasetId)) {
          errors.push(`filter ${filter.filterId} references unknown dataset ${datasetId}`);
        }
      }
      if (filter.column && !safeIdentifier.test(filter.column)) errors.push(`filter ${filter.filterId} has unsafe column ${filter.column}`);
      for (const column of filter.columns ?? []) {
        if (!safeIdentifier.test(column)) errors.push(`filter ${filter.filterId} has unsafe column ${column}`);
      }
    }

    for (const tf of catalog.timeFields) {
      if (!datasetIds.has(tf.datasetId)) errors.push(`timeField ${tf.fieldId} references unknown dataset ${tf.datasetId}`);
      if (!safeIdentifier.test(tf.column)) errors.push(`timeField ${tf.fieldId} has unsafe column ${tf.column}`);
    }

    for (const column of catalog.displayColumns ?? []) {
      if (!datasetIds.has(column.datasetId)) errors.push(`displayColumn ${column.columnId} references unknown dataset ${column.datasetId}`);
      if (!safeIdentifier.test(column.column)) errors.push(`displayColumn ${column.columnId} has unsafe column ${column.column}`);
    }

    for (const template of catalog.reportTemplates) {
      if (!datasetIds.has(template.datasetId)) errors.push(`template ${template.templateId} references unknown dataset ${template.datasetId}`);
      for (const metricId of template.defaultMetrics ?? []) {
        if (!metricIds.has(metricId)) errors.push(`template ${template.templateId} references unknown metric ${metricId}`);
      }
      for (const dimensionId of template.defaultDimensions ?? []) {
        if (!dimensionIds.has(dimensionId)) errors.push(`template ${template.templateId} references unknown dimension ${dimensionId}`);
      }
      for (const columnId of template.defaultDisplayColumns ?? []) {
        if (!displayColumnIds.has(columnId)) errors.push(`template ${template.templateId} references unknown display column ${columnId}`);
      }
      for (const filter of template.defaultFilters ?? []) {
        if (filter.filterId && !filterIds.has(filter.filterId)) errors.push(`template ${template.templateId} references unknown filter ${filter.filterId}`);
      }
      for (const sort of template.defaultSort ?? []) {
        if (sort.metricId && !metricIds.has(sort.metricId)) errors.push(`template ${template.templateId} sort references unknown metric ${sort.metricId}`);
        if (sort.dimensionId && !dimensionIds.has(sort.dimensionId)) errors.push(`template ${template.templateId} sort references unknown dimension ${sort.dimensionId}`);
        if (sort.fieldId && !timeFieldIds.has(sort.fieldId)) errors.push(`template ${template.templateId} sort references unknown time field ${sort.fieldId}`);
      }
    }

    for (const dashboard of catalog.dashboardTemplates) {
      if (!Array.isArray(dashboard.components) || dashboard.components.length === 0) {
        errors.push(`dashboard ${dashboard.dashboardId} has no components`);
        continue;
      }
      for (const component of dashboard.components) {
        if (!templateIds.has(component.templateId)) {
          errors.push(`dashboard ${dashboard.dashboardId} references unknown template ${component.templateId}`);
        }
      }
    }

    if (errors.length) {
      throw new Error(`AI semantic catalog at ${path} is invalid: ${errors.slice(0, 20).join('; ')}${errors.length > 20 ? ` (and ${errors.length - 20} more)` : ''}`);
    }
  }

  private requireUnique(label: string, values: string[], errors: string[]) {
    const seen = new Set<string>();
    for (const value of values) {
      if (!value) {
        errors.push(`${label} contains an empty id`);
        continue;
      }
      if (seen.has(value)) errors.push(`${label} ${value} is duplicated`);
      seen.add(value);
    }
  }
}
