import { ChevronRightIcon, HomeIcon } from '@heroicons/react/20/solid';
import { Link, useLocation } from 'react-router-dom';

/**
 * Route-name map for human-readable breadcrumb labels.
 * Keys are path segments; values are display labels.
 */
const routeLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  plans: 'Plans',
  new: 'New',
  forecasts: 'Forecasts',
  scenarios: 'Scenarios',
  data: 'Data',
  import: 'Import',
  actuals: 'Actuals',
  dimensions: 'Dimensions',
  products: 'Products',
  locations: 'Locations',
  reports: 'Reports',
  ai: 'AI Reporting',
  insights: 'AI Insights',
  billing: 'Billing',
  'pharma-reports': 'Reports',
  inventory: 'Inventory',
  'reorder-config': 'Reorder Config',
  expiry: 'Expiry Management',
  analysis: 'Stock Analysis',
  'sales-purchase': 'Sales & Purchase',
  growth: 'Growth & Degrowth',
  procurement: 'Procurement',
  'purchase-orders': 'Purchase Orders',
  'purchase-invoices': 'Purchase Invoices',
  suppliers: 'Suppliers',
  batches: 'Batches',
  financial: 'Party Outstanding',
  '360': '360 Reports',
  alerts: 'Alerts',
  'gl-accounts': 'GL Accounts',
  'journal-entries': 'Journal Entries',
  'trial-balance': 'Trial Balance',
  manufacturing: 'Manufacturing',
  bom: 'Bill of Materials',
  mrp: 'MRP',
  'work-orders': 'Work Orders',
  capacity: 'Capacity',
  promotions: 'Promotions',
  npi: 'NPI',
  sop: 'S&OP',
  workflow: 'Workflows',
  'fiscal-calendar': 'Fiscal Calendar',
  'quality-inspections': 'Quality Inspections',
  'forecast-accuracy': 'Forecast Accuracy',
  'product-costing': 'Product Costing',
  'costing-engine': 'Costing Engine',
  'purchase-contracts': 'Purchase Contracts',
  'product-categories': 'Product Categories',
  'uom-master': 'UOM Master',
  'uom-conversions': 'UOM Conversions',
  'location-hierarchy': 'Location Hierarchy',
  'capacity-plans': 'Capacity Plans',
  'sop-gap-analysis': 'S&OP Gap Analysis',
  settings: 'Settings',
  'marg-ede': 'Marg EDE',
  'audit-log': 'Audit Log',
  notifications: 'Notifications',
  profile: 'Profile',
  users: 'Users',
  roles: 'Roles',
  platform: 'Platform Admin',
  'ai-billing': 'AI Billing',
};

interface BreadcrumbItem {
  label: string;
  href: string;
  isCurrent: boolean;
}

function useBreadcrumbs(): BreadcrumbItem[] {
  const location = useLocation();
  const pathname = location.pathname;

  // Don't show breadcrumbs on dashboard or root
  if (pathname === '/' || pathname === '/dashboard') return [];

  const segments = pathname.split('/').filter(Boolean);

  // Skip UUID-looking segments for cleaner breadcrumbs
  const isUUID = (s: string) => /^[0-9a-f]{8}-/.test(s);

  return segments
    .map((segment, index) => {
      const href = '/' + segments.slice(0, index + 1).join('/');
      const isCurrent = index === segments.length - 1;
      const label = isUUID(segment)
        ? 'Detail'
        : routeLabels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');

      return { label, href, isCurrent };
    });
}

export function Breadcrumbs() {
  const items = useBreadcrumbs();

  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex items-center gap-1 text-sm">
        <li>
          <Link
            to="/dashboard"
            className="text-secondary-400 hover:text-secondary-600 dark:text-secondary-500 dark:hover:text-secondary-300 transition-colors"
            aria-label="Home"
          >
            <HomeIcon className="h-4 w-4" />
          </Link>
        </li>
        {items.map((item) => (
          <li key={item.href} className="flex items-center gap-1">
            <ChevronRightIcon className="h-4 w-4 text-secondary-300 dark:text-secondary-600 flex-shrink-0" />
            {item.isCurrent ? (
              <span
                className="text-secondary-700 dark:text-secondary-300 font-medium truncate max-w-[200px]"
                aria-current="page"
              >
                {item.label}
              </span>
            ) : (
              <Link
                to={item.href}
                className="text-secondary-400 dark:text-secondary-500 hover:text-secondary-600 dark:hover:text-secondary-300 transition-colors truncate max-w-[200px]"
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
