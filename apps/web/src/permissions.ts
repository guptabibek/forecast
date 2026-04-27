import type { UserRole } from './types';

const FORECAST_ONLY_MENU_PATHS = new Set([
  '/dashboard',
  '/plans',
  '/forecasts',
  '/scenarios',
  '/reports',
]);

const FINANCE_ONLY_MENU_PATHS = new Set([
  '/manufacturing/gl-accounts',
  '/manufacturing/journal-entries',
]);

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  PLANNER: 'Planner',
  FINANCE: 'Finance',
  VIEWER: 'Viewer',
  FORECAST_PLANNER: 'Forecast Planner',
  FORECAST_VIEWER: 'Forecast Viewer',
};

export function isSuperAdmin(role?: UserRole | null): boolean {
  return role === 'SUPER_ADMIN';
}

export function isForecastPlannerRole(role?: UserRole | null): boolean {
  return role === 'FORECAST_PLANNER';
}

export function isForecastViewerRole(role?: UserRole | null): boolean {
  return role === 'FORECAST_VIEWER';
}

export function isManufacturingBlockedRole(role?: UserRole | null): boolean {
  return isForecastPlannerRole(role) || isForecastViewerRole(role);
}

export function getFallbackPathForRole(role?: UserRole | null): string {
  if (role === 'SUPER_ADMIN') {
    return '/platform';
  }

  return role === 'FORECAST_VIEWER' ? '/forecasts' : '/dashboard';
}

export function roleMatches(role: UserRole | null | undefined, ...roles: UserRole[]): boolean {
  if (!role) {
    return false;
  }

  const effectiveRoles: UserRole[] = role === 'FORECAST_PLANNER'
    ? ['FORECAST_PLANNER', 'PLANNER', 'VIEWER']
    : role === 'FORECAST_VIEWER'
      ? ['FORECAST_VIEWER', 'VIEWER']
      : [role];

  return roles.some((requiredRole) => effectiveRoles.includes(requiredRole));
}

export function canShowSidebarHref(role: UserRole | null | undefined, href: string): boolean {
  if (!role) {
    return false;
  }

  if (isSuperAdmin(role)) {
    return href === '/platform' || href.startsWith('/platform/');
  }

  if (isForecastViewerRole(role)) {
    return FORECAST_ONLY_MENU_PATHS.has(href);
  }

  if (isForecastPlannerRole(role) && href.startsWith('/manufacturing')) {
    return false;
  }

  if (FINANCE_ONLY_MENU_PATHS.has(href) && !roleMatches(role, 'ADMIN', 'FINANCE')) {
    return false;
  }

  return true;
}

export function getRoleLabel(role: UserRole | null | undefined): string {
  return role ? ROLE_LABELS[role] : '';
}