import { useCallback, useMemo } from 'react';
import { useGridState } from './useGridState';

interface UsePharmaGridOpts {
  initialSortBy?: string;
  initialSortOrder?: 'asc' | 'desc';
  initialPageSize?: number;
}

/**
 * Adapter around `useGridState` for pharma reports.
 *
 * Pharma report APIs use `limit`/`offset` (not `page`/`pageSize`) and the
 * `data`/`total` response shape (not `items`/`total`). This hook produces
 * `pharmaParams` ready to splice into `PharmaFilters` (the shared pharma
 * service interface) plus the standard `useGridState` props for the DataTable.
 *
 *   const grid = usePharmaGrid({ initialSortBy: 'sku' });
 *   const { data } = useQuery({
 *     queryKey: ['near-expiry', grid.queryKey],
 *     queryFn: () => svc.getNearExpiry({ ...baseFilters, ...grid.pharmaParams }),
 *   });
 *   <DataTable
 *     pagination={grid.paginationProps(data?.total ?? 0)}
 *     sorting={grid.sortingProps}
 *     filtering={grid.filteringProps}
 *   />
 */
export function usePharmaGrid(opts?: UsePharmaGridOpts) {
  const grid = useGridState({
    initialSortBy: opts?.initialSortBy,
    initialSortOrder: opts?.initialSortOrder,
    initialPageSize: opts?.initialPageSize ?? 50,
  });

  const pharmaParams = useMemo(() => ({
    limit: grid.pageSize,
    offset: (grid.page - 1) * grid.pageSize,
    sortBy: grid.queryParams.sortBy,
    sortDir: grid.queryParams.sortDir,
    filters: grid.queryParams.filters,
  }), [grid.page, grid.pageSize, grid.queryParams]);

  /** Pagination props for `<DataTable />`. Wraps `pharmaParams` semantics. */
  const paginationProps = useCallback((total: number) => grid.paginationProps(total), [grid]);

  return {
    pharmaParams,
    queryKey: grid.queryKey,
    sortingProps: grid.sortingProps,
    filteringProps: grid.filteringProps,
    paginationProps,
    activeFilterCount: grid.activeFilterCount,
    hasActiveControls: grid.hasActiveControls,
    resetSort: grid.resetSort,
    resetAll: grid.resetAll,
  };
}
