import { InventoryReportsService, normalizeMovementLedgerFilters } from './inventory-reports.service';

describe('getReorderReport — SQL contract', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  // Capture every $queryRaw call's rendered SQL so we can assert the
  // correctness-critical structure without a live DB (the numeric behaviour
  // is verified separately against Postgres).
  function buildService() {
    const sqls: string[] = [];
    const prisma = {
      $queryRaw: jest.fn((sqlObj: any) => {
        sqls.push(Array.isArray(sqlObj?.strings) ? sqlObj.strings.join('?') : String(sqlObj));
        // First call is COUNT, second is the data query. Return shapes both consumers accept.
        return Promise.resolve([{ cnt: BigInt(0) }]);
      }),
    };
    const service = new InventoryReportsService(prisma as any);
    return { service, sqls };
  }

  it('measures demand from family-correct net SALES actuals (not raw inventory issues)', async () => {
    const { service, sqls } = buildService();
    await service.getReorderReport(tenantId, {});
    const joined = sqls.join('\n');
    expect(joined).toContain('FROM actuals a');
    expect(joined).toContain(`a.actual_type = 'SALES'`);
    // Must NOT regress to the old raw-issue demand basis.
    expect(joined).not.toContain("transaction_type IN ('ISSUE'");
  });

  it('subtracts committed on-order (open POs, excluding draft/closed/cancelled)', async () => {
    const { service, sqls } = buildService();
    await service.getReorderReport(tenantId, {});
    const joined = sqls.join('\n');
    expect(joined).toContain('FROM purchase_order_lines pol');
    expect(joined).toContain(`po.status NOT IN ('DRAFT', 'CLOSED', 'CANCELLED')`);
    expect(joined).toContain('- on_hand_qty - on_order_qty');
  });

  it('honours config overrides (COALESCE) and computes reorder point + order-up-to', async () => {
    const { service, sqls } = buildService();
    await service.getReorderReport(tenantId, {});
    const joined = sqls.join('\n');
    expect(joined).toContain('COALESCE(cfg_reorder_point,');
    expect(joined).toContain('order_up_to_qty');
    // MOQ / pack-multiple / max-cap rounding chain present.
    expect(joined).toContain('cfg_min_order');
    expect(joined).toContain('cfg_multiple');
    expect(joined).toContain('cfg_max_order');
  });

  it('applies scoped reorder policies after exact product-location policies', async () => {
    const { service, sqls } = buildService();
    await service.getReorderReport(tenantId, {});
    const joined = sqls.join('\n');

    expect(joined).toContain('FROM inventory_policy_scopes ips');
    expect(joined).toContain("ips.scope_type = 'PRODUCT_COMPANY'");
    expect(joined).toContain("ips.scope_type = 'HSN_CODE'");
    expect(joined).toContain("ips.scope_type = 'SALT'");
    expect(joined).toContain("ips.scope_type = 'PRODUCT_GROUP'");
    expect(joined).toContain("ips.scope_type = 'SUPPLIER'");
    expect(joined).toContain('COALESCE(ip.reorder_point, scope_policy.reorder_point)');
    expect(joined).toContain("WHEN ip.id IS NOT NULL THEN 'PRODUCT_LOCATION'");
    expect(joined).toContain("WHEN scope_policy.id IS NOT NULL THEN 'SCOPED'");
  });

  it('filters reorder rows by policy dimensions and supplier', async () => {
    const { service, sqls } = buildService();
    await service.getReorderReport(tenantId, {
      productCompany: 'ACME',
      hsnCode: '30049099',
      salt: 'PARA',
      productGroup: 'TAB',
      supplierIds: ['22222222-2222-4222-8222-222222222222'],
    });
    const joined = sqls.join('\n');

    expect(joined).toContain('NULLIF(TRIM(p.product_company), \'\') = ?');
    expect(joined).toContain('NULLIF(TRIM(p.hsn_code), \'\') = ?');
    expect(joined).toContain('NULLIF(TRIM(p.salt), \'\') = ?');
    expect(joined).toContain('NULLIF(TRIM(p.product_group), \'\') = ?');
    expect(joined).toContain('supplier_match.supplier_id = ANY(?::uuid[])');
  });

  it('default scope shows only actionable rows; includeAll bypasses the gate', async () => {
    const a = buildService();
    await a.service.getReorderReport(tenantId, {});
    // A row needs a positive suggested qty, OR a REAL (>0) reorder point that
    // on-hand has fallen to/below. The reorder_point>0 guard stops zero-stock,
    // zero-demand items (fees / dormant SKUs) showing as false OUT_OF_STOCK.
    expect(a.sqls.join('\n')).toContain('rr.suggested_order_qty > 0 OR (rr.reorder_point > 0 AND rr.on_hand_qty <= rr.reorder_point)');

    const b = buildService();
    await b.service.getReorderReport(tenantId, { includeAll: true });
    // gate collapses to TRUE — the needs-reorder predicate is absent.
    expect(b.sqls.join('\n')).not.toContain('rr.reorder_point > 0 AND rr.on_hand_qty <= rr.reorder_point');
  });

  it('lookbackDays falls back to the avgSalesDays alias for API back-compat', async () => {
    // Both should run without error and produce the demand CTE.
    const a = buildService();
    await a.service.getReorderReport(tenantId, { lookbackDays: 60 });
    const b = buildService();
    await b.service.getReorderReport(tenantId, { avgSalesDays: 45 });
    expect(a.sqls.join('\n')).toContain('FROM actuals a');
    expect(b.sqls.join('\n')).toContain('FROM actuals a');
  });
});

describe('normalizeMovementLedgerFilters', () => {
  it('maps display movement labels to ledger enum values', () => {
    const filters = normalizeMovementLedgerFilters([
      { field: 'entry_type', operator: 'equals', value: 'Purchase Invoice' },
      { field: 'entry_type', operator: 'equals', value: 'Sales' },
      { field: 'entry_type', operator: 'equals', value: 'Stock Adjustment' },
    ]);

    expect(filters).toEqual([
      { field: 'entry_type', operator: 'equals', value: 'LEDGER_RECEIPT' },
      { field: 'entry_type', operator: 'equals', value: 'LEDGER_ISSUE' },
      { field: 'entry_type', operator: 'equals', value: 'LEDGER_ADJUSTMENT' },
    ]);
  });

  it('maps generic transfer filters to both transfer directions', () => {
    const [filter] = normalizeMovementLedgerFilters([
      { field: 'entry_type', operator: 'equals', value: 'Stock Transfer' },
    ]);

    expect(filter).toEqual({
      field: 'entry_type',
      operator: 'in',
      value: ['LEDGER_TRANSFER_IN', 'LEDGER_TRANSFER_OUT'],
    });
  });
});

describe('reorder-config endpoints', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  it('getReorderConfigTemplate covers every product×location with existing policy pre-filled (no batch gate)', async () => {
    const sqls: string[] = [];
    const prisma = {
      $queryRaw: jest.fn((o: any) => {
        sqls.push(Array.isArray(o?.strings) ? o.strings.join('?') : String(o));
        return Promise.resolve([]);
      }),
    };
    await new InventoryReportsService(prisma as any).getReorderConfigTemplate(tenantId, {});
    const j = sqls.join('\n');
    expect(j).toContain('FROM inventory_levels il');
    expect(j).toContain('JOIN products p');
    expect(j).toContain('LEFT JOIN inventory_policies ip');
    // The batch-presence gate was proven unsafe (hid sold-out real drugs) and removed.
    expect(j).not.toContain('FROM batches bx');
  });

  it('getReorderPolicies returns paginated configured rows', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ cnt: BigInt(2) }])
        .mockResolvedValueOnce([{ product_code: 'SKU1' }]),
    };
    const res = await new InventoryReportsService(prisma as any).getReorderPolicies(tenantId, {});
    expect(res.total).toBe(2);
    expect(res.data).toHaveLength(1);
  });

  it('deleteReorderPolicy deletes by tenant+product+location and reports the count', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new InventoryReportsService({ inventoryPolicy: { deleteMany } } as any);
    const res = await service.deleteReorderPolicy(tenantId, 'p1', 'l1');
    expect(deleteMany).toHaveBeenCalledWith({ where: { tenantId, productId: 'p1', locationId: 'l1' } });
    expect(res.deleted).toBe(1);
  });

  it('upsertReorderPolicies resolves codes, upserts known rows, and skips unknown ones', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', code: 'SKU1' }]) },
      location: { findMany: jest.fn().mockResolvedValue([{ id: 'l1', code: 'WH1' }]) },
      inventoryPolicy: { upsert },
    };
    const res = await new InventoryReportsService(prisma as any).upsertReorderPolicies(tenantId, [
      { productCode: 'SKU1', locationCode: 'WH1', reorderPoint: 100 },
      { productCode: 'NOPE', locationCode: 'WH1' },
    ]);
    expect(res.upserted).toBe(1);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].reason).toMatch(/unknown product/i);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('upsertReorderPolicyScopes resolves location and supplier codes, upserts known rows, and skips unknown ones', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const prisma = {
      location: { findMany: jest.fn().mockResolvedValue([{ id: 'l1', code: 'MAIN' }]) },
      supplier: { findMany: jest.fn().mockResolvedValue([{ id: 's1', code: 'SUP-1' }]) },
      $executeRaw: executeRaw,
    };

    const res = await new InventoryReportsService(prisma as any).upsertReorderPolicyScopes(tenantId, [
      { scopeType: 'PRODUCT_COMPANY', scopeCode: 'ACME', locationCode: 'MAIN', reorderPoint: 100 },
      { scopeType: 'SUPPLIER', supplierCode: 'SUP-1', reorderQty: 25 },
      { scopeType: 'SUPPLIER', supplierCode: 'NOPE', reorderQty: 25 },
    ]);

    expect(res.upserted).toBe(2);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].reason).toMatch(/unknown supplier/i);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it('deleteReorderPolicyScope deletes by tenant and scoped policy id', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const service = new InventoryReportsService({ $executeRaw: executeRaw } as any);
    const res = await service.deleteReorderPolicyScope(tenantId, '33333333-3333-4333-8333-333333333333');

    expect(res.deleted).toBe(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
