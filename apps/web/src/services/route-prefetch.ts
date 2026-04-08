const prefetchedKeys = new Set<string>();

type Loader = () => Promise<unknown>;

type PrefetchRule = {
  key: string;
  match: (path: string) => boolean;
  loaders: Loader[];
};

const rules: PrefetchRule[] = [
  {
    key: 'dashboard',
    match: (path) => path === '/dashboard' || path === '/',
    loaders: [
      () => import('@pages/Dashboard'),
      () => import('@pages/forecasts/Forecasts'),
      () => import('@pages/plans/Plans'),
      () => import('@pages/manufacturing/ManufacturingRoutes'),
      () => import('@pages/manufacturing/ManufacturingDashboard'),
    ],
  },
  {
    key: 'plans',
    match: (path) => path.startsWith('/plans'),
    loaders: [
      () => import('@pages/plans/Plans'),
      () => import('@pages/plans/PlanDetail'),
      () => import('@pages/plans/CreatePlan'),
    ],
  },
  {
    key: 'forecasts',
    match: (path) => path.startsWith('/forecasts'),
    loaders: [
      () => import('@pages/forecasts/Forecasts'),
      () => import('@pages/forecasts/ForecastDetail'),
    ],
  },
  {
    key: 'scenarios',
    match: (path) => path.startsWith('/scenarios'),
    loaders: [() => import('@pages/scenarios/Scenarios')],
  },
  {
    key: 'data',
    match: (path) => path.startsWith('/data'),
    loaders: [
      () => import('@pages/data/DataImport'),
      () => import('@pages/data/Actuals'),
      () => import('@pages/data/ProductMaster'),
      () => import('@pages/data/Dimensions'),
    ],
  },
  {
    key: 'reports',
    match: (path) => path.startsWith('/reports'),
    loaders: [() => import('@pages/reports/Reports')],
  },
  {
    key: 'settings',
    match: (path) => path.startsWith('/settings') || path.startsWith('/notifications'),
    loaders: [
      () => import('@pages/settings/Settings'),
      () => import('@pages/settings/Users'),
      () => import('@pages/settings/Profile'),
      () => import('@pages/settings/AuditLog'),
      () => import('@pages/settings/Notifications'),
    ],
  },
  {
    key: 'manufacturing-core',
    match: (path) => path.startsWith('/manufacturing'),
    loaders: [
      () => import('@pages/manufacturing/ManufacturingRoutes'),
      () => import('@pages/manufacturing/ManufacturingDashboard'),
      () => import('@pages/manufacturing/BOM'),
      () => import('@pages/manufacturing/MRP'),
      () => import('@pages/manufacturing/WorkOrders'),
      () => import('@pages/manufacturing/Inventory'),
      () => import('@pages/manufacturing/Production'),
    ],
  },
];

export function prefetchRoute(path: string) {
  const rule = rules.find((entry) => entry.match(path));
  if (!rule || prefetchedKeys.has(rule.key)) {
    return;
  }

  prefetchedKeys.add(rule.key);

  for (const loader of rule.loaders) {
    loader().catch(() => undefined);
  }
}
