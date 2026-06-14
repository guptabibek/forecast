import type { User, UserRole } from './types';

const FORECAST_ONLY_MENU_PATHS = new Set([
  '/dashboard',
  '/plans',
  '/forecasts',
  '/scenarios',
  '/reports',
  '/reports/ai',
  '/insights',
]);

// Manufacturing sub-paths surfaced under "Planning & Forecasting" — visible to planners
// (incl. forecast planner) so the planning audience can review procurement/inventory
// posture without unlocking the full manufacturing workspace.
const PLANNING_VISIBLE_MFG_PATHS = new Set<string>();

// Pharma-reports paths for accounting artefacts. Visible to ADMIN/FINANCE always; PLANNER
// (and FORECAST_PLANNER → PLANNER) get read-only visibility because these reports anchor
// the planning conversation around margin/cost.
const FINANCE_REPORT_MENU_PATHS = new Set([
  '/pharma-reports/gl-accounts',
  '/pharma-reports/journal-entries',
  '/pharma-reports/trial-balance',
]);

const FINANCIAL_REPORT_MENU_PATHS = new Set([
  '/pharma-reports/financial',
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

export function isPlanningVisibleManufacturingPath(href: string): boolean {
  return PLANNING_VISIBLE_MFG_PATHS.has(href.split('?')[0]);
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

  const path = href.split('?')[0];

  if (isSuperAdmin(role)) {
    return path === '/platform' || path.startsWith('/platform/') || path === '/reports/ai' || path === '/insights';
  }

  if (isForecastViewerRole(role)) {
    // Forecast viewers see the forecast-only set.
    // surfaces (PO, PI, Inventory, Suppliers, Batches) read-only — they're part of the
    // planning conversation and the pages are view-only at the UI level.
    return FORECAST_ONLY_MENU_PATHS.has(path) || PLANNING_VISIBLE_MFG_PATHS.has(path);
  }

  if (isForecastPlannerRole(role) && path.startsWith('/manufacturing')) {
    return PLANNING_VISIBLE_MFG_PATHS.has(path);
  }

  if (FINANCE_REPORT_MENU_PATHS.has(path) && !roleMatches(role, 'ADMIN', 'FINANCE', 'PLANNER')) {
    return false;
  }

  if (FINANCIAL_REPORT_MENU_PATHS.has(path) && !roleMatches(role, 'ADMIN', 'FINANCE', 'PLANNER')) {
    return false;
  }

  return true;
}

export function hasPermission(user: User | null | undefined, permission: string): boolean {
  if (!user) return false;
  if (isSuperAdmin(user.role)) return true;
  return user.permissions?.includes(permission) === true;
}

/**
 * Whether the AI Reporting / AI Insights surfaces are available to this user.
 * Two conditions only, both resolved by the backend into the boolean passed as
 * `featureEnabled` (settings.aiReporting.enabled):
 *   1. the super admin enabled the `ai-reporting` module for the tenant, AND
 *   2. the tenant's AI provider credentials are configured & enabled.
 * Role/permission authorization is enforced by the API on every AI call; the
 * client only decides discovery/visibility, so it does not re-check here.
 */
export function canUseAiReporting(user: User | null | undefined, featureEnabled = true): boolean {
  return Boolean(user) && featureEnabled === true;
}

export function getRoleLabel(role: UserRole | null | undefined): string {
  return role ? ROLE_LABELS[role] : '';
}
