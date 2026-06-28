import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useGridState } from '@/hooks/useGridState';
import { productCostingService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { CostType, ProductCosting } from '../../types';
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

const costTypeVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  STANDARD: 'primary',
  ACTUAL: 'success',
  PLANNED: 'warning',
  BUDGET: 'secondary',
};

const emptyForm = {
  productId: '',
  locationId: '',
  costType: 'STANDARD' as CostType,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: '',
  materialCost: 0,
  laborCost: 0,
  overheadCost: 0,
  subcontractCost: 0,
  currency: 'INR',
  version: '',
  notes: '',
};

export default function ProductCostingPage() {
  
  const confirmAction1 = useConfirmAction({
    title: 'Confirm Action',
    message: "Delete this costing record?",
    variant: 'danger',
  });
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<ProductCosting | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);

  const grid = useGridState({ initialSortBy: 'effectiveFrom', initialSortOrder: 'desc' });

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'product-costings', grid.queryKey],
    queryFn: () => productCostingService.getAll(grid.queryParams),
    placeholderData: (prev) => prev,
  });

  const items: ProductCosting[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const total = (data as any)?.total ?? items.length;

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => productCostingService.create({
      productId: d.productId,
      locationId: d.locationId || undefined,
      costType: d.costType,
      effectiveFrom: d.effectiveFrom,
      effectiveTo: d.effectiveTo || undefined,
      materialCost: Number(d.materialCost),
      laborCost: Number(d.laborCost),
      overheadCost: Number(d.overheadCost),
      subcontractCost: Number(d.subcontractCost),
      currency: d.currency,
      version: d.version || undefined,
      notes: d.notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'product-costings'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('Product costing created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create costing'); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<ProductCosting> }) => productCostingService.update(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'product-costings'] });
      setShowEdit(false);
      toast.success('Product costing updated');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update costing'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => productCostingService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'product-costings'] });
      toast.success('Costing deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete costing'); },
  });

  const columns: Column<ProductCosting>[] = [
    { key: 'product', header: 'Product', accessor: (r) => r.product?.name || r.productId },
    { key: 'location', header: 'Location', accessor: (r) => r.location?.name || r.locationId || '—' },
    {
      key: 'costType', header: 'Cost Type',
      accessor: (r) => <Badge variant={costTypeVariant[r.costType] || 'secondary'} size="sm">{r.costType}</Badge>,
      filterType: 'select', filterField: 'costType',
      filterOptions: [
        { value: 'STANDARD', label: 'Standard' },
        { value: 'ACTUAL', label: 'Actual' },
        { value: 'PLANNED', label: 'Planned' },
        { value: 'BUDGET', label: 'Budget' },
      ],
    },
    { key: 'materialCost', header: 'Material', accessor: (r) => formatInr(r.materialCost), align: 'right', filterType: 'number', filterField: 'materialCost' },
    { key: 'laborCost', header: 'Labor', accessor: (r) => formatInr(r.laborCost), align: 'right', filterType: 'number', filterField: 'laborCost' },
    { key: 'overheadCost', header: 'Overhead', accessor: (r) => formatInr(r.overheadCost), align: 'right', filterType: 'number', filterField: 'overheadCost' },
    {
      key: 'totalCost', header: 'Total Cost',
      accessor: (r) => <span className="font-semibold">{formatInr(r.totalCost)}</span>,
      align: 'right', sortable: true, filterType: 'number', filterField: 'totalCost',
    },
    { key: 'effectiveFrom', header: 'Effective From', accessor: (r) => safeFormat(r.effectiveFrom, 'MMM dd, yyyy'), sortable: true, filterType: 'date', filterField: 'effectiveFrom' },
    { key: 'effectiveTo', header: 'Effective To', accessor: (r) => safeFormat(r.effectiveTo, 'MMM dd, yyyy'), filterType: 'date', filterField: 'effectiveTo' },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => {
            setSelected(r);
            setForm({
              productId: r.productId,
              locationId: r.locationId || '',
              costType: r.costType,
              effectiveFrom: r.effectiveFrom?.slice(0, 10) || '',
              effectiveTo: r.effectiveTo?.slice(0, 10) || '',
              materialCost: r.materialCost || 0,
              laborCost: r.laborCost || 0,
              overheadCost: r.overheadCost || 0,
              subcontractCost: r.subcontractCost || 0,
              currency: r.currency || 'INR',
              version: r.version || '',
              notes: r.notes || '',
            });
            setShowEdit(true);
          }} className="p-1 text-amber-600 hover:text-amber-800"><PencilIcon className="h-4 w-4" /></button>
          <button onClick={() => { confirmAction1.confirm(() => deleteMut.mutate(r.id)) }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const FormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
          <ProductSelector value={form.productId || undefined} onChange={(id) => setForm({ ...form, productId: id })} disabled={showEdit} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cost Type *</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.costType} onChange={(e) => setForm({ ...form, costType: e.target.value as CostType })}>
            {(['STANDARD', 'ACTUAL', 'PLANNED', 'BUDGET'] as CostType[]).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Effective From *</label>
          <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Effective To</label>
          <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Material Cost</label>
          <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.materialCost} onChange={(e) => setForm({ ...form, materialCost: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Labor Cost</label>
          <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.laborCost} onChange={(e) => setForm({ ...form, laborCost: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Overhead Cost</label>
          <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.overheadCost} onChange={(e) => setForm({ ...form, overheadCost: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subcontract Cost</label>
          <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.subcontractCost} onChange={(e) => setForm({ ...form, subcontractCost: +e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {['INR', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
          <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="e.g. v1.0" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </div>
  );

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold">Product Costing</h1>
          <p className="text-secondary-500 mt-1">Manage product cost breakdowns by type and effective period</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>Add Costing</Button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader title="Product Costings" description="Cost breakdowns across products and locations" />
        <DataTable
          data={items}
          columns={columns}
          keyExtractor={(r) => r.id}
          isLoading={isLoading}
          emptyMessage="No product costings found"
          sorting={grid.sortingProps}
          filtering={grid.filteringProps}
          pagination={grid.paginationProps(total)}
        />
      </Card>

      {/* Create */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Add Product Costing" size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.productId || !form.effectiveFrom}>Create</Button>
        </div>
      </Modal>

      {/* Edit */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Product Costing" size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
          <Button onClick={() => selected && updateMut.mutate({
            id: selected.id,
            dto: {
              costType: form.costType,
              effectiveFrom: form.effectiveFrom,
              effectiveTo: form.effectiveTo || undefined,
              materialCost: Number(form.materialCost),
              laborCost: Number(form.laborCost),
              overheadCost: Number(form.overheadCost),
              subcontractCost: Number(form.subcontractCost),
              currency: form.currency,
              version: form.version || undefined,
              notes: form.notes || undefined,
            } as Partial<ProductCosting>,
          })} isLoading={updateMut.isPending}>Save</Button>
        </div>
      </Modal>
    
      <ConfirmDialog open={confirmAction1.confirmProps.isOpen} onCancel={confirmAction1.confirmProps.onClose} onConfirm={confirmAction1.confirmProps.onConfirm} title={confirmAction1.confirmProps.title} message={confirmAction1.confirmProps.message} variant={confirmAction1.confirmProps.variant as any} confirmLabel={confirmAction1.confirmProps.confirmText} />
    </div>
  );
}