import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authService } from './auth.service';

const { post, get, del } = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}));

vi.mock('./client', () => ({
  api: {
    post,
    get,
    delete: del,
  },
}));

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps tenantSubdomain to tenantSlug during registration', async () => {
    post.mockResolvedValueOnce({ accessToken: 'token' });

    await authService.register({
      tenantName: 'Acme',
      tenantSubdomain: 'acme',
      email: 'admin@acme.com',
      password: 'SecurePass123!',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    expect(post).toHaveBeenCalledWith('/auth/register', {
      tenantName: 'Acme',
      email: 'admin@acme.com',
      password: 'SecurePass123!',
      firstName: 'Ada',
      lastName: 'Lovelace',
      tenantSlug: 'acme',
    });
  });

  it('calls refresh token endpoint without body', async () => {
    post.mockResolvedValueOnce({ accessToken: 'new-token', refreshToken: 'new-rt', expiresIn: 900, tokenType: 'Bearer' });

    await authService.refreshToken();

    expect(post).toHaveBeenCalledWith('/auth/refresh');
  });

  it('calls revoke session endpoint with id', async () => {
    del.mockResolvedValueOnce(undefined);

    await authService.revokeSession('session-1');

    expect(del).toHaveBeenCalledWith('/auth/sessions/session-1');
  });

  it('retrieves active sessions list', async () => {
    const sessions = [{ id: 's1', createdAt: '2026-01-01', expiresAt: '2026-01-02', isCurrent: true }];
    get.mockResolvedValueOnce(sessions);

    const result = await authService.getSessions();

    expect(get).toHaveBeenCalledWith('/auth/sessions');
    expect(result).toEqual(sessions);
  });
});
