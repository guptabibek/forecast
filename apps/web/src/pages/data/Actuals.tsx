import type { Actual, Dimension } from '@/types';
import {
    ArrowDownTrayIcon,
    ArrowPathIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    FunnelIcon,
    MagnifyingGlassIcon,
    XMarkIcon,
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
import { format } from 'date-fns';
import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';

const columnHelper = createColumnHelper<Actual>();

// Helper functions to get display names from nested relations
const getProductName = (actual: Actual) => {
  if (actual.product?.name) return actual.product.name;
  if (actual.product?.code) return actual.product.code;
  return actual.productId || '-';
};

const getLocationName = (actual: Actual) => {
  if (actual.location?.name) return actual.location.name;
  if (actual.location?.code) return actual.location.code;
  return actual.locationId || '-';
};

const getCustomerName = (actual: Actual) => {
  if (actual.customer?.name) return actual.customer.name;
  if (actual.customer?.code) return actual.customer.code;
  return actual.customerId || '-';
};

const getAccountName = (actual: Actual) => {
  if (actual.account?.name) return actual.account.name;
  if (actual.account?.code) return actual.account.code;
  return actual.accountId || '-';
};

const getPeriodDate = (actual: Actual) => {
  const dateStr = actual.periodDate || actual.period;
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? String(dateStr) : format(date, 'MMM yyyy');
  } catch {
    return String(dateStr);
  }
};

const getValue = (actual: Actual) => {
  const value = actual.amount ?? actual.value;
  return value != null ? Number(value) : null;
};

/**
 * Actuals Data Page
 * 
 * This page displays historical actual data (sales, revenue, quantities) that serves as:
 * 1. The foundation for forecast model training
 * 2. Historical reference for variance analysis
 * 3. Audit trail for actual business performance
 * 
 * Data is typically imported from ERP/CRM systems or uploaded via CSV/Excel files.
 */
export default function Actuals() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pageSize = 50;

  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [filterProductId, setFilterProductId] = useState<string>('');
  const [filterLocationId, setFilterLocationId] = useState<string>('');
  const [filterCustomerId, setFilterCustomerId] = useState<string>('');
  const [filterAccountId, setFilterAccountId] = useState<string>('');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');

  // Fetch actuals with filters
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['actuals', { page, search, filterProductId, filterLocationId, filterCustomerId, filterAccountId, filterStartDate, filterEndDate }],
    queryFn: () =>
      dataService.getActuals({
        page,
        pageSize,
        search: search || undefined,
        productId: filterProductId || undefined,
        locationId: filterLocationId || undefined,
        customerId: filterCustomerId || undefined,
        accountId: filterAccountId || undefined,
        startDate: filterStartDate || undefined,
        endDate: filterEndDate || undefined,
      }),
    staleTime: 30000,
  });

  // Fetch summary
  const { data: summary } = useQuery({
    queryKey: ['actuals-summary'],
    queryFn: dataService.getActualsSummary,
    staleTime: 60000,
  });

  // Fetch dimensions for filter dropdowns - ONLY when filter panel is open (lazy loading)
  const { data: products } = useQuery({
    queryKey: ['dimensions', 'product'],
    queryFn: () => dataService.getProducts({ limit: 100 }),
    staleTime: 300000,
    enabled: showFilters, // Only fetch when filters are shown
  });

  const { data: locations } = useQuery({
    queryKey: ['dimensions', 'location'],
    queryFn: () => dataService.getLocations({ limit: 100 }),
    staleTime: 300000,
    enabled: showFilters, // Only fetch when filters are shown
  });

  const { data: customers } = useQuery({
    queryKey: ['dimensions', 'customer'],
    queryFn: () => dataService.getCustomers({ limit: 100 }),
    staleTime: 300000,
    enabled: showFilters, // Only fetch when filters are shown
  });

  const { data: accounts } = useQuery({
    queryKey: ['dimensions', 'account'],
    queryFn: () => dataService.getAccounts({ limit: 100 }),
    staleTime: 300000,
    enabled: showFilters, // Only fetch when filters are shown
  });

  const columns = [
    columnHelper.accessor((row) => getPeriodDate(row), {
      id: 'period',
      header: 'Period',
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor((row) => getProductName(row), {
      id: 'product',
      header: 'Product',
      cell: (info) => {
        const value = info.getValue();
        return value !== '-' ? (
          <span className="font-medium">{value}</span>
        ) : (
          <span className="text-secondary-400">-</span>
        );
      },
    }),
    columnHelper.accessor((row) => getLocationName(row), {
      id: 'location',
      header: 'Location',
      cell: (info) => {
        const value = info.getValue();
        return value !== '-' ? value : <span className="text-secondary-400">-</span>;
      },
    }),
    columnHelper.accessor((row) => getCustomerName(row), {
      id: 'customer',
      header: 'Customer',
      cell: (info) => {
        const value = info.getValue();
        return value !== '-' ? value : <span className="text-secondary-400">-</span>;
      },
    }),
    columnHelper.accessor((row) => getAccountName(row), {
      id: 'account',
      header: 'Account',
      cell: (info) => {
        const value = info.getValue();
        return value !== '-' ? value : <span className="text-secondary-400">-</span>;
      },
    }),
    columnHelper.accessor((row) => getValue(row), {
      id: 'value',
      header: 'Value',
      cell: (info) => {
        const value = info.getValue();
        return value != null ? (
          <span className="font-mono text-right block">${value.toLocaleString()}</span>
        ) : (
          <span className="text-secondary-400">-</span>
        );
      },
    }),
    columnHelper.accessor('quantity', {
      header: 'Quantity',
      cell: (info) => {
        const value = info.getValue();
        return value != null ? (
          <span className="font-mono text-right block">{Number(value).toLocaleString()}</span>
        ) : (
          <span className="text-secondary-400">-</span>
        );
      },
    }),
    columnHelper.accessor((row) => row.actualType || row.source, {
      id: 'source',
      header: 'Type/Source',
      cell: (info) => {
        const value = info.getValue();
        return value ? (
          <span className="badge badge-primary text-xs">{value}</span>
        ) : (
          <span className="text-secondary-400">-</span>
        );
      },
    }),
  ];

  const actuals = data?.data || [];
  const totalPages = data?.meta?.totalPages || 1;
  const totalRecords = data?.meta?.total || 0;

  const table = useReactTable({
    data: actuals,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['actuals'] }),
        queryClient.invalidateQueries({ queryKey: ['actuals-summary'] }),
      ]);
      await refetch();
      toast.success('Data refreshed');
    } catch {
      toast.error('Failed to refresh data');
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, refetch]);

  // Handle clear filters
  const handleClearFilters = useCallback(() => {
    setFilterProductId('');
    setFilterLocationId('');
    setFilterCustomerId('');
    setFilterAccountId('');
    setFilterStartDate('');
    setFilterEndDate('');
    setSearch('');
    setPage(1);
    toast.success('Filters cleared');
  }, []);

  // Check if any filters are active
  const hasActiveFilters = filterProductId || filterLocationId || filterCustomerId || filterAccountId || filterStartDate || filterEndDate || search;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Actuals Data</h1>
          <p className="text-secondary-500 mt-1">
            Historical actual data for forecast model training and variance analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="btn-secondary"
            title="Refresh data"
          >
            <ArrowPathIcon className={clsx('w-5 h-5', isRefreshing && 'animate-spin')} />
          </button>
          <button className="btn-secondary">
            <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
            Export
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Total Records</p>
            <p className="text-2xl font-bold">{summary.totalRecords.toLocaleString()}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Date Range</p>
            <p className="text-lg font-semibold">
              {summary.dateRange?.start && summary.dateRange?.end
                ? `${format(new Date(summary.dateRange.start), 'MMM yyyy')} - ${format(
                    new Date(summary.dateRange.end),
                    'MMM yyyy',
                  )}`
                : 'N/A'}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Last Updated</p>
            <p className="text-lg font-semibold">
              {summary.lastUpdated
                ? format(new Date(summary.lastUpdated), 'MMM d, yyyy HH:mm')
                : 'N/A'}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Data Types</p>
            <p className="text-lg font-semibold">
              {Object.keys(summary.byType || summary.bySource || {}).length} types
            </p>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
            <input
              type="text"
              placeholder="Search actuals..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="input pl-10 w-full"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'btn-secondary',
              showFilters && 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300',
              hasActiveFilters && 'ring-2 ring-primary-500'
            )}
          >
            <FunnelIcon className="w-5 h-5 mr-2" />
            Filters
            {hasActiveFilters && (
              <span className="ml-2 bg-primary-500 text-white text-xs rounded-full px-2 py-0.5">
                Active
              </span>
            )}
          </button>
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="btn-secondary text-error-600 hover:text-error-700"
            >
              <XMarkIcon className="w-5 h-5 mr-1" />
              Clear
            </button>
          )}
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="border-t border-secondary-200 dark:border-secondary-700 pt-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Product Filter */}
              <div>
                <label className="label">Product</label>
                <select
                  value={filterProductId}
                  onChange={(e) => { setFilterProductId(e.target.value); setPage(1); }}
                  className="input"
                >
                  <option value="">All Products</option>
                  {(products as Dimension[] || []).map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Location Filter */}
              <div>
                <label className="label">Location</label>
                <select
                  value={filterLocationId}
                  onChange={(e) => { setFilterLocationId(e.target.value); setPage(1); }}
                  className="input"
                >
                  <option value="">All Locations</option>
                  {(locations as Dimension[] || []).map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} ({location.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Customer Filter */}
              <div>
                <label className="label">Customer</label>
                <select
                  value={filterCustomerId}
                  onChange={(e) => { setFilterCustomerId(e.target.value); setPage(1); }}
                  className="input"
                >
                  <option value="">All Customers</option>
                  {(customers as Dimension[] || []).map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} ({customer.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Account Filter */}
              <div>
                <label className="label">Account</label>
                <select
                  value={filterAccountId}
                  onChange={(e) => { setFilterAccountId(e.target.value); setPage(1); }}
                  className="input"
                >
                  <option value="">All Accounts</option>
                  {(accounts as Dimension[] || []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Range */}
              <div>
                <label className="label">Start Date</label>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => { setFilterStartDate(e.target.value); setPage(1); }}
                  className="input"
                />
              </div>
              <div>
                <label className="label">End Date</label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => { setFilterEndDate(e.target.value); setPage(1); }}
                  className="input"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Data Table */}
      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={clsx(
                        header.column.getCanSort() && 'cursor-pointer select-none hover:bg-secondary-100 dark:hover:bg-secondary-800',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {{
                          asc: <ChevronUpIcon className="w-4 h-4 text-primary-500" />,
                          desc: <ChevronDownIcon className="w-4 h-4 text-primary-500" />,
                        }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
                      <span className="text-secondary-500">Loading actuals...</span>
                    </div>
                  </td>
                </tr>
              ) : actuals.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-12 text-secondary-500">
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-lg font-medium">No actuals data found</p>
                      <p className="text-sm">
                        {hasActiveFilters 
                          ? 'Try adjusting your filters or clearing them'
                          : 'Import data to get started'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-secondary-200 dark:border-secondary-700 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-secondary-500">
            Showing {actuals.length > 0 ? ((page - 1) * pageSize) + 1 : 0} to {Math.min(page * pageSize, totalRecords)} of {totalRecords.toLocaleString()} records
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="btn-secondary btn-sm"
            >
              First
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary btn-sm"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-sm">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary btn-sm"
            >
              Next
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="btn-secondary btn-sm"
            >
              Last
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
