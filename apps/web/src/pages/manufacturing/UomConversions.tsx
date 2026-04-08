import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { uomConversionService, uomService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { UnitOfMeasure, UnitOfMeasureConversion } from '../../types';

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

const emptyForm = {
  fromUom: '',
  toUom: '',
  fromUomId: '',
  toUomId: '',
  factor: 1,
  productId: '',
  isActive: true,
};

export default function UomConversionsPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [fromUomFilter, setFromUomFilter] = useState('');

  // Fetch UOM master list for dropdowns
  const { data: uomData } = useQuery({
    queryKey: ['manufacturing', 'uoms', 'active-list'],
    queryFn: () => uomService.getAll({ isActive: true, pageSize: 500 }),
    staleTime: 60_000,
  });
  const uomList: UnitOfMeasure[] = Array.isArray(uomData?.items) ? uomData.items : [];
  const hasUomMaster = uomList.length > 0;

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'uom-conversions', fromUomFilter],
    queryFn: () => uomConversionService.getAll({ fromUom: fromUomFilter || undefined, pageSize: 100 }),
  });

  const items: UnitOfMeasureConversion[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => uomConversionService.create({
      fromUom: d.fromUom,
      toUom: d.toUom,
      fromUomId: d.fromUomId || undefined,
      toUomId: d.toUomId || undefined,
      factor: Number(d.factor),
      productId: d.productId || undefined,
      isActive: d.isActive,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'uom-conversions'] });
      closeModal();
      toast.success('UOM conversion created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create UOM conversion'); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<typeof emptyForm> }) =>
      uomConversionService.update(id, { factor: Number(dto.factor), isActive: dto.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'uom-conversions'] });
      closeModal();
      toast.success('UOM conversion updated');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update UOM conversion'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => uomConversionService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'uom-conversions'] });
      toast.success('UOM conversion deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete UOM conversion'); },
  });

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const openEdit = (conv: UnitOfMeasureConversion) => {
    setEditingId(conv.id);
    setForm({
      fromUom: conv.fromUom,
      toUom: conv.toUom,
      fromUomId: conv.fromUomId || '',
      toUomId: conv.toUomId || '',
      factor: Number(conv.factor),
      productId: conv.productId || '',
      isActive: conv.isActive,
    });
    setShowModal(true);
  };

  const handleSubmit = () => {
    if (editingId) {
      updateMut.mutate({ id: editingId, dto: form });
    } else {
      createMut.mutate(form);
    }
  };

  // When user selects a UOM from dropdown, auto-fill the code
  const handleFromUomSelect = (uomId: string) => {
    const uom = uomList.find((u) => u.id === uomId);
    setForm({ ...form, fromUomId: uomId, fromUom: uom?.code || '' });
  };
  const handleToUomSelect = (uomId: string) => {
    const uom = uomList.find((u) => u.id === uomId);
    setForm({ ...form, toUomId: uomId, toUom: uom?.code || '' });
  };

  const columns: Column<UnitOfMeasureConversion>[] = [
    {
      key: 'fromUom', header: 'From UOM',
      accessor: (r) => (
        <span className="font-mono font-semibold">
          {r.fromUom}
          {r.fromUomRef && <span className="ml-1 text-xs text-gray-400">({r.fromUomRef.name})</span>}
        </span>
      ),
    },
    {
      key: 'toUom', header: 'To UOM',
      accessor: (r) => (
        <span className="font-mono font-semibold">
          {r.toUom}
          {r.toUomRef && <span className="ml-1 text-xs text-gray-400">({r.toUomRef.name})</span>}
        </span>
      ),
    },
    { key: 'factor', header: 'Factor', accessor: (r) => Number(r.factor).toFixed(8), align: 'right' },
    {
      key: 'product', header: 'Product',
      accessor: (r) => r.product?.name || (r.productId ? r.productId : <span className="text-gray-400">Global</span>),
    },
    {
      key: 'isActive', header: 'Active',
      accessor: (r) => <Badge variant={r.isActive ? 'success' : 'secondary'} size="sm">{r.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    { key: 'createdAt', header: 'Created', accessor: (r) => safeFormat(r.createdAt, 'MMM dd, yyyy') },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => openEdit(r)} className="p-1 text-blue-600 hover:text-blue-800" title="Edit"><PencilIcon className="h-4 w-4" /></button>
          <button onClick={() => { if (confirm('Delete this UOM conversion?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800" title="Delete"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const UomDropdownOrInput = ({
    label,
    value,
    uomId,
    onSelect,
    onTextChange,
    placeholder,
    disabled,
  }: {
    label: string;
    value: string;
    uomId: string;
    onSelect: (id: string) => void;
    onTextChange: (val: string) => void;
    placeholder: string;
    disabled?: boolean;
  }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hasUomMaster ? (
        <select
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
          value={uomId}
          onChange={(e) => onSelect(e.target.value)}
          disabled={disabled}
        >
          <option value="">— Select UOM —</option>
          {uomList.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} — {u.name}{u.symbol ? ` (${u.symbol})` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 font-mono"
          value={value}
          onChange={(e) => onTextChange(e.target.value.toUpperCase())}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </div>
  );

  const FormFields = () => (
    <div className="space-y-4">
      {!hasUomMaster && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          <strong>Tip:</strong> Set up your UOM Master first for dropdown selection. You can still type UOM codes manually.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <UomDropdownOrInput
          label="From UOM *"
          value={form.fromUom}
          uomId={form.fromUomId}
          onSelect={handleFromUomSelect}
          onTextChange={(v) => setForm({ ...form, fromUom: v })}
          placeholder="e.g. KG"
          disabled={!!editingId}
        />
        <UomDropdownOrInput
          label="To UOM *"
          value={form.toUom}
          uomId={form.toUomId}
          onSelect={handleToUomSelect}
          onTextChange={(v) => setForm({ ...form, toUom: v })}
          placeholder="e.g. LB"
          disabled={!!editingId}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Factor *</label>
          <input
            type="number"
            step="0.00000001"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            value={form.factor}
            onChange={(e) => setForm({ ...form, factor: +e.target.value })}
          />
          {form.fromUom && form.toUom && form.factor > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              1 {form.fromUom} = {form.factor} {form.toUom}
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product (optional)</label>
          <ProductSelector value={form.productId || undefined} onChange={(id) => setForm({ ...form, productId: id })} placeholder="Global (all products)" />
        </div>
      </div>
      <div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Active
        </label>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">UOM Conversions</h1>
          <p className="text-secondary-500 mt-1">Manage unit of measure conversion factors</p>
        </div>
        <div className="flex gap-2">
          {hasUomMaster ? (
            <select
              className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
              value={fromUomFilter}
              onChange={(e) => setFromUomFilter(e.target.value)}
            >
              <option value="">All UOMs</option>
              {uomList.map((u) => (
                <option key={u.id} value={u.code}>{u.code} — {u.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="Filter by From UOM..."
              className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
              value={fromUomFilter}
              onChange={(e) => setFromUomFilter(e.target.value)}
            />
          )}
          <Button onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New Conversion</Button>
        </div>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader title="UOM Conversions" description={`${items.length} conversion${items.length !== 1 ? 's' : ''} defined`} />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No UOM conversions found" />
      </Card>

      {/* Create/Edit Modal */}
      <Modal isOpen={showModal} onClose={closeModal} title={editingId ? 'Edit UOM Conversion' : 'New UOM Conversion'} size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={closeModal}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            isLoading={createMut.isPending || updateMut.isPending}
            disabled={!form.fromUom || !form.toUom || !form.factor}
          >
            {editingId ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
