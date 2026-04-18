import { canShowSidebarHref, isSuperAdmin } from '@/permissions';
import { useAuthStore } from '@/stores/auth.store';
import {
    ArrowPathIcon,
    BeakerIcon,
    BellIcon,
    BuildingOffice2Icon,
    ChartBarIcon,
    ChevronLeftIcon,
    ClockIcon,
    CloudArrowUpIcon,
    Cog6ToothIcon,
    CubeIcon,
    CurrencyDollarIcon,
    DocumentChartBarIcon,
    DocumentTextIcon,
    ExclamationTriangleIcon,
    HomeIcon,
    MapPinIcon,
    PresentationChartLineIcon,
    ShieldCheckIcon,
    ShoppingCartIcon,
    SwatchIcon,
    TableCellsIcon,
    UsersIcon,
    WrenchScrewdriverIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { prefetchRoute } from '@services/route-prefetch';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useBranding } from '../ThemeProvider';

interface SidebarProps {
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

type NavItemType = { name: string; href: string; icon: React.ElementType; module?: string };
type NavGroupType = { name: string; module?: string; items: NavItemType[] };
type NavigationItem = NavItemType | NavGroupType;

const navigation: NavigationItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  {
    name: 'Planning & Forecasting',
    module: 'planning',
    items: [
      { name: 'Plans', href: '/plans', icon: DocumentTextIcon, module: 'planning' },
      { name: 'Forecasts', href: '/forecasts', icon: ChartBarIcon, module: 'forecasting' },
      { name: 'Scenarios', href: '/scenarios', icon: BeakerIcon, module: 'forecasting' },
    ],
  },
  {
    name: 'Data',
    module: 'data',
    items: [
      { name: 'Import Data', href: '/data/import', icon: CloudArrowUpIcon },
      { name: 'Actuals', href: '/data/actuals', icon: TableCellsIcon },
      { name: 'Products', href: '/data/products', icon: CubeIcon },
      { name: 'Locations', href: '/data/locations', icon: MapPinIcon },
      { name: 'Dimensions', href: '/data/dimensions', icon: CubeIcon },
    ],
  },
  { name: 'Reports', href: '/reports', icon: DocumentChartBarIcon, module: 'reports' },
  {
    name: 'Pharma Reports',
    module: 'reports',
    items: [
      { name: 'Dashboard', href: '/pharma-reports', icon: PresentationChartLineIcon, module: 'reports' },
      { name: 'Inventory', href: '/pharma-reports/inventory', icon: TableCellsIcon, module: 'reports' },
      { name: 'Expiry Mgmt', href: '/pharma-reports/expiry', icon: ClockIcon, module: 'reports' },
      { name: 'Stock Analysis', href: '/pharma-reports/analysis', icon: ChartBarIcon, module: 'reports' },
      { name: 'Procurement', href: '/pharma-reports/procurement', icon: ShoppingCartIcon, module: 'reports' },
      { name: 'Alerts', href: '/pharma-reports/alerts', icon: ExclamationTriangleIcon, module: 'reports' },
    ],
  },
  {
    name: 'Manufacturing',
    module: 'manufacturing',
    items: [
      { name: 'Overview', href: '/manufacturing', icon: BuildingOffice2Icon },
      { name: 'BOM', href: '/manufacturing/bom', icon: CubeIcon },
      { name: 'MRP', href: '/manufacturing/mrp', icon: DocumentTextIcon },
      { name: 'Work Orders', href: '/manufacturing/work-orders', icon: DocumentTextIcon },
      { name: 'Purchase Orders', href: '/manufacturing/purchase-orders', icon: DocumentTextIcon },
      { name: 'Capacity', href: '/manufacturing/capacity', icon: ChartBarIcon },
      { name: 'Inventory', href: '/manufacturing/inventory', icon: TableCellsIcon },
      { name: 'Suppliers', href: '/manufacturing/suppliers', icon: UsersIcon },
      { name: 'Promotions', href: '/manufacturing/promotions', icon: DocumentChartBarIcon },
      { name: 'NPI', href: '/manufacturing/npi', icon: BeakerIcon },
      { name: 'S&OP', href: '/manufacturing/sop', icon: ChartBarIcon },
      { name: 'Workflows', href: '/manufacturing/workflow', icon: Cog6ToothIcon },
      { name: 'Fiscal Calendar', href: '/manufacturing/fiscal-calendar', icon: DocumentTextIcon },
      { name: 'Quality Inspections', href: '/manufacturing/quality-inspections', icon: ShieldCheckIcon },
      { name: 'Forecast Accuracy', href: '/manufacturing/forecast-accuracy', icon: ChartBarIcon },
      { name: 'Product Costing', href: '/manufacturing/product-costing', icon: CubeIcon },
      { name: 'Costing Engine', href: '/manufacturing/costing-engine', icon: CurrencyDollarIcon },
      { name: 'Purchase Contracts', href: '/manufacturing/purchase-contracts', icon: DocumentTextIcon },
      { name: 'Product Categories', href: '/manufacturing/product-categories', icon: SwatchIcon },
      { name: 'UOM Master', href: '/manufacturing/uom-master', icon: CubeIcon },
      { name: 'UOM Conversions', href: '/manufacturing/uom-conversions', icon: TableCellsIcon },
      { name: 'Location Hierarchy', href: '/manufacturing/location-hierarchy', icon: BuildingOffice2Icon },
      { name: 'Capacity Plans', href: '/manufacturing/capacity-plans', icon: ChartBarIcon },
      { name: 'S&OP Gap Analysis', href: '/manufacturing/sop-gap-analysis', icon: DocumentChartBarIcon },
      { name: 'Batches', href: '/manufacturing/batches', icon: CubeIcon },
    ],
  },
  {
    name: 'Settings',
    items: [
      { name: 'General', href: '/settings', icon: Cog6ToothIcon },
      { name: 'Users', href: '/settings/users', icon: UsersIcon },
      { name: 'Roles', href: '/settings/roles', icon: ShieldCheckIcon },
      { name: 'Marg EDE', href: '/settings/marg-ede', icon: ArrowPathIcon },
      { name: 'Audit Log', href: '/settings/audit-log', icon: ShieldCheckIcon },
      { name: 'Notifications', href: '/notifications', icon: BellIcon },
    ],
  },
  {
    name: 'Platform Admin',
    module: 'platform-admin',
    items: [
      { name: 'Tenants', href: '/platform', icon: WrenchScrewdriverIcon, module: 'platform-admin' },
    ],
  },
];

export default function Sidebar({
  isOpen,
  isCollapsed,
  onClose,
  onToggleCollapse,
}: SidebarProps) {
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const userModuleAccess = useAuthStore((s) => s.user?.moduleAccess);
  const { settings } = useBranding();

  const brandName = settings?.name || 'ForecastPro';
  const brandLogo = settings?.logoUrl;
  const tagline = settings?.brandTagline;

  const enabledModules = settings?.enabledModules;

  const isActiveRoute = (href: string) => {
    return location.pathname === href || location.pathname.startsWith(href + '/');
  };

  const isModuleEnabled = (mod?: string) => {
    if (!mod) return true;
    // Platform admin section is only visible to SUPER_ADMIN
    if (mod === 'platform-admin') return isSuperAdmin(role);
    // Check tenant-level module toggle
    if (enabledModules && enabledModules[mod as keyof typeof enabledModules] === false) return false;
    // Check user's role-level module access (dynamic RBAC)
    if (userModuleAccess && mod in userModuleAccess && userModuleAccess[mod] === false) return false;
    return true;
  };

  const visibleNavigation = useMemo(
    () =>
      navigation
        .map((item) => {
          if (!('items' in item)) {
            if (!isModuleEnabled(item.module)) return null;
            return canShowSidebarHref(role, item.href) ? item : null;
          }

          if (!isModuleEnabled(item.module)) return null;

          const visibleItems = item.items.filter(
            (navItem) => canShowSidebarHref(role, navItem.href) && isModuleEnabled(navItem.module),
          );
          return visibleItems.length ? { ...item, items: visibleItems } : null;
        })
        .filter((item): item is NavigationItem => item !== null),
    [role, enabledModules],
  );

  const NavItem = ({
    item,
    collapsed,
  }: {
    item: { name: string; href: string; icon: React.ElementType };
    collapsed: boolean;
  }) => {
    const isActive = isActiveRoute(item.href);

    return (
      <NavLink
        to={item.href}
        onMouseEnter={() => prefetchRoute(item.href)}
        onFocus={() => prefetchRoute(item.href)}
        className={clsx(
          'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
          isActive
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-200'
            : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800',
          collapsed && 'justify-center',
        )}
        onClick={onClose}
      >
        <item.icon className="w-5 h-5 flex-shrink-0" />
        {!collapsed && <span className="text-sm font-medium">{item.name}</span>}
      </NavLink>
    );
  };

  const NavGroup = ({
    group,
    collapsed,
  }: {
    group: {
      name: string;
      items: Array<{ name: string; href: string; icon: React.ElementType }>;
    };
    collapsed: boolean;
  }) => {
    const hasActiveChild = group.items.some((item) => isActiveRoute(item.href));

    return (
      <div className="space-y-1">
        {!collapsed && (
          <div
            className={clsx(
              'px-3 py-1 text-xs font-semibold uppercase tracking-wider',
              hasActiveChild
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-secondary-400 dark:text-secondary-500',
            )}
          >
            {group.name}
          </div>
        )}
        {group.items.map((item) => (
          <NavItem key={item.href} item={item} collapsed={collapsed} />
        ))}
      </div>
    );
  };

  return (
    <>
      {/* Mobile sidebar */}
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 z-50 w-64 border-r border-secondary-200 dark:border-secondary-700 lg:hidden"
            style={{ backgroundColor: 'var(--sidebar-bg)', color: 'var(--sidebar-text)' }}
          >
            <div className="flex items-center justify-between p-4 border-b border-secondary-200 dark:border-secondary-700">
              <div className="flex items-center gap-2">
                {brandLogo ? (
                  <img src={brandLogo} alt={brandName} className="w-8 h-8 rounded-lg object-contain" />
                ) : (
                  <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
                    <ChartBarIcon className="w-5 h-5 text-white" />
                  </div>
                )}
                <div>
                  <span className="font-bold text-lg leading-tight block">{brandName}</span>
                  {tagline && <span className="text-[10px] leading-tight opacity-60 block">{tagline}</span>}
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <nav className="p-4 space-y-4 overflow-y-auto h-[calc(100vh-73px)]">
              {visibleNavigation.map((item) =>
                'items' in item ? (
                  <NavGroup key={item.name} group={item as NavGroupType} collapsed={false} />
                ) : (
                  <NavItem key={(item as NavItemType).href} item={item as NavItemType} collapsed={false} />
                ),
              )}
            </nav>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-30 hidden lg:block border-r border-secondary-200 dark:border-secondary-700 transition-all duration-300',
          isCollapsed ? 'w-20' : 'w-64',
        )}
        style={{ backgroundColor: 'var(--sidebar-bg)', color: 'var(--sidebar-text)' }}
      >
        <div
          className={clsx(
            'flex items-center justify-between p-4 border-b border-secondary-200 dark:border-secondary-700',
            isCollapsed && 'justify-center',
          )}
        >
          <div className="flex items-center gap-2">
            {brandLogo ? (
              <img src={brandLogo} alt={brandName} className="w-8 h-8 rounded-lg object-contain flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <ChartBarIcon className="w-5 h-5 text-white" />
              </div>
            )}
            {!isCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <span className="font-bold text-lg leading-tight block">
                  {brandName}
                </span>
                {tagline && <span className="text-[10px] leading-tight opacity-60 block">{tagline}</span>}
              </motion.div>
            )}
          </div>
          {!isCollapsed && (
            <button
              onClick={onToggleCollapse}
              className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700"
              title="Collapse sidebar"
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        {isCollapsed && (
          <button
            onClick={onToggleCollapse}
            className="w-full p-3 flex justify-center hover:bg-secondary-100 dark:hover:bg-secondary-700 border-b border-secondary-200 dark:border-secondary-700"
            title="Expand sidebar"
          >
            <ChevronLeftIcon className="w-5 h-5 rotate-180" />
          </button>
        )}

        <nav
          className={clsx(
            'p-4 space-y-4 overflow-y-auto',
            isCollapsed ? 'h-[calc(100vh-121px)]' : 'h-[calc(100vh-73px)]',
          )}
        >
          {visibleNavigation.map((item) =>
            'items' in item ? (
              <NavGroup key={item.name} group={item as NavGroupType} collapsed={isCollapsed} />
            ) : (
              <NavItem key={(item as NavItemType).href} item={item as NavItemType} collapsed={isCollapsed} />
            ),
          )}
        </nav>
      </aside>
    </>
  );
}
