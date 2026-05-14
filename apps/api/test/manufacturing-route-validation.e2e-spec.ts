import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { PrismaService } from '../src/core/database/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { ManufacturingController } from '../src/modules/manufacturing/manufacturing.controller';
import { ManufacturingService } from '../src/modules/manufacturing/manufacturing.service';
import { AccountingService } from '../src/modules/manufacturing/services/accounting.service';
import { CostingEngineService } from '../src/modules/manufacturing/services/costing-engine.service';
import { CostingService } from '../src/modules/manufacturing/services/costing.service';
import { InventoryLedgerService } from '../src/modules/manufacturing/services/inventory-ledger.service';
import { QualityService } from '../src/modules/manufacturing/services/quality.service';

type TestUser = {
  tenantId: string;
  id: string;
  role: 'ADMIN';
};

const manufacturingService = {
  getPurchaseOrder: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000101' })),
  confirmGoodsReceipt: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000102', status: 'CONFIRMED' })),
  getWorkOrder: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000103' })),
  backflushMaterials: jest.fn(async () => []),
  getLaborEntriesForWorkOrder: jest.fn(async () => []),
  startOperation: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000104', status: 'IN_PROGRESS' })),
  completeOperation: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000104', status: 'COMPLETED' })),
  getMRPRun: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000105' })),
  executeMRPRun: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000105', status: 'COMPLETED' })),
  getPlannedOrder: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000106' })),
  acknowledgeMRPException: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000107', status: 'ACKNOWLEDGED' })),
  createSupplier: jest.fn(async (_tenantId: string, dto: any) => ({ id: '00000000-0000-0000-0000-000000000110', ...dto })),
  getSupplier: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000108' })),
  getSupplierProducts: jest.fn(async () => ({ items: [], total: 0 })),
  getProductSuppliers: jest.fn(async () => []),
};

const costingService = {
  aggregateWorkOrderActuals: jest.fn(async () => ({ success: true })),
  calculateVariance: jest.fn(async () => ({ success: true })),
};

describe('Manufacturing ID param validation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ManufacturingController],
      providers: [
        { provide: ManufacturingService, useValue: manufacturingService },
        { provide: InventoryLedgerService, useValue: {} },
        { provide: AccountingService, useValue: {} },
        { provide: QualityService, useValue: {} },
        { provide: CostingService, useValue: costingService },
        { provide: CostingEngineService, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request & { user?: TestUser }, _res: Response, next: NextFunction) => {
      req.user = {
        tenantId: '00000000-0000-0000-0000-000000000001',
        id: '00000000-0000-0000-0000-000000000002',
        role: 'ADMIN',
      };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects invalid UUID for purchase order detail endpoint', async () => {
    await request(app.getHttpServer()).get('/manufacturing/purchase-orders/not-a-uuid').expect(400);
    expect(manufacturingService.getPurchaseOrder).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for goods receipt confirm endpoint', async () => {
    await request(app.getHttpServer()).post('/manufacturing/goods-receipts/not-a-uuid/confirm').expect(400);
    expect(manufacturingService.confirmGoodsReceipt).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for work order detail endpoint', async () => {
    await request(app.getHttpServer()).get('/manufacturing/work-orders/not-a-uuid').expect(400);
    expect(manufacturingService.getWorkOrder).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for work order backflush endpoint', async () => {
    await request(app.getHttpServer())
      .post('/manufacturing/work-orders/not-a-uuid/backflush')
      .send({ completedQty: 1 })
      .expect(400);
    expect(manufacturingService.backflushMaterials).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for work order labor entries endpoint', async () => {
    await request(app.getHttpServer()).get('/manufacturing/work-orders/not-a-uuid/labor-entries').expect(400);
    expect(manufacturingService.getLaborEntriesForWorkOrder).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for work order aggregate costs endpoint', async () => {
    await request(app.getHttpServer()).post('/manufacturing/work-orders/not-a-uuid/aggregate-costs').expect(400);
    expect(costingService.aggregateWorkOrderActuals).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for work order calculate variance endpoint', async () => {
    await request(app.getHttpServer()).post('/manufacturing/work-orders/not-a-uuid/calculate-variance').expect(400);
    expect(costingService.calculateVariance).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for operation start endpoint', async () => {
    await request(app.getHttpServer()).post('/manufacturing/operations/not-a-uuid/start').expect(400);
    expect(manufacturingService.startOperation).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for operation complete endpoint', async () => {
    await request(app.getHttpServer())
      .post('/manufacturing/operations/not-a-uuid/complete')
      .send({ actualSetupTime: 1, actualRunTime: 2 })
      .expect(400);
    expect(manufacturingService.completeOperation).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for MRP run detail endpoint', async () => {
    await request(app.getHttpServer()).get('/manufacturing/mrp/runs/not-a-uuid').expect(400);
    expect(manufacturingService.getMRPRun).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for MRP run execute endpoint', async () => {
    await request(app.getHttpServer()).post('/manufacturing/mrp/runs/not-a-uuid/execute').expect(400);
    expect(manufacturingService.executeMRPRun).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for planned order detail endpoint', async () => {
    await request(app.getHttpServer()).get('/manufacturing/mrp/planned-orders/not-a-uuid').expect(400);
    expect(manufacturingService.getPlannedOrder).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for MRP exception acknowledge endpoint', async () => {
    await request(app.getHttpServer()).post('/manufacturing/mrp/exceptions/not-a-uuid/acknowledge').expect(400);
    expect(manufacturingService.acknowledgeMRPException).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for supplier detail endpoint', async () => {
    await request(app.getHttpServer()).get('/manufacturing/suppliers/not-a-uuid').expect(400);
    expect(manufacturingService.getSupplier).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for supplier products endpoint', async () => {
    await request(app.getHttpServer()).get('/manufacturing/suppliers/not-a-uuid/products').expect(400);
    expect(manufacturingService.getSupplierProducts).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for product suppliers endpoint', async () => {
    await request(app.getHttpServer()).get('/manufacturing/suppliers/products/not-a-uuid/suppliers').expect(400);
    expect(manufacturingService.getProductSuppliers).not.toHaveBeenCalled();
  });

  it('forwards valid UUID path params to service methods', async () => {
    const poId = '00000000-0000-0000-0000-000000000101';
    const grId = '00000000-0000-0000-0000-000000000102';
    const woId = '00000000-0000-0000-0000-000000000103';
    const opId = '00000000-0000-0000-0000-000000000104';
    const runId = '00000000-0000-0000-0000-000000000105';
    const plannedOrderId = '00000000-0000-0000-0000-000000000106';
    const exceptionId = '00000000-0000-0000-0000-000000000107';
    const supplierId = '00000000-0000-0000-0000-000000000108';
    const productId = '00000000-0000-0000-0000-000000000109';

    await request(app.getHttpServer()).get(`/manufacturing/purchase-orders/${poId}`).expect(200);
    await request(app.getHttpServer()).post(`/manufacturing/goods-receipts/${grId}/confirm`).expect(201);
    await request(app.getHttpServer()).get(`/manufacturing/work-orders/${woId}`).expect(200);
    await request(app.getHttpServer()).post(`/manufacturing/operations/${opId}/start`).expect(201);
    await request(app.getHttpServer())
      .post(`/manufacturing/operations/${opId}/complete`)
      .send({ actualSetupTime: 1, actualRunTime: 2 })
      .expect(201);
    await request(app.getHttpServer()).get(`/manufacturing/mrp/runs/${runId}`).expect(200);
    await request(app.getHttpServer()).post(`/manufacturing/mrp/runs/${runId}/execute`).expect(201);
    await request(app.getHttpServer()).get(`/manufacturing/mrp/planned-orders/${plannedOrderId}`).expect(200);
    await request(app.getHttpServer()).post(`/manufacturing/mrp/exceptions/${exceptionId}/acknowledge`).expect(201);
    await request(app.getHttpServer()).get(`/manufacturing/suppliers/${supplierId}`).expect(200);
    await request(app.getHttpServer()).get(`/manufacturing/suppliers/${supplierId}/products`).expect(200);
    await request(app.getHttpServer()).get(`/manufacturing/suppliers/products/${productId}/suppliers`).expect(200);

    expect(manufacturingService.getPurchaseOrder).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', poId);
    expect(manufacturingService.confirmGoodsReceipt).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', grId);
    expect(manufacturingService.getWorkOrder).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', woId);
    expect(manufacturingService.startOperation).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', opId);
    expect(manufacturingService.completeOperation).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      opId,
      expect.objectContaining({ actualSetupTime: 1, actualRunTime: 2 }),
    );
    expect(manufacturingService.getMRPRun).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', runId);
    expect(manufacturingService.executeMRPRun).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      runId,
      '00000000-0000-0000-0000-000000000002',
    );
    expect(manufacturingService.getPlannedOrder).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', plannedOrderId);
    expect(manufacturingService.acknowledgeMRPException).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      exceptionId,
      '00000000-0000-0000-0000-000000000002',
    );
    expect(manufacturingService.getSupplier).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', supplierId);
    expect(manufacturingService.getSupplierProducts).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      supplierId,
      expect.any(Object),
    );
    expect(manufacturingService.getProductSuppliers).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', productId);
  });

  it('accepts supplier create payload with lead-time and minimum-order fields', async () => {
    await request(app.getHttpServer())
      .post('/manufacturing/suppliers')
      .send({
        code: 'SUP-001',
        name: 'Acme Components',
        paymentTerms: 'NET30',
        defaultLeadTimeDays: 14,
        minimumOrderValue: 2500,
      })
      .expect(201);

    expect(manufacturingService.createSupplier).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      expect.objectContaining({
        code: 'SUP-001',
        name: 'Acme Components',
        defaultLeadTimeDays: 14,
        minimumOrderValue: 2500,
      }),
    );
  });
});
