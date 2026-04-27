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
      shouldProjectActual: true,
      actualType: ActualType.SALES,
      actualQuantity: -2,
      actualAmount: -610,
      shouldProjectInventory: true,
      inventoryTransactionType: InventoryTransactionType.RETURN,
      inventoryQuantity: 2,
      ledgerEntryType: LedgerEntryType.LEDGER_RETURN,
      ledgerQuantity: 2,
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
    const margAccountPostingFindMany = jest.fn()
      .mockResolvedValueOnce([
        {
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
        },
        {
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
        },
      ]);

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
    expect(margAccountPostingFindMany).toHaveBeenCalledTimes(1);
    expect(margAccountPostingFindMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      updatedAt: { gte: new Date('2026-04-21T00:00:00.000Z') },
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
    helper.transformProducts = jest.fn().mockResolvedValue(undefined);
    helper.transformParties = jest.fn().mockResolvedValue(undefined);
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
    helper.transformProducts = jest.fn().mockResolvedValue(undefined);
    helper.transformParties = jest.fn().mockResolvedValue(undefined);
    helper.transformSuppliers = jest.fn().mockResolvedValue(0);
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
      'transformProducts',
      'transformParties',
      'transformSuppliers',
      'resetMargInventoryProjectionWindow',
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
    helper.transformProducts = jest.fn().mockResolvedValue(undefined);
    helper.transformParties = jest.fn().mockResolvedValue(undefined);
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
});