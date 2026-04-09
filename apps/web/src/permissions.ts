import type { UserRole } from './types';

const FORECAST_ONLY_MENU_PATHS = new Set([
  '/dashboard',
  '/plans',
  '/forecasts',
  '/scenarios',
  '/reports',
]);

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Admin',
  PLANNER: 'Planner',
  FINANCE: 'Finance',
  VIEWER: 'Viewer',
  FORECAST_PLANNER: 'Forecast Planner',
  FORECAST_VIEWER: 'Forecast Viewer',
};

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

  if (isForecastViewerRole(role)) {
    return FORECAST_ONLY_MENU_PATHS.has(href);
  }

  if (isForecastPlannerRole(role) && href.startsWith('/manufacturing')) {
    return false;
  }

  return true;
}

export function getRoleLabel(role: UserRole | null | undefined): string {
  return role ? ROLE_LABELS[role] : '';
}