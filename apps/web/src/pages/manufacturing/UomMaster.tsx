import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { uomService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { UnitOfMeasure, UomCategory } from '../../types';

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

const UOM_CATEGORIES: { value: UomCategory; label: string }[] = [
  { value: 'WEIGHT', label: 'Weight' },
  { value: 'LENGTH', label: 'Length' },
  { value: 'VOLUME', label: 'Volume' },
  { value: 'AREA', label: 'Area' },
  { value: 'COUNT', label: 'Count' },
  { value: 'TIME', label: 'Time' },
  { value: 'TEMPERATURE', label: 'Temperature' },
  { value: 'ENERGY', label: 'Energy' },
  { value: 'PRESSURE', label: 'Pressure' },
  { value: 'OTHER', label: 'Other' },
];

const CATEGORY_COLORS: Record<string, string> = {
  WEIGHT: 'bg-blue-100 text-blue-800',
  LENGTH: 'bg-green-100 text-green-800',
  VOLUME: 'bg-purple-100 text-purple-800',
  AREA: 'bg-yellow-100 text-yellow-800',
  COUNT: 'bg-gray-100 text-gray-800',
  TIME: 'bg-orange-100 text-orange-800',
  TEMPERATURE: 'bg-red-100 text-red-800',
  ENERGY: 'bg-teal-100 text-teal-800',
  PRESSURE: 'bg-indigo-100 text-indigo-800',
  OTHER: 'bg-gray-100 text-gray-600',
};

const emptyForm = {
  code: '',
  name: '',
  symbol: '',
  category: 'OTHER' as UomCategory,
  description: '',
  decimals: 2,
  isBase: false,
  isActive: true,
  sortOrder: 0,
};

export default function UomMasterPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'uoms', categoryFilter, searchFilter],
    queryFn: () => uomService.getAll({
      category: categoryFilter || undefined,
      search: searchFilter || undefined,
      isActive: undefined,
      pageSize: 200,
    }),
  });

  const items: UnitOfMeasure[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => uomService.create({
      code: d.code,
      name: d.name,
      symbol: d.symbol || undefined,
      category: d.category,
      description: d.description || undefined,
      decimals: d.decimals,
      isBase: d.isBase,
      isActive: d.isActive,
      sortOrder: d.sortOrder,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'uoms'] });
      closeModal();
      toast.success('UOM created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create UOM'); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: typeof emptyForm }) => uomService.update(id, {
      name: dto.name,
      symbol: dto.symbol || undefined,
      category: dto.category,
      description: dto.description || undefined,
      decimals: dto.decimals,
      isBase: dto.isBase,
      isActive: dto.isActive,
      sortOrder: dto.sortOrder,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'uoms'] });
      closeModal();
      toast.success('UOM updated');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update UOM'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => uomService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'uoms'] });
      toast.success('UOM deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete UOM'); },
  });

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const openEdit = (uom: UnitOfMeasure) => {
    setEditingId(uom.id);
    setForm({
      code: uom.code,
      name: uom.name,
      symbol: uom.symbol || '',
      category: uom.category,
      description: uom.description || '',
      decimals: uom.decimals,
      isBase: uom.isBase,
      isActive: uom.isActive,
      sortOrder: uom.sortOrder,
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

  const columns: Column<UnitOfMeasure>[] = [
    {
      key: 'code', header: 'Code',
      accessor: (r) => <span className="font-mono font-semibold text-primary-700">{r.code}</span>,
    },
    { key: 'name', header: 'Name', accessor: 'name' },
    {
      key: 'symbol', header: 'Symbol',
      accessor: (r) => r.symbol ? <span className="font-mono">{r.symbol}</span> : '—',
    },
    {
      key: 'category', header: 'Category',
      accessor: (r) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[r.category] || CATEGORY_COLORS.OTHER}`}>
          {r.category}
        </span>
      ),
    },
    { key: 'decimals', header: 'Decimals', accessor: (r) => r.decimals, align: 'center' },
    {
      key: 'isBase', header: 'Base',
      accessor: (r) => r.isBase ? <Badge variant="primary" size="sm">Base</Badge> : null,
      align: 'center',
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
          <button onClick={() => { if (confirm(`Delete UOM "${r.code}"?`)) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800" title="Delete"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const FormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
          <input
            type="text"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 font-mono uppercase"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="e.g. KG, LB, EA"
            disabled={!!editingId}
            maxLength={20}
          />
          {!!editingId && <p className="mt-1 text-xs text-gray-400">Code cannot be changed after creation</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input
            type="text"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Kilogram"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Symbol</label>
          <input
            type="text"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 font-mono"
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            placeholder="e.g. kg"
            maxLength={10}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as UomCategory })}
          >
            {UOM_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Decimals</label>
          <input
            type="number"
            min={0}
            max={8}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            value={form.decimals}
            onChange={(e) => setForm({ ...form, decimals: parseInt(e.target.value) || 0 })}
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <input
          type="text"
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Optional description"
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
          <input
            type="number"
            min={0}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              checked={form.isBase}
              onChange={(e) => setForm({ ...form, isBase: e.target.checked })}
            />
            Base unit for category
          </label>
        </div>
        <div className="flex items-end pb-1">
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
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">UOM Master</h1>
          <p className="text-secondary-500 mt-1">Manage units of measure definitions</p>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search UOMs..."
            className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
          <select
            className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            {UOM_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <Button onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New UOM</Button>
        </div>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader
          title="Units of Measure"
          description={`${items.length} UOM${items.length !== 1 ? 's' : ''} defined`}
        />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No UOMs found. Create your first unit of measure." />
      </Card>

      {/* Create / Edit Modal */}
      <Modal isOpen={showModal} onClose={closeModal} title={editingId ? 'Edit UOM' : 'New UOM'} size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={closeModal}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            isLoading={createMut.isPending || updateMut.isPending}
            disabled={!form.code || !form.name}
          >
            {editingId ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
