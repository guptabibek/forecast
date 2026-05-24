import type { ReorderPolicyInput } from '../../services/api/pharma-reports.service';

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
        (row as Record<string, unknown>)[field] = n;
      } else {
        (row as Record<string, unknown>)[field] = raw;
      }
    }
    if (rowHasError) continue;
    if (!row.productCode && !row.productId) { errors.push(`Row ${li + 1}: missing product.`); continue; }
    if (!row.locationCode && !row.locationId) { errors.push(`Row ${li + 1}: missing location.`); continue; }
    rows.push(row);
  }
  return { rows, errors };
}
