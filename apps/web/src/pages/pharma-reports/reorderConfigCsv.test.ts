import { describe, expect, it } from 'vitest';
import { parseReorderConfigCsv, parseReorderScopeConfigCsv } from './reorderConfigCsv';

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

describe('parseReorderScopeConfigCsv', () => {
  it('parses scoped policies for non-supplier dimensions', () => {
    const csv = [
      'scopeType,scopeCode,locationCode,priority,reorder_point,min_order_qty,lead_time_days,abc_class',
      'PRODUCT_COMPANY,ACME,MAIN,80,120,24,9,A',
      'HSN_CODE,30049099,,20,50,,,B',
    ].join('\n');

    const { rows, errors } = parseReorderScopeConfigCsv(csv);

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        scopeType: 'PRODUCT_COMPANY',
        scopeCode: 'ACME',
        locationCode: 'MAIN',
        priority: 80,
        reorderPoint: 120,
        minOrderQty: 24,
        leadTimeDays: 9,
        abcClass: 'A',
      },
      {
        scopeType: 'HSN_CODE',
        scopeCode: '30049099',
        priority: 20,
        reorderPoint: 50,
        abcClass: 'B',
      },
    ]);
  });

  it('parses supplier policies by supplier code or id', () => {
    const csv = [
      'scope_type,supplier_code,scope_id,reorder_qty,multiple_order_qty',
      'SUPPLIER,SUP-1,,100,10',
      'SUPPLIER,,11111111-1111-4111-8111-111111111111,50,5',
    ].join('\n');

    const { rows, errors } = parseReorderScopeConfigCsv(csv);

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { scopeType: 'SUPPLIER', supplierCode: 'SUP-1', reorderQty: 100, multipleOrderQty: 10 },
      { scopeType: 'SUPPLIER', scopeId: '11111111-1111-4111-8111-111111111111', reorderQty: 50, multipleOrderQty: 5 },
    ]);
  });

  it('rejects missing scope keys and invalid numeric fields', () => {
    const csv = [
      'scopeType,scopeCode,reorder_point',
      'PRODUCT_GROUP,,10',
      'SALT,PARA,-1',
      'SUPPLIER,,20',
    ].join('\n');

    const { rows, errors } = parseReorderScopeConfigCsv(csv);

    expect(rows).toEqual([]);
    expect(errors).toHaveLength(3);
    expect(errors.join('\n')).toMatch(/PRODUCT_GROUP scope requires scopeCode/);
    expect(errors.join('\n')).toMatch(/valid non-negative number/);
    expect(errors.join('\n')).toMatch(/SUPPLIER scope requires scopeId or supplierCode/);
  });

  it('accepts friendly scope type aliases after normalization', () => {
    const csv = ['scope,code,min', 'product company,ACME,25'].join('\n');
    const { rows, errors } = parseReorderScopeConfigCsv(csv);

    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ scopeType: 'PRODUCT_COMPANY', scopeCode: 'ACME', reorderPoint: 25 });
  });
});
