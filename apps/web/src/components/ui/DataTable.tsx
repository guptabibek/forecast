import {
    ChevronDoubleLeftIcon,
    ChevronDoubleRightIcon,
    ChevronDownIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronUpIcon,
} from '@heroicons/react/20/solid';
import React, { useMemo, useState } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
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
}

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
}: DataTableProps<T>) {
  const [internalSelectedRows, setInternalSelectedRows] = useState<Set<string | number>>(
    new Set(selectedRows || [])
  );

  const safeData = useMemo(() => data ?? [], [data]);

  const isAllSelected = useMemo(() => {
    return safeData.length > 0 && safeData.every((row) => internalSelectedRows.has(keyExtractor(row)));
  }, [safeData, internalSelectedRows, keyExtractor]);

  const isSomeSelected = useMemo(() => {
    return safeData.some((row) => internalSelectedRows.has(keyExtractor(row))) && !isAllSelected;
  }, [safeData, internalSelectedRows, isAllSelected, keyExtractor]);

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
    if (typeof accessor === 'function') {
      return accessor(row);
    }
    const value = row[accessor as keyof T];
    return value as React.ReactNode;
  };

  const alignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <div className="overflow-hidden border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900" style={{ borderRadius: 'var(--radius)' }}>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
          <thead className="bg-secondary-50 dark:bg-secondary-800">
            <tr>
              {onSelectionChange && (
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isSomeSelected;
                    }}
                    onChange={handleSelectAll}
                    className="h-4 w-4 rounded border-secondary-300 dark:border-secondary-600 text-primary-600 focus:ring-primary-500"
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] ${
                    alignClasses[column.align || 'left']
                  } ${column.width ? `w-[${column.width}]` : ''} ${column.className || ''}`}
                >
                  {column.sortable && sorting ? (
                    <button
                      className="group inline-flex items-center space-x-1 hover:text-secondary-700 dark:hover:text-secondary-300"
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
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-200 dark:divide-secondary-700 bg-white dark:bg-secondary-900">
            {isLoading ? (
              <tr>
                <td
                  colSpan={columns.length + (onSelectionChange ? 1 : 0)}
                  className="px-4 py-12 text-center"
                >
                  <div className="flex justify-center">
                    <svg
                      className="h-8 w-8 animate-spin text-primary-600"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  </div>
                </td>
              </tr>
            ) : safeData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (onSelectionChange ? 1 : 0)}
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
                    className={`
                      ${onRowClick ? 'cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-800' : ''}
                      ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : ''}
                    `}
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
                        className={`whitespace-nowrap px-4 py-4 text-sm text-secondary-900 dark:text-secondary-100 ${
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
        <div className="flex items-center justify-between border-t border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900 px-4 py-3">
          <div className="flex items-center text-sm text-secondary-500 dark:text-secondary-400">
            <span>Rows per page:</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => pagination.onPageSizeChange(Number(e.target.value))}
              className="mx-2 rounded border-secondary-300 dark:border-secondary-600 dark:bg-secondary-800 dark:text-secondary-100 text-sm focus:border-primary-500 focus:ring-primary-500"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span>
              {(pagination.page - 1) * pagination.pageSize + 1}-
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
              {pagination.total}
            </span>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => pagination.onPageChange(1)}
              disabled={pagination.page === 1}
              className="rounded p-1 text-secondary-500 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDoubleLeftIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="rounded p-1 text-secondary-500 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <span className="px-2 text-sm text-secondary-700 dark:text-secondary-300">
              Page {pagination.page} of {Math.ceil(pagination.total / pagination.pageSize)}
            </span>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= Math.ceil(pagination.total / pagination.pageSize)}
              className="rounded p-1 text-secondary-500 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() =>
                pagination.onPageChange(Math.ceil(pagination.total / pagination.pageSize))
              }
              disabled={pagination.page >= Math.ceil(pagination.total / pagination.pageSize)}
              className="rounded p-1 text-secondary-500 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDoubleRightIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
