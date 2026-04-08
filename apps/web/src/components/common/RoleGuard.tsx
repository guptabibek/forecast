import { useAuthStore } from '@/stores/auth.store';
import type { UserRole } from '@/types';
import type { ReactNode } from 'react';

interface RoleGuardProps {
  /** The role(s) allowed to see the children */
  roles: UserRole[];
  /** Content to render when authorized */
  children: ReactNode;
  /** Optional fallback for unauthorized users (default: render nothing) */
  fallback?: ReactNode;
}

/**
 * RoleGuard — conditionally renders children based on the current user's role.
 *
 * Usage:
 *   <RoleGuard roles={['ADMIN', 'PLANNER']}>
 *     <button>Delete Work Order</button>
 *   </RoleGuard>
 */
export function RoleGuard({ roles, children, fallback = null }: RoleGuardProps) {
  const userRole = useAuthStore((s) => s.user?.role);

  if (!userRole || !roles.includes(userRole)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
