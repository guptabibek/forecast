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

  it('requires an AI reporting permission for normal users', () => {
    expect(canUseAiReporting(baseUser, true)).toBe(false);
    expect(canUseAiReporting({ ...baseUser, permissions: ['reports.ai.view'] }, true)).toBe(true);
  });

  it('allows tenant admins to use AI reporting when the feature is enabled', () => {
    expect(canUseAiReporting({ ...baseUser, role: 'ADMIN' }, true)).toBe(true);
  });

  it('hides AI reporting when the feature flag is disabled', () => {
    expect(canUseAiReporting({ ...baseUser, permissions: ['reports.ai.view'] }, false)).toBe(false);
  });
});
