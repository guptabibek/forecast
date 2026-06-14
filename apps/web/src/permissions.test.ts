import { describe, expect, it } from 'vitest';
import { canShowSidebarHref, canUseAiReporting } from './permissions';
import type { User } from './types';

const baseUser: User = {
  id: 'user-1',
  email: 'user@example.com',
  firstName: 'Test',
  lastName: 'User',
  role: 'VIEWER',
  tenantId: 'tenant-1',
  createdAt: '2026-05-13T00:00:00.000Z',
  permissions: [],
  moduleAccess: { reports: true },
};

describe('permissions', () => {
  it('allows super admin to see the AI Reporting sidebar item when the feature is enabled', () => {
    const user = { ...baseUser, role: 'SUPER_ADMIN' as const };

    expect(canShowSidebarHref(user.role, '/reports/ai')).toBe(true);
    expect(canUseAiReporting(user, true)).toBe(true);
  });

  it('shows AI reporting to any authenticated user when the AI feature is enabled, regardless of role or permissions', () => {
    // The two conditions (module enabled by SA + credentials configured) are
    // folded into featureEnabled by the backend; the client adds no further gate.
    expect(canUseAiReporting(baseUser, true)).toBe(true);
    expect(canUseAiReporting({ ...baseUser, role: 'ADMIN' }, true)).toBe(true);
    expect(canUseAiReporting({ ...baseUser, permissions: [] }, true)).toBe(true);
  });

  it('hides AI reporting when the AI feature is not fully enabled', () => {
    expect(canUseAiReporting(baseUser, false)).toBe(false);
    expect(canUseAiReporting({ ...baseUser, role: 'ADMIN' }, false)).toBe(false);
  });

  it('hides AI reporting when there is no authenticated user', () => {
    expect(canUseAiReporting(null, true)).toBe(false);
    expect(canUseAiReporting(undefined, true)).toBe(false);
  });
});
