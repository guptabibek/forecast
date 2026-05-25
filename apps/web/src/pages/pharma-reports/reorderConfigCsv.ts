import type {
  ReorderPolicyInput,
  ReorderPolicyScopeInput,
  ReorderPolicyScopeType,
} from '../../services/api/pharma-reports.service';

// Maps accepted CSV header names (case/space/underscore-insensitive) to the
// ReorderPolicyInput field. Both camelCase and snake_case headers are accepted
// so an export from the report or a hand-made sheet both import cleanly.
const HEADER_ALIASES: Record<string, keyof ReorderPolicyInput> = {
  productcode: 'productCode', product_code: 'productCode', sku: 'productCode',
  productid: 'productId', product_id: 'productId',
  locationcode: 'locationCode', location_code: 'locationCode', location: 'locationCode',
  locationid: 'locationId', location_id: 'locationId',
  reorderpoint: 'reorderPoint', reorder_point: 'reorderPoint', min: 'reorderPoint', minimum: 'reorderPoint',
  reorderqty: 'reorderQty', reorder_qty: 'reorderQty',
  minorderqty: 'minOrderQty', min_order_qty: 'minOrderQty', moq: 'minOrderQty',
  maxorderqty: 'maxOrderQty', max_order_qty: 'maxOrderQty', max: 'maxOrderQty', maximum: 'maxOrderQty',
  multipleorderqty: 'multipleOrderQty', multiple_order_qty: 'multipleOrderQty', pack: 'multipleOrderQty', packsize: 'multipleOrderQty',
  safetystockqty: 'safetyStockQty', safety_stock_qty: 'safetyStockQty', safety: 'safetyStockQty',
  safetystockdays: 'safetyStockDays', safety_stock_days: 'safetyStockDays', safetydays: 'safetyStockDays',
  leadtimedays: 'leadTimeDays', lead_time_days: 'leadTimeDays', leadtime: 'leadTimeDays', lead: 'leadTimeDays',
  abcclass: 'abcClass', abc_class: 'abcClass', abc: 'abcClass',
};

const NUMERIC_FIELDS = new Set<keyof ReorderPolicyInput>([
  'reorderPoint', 'reorderQty', 'minOrderQty', 'maxOrderQty', 'multipleOrderQty',
  'safetyStockQty', 'safetyStockDays', 'leadTimeDays',
]);

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, '');

/** RFC-4180-ish line tokenizer: handles quoted fields, escaped quotes, commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface ParsedReorderCsv {
  rows: ReorderPolicyInput[];
  errors: string[];
}

const SCOPE_TYPES = new Set<ReorderPolicyScopeType>([
  'PRODUCT_COMPANY',
  'HSN_CODE',
  'SALT',
  'PRODUCT_GROUP',
  'SUPPLIER',
]);

const SCOPE_HEADER_ALIASES: Record<string, keyof ReorderPolicyScopeInput> = {
  scopetype: 'scopeType', scope_type: 'scopeType', scope: 'scopeType',
  scopecode: 'scopeCode', scope_code: 'scopeCode', code: 'scopeCode',
  scopeid: 'scopeId', scope_id: 'scopeId',
  suppliercode: 'supplierCode', supplier_code: 'supplierCode', supplier: 'supplierCode',
  locationcode: 'locationCode', location_code: 'locationCode', location: 'locationCode',
  locationid: 'locationId', location_id: 'locationId',
  priority: 'priority',
  reorderpoint: 'reorderPoint', reorder_point: 'reorderPoint', min: 'reorderPoint', minimum: 'reorderPoint',
  reorderqty: 'reorderQty', reorder_qty: 'reorderQty',
  minorderqty: 'minOrderQty', min_order_qty: 'minOrderQty', moq: 'minOrderQty',
  maxorderqty: 'maxOrderQty', max_order_qty: 'maxOrderQty', max: 'maxOrderQty', maximum: 'maxOrderQty',
  multipleorderqty: 'multipleOrderQty', multiple_order_qty: 'multipleOrderQty', pack: 'multipleOrderQty', packsize: 'multipleOrderQty',
  safetystockqty: 'safetyStockQty', safety_stock_qty: 'safetyStockQty', safety: 'safetyStockQty',
  safetystockdays: 'safetyStockDays', safety_stock_days: 'safetyStockDays', safetydays: 'safetyStockDays',
  leadtimedays: 'leadTimeDays', lead_time_days: 'leadTimeDays', leadtime: 'leadTimeDays', lead: 'leadTimeDays',
  abcclass: 'abcClass', abc_class: 'abcClass', abc: 'abcClass',
};

const SCOPE_NUMERIC_FIELDS = new Set<keyof ReorderPolicyScopeInput>([
  'priority', 'reorderPoint', 'reorderQty', 'minOrderQty', 'maxOrderQty',
  'multipleOrderQty', 'safetyStockQty', 'safetyStockDays', 'leadTimeDays',
]);

export interface ParsedReorderScopeCsv {
  rows: ReorderPolicyScopeInput[];
  errors: string[];
}

/**
 * Parse a reorder-config CSV into ReorderPolicyInput rows. Returns parse-time
 * errors (bad headers, non-numeric values, missing product/location) so the UI
 * can refuse a bad file rather than POST garbage. Server-side resolution of
 * unknown codes is reported separately via the upsert `skipped` result.
 */
export function parseReorderConfigCsv(text: string): ParsedReorderCsv {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV must have a header row and at least one data row.'] };
  }

  const headerCells = splitCsvLine(lines[0]).map(normHeader);
  const fields = headerCells.map((h) => HEADER_ALIASES[h]);
  if (!fields.includes('productCode') && !fields.includes('productId')) {
    errors.push('CSV must include a product column (productCode/SKU or productId).');
  }
  if (!fields.includes('locationCode') && !fields.includes('locationId')) {
    errors.push('CSV must include a location column (locationCode or locationId).');
  }
  if (errors.length) return { rows: [], errors };

  const rows: ReorderPolicyInput[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    const row: ReorderPolicyInput = {};
    let rowHasError = false;
    for (let ci = 0; ci < fields.length; ci++) {
      const field = fields[ci];
      if (!field) continue; // unmapped column — ignore
      const raw = (cells[ci] ?? '').trim();
      if (raw === '') continue; // blank → leave unset (falls back to computed)
      if (NUMERIC_FIELDS.has(field)) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          errors.push(`Row ${li + 1}: "${raw}" is not a valid non-negative number for ${field}.`);
          rowHasError = true;
          continue;
        }
        (row as unknown as Record<string, unknown>)[field] = n;
      } else {
        (row as unknown as Record<string, unknown>)[field] = raw;
      }
    }
    if (rowHasError) continue;
    if (!row.productCode && !row.productId) { errors.push(`Row ${li + 1}: missing product.`); continue; }
    if (!row.locationCode && !row.locationId) { errors.push(`Row ${li + 1}: missing location.`); continue; }
    rows.push(row);
  }
  return { rows, errors };
}

export function parseReorderScopeConfigCsv(text: string): ParsedReorderScopeCsv {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV must have a header row and at least one data row.'] };
  }

  const headerCells = splitCsvLine(lines[0]).map(normHeader);
  const fields = headerCells.map((h) => SCOPE_HEADER_ALIASES[h]);
  if (!fields.includes('scopeType')) {
    errors.push('CSV must include scopeType.');
  }
  if (errors.length) return { rows: [], errors };

  const rows: ReorderPolicyScopeInput[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    const row: ReorderPolicyScopeInput = {} as ReorderPolicyScopeInput;
    let rowHasError = false;

    for (let ci = 0; ci < fields.length; ci++) {
      const field = fields[ci];
      if (!field) continue;
      const raw = (cells[ci] ?? '').trim();
      if (raw === '') continue;

      if (field === 'scopeType') {
        const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, '_') as ReorderPolicyScopeType;
        if (!SCOPE_TYPES.has(normalized)) {
          errors.push(`Row ${li + 1}: unsupported scopeType "${raw}".`);
          rowHasError = true;
          continue;
        }
        row.scopeType = normalized;
      } else if (SCOPE_NUMERIC_FIELDS.has(field)) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          errors.push(`Row ${li + 1}: "${raw}" is not a valid non-negative number for ${field}.`);
          rowHasError = true;
          continue;
        }
        (row as unknown as Record<string, unknown>)[field] = n;
      } else {
        (row as unknown as Record<string, unknown>)[field] = raw;
      }
    }

    if (rowHasError) continue;
    if (!row.scopeType) { errors.push(`Row ${li + 1}: missing scopeType.`); continue; }
    if (row.scopeType === 'SUPPLIER') {
      if (!row.scopeId && !row.supplierCode) {
        errors.push(`Row ${li + 1}: SUPPLIER scope requires scopeId or supplierCode.`);
        continue;
      }
    } else if (!row.scopeCode) {
      errors.push(`Row ${li + 1}: ${row.scopeType} scope requires scopeCode.`);
      continue;
    }
    rows.push(row);
  }

  return { rows, errors };
}
