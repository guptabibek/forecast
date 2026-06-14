import { InsightQueueService } from './insight-queue.service';

describe('InsightQueueService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  function build(withQueue: boolean) {
    const generation = {
      generateForTenant: jest.fn().mockResolvedValue({
        tenantId, providersRun: 3, providersFailed: 0, insightsUpserted: 2, insightsArchived: 0,
      }),
      listGeneratableTenantIds: jest.fn().mockResolvedValue(['t1', 't2', 't3']),
    } as any;
    const queue = withQueue
      ? ({ add: jest.fn().mockResolvedValue({ id: 'job-1' }) } as any)
      : undefined;
    const service = new InsightQueueService(generation, queue);
    return { service, generation, queue };
  }

  describe('with a queue (production)', () => {
    it('requestTenant enqueues and returns the job id without running generation inline', async () => {
      const { service, generation, queue } = build(true);
      const out = await service.requestTenant(tenantId);

      expect(queue.add).toHaveBeenCalledWith('generate-tenant', { tenantId, providerIds: null });
      expect(generation.generateForTenant).not.toHaveBeenCalled();
      expect(out).toEqual({ queued: true, jobId: 'job-1' });
    });

    it('requestTenant forwards providerIds', async () => {
      const { service, queue } = build(true);
      await service.requestTenant(tenantId, ['pinned-reports']);
      expect(queue.add).toHaveBeenCalledWith('generate-tenant', { tenantId, providerIds: ['pinned-reports'] });
    });

    it('enqueueAllTenants fans out one job per generatable tenant', async () => {
      const { service, queue } = build(true);
      const count = await service.enqueueAllTenants();
      expect(count).toBe(3);
      expect(queue.add).toHaveBeenCalledTimes(3);
    });

    it('enqueueDetached enqueues and never throws', async () => {
      const { service, queue, generation } = build(true);
      service.enqueueDetached(tenantId, ['pinned-reports']);
      expect(queue.add).toHaveBeenCalledWith('generate-tenant', { tenantId, providerIds: ['pinned-reports'] });
      expect(generation.generateForTenant).not.toHaveBeenCalled();
    });
  });

  describe('without a queue (no Redis → inline fallback)', () => {
    it('requestTenant runs generation inline and returns the result', async () => {
      const { service, generation } = build(false);
      const out = await service.requestTenant(tenantId);

      expect(generation.generateForTenant).toHaveBeenCalledWith(tenantId, undefined);
      expect(out.queued).toBe(false);
      expect(out.result?.providersRun).toBe(3);
    });

    it('enqueueAllTenants returns null so the caller runs the inline cycle', async () => {
      const { service } = build(false);
      expect(await service.enqueueAllTenants()).toBeNull();
    });

    it('enqueueDetached runs generation inline', async () => {
      const { service, generation } = build(false);
      service.enqueueDetached(tenantId);
      await Promise.resolve();
      expect(generation.generateForTenant).toHaveBeenCalledWith(tenantId, undefined);
    });
  });
});
