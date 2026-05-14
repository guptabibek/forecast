import { describe, expect, it, vi } from 'vitest';
import { forecastService } from './forecast.service';

vi.mock('./client', () => {
  return {
    apiClient: {
      post: vi.fn().mockResolvedValue({ data: { status: 'queued', runs: [] } }),
      get: vi.fn().mockResolvedValue({ data: [] }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    },
  };
});

describe('forecastService', () => {
  it('calls generate endpoint', async () => {
    const result = await forecastService.generate({
      planVersionId: 'p1',
      scenarioId: 's1',
      models: ['MOVING_AVERAGE'],
    });

    expect(result).toEqual({ status: 'queued', runs: [] });
  });
});
