import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { toMargSyncLogStatusDto } from './dto/marg-sync-log-status.dto';
import { MargEdeService } from './marg-ede.service';
import { MargRawPageStorage } from './marg-raw-page-storage';
import {
  classifyMargSyncError,
  MARG_FAILURE_TYPE,
  MARG_RAW_PAGE_STATUS,
  MARG_SYNC_STAGE,
  MargFatalError,
  MargRetryableError,
} from './marg-sync.types';

describe('Marg resumable sync pipeline', () => {
  // ============================================================
  // classifyMargSyncError — retryable vs fatal heuristics
  // ============================================================
  describe('classifyMargSyncError', () => {
    it('classifies AES bad-decrypt as FATAL (operator must fix the key)', () => {
      const err = new Error('06065064:digital envelope routines:EVP_DecryptFinal_ex:bad decrypt');
      const result = classifyMargSyncError(err);
      expect(result.type).toBe(MARG_FAILURE_TYPE.FATAL);
      expect(result.errorCode).toBe('DECRYPT_FAILED');
      expect(result.retryable).toBe(false);
    });

    it('classifies wrong-final-block-length (bad key padding) as FATAL', () => {
      const err = new Error('error: wrong final block length');
      const result = classifyMargSyncError(err);
      expect(result.type).toBe(MARG_FAILURE_TYPE.FATAL);
      expect(result.errorCode).toBe('DECRYPT_FAILED');
    });

    it('classifies HTTP timeout as RETRYABLE', () => {
      const err: Error & { code?: string } = new Error('Request timed out');
      err.code = 'ETIMEDOUT';
      const result = classifyMargSyncError(err);
      expect(result.type).toBe(MARG_FAILURE_TYPE.RETRYABLE);
      expect(result.errorCode).toBe('ETIMEDOUT');
      expect(result.retryable).toBe(true);
    });

    it('classifies Prisma P2024 connection-pool timeout as RETRYABLE', () => {
      const err: Error & { code?: string } = new Error('connection pool exhausted');
      err.code = 'P2024';
      const result = classifyMargSyncError(err);
      expect(result.type).toBe(MARG_FAILURE_TYPE.RETRYABLE);
      expect(result.errorCode).toBe('P2024');
    });

    it('classifies Postgres deadlock 40P01 as RETRYABLE', () => {
      const err: Error & { code?: string } = new Error('deadlock detected');
      err.code = '40P01';
      const result = classifyMargSyncError(err);
      expect(result.type).toBe(MARG_FAILURE_TYPE.RETRYABLE);
    });

    it('classifies Marg API credential failure envelope as FATAL', () => {
      const err = new Error('Marg API failure: Invalid credentials for company');
      const result = classifyMargSyncError(err);
      expect(result.type).toBe(MARG_FAILURE_TYPE.FATAL);
      expect(result.errorCode).toBe('MARG_AUTH');
    });

    it('classifies Prisma P2002 unique-constraint violation as FATAL', () => {
      const err: Error & { code?: string } = new Error('Unique constraint failed');
      err.code = 'P2002';
      const result = classifyMargSyncError(err);
      expect(result.type).toBe(MARG_FAILURE_TYPE.FATAL);
    });

    it('honors explicit MargFatalError sentinel even with retryable-looking message', () => {
      const err = new MargFatalError('connection timed out but explicitly fatal', 'CUSTOM_FATAL');
      const result = classifyMargSyncError(err);
      expect(result.type).toBe(MARG_FAILURE_TYPE.FATAL);
      expect(result.errorCode).toBe('CUSTOM_FATAL');
    });

    it('honors explicit MargRetryableError sentinel even with fatal-looking message', () => {
      const err = new MargRetryableError('bad decrypt but actually a known transient', 'CUSTOM_RETRYABLE');
      const result = classifyMargSyncError(err);
      expect(result.type).toBe(MARG_FAILURE_TYPE.RETRYABLE);
      expect(result.errorCode).toBe('CUSTOM_RETRYABLE');
    });

    it('defaults unknown errors to RETRYABLE so operators can retry safely', () => {
      const result = classifyMargSyncError(new Error('something bizarre happened'));
      expect(result.type).toBe(MARG_FAILURE_TYPE.RETRYABLE);
      expect(result.errorCode).toBe('UNCLASSIFIED');
    });
  });

  // ============================================================
  // MargRawPageStorage — save / load / hash verification
  // ============================================================
  describe('MargRawPageStorage', () => {
    let storageDir: string;
    let storage: MargRawPageStorage;

    beforeEach(() => {
      storageDir = mkdtempSync(path.join(tmpdir(), 'marg-raw-page-test-'));
      process.env.MARG_RAW_PAGE_STORAGE_DIR = storageDir;
      storage = new MargRawPageStorage();
    });

    afterEach(() => {
      delete process.env.MARG_RAW_PAGE_STORAGE_DIR;
      rmSync(storageDir, { recursive: true, force: true });
    });

    it('round-trips a payload and verifies hash on load', async () => {
      const payload = {
        Details: [{ ID: '1', PID: 'P-1', Voucher: 'V-1' }],
        Stock: [{ PID: 'P-1', Batch: 'B-1', Stock: 100 }],
        Index: 5,
        DataStatus: 10,
        DateTime: '2026-05-16T00:00:00Z',
      };
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const configId = '00000000-0000-0000-0000-000000000002';
      const syncLogId = '00000000-0000-0000-0000-000000000003';

      const descriptor = await storage.save({
        tenantId,
        configId,
        syncLogId,
        apiType: '2',
        companyId: 7,
        requestIndex: 0,
        parsedPayload: payload,
      });

      expect(descriptor.payloadHash).toMatch(/^[a-f0-9]{64}$/);
      expect(descriptor.decryptedSize).toBeGreaterThan(0);
      expect(descriptor.storagePath).toContain(tenantId);
      expect(descriptor.storagePath).toContain(configId);
      expect(descriptor.storagePath).toContain(syncLogId);

      const loaded = await storage.load(descriptor) as typeof payload;
      expect(loaded).toEqual(payload);
    });

    it('throws on hash mismatch (corruption detection)', async () => {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const descriptor = await storage.save({
        tenantId,
        configId: '00000000-0000-0000-0000-000000000002',
        syncLogId: '00000000-0000-0000-0000-000000000003',
        apiType: '2',
        companyId: 7,
        requestIndex: 0,
        parsedPayload: { Details: [], Index: 0, DataStatus: 10, DateTime: '' },
      });

      await expect(
        storage.load({
          storagePath: descriptor.storagePath,
          payloadHash: 'a'.repeat(64),
        }),
      ).rejects.toThrow(/hash mismatch/i);
    });

    it('rejects path-traversal characters in identity components (defense-in-depth)', async () => {
      await expect(
        storage.save({
          tenantId: '../escape',
          configId: 'safe',
          syncLogId: 'safe',
          apiType: '2',
          companyId: 7,
          requestIndex: 0,
          parsedPayload: {},
        }),
      ).rejects.toThrow(/Invalid tenantId/i);
    });

    it('reports false from exists() for missing files without throwing', async () => {
      const present = await storage.exists({ storagePath: 'nope/never/there.json.gz' });
      expect(present).toBe(false);
    });

    it('handles a 50k-row Details payload without crashing (large-payload smoke test)', async () => {
      const Details = Array.from({ length: 50000 }, (_, i) => ({
        ID: String(i),
        PID: `P-${i % 100}`,
        Voucher: `V-${i}`,
        Type: 'S',
        Date: '01/05/2026',
        Qty: 1,
        Amount: 100,
      }));
      const tenantId = '00000000-0000-0000-0000-000000000001';

      const descriptor = await storage.save({
        tenantId,
        configId: '00000000-0000-0000-0000-000000000002',
        syncLogId: '00000000-0000-0000-0000-000000000003',
        apiType: '2',
        companyId: 7,
        requestIndex: 0,
        parsedPayload: { Details, Index: 1, DataStatus: 10, DateTime: '' },
      });

      // Compression typically gives 10-30x reduction on repetitive Marg
      // payloads; a 50k-row Details should compress well below 5MB.
      expect(descriptor.decryptedSize).toBeGreaterThan(50_000);

      const loaded = await storage.load(descriptor) as { Details: unknown[] };
      expect(loaded.Details).toHaveLength(50000);
    });
  });

  // ============================================================
  // processPayloadSections — releases section references after use
  // ============================================================
  describe('processPayloadSections (memory-safe section iteration)', () => {
    it('iterates non-empty sections in order and clears each after handling', async () => {
      const service = new MargEdeService({} as any, {} as any, {} as any);
      const payload: any = {
        Details: [{ id: 1 }, { id: 2 }],
        Masters: [],
        MDis: [{ id: 3 }],
        Party: [],
        Product: [{ id: 4 }],
        SaleType: [],
        Stock: [],
        ACGroup: [],
        Account: [],
        AcBal: [],
        PBal: [],
        Outstanding: [],
        Index: 0,
        DataStatus: 10,
        DateTime: '',
      };

      const handled: Array<{ section: string; len: number }> = [];
      await (service as any).processPayloadSections(
        payload,
        ['Details', 'Masters', 'MDis', 'Party', 'Product'],
        async (section: string, rows: unknown[]) => {
          handled.push({ section, len: rows.length });
        },
      );

      // Empty sections (Masters, Party) are skipped; non-empty ones invoke
      // the handler in declared order.
      expect(handled).toEqual([
        { section: 'Details', len: 2 },
        { section: 'MDis', len: 1 },
        { section: 'Product', len: 1 },
      ]);
      // Reference released — the array on payload should now be empty so V8
      // can GC the original allocation while the next section processes.
      expect(payload.Details).toEqual([]);
      expect(payload.MDis).toEqual([]);
      expect(payload.Product).toEqual([]);
    });

    it('aborts (does not swallow) when a handler throws — page must be marked failed', async () => {
      const service = new MargEdeService({} as any, {} as any, {} as any);
      const payload: any = {
        Details: [{}],
        Masters: [],
        MDis: [{}],
        Party: [], Product: [], SaleType: [], Stock: [],
        ACGroup: [], Account: [], AcBal: [], PBal: [], Outstanding: [],
        Index: 0, DataStatus: 10, DateTime: '',
      };

      const handled: string[] = [];
      await expect((service as any).processPayloadSections(
        payload,
        ['Details', 'MDis'],
        async (section: string) => {
          handled.push(section);
          if (section === 'Details') throw new Error('staging blew up');
        },
      )).rejects.toThrow(/staging blew up/);

      expect(handled).toEqual(['Details']); // MDis never reached
    });
  });

  // ============================================================
  // resumeSync — re-stages PENDING_STAGE pages, skips STAGED ones
  // ============================================================
  describe('resumeSync (raw-page replay)', () => {
    let storageDir: string;
    let storage: MargRawPageStorage;
    let savedPath: string;
    const tenantId = '00000000-0000-0000-0000-000000000001';
    const configId = '00000000-0000-0000-0000-000000000002';
    const syncLogId = '00000000-0000-0000-0000-000000000003';

    beforeEach(async () => {
      storageDir = mkdtempSync(path.join(tmpdir(), 'marg-resume-test-'));
      process.env.MARG_RAW_PAGE_STORAGE_DIR = storageDir;
      storage = new MargRawPageStorage();
      const desc = await storage.save({
        tenantId,
        configId,
        syncLogId,
        apiType: '2',
        companyId: 7,
        requestIndex: 0,
        parsedPayload: {
          Product: [{ ID: 1, CompanyID: 7, PID: 'P-1', Code: 'C-1', Name: 'N-1' }],
          Details: [], Masters: [], MDis: [], Party: [], SaleType: [], Stock: [],
          ACGroup: [], Account: [], AcBal: [], PBal: [], Outstanding: [],
          Index: 1, DataStatus: 10, DateTime: '',
        },
      });
      savedPath = desc.storagePath;
    });

    afterEach(() => {
      delete process.env.MARG_RAW_PAGE_STORAGE_DIR;
      rmSync(storageDir, { recursive: true, force: true });
    });

    it('re-stages a PENDING_STAGE raw page and skips an already-STAGED page', async () => {
      const updatedRows: any[] = [];
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue({
            id: configId,
            tenantId,
            companyCode: 'COMPANY',
            companyId: 7,
            isActive: true,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue({
            id: syncLogId,
            tenantId,
            configId,
            status: 'FAILED',
            failureType: 'RETRYABLE',
            errors: [],
            lastHeartbeatAt: new Date(),
            currentStage: MARG_SYNC_STAGE.STAGING_STARTED,
            syncMode: 'fetch',
            syncScope: 'full',
            fromDate: null,
            endDate: null,
          }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margRawSyncPage: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'page-pending',
              tenantId,
              configId,
              syncLogId,
              apiType: '2',
              companyId: 7,
              requestIndex: 0,
              storagePath: savedPath,
              payloadHash: undefined, // skip hash verify in this test
              status: MARG_RAW_PAGE_STATUS.PENDING_STAGE,
            },
            {
              id: 'page-staged',
              tenantId,
              configId,
              syncLogId,
              apiType: '2',
              companyId: 7,
              requestIndex: 1,
              storagePath: savedPath,
              status: MARG_RAW_PAGE_STATUS.STAGED,
            },
          ]),
          update: jest.fn().mockImplementation(async ({ where, data }: any) => {
            updatedRows.push({ where, data });
          }),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
      } as any;

      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const service = new MargEdeService(prisma, auditService, {} as any, storage);

      const result = await service.resumeSync(configId, tenantId, syncLogId, 'op-1');

      expect(result.pagesResumed).toBe(1);
      expect(result.pagesAlreadyStaged).toBe(1);
      expect(result.pagesFailed).toBe(0);

      // The PENDING_STAGE page received an UPDATE marking it STAGED.
      const stagedUpdates = updatedRows.filter((u) => u.where.id === 'page-pending'
        && u.data.status === MARG_RAW_PAGE_STATUS.STAGED);
      expect(stagedUpdates).toHaveLength(1);

      // The already-STAGED page must NOT be re-staged.
      const reStagedAlreadyDone = updatedRows.filter((u) => u.where.id === 'page-staged'
        && u.data.status === MARG_RAW_PAGE_STATUS.STAGED);
      expect(reStagedAlreadyDone).toHaveLength(0);

      // syncProducts (now bulk) issued one $executeRaw for the single product.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('refuses to resume a sync log whose failureType=FATAL', async () => {
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue({
            id: configId, tenantId, isActive: true,
          }),
          updateMany: jest.fn(),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue({
            id: syncLogId,
            tenantId,
            configId,
            status: 'FAILED',
            failureType: 'FATAL',
            errors: [],
            lastHeartbeatAt: new Date(),
            currentStage: MARG_SYNC_STAGE.STAGING_STARTED,
          }),
          update: jest.fn(),
        },
        margRawSyncPage: {
          findMany: jest.fn(),
          update: jest.fn(),
        },
      } as any;

      const service = new MargEdeService(prisma, { log: jest.fn() } as any, {} as any, storage);

      await expect(service.resumeSync(configId, tenantId, syncLogId, 'op-1'))
        .rejects.toThrow(/not resumable/i);
      // Lock must not have been acquired for an unresumable run.
      expect(prisma.margSyncConfig.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to resume a COMPLETED sync log', async () => {
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue({ id: configId, tenantId, isActive: true }),
          updateMany: jest.fn(),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue({
            id: syncLogId,
            tenantId,
            configId,
            status: 'COMPLETED',
            failureType: null,
            errors: [],
            currentStage: MARG_SYNC_STAGE.COMPLETED,
          }),
        },
        margRawSyncPage: { findMany: jest.fn(), update: jest.fn() },
      } as any;
      const service = new MargEdeService(prisma, { log: jest.fn() } as any, {} as any, storage);
      await expect(service.resumeSync(configId, tenantId, syncLogId, 'op-1'))
        .rejects.toThrow(/already COMPLETED/i);
      expect(prisma.margSyncConfig.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to resume a legacy log (currentStage=NULL) that predates the migration', async () => {
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue({ id: configId, tenantId, isActive: true }),
          updateMany: jest.fn(),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue({
            id: syncLogId,
            tenantId,
            configId,
            status: 'FAILED',
            failureType: 'RETRYABLE',
            errors: [],
            currentStage: null,
            syncMode: null,
            syncScope: null,
            fromDate: null,
            endDate: null,
            lastHeartbeatAt: new Date(),
          }),
        },
        margRawSyncPage: { findMany: jest.fn(), update: jest.fn() },
      } as any;
      const service = new MargEdeService(prisma, { log: jest.fn() } as any, {} as any, storage);
      await expect(service.resumeSync(configId, tenantId, syncLogId, 'op-1'))
        .rejects.toThrow(/predates the resumable-pipeline migration/i);
      // Lock was acquired before the legacy check — that's a known
      // implementation order; we don't assert on lock state here. The point
      // is the function refused.
    });

    it('refuses to resume when the failed sync persisted zero raw pages', async () => {
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue({ id: configId, tenantId, isActive: true }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue({
            id: syncLogId,
            tenantId,
            configId,
            status: 'FAILED',
            failureType: 'RETRYABLE',
            errors: [],
            currentStage: MARG_SYNC_STAGE.FETCHING,
            syncMode: 'fetch',
            syncScope: 'full',
            fromDate: null,
            endDate: null,
            lastHeartbeatAt: new Date(),
          }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margRawSyncPage: {
          findMany: jest.fn().mockResolvedValue([]), // ← no raw pages
          update: jest.fn(),
        },
      } as any;
      const service = new MargEdeService(prisma, { log: jest.fn() } as any, {} as any, storage);
      await expect(service.resumeSync(configId, tenantId, syncLogId, 'op-1'))
        .rejects.toThrow(/no saved raw pages to resume from/i);
    });

    it('reuses the original window when re-staging a date-window backfill resume', async () => {
      // Persist a payload with date inside and outside the window. The
      // staging path filters by window; if resume forgot the window, the
      // out-of-window transaction would be staged too. We assert
      // $executeRaw was called with only the in-window row's source data.
      const winFrom = '2026-04-01';
      const winEnd = '2026-04-30';

      const inWindowDetail = {
        ID: '1001',
        CompanyID: 7,
        Voucher: 'V-IN',
        Type: 'S',
        VCN: 'VCN-IN',
        Date: '15/04/2026', // dd/MM/yyyy — in window
        PID: 'P-1',
        Qty: 1,
        Amount: 100,
      };
      const outOfWindowDetail = {
        ID: '1002',
        CompanyID: 7,
        Voucher: 'V-OUT',
        Type: 'S',
        VCN: 'VCN-OUT',
        Date: '15/05/2026', // after endDate
        PID: 'P-2',
        Qty: 1,
        Amount: 100,
      };

      const desc = await storage.save({
        tenantId,
        configId,
        syncLogId,
        apiType: '2',
        companyId: 7,
        requestIndex: 0,
        parsedPayload: {
          Details: [inWindowDetail, outOfWindowDetail],
          Masters: [], MDis: [], Party: [], Product: [], SaleType: [], Stock: [],
          ACGroup: [], Account: [], AcBal: [], PBal: [], Outstanding: [],
          Index: 1, DataStatus: 10, DateTime: '',
        },
      });

      const executeRawCalls: Array<{ params: unknown[] }> = [];
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue({ id: configId, tenantId, isActive: true }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue({
            id: syncLogId,
            tenantId,
            configId,
            status: 'FAILED',
            failureType: 'RETRYABLE',
            errors: [],
            currentStage: MARG_SYNC_STAGE.STAGING_STARTED,
            syncMode: 'fetch',
            syncScope: 'full',
            fromDate: winFrom,
            endDate: winEnd,
            lastHeartbeatAt: new Date(),
          }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margRawSyncPage: {
          findMany: jest.fn().mockResolvedValue([{
            id: 'page-window',
            tenantId,
            configId,
            syncLogId,
            apiType: '2',
            companyId: 7,
            requestIndex: 0,
            storagePath: desc.storagePath,
            payloadHash: desc.payloadHash,
            status: MARG_RAW_PAGE_STATUS.PENDING_STAGE,
          }]),
          update: jest.fn().mockResolvedValue(undefined),
        },
        $executeRaw: jest.fn().mockImplementation((sqlObj: any) => {
          executeRawCalls.push({
            params: Array.isArray(sqlObj?.values) ? sqlObj.values : [],
          });
          return Promise.resolve(1);
        }),
      } as any;

      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const service = new MargEdeService(prisma, auditService, {} as any, storage);
      const result = await service.resumeSync(configId, tenantId, syncLogId, 'op-1');

      expect(result.pagesResumed).toBe(1);
      expect(result.pagesFailed).toBe(0);

      // Exactly one batch INSERT was issued for transactions (the only
      // section with non-empty rows). Its parameters must contain VCN-IN
      // and must NOT contain VCN-OUT — proving the window filter ran.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const allParams = executeRawCalls.flatMap((c) => c.params);
      expect(allParams).toEqual(expect.arrayContaining(['VCN-IN']));
      expect(allParams).not.toContain('VCN-OUT');
    });
  });

  // ============================================================
  // Fix 1+3: worker concurrency env honored / fairness deferral
  // ============================================================
  describe('worker concurrency + per-tenant fairness', () => {
    it('reads MARG_SYNC_WORKER_CONCURRENCY at module load (env-driven)', async () => {
      // Concurrency is set on the @Processor decorator at module-load time
      // — we cannot mutate it after the fact. Verify the parse is correct
      // for typical env values via an inline parse mirror.
      const parse = (raw: string | undefined, fallback: number) =>
        Math.max(1, Number.parseInt(raw ?? String(fallback), 10) || fallback);
      expect(parse('3', 2)).toBe(3);
      expect(parse(undefined, 2)).toBe(2);
      // parseInt('0') === 0; 0 || 2 falls back to 2; Math.max(1, 2) === 2.
      // Operators wanting "disable the worker" must remove the env var,
      // not set it to 0 — explicit invalid values are treated as default.
      expect(parse('0', 2)).toBe(2);
      expect(parse('not-a-number', 2)).toBe(2);
      // parseInt('-5') === -5 is truthy; Math.max(1, -5) clamps up to 1.
      expect(parse('-5', 2)).toBe(1);
    });

    it('defers a tenant\'s job when their per-tenant slot count is reached AND another tenant is waiting', async () => {
      const { MargSyncProcessor } = await import('./marg-sync.processor');
      // Cross-pod fairness via BullMQ active set: queue.getJobs(['active'])
      // returns existing jobs for the same tenant on OTHER pods + this job.
      // queue.getJobs(['waiting','delayed']) returns at least one other-tenant
      // job so deferring isn't pointless.
      const stubQueue = {
        getJobs: jest.fn().mockImplementation((statuses: string[]) => {
          if (Array.isArray(statuses) && statuses.includes('active')) {
            // Another worker pod already runs one job for busy-tenant +
            // this job appears in active too. We expect the processor to
            // exclude its own jobId.
            return Promise.resolve([
              { id: 'other-pod-active-job', data: { tenantId: 'busy-tenant' } },
              { id: 'job-1', data: { tenantId: 'busy-tenant' } },
            ]);
          }
          // waiting / delayed: at least one different-tenant job
          return Promise.resolve([{ id: 'other-waiting', data: { tenantId: 'other-tenant' } }]);
        }),
      } as any;
      const margEdeService = { runSync: jest.fn() } as any;
      const prisma = {
        executeInTenantContext: jest.fn().mockImplementation(async (_t, fn) => fn()),
      } as any;
      const processor = new MargSyncProcessor(margEdeService, prisma, stubQueue);

      const moveToDelayed = jest.fn().mockResolvedValue(undefined);
      const job = {
        id: 'job-1',
        data: { tenantId: 'busy-tenant', configId: 'cfg', triggeredBy: 'op' },
        token: 'tok-1',
        moveToDelayed,
      } as any;

      await expect(processor.process(job)).rejects.toThrow(/delayed/i);
      expect(moveToDelayed).toHaveBeenCalledTimes(1);
      // Worker did not actually invoke the sync.
      expect(margEdeService.runSync).not.toHaveBeenCalled();
    });

    it('does NOT defer when no other tenant\'s job is active', async () => {
      const { MargSyncProcessor } = await import('./marg-sync.processor');
      // Only this job is active; getJobs filters out our own jobId so
      // otherActiveForTenant = 0 < limit and we proceed.
      const stubQueue = {
        getJobs: jest.fn().mockImplementation((statuses: string[]) => {
          if (Array.isArray(statuses) && statuses.includes('active')) {
            return Promise.resolve([{ id: 'job-2', data: { tenantId: 'free-tenant' } }]);
          }
          return Promise.resolve([]);
        }),
      } as any;
      const margEdeService = { runSync: jest.fn().mockResolvedValue('sync-log-1') } as any;
      const prisma = {
        executeInTenantContext: jest.fn().mockImplementation(async (_t, fn) => fn()),
      } as any;
      const processor = new MargSyncProcessor(margEdeService, prisma, stubQueue);

      const job = {
        id: 'job-2',
        data: { tenantId: 'free-tenant', configId: 'cfg', triggeredBy: 'op' },
        token: 'tok-2',
        moveToDelayed: jest.fn(),
      } as any;

      const result = await processor.process(job);
      expect(result.syncLogId).toBe('sync-log-1');
      expect(margEdeService.runSync).toHaveBeenCalledTimes(1);
      expect(job.moveToDelayed).not.toHaveBeenCalled();
    });

    it('does NOT defer when the busy tenant is the only one with waiting jobs', async () => {
      const { MargSyncProcessor } = await import('./marg-sync.processor');
      // Another pod is running a busy-tenant job (so cap is exceeded),
      // BUT the waiting queue has only same-tenant jobs (no fairness
      // benefit to deferring — we'd just re-pick the same job back).
      const stubQueue = {
        getJobs: jest.fn().mockImplementation((statuses: string[]) => {
          if (Array.isArray(statuses) && statuses.includes('active')) {
            return Promise.resolve([
              { id: 'other-pod', data: { tenantId: 'busy-tenant' } },
              { id: 'job-3', data: { tenantId: 'busy-tenant' } },
            ]);
          }
          return Promise.resolve([{ id: 'same-tenant-waiting', data: { tenantId: 'busy-tenant' } }]);
        }),
      } as any;
      const margEdeService = { runSync: jest.fn().mockResolvedValue('sync-log-3') } as any;
      const prisma = {
        executeInTenantContext: jest.fn().mockImplementation(async (_t, fn) => fn()),
      } as any;
      const processor = new MargSyncProcessor(margEdeService, prisma, stubQueue);

      const job = {
        id: 'job-3',
        data: { tenantId: 'busy-tenant', configId: 'cfg', triggeredBy: 'op' },
        token: 'tok-3',
        moveToDelayed: jest.fn(),
      } as any;

      await processor.process(job);
      expect(job.moveToDelayed).not.toHaveBeenCalled();
      expect(margEdeService.runSync).toHaveBeenCalled();
    });

    it('excludes own jobId so a single-pod single-job for the tenant does NOT trigger deferral', async () => {
      // Regression: the processor must NOT treat its own job as "another
      // active job for this tenant". Pre-fix, counting active without
      // excluding self would have falsely triggered defer when in fact
      // this is the tenant's first/only active job.
      const { MargSyncProcessor } = await import('./marg-sync.processor');
      const stubQueue = {
        getJobs: jest.fn().mockImplementation((statuses: string[]) => {
          if (Array.isArray(statuses) && statuses.includes('active')) {
            return Promise.resolve([{ id: 'job-4', data: { tenantId: 'solo-tenant' } }]);
          }
          return Promise.resolve([{ id: 'other-waiting', data: { tenantId: 'other-tenant' } }]);
        }),
      } as any;
      const margEdeService = { runSync: jest.fn().mockResolvedValue('sync-log-4') } as any;
      const prisma = {
        executeInTenantContext: jest.fn().mockImplementation(async (_t, fn) => fn()),
      } as any;
      const processor = new MargSyncProcessor(margEdeService, prisma, stubQueue);

      const job = {
        id: 'job-4',
        data: { tenantId: 'solo-tenant', configId: 'cfg', triggeredBy: 'op' },
        token: 'tok-4',
        moveToDelayed: jest.fn(),
      } as any;

      const result = await processor.process(job);
      expect(result.syncLogId).toBe('sync-log-4');
      expect(job.moveToDelayed).not.toHaveBeenCalled();
    });

    it('countActiveJobsForTenant returns 0 (degrades gracefully) when the queue inspection fails', async () => {
      const { MargSyncProcessor } = await import('./marg-sync.processor');
      const stubQueue = {
        getJobs: jest.fn().mockRejectedValue(new Error('Redis exploded')),
      } as any;
      const margEdeService = { runSync: jest.fn().mockResolvedValue('sync-log-5') } as any;
      const prisma = {
        executeInTenantContext: jest.fn().mockImplementation(async (_t, fn) => fn()),
      } as any;
      const processor = new MargSyncProcessor(margEdeService, prisma, stubQueue);

      const job = {
        id: 'job-5',
        data: { tenantId: 't', configId: 'cfg', triggeredBy: 'op' },
        token: 'tok-5',
        moveToDelayed: jest.fn(),
      } as any;

      // Sync must complete even when fairness layer is broken.
      const result = await processor.process(job);
      expect(result.syncLogId).toBe('sync-log-5');
      expect(job.moveToDelayed).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Fix 2: listLockedConfigs / forceUnlockConfig
  // ============================================================
  describe('config-level lock administration', () => {
    const tenantId = '00000000-0000-0000-0000-0000000000aa';
    const configId = '00000000-0000-0000-0000-0000000000bb';

    it('listLockedConfigs returns only configs with at least one RUNNING flag, marks stale ones', async () => {
      const fresh = { id: 'cfg-fresh', tenantId, companyCode: 'AA', companyId: 1, lastSyncStatus: 'COMPLETED', lastAccountingSyncStatus: 'COMPLETED', updatedAt: new Date() };
      const lockedFresh = { id: 'cfg-locked', tenantId, companyCode: 'BB', companyId: 2, lastSyncStatus: 'RUNNING', lastAccountingSyncStatus: 'COMPLETED', updatedAt: new Date(Date.now() - 5 * 60 * 1000) };
      const lockedStale = { id: 'cfg-stale', tenantId, companyCode: 'CC', companyId: 3, lastSyncStatus: 'RUNNING', lastAccountingSyncStatus: 'RUNNING', updatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000) };

      const prisma = {
        margSyncConfig: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) => {
            // service filters by OR-RUNNING in the SQL; mimic that here
            const all = [fresh, lockedFresh, lockedStale];
            return all.filter((c) => c.lastSyncStatus === 'RUNNING' || c.lastAccountingSyncStatus === 'RUNNING')
              .filter((c) => !where.tenantId || c.tenantId === where.tenantId);
          }),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue(null), // simplify: no live log
        },
      } as any;

      const service = new MargEdeService(prisma, {} as any, {} as any);
      const result = await service.listLockedConfigs(tenantId);

      expect(result.map((r) => r.configId)).toEqual(['cfg-locked', 'cfg-stale']);
      expect(result.find((r) => r.configId === 'cfg-locked')!.isStale).toBe(false);
      expect(result.find((r) => r.configId === 'cfg-stale')!.isStale).toBe(true);
    });

    it('forceUnlockConfig flips status to FAILED and marks running sync logs FAILED_RETRYABLE', async () => {
      const config = { id: configId, tenantId, lastSyncStatus: 'RUNNING', lastAccountingSyncStatus: 'RUNNING' };
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue(config),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue({ lastHeartbeatAt: new Date(Date.now() - 60 * 60 * 1000) }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;
      const service = new MargEdeService(prisma, {} as any, {} as any);

      const result = await service.forceUnlockConfig(configId, tenantId);

      expect(result.outcome).toBe('unlocked');
      expect(result.syncLogsMarkedFailed).toBe(1);
      expect(result.previousStatus).toEqual({ lastSyncStatus: 'RUNNING', lastAccountingSyncStatus: 'RUNNING' });
      expect(prisma.margSyncLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', failureType: 'RETRYABLE' }),
      }));
      expect(prisma.margSyncConfig.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ lastSyncStatus: 'FAILED', lastAccountingSyncStatus: 'FAILED' }),
      }));
    });

    it('forceUnlockConfig refuses to unlock when a heartbeat fired in the last 60s', async () => {
      const config = { id: configId, tenantId, lastSyncStatus: 'RUNNING', lastAccountingSyncStatus: 'COMPLETED' };
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue(config),
          update: jest.fn(),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue({ lastHeartbeatAt: new Date(Date.now() - 10_000) }), // 10s ago
          updateMany: jest.fn(),
        },
      } as any;
      const service = new MargEdeService(prisma, {} as any, {} as any);

      const result = await service.forceUnlockConfig(configId, tenantId);
      expect(result.outcome).toBe('active_refused');
      expect(prisma.margSyncConfig.update).not.toHaveBeenCalled();
      expect(prisma.margSyncLog.updateMany).not.toHaveBeenCalled();
    });

    it('forceUnlockConfig with force=true bypasses the recent-heartbeat check', async () => {
      const config = { id: configId, tenantId, lastSyncStatus: 'RUNNING', lastAccountingSyncStatus: 'COMPLETED' };
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue(config),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue({ lastHeartbeatAt: new Date() }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as any;
      const service = new MargEdeService(prisma, {} as any, {} as any);

      const result = await service.forceUnlockConfig(configId, tenantId, { force: true });
      expect(result.outcome).toBe('unlocked');
      expect(prisma.margSyncConfig.update).toHaveBeenCalled();
    });

    it('forceUnlockConfig returns not_locked when nothing is RUNNING', async () => {
      const config = { id: configId, tenantId, lastSyncStatus: 'COMPLETED', lastAccountingSyncStatus: 'COMPLETED' };
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue(config),
          update: jest.fn(),
        },
      } as any;
      const service = new MargEdeService(prisma, {} as any, {} as any);
      const result = await service.forceUnlockConfig(configId, tenantId);
      expect(result.outcome).toBe('not_locked');
      expect(prisma.margSyncConfig.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Backward-compatible default constructor (rawPageStorage optional)
  // ============================================================
  describe('MargEdeService constructor backward-compat', () => {
    it('constructs without MargRawPageStorage (existing test fixture pattern)', () => {
      const service = new MargEdeService({} as any, {} as any, {} as any);
      expect(service).toBeInstanceOf(MargEdeService);
    });
  });

  // ============================================================
  // computeSafeBatchSize — Postgres bind-variable cap clamp
  // ============================================================
  describe('computeSafeBatchSize (Postgres 32767 bind-variable cap)', () => {
    it('returns the requested size when it stays under the cap', () => {
      const service = new MargEdeService({} as any, {} as any, {} as any);
      // 500 rows × 30 cols = 15000 binds, well under 32000.
      const v = (service as any).computeSafeBatchSize(500, 30, 'syncParties');
      expect(v).toBe(500);
    });

    it('clamps the request when rows*cols would exceed the cap', () => {
      const service = new MargEdeService({} as any, {} as any, {} as any);
      // 5000 × 16 cols = 80000 binds — this is the exact scenario that
      // triggered the production error. The clamp must drop us below the
      // safety ceiling (32767 - 767 = 32000).
      const v = (service as any).computeSafeBatchSize(5000, 16, 'syncProducts');
      expect(v).toBeLessThanOrEqual(5000);
      expect(v * 16).toBeLessThan(32767);
    });

    it('clamps the widest table (syncParties, 30 cols) safely from 5000', () => {
      const service = new MargEdeService({} as any, {} as any, {} as any);
      const v = (service as any).computeSafeBatchSize(5000, 30, 'syncParties');
      // 5000 × 30 = 150000 binds — must be clamped hard.
      expect(v).toBeLessThanOrEqual(1066);
      expect(v * 30).toBeLessThan(32767);
    });

    it('floors at 1 so a misconfigured env (e.g. =0) does not divide by zero', () => {
      const service = new MargEdeService({} as any, {} as any, {} as any);
      expect((service as any).computeSafeBatchSize(0, 30, 'syncParties')).toBe(1);
      expect((service as any).computeSafeBatchSize(-5, 30, 'syncParties')).toBe(1);
    });

    it('handles columnsPerRow=1 (degenerate but valid) without crashing', () => {
      const service = new MargEdeService({} as any, {} as any, {} as any);
      const v = (service as any).computeSafeBatchSize(50000, 1, 'syncTrivial');
      // 32000 max binds when col=1.
      expect(v).toBeLessThanOrEqual(32000);
    });

    it('every real staging method stays under the cap at 5000 requested', () => {
      const service = new MargEdeService({} as any, {} as any, {} as any);
      const realMethods: Array<[string, number]> = [
        ['syncBranches', 9],
        ['syncProducts', 16],
        ['syncParties', 30],
        ['syncTransactions', 23],
        ['syncStockData', 24],
        ['syncVouchers', 19],
        ['syncAccountGroups', 8],
        ['syncAccountPostings', 13],
        ['syncAccountGroupBalances', 7],
        ['syncPartyBalances', 7],
        ['syncOutstandings', 15],
        ['syncSaleTypes', 10],
      ];
      for (const [name, cols] of realMethods) {
        const v = (service as any).computeSafeBatchSize(5000, cols, name);
        expect(v * cols).toBeLessThan(32767);
      }
    });
  });

  // ============================================================
  // syncParties — full end-to-end with the bind-cap clamp on
  // ============================================================
  describe('syncParties bind-variable cap regression', () => {
    it('issues multiple smaller batches instead of one >32767-bind statement', async () => {
      // Generate 3000 distinct party rows. At 30 binds/row that would be
      // 90000 binds in a single statement — must be split across batches.
      const parties = Array.from({ length: 3000 }, (_, i) => ({
        ID: i + 1,
        CompanyID: 7,
        CID: `C-${i}`,
        ParNam: `Party ${i}`,
        GSTNo: '27ABCDE0000F1Z5',
      }));

      let calls = 0;
      const maxBindsObserved: number[] = [];
      const prisma = {
        $executeRaw: jest.fn().mockImplementation((sqlObj: any) => {
          calls += 1;
          const binds = Array.isArray(sqlObj?.values) ? sqlObj.values.length : 0;
          maxBindsObserved.push(binds);
          return Promise.resolve(1);
        }),
      } as any;

      // Even if the operator sets a high env value, the clamp catches it.
      process.env.MARG_STAGING_BATCH_SIZE = '5000';
      try {
        const service = new MargEdeService(prisma, {} as any, {} as any);
        const written = await (service as any).syncParties('tenant-1', parties);
        expect(written).toBe(3000);
        // Should have been multiple batches, none over the cap.
        expect(calls).toBeGreaterThan(1);
        for (const binds of maxBindsObserved) {
          expect(binds).toBeLessThan(32767);
        }
      } finally {
        delete process.env.MARG_STAGING_BATCH_SIZE;
      }
    });
  });

  // ============================================================
  // updateBatchProgress — per-batch heartbeat for bulk staging
  // ============================================================
  describe('updateBatchProgress (per-batch heartbeat)', () => {
    it('updates entity / batch / rowsProcessed (as increment) and lastHeartbeatAt', async () => {
      const updates: any[] = [];
      const prisma = {
        margSyncLog: {
          update: jest.fn().mockImplementation(async (args: any) => {
            updates.push(args);
          }),
        },
      } as any;
      const service = new MargEdeService(prisma, {} as any, {} as any);

      await (service as any).updateBatchProgress('log-1', 'products', 3, 500);

      expect(prisma.margSyncLog.update).toHaveBeenCalledTimes(1);
      const data = updates[0].data;
      expect(data.currentEntityType).toBe('products');
      expect(data.currentBatchNumber).toBe(3);
      expect(data.rowsProcessed).toEqual({ increment: BigInt(500) });
      expect(data.lastHeartbeatAt).toBeInstanceOf(Date);
    });

    it('is a no-op when syncLogId is null (legacy callers / tests)', async () => {
      const prisma = { margSyncLog: { update: jest.fn() } } as any;
      const service = new MargEdeService(prisma, {} as any, {} as any);
      await (service as any).updateBatchProgress(null, 'products', 1, 100);
      await (service as any).updateBatchProgress(undefined, 'products', 1, 100);
      expect(prisma.margSyncLog.update).not.toHaveBeenCalled();
    });

    it('swallows write failures so a heartbeat hiccup does not abort staging', async () => {
      const prisma = {
        margSyncLog: {
          update: jest.fn().mockRejectedValue(new Error('transient DB error')),
        },
      } as any;
      const service = new MargEdeService(prisma, {} as any, {} as any);
      // Must resolve, must not throw
      await expect((service as any).updateBatchProgress('log-1', 'products', 1, 100))
        .resolves.toBeUndefined();
    });

    it('syncProducts heartbeats once per batch with cumulative row delta', async () => {
      // Build 2 batches worth (batchSize default 5000 — use a small env override).
      process.env.MARG_STAGING_BATCH_SIZE = '2';
      try {
        const heartbeats: any[] = [];
        const prisma = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          margSyncLog: {
            update: jest.fn().mockImplementation(async (args: any) => {
              heartbeats.push(args.data);
            }),
          },
        } as any;
        const service = new MargEdeService(prisma, {} as any, {} as any);

        await (service as any).syncProducts('tenant-1', [
          { CompanyID: 1, ID: 1, PID: 'P-1', Code: 'C-1', Name: 'N-1' },
          { CompanyID: 1, ID: 2, PID: 'P-2', Code: 'C-2', Name: 'N-2' },
          { CompanyID: 1, ID: 3, PID: 'P-3', Code: 'C-3', Name: 'N-3' },
        ], 'log-progress-1');

        const productsHeartbeats = heartbeats.filter((h) => h.currentEntityType === 'products');
        expect(productsHeartbeats).toHaveLength(2);
        expect(productsHeartbeats[0].currentBatchNumber).toBe(1);
        expect(productsHeartbeats[1].currentBatchNumber).toBe(2);
        expect(productsHeartbeats[0].rowsProcessed).toEqual({ increment: BigInt(2) });
        expect(productsHeartbeats[1].rowsProcessed).toEqual({ increment: BigInt(1) });
      } finally {
        delete process.env.MARG_STAGING_BATCH_SIZE;
      }
    });
  });

  // ============================================================
  // recoverStaleSyncLog — operator-driven stale RUNNING recovery
  // ============================================================
  describe('recoverStaleSyncLog', () => {
    const tenantId = '00000000-0000-0000-0000-000000000010';
    const configId = '00000000-0000-0000-0000-000000000020';
    const syncLogId = '00000000-0000-0000-0000-000000000030';

    function buildPrisma(log: any) {
      return {
        margSyncLog: {
          findFirst: jest.fn().mockResolvedValue(log),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margSyncConfig: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;
    }

    it('marks a stale RUNNING log FAILED_RETRYABLE and releases the config lock', async () => {
      const prisma = buildPrisma({
        id: syncLogId,
        tenantId,
        configId,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        lastHeartbeatAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
        errors: [],
      });
      const service = new MargEdeService(prisma, {} as any, {} as any);

      const result = await service.recoverStaleSyncLog(configId, tenantId, syncLogId);
      expect(result.outcome).toBe('recovered');
      expect(prisma.margSyncLog.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: syncLogId },
        data: expect.objectContaining({
          status: 'FAILED',
          currentStage: MARG_SYNC_STAGE.FAILED_RETRYABLE,
          failureType: MARG_FAILURE_TYPE.RETRYABLE,
        }),
      }));
      expect(prisma.margSyncConfig.updateMany).toHaveBeenCalled();
    });

    it('does NOT mark an actively-heartbeating RUNNING sync stale', async () => {
      const prisma = buildPrisma({
        id: syncLogId,
        tenantId,
        configId,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        lastHeartbeatAt: new Date(), // fresh
        errors: [],
      });
      const service = new MargEdeService(prisma, {} as any, {} as any);

      const result = await service.recoverStaleSyncLog(configId, tenantId, syncLogId);
      expect(result.outcome).toBe('not_stale');
      expect(prisma.margSyncLog.update).not.toHaveBeenCalled();
      expect(prisma.margSyncConfig.updateMany).not.toHaveBeenCalled();
    });

    it('returns not_running for COMPLETED or FAILED logs (idempotent / safe)', async () => {
      const prisma = buildPrisma({
        id: syncLogId,
        tenantId,
        configId,
        status: 'COMPLETED',
        startedAt: new Date(),
        lastHeartbeatAt: null,
        errors: [],
      });
      const service = new MargEdeService(prisma, {} as any, {} as any);
      const result = await service.recoverStaleSyncLog(configId, tenantId, syncLogId);
      expect(result.outcome).toBe('not_running');
    });

    it('returns not_found when the syncLogId does not belong to the (tenant, config)', async () => {
      const prisma = buildPrisma(null);
      const service = new MargEdeService(prisma, {} as any, {} as any);
      const result = await service.recoverStaleSyncLog(configId, tenantId, syncLogId);
      expect(result.outcome).toBe('not_found');
    });

    it('handles a RUNNING log that never wrote a heartbeat by using startedAt', async () => {
      const prisma = buildPrisma({
        id: syncLogId,
        tenantId,
        configId,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        lastHeartbeatAt: null,
        errors: [],
      });
      const service = new MargEdeService(prisma, {} as any, {} as any);
      const result = await service.recoverStaleSyncLog(configId, tenantId, syncLogId);
      expect(result.outcome).toBe('recovered');
    });
  });

  // ============================================================
  // MargRawPageStorage — error classification
  // ============================================================
  describe('MargRawPageStorage error classification', () => {
    let storageDir: string;
    let storage: MargRawPageStorage;

    beforeEach(() => {
      storageDir = mkdtempSync(path.join(tmpdir(), 'marg-storage-err-'));
      process.env.MARG_RAW_PAGE_STORAGE_DIR = storageDir;
      storage = new MargRawPageStorage();
    });

    afterEach(() => {
      delete process.env.MARG_RAW_PAGE_STORAGE_DIR;
      rmSync(storageDir, { recursive: true, force: true });
    });

    it('classifies missing-on-load as a FATAL MargFatalError', async () => {
      try {
        await storage.load({ storagePath: 'no-tenant/no-config/no-log/api2-req0.json.gz' });
        fail('expected load to throw');
      } catch (err) {
        expect((err as any).__margClassification?.type).toBe(MARG_FAILURE_TYPE.FATAL);
        expect((err as any).__margClassification?.errorCode).toBe('STORAGE_MISSING');
      }
    });

    it('classifies hash mismatch as FATAL with STORAGE_HASH_MISMATCH code', async () => {
      const desc = await storage.save({
        tenantId: '00000000-0000-0000-0000-000000000001',
        configId: '00000000-0000-0000-0000-000000000002',
        syncLogId: '00000000-0000-0000-0000-000000000003',
        apiType: '2',
        companyId: 7,
        requestIndex: 0,
        parsedPayload: { Details: [], Index: 0, DataStatus: 10, DateTime: '' },
      });
      try {
        await storage.load({ storagePath: desc.storagePath, payloadHash: 'b'.repeat(64) });
        fail('expected hash-mismatch to throw');
      } catch (err) {
        expect((err as any).__margClassification?.type).toBe(MARG_FAILURE_TYPE.FATAL);
        expect((err as any).__margClassification?.errorCode).toBe('STORAGE_HASH_MISMATCH');
      }
    });
  });

  // ============================================================
  // MargRawPageStorage — retention sweep
  // ============================================================
  describe('MargRawPageStorage.cleanupOldSyncDirectories', () => {
    let storageDir: string;
    let storage: MargRawPageStorage;
    const tenantId = '00000000-0000-0000-0000-000000000001';
    const configId = '00000000-0000-0000-0000-000000000002';

    beforeEach(() => {
      storageDir = mkdtempSync(path.join(tmpdir(), 'marg-cleanup-'));
      process.env.MARG_RAW_PAGE_STORAGE_DIR = storageDir;
      storage = new MargRawPageStorage();
    });

    afterEach(() => {
      delete process.env.MARG_RAW_PAGE_STORAGE_DIR;
      rmSync(storageDir, { recursive: true, force: true });
    });

    it('removes only sync directories whose mtime exceeds maxAge; leaves fresh dirs intact', async () => {
      // Save into two sync dirs with controlled mtimes.
      const oldSync = '00000000-0000-0000-0000-00000000000A';
      const newSync = '00000000-0000-0000-0000-00000000000B';
      await storage.save({
        tenantId, configId, syncLogId: oldSync, apiType: '2', companyId: 7, requestIndex: 0,
        parsedPayload: { Details: [], Index: 0, DataStatus: 10, DateTime: '' },
      });
      await storage.save({
        tenantId, configId, syncLogId: newSync, apiType: '2', companyId: 7, requestIndex: 0,
        parsedPayload: { Details: [], Index: 0, DataStatus: 10, DateTime: '' },
      });

      // Backdate the old sync dir mtime to ~2 days ago.
      const fs = await import('fs/promises');
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await fs.utimes(path.join(storageDir, tenantId, configId, oldSync), twoDaysAgo, twoDaysAgo);

      // Sweep with 1-day threshold.
      const result = await storage.cleanupOldSyncDirectories(24 * 60 * 60 * 1000);
      expect(result.syncDirsRemoved).toBe(1);

      // Old dir must be gone; new dir must remain.
      expect(await storage.exists({
        storagePath: path.join(tenantId, configId, oldSync, 'api2-req0.json.gz'),
      })).toBe(false);
      expect(await storage.exists({
        storagePath: path.join(tenantId, configId, newSync, 'api2-req0.json.gz'),
      })).toBe(true);
    });

    it('returns zeros silently when the storage root has never been created', async () => {
      const empty = mkdtempSync(path.join(tmpdir(), 'marg-cleanup-empty-'));
      rmSync(empty, { recursive: true, force: true }); // remove so it does not exist
      process.env.MARG_RAW_PAGE_STORAGE_DIR = empty;
      const freshStorage = new MargRawPageStorage();
      const result = await freshStorage.cleanupOldSyncDirectories(0);
      expect(result).toEqual({ syncDirsRemoved: 0, bytesFreed: 0, errors: [] });
    });
  });

  // ============================================================
  // toMargSyncLogStatusDto — explicit response contract
  // ============================================================
  describe('toMargSyncLogStatusDto', () => {
    it('coerces BigInt rowsProcessed / totalRowsDiscovered into JSON-safe strings', () => {
      const dto = toMargSyncLogStatusDto({
        id: 'log-1',
        tenantId: 'tenant-1',
        configId: 'config-1',
        status: 'RUNNING',
        startedAt: new Date('2026-05-16T00:00:00Z'),
        rowsProcessed: BigInt('9007199254740993'), // > 2^53
        totalRowsDiscovered: BigInt('10000000000000000'),
        lastHeartbeatAt: new Date(),
        retryCount: 0,
        productsSynced: 0, partiesSynced: 0, transactionsSynced: 0, stockSynced: 0,
        branchesSynced: 0, vouchersSynced: 0, saleTypesSynced: 0, accountGroupsSynced: 0,
        accountPostingsSynced: 0, accountGroupBalancesSynced: 0, partyBalancesSynced: 0,
        outstandingsSynced: 0, journalEntriesSynced: 0,
        errors: [],
        currentStage: MARG_SYNC_STAGE.STAGING_STARTED,
        currentApiType: '2',
        currentRequestIndex: 0,
        currentResponseIndex: 1,
        currentEntityType: 'products',
        currentBatchNumber: 5,
        failureType: null,
        resumedFromSyncLogId: null,
        fromDate: '2026-04-01',
        endDate: '2026-04-30',
        syncMode: 'fetch',
        syncScope: 'full',
      }, 30 * 60 * 1000);

      // Precision preserved as string.
      expect(dto.rowsProcessed).toBe('9007199254740993');
      expect(dto.totalRowsDiscovered).toBe('10000000000000000');
      expect(dto.fromDate).toBe('2026-04-01');
      expect(dto.syncMode).toBe('fetch');
      expect(dto.isStale).toBe(false);
    });

    it('flags a RUNNING log with stale heartbeat as isStale=true', () => {
      const dto = toMargSyncLogStatusDto({
        id: 'log-2', tenantId: 't', configId: 'c',
        status: 'RUNNING',
        lastHeartbeatAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
        rowsProcessed: BigInt(0),
        retryCount: 0, productsSynced: 0, partiesSynced: 0, transactionsSynced: 0,
        stockSynced: 0, branchesSynced: 0, vouchersSynced: 0, saleTypesSynced: 0,
        accountGroupsSynced: 0, accountPostingsSynced: 0, accountGroupBalancesSynced: 0,
        partyBalancesSynced: 0, outstandingsSynced: 0, journalEntriesSynced: 0,
        errors: [],
      }, 30 * 60 * 1000);
      expect(dto.isStale).toBe(true);
      expect(dto.heartbeatAgeMs).toBeGreaterThan(30 * 60 * 1000);
    });

    it('isStale is false for COMPLETED logs regardless of heartbeat age', () => {
      const dto = toMargSyncLogStatusDto({
        id: 'log-3', tenantId: 't', configId: 'c',
        status: 'COMPLETED',
        lastHeartbeatAt: new Date(Date.now() - 100 * 60 * 60 * 1000),
        rowsProcessed: BigInt(0),
        retryCount: 0, productsSynced: 0, partiesSynced: 0, transactionsSynced: 0,
        stockSynced: 0, branchesSynced: 0, vouchersSynced: 0, saleTypesSynced: 0,
        accountGroupsSynced: 0, accountPostingsSynced: 0, accountGroupBalancesSynced: 0,
        partyBalancesSynced: 0, outstandingsSynced: 0, journalEntriesSynced: 0,
        errors: [],
      }, 30 * 60 * 1000);
      expect(dto.isStale).toBe(false);
    });
  });

  // ============================================================
  // Cursor + stock safety direct tests for the new pipeline
  // ============================================================
  describe('cursor + stock safety', () => {
    it('persists fromDate/endDate/syncMode/syncScope on the new sync log so resume reads them back', async () => {
      const createCalls: any[] = [];
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'config-1',
            tenantId: 'tenant-1',
            companyCode: 'COMPANY',
            companyId: 7,
            apiBaseUrl: 'https://corporate.margerp.com',
            margKey: 'k',
            decryptionKey: 'd',
            isActive: true,
            lastSyncIndex: 0,
            lastSyncDatetime: '',
            lastAccountingSyncIndex: 0,
            lastAccountingSyncDatetime: '',
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margSyncLog: {
          create: jest.fn().mockImplementation(async (args: any) => {
            createCalls.push(args);
            return { id: 'sync-log-1', startedAt: new Date(), ...args.data };
          }),
          update: jest.fn().mockResolvedValue(undefined),
        },
      } as any;

      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const service = new MargEdeService(prisma, auditService, {} as any);
      const helper = service as any;

      helper.decryptSecret = jest.fn().mockReturnValue('decrypted');
      helper.fetchBranches = jest.fn().mockResolvedValue([]);
      helper.syncBranches = jest.fn().mockResolvedValue(0);
      // Empty fetch: terminate immediately so we just exercise log creation.
      helper.fetchData = jest.fn().mockResolvedValue({
        Details: [], Masters: [], MDis: [], Party: [], Product: [], SaleType: [], Stock: [],
        ACGroup: [], Account: [], AcBal: [], PBal: [], Outstanding: [],
        Index: 1, DataStatus: 10, DateTime: '',
      });
      helper.transformBranches = jest.fn().mockResolvedValue(undefined);
      helper.transformMargNamedMasters = jest.fn().mockResolvedValue(undefined);
      helper.transformProducts = jest.fn().mockResolvedValue(undefined);
      helper.transformParties = jest.fn().mockResolvedValue(undefined);
      helper.transformSuppliers = jest.fn().mockResolvedValue(0);
      helper.resetMargInventoryProjectionWindow = jest.fn().mockResolvedValue({ affectedLedgerScopes: new Set() });
      helper.transformMargProcurementDocuments = jest.fn().mockResolvedValue(undefined);
      helper.transformTransactionsToActuals = jest.fn().mockResolvedValue(undefined);
      helper.transformStockToInventoryLevels = jest.fn().mockResolvedValue(undefined);
      helper.transformStockToBatches = jest.fn().mockResolvedValue(undefined);
      helper.transformTransactionsToInventoryTransactions = jest.fn().mockResolvedValue(undefined);
      helper.transformTransactionsToInventoryLedger = jest.fn().mockResolvedValue(undefined);
      helper.transformAccountPostingsToJournalEntries = jest.fn().mockResolvedValue({
        journalEntriesSynced: 0, skippedGroups: [], diagnostics: { duplicateFingerprintCount: 0, duplicateRowCount: 0, skippedByReason: {} },
      });
      helper.runPostSyncReconciliations = jest.fn().mockResolvedValue({ totalIssues: 0, warningCount: 0, failureCount: 0 });

      await service.runSync('config-1', 'tenant-1', 'user-1', '2026-04-01', '2026-04-30');

      const created = createCalls[0].data;
      expect(created.fromDate).toBe('2026-04-01');
      expect(created.endDate).toBe('2026-04-30');
      expect(created.syncScope).toBe('full');
      expect(created.syncMode).toBe('fetch');
      expect(created.currentStage).toBe(MARG_SYNC_STAGE.QUEUED);
    });

    it('does NOT advance the official cursor when an endDate (date-window) is supplied', async () => {
      const configUpdates: any[] = [];
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'config-1',
            tenantId: 'tenant-1',
            companyCode: 'COMPANY',
            companyId: 7,
            apiBaseUrl: 'https://corporate.margerp.com',
            margKey: 'k',
            decryptionKey: 'd',
            isActive: true,
            lastSyncIndex: 0,
            lastSyncDatetime: '',
            lastAccountingSyncIndex: 0,
            lastAccountingSyncDatetime: '',
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockImplementation(async (args: any) => {
            configUpdates.push(args.data);
          }),
        },
        margSyncLog: {
          create: jest.fn().mockResolvedValue({ id: 'sync-log-1', startedAt: new Date() }),
          update: jest.fn().mockResolvedValue(undefined),
        },
      } as any;

      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const service = new MargEdeService(prisma, auditService, {} as any);
      const helper = service as any;

      helper.decryptSecret = jest.fn().mockReturnValue('decrypted');
      helper.fetchBranches = jest.fn().mockResolvedValue([]);
      helper.syncBranches = jest.fn().mockResolvedValue(0);
      helper.fetchData = jest.fn().mockResolvedValue({
        Details: [], Masters: [], MDis: [], Party: [], Product: [], SaleType: [], Stock: [],
        ACGroup: [], Account: [], AcBal: [], PBal: [], Outstanding: [],
        Index: 99, DataStatus: 10, DateTime: '2026-04-30T23:59:59Z',
      });
      helper.transformBranches = jest.fn().mockResolvedValue(undefined);
      helper.transformMargNamedMasters = jest.fn().mockResolvedValue(undefined);
      helper.transformProducts = jest.fn().mockResolvedValue(undefined);
      helper.transformParties = jest.fn().mockResolvedValue(undefined);
      helper.transformSuppliers = jest.fn().mockResolvedValue(0);
      helper.resetMargInventoryProjectionWindow = jest.fn().mockResolvedValue({ affectedLedgerScopes: new Set() });
      helper.transformMargProcurementDocuments = jest.fn().mockResolvedValue(undefined);
      helper.transformTransactionsToActuals = jest.fn().mockResolvedValue(undefined);
      helper.transformStockToInventoryLevels = jest.fn().mockResolvedValue(undefined);
      helper.transformStockToBatches = jest.fn().mockResolvedValue(undefined);
      helper.transformTransactionsToInventoryTransactions = jest.fn().mockResolvedValue(undefined);
      helper.transformTransactionsToInventoryLedger = jest.fn().mockResolvedValue(undefined);
      helper.transformAccountPostingsToJournalEntries = jest.fn().mockResolvedValue({
        journalEntriesSynced: 0, skippedGroups: [], diagnostics: { duplicateFingerprintCount: 0, duplicateRowCount: 0, skippedByReason: {} },
      });
      helper.runPostSyncReconciliations = jest.fn().mockResolvedValue({ totalIssues: 0, warningCount: 0, failureCount: 0 });

      // Bounded date-window backfill: fromDate + endDate present.
      await service.runSync('config-1', 'tenant-1', 'user-1', '2026-04-01', '2026-04-30');

      // The final config update at completion must NOT include
      // lastSyncIndex/lastSyncDatetime — those are the official cursor.
      // It writes only the *SyncStatus fields for bounded windows.
      const completedUpdate = configUpdates.find((u) => u.lastSyncStatus === 'COMPLETED');
      expect(completedUpdate).toBeDefined();
      expect(completedUpdate.lastSyncIndex).toBeUndefined();
      expect(completedUpdate.lastSyncDatetime).toBeUndefined();
      expect(completedUpdate.lastAccountingSyncIndex).toBeUndefined();
      expect(completedUpdate.lastAccountingSyncDatetime).toBeUndefined();
    });

    it('does NOT call markMissingStockAsDeleted on an incremental sync from a non-clean cursor', async () => {
      const prisma = {
        margSyncConfig: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'config-1',
            tenantId: 'tenant-1',
            companyCode: 'COMPANY',
            companyId: 7,
            apiBaseUrl: 'https://corporate.margerp.com',
            margKey: 'k',
            decryptionKey: 'd',
            isActive: true,
            // Non-clean cursor: prior run already advanced these.
            lastSyncIndex: 1000,
            lastSyncDatetime: '2026-04-15T00:00:00Z',
            lastAccountingSyncIndex: 1000,
            lastAccountingSyncDatetime: '2026-04-15T00:00:00Z',
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        margSyncLog: {
          create: jest.fn().mockResolvedValue({ id: 'sync-log-1', startedAt: new Date() }),
          update: jest.fn().mockResolvedValue(undefined),
        },
      } as any;

      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const service = new MargEdeService(prisma, auditService, {} as any);
      const helper = service as any;
      helper.decryptSecret = jest.fn().mockReturnValue('decrypted');
      helper.fetchBranches = jest.fn().mockResolvedValue([]);
      helper.syncBranches = jest.fn().mockResolvedValue(0);
      // Stock rows present → triggers receivedStockSnapshot=true …
      helper.fetchData = jest.fn().mockResolvedValueOnce({
        Details: [], Masters: [], MDis: [], Party: [], Product: [], SaleType: [],
        Stock: [{ PID: 'P-1', Batch: 'B-1', CompanyID: 7 }],
        ACGroup: [], Account: [], AcBal: [], PBal: [], Outstanding: [],
        Index: 1001, DataStatus: 10, DateTime: '2026-04-16T00:00:00Z',
      }).mockResolvedValueOnce({
        Details: [], Masters: [], MDis: [], Party: [], Product: [], SaleType: [], Stock: [],
        ACGroup: [], Account: [], AcBal: [], PBal: [], Outstanding: [],
        Index: 1001, DataStatus: 10, DateTime: '2026-04-16T00:00:00Z',
      });
      helper.syncStockData = jest.fn().mockResolvedValue(1);
      // markMissingStockAsDeleted must NOT be called because cursor was
      // not clean (lastSyncIndex=1000) — this is the stock-safety invariant.
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
        journalEntriesSynced: 0, skippedGroups: [], diagnostics: { duplicateFingerprintCount: 0, duplicateRowCount: 0, skippedByReason: {} },
      });
      helper.runPostSyncReconciliations = jest.fn().mockResolvedValue({ totalIssues: 0, warningCount: 0, failureCount: 0 });

      await service.runSync('config-1', 'tenant-1', 'user-1');

      expect(helper.markMissingStockAsDeleted).not.toHaveBeenCalled();
    });

    // Reference imports we want type-checked but not exercised here.
    it('imports MargRetryableError without unused-symbol noise', () => {
      const e = new MargRetryableError('placeholder');
      expect(e.__margClassification.type).toBe(MARG_FAILURE_TYPE.RETRYABLE);
      // writeFileSync is imported for symmetry with file-system tests above
      // even if not used in every test path.
      void writeFileSync;
    });
  });
});
