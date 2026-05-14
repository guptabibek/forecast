import {
    ChevronDoubleLeftIcon,
    ChevronDoubleRightIcon,
    ChevronDownIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronUpIcon,
    FunnelIcon,
    XMarkIcon,
} from '@heroicons/react/20/solid';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnFilter, FilterOperator } from '../../hooks/useTableFilters';

export type { ColumnFilter, FilterOperator };

export interface ColumnFilterOption {
  value: string;
  label: string;
}

export interface Column<T> {
  key: string;
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
  /** When set, renders a filter input for this column in the filter row. */
  filterType?: 'text' | 'number' | 'date' | 'dateRange' | 'select';
  /** Options for select/multi-select filter inputs. */
  filterOptions?: ColumnFilterOption[];
  /**
   * Backend field name to use in the filter descriptor.
   * Defaults to column.key when omitted.
   */
  filterField?: string;
}

interface FilteringProps {
  filters: ColumnFilter[];
  onFilterChange: (field: string, operator: FilterOperator, value: unknown) => void;
  onClearFilter: (field: string) => void;
  onClearAll: () => void;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (row: T) => string | number;
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  selectedRows?: (string | number)[];
  onSelectionChange?: (selectedIds: (string | number)[]) => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
  };
  sorting?: {
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    onSort: (key: string) => void;
  };
  /** When provided, a filter row is rendered below the headers. */
  filtering?: FilteringProps;
}

// ─── FilterCell ──────────────────────────────────────────────────────────────

interface FilterCellProps<T> {
  column: Column<T>;
  activeFilter: ColumnFilter | undefined;
  onFilterChange: (field: string, operator: FilterOperator, value: unknown) => void;
  onClearFilter: (field: string) => void;
}

function FilterCell<T>({ column, activeFilter, onFilterChange, onClearFilter }: FilterCellProps<T>) {
  const field = column.filterField ?? column.key;
  const isActive = !!activeFilter;

  const defaultOp = useCallback((): FilterOperator => {
    switch (column.filterType) {
      case 'number': return 'equals';
      case 'date':   return 'equals';
      case 'select': return 'equals';
      default:       return 'contains';
    }
  }, [column.filterType]);

  const [operator, setOperator] = useState<FilterOperator>(defaultOp);
  const [textValue, setTextValue] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const isBetween = operator === 'between';

  // Sync state when an external clearAll is triggered
  const prevActive = useRef(isActive);
  useEffect(() => {
    if (prevActive.current && !isActive) {
      setTextValue('');
      setRangeFrom('');
      setRangeTo('');
      setOperator(defaultOp());
    }
    prevActive.current = isActive;
  }, [isActive, defaultOp]);

  const emitSingle = useCallback((val: string, op: FilterOperator = operator) => {
    if (!val) {
      onClearFilter(field);
    } else {
      onFilterChange(field, op, val);
    }
  }, [field, operator, onFilterChange, onClearFilter]);

  const emitRange = useCallback((from: string, to: string) => {
    if (from && to) {
      onFilterChange(field, 'between', [from, to]);
    } else {
      onClearFilter(field);
    }
  }, [field, onFilterChange, onClearFilter]);

  const handleOperatorChange = (op: FilterOperator) => {
    setOperator(op);
    if (op === 'between') {
      setTextValue('');
      setRangeFrom('');
      setRangeTo('');
      onClearFilter(field);
    } else {
      if (textValue) onFilterChange(field, op, textValue);
    }
  };

  const handleClear = () => {
    setTextValue('');
    setRangeFrom('');
    setRangeTo('');
    setOperator(defaultOp());
    onClearFilter(field);
  };

  const inputBase = `block w-full rounded border px-1.5 py-[3px] text-xs dark:bg-secondary-800 dark:text-secondary-100 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 ${
    isActive
      ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20'
      : 'border-secondary-300 dark:border-secondary-600'
  }`;

  const selectBase = `rounded border px-1 py-[3px] text-xs dark:bg-secondary-800 dark:text-secondary-100 focus:outline-none focus:ring-1 focus:ring-primary-400 ${
    isActive
      ? 'border-primary-400 dark:border-primary-600'
      : 'border-secondary-300 dark:border-secondary-600'
  }`;

  const clearBtn = (
    <button
      type="button"
      onClick={handleClear}
      className="flex-shrink-0 rounded p-0.5 text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-200"
      title="Clear filter"
    >
      <XMarkIcon className="h-3 w-3" />
    </button>
  );

  if (!column.filterType) return <div />;

  // ── Select ──
  if (column.filterType === 'select') {
    return (
      <div className="flex items-center gap-0.5">
        <select
          value={textValue}
          onChange={(e) => { setTextValue(e.target.value); emitSingle(e.target.value, 'equals'); }}
          className={`${inputBase} cursor-pointer`}
        >
          <option value="">All</option>
          {column.filterOptions?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {isActive && clearBtn}
      </div>
    );
  }

  // ── Date range ──
  if (column.filterType === 'dateRange' || (column.filterType === 'date' && isBetween)) {
    return (
      <div className="flex flex-col gap-0.5">
        {column.filterType === 'date' && (
          <select value={operator} onChange={(e) => handleOperatorChange(e.target.value as FilterOperator)} className={selectBase}>
            <option value="equals">On</option>
            <option value="gte">After</option>
            <option value="lte">Before</option>
            <option value="between">Between</option>
          </select>
        )}
        <div className="flex gap-0.5 items-center">
          <input
            type="date"
            value={rangeFrom}
            onChange={(e) => { setRangeFrom(e.target.value); emitRange(e.target.value, rangeTo); }}
            className={inputBase}
          />
          <span className="text-xs text-secondary-400">–</span>
          <input
            type="date"
            value={rangeTo}
            onChange={(e) => { setRangeTo(e.target.value); emitRange(rangeFrom, e.target.value); }}
            className={inputBase}
          />
          {isActive && clearBtn}
        </div>
      </div>
    );
  }

  // ── Text ──
  if (column.filterType === 'text') {
    return (
      <div className="flex flex-col gap-0.5">
        <select value={operator} onChange={(e) => handleOperatorChange(e.target.value as FilterOperator)} className={selectBase}>
          <option value="contains">Contains</option>
          <option value="startsWith">Starts with</option>
          <option value="equals">Equals</option>
        </select>
        <div className="flex items-center gap-0.5">
          <input
            type="text"
            value={textValue}
            onChange={(e) => { setTextValue(e.target.value); emitSingle(e.target.value); }}
            placeholder="Filter…"
            className={inputBase}
          />
          {isActive && clearBtn}
        </div>
      </div>
    );
  }

  // ── Number ──
  if (column.filterType === 'number') {
    return (
      <div className="flex flex-col gap-0.5">
        <select value={operator} onChange={(e) => handleOperatorChange(e.target.value as FilterOperator)} className={selectBase}>
          <option value="equals">=</option>
          <option value="gt">&gt;</option>
          <option value="gte">≥</option>
          <option value="lt">&lt;</option>
          <option value="lte">≤</option>
          <option value="between">Between</option>
        </select>
        {isBetween ? (
          <div className="flex gap-0.5 items-center">
            <input
              type="number"
              value={rangeFrom}
              onChange={(e) => { setRangeFrom(e.target.value); if (e.target.value && rangeTo) onFilterChange(field, 'between', [e.target.value, rangeTo]); else onClearFilter(field); }}
              placeholder="from"
              className={inputBase}
            />
            <span className="text-xs text-secondary-400">–</span>
            <input
              type="number"
              value={rangeTo}
              onChange={(e) => { setRangeTo(e.target.value); if (rangeFrom && e.target.value) onFilterChange(field, 'between', [rangeFrom, e.target.value]); else onClearFilter(field); }}
              placeholder="to"
              className={inputBase}
            />
            {isActive && clearBtn}
          </div>
        ) : (
          <div className="flex items-center gap-0.5">
            <input
              type="number"
              value={textValue}
              onChange={(e) => { setTextValue(e.target.value); emitSingle(e.target.value); }}
              placeholder="Value"
              className={inputBase}
            />
            {isActive && clearBtn}
          </div>
        )}
      </div>
    );
  }

  // ── Date (single) ──
  if (column.filterType === 'date') {
    return (
      <div className="flex flex-col gap-0.5">
        <select value={operator} onChange={(e) => handleOperatorChange(e.target.value as FilterOperator)} className={selectBase}>
          <option value="equals">On</option>
          <option value="gte">After</option>
          <option value="lte">Before</option>
          <option value="between">Between</option>
        </select>
        <div className="flex items-center gap-0.5">
          <input
            type="date"
            value={textValue}
            onChange={(e) => { setTextValue(e.target.value); emitSingle(e.target.value); }}
            className={inputBase}
          />
          {isActive && clearBtn}
        </div>
      </div>
    );
  }

  return <div />;
}

// ─── DataTable ───────────────────────────────────────────────────────────────

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  isLoading = false,
  emptyMessage = 'No data available',
  onRowClick,
  selectedRows,
  onSelectionChange,
  pagination,
  sorting,
  filtering,
}: DataTableProps<T>) {
  const [internalSelectedRows, setInternalSelectedRows] = useState<Set<string | number>>(
    new Set(selectedRows || [])
  );

  const safeData = useMemo(() => data ?? [], [data]);
  const hasFilters = useMemo(() => columns.some((c) => c.filterType), [columns]);

  const isAllSelected = useMemo(
    () => safeData.length > 0 && safeData.every((row) => internalSelectedRows.has(keyExtractor(row))),
    [safeData, internalSelectedRows, keyExtractor]
  );

  const isSomeSelected = useMemo(
    () => safeData.some((row) => internalSelectedRows.has(keyExtractor(row))) && !isAllSelected,
    [safeData, internalSelectedRows, isAllSelected, keyExtractor]
  );

  const handleSelectAll = () => {
    if (isAllSelected) {
      setInternalSelectedRows(new Set());
      onSelectionChange?.([]);
    } else {
      const allIds = safeData.map(keyExtractor);
      setInternalSelectedRows(new Set(allIds));
      onSelectionChange?.(allIds);
    }
  };

  const handleSelectRow = (rowId: string | number) => {
    const newSelected = new Set(internalSelectedRows);
    if (newSelected.has(rowId)) {
      newSelected.delete(rowId);
    } else {
      newSelected.add(rowId);
    }
    setInternalSelectedRows(newSelected);
    onSelectionChange?.(Array.from(newSelected));
  };

  const getCellValue = (row: T, accessor: Column<T>['accessor']): React.ReactNode => {
    if (typeof accessor === 'function') return accessor(row);
    return row[accessor as keyof T] as React.ReactNode;
  };

  const alignClasses = { left: 'text-left', center: 'text-center', right: 'text-right' };
  const justifyClasses = { left: 'justify-start', center: 'justify-center', right: 'justify-end' };

  const selectionColSpan = onSelectionChange ? 1 : 0;
  const totalCols = columns.length + selectionColSpan;

  const getActiveFilter = (col: Column<T>) =>
    filtering?.filters.find((f) => f.field === (col.filterField ?? col.key));

  return (
    <div
      className="overflow-hidden border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900"
      style={{ borderRadius: 'var(--radius)' }}
    >
      {/* Active filter count + reset button */}
      {filtering && filtering.filters.length > 0 && (
        <div className="flex items-center justify-between border-b border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-800 px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-xs text-secondary-500 dark:text-secondary-400">
            <FunnelIcon className="h-3.5 w-3.5 text-primary-500" />
            {filtering.filters.length} filter{filtering.filters.length > 1 ? 's' : ''} active
          </span>
          <button
            type="button"
            onClick={filtering.onClearAll}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-secondary-500 hover:bg-secondary-200 dark:hover:bg-secondary-700 dark:text-secondary-400"
          >
            <XMarkIcon className="h-3 w-3" />
            Reset all
          </button>
        </div>
      )}

      <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
        <table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
          <thead className="bg-secondary-50 dark:bg-secondary-800 sticky top-0 z-10">
            {/* ── Header row ── */}
            <tr>
              {onSelectionChange && (
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => { if (el) el.indeterminate = isSomeSelected; }}
                    onChange={handleSelectAll}
                    className="h-4 w-4 rounded border-secondary-300 dark:border-secondary-600 text-primary-600 focus:ring-primary-500"
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-2 py-1.5 lg:px-3 lg:py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] ${
                    alignClasses[column.align || 'left']
                  } ${column.width ? `w-[${column.width}]` : ''} ${column.className || ''}`}
                >
                  {column.sortable && sorting ? (
                    <button
                      className={`group inline-flex w-full items-center gap-1 hover:text-secondary-700 dark:hover:text-secondary-300 ${
                        justifyClasses[column.align || 'left']
                      }`}
                      onClick={() => sorting.onSort(column.key)}
                    >
                      <span>{column.header}</span>
                      <span className="flex flex-col">
                        <ChevronUpIcon
                          className={`h-3 w-3 ${
                            sorting.sortBy === column.key && sorting.sortOrder === 'asc'
                              ? 'text-primary-600'
                              : 'text-secondary-400 group-hover:text-secondary-500'
                          }`}
                        />
                        <ChevronDownIcon
                          className={`-mt-1 h-3 w-3 ${
                            sorting.sortBy === column.key && sorting.sortOrder === 'desc'
                              ? 'text-primary-600'
                              : 'text-secondary-400 group-hover:text-secondary-500'
                          }`}
                        />
                      </span>
                    </button>
                  ) : (
                    <div className={`flex items-center gap-1 ${justifyClasses[column.align || 'left']}`}>
                      {column.header}
                      {column.filterType && (
                        <FunnelIcon
                          className={`h-3 w-3 flex-shrink-0 ${
                            getActiveFilter(column)
                              ? 'text-primary-500'
                              : 'text-secondary-300 dark:text-secondary-600'
                          }`}
                        />
                      )}
                    </div>
                  )}
                </th>
              ))}
            </tr>

            {/* ── Filter row ── */}
            {filtering && hasFilters && (
              <tr className="bg-white dark:bg-secondary-900 border-t border-secondary-200 dark:border-secondary-700">
                {onSelectionChange && <th className="w-12 px-4 py-1.5" />}
                {columns.map((column) => (
                  <th
                    key={`filter-${column.key}`}
                    className={`px-2 py-1.5 ${column.className || ''}`}
                  >
                    {column.filterType ? (
                      <FilterCell
                        column={column}
                        activeFilter={getActiveFilter(column)}
                        onFilterChange={filtering.onFilterChange}
                        onClearFilter={filtering.onClearFilter}
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            )}
          </thead>

          <tbody className="divide-y divide-secondary-200 dark:divide-secondary-700 bg-white dark:bg-secondary-900">
            {isLoading ? (
              <tr>
                <td colSpan={totalCols} className="px-4 py-12 text-center">
                  <div className="flex justify-center">
                    <svg className="h-8 w-8 animate-spin text-primary-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                </td>
              </tr>
            ) : safeData.length === 0 ? (
              <tr>
                <td
                  colSpan={totalCols}
                  className="px-4 py-12 text-center text-sm text-secondary-500 dark:text-secondary-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              safeData.map((row) => {
                const rowId = keyExtractor(row);
                const isSelected = internalSelectedRows.has(rowId);
                return (
                  <tr
                    key={rowId}
                    className={`${onRowClick ? 'cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-800' : ''} ${
                      isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                    }`}
                    onClick={() => onRowClick?.(row)}
                  >
                    {onSelectionChange && (
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectRow(rowId)}
                          className="h-4 w-4 rounded border-secondary-300 dark:border-secondary-600 text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                    )}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`whitespace-nowrap px-2 py-1.5 lg:px-3 lg:py-2 text-xs text-secondary-900 dark:text-secondary-100 ${
                          alignClasses[column.align || 'left']
                        } ${column.className || ''}`}
                      >
                        {getCellValue(row, column.accessor)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="flex flex-col xs:flex-row items-start xs:items-center justify-between gap-1.5 border-t border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900 px-2.5 py-1.5 lg:px-3 lg:py-2">
          <div className="flex items-center text-xs sm:text-sm text-secondary-500 dark:text-secondary-400">
            <span className="hidden sm:inline">Rows per page:</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => pagination.onPageSizeChange(Number(e.target.value))}
              className="mx-1 sm:mx-2 rounded border-secondary-300 dark:border-secondary-600 dark:bg-secondary-800 dark:text-secondary-100 text-xs sm:text-sm focus:border-primary-500 focus:ring-primary-500 py-1"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="whitespace-nowrap">
              {(pagination.page - 1) * pagination.pageSize + 1}–
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
            </span>
          </div>

          <div className="flex items-center space-x-0.5 sm:space-x-1">
            <button
              onClick={() => pagination.onPageChange(1)}
              disabled={pagination.page === 1}
              className="rounded p-1 text-secondary-500 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDoubleLeftIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="rounded p-1 text-secondary-500 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeftIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <span className="px-1.5 sm:px-2 text-xs sm:text-sm text-secondary-700 dark:text-secondary-300 whitespace-nowrap">
              {pagination.page}/{Math.ceil(pagination.total / pagination.pageSize)}
            </span>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= Math.ceil(pagination.total / pagination.pageSize)}
              className="rounded p-1 text-secondary-500 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronRightIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <button
              onClick={() => pagination.onPageChange(Math.ceil(pagination.total / pagination.pageSize))}
              disabled={pagination.page >= Math.ceil(pagination.total / pagination.pageSize)}
              className="rounded p-1 text-secondary-500 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDoubleRightIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
