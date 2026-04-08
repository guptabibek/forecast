import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inventoryService } from './inventory.service';

const { get, post, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock('./client', () => ({
  apiClient: {
    get,
    post,
    delete: del,
  },
}));

describe('inventoryService optional location routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses path endpoint when locationId is provided for getCurrentLevel', async () => {
    const level = { id: 'l1', productId: 'p1', locationId: 'loc1' };
    get.mockResolvedValueOnce({ data: level });

    const result = await inventoryService.getCurrentLevel('p1', 'loc1');

    expect(get).toHaveBeenCalledWith('/manufacturing/inventory/levels/p1/loc1');
    expect(result).toEqual(level);
  });

  it('uses query endpoint when locationId is missing for getCurrentLevel', async () => {
    get.mockResolvedValueOnce({ data: { items: [{ id: 'l1' }] } });

    const result = await inventoryService.getCurrentLevel('p1');

    expect(get).toHaveBeenCalledWith('/manufacturing/inventory/levels', {
      params: {
        productId: 'p1',
        page: 1,
        pageSize: 1,
      },
    });
    expect(result).toEqual({ id: 'l1' });
  });

  it('uses path endpoint when locationId is provided for getLevelHistory', async () => {
    const level = { id: 'l1', productId: 'p1', locationId: 'loc1' };
    get.mockResolvedValueOnce({ data: level });

    const result = await inventoryService.getLevelHistory('p1', 'loc1');

    expect(get).toHaveBeenCalledWith('/manufacturing/inventory/levels/p1/loc1');
    expect(result).toEqual([level]);
  });

  it('uses query endpoint when locationId is missing for getLevelHistory', async () => {
    const items = [{ id: 'l1' }, { id: 'l2' }];
    get.mockResolvedValueOnce({ data: { items } });

    const result = await inventoryService.getLevelHistory('p1');

    expect(get).toHaveBeenCalledWith('/manufacturing/inventory/levels', {
      params: {
        productId: 'p1',
      },
    });
    expect(result).toEqual(items);
  });
});
