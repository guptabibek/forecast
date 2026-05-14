import { useCallback, useEffect, useRef, useState } from 'react';

export type FilterOperator =
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'isNull'
  | 'isNotNull';

export interface ColumnFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

interface UseTableFiltersReturn {
  /** Live filter state (updates immediately on input change). */
  filters: ColumnFilter[];
  /** Debounced filters — use these in query keys and API calls. */
  debouncedFilters: ColumnFilter[];
  /** Number of currently active column filters. */
  activeCount: number;
  /** Update or remove a single column filter. Pass null/undefined/'' to clear. */
  setFilter: (field: string, operator: FilterOperator, value: unknown) => void;
  /** Remove filter for a specific field. */
  clearFilter: (field: string) => void;
  /** Remove all active filters. */
  clearAll: () => void;
  /** Serialize debounced filters as a JSON string ready for API query params. Returns undefined when empty. */
  toQueryParam: () => string | undefined;
}

const DEBOUNCE_MS = 350;

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.every((v) => v === null || v === undefined || v === '');
  return false;
}

export function useTableFilters(): UseTableFiltersReturn {
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const [debouncedFilters, setDebouncedFilters] = useState<ColumnFilter[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedFilters(filters);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [filters]);

  const setFilter = useCallback((field: string, operator: FilterOperator, value: unknown) => {
    setFilters((prev) => {
      const without = prev.filter((f) => f.field !== field);
      if (isEmpty(value)) return without;
      return [...without, { field, operator, value }];
    });
  }, []);

  const clearFilter = useCallback((field: string) => {
    setFilters((prev) => prev.filter((f) => f.field !== field));
  }, []);

  const clearAll = useCallback(() => {
    setFilters([]);
  }, []);

  const toQueryParam = useCallback((): string | undefined => {
    if (!debouncedFilters.length) return undefined;
    return JSON.stringify(debouncedFilters);
  }, [debouncedFilters]);

  return {
    filters,
    debouncedFilters,
    activeCount: filters.length,
    setFilter,
    clearFilter,
    clearAll,
    toQueryParam,
  };
}
