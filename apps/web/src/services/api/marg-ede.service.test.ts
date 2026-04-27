import { beforeEach, describe, expect, it, vi } from 'vitest';
import { margEdeService } from './marg-ede.service';

const { get, post, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('./client', () => ({
  apiClient: {
    get,
    post,
    patch,
    delete: del,
  },
}));

describe('margEdeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes configId when fetching reconciliation results', async () => {
    get.mockResolvedValueOnce({ data: [] });

    await margEdeService.getReconciliationResults({ configId: 'config-1', take: 10 });

    expect(get).toHaveBeenCalledWith('/marg-ede/reconciliation-results', {
      params: { configId: 'config-1', take: 10 },
    });
  });

  it('requests staged account groups with pagination params', async () => {
    get.mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 25 },
    });

    await margEdeService.getStagedAccountGroups({ page: 1, pageSize: 25 });

    expect(get).toHaveBeenCalledWith('/marg-ede/staged/account-groups', {
      params: { page: 1, pageSize: 25 },
    });
  });

  it('requests accounting-only sync through the dedicated endpoint', async () => {
    post.mockResolvedValueOnce({
      data: { status: 'queued', message: 'queued', scope: 'accounting' },
    });

    await margEdeService.triggerAccountingSync('config-1', { fromDate: '2026-04-01' });

    expect(post).toHaveBeenCalledWith('/marg-ede/configs/config-1/sync/accounting', undefined, {
      params: { fromDate: '2026-04-01' },
    });
  });
});