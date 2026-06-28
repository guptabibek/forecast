import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { DetailPopupActions } from '@components/reports/DetailPopupActions';
import { EyeIcon } from '@heroicons/react/24/outline';
import { useTableFilters } from '@/hooks/useTableFilters';
import { batchService, dataService, uomService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { Batch, BatchStatus } from '../../types';
import { formatInr } from '@utils/number-format';
import { useConfirmAction } from '@/hooks/useConfirmAction';
import { ConfirmDialog } from '@components/common/ConfirmDialog';

const safeFormat = (dateVal: any, fmt: string, fallback = '—') => {
  try {
    if (!dateVal) return fallback;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return fallback;
    return format(d, fmt);
  } catch {
    return fallback;
  }
};

const BATCH_STATUSES: BatchStatus[] = ['CREATED', 'IN_PROCESS', 'AVAILABLE', 'QUARANTINE', 'EXPIRED', 'CONSUMED', 'RECALLED'];

const statusVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  CREATED: 'secondary',
  IN_PROCESS: 'primary',
  AVAILABLE: 'success',
  QUARANTINE: 'warning',
  EXPIRED: 'error',
  CONSUMED: 'secondary',
  RECALLED: 'error',
};

const emptyForm = {
  productId: '',
  locationId: '',
  quantity: 0,
  uom: 'EA',
  status: 'CREATED' as BatchStatus,
  manufacturingDate: '',
  expiryDate: '',
  costPerUnit: 0,
  notes: '',
};

export default function BatchManagementPage() {
  
  const confirmAction1 = useConfirmAction({
    title: 'Confirm Action',
    message: "Delete this batch?",
    variant: 'danger',
  });
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<Batch | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Sorting state
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Column-level filters
  const { filters, debouncedFilters, setFilter, clearFilter, clearAll, toQueryParam } = useTableFilters();

  // Reset to page 1 whenever filters or sort change
  const handleFilterChange = (field: string, operator: any, value: unknown) => {
    setPage(1);
    setFilter(field, operator, value);
  };
  const handleClearFilter = (field: string) => {
    setPage(1);
    clearFilter(field);
  };
  const handleClearAll = () => {
    setPage(1);
    clearAll();
  };

  const handleSort = (key: string) => {
    if (key === sortBy) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder('asc');
    }
    setPage(1);
  };

  // Main data query — queryKey includes debouncedFilters so React Query
  // only refetches after the debounce settles.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'batches', { page, pageSize, sortBy, sortOrder, filters: debouncedFilters }],
    queryFn: () =>
      batchService.getAll({
        page,
        pageSize,
        sortBy,
        sortDir: sortOrder,
        filters: toQueryParam(),
      }),
    placeholderData: (prev) => prev,
  });

  const items: Batch[] = Array.isArray(data?.items) ? data.items : [];
  const total: number = data?.total ?? 0;

  // Fetch locations for dropdown
  const { data: locations = [] } = useQuery({
    queryKey: ['locations-list'],
    queryFn: () => dataService.getLocations(),
    staleTime: 60_000,
  });

  // Fetch UOMs for dropdown
  const { data: uomData } = useQuery({
    queryKey: ['uoms-list'],
    queryFn: () => uomService.getAll({ isActive: true, pageSize: 200 }),
    staleTime: 60_000,
  });
  const uomList: { id: string; code: string; name: string }[] = Array.isArray(uomData?.items) ? uomData.items : Array.isArray(uomData) ? uomData : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => batchService.create({
      productId: d.productId,
      locationId: d.locationId,
      quantity: Number(d.quantity),
      uom: d.uom || 'EA',
      status: d.status || undefined,
      manufacturingDate: d.manufacturingDate || undefined,
      expiryDate: d.expiryDate || undefined,
      costPerUnit: d.costPerUnit ? Number(d.costPerUnit) : undefined,
      notes: d.notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'batches'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('Batch created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create batch'); },
  });

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => batchService.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'batches'] });
      toast.success('Batch status updated');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update batch'); },
  });

  // View-only mode: deleteMut block commented out. Restore to re-enable CRUD.
  /*
  const deleteMut = useMutation({
    mutationFn: (id: string) => batchService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'batches'] });
      toast.success('Batch deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete batch'); },
  });
  */

  const isExpiringSoon = (expiryDate?: string) => {
    if (!expiryDate) return false;
    const d = new Date(expiryDate);
    const now = new Date();
    return d.getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000 && d.getTime() > now.getTime();
  };

  const columns: Column<Batch>[] = [
    {
      key: 'batchNumber',
      header: 'Batch #',
      accessor: 'batchNumber',
      sortable: true,
      filterType: 'text',
      filterField: 'batchNumber',
    },
    {
      key: 'product',
      header: 'Product',
      filterType: 'select',
      filterField: 'productId',
      filterOptions: Array.from(
        new Map(items.map((batch) => [batch.productId, batch.product?.name || batch.productId])).entries(),
      ).map(([value, label]) => ({ value, label })),
      accessor: (r) => r.product?.name || r.productId,
    },
    {
      key: 'location',
      header: 'Location',
      filterType: 'select',
      filterField: 'locationId',
      filterOptions: (locations as any[]).map((location: any) => ({
        value: location.id,
        label: location.name || location.code || location.id,
      })),
      accessor: (r) => r.location?.name || r.locationId,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => <Badge variant={statusVariant[r.status] || 'secondary'} size="sm">{r.status}</Badge>,
      filterType: 'select',
      filterField: 'status',
      filterOptions: BATCH_STATUSES.map((s) => ({ value: s, label: s })),
    },
    {
      key: 'quantity',
      header: 'Quantity',
      accessor: (r) => `${Number(r.quantity).toLocaleString()} ${r.uom}`,
      align: 'right',
      sortable: true,
      filterType: 'number',
      filterField: 'quantity',
    },
    {
      key: 'availableQty',
      header: 'Available',
      accessor: (r) => `${Number(r.availableQty).toLocaleString()} ${r.uom}`,
      align: 'right',
      filterType: 'number',
      filterField: 'availableQty',
    },
    {
      key: 'expiryDate',
      header: 'Expiry Date',
      sortable: true,
      accessor: (r) => {
        const formatted = safeFormat(r.expiryDate, 'MMM dd, yyyy');
        if (isExpiringSoon(r.expiryDate)) return <span className="text-yellow-600 font-medium">{formatted} ⚠</span>;
        if (r.expiryDate && new Date(r.expiryDate) < new Date()) return <span className="text-red-600 font-medium">{formatted} ✗</span>;
        return formatted;
      },
      filterType: 'date',
      filterField: 'expiryDate',
    },
    {
      key: 'mfgDate',
      header: 'Mfg Date',
      accessor: (r) => safeFormat(r.manufacturingDate, 'MMM dd, yyyy'),
      filterType: 'date',
      filterField: 'manufacturingDate',
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelected(r); setShowDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800">
            <EyeIcon className="h-4 w-4" />
          </button>
          {/* View-only mode: delete disabled.
          <button onClick={() => { confirmAction1.confirm(() => deleteMut.mutate(r.id)) }} className="p-1 text-red-600 hover:text-red-800">
            <TrashIcon className="h-4 w-4" />
          </button>
          */}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold">Batch Management</h1>
          <p className="text-secondary-500 mt-1">Track and manage product batches, lot numbers, and expiry dates</p>
        </div>
        {/* View-only mode: New Batch disabled. */}
        {/* <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>
          New Batch
        </Button> */}
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <Card>
          <div className="p-4">
            <p className="text-xs lg:text-sm text-gray-500">Total (this page)</p>
            <p className="text-xl lg:text-2xl font-bold">{total}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs lg:text-sm text-gray-500">Available</p>
            <p className="text-xl lg:text-2xl font-bold text-green-600">{items.filter(b => b.status === 'AVAILABLE').length}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs lg:text-sm text-gray-500">Quarantine</p>
            <p className="text-xl lg:text-2xl font-bold text-yellow-600">{items.filter(b => b.status === 'QUARANTINE').length}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs lg:text-sm text-gray-500">Expiring Soon</p>
            <p className="text-xl lg:text-2xl font-bold text-red-600">{items.filter(b => isExpiringSoon(b.expiryDate)).length}</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Batches" description="Filter per column · Sort by clicking header · Server-side" />
        <DataTable
          data={items}
          columns={columns}
          keyExtractor={(r) => r.id}
          isLoading={isLoading}
          emptyMessage="No batches found"
          onRowClick={(row) => { setSelected(row); setShowDetail(true); }}
          sorting={{ sortBy, sortOrder, onSort: handleSort }}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: (s) => { setPageSize(s); setPage(1); },
          }}
          filtering={{
            filters,
            onFilterChange: handleFilterChange,
            onClearFilter: handleClearFilter,
            onClearAll: handleClearAll,
          }}
        />
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Batch" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
              <ProductSelector value={form.productId || undefined} onChange={(id) => setForm({ ...form, productId: id })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location *</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                <option value="">Select location...</option>
                {(locations as any[]).map((loc: any) => (
                  <option key={loc.id} value={loc.id}>{loc.name || loc.code || loc.id}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
              <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">UOM *</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })}>
                <option value="">Select UOM...</option>
                {uomList.map((u: any) => (
                  <option key={u.id} value={u.code}>{u.code} — {u.name}</option>
                ))}
                {uomList.length === 0 && <option value="EA">EA — Each</option>}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost per Unit</label>
              <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: +e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manufacturing Date</label>
              <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.manufacturingDate} onChange={(e) => setForm({ ...form, manufacturingDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
              <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.productId || !form.locationId || form.quantity <= 0}>Create</Button>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); }} title={selected ? `Batch ${selected.batchNumber}` : 'Batch Detail'} size="lg">
        {selected && (
          <div className="space-y-4">
            <DetailPopupActions
              title="Batch Detail"
              documentNumber={selected.batchNumber}
              fields={[
                { label: 'Batch Number', value: selected.batchNumber },
                { label: 'Item', value: selected.product?.name || selected.productId },
                { label: 'Warehouse', value: selected.location?.name || selected.locationId },
                { label: 'Status', value: selected.status },
                { label: 'Quantity', value: `${Number(selected.quantity).toLocaleString()} ${selected.uom}` },
                { label: 'Amount', value: selected.costPerUnit != null ? formatInr(Number(selected.quantity) * selected.costPerUnit) : '—' },
                { label: 'Expiry Date', value: safeFormat(selected.expiryDate, 'MMM dd, yyyy') },
              ]}
              totals={[
                { label: 'Available', value: `${Number(selected.availableQty).toLocaleString()} ${selected.uom}` },
                { label: 'Cost/Unit', value: selected.costPerUnit != null ? formatInr(selected.costPerUnit) : '—' },
              ]}
            />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><span className="font-medium text-gray-500">Product:</span> {selected.product?.name || selected.productId}</div>
              <div><span className="font-medium text-gray-500">Location:</span> {selected.location?.name || selected.locationId}</div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={statusVariant[selected.status] || 'secondary'} size="sm">{selected.status}</Badge></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><span className="font-medium text-gray-500">Quantity:</span> {Number(selected.quantity).toLocaleString()} {selected.uom}</div>
              <div><span className="font-medium text-gray-500">Available:</span> {Number(selected.availableQty).toLocaleString()} {selected.uom}</div>
              <div><span className="font-medium text-gray-500">Cost/Unit:</span> {selected.costPerUnit != null ? formatInr(selected.costPerUnit) : '—'}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="font-medium text-gray-500">Mfg Date:</span> {safeFormat(selected.manufacturingDate, 'MMM dd, yyyy')}</div>
              <div><span className="font-medium text-gray-500">Expiry Date:</span> {safeFormat(selected.expiryDate, 'MMM dd, yyyy')}</div>
            </div>
            {selected.notes && (
              <div className="text-sm"><span className="font-medium text-gray-500">Notes:</span> {selected.notes}</div>
            )}
            <div className="border-t pt-4 mt-4">
              <h3 className="text-sm font-semibold mb-2">Change Status</h3>
              <div className="flex gap-2 flex-wrap">
                {BATCH_STATUSES.filter(s => s !== selected.status).map(s => (
                  <Button key={s} variant="secondary" size="sm" onClick={() => {
                    updateStatusMut.mutate({ id: selected.id, status: s });
                    setSelected({ ...selected, status: s });
                  }}>{s}</Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    
      <ConfirmDialog open={confirmAction1.confirmProps.isOpen} onCancel={confirmAction1.confirmProps.onClose} onConfirm={confirmAction1.confirmProps.onConfirm} title={confirmAction1.confirmProps.title} message={confirmAction1.confirmProps.message} variant={confirmAction1.confirmProps.variant as any} confirmLabel={confirmAction1.confirmProps.confirmText} />
    </div>
  );
}