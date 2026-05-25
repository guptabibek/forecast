import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiReportingService } from './ai-reporting.service';

const { get, post } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('./client', () => ({
  apiClient: { get, post },
}));

describe('aiReportingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts NLQ report questions to the production AI reporting endpoint', async () => {
    post.mockResolvedValueOnce({ data: { status: 'success', rows: [] } });

    const result = await aiReportingService.query({ question: 'Show top selling products this month', outputMode: 'auto', includeSummary: true });

    expect(post).toHaveBeenCalledWith('/ai-reporting/query', {
      question: 'Show top selling products this month',
      outputMode: 'auto',
      includeSummary: true,
    }, { timeout: 600000 });
    expect(result).toEqual({ status: 'success', rows: [] });
  });

  it('posts dashboard requests to the dashboard endpoint', async () => {
    post.mockResolvedValueOnce({ data: { status: 'success', widgets: [] } });

    await aiReportingService.dashboard({ question: 'Generate sales dashboard for this month', includeSummary: true });

    expect(post).toHaveBeenCalledWith('/ai-reporting/dashboard', {
      question: 'Generate sales dashboard for this month',
      includeSummary: true,
    }, { timeout: 600000 });
  });

  it('loads safe catalog metadata and history through authenticated API client', async () => {
    get.mockResolvedValueOnce({ data: { catalogVersion: '1.0' } });
    get.mockResolvedValueOnce({ data: [] });

    await expect(aiReportingService.catalog()).resolves.toEqual({ catalogVersion: '1.0' });
    await expect(aiReportingService.history(12)).resolves.toEqual([]);

    expect(get).toHaveBeenNthCalledWith(1, '/ai-reporting/catalog');
    expect(get).toHaveBeenNthCalledWith(2, '/ai-reporting/history', { params: { limit: 12 } });
  });
});
