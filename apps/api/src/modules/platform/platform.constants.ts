/**
 * All configurable modules in the platform.
 * Super-admin enables/disables these per tenant.
 */
export const PLATFORM_MODULES = [
  'planning',
  'forecasting',
  'manufacturing',
  'reports',
  'data',
  'marg-ede',
] as const;

export type PlatformModuleKey = (typeof PLATFORM_MODULES)[number];

/** Default modules enabled for new tenants */
export const DEFAULT_ENABLED_MODULES: PlatformModuleKey[] = [
  'planning',
  'forecasting',
  'reports',
  'data',
];

/** Metadata key for the @RequireModule() decorator */
export const REQUIRE_MODULE_KEY = 'requireModule';

/* ─── Static Super-Admin ─── */

/** Fixed UUID – never stored in DB, only lives inside JWTs */
export const SUPER_ADMIN_STATIC_ID = '00000000-0000-0000-0000-000000000001';

/** Synthetic tenant for the super-admin (no DB row required) */
export const SUPER_ADMIN_TENANT = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'RabbitTech Platform',
  slug: 'rabbittech',
  status: 'ACTIVE' as const,
} as const;
