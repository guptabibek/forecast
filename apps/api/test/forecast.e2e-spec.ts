import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { ForecastsController } from '../src/modules/forecasts/forecasts.controller';
import { ForecastsService } from '../src/modules/forecasts/forecasts.service';

const forecastsService = {
  generateForecasts: jest.fn().mockResolvedValue({ status: 'queued', runs: [] }),
  requestOverride: jest.fn().mockResolvedValue({ id: 'override-1', status: 'PENDING' }),
  approveOverride: jest.fn().mockResolvedValue({ id: 'override-1', status: 'APPROVED' }),
  rejectOverride: jest.fn().mockResolvedValue({ id: 'override-1', status: 'REJECTED' }),
  reconcileForecastRun: jest.fn().mockResolvedValue({ forecastRunId: 'run-1', reconciled: 2 }),
  approveReconciliation: jest.fn().mockResolvedValue({ id: 'rec-1', status: 'APPROVED' }),
  rejectReconciliation: jest.fn().mockResolvedValue({ id: 'rec-1', status: 'REJECTED' }),
};

describe('ForecastsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ForecastsController],
      providers: [{ provide: ForecastsService, useValue: forecastsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('queues a forecast run', async () => {
    await request(app.getHttpServer())
      .post('/forecasts/generate')
      .send({ planVersionId: 'p1', scenarioId: 's1', models: ['HOLT_WINTERS'] })
      .expect(201);
  });

  it('requests an override', async () => {
    await request(app.getHttpServer())
      .post('/forecasts/overrides')
      .send({ forecastResultId: 'r1', overrideAmount: 1200, reason: 'Adjustment' })
      .expect(201);
  });

  it('approves an override', async () => {
    await request(app.getHttpServer())
      .post('/forecasts/overrides/00000000-0000-0000-0000-000000000001/approve')
      .send({ notes: 'ok' })
      .expect(201);
  });

  it('reconciles a forecast run', async () => {
    await request(app.getHttpServer())
      .post('/forecasts/reconcile')
      .send({ forecastRunId: 'run-1', thresholdPct: 5 })
      .expect(201);
  });

  it('approves a reconciliation', async () => {
    await request(app.getHttpServer())
      .post('/forecasts/reconciliations/00000000-0000-0000-0000-000000000002/approve')
      .send({ notes: 'ok' })
      .expect(201);
  });
});
