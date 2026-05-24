import { describe, expect, it } from 'vitest';
import { parseReorderConfigCsv } from './reorderConfigCsv';

describe('parseReorderConfigCsv', () => {
  it('parses a well-formed CSV with snake_case headers', () => {
    const csv = [
      'product_code,location_code,reorder_point,min_order_qty,max_order_qty,multiple_order_qty,lead_time_days',
      'SKU1,WH1,100,25,600,12,10',
      'SKU2,WH1,50,,,,7',
    ].join('\n');
    const { rows, errors } = parseReorderConfigCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      productCode: 'SKU1', locationCode: 'WH1', reorderPoint: 100,
      minOrderQty: 25, maxOrderQty: 600, multipleOrderQty: 12, leadTimeDays: 10,
    });
    // Blank cells are left unset (fall back to computed), not coerced to 0.
    expect(rows[1]).toEqual({ productCode: 'SKU2', locationCode: 'WH1', reorderPoint: 50, leadTimeDays: 7 });
  });

  it('accepts camelCase and friendly header aliases (SKU, pack, max)', () => {
    const csv = ['SKU,location,reorderPoint,pack,max', 'A1,MAIN,10,6,200'].join('\n');
    const { rows, errors } = parseReorderConfigCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ productCode: 'A1', locationCode: 'MAIN', reorderPoint: 10, multipleOrderQty: 6, maxOrderQty: 200 });
  });

  it('rejects a file with no product or no location column', () => {
    expect(parseReorderConfigCsv('reorder_point\n10').errors.length).toBeGreaterThan(0);
    expect(parseReorderConfigCsv('product_code,reorder_point\nSKU1,10').errors[0]).toMatch(/location/i);
  });

  it('flags non-numeric and negative numeric values without importing that row', () => {
    const csv = ['product_code,location_code,reorder_point', 'SKU1,WH1,abc', 'SKU2,WH1,-5'].join('\n');
    const { rows, errors } = parseReorderConfigCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
  });

  it('handles quoted fields containing commas', () => {
    const csv = ['product_code,location_code,reorder_point', '"SKU,X","WH,1",30'].join('\n');
    const { rows, errors } = parseReorderConfigCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ productCode: 'SKU,X', locationCode: 'WH,1', reorderPoint: 30 });
  });

  it('errors on an empty / header-only file', () => {
    expect(parseReorderConfigCsv('').errors.length).toBeGreaterThan(0);
    expect(parseReorderConfigCsv('product_code,location_code').errors.length).toBeGreaterThan(0);
  });
});
