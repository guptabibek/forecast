import { FunnelIcon, XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import React, { createContext, useCallback, useContext, useState } from 'react';
import { useIsCompact, useScreenSize } from '../../hooks/useResponsive';

interface PageLayoutContextValue {
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  toggleFilter: () => void;
}

const PageLayoutContext = createContext<PageLayoutContextValue>({
  filterOpen: false,
  setFilterOpen: () => {},
  toggleFilter: () => {},
});

export function usePageLayout() {
  return useContext(PageLayoutContext);
}

interface ResponsivePageLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export function ResponsivePageLayout({ children, className }: ResponsivePageLayoutProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const toggleFilter = useCallback(() => setFilterOpen((p) => !p), []);

  return (
    <PageLayoutContext.Provider value={{ filterOpen, setFilterOpen, toggleFilter }}>
      <div className={clsx('space-y-4 lg:space-y-6 pb-6', className)}>{children}</div>
    </PageLayoutContext.Provider>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl lg:text-2xl font-bold text-secondary-900 dark:text-white truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-0.5 truncate">
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">{actions}{children}</div>
    </div>
  );
}

interface PageToolbarProps {
  children: React.ReactNode;
  className?: string;
  showFilterToggle?: boolean;
  filterCount?: number;
}

export function PageToolbar({ children, className, showFilterToggle, filterCount }: PageToolbarProps) {
  const { toggleFilter, filterOpen } = usePageLayout();
  const isCompact = useIsCompact();

  return (
    <div
      className={clsx(
        'flex items-center gap-2 flex-wrap rounded-lg bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 px-3 py-2 lg:px-4 lg:py-3',
        className,
      )}
    >
      {showFilterToggle && isCompact && (
        <button
          onClick={toggleFilter}
          className={clsx(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
            filterOpen
              ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/30 dark:border-primary-600 dark:text-primary-300'
              : 'border-secondary-300 dark:border-secondary-600 text-secondary-600 dark:text-secondary-400 hover:bg-secondary-50',
          )}
        >
          <FunnelIcon className="w-4 h-4" />
          Filters
          {filterCount !== undefined && filterCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-primary-600 text-white rounded-full leading-none">
              {filterCount}
            </span>
          )}
        </button>
      )}
      {children}
    </div>
  );
}

interface AdaptiveFilterPanelProps {
  children: React.ReactNode;
  className?: string;
}

export function AdaptiveFilterPanel({ children, className }: AdaptiveFilterPanelProps) {
  const { filterOpen, setFilterOpen } = usePageLayout();
  const isCompact = useIsCompact();
  const screen = useScreenSize();

  if (!isCompact) {
    return (
      <div className={clsx('flex items-center gap-3 flex-wrap', className)}>{children}</div>
    );
  }

  return (
    <AnimatePresence>
      {filterOpen && (
        <>
          {screen === 'mobile' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setFilterOpen(false)}
            />
          )}
          <motion.div
            initial={screen === 'mobile' ? { y: '100%' } : { height: 0, opacity: 0 }}
            animate={screen === 'mobile' ? { y: 0 } : { height: 'auto', opacity: 1 }}
            exit={screen === 'mobile' ? { y: '100%' } : { height: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={clsx(
              screen === 'mobile'
                ? 'fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto bg-white dark:bg-secondary-800 rounded-t-2xl shadow-xl border-t border-secondary-200 dark:border-secondary-700'
                : 'overflow-hidden rounded-lg border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-800',
              className,
            )}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-secondary-900 dark:text-white">Filters</h3>
                <button
                  onClick={() => setFilterOpen(false)}
                  className="p-1 rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-700"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              <div className="flex flex-col gap-3">{children}</div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface ResponsiveSummaryCardsProps {
  children: React.ReactNode;
  columns?: number;
  className?: string;
}

export function ResponsiveSummaryCards({ children, columns = 4, className }: ResponsiveSummaryCardsProps) {
  const colMap: Record<number, string> = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4',
    5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
    6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
    7: 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7',
  };

  return (
    <div className={clsx('grid gap-3 lg:gap-4', colMap[columns] || colMap[4], className)}>
      {children}
    </div>
  );
}

interface StickyActionBarProps {
  children: React.ReactNode;
  className?: string;
}

export function StickyActionBar({ children, className }: StickyActionBarProps) {
  return (
    <div
      className={clsx(
        'sticky bottom-0 z-10 flex items-center gap-2 px-4 py-3 bg-white/95 dark:bg-secondary-800/95 backdrop-blur-sm border-t border-secondary-200 dark:border-secondary-700 -mx-4 lg:-mx-6 mt-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
