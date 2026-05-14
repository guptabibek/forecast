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
  startWorkflow: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000111', status: 'IN_PROGRESS' })),
  approveWorkflow: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000111', status: 'IN_PROGRESS' })),
  rejectWorkflow: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000111', status: 'REJECTED' })),
  requestWorkflowChanges: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000111', status: 'ON_HOLD' })),
  cancelWorkflow: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000111', status: 'CANCELLED' })),
  resubmitWorkflow: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000111', status: 'IN_PROGRESS' })),
  getWorkflowInstance: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000111' })),
  getWorkflowTemplates: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })),
  getWorkflowTemplate: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000121' })),
  createWorkflowTemplate: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000121' })),
  addWorkflowStep: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000131' })),
  updateWorkflowStep: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000131' })),
  deleteWorkflowStep: jest.fn(async () => ({ success: true })),
  updateWorkflowTemplate: jest.fn(async () => ({ id: '00000000-0000-0000-0000-000000000121' })),
  deleteWorkflowTemplate: jest.fn(async () => ({ success: true })),
  getWorkflowInstances: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })),
  getMyPendingApprovals: jest.fn(async () => []),
  getWorkflowMetrics: jest.fn(async () => ({ total: 0 })),
  getApproverWorkload: jest.fn(async () => ({ totalApprovers: 0 })),
};

describe('Manufacturing workflow endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ManufacturingController],
      providers: [
        { provide: ManufacturingService, useValue: manufacturingService },
        { provide: InventoryLedgerService, useValue: {} },
        { provide: AccountingService, useValue: {} },
        { provide: QualityService, useValue: {} },
        { provide: CostingService, useValue: {} },
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

  it('rejects invalid workflow instance UUID for approve endpoint', async () => {
    await request(app.getHttpServer())
      .post('/manufacturing/workflows/instances/not-a-uuid/approve')
      .send({ comments: 'ok' })
      .expect(400);
  });

  it('rejects start workflow with invalid entityId payload', async () => {
    await request(app.getHttpServer())
      .post('/manufacturing/workflows/instances')
      .send({ entityType: 'BOM', entityId: 'bad-id' })
      .expect(400);
  });

  it('forwards tenant and user context for workflow transitions', async () => {
    const workflowId = '00000000-0000-0000-0000-000000000111';

    await request(app.getHttpServer())
      .post(`/manufacturing/workflows/instances/${workflowId}/approve`)
      .send({ comments: 'approved' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/manufacturing/workflows/instances/${workflowId}/request-changes`)
      .send({ comments: 'fix needed' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/manufacturing/workflows/instances/${workflowId}/resubmit`)
      .send({ notes: 'resubmitted' })
      .expect(201);

    expect(manufacturingService.approveWorkflow).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      workflowId,
      '00000000-0000-0000-0000-000000000002',
      'approved',
    );
    expect(manufacturingService.requestWorkflowChanges).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      workflowId,
      '00000000-0000-0000-0000-000000000002',
      'fix needed',
    );
    expect(manufacturingService.resubmitWorkflow).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      workflowId,
      '00000000-0000-0000-0000-000000000002',
      'resubmitted',
    );
  });
});
