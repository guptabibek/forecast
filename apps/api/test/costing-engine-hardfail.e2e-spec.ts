import { describe, expect, it, jest } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/library';
import { CostingEngineService } from '../src/modules/manufacturing/services/costing-engine.service';

function createService(overrides?: {
  idempotencyAcquire?: any;
  idempotencyStamp?: any;
  postTransactionalJournal?: any;
}) {
  const prisma = {} as any;
  const ledger = {} as any;
  const accounting = {
    postTransactionalJournal: overrides?.postTransactionalJournal ?? jest.fn(async () => ({ id: 'je-1' })),
  } as any;
  const sequence = {} as any;
  const idempotency = {
    acquire: overrides?.idempotencyAcquire ?? jest.fn(async () => null),
    stamp: overrides?.idempotencyStamp ?? jest.fn(async () => undefined),
  } as any;

  return new CostingEngineService(prisma, ledger, accounting, sequence, idempotency);
}

describe('CostingEngineService hard-fail guards', () => {
  it('rejects landed cost allocation when amount is non-positive', async () => {
    const service = createService();

    const tx = {} as any;

    await expect(
      service.allocateLandedCostInTx(tx, {
        tenantId: 'tenant-1',
        goodsReceiptId: 'gr-1',
        allocations: [
          {
            goodsReceiptLineId: 'line-1',
            productId: 'prod-1',
            locationId: 'loc-1',
            costCategory: 'FREIGHT',
            amount: 0,
          },
        ],
        allocationMethod: 'MANUAL',
        userId: 'user-1',
      }),
    ).rejects.toThrow('Landed cost amount must be greater than zero');
  });

  it('rejects landed cost allocation when cost layer linkage does not match tenant/product/location', async () => {
    const service = createService();

    const tx = {
      landedCostAllocation: {
        create: jest.fn(async () => ({ id: 'alloc-1' })),
      },
      costLayer: {
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      itemCostProfile: {
        findUnique: jest.fn(async () => null),
      },
      $queryRaw: jest.fn(async () => []),
    } as any;

    await expect(
      service.allocateLandedCostInTx(tx, {
        tenantId: 'tenant-1',
        goodsReceiptId: 'gr-1',
        allocations: [
          {
            goodsReceiptLineId: 'line-1',
            costLayerId: 'layer-1',
            productId: 'prod-1',
            locationId: 'loc-1',
            costCategory: 'FREIGHT',
            amount: 100,
          },
        ],
        allocationMethod: 'MANUAL',
        userId: 'user-1',
      }),
    ).rejects.toThrow('Invalid cost layer layer-1 for product prod-1 at location loc-1');
  });

  it('rejects standard cost rollup when no overhead source is configured', async () => {
    const service = createService();

    const tx = {
      billOfMaterial: {
        findFirst: jest.fn(async () => ({
          id: 'bom-1',
          baseQuantity: new Decimal(1),
          components: [],
          routings: [],
        })),
      },
      itemCostProfile: {
        findUnique: jest.fn(async () => null),
      },
    } as any;

    await expect(
      service.rollupStandardCostInTx(tx, {
        tenantId: 'tenant-1',
        productId: 'prod-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('No overhead rate configured for product prod-1');
  });
});
