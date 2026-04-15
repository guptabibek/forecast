import type { Dimension } from '@/types';
import {
    ArrowPathIcon,
    BuildingOffice2Icon,
    BuildingStorefrontIcon,
    MagnifyingGlassIcon,
    MapPinIcon,
} from '@heroicons/react/24/outline';
import { dataService } from '@services/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    SortingState,
    useReactTable,
} from '@tanstack/react-table';
import clsx from 'clsx';
import { useState } from 'react';
import toast from 'react-hot-toast';

const columnHelper = createColumnHelper<Dimension>();

const columns = [
  columnHelper.accessor('code', {
    header: 'Code',
    cell: (info) => (
      <span className="font-mono text-sm font-medium text-secondary-900 dark:text-secondary-100">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => (
      <span className="font-medium text-secondary-900 dark:text-secondary-100">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('description', {
    header: 'Description',
    cell: (info) => (
      <span className="text-secondary-500 dark:text-secondary-400">
        {info.getValue() || '-'}
      </span>
    ),
  }),
  columnHelper.accessor((row) => (row.attributes as any)?.type || '-', {
    id: 'type',
    header: 'Type',
    cell: (info) => {
      const type = info.getValue();
      const colorMap: Record<string, string> = {
        STORE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        WAREHOUSE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
        REGION: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
        COUNTRY: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
      };
      return (
        <span
          className={clsx(
            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
            colorMap[type] || 'bg-secondary-100 text-secondary-800 dark:bg-secondary-700 dark:text-secondary-300',
          )}
        >
          {type}
        </span>
      );
    },
  }),
  columnHelper.accessor('isActive', {
    header: 'Status',
    cell: (info) => (
      <span
        className={clsx(
          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
          info.getValue()
            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
        )}
      >
        {info.getValue() ? 'Active' : 'Inactive'}
      </span>
    ),
  }),
];

export default function Locations() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const { data: locations = [], isLoading, isRefetching } = useQuery({
    queryKey: ['locations'],
    queryFn: () => dataService.getLocations(),
    staleTime: 30_000,
  });

  const filteredLocations = locations.filter((loc) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      loc.code?.toLowerCase().includes(term) ||
      loc.name?.toLowerCase().includes(term) ||
      loc.description?.toLowerCase().includes(term)
    );
  });

  const table = useReactTable({
    data: filteredLocations,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['locations'] });
    toast.success('Refreshed locations');
  };

  const activeCount = locations.filter((l) => l.isActive).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">
            Locations
          </h1>
          <p className="mt-1 text-sm text-secondary-500 dark:text-secondary-400">
            Manage branches, stores, and warehouses synced from Marg EDE
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefetching}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          <ArrowPathIcon className={clsx('w-4 h-4', isRefetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-secondary-800 rounded-xl p-4 border border-secondary-200 dark:border-secondary-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <MapPinIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-secondary-500 dark:text-secondary-400">Total Locations</p>
              <p className="text-xl font-bold text-secondary-900 dark:text-white">
                {locations.length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-secondary-800 rounded-xl p-4 border border-secondary-200 dark:border-secondary-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <BuildingStorefrontIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-secondary-500 dark:text-secondary-400">Active</p>
              <p className="text-xl font-bold text-secondary-900 dark:text-white">
                {activeCount}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-secondary-800 rounded-xl p-4 border border-secondary-200 dark:border-secondary-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
              <BuildingOffice2Icon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-secondary-500 dark:text-secondary-400">Inactive</p>
              <p className="text-xl font-bold text-secondary-900 dark:text-white">
                {locations.length - activeCount}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code or name..."
            className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-white placeholder-secondary-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <ArrowPathIcon className="w-6 h-6 animate-spin text-primary-500" />
            <span className="ml-2 text-secondary-500">Loading locations...</span>
          </div>
        ) : filteredLocations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-secondary-400">
            <MapPinIcon className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-lg font-medium">No locations found</p>
            <p className="text-sm mt-1">
              {search
                ? 'Try adjusting your search'
                : 'Sync from Marg EDE to populate locations'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
              <thead className="bg-secondary-50 dark:bg-secondary-900/50">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 cursor-pointer select-none hover:text-secondary-700 dark:hover:text-secondary-300"
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === 'asc' && ' ↑'}
                          {header.column.getIsSorted() === 'desc' && ' ↓'}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-secondary-100 dark:divide-secondary-700/50">
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-secondary-50 dark:hover:bg-secondary-700/30 transition-colors"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 text-sm whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
