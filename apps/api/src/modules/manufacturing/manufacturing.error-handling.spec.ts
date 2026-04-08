import { describe, expect, it, jest } from '@jest/globals';
import { ManufacturingService } from './manufacturing.service';

type MockContext = {
  service: ManufacturingService;
  prisma: {
    purchaseOrder: {
      findFirst: any;
    };
    workOrder: {
      findFirst: any;
    };
    $transaction: any;
  };
  sequence: {
    nextNumber: any;
  };
};

function createServiceContext(): MockContext {
  const service = new ManufacturingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const prisma = {
    purchaseOrder: {
      findFirst: jest.fn(),
    },
    workOrder: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const sequence = {
    nextNumber: jest.fn(),
  };

  (service as any).prisma = prisma;
  (service as any).sequence = sequence;

  return { service, prisma, sequence };
}

describe('ManufacturingService PO/WO/GR error handling', () => {
  it('throws NotFoundException when purchase order does not exist', async () => {
    const context = createServiceContext();
    context.prisma.purchaseOrder.findFirst.mockResolvedValue(null);

    await expect(context.service.getPurchaseOrder('tenant-1', 'po-1')).rejects.toThrow('Purchase order not found');
  });

  it('throws NotFoundException when work order does not exist', async () => {
    const context = createServiceContext();
    context.prisma.workOrder.findFirst.mockResolvedValue(null);

    await expect(context.service.getWorkOrder('tenant-1', 'wo-1')).rejects.toThrow('Work order not found');
  });

  it('throws NotFoundException when creating goods receipt for missing purchase order', async () => {
    const context = createServiceContext();

    context.prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      const tx = {
        purchaseOrder: {
          findFirst: jest.fn(async () => null),
        },
      };
      return callback(tx);
    });

    await expect(
      context.service.createGoodsReceipt('tenant-1', 'user-1', {
        purchaseOrderId: 'po-1',
        lines: [{ purchaseOrderLineId: 'line-1', quantity: 5 }],
      }),
    ).rejects.toThrow('Purchase order not found');

    expect(context.sequence.nextNumber).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when issuing material for missing work order', async () => {
    const context = createServiceContext();

    context.prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      const tx = {
        workOrder: {
          findFirst: jest.fn(async () => null),
        },
      };
      return callback(tx);
    });

    await expect(
      context.service.issueMaterial('tenant-1', 'user-1', {
        workOrderId: 'wo-1',
        productId: 'prod-1',
        quantity: 1,
      }),
    ).rejects.toThrow('Work order not found');
  });

  it('throws NotFoundException when recording labor for missing operation', async () => {
    const context = createServiceContext();

    context.prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      const tx = {
        workOrderOperation: {
          findFirst: jest.fn(async () => null),
        },
      };
      return callback(tx);
    });

    await expect(
      context.service.recordLabor('tenant-1', 'user-1', {
        operationId: 'op-1',
        laborType: 'RUN',
        startTime: new Date('2026-02-01T00:00:00.000Z').toISOString(),
        endTime: new Date('2026-02-01T01:00:00.000Z').toISOString(),
      }),
    ).rejects.toThrow('Operation not found');
  });
});
