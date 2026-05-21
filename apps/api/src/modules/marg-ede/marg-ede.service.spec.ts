import { ActualType, InventoryTransactionType, LedgerEntryType } from '@prisma/client';
import { MargEdeService } from './marg-ede.service';
import { MARG_SYNC_MODE, MARG_SYNC_SCOPE } from './marg-sync.types';

describe('MargEdeService helpers', () => {
  let service: MargEdeService;

  beforeEach(() => {
    service = new MargEdeService({} as any, {} as any, {} as any);
  });

  it('builds stable source keys from immutable Marg row identity', () => {
    const helper = service as any;

    const original = helper.buildSourceKey({
      ID: '1964',
      CompanyID: '2',
      Voucher: 'SALE-001',
      PID: 'P-001',
      Batch: 'B1',
      Type: 'S',
    });
    const corrected = helper.buildSourceKey({
      ID: '1964',
      CompanyID: '2',
      Voucher: 'SALE-001-CORRECTED',
      PID: 'P-999',
      Batch: 'B99',
      Type: 'R',
    });

    expect(original).toBe('marg:2:1964');
    expect(corrected).toBe(original);
  });

  it('rejects pseudo accounting parties without customer signals', () => {
    const helper = service as any;

    expect(
      helper.isProjectableCustomerParty({
        cid: 'CID-1',
        parName: 'SURCHARGE ON C.S.T.',
        gstNo: null,
        phone1: null,
        parAddr: null,
        parAdd1: null,
        parAdd2: null,
        route: null,
        area: null,
        credit: null,
        crDays: null,
        isDeleted: false,
      }),
    ).toBe(false);
  });

  it('keeps real parties projectable even when the name contains tax-like tokens', () => {
    const helper = service as any;

    expect(
      helper.isProjectableCustomerParty({
        cid: 'CID-2',
        parName: 'GST MEDICALS DISTRIBUTORS',
        gstNo: '27ABCDE1234F1Z5',
        phone1: '9999999999',
        parAddr: 'Main road',
        parAdd1: 'Industrial estate',
        parAdd2: null,
        route: 'NORTH',
        area: 'CITY',
        credit: 50000,
        crDays: 30,
        isDeleted: false,
      }),
    ).toBe(true);
  });

  it('parses ISO-style dates into UTC day boundaries consistently', () => {
    const helper = service as any;

    const parsed = helper.parseMargDate('2026-04-21');

    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.toISOString()).toBe('2026-04-21T00:00:00.000Z');
  });

  it('stages Marg product master classification fields from case variants', async () => {
    // syncProducts now uses bulk INSERT ... ON CONFLICT DO UPDATE via
    // $executeRaw for million-record clients. The test verifies the
    // normalized values are passed into the prepared SQL parameters
    // rather than asserting on a per-row Prisma upsert.
    const executeRawCalls: Array<{ sql: string; params: unknown[] }> = [];
    const prisma = {
      $executeRaw: jest.fn().mockImplementation((sqlObj: any) => {
        executeRawCalls.push({
          sql: Array.isArray(sqlObj?.strings) ? sqlObj.strings.join(' ') : String(sqlObj),
          params: Array.isArray(sqlObj?.values) ? sqlObj.values : [],
        });
        return Promise.resolve(1);
      }),
    } as any;
    service = new MargEdeService(prisma, {} as any, {} as any);

    await (service as any).syncProducts('tenant-1', [{
      ID: 123,
      CompanyID: 7,
      PID: 1002180,
      Code: ' STR1331 ',
      Name: ' THYRORISE ',
      Unit: ' PCS ',
      GCODE: ' COMPANY ',
      GCODE3: ' SALT ',
      GCODE5: ' GROUP ',
      GCODE6: ' 3004 ',
      GST: 5,
    }]);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const allParams = executeRawCalls.flatMap((c) => c.params);
    expect(allParams).toEqual(expect.arrayContaining([
      '1002180', // pid
      'STR1331', // code
      'THYRORISE', // name
      'PCS', // unit
      'COMPANY', // gCode
      'SALT',    // gCode3
      'GROUP',   // gCode5
      '3004',    // gCode6
    ]));
  });

  it('refreshes linked core products with Marg master fields on every product transform', async () => {
    // The bulk transformProducts emits one `INSERT INTO products … ON
    // CONFLICT (tenant_id, code) DO UPDATE … RETURNING id, code` per chunk,
    // joined via CTE with an `UPDATE marg_products SET product_id = …`.
    // We assert on the raw-SQL invocation shape (no longer prisma.product.*
    // method calls) and on the projection of the Marg master fields into
    // the VALUES tuple.
    const executeRaw = jest.fn().mockResolvedValue(1);
    const queryRaw = jest.fn().mockResolvedValue([]); // sweepMargLegacyPidProducts
    const prisma = {
      margProduct: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{
            id: 'mp-1',
            productId: 'product-1',
            code: 'STR1331',
            name: 'THYRORISE',
            unit: 'PCS',
            companyId: 7,
            pid: '1002180',
            gCode: 'COMPANY',
            gCode3: 'SALT',
            gCode5: 'GROUP',
            gCode6: '3004',
            gst: 5,
          }])
          .mockResolvedValueOnce([]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      product: {
        findFirst: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    } as any;
    service = new MargEdeService(prisma, {} as any, {} as any);

    await (service as any).transformProducts('tenant-1');

    expect(prisma.margProduct.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-1' });
    // One bulk INSERT/ON CONFLICT/CTE-UPDATE per chunk.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    // Reconstruct the rendered SQL from the Prisma.sql template to assert
    // both the upsert shape and the master-field projection.
    const sqlArg = executeRaw.mock.calls[0][0];
    const renderedSql: string = Array.isArray(sqlArg?.strings) ? sqlArg.strings.join('?') : String(sqlArg);
    expect(renderedSql).toContain('INSERT INTO products');
    expect(renderedSql).toContain('ON CONFLICT (tenant_id, code) DO UPDATE');
    expect(renderedSql).toContain('UPDATE marg_products');
    expect(renderedSql).toContain('product_id = ins.id');
    // Master fields land in the bind values; assert by inspecting the
    // interpolated values array on the template literal.
    const values: unknown[] = Array.isArray(sqlArg?.values) ? sqlArg.values : [];
    expect(values).toEqual(expect.arrayContaining([
      'COMPANY', 'SALT', 'GROUP', '3004', 'marg:7:1002180',
    ]));
    // Legacy mergeMargLegacyPidProduct sweep is invoked exactly once
    // (returns no legacy pairs in this fixture).
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('persists Marg named masters from SaleType and product code fields', async () => {
    const productCompanyUpsert = jest.fn().mockResolvedValue(undefined);
    const productSaltUpsert = jest.fn().mockResolvedValue(undefined);
    const productCategoryUpsert = jest.fn().mockResolvedValue(undefined);
    const unitOfMeasureUpsert = jest.fn().mockResolvedValue(undefined);
    const salesmanUpsert = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      margProduct: {
        findMany: jest.fn().mockImplementation(({ select }: any) => {
          if (select?.gCode) return Promise.resolve([{ companyId: 7, gCode: 'MFR01', rawData: { source: 'product-company' } }]);
          if (select?.gCode3) return Promise.resolve([{ gCode3: 'SALT01', rawData: { source: 'product-salt' } }]);
          if (select?.gCode5) return Promise.resolve([{ companyId: 7, gCode5: 'GRP01' }]);
          if (select?.unit) return Promise.resolve([{ unit: 'PCS' }]);
          return Promise.resolve([]);
        }),
      },
      margSaleType: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          const sgCode = where.sgCode;
          if (sgCode === 'SALT') {
            return Promise.resolve([{ sCode: 'SALT01', name: 'Paracetamol', rawData: { source: 'sale-type-salt' } }]);
          }
          if (sgCode?.in?.includes('CATEGO')) {
            return Promise.resolve([{ sCode: 'GRP01', name: 'Analgesics', rawData: { source: 'sale-type-group' } }]);
          }
          return Promise.resolve([]);
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.sCode === 'MFR01') return Promise.resolve({ name: 'Acme Pharma', rawData: { source: 'sale-type-company' } });
          if (where.sCode === 'GRP01') return Promise.resolve({ name: 'Analgesics', rawData: { source: 'sale-type-group' } });
          if (where.sCode === 'BVQQ') return Promise.resolve(null);
          return Promise.resolve(null);
        }),
      },
      margVoucher: {
        findMany: jest.fn().mockResolvedValue([{ salesman: null, mr: 'BVQQ', rawData: { source: 'voucher' } }]),
      },
      margParty: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          if (where.mr) return Promise.resolve([{ mr: 'BVQQ', rawData: { source: 'customer-assignment' } }]);
          if (where.cid?.in?.includes('BVQQ')) {
            return Promise.resolve([{
              cid: 'BVQQ',
              parName: 'HARSHITA SHARMA D/O SATISH CHANDRA  (STAFF) \u0002',
              rawData: { source: 'salesman-party' },
            }]);
          }
          return Promise.resolve([]);
        }),
      },
      productCompany: { upsert: productCompanyUpsert },
      productSalt: { upsert: productSaltUpsert },
      productCategory: { upsert: productCategoryUpsert },
      unitOfMeasure: { upsert: unitOfMeasureUpsert },
      salesman: { upsert: salesmanUpsert },
    } as any;
    service = new MargEdeService(prisma, {} as any, {} as any);

    await (service as any).transformMargNamedMasters('tenant-1');

    expect(productCompanyUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_code: { tenantId: 'tenant-1', code: 'MFR01' } },
      create: expect.objectContaining({ code: 'MFR01', name: 'Acme Pharma', sourceSystem: 'MARG_EDE' }),
    }));
    expect(productSaltUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_code: { tenantId: 'tenant-1', code: 'SALT01' } },
      create: expect.objectContaining({ code: 'SALT01', name: 'Paracetamol', sourceSystem: 'MARG_EDE' }),
    }));
    expect(productCategoryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_code: { tenantId: 'tenant-1', code: 'GRP01' } },
      create: expect.objectContaining({ code: 'GRP01', name: 'Analgesics' }),
    }));
    expect(unitOfMeasureUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_code: { tenantId: 'tenant-1', code: 'PCS' } },
      create: expect.objectContaining({ code: 'PCS', name: 'PCS' }),
    }));
    expect(salesmanUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_code: { tenantId: 'tenant-1', code: 'BVQQ' } },
      create: expect.objectContaining({
        code: 'BVQQ',
        name: 'HARSHITA SHARMA D/O SATISH CHANDRA (STAFF)',
        sourceSystem: 'MARG_EDE',
        rawData: { source: 'salesman-party' },
      }),
    }));
  });

  it('counts free units in effective Marg movement quantity', () => {
    const helper = service as any;

    expect(helper.resolveMargEffectiveQuantity(10, 2)).toBe(12);
    expect(helper.resolveMargEffectiveQuantity(0, 3)).toBe(3);
    expect(helper.resolveMargEffectiveQuantity(-5, 2)).toBe(-7);
    expect(helper.resolveMargEffectiveQuantity(null, null)).toBe(0);
  });

  it('classifies posted sales, challans, and order documents from type2 voucher context', () => {
    const helper = service as any;

    const salesInvoice = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'STR26-00012',
      transactionAddField: 'I; ;;00;0',
      voucherType: 'S',
      voucherVcn: 'STR26-00012',
      voucherAddField: 'I;0.00',
      effectiveQty: 12,
      amount: 18040,
    });
    expect(salesInvoice).toEqual(expect.objectContaining({
      family: 'SALES_INVOICE',
      shouldProjectActual: true,
      actualType: ActualType.SALES,
      actualQuantity: 12,
      actualAmount: 18040,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.ISSUE,
      inventoryQuantity: 12,
      ledgerEntryType: LedgerEntryType.LEDGER_ISSUE,
      ledgerQuantity: -12,
      customerFacing: true,
      supplierFacing: false,
    }));

    const salesChallan = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'CHAL032585',
      transactionAddField: 'C; ;;00;0',
      voucherType: 'S',
      voucherVcn: 'CHAL032585',
      voucherAddField: 'C;0.00',
      effectiveQty: 4,
      amount: 200,
    });
    expect(salesChallan).toEqual(expect.objectContaining({
      family: 'SALES_CHALLAN',
      shouldProjectActual: false,
      actualType: null,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.ISSUE,
      inventoryQuantity: 4,
      ledgerEntryType: LedgerEntryType.LEDGER_ISSUE,
      ledgerQuantity: -4,
      customerFacing: true,
      supplierFacing: false,
    }));

    const salesOrder = helper.resolveMargType2ProjectionDecision({
      transactionType: 'V',
      transactionVcn: 'OS000009',
      transactionAddField: 'C; ;;00;0',
      voucherType: 'V',
      voucherVcn: 'OS000009',
      voucherAddField: 'C;0.00',
      effectiveQty: 1,
      amount: 150.01,
    });
    expect(salesOrder).toEqual(expect.objectContaining({
      family: 'SALES_ORDER',
      shouldProjectActual: false,
      actualType: null,
      shouldProjectInventory: false,
      inventoryTransactionType: null,
      inventoryQuantity: 0,
      ledgerEntryType: null,
      ledgerQuantity: 0,
      customerFacing: true,
      supplierFacing: false,
    }));

    const purchaseOrder = helper.resolveMargType2ProjectionDecision({
      transactionType: 'X',
      transactionVcn: 'PO-001',
      transactionAddField: 'C; ;;00;0',
      voucherType: 'X',
      voucherVcn: 'PO-001',
      voucherAddField: 'C;0.00',
      effectiveQty: 10,
      amount: 5000,
    });
    expect(purchaseOrder).toEqual(expect.objectContaining({
      family: 'PURCHASE_ORDER',
      shouldProjectActual: false,
      actualType: null,
      shouldProjectInventory: false,
      inventoryTransactionType: null,
      inventoryQuantity: 0,
      ledgerEntryType: null,
      ledgerQuantity: 0,
      customerFacing: false,
      supplierFacing: true,
    }));
  });

  it('classifies returns, stock adjustments, and replacement issues with the correct direction', () => {
    const helper = service as any;

    const salesReturn = helper.resolveMargType2ProjectionDecision({
      transactionType: 'R',
      transactionVcn: 'CN00001',
      transactionAddField: 'I; ;BWMF;00;0',
      voucherType: 'R',
      voucherVcn: 'CN00001',
      voucherAddField: 'I;0.00',
      effectiveQty: 50,
      amount: 1497,
    });
    expect(salesReturn).toEqual(expect.objectContaining({
      family: 'SALES_RETURN',
      shouldProjectActual: true,
      actualType: ActualType.SALES,
      actualQuantity: -50,
      actualAmount: -1497,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.RETURN,
      inventoryQuantity: 50,
      ledgerEntryType: LedgerEntryType.LEDGER_RETURN,
      ledgerQuantity: 50,
      customerFacing: true,
      supplierFacing: false,
    }));

    // SC (T/SC) is a price-difference credit note. Per business rules
    // confirmed by QA, SC must have ZERO commercial impact (no sales actual,
    // no inventory, no ledger) — its only effect is the credit posting in
    // Book E, which lives in the accounting projection path and is verified
    // separately. Lumping SC together with full sales returns (R/CN) was
    // double-counting it against gross sales.
    const customerCreditAdjustment = helper.resolveMargType2ProjectionDecision({
      transactionType: 'X',
      transactionVcn: 'SC00001',
      transactionAddField: 'I; ;;00;0',
      voucherType: 'T',
      voucherVcn: 'SC00001',
      voucherAddField: 'I;0.00',
      effectiveQty: 2,
      amount: 610,
    });
    expect(customerCreditAdjustment).toEqual(expect.objectContaining({
      family: 'SALES_RETURN_ADJUSTMENT',
      shouldProjectActual: false,
      actualType: null,
      actualQuantity: null,
      actualAmount: null,
      shouldProjectInventory: false,
      inventoryTransactionType: null,
      inventoryQuantity: 0,
      ledgerEntryType: null,
      ledgerQuantity: 0,
      customerFacing: true,
      supplierFacing: false,
    }));

    const purchaseReturn = helper.resolveMargType2ProjectionDecision({
      transactionType: 'B',
      transactionVcn: 'DN00001',
      transactionAddField: 'I; ;;00;0',
      voucherType: 'B',
      voucherVcn: 'DN00001',
      voucherAddField: 'I;0.00',
      effectiveQty: 2750,
      amount: 90750,
    });
    expect(purchaseReturn).toEqual(expect.objectContaining({
      family: 'PURCHASE_RETURN',
      shouldProjectActual: true,
      actualType: ActualType.PURCHASES,
      actualQuantity: -2750,
      actualAmount: -90750,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.ADJUSTMENT_OUT,
      inventoryQuantity: 2750,
      ledgerEntryType: LedgerEntryType.LEDGER_RETURN,
      ledgerQuantity: -2750,
      customerFacing: false,
      supplierFacing: true,
    }));

    const stockReceive = helper.resolveMargType2ProjectionDecision({
      transactionType: 'X',
      transactionVcn: 'AD00001',
      transactionAddField: 'C; ;;00;0',
      voucherType: 'D',
      voucherVcn: 'AD00001',
      voucherAddField: 'C;0.00',
      effectiveQty: 5,
      amount: 400,
    });
    expect(stockReceive).toEqual(expect.objectContaining({
      family: 'STOCK_RECEIVE',
      shouldProjectActual: true,
      actualType: ActualType.INVENTORY,
      actualQuantity: 5,
      actualAmount: 400,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.ADJUSTMENT_IN,
      inventoryQuantity: 5,
      ledgerEntryType: LedgerEntryType.LEDGER_ADJUSTMENT,
      ledgerQuantity: 5,
      customerFacing: false,
      supplierFacing: false,
    }));

    const lossIssue = helper.resolveMargType2ProjectionDecision({
      transactionType: 'W',
      transactionVcn: 'L000003',
      transactionAddField: 'C;û;;00;0',
      voucherType: 'L',
      voucherVcn: 'L000003',
      voucherAddField: 'C;0.00',
      effectiveQty: -10,
      amount: -700,
    });
    expect(lossIssue).toEqual(expect.objectContaining({
      family: 'STOCK_ISSUE',
      shouldProjectActual: true,
      actualType: ActualType.INVENTORY,
      actualQuantity: -10,
      actualAmount: -700,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.SCRAP,
      inventoryQuantity: 10,
      ledgerEntryType: LedgerEntryType.LEDGER_SCRAP,
      ledgerQuantity: -10,
      customerFacing: false,
      supplierFacing: false,
    }));

    const replacementIssue = helper.resolveMargType2ProjectionDecision({
      transactionType: 'O',
      transactionVcn: 'STR26-01503',
      transactionAddField: 'I;R;BWIN;00;0',
      voucherType: 'S',
      voucherVcn: 'STR26-01503',
      voucherAddField: 'I;0.00',
      effectiveQty: 1,
      amount: 0,
    });
    expect(replacementIssue).toEqual(expect.objectContaining({
      family: 'REPLACEMENT_ISSUE',
      shouldProjectActual: false,
      actualType: null,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.ISSUE,
      inventoryQuantity: 1,
      ledgerEntryType: LedgerEntryType.LEDGER_ISSUE,
      ledgerQuantity: -1,
      customerFacing: true,
      supplierFacing: false,
    }));
  });

  it('selects the canonical party balance row deterministically', () => {
    const helper = service as any;

    const canonical = helper.selectCanonicalMargPartyBalanceRow([
      { ID: 54612593, CID: '0', Opening: 0, Balance: 0 },
      { ID: 54612607, CID: '0', Opening: 139396.61, Balance: 139396.61 },
      { ID: 54612596, CID: '0', Opening: 0, Balance: 0 },
    ]);

    expect(canonical.ID).toBe(54612607);
    expect(canonical.Balance).toBe(139396.61);
  });

  it('treats the Marg 1900 placeholder as an unknown procurement order date', () => {
    const helper = service as any;

    expect(helper.normalizeValidMargBusinessDate('1900-01-01T00:00:00.000Z')).toBeNull();
    expect(helper.normalizeValidMargBusinessDate('2026-04-27T00:00:00.000Z')).toEqual(
      new Date('2026-04-27T00:00:00.000Z'),
    );
  });

  it('builds the same synced PO number for a direct Marg order and an invoice ORN reference', () => {
    const helper = service as any;

    const directOrderNumber = helper.buildMargPurchaseOrderNumber(
      11093,
      helper.resolveMargPurchaseOrderDocumentNumber('PO-0609', 'PO-0609', '1873658'),
      '1873658',
    );
    const linkedInvoiceOrderNumber = helper.buildMargPurchaseOrderNumber(
      11093,
      helper.resolveMargLinkedPurchaseOrderDocumentNumber('PO-0609'),
      '1874147',
    );

    expect(directOrderNumber).toBe(linkedInvoiceOrderNumber);
  });

  it('builds the same fallback PO number for invoices that share the same Marg ORN', () => {
    const helper = service as any;

    const firstInvoiceFallback = helper.buildMargFallbackPurchaseOrderNumber(
      11093,
      helper.resolveMargLinkedPurchaseOrderDocumentNumber('PO-0609'),
      '1874147',
      'P000106',
    );
    const secondInvoiceFallback = helper.buildMargFallbackPurchaseOrderNumber(
      11093,
      helper.resolveMargLinkedPurchaseOrderDocumentNumber('PO-0609'),
      '1874486',
      'P000107',
    );

    expect(firstInvoiceFallback).toBe(secondInvoiceFallback);
    expect(firstInvoiceFallback).toContain('PO-0609');
  });

  it('marks fallback invoice-derived POs when Marg lacks a trustworthy order or promise date', () => {
    const helper = service as any;

    const fallbackNotes = helper.buildMargPurchaseOrderNotes({
      companyId: 11093,
      voucher: '1874486',
      vcn: 'P000107',
      orn: null,
      fallbackFromInvoice: true,
      orderDateKnown: false,
      expectedDateKnown: false,
    });

    expect(fallbackNotes).toContain('[MARG_SYNC_PO_FALLBACK]');
    expect(fallbackNotes).toContain('[MARG_ORDER_DATE_UNKNOWN]');
    expect(fallbackNotes).toContain('[MARG_EXPECTED_DATE_UNKNOWN]');
  });

  it('detects duplicate account posting business rows independent of Marg row id', () => {
    const helper = service as any;
    const rows = [
      {
        margId: BigInt(1),
        companyId: 11093,
        voucher: '1862930.0',
        date: new Date('2026-04-17T00:00:00.000Z'),
        book: 'A',
        code: 'BLLR',
        code1: 'GJZ',
        gCode: 'D34',
        amount: -541209,
        remark: '26',
      },
      {
        margId: BigInt(2),
        companyId: 11093,
        voucher: '1862930.0',
        date: new Date('2026-04-17T00:00:00.000Z'),
        book: 'A',
        code: 'BLLR',
        code1: 'GJZ',
        gCode: 'D34',
        amount: -541209,
        remark: '26',
      },
      {
        margId: BigInt(3),
        companyId: 11093,
        voucher: '1862930.0',
        date: new Date('2026-04-17T00:00:00.000Z'),
        book: 'A',
        code: 'GJX',
        code1: 'BLLR',
        gCode: 'D11',
        amount: 25771.85,
        remark: '26',
      },
    ];

    const summary = helper.summarizeMargAccountPostingDuplicates(rows);

    expect(summary.duplicateFingerprintCount).toBe(1);
    expect(summary.duplicateRowCount).toBe(1);
    expect(summary.sample[0]).toEqual(expect.objectContaining({ count: 2 }));
  });

  it('prefers the most specific Marg GL mapping rule for an account posting', () => {
    const helper = service as any;

    const rule = helper.resolveMargGlMappingRule(
      {
        companyId: 2,
        book: 'sa',
        gCode: 'sales',
        code: 'CUST-1',
        code1: 'COUNTER-1',
        remark: 'Retail sales posting',
      },
      [
        {
          id: 'global',
          companyId: null,
          bookCode: null,
          groupCode: null,
          partyCode: null,
          counterpartyCode: null,
          remarkContains: null,
          glAccountId: 'gl-global',
          priority: 0,
        },
        {
          id: 'group-level',
          companyId: 2,
          bookCode: 'SA',
          groupCode: 'SALES',
          partyCode: null,
          counterpartyCode: null,
          remarkContains: null,
          glAccountId: 'gl-group',
          priority: 10,
        },
        {
          id: 'most-specific',
          companyId: 2,
          bookCode: 'SA',
          groupCode: 'SALES',
          partyCode: 'CUST-1',
          counterpartyCode: 'COUNTER-1',
          remarkContains: 'RETAIL',
          glAccountId: 'gl-specific',
          priority: 5,
        },
      ],
    );

    expect(rule.id).toBe('most-specific');
    expect(rule.glAccountId).toBe('gl-specific');
  });

  it('builds journal content hashes independent of line order', () => {
    const helper = service as any;
    const group = {
      voucher: 'V-100',
      book: 'SA',
      date: new Date('2026-04-21T00:00:00.000Z'),
    };

    const left = helper.buildMargAccountJournalContentHash('acct:2:2026-04-21:SA:V-100', group, [
      { glAccountId: 'gl-b', debitAmount: 0, creditAmount: 125.5 },
      { glAccountId: 'gl-a', debitAmount: 125.5, creditAmount: 0 },
    ]);
    const right = helper.buildMargAccountJournalContentHash('acct:2:2026-04-21:SA:V-100', group, [
      { glAccountId: 'gl-a', debitAmount: 125.5, creditAmount: 0 },
      { glAccountId: 'gl-b', debitAmount: 0, creditAmount: 125.5 },
    ]);

    expect(left).toBe(right);
  });

  it('queries voucherless account posting groups by Marg row id', async () => {
    const changedAt = new Date('2026-04-21T00:00:00.000Z');
    const row101 = {
      margId: BigInt(101),
      companyId: 2,
      voucher: null,
      date: changedAt,
      book: 'SA',
      amount: 50,
      code: 'CUST-1',
      code1: null,
      gCode: 'SALES',
      remark: null,
    };
    const row102 = {
      margId: BigInt(102),
      companyId: 2,
      voucher: null,
      date: changedAt,
      book: 'SA',
      amount: -50,
      code: 'CUST-2',
      code1: null,
      gCode: 'SALES',
      remark: null,
    };

    // The journal projection now runs in two phases:
    //  1) a changed-since query to discover which (companyId, date, book, voucher)
    //     groups have any touched row; and
    //  2) a per-group reload of the FULL row set so partial Marg updates can
    //     never produce an unbalanced journal entry.
    // The mock distinguishes the two phases by the presence of `updatedAt` in
    // the `where` clause: the discovery call carries the changed-since filter,
    // the reload call addresses a single voucherless group via `margId`.
    const margAccountPostingFindMany = jest.fn().mockImplementation((args: any) => {
      const where = args?.where ?? {};
      if (where.updatedAt) {
        return Promise.resolve([row101, row102]);
      }
      if (where.margId === BigInt(101)) {
        return Promise.resolve([row101]);
      }
      if (where.margId === BigInt(102)) {
        return Promise.resolve([row102]);
      }
      return Promise.resolve([]);
    });

    service = new MargEdeService({
      margGLMappingRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-1',
            companyId: 2,
            bookCode: 'SA',
            groupCode: 'SALES',
            partyCode: null,
            counterpartyCode: null,
            remarkContains: null,
            glAccountId: 'gl-1',
            priority: 1,
          },
        ]),
      },
      margAccountPosting: {
        findMany: margAccountPostingFindMany,
      },
    } as any, {} as any, {} as any);

    const helper = service as any;
    helper.resolveJournalPostingUserId = jest.fn().mockResolvedValue('user-1');

    const result = await helper.transformAccountPostingsToJournalEntries(
      'tenant-1',
      { id: 'sync-log-1', startedAt: new Date('2026-04-21T00:00:00.000Z') },
      null,
      'user-1',
    );

    expect(result.journalEntriesSynced).toBe(0);
    // 1 discovery query + 1 reload per unique voucherless group = 3 total.
    expect(margAccountPostingFindMany).toHaveBeenCalledTimes(3);
    expect(margAccountPostingFindMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      updatedAt: { gte: new Date('2026-04-21T00:00:00.000Z') },
    });
    expect(margAccountPostingFindMany.mock.calls[1][0].where).toEqual({
      tenantId: 'tenant-1',
      companyId: 2,
      margId: BigInt(101),
    });
    expect(margAccountPostingFindMany.mock.calls[2][0].where).toEqual({
      tenantId: 'tenant-1',
      companyId: 2,
      margId: BigInt(102),
    });
  });

  it('reprojects existing account postings without requiring updated rows in the current run', async () => {
    const margAccountPostingFindMany = jest.fn().mockResolvedValue([]);

    service = new MargEdeService({
      margGLMappingRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-1',
            companyId: 2,
            bookCode: 'SA',
            groupCode: 'SALES',
            partyCode: null,
            counterpartyCode: null,
            remarkContains: null,
            glAccountId: 'gl-1',
            priority: 1,
          },
        ]),
      },
      margAccountPosting: {
        findMany: margAccountPostingFindMany,
      },
    } as any, {} as any, {} as any);

    const helper = service as any;
    helper.resolveJournalPostingUserId = jest.fn().mockResolvedValue('user-1');

    await helper.transformAccountPostingsToJournalEntries(
      'tenant-1',
      {
        id: 'sync-log-1',
        startedAt: new Date('2026-04-22T00:00:00.000Z'),
        mode: MARG_SYNC_MODE.REPROJECT,
      },
      null,
      'user-1',
    );

    expect(margAccountPostingFindMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
    });
  });

  it('auto-provisions Marg GL accounts and fallback rules before projecting journals', async () => {
    const margGLMappingRuleCreate = jest.fn().mockResolvedValue(undefined);
    const gLAccountUpsert = jest.fn()
      .mockResolvedValueOnce({ id: 'gl-c6', parentId: null })
      .mockResolvedValueOnce({ id: 'gl-j61', parentId: null });

    const tx = {
      gLAccount: {
        upsert: gLAccountUpsert,
        update: jest.fn().mockResolvedValue(undefined),
      },
      margGLMappingRule: {
        create: margGLMappingRuleCreate,
      },
      margAccountJournalProjection: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'projection-1' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    service = new MargEdeService({
      gLAccount: {
        count: jest.fn().mockResolvedValue(0),
      },
      margGLMappingRule: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-c6',
            companyId: 11093,
            bookCode: null,
            groupCode: 'C6',
            partyCode: null,
            counterpartyCode: null,
            remarkContains: null,
            glAccountId: 'gl-c6',
            priority: -100,
          },
          {
            id: 'rule-j61',
            companyId: 11093,
            bookCode: null,
            groupCode: 'J61',
            partyCode: null,
            counterpartyCode: null,
            remarkContains: null,
            glAccountId: 'gl-j61',
            priority: -100,
          },
        ]),
      },
      margAccountGroup: {
        findMany: jest.fn().mockResolvedValue([
          {
            companyId: 11093,
            aid: 'C6',
            name: 'SUNDRY DEBTORS',
            under: null,
            addField: null,
          },
          {
            companyId: 11093,
            aid: 'J61',
            name: 'SALES',
            under: null,
            addField: null,
          },
        ]),
      },
      margAccountPosting: {
        findMany: jest.fn().mockResolvedValue([
          {
            margId: BigInt(101),
            companyId: 11093,
            voucher: 'STR26-00367',
            date: new Date('2026-04-04T00:00:00.000Z'),
            book: 'S',
            code: 'CGKF',
            code1: 'GJU',
            gCode: 'C6',
            amount: 17076,
            remark: 'STR26-00367',
          },
          {
            margId: BigInt(102),
            companyId: 11093,
            voucher: 'STR26-00367',
            date: new Date('2026-04-04T00:00:00.000Z'),
            book: 'S',
            code: 'GJU',
            code1: 'CGKF',
            gCode: 'J61',
            amount: -17076,
            remark: 'STR26-00367',
          },
        ]),
      },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any, {} as any, {
      createJournalEntry: jest.fn().mockResolvedValue({ id: 'journal-1' }),
      reverseJournalEntry: jest.fn().mockResolvedValue(undefined),
    } as any);

    const helper = service as any;
    helper.resolveJournalPostingUserId = jest.fn().mockResolvedValue('user-1');

    const result = await helper.transformAccountPostingsToJournalEntries(
      'tenant-1',
      { id: 'sync-log-1', startedAt: new Date('2026-04-21T00:00:00.000Z') },
      null,
      'user-1',
    );

    expect(result.journalEntriesSynced).toBe(1);
    expect(gLAccountUpsert).toHaveBeenCalledTimes(2);
    expect(margGLMappingRuleCreate).toHaveBeenCalledTimes(2);
    expect(gLAccountUpsert.mock.calls[0][0].create.accountType).toBe('ASSET');
    expect(gLAccountUpsert.mock.calls[1][0].create.accountType).toBe('REVENUE');
  });

  it('normalizes tiny floating drift before posting Marg journals', async () => {
    const createJournalEntry = jest.fn().mockResolvedValue({ id: 'journal-1' });
    const transaction = jest.fn(async (callback: any) => callback(tx));
    const tx = {
      margAccountJournalProjection: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'projection-1' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    service = new MargEdeService({
      margGLMappingRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-c6',
            companyId: 11093,
            bookCode: null,
            groupCode: 'C6',
            partyCode: null,
            counterpartyCode: null,
            remarkContains: null,
            glAccountId: 'gl-c6',
            priority: 10,
          },
          {
            id: 'rule-j61',
            companyId: 11093,
            bookCode: null,
            groupCode: 'J61',
            partyCode: null,
            counterpartyCode: null,
            remarkContains: null,
            glAccountId: 'gl-j61',
            priority: 10,
          },
        ]),
      },
      margAccountPosting: {
        findMany: jest.fn().mockResolvedValue([
          {
            margId: BigInt(101),
            companyId: 11093,
            voucher: 'STR26-00367',
            date: new Date('2026-04-04T00:00:00.000Z'),
            book: 'S',
            code: 'CGKF',
            code1: 'GJU',
            gCode: 'C6',
            amount: 17611,
            remark: 'STR26-00367',
          },
          {
            margId: BigInt(102),
            companyId: 11093,
            voucher: 'STR26-00367',
            date: new Date('2026-04-04T00:00:00.000Z'),
            book: 'S',
            code: 'GJU',
            code1: 'CGKF',
            gCode: 'J61',
            amount: -17610.999999999997,
            remark: 'STR26-00367',
          },
        ]),
      },
      $transaction: transaction,
    } as any, {} as any, {
      createJournalEntry,
      reverseJournalEntry: jest.fn().mockResolvedValue(undefined),
    } as any);

    const helper = service as any;
    helper.resolveJournalPostingUserId = jest.fn().mockResolvedValue('user-1');

    const result = await helper.transformAccountPostingsToJournalEntries(
      'tenant-1',
      { id: 'sync-log-1', startedAt: new Date('2026-04-21T00:00:00.000Z') },
      null,
      'user-1',
    );

    const postedLines = createJournalEntry.mock.calls[0][1].lines;
    const totalDebit = postedLines.reduce((sum: number, line: any) => sum + Number(line.debitAmount ?? 0), 0);
    const totalCredit = postedLines.reduce((sum: number, line: any) => sum + Number(line.creditAmount ?? 0), 0);

    expect(result.journalEntriesSynced).toBe(1);
    expect(totalDebit).toBe(totalCredit);
    expect(postedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ debitAmount: 17611, creditAmount: 0 }),
      expect.objectContaining({ debitAmount: 0, creditAmount: 17611 }),
    ]));
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxWait: 10000,
        timeout: 60000,
      }),
    );
  });

  it('tests both inventory and accounting probes when validating a Marg connection', async () => {
    const prisma = {
      margSyncConfig: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'config-1',
          tenantId: 'tenant-1',
          companyCode: 'COMPANY',
          companyId: 7,
          apiBaseUrl: 'https://corporate.margerp.com',
          margKey: 'encrypted-key',
          decryptionKey: 'encrypted-secret',
        }),
      },
    } as any;
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new MargEdeService(prisma, auditService, {} as any);
    const helper = service as any;

    helper.decryptSecret = jest.fn().mockReturnValue('decrypted');
    helper.fetchBranches = jest.fn().mockResolvedValue([{ StoreID: '1' }]);
    helper.fetchData = jest.fn()
      .mockResolvedValueOnce({
        Details: [],
        Masters: [],
        MDis: [],
        Party: [],
        Product: [{ PID: 'P-1' }],
        SaleType: [],
        Stock: [],
        ACGroup: [],
        Account: [],
        AcBal: [],
        PBal: [],
        Outstanding: [],
        Index: 1,
        DataStatus: 10,
        DateTime: '2026-04-21T08:00:00.000Z',
      })
      .mockResolvedValueOnce({
        Details: [],
        Masters: [],
        MDis: [],
        Party: [],
        Product: [],
        SaleType: [],
        Stock: [],
        ACGroup: [],
        Account: [{ ID: 1 }],
        AcBal: [],
        PBal: [],
        Outstanding: [],
        Index: 2,
        DataStatus: 10,
        DateTime: '2026-04-21T09:00:00.000Z',
      });

    const result = await (service as any).testConnection('config-1', { id: 'user-1', tenantId: 'tenant-1' } as any);

    expect(helper.fetchData).toHaveBeenNthCalledWith(1, expect.objectContaining({ apiType: '2' }));
    expect(helper.fetchData).toHaveBeenNthCalledWith(2, expect.objectContaining({ apiType: '1' }));
    expect(result.success).toBe(true);
    expect(result.inventoryProbe?.apiType).toBe('2');
    expect(result.accountingProbe?.apiType).toBe('1');
  });

  it('runs accounting projection after staging accounting and inventory data during sync', async () => {
    const prisma = {
      margSyncConfig: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'config-1',
          tenantId: 'tenant-1',
          isActive: true,
          apiBaseUrl: 'https://corporate.margerp.com',
          companyCode: 'COMPANY',
          companyId: 7,
          margKey: 'encrypted-key',
          decryptionKey: 'encrypted-secret',
          lastSyncIndex: 0,
          lastSyncDatetime: '',
          lastAccountingSyncIndex: 0,
          lastAccountingSyncDatetime: '',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      margSyncLog: {
        create: jest.fn().mockResolvedValue({
          id: 'sync-log-1',
          startedAt: new Date('2026-04-21T00:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as any;
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new MargEdeService(prisma, auditService, {} as any);
    const helper = service as any;
    const callOrder: string[] = [];

    helper.decryptSecret = jest.fn().mockReturnValue('decrypted');
    helper.touchSyncHeartbeat = jest.fn().mockResolvedValue(undefined);
    helper.fetchBranches = jest.fn().mockResolvedValue([]);
    helper.syncBranches = jest.fn().mockResolvedValue(0);
    helper.fetchData = jest.fn().mockImplementation(async ({ apiType }: { apiType: string }) => {
      if (apiType === '2') {
        return {
          Product: [],
          Party: [],
          Details: [],
          Stock: [],
          MDis: [],
          SaleType: [],
          ACGroup: [],
          Account: [],
          AcBal: [],
          PBal: [],
          Outstanding: [],
          Index: 1,
          DataStatus: 10,
          DateTime: '2026-04-21T08:00:00.000Z',
        };
      }

      return {
        Product: [],
        Party: [],
        Details: [],
        Stock: [],
        MDis: [{
          ID: '101',
          CompanyID: '7',
          Voucher: 'ACC-001',
          Type: 'JV',
          Date: '21/04/2026',
        }],
        SaleType: [],
        ACGroup: [],
        Account: [{}],
        AcBal: [],
        PBal: [],
        Outstanding: [],
        Index: 1,
        DataStatus: 10,
        DateTime: '2026-04-21T09:00:00.000Z',
      };
    });

    helper.syncProducts = jest.fn().mockResolvedValue(0);
    helper.syncParties = jest.fn().mockResolvedValue(0);
    helper.syncTransactions = jest.fn().mockResolvedValue(0);
    helper.syncStockData = jest.fn().mockResolvedValue(0);
    helper.syncVouchers = jest.fn().mockImplementation(async () => {
      callOrder.push('syncVouchers');
      return 1;
    });
    helper.syncSaleTypes = jest.fn().mockResolvedValue(0);
    helper.syncAccountGroups = jest.fn().mockResolvedValue(0);
    helper.syncAccountPostings = jest.fn().mockImplementation(async () => {
      callOrder.push('syncAccountPostings');
      return 1;
    });
    helper.syncAccountGroupBalances = jest.fn().mockResolvedValue(0);
    helper.syncPartyBalances = jest.fn().mockResolvedValue(0);
    helper.syncOutstandings = jest.fn().mockResolvedValue(0);
    helper.markMissingStockAsDeleted = jest.fn().mockResolvedValue(undefined);
    helper.transformBranches = jest.fn().mockResolvedValue(undefined);
    helper.transformMargNamedMasters = jest.fn().mockResolvedValue(undefined);
    helper.transformProducts = jest.fn().mockResolvedValue(undefined);
    helper.transformParties = jest.fn().mockResolvedValue(undefined);
    helper.transformMargProcurementDocuments = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToActuals = jest.fn().mockResolvedValue(undefined);
    helper.transformStockToInventoryLevels = jest.fn().mockResolvedValue(undefined);
    helper.transformStockToBatches = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToInventoryTransactions = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToInventoryLedger = jest.fn().mockImplementation(async () => {
      callOrder.push('transformTransactionsToInventoryLedger');
    });
    helper.transformAccountPostingsToJournalEntries = jest.fn().mockImplementation(async () => {
      callOrder.push('transformAccountPostingsToJournalEntries');
      return { journalEntriesSynced: 1, skippedGroups: [] };
    });
    helper.runPostSyncReconciliations = jest.fn().mockImplementation(async () => {
      callOrder.push('runPostSyncReconciliations');
      return { totalIssues: 0, warningCount: 0, failureCount: 0 };
    });

    await expect(service.runSync('config-1', 'tenant-1', 'user-1')).resolves.toBe('sync-log-1');
    expect(callOrder).toEqual([
      'syncAccountPostings',
      'transformTransactionsToInventoryLedger',
      'transformAccountPostingsToJournalEntries',
      'runPostSyncReconciliations',
    ]);
  });

  it('preserves staged stock when a fetch-based sync receives no stock payload', async () => {
    const prisma = {
      margSyncConfig: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'config-1',
          tenantId: 'tenant-1',
          isActive: true,
          apiBaseUrl: 'https://corporate.margerp.com',
          companyCode: 'COMPANY',
          companyId: 7,
          margKey: 'encrypted-key',
          decryptionKey: 'encrypted-secret',
          lastSyncIndex: 0,
          lastSyncDatetime: '',
          lastAccountingSyncIndex: 0,
          lastAccountingSyncDatetime: '',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      margSyncLog: {
        create: jest.fn().mockResolvedValue({
          id: 'sync-log-1',
          startedAt: new Date('2026-04-21T00:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as any;
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new MargEdeService(prisma, auditService, {} as any);
    const helper = service as any;

    helper.decryptSecret = jest.fn().mockReturnValue('decrypted');
    helper.touchSyncHeartbeat = jest.fn().mockResolvedValue(undefined);
    helper.fetchBranches = jest.fn().mockResolvedValue([]);
    helper.syncBranches = jest.fn().mockResolvedValue(0);
    helper.fetchData = jest.fn().mockImplementation(async ({ apiType }: { apiType: string }) => {
      if (apiType === '2') {
        return {
          Product: [],
          Party: [],
          Details: [],
          Stock: [],
          MDis: [],
          SaleType: [],
          ACGroup: [],
          Account: [],
          AcBal: [],
          PBal: [],
          Outstanding: [],
          Index: 1,
          DataStatus: 10,
          DateTime: '2026-04-21T08:00:00.000Z',
        };
      }

      return {
        Product: [],
        Party: [],
        Details: [],
        Stock: [],
        MDis: [],
        SaleType: [],
        ACGroup: [],
        Account: [],
        AcBal: [],
        PBal: [],
        Outstanding: [],
        Index: 1,
        DataStatus: 10,
        DateTime: '2026-04-21T09:00:00.000Z',
      };
    });
    helper.syncProducts = jest.fn().mockResolvedValue(0);
    helper.syncParties = jest.fn().mockResolvedValue(0);
    helper.syncTransactions = jest.fn().mockResolvedValue(0);
    helper.syncStockData = jest.fn().mockResolvedValue(0);
    helper.syncVouchers = jest.fn().mockResolvedValue(0);
    helper.syncSaleTypes = jest.fn().mockResolvedValue(0);
    helper.syncAccountGroups = jest.fn().mockResolvedValue(0);
    helper.syncAccountPostings = jest.fn().mockResolvedValue(0);
    helper.syncAccountGroupBalances = jest.fn().mockResolvedValue(0);
    helper.syncPartyBalances = jest.fn().mockResolvedValue(0);
    helper.syncOutstandings = jest.fn().mockResolvedValue(0);
    helper.markMissingStockAsDeleted = jest.fn().mockResolvedValue(undefined);
    helper.transformBranches = jest.fn().mockResolvedValue(undefined);
    helper.transformMargNamedMasters = jest.fn().mockResolvedValue(undefined);
    helper.transformProducts = jest.fn().mockResolvedValue(undefined);
    helper.transformParties = jest.fn().mockResolvedValue(undefined);
    helper.transformSuppliers = jest.fn().mockResolvedValue(0);
    helper.transformMargProcurementDocuments = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToActuals = jest.fn().mockResolvedValue(undefined);
    helper.transformStockToInventoryLevels = jest.fn().mockResolvedValue(undefined);
    helper.transformStockToBatches = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToInventoryTransactions = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToInventoryLedger = jest.fn().mockResolvedValue(undefined);
    helper.transformAccountPostingsToJournalEntries = jest.fn().mockResolvedValue({
      journalEntriesSynced: 0,
      skippedGroups: [],
      diagnostics: {
        duplicateFingerprintCount: 0,
        duplicateRowCount: 0,
        skippedByReason: {},
      },
    });
    helper.runPostSyncReconciliations = jest.fn().mockResolvedValue({
      totalIssues: 0,
      warningCount: 0,
      failureCount: 0,
    });

    await expect(service.runSync('config-1', 'tenant-1', 'user-1')).resolves.toBe('sync-log-1');

    expect(helper.syncStockData).not.toHaveBeenCalled();
    expect(helper.markMissingStockAsDeleted).not.toHaveBeenCalled();
    expect(helper.transformStockToInventoryLevels).not.toHaveBeenCalled();
    expect(helper.transformStockToBatches).not.toHaveBeenCalled();
  });

  it('falls back to payload masters when the branch endpoint fails', async () => {
    const prisma = {
      margSyncConfig: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'config-1',
          tenantId: 'tenant-1',
          isActive: true,
          apiBaseUrl: 'https://corporate.margerp.com',
          companyCode: 'COMPANY',
          companyId: 7,
          margKey: 'encrypted-key',
          decryptionKey: 'encrypted-secret',
          lastSyncIndex: 0,
          lastSyncDatetime: '',
          lastAccountingSyncIndex: 0,
          lastAccountingSyncDatetime: '',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      margSyncLog: {
        create: jest.fn().mockResolvedValue({
          id: 'sync-log-1',
          startedAt: new Date('2026-04-21T00:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as any;
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new MargEdeService(prisma, auditService, {} as any);
    const helper = service as any;

    helper.decryptSecret = jest.fn().mockReturnValue('decrypted');
    helper.touchSyncHeartbeat = jest.fn().mockResolvedValue(undefined);
    helper.fetchBranches = jest.fn().mockRejectedValue(new Error('branch endpoint unavailable'));
    helper.fetchData = jest.fn()
      .mockResolvedValueOnce({
        Product: [],
        Party: [],
        Details: [],
        Stock: [],
        MDis: [],
        Masters: [{ ID: 1, CompanyID: 7, Code: 'MAIN', Name: 'Main Branch' }],
        SaleType: [],
        ACGroup: [],
        Account: [],
        AcBal: [],
        PBal: [],
        Outstanding: [],
        Index: 1,
        DataStatus: 10,
        DateTime: '2026-04-21T08:00:00.000Z',
      })
      .mockResolvedValueOnce({
        Product: [],
        Party: [],
        Details: [],
        Stock: [],
        MDis: [],
        Masters: [],
        SaleType: [],
        ACGroup: [],
        Account: [],
        AcBal: [],
        PBal: [],
        Outstanding: [],
        Index: 1,
        DataStatus: 10,
        DateTime: '2026-04-21T09:00:00.000Z',
      });

    helper.syncBranches = jest.fn().mockResolvedValue(1);
    helper.syncProducts = jest.fn().mockResolvedValue(0);
    helper.syncParties = jest.fn().mockResolvedValue(0);
    helper.syncTransactions = jest.fn().mockResolvedValue(0);
    helper.syncStockData = jest.fn().mockResolvedValue(0);
    helper.syncVouchers = jest.fn().mockResolvedValue(0);
    helper.syncSaleTypes = jest.fn().mockResolvedValue(0);
    helper.syncAccountGroups = jest.fn().mockResolvedValue(0);
    helper.syncAccountPostings = jest.fn().mockResolvedValue(0);
    helper.syncAccountGroupBalances = jest.fn().mockResolvedValue(0);
    helper.syncPartyBalances = jest.fn().mockResolvedValue(0);
    helper.syncOutstandings = jest.fn().mockResolvedValue(0);
    helper.markMissingStockAsDeleted = jest.fn().mockResolvedValue(undefined);
    helper.transformBranches = jest.fn().mockResolvedValue(undefined);
    helper.transformMargNamedMasters = jest.fn().mockResolvedValue(undefined);
    helper.transformProducts = jest.fn().mockResolvedValue(undefined);
    helper.transformParties = jest.fn().mockResolvedValue(undefined);
    helper.transformSuppliers = jest.fn().mockResolvedValue(0);
    helper.transformMargProcurementDocuments = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToActuals = jest.fn().mockResolvedValue(undefined);
    helper.transformStockToInventoryLevels = jest.fn().mockResolvedValue(undefined);
    helper.transformStockToBatches = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToInventoryTransactions = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToInventoryLedger = jest.fn().mockResolvedValue(undefined);
    helper.transformAccountPostingsToJournalEntries = jest.fn().mockResolvedValue({
      journalEntriesSynced: 0,
      skippedGroups: [],
      diagnostics: {
        duplicateFingerprintCount: 0,
        duplicateRowCount: 0,
        skippedByReason: {},
      },
    });
    helper.runPostSyncReconciliations = jest.fn().mockResolvedValue({
      totalIssues: 0,
      warningCount: 0,
      failureCount: 0,
    });

    await expect(service.runSync('config-1', 'tenant-1', 'user-1')).resolves.toBe('sync-log-1');

    expect(helper.syncBranches).toHaveBeenCalledWith('tenant-1', [
      { ID: 1, CompanyID: 7, Code: 'MAIN', Name: 'Main Branch' },
    ]);
  });

  it('reprojects staged inventory and accounting data without fetching Marg again', async () => {
    const prisma = {
      margSyncConfig: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'config-1',
          tenantId: 'tenant-1',
          isActive: true,
          apiBaseUrl: 'https://corporate.margerp.com',
          companyCode: 'COMPANY',
          companyId: 7,
          margKey: 'encrypted-key',
          decryptionKey: 'encrypted-secret',
          lastSyncIndex: 33,
          lastSyncDatetime: '2026-04-20T00:00:00.000Z',
          lastAccountingSyncIndex: 21,
          lastAccountingSyncDatetime: '2026-04-20T00:00:00.000Z',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      margSyncLog: {
        create: jest.fn().mockResolvedValue({
          id: 'sync-log-1',
          startedAt: new Date('2026-04-21T00:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as any;
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new MargEdeService(prisma, auditService, {} as any);
    const helper = service as any;
    const callOrder: string[] = [];

    helper.decryptSecret = jest.fn().mockReturnValue('decrypted');
    helper.touchSyncHeartbeat = jest.fn().mockResolvedValue(undefined);
    helper.fetchBranches = jest.fn().mockRejectedValue(new Error('reprojection should not fetch branches'));
    helper.fetchData = jest.fn().mockRejectedValue(new Error('reprojection should not fetch data'));
    helper.markMissingStockAsDeleted = jest.fn().mockResolvedValue(undefined);
    helper.transformBranches = jest.fn().mockImplementation(async () => {
      callOrder.push('transformBranches');
    });
    helper.transformMargNamedMasters = jest.fn().mockImplementation(async () => {
      callOrder.push('transformMargNamedMasters');
    });
    helper.transformProducts = jest.fn().mockImplementation(async () => {
      callOrder.push('transformProducts');
    });
    helper.transformParties = jest.fn().mockImplementation(async () => {
      callOrder.push('transformParties');
    });
    helper.transformSuppliers = jest.fn().mockImplementation(async () => {
      callOrder.push('transformSuppliers');
      return 2;
    });
    helper.transformMargProcurementDocuments = jest.fn().mockImplementation(async () => {
      callOrder.push('transformMargProcurementDocuments');
    });
    helper.resetMargInventoryProjectionWindow = jest.fn().mockImplementation(async () => {
      callOrder.push('resetMargInventoryProjectionWindow');
      return { affectedLedgerScopes: new Set(['product-1:location-1']) };
    });
    helper.transformTransactionsToActuals = jest.fn().mockImplementation(async (_tenantId: string, _dateWindow: unknown, projectionWindowReset: boolean) => {
      callOrder.push(`transformTransactionsToActuals:${projectionWindowReset}`);
    });
    helper.transformStockToInventoryLevels = jest.fn().mockImplementation(async () => {
      callOrder.push('transformStockToInventoryLevels');
    });
    helper.transformStockToBatches = jest.fn().mockImplementation(async () => {
      callOrder.push('transformStockToBatches');
    });
    helper.transformTransactionsToInventoryTransactions = jest.fn().mockImplementation(async (
      _tenantId: string,
      _dateWindow: unknown,
      projectionWindowReset: boolean,
    ) => {
      callOrder.push(`transformTransactionsToInventoryTransactions:${projectionWindowReset}`);
    });
    helper.transformTransactionsToInventoryLedger = jest.fn().mockImplementation(async (
      _tenantId: string,
      _dateWindow: unknown,
      projectionWindowReset: boolean,
      affectedInventoryScopes: Set<string>,
    ) => {
      callOrder.push(`transformTransactionsToInventoryLedger:${projectionWindowReset}:${affectedInventoryScopes.size}`);
    });
    helper.transformAccountPostingsToJournalEntries = jest.fn().mockImplementation(async () => {
      callOrder.push('transformAccountPostingsToJournalEntries');
      return {
        journalEntriesSynced: 4,
        skippedGroups: [],
        diagnostics: {
          duplicateFingerprintCount: 0,
          duplicateRowCount: 0,
          skippedByReason: {},
        },
      };
    });
    helper.runPostSyncReconciliations = jest.fn().mockImplementation(async (
      _tenantId: string,
      _syncRun: { id: string; startedAt: Date },
      _dateWindow: unknown,
      _skippedGroups: unknown[],
      scope: string,
    ) => {
      callOrder.push(`runPostSyncReconciliations:${scope}`);
      return { totalIssues: 0, warningCount: 0, failureCount: 0 };
    });

    await expect(service.runReprojection('config-1', 'tenant-1', 'user-1')).resolves.toBe('sync-log-1');

    expect(helper.fetchBranches).not.toHaveBeenCalled();
    expect(helper.fetchData).not.toHaveBeenCalled();
    expect(helper.markMissingStockAsDeleted).not.toHaveBeenCalled();
    expect(callOrder).toEqual([
      'transformBranches',
      'transformMargNamedMasters',
      'transformProducts',
      'transformParties',
      'transformSuppliers',
      'resetMargInventoryProjectionWindow',
      'transformMargProcurementDocuments',
      'transformTransactionsToActuals:true',
      'transformStockToInventoryLevels',
      'transformStockToBatches',
      'transformTransactionsToInventoryTransactions:true',
      'transformTransactionsToInventoryLedger:true:1',
      'transformAccountPostingsToJournalEntries',
      `runPostSyncReconciliations:${MARG_SYNC_SCOPE.FULL}`,
    ]);
  });

  it('runs only accounting staging and reconciliation during an accounting-only sync', async () => {
    const prisma = {
      margSyncConfig: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'config-1',
          tenantId: 'tenant-1',
          isActive: true,
          apiBaseUrl: 'https://corporate.margerp.com',
          companyCode: 'COMPANY',
          companyId: 7,
          margKey: 'encrypted-key',
          decryptionKey: 'encrypted-secret',
          lastSyncIndex: 0,
          lastSyncDatetime: '',
          lastAccountingSyncIndex: 0,
          lastAccountingSyncDatetime: '',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      margSyncLog: {
        create: jest.fn().mockResolvedValue({
          id: 'sync-log-1',
          startedAt: new Date('2026-04-21T00:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as any;
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new MargEdeService(prisma, auditService, {} as any);
    const helper = service as any;
    const callOrder: string[] = [];

    helper.decryptSecret = jest.fn().mockReturnValue('decrypted');
    helper.touchSyncHeartbeat = jest.fn().mockResolvedValue(undefined);
    helper.fetchBranches = jest.fn().mockResolvedValue([]);
    helper.syncBranches = jest.fn().mockResolvedValue(0);
    helper.fetchData = jest.fn().mockImplementation(async ({ apiType }: { apiType: string }) => {
      callOrder.push(`fetchData:${apiType}`);
      if (apiType !== '1') {
        throw new Error(`unexpected apiType ${apiType}`);
      }

      return {
        Product: [],
        Party: [],
        Details: [],
        Stock: [],
        MDis: [{
          ID: '101',
          CompanyID: '7',
          Voucher: 'ACC-001',
          Type: 'JV',
          Date: '21/04/2026',
        }],
        SaleType: [],
        ACGroup: [],
        Account: [{}],
        AcBal: [],
        PBal: [],
        Outstanding: [],
        Index: 1,
        DataStatus: 10,
        DateTime: '2026-04-21T09:00:00.000Z',
      };
    });

    helper.syncProducts = jest.fn().mockResolvedValue(0);
    helper.syncParties = jest.fn().mockResolvedValue(0);
    helper.syncTransactions = jest.fn().mockResolvedValue(0);
    helper.syncStockData = jest.fn().mockResolvedValue(0);
    helper.syncVouchers = jest.fn().mockImplementation(async () => {
      callOrder.push('syncVouchers');
      return 1;
    });
    helper.syncSaleTypes = jest.fn().mockResolvedValue(0);
    helper.syncAccountGroups = jest.fn().mockResolvedValue(0);
    helper.syncAccountPostings = jest.fn().mockImplementation(async () => {
      callOrder.push('syncAccountPostings');
      return 1;
    });
    helper.syncAccountGroupBalances = jest.fn().mockResolvedValue(0);
    helper.syncPartyBalances = jest.fn().mockResolvedValue(0);
    helper.syncOutstandings = jest.fn().mockResolvedValue(0);
    helper.markMissingStockAsDeleted = jest.fn().mockResolvedValue(undefined);
    helper.transformBranches = jest.fn().mockResolvedValue(undefined);
    helper.transformMargNamedMasters = jest.fn().mockResolvedValue(undefined);
    helper.transformProducts = jest.fn().mockResolvedValue(undefined);
    helper.transformParties = jest.fn().mockResolvedValue(undefined);
    helper.transformMargProcurementDocuments = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToActuals = jest.fn().mockResolvedValue(undefined);
    helper.transformStockToInventoryLevels = jest.fn().mockResolvedValue(undefined);
    helper.transformStockToBatches = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToInventoryTransactions = jest.fn().mockResolvedValue(undefined);
    helper.transformTransactionsToInventoryLedger = jest.fn().mockResolvedValue(undefined);
    helper.transformAccountPostingsToJournalEntries = jest.fn().mockImplementation(async () => {
      callOrder.push('transformAccountPostingsToJournalEntries');
      return { journalEntriesSynced: 1, skippedGroups: [] };
    });
    helper.runPostSyncReconciliations = jest.fn().mockImplementation(async (
      _tenantId: string,
      _syncRun: { id: string; startedAt: Date },
      _dateWindow: unknown,
      _skippedGroups: unknown[],
      scope: string,
    ) => {
      callOrder.push(`runPostSyncReconciliations:${scope}`);
      return { totalIssues: 0, warningCount: 0, failureCount: 0 };
    });

    await expect(
      service.runSync('config-1', 'tenant-1', 'user-1', undefined, undefined, MARG_SYNC_SCOPE.ACCOUNTING),
    ).resolves.toBe('sync-log-1');

    expect(helper.fetchBranches).not.toHaveBeenCalled();
    expect(helper.transformBranches).not.toHaveBeenCalled();
    expect(helper.transformTransactionsToInventoryLedger).not.toHaveBeenCalled();
    expect(helper.markMissingStockAsDeleted).not.toHaveBeenCalled();
    expect(helper.syncVouchers).toHaveBeenCalledTimes(1);
    expect(helper.touchSyncHeartbeat).toHaveBeenCalledWith('config-1', false);
    expect(callOrder).toEqual([
      'fetchData:1',
      'syncVouchers',
      'syncAccountPostings',
      'transformAccountPostingsToJournalEntries',
      `runPostSyncReconciliations:${MARG_SYNC_SCOPE.ACCOUNTING}`,
    ]);
  });

  it('maps Marg book codes to the correct subsidiary ledgers (A=Purchase, P=Payment)', () => {
    // Real-data verification against APIType=1: Book A rows are 100% covered
    // by MDis.Type=P (purchase invoices); Book P rows have no MDis header and
    // carry bank-payment remarks (e.g. "STAN CHART BANK..."). The earlier
    // mapping had A and P swapped.
    const helper = service as any;
    expect(helper.describeMargBook('S')).toBe('Sales');
    expect(helper.describeMargBook('A')).toBe('Purchase');
    expect(helper.describeMargBook('P')).toBe('Payment');
    expect(helper.describeMargBook('R')).toBe('Receipt');
    expect(helper.describeMargBook('E')).toBe('Sales Adjustment');
    expect(helper.describeMargBook('D')).toBe('Debit Note');
    expect(helper.describeMargBook('J')).toBe('Journal');
    expect(helper.describeMargBook('!')).toBe('Opening');
  });

  it('parses Marg AddField cancellation markers (CANCELLED:1 with CANCELLEDON timestamp)', () => {
    const helper = service as any;

    expect(helper.parseMargCancellation(null)).toEqual({ isCancelled: false, cancelledOn: null });
    expect(helper.parseMargCancellation('')).toEqual({ isCancelled: false, cancelledOn: null });
    expect(helper.parseMargCancellation('I; ;BWIA;00;0;;;0;CANCELLED : 0')).toEqual({
      isCancelled: false,
      cancelledOn: null,
    });

    const cancelled = helper.parseMargCancellation(
      'I; ;BWIA;00;0;;;0;CANCELLED : 1; CANCELLEDON : 17-04-2026 14:30:25',
    );
    expect(cancelled.isCancelled).toBe(true);
    expect(cancelled.cancelledOn).toEqual(new Date(Date.UTC(2026, 3, 17, 14, 30, 25)));

    // Cancellation flag without timestamp is still a cancellation.
    const cancelledNoTimestamp = helper.parseMargCancellation('foo;CANCELLED : 1');
    expect(cancelledNoTimestamp.isCancelled).toBe(true);
    expect(cancelledNoTimestamp.cancelledOn).toBeNull();
  });

  it('suppresses every projection when a Marg document is cancelled', () => {
    const helper = service as any;

    // Same payload as the SALES_INVOICE happy-path test, but with cancellation
    // markers appended. The classified family should still be SALES_INVOICE
    // (for audit) but every shouldProject* flag must be false so neither the
    // actuals, inventory, nor ledger paths produce a row.
    const cancelledInvoice = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'STR26-00012',
      transactionAddField: 'I; ;;00;0;CANCELLED : 1; CANCELLEDON : 01-04-2026 10:15:00',
      voucherType: 'S',
      voucherVcn: 'STR26-00012',
      voucherAddField: 'I;0.00',
      effectiveQty: 12,
      amount: 18040,
    });

    expect(cancelledInvoice).toEqual(expect.objectContaining({
      family: 'SALES_INVOICE',
      isCancelled: true,
      shouldProjectActual: false,
      actualType: null,
      actualQuantity: null,
      actualAmount: null,
      shouldProjectInventory: false,
      inventoryTransactionType: null,
      inventoryQuantity: 0,
      ledgerEntryType: null,
      ledgerQuantity: 0,
    }));
    expect(cancelledInvoice.cancelledOn).toEqual(new Date(Date.UTC(2026, 3, 1, 10, 15, 0)));
  });

  it('returns null instead of a silent first-context fallback when multiple MDis headers conflict', () => {
    const helper = service as any;

    const result = helper.selectMargVoucherContextForTransaction(
      { companyId: 11093, voucher: '1832495', type: 'G', vcn: 'STR26-00012' },
      // Two header candidates whose types neither match 'S' nor any other
      // line-type-preferred fallback for a 'G' line.
      [
        { companyId: 11093, voucher: '1832495', type: 'L', vcn: 'STR26-00012', addField: null },
        { companyId: 11093, voucher: '1832495', type: 'B', vcn: 'STR26-00012', addField: null },
      ],
    );

    expect(result).toBeNull();
  });

  it('bootstraps Marg GL accounts and mapping rules even when other GL accounts already exist', async () => {
    // Regression: ensureMargAccountingBootstrap used to short-circuit on the
    // first existing GL account, leaving tenants with a curated chart of
    // accounts but no Marg mapping rules unable to project journals. The
    // bootstrap must now run whenever no active Marg rule exists, regardless
    // of whether the tenant has unrelated GL accounts. The MARG-prefixed
    // account numbers cannot collide with user-curated accounts.
    const gLAccountUpsert = jest.fn().mockResolvedValue({ id: 'gl-marg-c6', parentId: null });
    const margGLMappingRuleCreate = jest.fn().mockResolvedValue(undefined);

    const tx = {
      gLAccount: {
        upsert: gLAccountUpsert,
        update: jest.fn().mockResolvedValue(undefined),
      },
      margGLMappingRule: {
        create: margGLMappingRuleCreate,
      },
    };

    service = new MargEdeService({
      gLAccount: {
        // 12 unrelated GL accounts already exist (e.g. seeded chart of
        // accounts). The bootstrap must still run.
        count: jest.fn().mockResolvedValue(12),
      },
      margGLMappingRule: {
        count: jest.fn().mockResolvedValue(0),
      },
      margAccountGroup: {
        findMany: jest.fn().mockResolvedValue([
          {
            companyId: 11093,
            aid: 'C6',
            name: 'Sundry Debtors',
            under: null,
            addField: null,
          },
        ]),
      },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any, {} as any, {} as any);

    const helper = service as any;
    await helper.ensureMargAccountingBootstrap('tenant-1');

    expect(gLAccountUpsert).toHaveBeenCalledTimes(1);
    // Auto-provisioned account numbers follow buildAutoMargGlAccountNumber's
    // format `M{companyId}-{aid}-{hash}` which cannot collide with curated
    // user accounts.
    expect(gLAccountUpsert.mock.calls[0][0].create.accountNumber).toMatch(/^M\d+-/);
    expect(margGLMappingRuleCreate).toHaveBeenCalled();
  });

  it('reloads the full voucher group when only one row was touched by the sync run', async () => {
    // Phase B regression: journal projection used to group the changed-since
    // rows directly, which produces an unbalanced 1-line journal whenever
    // Marg emits a partial update for a multi-line voucher. The projection
    // must now treat changed rows as a discovery list and reload every row
    // in each touched (companyId, date, book, voucher) group before building
    // the journal entry.
    const voucherDate = new Date('2026-04-04T00:00:00.000Z');
    const debitRow = {
      margId: BigInt(101),
      companyId: 11093,
      voucher: 'STR26-00367',
      date: voucherDate,
      book: 'S',
      code: 'CGKF',
      code1: 'GJU',
      gCode: 'C6',
      amount: 17076,
      remark: 'STR26-00367',
    };
    const creditRow = {
      margId: BigInt(102),
      companyId: 11093,
      voucher: 'STR26-00367',
      date: voucherDate,
      book: 'S',
      code: 'GJU',
      code1: 'CGKF',
      gCode: 'J61',
      amount: -17076,
      remark: 'STR26-00367',
    };

    const tx = {
      margAccountJournalProjection: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'projection-1' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    // Discovery query (filtered by updatedAt) returns ONLY the debit row.
    // Reload query (keyed by companyId/date/book/voucher) returns BOTH rows.
    const margAccountPostingFindMany = jest.fn().mockImplementation((args: any) => {
      const where = args?.where ?? {};
      if (where.updatedAt) {
        return Promise.resolve([debitRow]);
      }
      if (where.companyId === 11093 && where.voucher === 'STR26-00367') {
        return Promise.resolve([debitRow, creditRow]);
      }
      return Promise.resolve([]);
    });

    const createJournalEntry = jest.fn().mockResolvedValue({ id: 'journal-1' });

    service = new MargEdeService({
      margGLMappingRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-c6',
            companyId: 11093,
            bookCode: null,
            groupCode: 'C6',
            partyCode: null,
            counterpartyCode: null,
            remarkContains: null,
            glAccountId: 'gl-c6',
            priority: 10,
          },
          {
            id: 'rule-j61',
            companyId: 11093,
            bookCode: null,
            groupCode: 'J61',
            partyCode: null,
            counterpartyCode: null,
            remarkContains: null,
            glAccountId: 'gl-j61',
            priority: 10,
          },
        ]),
      },
      margAccountPosting: { findMany: margAccountPostingFindMany },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any, {} as any, {
      createJournalEntry,
      reverseJournalEntry: jest.fn().mockResolvedValue(undefined),
    } as any);

    const helper = service as any;
    helper.resolveJournalPostingUserId = jest.fn().mockResolvedValue('user-1');

    const result = await helper.transformAccountPostingsToJournalEntries(
      'tenant-1',
      { id: 'sync-log-1', startedAt: new Date('2026-04-21T00:00:00.000Z') },
      null,
      'user-1',
    );

    // The single touched row triggered a reload of the full 2-row voucher,
    // which projects as one balanced journal entry rather than being
    // skipped for "Insufficient mapped lines".
    expect(result.journalEntriesSynced).toBe(1);
    expect(result.skippedGroups).toEqual([]);
    expect(margAccountPostingFindMany).toHaveBeenCalledTimes(2);
    expect(margAccountPostingFindMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      updatedAt: { gte: new Date('2026-04-21T00:00:00.000Z') },
    });
    expect(margAccountPostingFindMany.mock.calls[1][0].where).toMatchObject({
      tenantId: 'tenant-1',
      companyId: 11093,
      voucher: 'STR26-00367',
      book: 'S',
    });
    expect(createJournalEntry).toHaveBeenCalledTimes(1);
    const journalArg = createJournalEntry.mock.calls[0][1];
    expect(journalArg.lines).toHaveLength(2);
  });

  // ===================================================================
  // Strict Type 2 classifier acceptance tests
  //
  // Locks down the production-hardening contract: Dis.Type alone NEVER
  // produces an actual / inventory movement / purchase document / report
  // contribution. Every "happy path" requires a matching MDis header; every
  // "missing or ambiguous MDis" path returns UNKNOWN with shouldProject*
  // false so the caller's reversal sweep can clean up any prior projection
  // idempotently. These tests are the regression net for any future drift
  // back to a Dis.Type fallback.
  // ===================================================================

  it('strict classifier: missing MDis header + Dis.Type=G does NOT project a sales actual', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'STR26-00012',
      transactionAddField: 'I; ;;00;0',
      voucherType: null,
      voucherVcn: null,
      voucherAddField: null,
      effectiveQty: 12,
      amount: 18040,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'UNKNOWN',
      confidence: 'LOW',
      skipReason: 'MISSING_MDIS_HEADER',
      shouldProjectActual: false,
      shouldProjectInventory: false,
      actualType: null,
      actualAmount: null,
      inventoryTransactionType: null,
      ledgerEntryType: null,
    }));
  });

  it('strict classifier: missing MDis header + Dis.Type=P does NOT project a purchase', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'P',
      transactionVcn: 'PO12345',
      transactionAddField: 'I; ;;00;0',
      voucherType: null,
      voucherVcn: null,
      voucherAddField: null,
      effectiveQty: 10,
      amount: 5000,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'UNKNOWN',
      skipReason: 'MISSING_MDIS_HEADER',
      shouldProjectActual: false,
      shouldProjectInventory: false,
    }));
  });

  it('strict classifier: missing MDis header + Dis.Type=X does NOT project a purchase order or stock movement', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'X',
      transactionVcn: 'PO-001',
      transactionAddField: 'C; ;;00;0',
      voucherType: null,
      voucherVcn: null,
      voucherAddField: null,
      effectiveQty: 4,
      amount: 100,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'UNKNOWN',
      skipReason: 'MISSING_MDIS_HEADER',
      shouldProjectActual: false,
      shouldProjectInventory: false,
    }));
  });

  it('strict classifier: ambiguous MDis header (caller flagged) does NOT project, distinguished from "missing"', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'STR26-00012',
      transactionAddField: 'I; ;;00;0',
      voucherType: null,
      voucherVcn: null,
      voucherAddField: null,
      voucherContextAmbiguous: true,
      effectiveQty: 12,
      amount: 18040,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'UNKNOWN',
      skipReason: 'AMBIGUOUS_MDIS_HEADER',
      shouldProjectActual: false,
      shouldProjectInventory: false,
    }));
  });

  it('strict classifier: unknown MDis header type does NOT project (no Dis.Type rescue)', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'STR26-00012',
      transactionAddField: 'I; ;;00;0',
      voucherType: 'Z', // fabricated MDis type the classifier doesn't recognise
      voucherVcn: 'XYZ123',
      voucherAddField: null,
      effectiveQty: 12,
      amount: 18040,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'UNKNOWN',
      skipReason: 'UNKNOWN_DOCUMENT_FAMILY',
      shouldProjectActual: false,
      shouldProjectInventory: false,
    }));
  });

  it('strict classifier happy path: S/STR/I with Dis.Type=G projects SALES_INVOICE with HIGH confidence', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'STR26-00012',
      transactionAddField: 'I; ;;00;0',
      voucherType: 'S',
      voucherVcn: 'STR26-00012',
      voucherAddField: 'I;0.00',
      effectiveQty: 12,
      amount: 18040,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'SALES_INVOICE',
      confidence: 'HIGH',
      skipReason: null,
      shouldProjectActual: true,
      shouldProjectInventory: true,
      actualType: ActualType.SALES,
      inventoryTransactionType: InventoryTransactionType.ISSUE,
    }));
  });

  it('strict classifier happy path: S/CHAL/C with Dis.Type=G projects challan inventory but NO sales actual', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'CHAL032585',
      transactionAddField: 'C; ;;00;0',
      voucherType: 'S',
      voucherVcn: 'CHAL032585',
      voucherAddField: 'C;0.00',
      effectiveQty: 4,
      amount: 200,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'SALES_CHALLAN',
      confidence: 'HIGH',
      skipReason: null,
      shouldProjectActual: false,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.ISSUE,
    }));
  });

  it('strict classifier happy path: P/<supplier-vcn>/I projects PURCHASE_INVOICE + inventory receipt', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'P',
      transactionVcn: 'INV-12345',
      transactionAddField: 'I; ;;00;0',
      voucherType: 'P',
      voucherVcn: 'INV-12345',
      voucherAddField: 'I;0.00',
      effectiveQty: 25,
      amount: 12500,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'PURCHASE_INVOICE',
      confidence: 'HIGH',
      skipReason: null,
      shouldProjectActual: true,
      actualType: ActualType.PURCHASES,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.RECEIPT,
    }));
  });

  it('strict classifier happy path: X/PO-/C projects PURCHASE_ORDER only (no actual, no stock)', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'X',
      transactionVcn: 'PO-001',
      transactionAddField: 'C; ;;00;0',
      voucherType: 'X',
      voucherVcn: 'PO-001',
      voucherAddField: 'C;0.00',
      effectiveQty: 10,
      amount: 5000,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'PURCHASE_ORDER',
      confidence: 'HIGH',
      skipReason: null,
      shouldProjectActual: false,
      shouldProjectInventory: false,
    }));
  });

  it('strict classifier: T/SC/I is LOW confidence and skipped by default (accounting-only Book E posting elsewhere)', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'X',
      transactionVcn: 'SC00001',
      transactionAddField: 'I; ;;00;0',
      voucherType: 'T',
      voucherVcn: 'SC00001',
      voucherAddField: 'I;0.00',
      effectiveQty: 2,
      amount: 610,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'SALES_RETURN_ADJUSTMENT',
      confidence: 'LOW',
      skipReason: 'LOW_CONFIDENCE_DOCUMENT_FAMILY',
      shouldProjectActual: false,
      shouldProjectInventory: false,
    }));
  });

  it('strict classifier: cancelled document classifies to family + isCancelled=true + skip across every pipeline', () => {
    const helper = service as any;
    const decision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'STR26-00012',
      transactionAddField: 'I; ;;00;0;CANCELLED : 1; CANCELLEDON : 01-04-2026 10:15:00',
      voucherType: 'S',
      voucherVcn: 'STR26-00012',
      voucherAddField: 'I;0.00',
      effectiveQty: 12,
      amount: 18040,
    });
    expect(decision).toEqual(expect.objectContaining({
      family: 'SALES_INVOICE',
      isCancelled: true,
      skipReason: 'CANCELLED_DOCUMENT',
      shouldProjectActual: false,
      shouldProjectInventory: false,
      actualType: null,
      inventoryTransactionType: null,
      ledgerEntryType: null,
    }));
  });

  it('accumulateMargProjectionDiagnostics: increments the right counter for each skipReason and tracks projected families', () => {
    const helper = service as any;
    const diag = {
      missingMdisHeaderCount: 0,
      ambiguousMdisHeaderCount: 0,
      unknownDocumentFamilyCount: 0,
      lowConfidenceDocumentFamilyCount: 0,
      cancelledRowsSkippedCount: 0,
      cancelledRowsReversedCount: 0,
      projectedByFamily: {} as Record<string, number>,
    };

    const missingHeaderDecision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G', transactionVcn: 'STR26-00001', transactionAddField: 'I',
      voucherType: null, voucherVcn: null, voucherAddField: null,
      effectiveQty: 1, amount: 100,
    });
    helper.accumulateMargProjectionDiagnostics(missingHeaderDecision, diag, {
      wasPreviouslyProjected: false, willProject: false,
    });
    expect(diag.missingMdisHeaderCount).toBe(1);

    const ambiguousDecision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G', transactionVcn: 'STR26-00001', transactionAddField: 'I',
      voucherType: null, voucherVcn: null, voucherAddField: null,
      voucherContextAmbiguous: true,
      effectiveQty: 1, amount: 100,
    });
    helper.accumulateMargProjectionDiagnostics(ambiguousDecision, diag, {
      wasPreviouslyProjected: false, willProject: false,
    });
    expect(diag.ambiguousMdisHeaderCount).toBe(1);

    const scDecision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'X', transactionVcn: 'SC00001', transactionAddField: 'I',
      voucherType: 'T', voucherVcn: 'SC00001', voucherAddField: 'I',
      effectiveQty: 1, amount: 100,
    });
    helper.accumulateMargProjectionDiagnostics(scDecision, diag, {
      wasPreviouslyProjected: false, willProject: false,
    });
    expect(diag.lowConfidenceDocumentFamilyCount).toBe(1);

    const cancelledDecision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G',
      transactionVcn: 'STR26-00001',
      transactionAddField: 'I;CANCELLED : 1',
      voucherType: 'S', voucherVcn: 'STR26-00001', voucherAddField: 'I',
      effectiveQty: 1, amount: 100,
    });
    helper.accumulateMargProjectionDiagnostics(cancelledDecision, diag, {
      wasPreviouslyProjected: true, willProject: false,
    });
    expect(diag.cancelledRowsReversedCount).toBe(1);
    expect(diag.cancelledRowsSkippedCount).toBe(0);

    const healthyDecision = helper.resolveMargType2ProjectionDecision({
      transactionType: 'G', transactionVcn: 'STR26-00001', transactionAddField: 'I',
      voucherType: 'S', voucherVcn: 'STR26-00001', voucherAddField: 'I',
      effectiveQty: 1, amount: 100,
    });
    helper.accumulateMargProjectionDiagnostics(healthyDecision, diag, {
      wasPreviouslyProjected: false, willProject: true,
    });
    expect(diag.projectedByFamily.SALES_INVOICE).toBe(1);
  });

  // ===================================================================
  // Production-hardening: staging-time cancellation, outstanding-snapshot
  // closure, procurement cancellation, supplier-side family signing.
  //
  // These tests lock the contract that:
  //  - parseMargCancellation is invoked once at sync staging time so
  //    is_cancelled / cancelled_on land on every staged row without
  //    re-parsing AddField at projection / report time.
  //  - closeUnseenMargOutstandings only updates rows whose
  //    last_seen_sync_log_id != currentSyncLogId AND sourceDeleted=false,
  //    leaving live rows (just seen) untouched and resurrected rows
  //    (re-emitted with new lastSeen) un-closed.
  //  - The helper is defensive against partial Prisma mocks (matches the
  //    shape used by ensureMargAccountingBootstrap) so the sync
  //    orchestrator can call it unconditionally without breaking fixtures.
  // ===================================================================

  it('closeUnseenMargOutstandings: marks rows whose last_seen_sync_log_id is null or stale, leaves live rows alone', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 7 });
    service = new MargEdeService({
      margOutstanding: { updateMany },
    } as any, {} as any, {} as any);

    const helper = service as any;
    const closed = await helper.closeUnseenMargOutstandings('tenant-1', 'sync-log-99');

    expect(closed).toBe(7);
    expect(updateMany).toHaveBeenCalledTimes(1);
    // The OR captures both "never seen since the column existed" and "seen
    // by an earlier sync but not this one". Live rows (lastSeen ==
    // currentSyncLogId) are NOT in the OR set and stay untouched.
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        sourceDeleted: false,
        OR: [
          { lastSeenSyncLogId: null },
          { lastSeenSyncLogId: { not: 'sync-log-99' } },
        ],
      },
      data: { sourceDeleted: true },
    });
  });

  it('closeUnseenMargOutstandings: is a no-op when the margOutstanding delegate is missing (defensive against partial mocks)', async () => {
    service = new MargEdeService({} as any, {} as any, {} as any);
    const helper = service as any;
    // Should not throw — must early-return 0 when the delegate isn't there.
    const closed = await helper.closeUnseenMargOutstandings('tenant-1', 'sync-log-99');
    expect(closed).toBe(0);
  });

  it('parseMargCancellation: invoked at staging time so is_cancelled lands on the row before projection', () => {
    // The contract: callers (syncVouchers / syncTransactions) parse cancellation
    // ONCE from AddField and persist it as a first-class column. We don't
    // exercise the bulk-SQL insert here (it requires a live Postgres) — we
    // exercise the pure parser the staging code calls so the persisted
    // shape (boolean + nullable timestamp) is locked.
    const helper = service as any;

    const live = helper.parseMargCancellation('I; ;BWIN;00;0;;;0;CANCELLED : 0');
    expect(live).toEqual({ isCancelled: false, cancelledOn: null });

    const cancelled = helper.parseMargCancellation(
      'I; ;BWIN;00;0;;;0;CANCELLED : 1; CANCELLEDON : 18-04-2026 09:30:00',
    );
    expect(cancelled.isCancelled).toBe(true);
    expect(cancelled.cancelledOn).toEqual(new Date(Date.UTC(2026, 3, 18, 9, 30, 0)));

    // Garbled timestamp still marks the row cancelled (the boolean is the
    // load-bearing signal; the timestamp is informational).
    const cancelledNoTimestamp = helper.parseMargCancellation('foo;CANCELLED : 1');
    expect(cancelledNoTimestamp).toEqual({ isCancelled: true, cancelledOn: null });
  });
});
