import { useCallback, useMemo, useState } from 'react';
import { useTableFilters, type FilterOperator } from './useTableFilters';

interface UseGridStateOpts {
  /** Default sort column. Should match a DB-backed column key. */
  initialSortBy?: string;
  initialSortOrder?: 'asc' | 'desc';
  initialPageSize?: number;
}

/**
 * One-stop grid state container: pagination + sort + column filters with consistent
 * "reset to page 1 on filter/sort change" semantics. Pass the returned props directly
 * to the DataTable.
 *
 * Usage:
 *   const grid = useGridState({ initialSortBy: 'createdAt', initialSortOrder: 'desc' });
 *   const { data } = useQuery({
 *     queryKey: ['boms', grid.queryKey],
 *     queryFn: () => bomService.getAll(grid.queryParams),
 *   });
 *   <DataTable
 *     ...
 *     sorting={grid.sortingProps}
 *     filtering={grid.filteringProps}
 *     pagination={grid.paginationProps(data?.total ?? 0)}
 *   />
 */
export function useGridState(opts?: UseGridStateOpts) {
  const initialPageSize = opts?.initialPageSize ?? 25;
  const initialSortBy = opts?.initialSortBy ?? 'createdAt';
  const initialSortOrder = opts?.initialSortOrder ?? 'desc';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(initialSortOrder);

  const tableFilters = useTableFilters();

  const handleSort = useCallback((key: string) => {
    setSortOrder((prev) => (key === sortBy ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    if (key !== sortBy) setSortBy(key);
    setPage(1);
  }, [sortBy]);

  const handleFilterChange = useCallback((field: string, op: FilterOperator, value: unknown) => {
    setPage(1);
    tableFilters.setFilter(field, op, value);
  }, [tableFilters]);

  const handleClearFilter = useCallback((field: string) => {
    setPage(1);
    tableFilters.clearFilter(field);
  }, [tableFilters]);

  const handleClearAll = useCallback(() => {
    setPage(1);
    tableFilters.clearAll();
  }, [tableFilters]);

  const resetSort = useCallback(() => {
    setPage(1);
    setSortBy(initialSortBy);
    setSortOrder(initialSortOrder);
  }, [initialSortBy, initialSortOrder]);

  const resetAll = useCallback(() => {
    setPage(1);
    setPageSize(initialPageSize);
    setSortBy(initialSortBy);
    setSortOrder(initialSortOrder);
    tableFilters.clearAll();
  }, [initialPageSize, initialSortBy, initialSortOrder, tableFilters]);

  const setPageSizeAndReset = useCallback((s: number) => {
    setPageSize(s);
    setPage(1);
  }, []);

  /** API params (live: not debounced — pass through to the service). */
  const queryParams = useMemo(() => ({
    page,
    pageSize,
    sortBy,
    sortDir: sortOrder,
    filters: tableFilters.toQueryParam(),
  }), [page, pageSize, sortBy, sortOrder, tableFilters]);

  /** React Query key fragment — uses debouncedFilters so refetch only after debounce. */
  const queryKey = useMemo(() => ({
    page,
    pageSize,
    sortBy,
    sortOrder,
    filters: tableFilters.debouncedFilters,
  }), [page, pageSize, sortBy, sortOrder, tableFilters.debouncedFilters]);

  const sortingProps = useMemo(() => ({
    sortBy,
    sortOrder,
    onSort: handleSort,
  }), [sortBy, sortOrder, handleSort]);

  const filteringProps = useMemo(() => ({
    filters: tableFilters.filters,
    onFilterChange: handleFilterChange,
    onClearFilter: handleClearFilter,
    onClearAll: handleClearAll,
  }), [tableFilters.filters, handleFilterChange, handleClearFilter, handleClearAll]);

  const paginationProps = useCallback((total: number) => ({
    page,
    pageSize,
    total,
    onPageChange: setPage,
    onPageSizeChange: setPageSizeAndReset,
  }), [page, pageSize, setPageSizeAndReset]);

  const hasActiveSort = sortBy !== initialSortBy || sortOrder !== initialSortOrder;
  const hasActiveControls = hasActiveSort || tableFilters.activeCount > 0;

  return {
    page,
    pageSize,
    sortBy,
    sortOrder,
    queryParams,
    queryKey,
    sortingProps,
    filteringProps,
    paginationProps,
    activeFilterCount: tableFilters.activeCount,
    hasActiveSort,
    hasActiveControls,
    resetSort,
    resetAll,
    setPage,
    setPageSize: setPageSizeAndReset,
  };
}
