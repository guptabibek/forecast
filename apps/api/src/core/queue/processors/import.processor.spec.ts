import { ImportQueueProcessor } from './import.processor';

function createMockPrisma() {
  return {
    product: { findMany: jest.fn() },
    location: { findMany: jest.fn() },
    customer: { findMany: jest.fn() },
    account: { findMany: jest.fn() },
    actual: { createMany: jest.fn() },
    dataImport: { update: jest.fn() },
  } as any;
}

describe('ImportQueueProcessor actuals validation', () => {
  const actualsMapping = {
    periodDate: 'period_date',
    productCode: 'product_code',
    locationCode: 'location_code',
    customerCode: 'customer_code',
    accountCode: 'account_code',
    amount: 'amount',
    quantity: 'quantity',
  };

  it('rejects provided dimension codes that do not resolve to master data', () => {
    const processor = new ImportQueueProcessor(createMockPrisma());

    const transformed = (processor as any).transformRecord(
      {
        period_date: '2024-01-01',
        product_code: 'PROD-404',
        location_code: 'LOC-404',
        amount: '1000',
      },
      actualsMapping,
      {
        product: {},
        location: {},
        customer: {},
        account: {},
      },
      'actuals',
    );

    const errors = (processor as any).validateRecord(transformed, 'actuals');

    expect(errors).toContain('Product code "PROD-404" was not found');
    expect(errors).toContain('Location code "LOC-404" was not found');
  });

  it('allows blank optional dimensions for actuals imports', () => {
    const processor = new ImportQueueProcessor(createMockPrisma());

    const transformed = (processor as any).transformRecord(
      {
        period_date: '2024-01-01',
        product_code: '   ',
        location_code: '',
        amount: '1000',
      },
      actualsMapping,
      {
        product: {},
        location: {},
        customer: {},
        account: {},
      },
      'actuals',
    );

    const errors = (processor as any).validateRecord(transformed, 'actuals');

    expect(errors).toEqual([]);
  });

  it('resolves dimension codes case-insensitively after trimming whitespace', () => {
    const processor = new ImportQueueProcessor(createMockPrisma());

    const transformed = (processor as any).transformRecord(
      {
        period_date: '2024-01-01',
        product_code: '  PROD-001  ',
        amount: '1000',
      },
      actualsMapping,
      {
        product: { 'prod-001': 'product-1' },
        location: {},
        customer: {},
        account: {},
      },
      'actuals',
    );

    const errors = (processor as any).validateRecord(transformed, 'actuals');

    expect(transformed.productId).toBe('product-1');
    expect(errors).toEqual([]);
  });
});