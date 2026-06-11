import { CatalogDimension, SemanticCatalog, SemanticReportQuery } from './semantic-query.types';

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
  // "top 5 routes with/by/in most sales", "top 10 customers by revenue"
  /\b(?:top|bottom|best|worst|highest|lowest|largest|biggest|leading)\s+(?:\d{1,3}\s+)?(?:performing\s+|selling\s+|profitable\s+|growing\s+|moving\s+)?([a-z][a-z _-]{1,40}?)\s+(?:with|by|in|on|of|for|across|based|this|last|that|having|contributing)\b/,
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
