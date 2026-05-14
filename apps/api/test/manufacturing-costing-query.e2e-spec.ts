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

const costingEngineService = {
  getCostLayers: jest.fn(async () => ({ items: [], total: 0 })),
  getCostVariances: jest.fn(async () => ({ items: [], total: 0 })),
  getRevaluationHistory: jest.fn(async () => ({ items: [], total: 0 })),
  getPlannedCOGS: jest.fn(async () => ({ items: [], summary: { totalRevenue: 0, totalPlannedCOGS: 0, contributionMargin: 0, marginPct: 0 } })),
  getCostProfiles: jest.fn(async () => []),
};

describe('ManufacturingController Costing Query Validation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ManufacturingController],
      providers: [
        { provide: ManufacturingService, useValue: {} },
        { provide: InventoryLedgerService, useValue: {} },
        { provide: AccountingService, useValue: {} },
        { provide: QualityService, useValue: {} },
        { provide: CostingService, useValue: {} },
        { provide: CostingEngineService, useValue: costingEngineService },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request & { user?: any }, _res: Response, next: NextFunction) => {
      req.user = { tenantId: 'tenant-1', id: 'user-1' };
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

  it('rejects invalid cost-layer take lower bound', async () => {
    await request(app.getHttpServer())
      .get('/manufacturing/costing-engine/cost-layers?take=0')
      .expect(400);
  });

  it('rejects invalid cost-layer take upper bound', async () => {
    await request(app.getHttpServer())
      .get('/manufacturing/costing-engine/cost-layers?take=201')
      .expect(400);
  });

  it('rejects invalid UUID in variances query', async () => {
    await request(app.getHttpServer())
      .get('/manufacturing/costing-engine/variances?referenceId=not-a-uuid')
      .expect(400);
  });

  it('rejects planned COGS with endDate before startDate', async () => {
    await request(app.getHttpServer())
      .get('/manufacturing/costing-engine/planned-cogs?startDate=2026-02-10&endDate=2026-02-01')
      .expect(400);
  });

  it('rejects invalid UUID in cost profiles query', async () => {
    await request(app.getHttpServer())
      .get('/manufacturing/costing-engine/cost-profiles?locationId=bad-uuid')
      .expect(400);
  });

  it('accepts valid planned COGS range and forwards tenant context', async () => {
    await request(app.getHttpServer())
      .get('/manufacturing/costing-engine/planned-cogs?startDate=2026-01-01&endDate=2026-12-31')
      .expect(200);

    expect(costingEngineService.getPlannedCOGS).toHaveBeenCalledTimes(1);
    expect((costingEngineService.getPlannedCOGS as any).mock.calls[0][0]).toBe('tenant-1');
  });
});
