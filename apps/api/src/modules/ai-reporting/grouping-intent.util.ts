import { CatalogDimension, SemanticCatalog, SemanticFilter, SemanticQuery, SemanticReportQuery } from './semantic-query.types';

/**
 * Deterministic grouping/ranking intent extraction — the backstop for the
 * class of NLQ failures where the LLM silently DROPS the grouping dimension
 * ("Top 5 routes with most sales" answered as "top 5 sales records").
 *
 * The LLM stays responsible for dataset/metric/filter selection; this layer
 * only intervenes when all of the following hold, so legitimate detail
 * queries ("top 5 invoices by amount") are never touched:
 *   1. the question carries explicit ranking-over-an-entity intent,
 *   2. the parsed query has metrics but NO grouping dimension,
 *   3. the ranked noun resolves to a catalog dimension on the chosen dataset
 *      (or on a designated sibling dataset with translatable metrics).
 *
 * Extension point: add patterns to NOUN_PATTERNS / vocabulary to KNOWN_ENTITY_NOUNS;
 * resolution is synonym-driven from the semantic catalog, so newly cataloged
 * dimensions participate automatically.
 */

export interface RankingIntent {
  direction: 'asc' | 'desc';
  limit: number | null;
  noun: string | null;
}

export interface GroupingRepairResult {
  query: SemanticReportQuery;
  repaired: boolean;
  /** Set when the question names a known business entity that no dataset can group by. */
  unsupportedNoun?: string;
}

/** Questions about these nouns are genuine row listings — never repaired. */
const DETAIL_NOUNS = new Set([
  'record', 'records', 'row', 'rows', 'line', 'lines', 'entry', 'entries', 'detail', 'details',
  'transaction', 'transactions', 'invoice', 'invoices', 'bill', 'bills', 'voucher', 'vouchers',
  'order', 'orders', 'sale', 'sales', 'purchase', 'purchases',
]);

/**
 * Business entities users group by. A ranked noun matching this list that
 * resolves to NO catalog dimension yields a precise "unsupported" instead of
 * silently wrong ungrouped results. Nouns outside this list never trigger
 * unsupported (extraction noise must not break valid queries).
 */
const KNOWN_ENTITY_NOUNS = new Set([
  'route', 'city', 'area', 'state', 'region', 'territory', 'locality',
  'customer', 'party', 'buyer', 'item', 'product', 'medicine', 'drug', 'sku',
  'brand', 'company', 'manufacturer', 'supplier', 'distributor', 'vendor',
  'salesman', 'salesperson', 'warehouse', 'branch', 'batch', 'group', 'salt', 'category',
]);

const DESC_WORDS = /\b(top|best|highest|largest|biggest|leading|most|maximum)\b/;
const ASC_WORDS = /\b(bottom|worst|lowest|least|smallest|minimum)\b/;

// Order matters: entity-position patterns run before the loose "noun ends the
// question" fallback, which would otherwise capture the MEASURE ("lowest
// sales" → "sales") instead of the entity ("routes with lowest sales").
const NOUN_PATTERNS: RegExp[] = [
  // "top 5 routes with/by/in most sales", "top 10 customers by revenue",
  // "top 10 items whose sales decreased"
  /\b(?:top|bottom|best|worst|highest|lowest|largest|biggest|leading)\s+(?:\d{1,3}\s+)?(?:performing\s+|selling\s+|profitable\s+|growing\s+|moving\s+)?([a-z][a-z _-]{1,40}?)\s+(?:with|by|in|on|of|for|across|based|this|last|that|whose|where|having|contributing)\b/,
  // "cities with highest purchase", "routes having the lowest sales"
  /\b([a-z][a-z _-]{1,40}?)\s+(?:with|having|by)\s+(?:the\s+)?(?:most|highest|lowest|least|largest|smallest|best|worst|maximum|minimum|top)\b/,
  // "states contributing highest revenue", "areas generating the most sales"
  /\b([a-z][a-z _-]{1,40}?)\s+(?:contributing|generating|producing|driving)\s+(?:the\s+)?(?:highest|most|lowest|least)\b/,
  // "most profitable items", "most sold products"
  /\bmost\s+(?:profitable|sold|selling|purchased|valuable|active|moving)\s+([a-z][a-z _-]{1,40}?)(?:\s|$)/,
  // fallback — noun ends the question: "top selling brands", "bottom 5 customers"
  /\b(?:top|bottom|best|worst|highest|lowest|largest|biggest|leading)\s+(?:\d{1,3}\s+)?(?:performing\s+|selling\s+|profitable\s+|growing\s+|moving\s+)?([a-z][a-z _-]{1,40})$/,
];

/**
 * Equivalent metric/dimension IDs across the item ↔ net sibling datasets.
 * One table drives BOTH repairs: translating stray IDs onto the chosen
 * dataset (the LLM mixing vocabularies, e.g. dataset sales_net with metric
 * net_sales), and the whole-query sibling remap below. Pairs are
 * [item-dataset id, net-dataset id].
 */
const EQUIVALENT_ID_PAIRS: Array<[string, string]> = [
  // sales_items ↔ sales_net
  ['net_sales', 'sales_net_amount'],
  ['sold_quantity', 'sales_net_quantity'],
  ['sales_product', 'sales_net_product'],
  ['sales_item_customer', 'sales_net_customer'],
  ['sales_item_salesman', 'sales_net_salesman'],
  ['sales_company', 'sales_net_company'],
  // purchase_items ↔ purchase_net
  ['net_purchase', 'purchase_net_amount'],
  ['purchase_quantity', 'purchase_net_quantity'],
  ['purchase_product', 'purchase_net_product'],
  ['purchase_item_supplier', 'purchase_net_supplier'],
];

const ID_EQUIVALENTS: Record<string, string> = Object.fromEntries(
  EQUIVALENT_ID_PAIRS.flatMap(([itemId, netId]) => [
    [itemId, netId],
    [netId, itemId],
  ]),
);

/**
 * Sibling datasets whose metrics translate 1:1 — used when the LLM picked the
 * gross item dataset but the requested dimension only exists on the net
 * dataset. Only remapped when EVERY metric in the query translates.
 */
const DATASET_REMAP: Record<string, { datasetId: string; metricMap: Record<string, string> }> = {
  sales_items: {
    datasetId: 'sales_net',
    metricMap: { net_sales: 'sales_net_amount', sold_quantity: 'sales_net_quantity' },
  },
  purchase_items: {
    datasetId: 'purchase_net',
    metricMap: { net_purchase: 'purchase_net_amount', purchase_quantity: 'purchase_net_quantity' },
  },
};

/**
 * Translates metric/dimension IDs the LLM borrowed from a SIBLING dataset
 * onto the dataset it actually chose ("Metric is not available on dataset
 * sales_net: net_sales" — dataset right, vocabulary wrong). Only IDs with a
 * known equivalent that really exists on the chosen dataset are rewritten;
 * everything else is left for the validator's precise error.
 */
export function repairDatasetCoherence(
  query: SemanticReportQuery,
  catalog: SemanticCatalog,
): SemanticReportQuery {
  if (query.queryKind !== 'single_report' || !query.datasetId) return query;

  const metricExists = (id: string) => catalog.metrics.some((m) => m.metricId === id && m.datasetId === query.datasetId);
  const dimensionExists = (id: string) =>
    catalog.dimensions.some((d) => d.dimensionId === id && (d.datasetId === query.datasetId || d.datasetId === '*'));

  const translate = (id: string, exists: (id: string) => boolean): string => {
    if (exists(id)) return id;
    const equivalent = ID_EQUIVALENTS[id];
    return equivalent && exists(equivalent) ? equivalent : id;
  };

  const metrics = (query.metrics ?? []).map((id) => translate(id, metricExists));
  const dimensions = (query.dimensions ?? []).map((id) => translate(id, dimensionExists));
  const sort = (query.sort ?? []).map((item) => ({
    ...item,
    metricId: item.metricId ? translate(item.metricId, metricExists) : item.metricId,
    dimensionId: item.dimensionId ? translate(item.dimensionId, dimensionExists) : item.dimensionId,
  }));
  const output = query.output?.yField
    ? { ...query.output, yField: translate(query.output.yField, metricExists) }
    : query.output;

  const changed =
    metrics.some((id, index) => id !== (query.metrics ?? [])[index]) ||
    dimensions.some((id, index) => id !== (query.dimensions ?? [])[index]) ||
    sort.some((item, index) => item.metricId !== query.sort?.[index]?.metricId || item.dimensionId !== query.sort?.[index]?.dimensionId) ||
    output?.yField !== query.output?.yField;
  if (!changed) return query;

  return {
    ...query,
    metrics,
    dimensions,
    sort,
    output,
    assumptions: [
      ...(query.assumptions ?? []),
      'Adjusted metric/dimension identifiers to the selected dataset.',
    ],
  };
}

export interface ChangeRankingIntent {
  /** 'decrease' ranks most-negative change first (asc); 'increase' the reverse. */
  direction: 'decrease' | 'increase';
  comparisonType: 'previous_period' | 'previous_year';
  limit: number | null;
}

const DECREASE_WORDS = /\b(decreas\w*|declin\w*|drop\w*|fell|fall\w*|down|shrink\w*|reduc\w*|degrowth|lost|losing)\b/;
const INCREASE_WORDS = /\b(increas\w*|grow\w*|growth|rise|rising|rose|gain\w*|jump\w*|up)\b/;
const PERIOD_REFERENCE = /\b(previous|last|prior|compared?|compare|vs|versus|than)\b.*\b(month|week|quarter|year|period)\b|\b(month|week|quarter|year|period)\s+(over|on)\s+(month|week|quarter|year|period)\b/;

/**
 * "Top N <entity> whose <measure> decreased/increased compared to the
 * previous <period>" — a ranking over the PERIOD-OVER-PERIOD DELTA, which the
 * stacked comparison listing can never answer. Detected deterministically so
 * the engine repairs LLM output that degraded to two period lists or a
 * single-period ranking.
 */
export function detectChangeRankingIntent(question: string): ChangeRankingIntent | null {
  const text = normalize(question);
  if (!PERIOD_REFERENCE.test(text)) return null;
  const decrease = DECREASE_WORDS.test(text);
  const increase = INCREASE_WORDS.test(text);
  if (!decrease && !increase) return null;

  const limitMatch = text.match(/\b(?:top|bottom|first)\s+(\d{1,3})\b/);
  const limit = limitMatch ? Number(limitMatch[1]) : null;
  return {
    // "decrease" wins when both appear ("items going down despite growth …").
    direction: decrease ? 'decrease' : 'increase',
    comparisonType: /\b(year|yoy)\b/.test(text) && !/\bmonth\b/.test(text) ? 'previous_year' : 'previous_period',
    limit: limit && limit >= 1 && limit <= 500 ? limit : null,
  };
}

/**
 * Ensures a change-ranking question compiles as one: comparison.rankBy =
 * 'change', sort direction from increase/decrease, a grouping dimension
 * (resolved from the question when the LLM dropped it), and a current-period
 * time range. No-op for questions without change-ranking intent.
 */
export function repairChangeRankingIntent(
  question: string,
  query: SemanticReportQuery,
  catalog: SemanticCatalog,
): SemanticReportQuery {
  if (query.queryKind !== 'single_report' || !query.metrics?.length) return query;
  const intent = detectChangeRankingIntent(question);
  if (!intent) return query;

  // Dimension: keep the LLM's, otherwise resolve the ranked noun ourselves.
  let dimensions = query.dimensions ?? [];
  if (!dimensions.length) {
    const ranking = detectRankingIntent(question);
    const dimension = ranking?.noun ? resolveGroupingDimension(ranking.noun, query.datasetId, catalog) : null;
    if (!dimension) return query; // cannot rank change without a dimension
    dimensions = [dimension.dimensionId];
  }

  const direction = intent.direction === 'decrease' ? 'asc' : 'desc';
  return {
    ...query,
    mode: 'comparison',
    analysisType: 'ranking',
    dimensions,
    displayColumns: [],
    comparison: {
      enabled: true,
      type: query.comparison?.type === 'previous_year' || intent.comparisonType === 'previous_year' ? 'previous_year' : 'previous_period',
      startDate: null,
      endDate: null,
      rankBy: 'change',
    },
    // Current period defaults to this month when the question gave none.
    timeRange: query.timeRange ?? { preset: 'this_month' },
    sort: [{ metricId: query.metrics[0], direction }],
    limit: intent.limit ?? query.limit ?? 10,
    assumptions: [
      ...(query.assumptions ?? []),
      `Ranking by ${intent.direction} in ${query.metrics[0]} versus the ${intent.comparisonType === 'previous_year' ? 'same period last year' : 'previous period'}.`,
    ],
  };
}

// Absence / non-movement phrasing. These questions are answerable ONLY by the
// item_velocity master dataset (transactional views can't express "did not
// sell"). The LLM mostly routes them correctly, but occasionally returns
// "unsupported" or degrades onto a sales dataset — this backstop forces the
// right routing deterministically.
const ABSENCE_PATTERN =
  /\b(not (been )?(sold|selling|moving)|never (been )?sold|no sales|without (any )?sales|non[ -]?moving|dead stock|slow[ -]?moving|idle (item|items|stock|product|products)|stale stock|not been sold)\b/;

export function detectAbsenceIntent(question: string): boolean {
  return ABSENCE_PATTERN.test(normalize(question));
}

function parseNotSoldWindow(text: string): number | null {
  const match = text.match(/\b(?:last|past|in|within|over)\s+(\d{1,4})\s+(day|days|week|weeks|month|months|year|years)\b/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  const unit = match[2];
  if (unit.startsWith('day')) return n;
  if (unit.startsWith('week')) return n * 7;
  if (unit.startsWith('month')) return n * 30;
  return n * 365;
}

// Named relative periods → an idle-days threshold (yesterday/today = 1 day).
function namedPeriodDays(text: string): number | null {
  if (/\b(yesterday|today)\b/.test(text)) return 1;
  if (/\bthis week\b/.test(text)) return 7;
  if (/\bthis month\b/.test(text)) return 30;
  if (/\bthis quarter\b/.test(text)) return 90;
  return null;
}

const ABSENCE_FILTER_IDS = new Set(['never_sold_filter', 'days_since_last_sold_filter', 'movement_status_filter']);

/**
 * The single, satisfiable absence predicate for the question:
 *  - "never sold"                  → never_sold = true
 *  - "not sold in N days /
 *     yesterday / this month"      → days_since_last_sold_filter >= N (targets the
 *                                    non-null days_idle column, so never-sold counts)
 *  - "non-moving / dead / slow /
 *     idle"                        → movement_status IN (NEVER_SOLD, NON_MOVING, SLOW_MOVING)
 */
function buildAbsenceFilter(text: string): SemanticFilter {
  if (/\bnever\b|\bnot been sold\b|\bno sales\b/.test(text)) {
    return { filterId: 'never_sold_filter', operator: '=', value: true };
  }
  const windowDays = parseNotSoldWindow(text) ?? namedPeriodDays(text);
  if (windowDays != null) {
    return { filterId: 'days_since_last_sold_filter', operator: '>=', value: windowDays };
  }
  return { filterId: 'movement_status_filter', operator: 'IN', value: ['NEVER_SOLD', 'NON_MOVING', 'SLOW_MOVING'] };
}

function absenceAssumption(filter: SemanticFilter): string {
  if (filter.filterId === 'never_sold_filter') return 'Interpreted as items that have never been sold, from the item master.';
  if (filter.filterId === 'days_since_last_sold_filter') return `Interpreted as items not sold in the last ${filter.value} day(s), from the item master.`;
  return 'Interpreted as non-moving / not-recently-sold items, from the item master.';
}

/**
 * Routes absence/non-movement questions ("items not sold this month", "never
 * sold products", "dead stock") to item_velocity and enforces ONE correct,
 * satisfiable absence predicate. The LLM frequently AND-s mutually exclusive
 * predicates (e.g. never_sold + days/movement, which return nothing), gives up
 * (unsupported), or degrades onto a transactional dataset. When it already
 * chose item_velocity its presentation (mode/columns/limit) and any non-absence
 * filters (e.g. product exclusions) are preserved. Non-absence questions and a
 * catalog without item_velocity are left untouched.
 */
export function repairAbsenceIntent(
  question: string,
  query: SemanticQuery,
  catalog: SemanticCatalog,
): SemanticQuery {
  if (!catalog.datasets.some((d) => d.datasetId === 'item_velocity' && d.allowedForNlq)) return query;
  if (!detectAbsenceIntent(question)) return query;

  const text = normalize(question);
  const absenceFilter = buildAbsenceFilter(text);

  if (query.queryKind === 'single_report' && query.datasetId === 'item_velocity') {
    const existing = query.filters ?? [];
    const nonAbsence = existing.filter((f) => !ABSENCE_FILTER_IDS.has(f.filterId ?? ''));
    const absenceOk =
      existing.length === nonAbsence.length + 1 &&
      existing.some((f) => f.filterId === absenceFilter.filterId);
    if (absenceOk) return query;
    return {
      ...query,
      filters: [absenceFilter, ...nonAbsence],
      assumptions: [...(query.assumptions ?? []), absenceAssumption(absenceFilter)],
    };
  }

  const rescuable =
    query.queryKind === 'unsupported' ||
    (query.queryKind === 'single_report' && query.datasetId !== 'item_velocity');
  if (!rescuable) return query;

  const ranking = detectRankingIntent(question);
  const isCount = /\b(how many|number of|count of|count)\b/.test(text);
  const base = {
    queryKind: 'single_report' as const,
    title: (query as any).title ?? 'Item velocity',
    datasetId: 'item_velocity',
    comparison: { enabled: false, type: 'none' as const, startDate: null, endDate: null },
    timeRange: { preset: 'unspecified' as const },
    filters: [absenceFilter],
    assumptions: [absenceAssumption(absenceFilter), 'Routed to the item velocity (non-moving) dataset.'],
    followUpQuestions: [],
  };

  if (isCount) {
    return {
      ...base, mode: 'kpi', analysisType: 'grouped_summary',
      metrics: ['idle_item_count'], dimensions: [], displayColumns: [],
      sort: [{ metricId: 'idle_item_count', direction: 'desc' }],
      limit: 1, visualization: { type: 'kpi' },
    };
  }
  if (ranking?.noun || /\b(top|bottom|most|least|longest|highest|lowest)\b/.test(text)) {
    return {
      ...base, mode: 'ranking', analysisType: 'ranking',
      metrics: ['max_days_since_last_sold'], dimensions: ['velocity_product'], displayColumns: [],
      sort: [{ metricId: 'max_days_since_last_sold', direction: ranking?.direction ?? 'desc' }],
      limit: ranking?.limit ?? 10, visualization: { type: 'bar' },
    };
  }
  return {
    ...base, mode: 'detail', analysisType: 'exception_list',
    metrics: [], dimensions: [],
    displayColumns: ['velocity_product_name', 'velocity_product_code', 'velocity_last_sold_date', 'velocity_days_since_last_sold', 'velocity_current_stock', 'velocity_movement_status'],
    sort: [{ columnId: 'velocity_days_since_last_sold', direction: 'desc' }],
    limit: 100, visualization: { type: 'table' },
  };
}

export function detectRankingIntent(question: string): RankingIntent | null {
  const text = normalize(question);
  const desc = DESC_WORDS.test(text);
  const asc = ASC_WORDS.test(text);
  if (!desc && !asc) return null;

  const limitMatch = text.match(/\b(?:top|bottom|best|worst|highest|lowest|largest|biggest|first)\s+(\d{1,3})\b/);
  const limit = limitMatch ? Number(limitMatch[1]) : null;

  let noun: string | null = null;
  for (const pattern of NOUN_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      noun = match[1].trim();
      break;
    }
  }

  return {
    // "bottom"/"lowest" wins when both appear ("top 5 routes with lowest sales").
    direction: asc ? 'asc' : 'desc',
    limit: limit && limit >= 1 && limit <= 500 ? limit : null,
    noun,
  };
}

export function resolveGroupingDimension(
  noun: string,
  datasetId: string,
  catalog: SemanticCatalog,
): CatalogDimension | null {
  const candidates = nounCandidates(noun);
  const dimensions = catalog.dimensions.filter(
    (dim) => dim.datasetId === datasetId || dim.datasetId === '*',
  );
  for (const candidate of candidates) {
    for (const dim of dimensions) {
      if (dimensionMatches(dim, candidate)) return dim;
    }
  }
  return null;
}

export function repairGroupingIntent(
  question: string,
  query: SemanticReportQuery,
  catalog: SemanticCatalog,
): GroupingRepairResult {
  if (query.queryKind !== 'single_report') return { query, repaired: false };
  if (!query.metrics?.length || query.dimensions?.length) return { query, repaired: false };

  const intent = detectRankingIntent(question);
  if (!intent?.noun) return { query, repaired: false };

  const nounHead = lastWord(intent.noun);
  if (DETAIL_NOUNS.has(nounHead) || DETAIL_NOUNS.has(singular(nounHead))) {
    return { query, repaired: false };
  }

  const dimension = resolveGroupingDimension(intent.noun, query.datasetId, catalog);
  if (dimension) {
    return { query: applyRepair(query, dimension, intent), repaired: true };
  }

  // The chosen dataset can't group by this noun — try the designated sibling
  // (e.g. sales_items → sales_net for regional dimensions), but only when
  // every metric translates exactly.
  const remap = DATASET_REMAP[query.datasetId];
  if (remap) {
    const sibling = resolveGroupingDimension(intent.noun, remap.datasetId, catalog);
    const mappedMetrics = query.metrics.map((metricId) => remap.metricMap[metricId]);
    if (sibling && mappedMetrics.every(Boolean)) {
      const remapped: SemanticReportQuery = { ...query, datasetId: remap.datasetId, metrics: mappedMetrics as string[] };
      return { query: applyRepair(remapped, sibling, intent), repaired: true };
    }
  }

  // A recognized business entity that nothing in the catalog can group by:
  // a precise "unsupported" beats silently wrong ungrouped output.
  if (KNOWN_ENTITY_NOUNS.has(singular(nounHead))) {
    const anywhere = catalog.dimensions.some((dim) => dimensionMatchesAny(dim, nounCandidates(intent.noun!)));
    if (!anywhere) return { query, repaired: false, unsupportedNoun: singular(nounHead) };
  }
  return { query, repaired: false };
}

function applyRepair(
  query: SemanticReportQuery,
  dimension: CatalogDimension,
  intent: RankingIntent,
): SemanticReportQuery {
  const sortMetric = query.metrics[0];
  return {
    ...query,
    mode: 'ranking',
    analysisType: 'ranking',
    dimensions: [dimension.dimensionId],
    // Detail columns from the degraded query would drag grouping back down
    // to row grain — the repaired report is dimension-grain only.
    displayColumns: [],
    sort: [{ metricId: sortMetric, direction: intent.direction }],
    limit: intent.limit ?? query.limit ?? 10,
    assumptions: [
      ...(query.assumptions ?? []),
      `Interpreted as ranking of ${dimension.displayName} by ${sortMetric} (${intent.direction === 'desc' ? 'highest' : 'lowest'} first).`,
    ],
  };
}

function dimensionMatches(dim: CatalogDimension, candidate: string): boolean {
  const names = [
    dim.displayName,
    dim.dimensionId,
    dim.dimensionId.split('_').slice(-1)[0],
    ...(dim.synonyms ?? []),
  ].map(normalize);
  return names.some((name) => name === candidate || singular(name) === singular(candidate));
}

function dimensionMatchesAny(dim: CatalogDimension, candidates: string[]): boolean {
  return candidates.some((candidate) => dimensionMatches(dim, candidate));
}

/** Full phrase first, then progressively narrower suffixes ("performing items" → "items"). */
function nounCandidates(noun: string): string[] {
  const words = normalize(noun).split(' ').filter(Boolean);
  const candidates: string[] = [];
  for (let start = 0; start < words.length; start += 1) {
    candidates.push(words.slice(start).join(' '));
  }
  return candidates;
}

function lastWord(noun: string): string {
  const words = normalize(noun).split(' ').filter(Boolean);
  return words[words.length - 1] ?? '';
}

function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('es') && word.length > 4 && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 3) return word.slice(0, -1);
  return word;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ').replace(/\s+/g, ' ').trim();
}
