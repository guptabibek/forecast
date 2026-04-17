/**
 * All granular permissions in the system, organized by module.
 * Each permission follows the pattern: `module:action`
 */

export const PERMISSION_DEFINITIONS = {
  dashboard: {
    label: 'Dashboard',
    permissions: [
      { key: 'dashboard:read', label: 'View dashboard' },
    ],
  },
  plan: {
    label: 'Planning',
    permissions: [
      { key: 'plan:read', label: 'View plans' },
      { key: 'plan:create', label: 'Create plans' },
      { key: 'plan:edit', label: 'Edit plans' },
      { key: 'plan:delete', label: 'Delete plans' },
      { key: 'plan:approve', label: 'Approve plans' },
    ],
  },
  forecast: {
    label: 'Forecasting',
    permissions: [
      { key: 'forecast:read', label: 'View forecasts' },
      { key: 'forecast:create', label: 'Create forecasts' },
      { key: 'forecast:edit', label: 'Edit forecasts' },
      { key: 'forecast:delete', label: 'Delete forecasts' },
      { key: 'forecast:run', label: 'Run forecast engine' },
    ],
  },
  scenario: {
    label: 'Scenarios',
    permissions: [
      { key: 'scenario:read', label: 'View scenarios' },
      { key: 'scenario:create', label: 'Create scenarios' },
      { key: 'scenario:edit', label: 'Edit scenarios' },
      { key: 'scenario:delete', label: 'Delete scenarios' },
    ],
  },
  manufacturing: {
    label: 'Manufacturing',
    permissions: [
      { key: 'manufacturing:read', label: 'View manufacturing' },
      { key: 'manufacturing:create', label: 'Create work orders / POs' },
      { key: 'manufacturing:edit', label: 'Edit manufacturing data' },
      { key: 'manufacturing:delete', label: 'Delete manufacturing data' },
    ],
  },
  report: {
    label: 'Reports',
    permissions: [
      { key: 'report:read', label: 'View reports' },
      { key: 'report:create', label: 'Create reports' },
      { key: 'report:export', label: 'Export reports' },
    ],
  },
  data: {
    label: 'Data Management',
    permissions: [
      { key: 'data:read', label: 'View data' },
      { key: 'data:import', label: 'Import data' },
      { key: 'data:export', label: 'Export data' },
    ],
  },
  settings: {
    label: 'Settings',
    permissions: [
      { key: 'settings:read', label: 'View settings' },
      { key: 'settings:edit', label: 'Edit settings' },
    ],
  },
  users: {
    label: 'User Management',
    permissions: [
      { key: 'users:read', label: 'View users' },
      { key: 'users:invite', label: 'Invite users' },
      { key: 'users:edit', label: 'Edit users' },
      { key: 'users:delete', label: 'Delete / deactivate users' },
    ],
  },
  roles: {
    label: 'Role Management',
    permissions: [
      { key: 'roles:read', label: 'View roles' },
      { key: 'roles:create', label: 'Create roles' },
      { key: 'roles:edit', label: 'Edit roles' },
      { key: 'roles:delete', label: 'Delete roles' },
    ],
  },
} as const;

/** Flat list of all valid permission keys */
export const ALL_PERMISSION_KEYS: string[] = Object.values(PERMISSION_DEFINITIONS)
  .flatMap((group) => group.permissions.map((p) => p.key));

/** System role templates — seeded per tenant as isSystem: true */
export const SYSTEM_ROLE_TEMPLATES: Array<{
  name: string;
  slug: string;
  description: string;
  moduleAccess: Record<string, boolean>;
  permissions: string[];
  isDefault?: boolean;
  legacyRole: string;
}> = [
  {
    name: 'Admin',
    slug: 'admin',
    description: 'Full access to all features and settings',
    legacyRole: 'ADMIN',
    moduleAccess: {
      planning: true, forecasting: true, manufacturing: true,
      reports: true, data: true, 'marg-ede': true,
    },
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    name: 'Planner',
    slug: 'planner',
    description: 'Create and manage plans and forecasts',
    legacyRole: 'PLANNER',
    moduleAccess: {
      planning: true, forecasting: true, manufacturing: true,
      reports: true, data: true, 'marg-ede': false,
    },
    permissions: [
      'dashboard:read',
      'plan:read', 'plan:create', 'plan:edit',
      'forecast:read', 'forecast:create', 'forecast:edit', 'forecast:run',
      'scenario:read', 'scenario:create', 'scenario:edit',
      'manufacturing:read',
      'report:read',
      'data:read', 'data:import',
    ],
  },
  {
    name: 'Forecast Planner',
    slug: 'forecast-planner',
    description: 'Planning, forecast, and data access without manufacturing',
    legacyRole: 'FORECAST_PLANNER',
    moduleAccess: {
      planning: true, forecasting: true, manufacturing: false,
      reports: true, data: true, 'marg-ede': false,
    },
    permissions: [
      'dashboard:read',
      'plan:read', 'plan:create', 'plan:edit',
      'forecast:read', 'forecast:create', 'forecast:edit', 'forecast:run',
      'scenario:read', 'scenario:create', 'scenario:edit',
      'report:read',
      'data:read', 'data:import',
    ],
  },
  {
    name: 'Finance',
    slug: 'finance',
    description: 'View reports and approve forecasts',
    legacyRole: 'FINANCE',
    moduleAccess: {
      planning: true, forecasting: true, manufacturing: false,
      reports: true, data: false, 'marg-ede': false,
    },
    permissions: [
      'dashboard:read',
      'plan:read', 'plan:approve',
      'forecast:read',
      'scenario:read',
      'report:read', 'report:export',
    ],
  },
  {
    name: 'Viewer',
    slug: 'viewer',
    description: 'Read-only access to dashboards and reports',
    legacyRole: 'VIEWER',
    isDefault: true,
    moduleAccess: {
      planning: true, forecasting: true, manufacturing: false,
      reports: true, data: false, 'marg-ede': false,
    },
    permissions: [
      'dashboard:read',
      'plan:read',
      'forecast:read',
      'scenario:read',
      'report:read',
    ],
  },
  {
    name: 'Forecast Viewer',
    slug: 'forecast-viewer',
    description: 'Forecast-only read access with reduced navigation',
    legacyRole: 'FORECAST_VIEWER',
    moduleAccess: {
      planning: true, forecasting: true, manufacturing: false,
      reports: true, data: false, 'marg-ede': false,
    },
    permissions: [
      'dashboard:read',
      'plan:read',
      'forecast:read',
      'scenario:read',
      'report:read',
    ],
  },
];
