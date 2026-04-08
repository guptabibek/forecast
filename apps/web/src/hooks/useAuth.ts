import { useAuthStore } from '@/stores/auth.store';
import type { UserRole } from '@/types';
import { useCallback, useMemo } from 'react';

/**
 * useAuth — convenience hook for role-based UI guards.
 *
 * Usage:
 *   const { canMutate, isFinance, hasRole } = useAuth();
 *   {canMutate && <button>Delete</button>}
 */
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  const hasRole = useCallback(
    (...roles: UserRole[]) => !!role && roles.includes(role),
    [role],
  );

  return useMemo(
    () => ({
      user,
      role,
      /** Can create/update/delete manufacturing data (ADMIN, PLANNER) */
      canMutate: hasRole('ADMIN', 'PLANNER'),
      /** Can access financial data (ADMIN, FINANCE) */
      isFinance: hasRole('ADMIN', 'FINANCE'),
      /** Is full administrator */
      isAdmin: hasRole('ADMIN'),
      /** Read-only user */
      isViewer: role === 'VIEWER',
      /** Arbitrary role check */
      hasRole,
    }),
    [user, role, hasRole],
  );
}
