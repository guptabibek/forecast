import type { ProductCategory } from '@/types';
import { Badge, Button, Card, CardHeader, Column, DataTable, Modal } from '@components/ui';
import {
    PencilIcon,
    PlusIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import { useGridState } from '@/hooks/useGridState';
import { productCategoryService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useConfirmAction } from '@/hooks/useConfirmAction';
import { ConfirmDialog } from '@components/common/ConfirmDialog';

interface CategoryForm {
  code: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  sortOrder: string;
  isActive: boolean;
}

const emptyForm: CategoryForm = {
  code: '',
  name: '',
  description: '',
  color: '#6366F1',
  icon: '',
  sortOrder: '0',
  isActive: true,
};

export default function ProductCategoryMaster() {
  
  const confirmAction1 = useConfirmAction({
    title: 'Confirm Action',
    message: "Delete category '${row.name}'?",
    variant: 'danger',
  });
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<ProductCategory | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const grid = useGridState({ initialSortBy: 'sortOrder', initialSortOrder: 'asc' });

  const { data: result, isLoading } = useQuery({
    queryKey: ['manufacturing', 'product-categories', grid.queryKey],
    queryFn: () => productCategoryService.getAll(grid.queryParams),
    placeholderData: (prev) => prev,
  });

  const categories: ProductCategory[] = (result as any)?.items ?? (result as any)?.data ?? [];
  const total = (result as any)?.total ?? categories.length;

  const createMut = useMutation({
    mutationFn: (dto: any) => productCategoryService.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'product-categories'] });
      toast.success('Category created');
      setShowCreate(false);
      setForm(emptyForm);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => productCategoryService.update(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'product-categories'] });
      toast.success('Category updated');
      setShowEdit(false);
      setSelected(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => productCategoryService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'product-categories'] });
      toast.success('Category deleted');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Cannot delete — may be in use'),
  });

  const handleCreate = () => {
    if (!form.code || !form.name) { toast.error('Code and Name are required'); return; }
    createMut.mutate({
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      color: form.color || undefined,
      icon: form.icon || undefined,
      sortOrder: parseInt(form.sortOrder) || 0,
      isActive: form.isActive,
    });
  };

  const handleUpdate = () => {
    if (!selected) return;
    updateMut.mutate({
      id: selected.id,
      dto: {
        name: form.name,
        description: form.description || undefined,
        color: form.color || undefined,
        icon: form.icon || undefined,
        sortOrder: parseInt(form.sortOrder) || 0,
        isActive: form.isActive,
      },
    });
  };

  const openEdit = (cat: ProductCategory) => {
    setSelected(cat);
    setForm({
      code: cat.code,
      name: cat.name,
      description: cat.description || '',
      color: cat.color || '#6366F1',
      icon: cat.icon || '',
      sortOrder: String(cat.sortOrder),
      isActive: cat.isActive,
    });
    setShowEdit(true);
  };

  const columns: Column<ProductCategory>[] = [
    {
      key: 'color',
      header: '',
      width: '40px',
      accessor: (row) => (
        <div
          className="w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600"
          style={{ backgroundColor: row.color || '#6366F1' }}
        />
      ),
    },
    { key: 'code', header: 'Code', accessor: 'code', sortable: true, filterType: 'text', filterField: 'code' },
    { key: 'name', header: 'Name', accessor: 'name', sortable: true, filterType: 'text', filterField: 'name' },
    {
      key: 'description',
      header: 'Description',
      accessor: (row) => (
        <span className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[250px] block">
          {row.description || '—'}
        </span>
      ),
      filterType: 'text', filterField: 'description',
    },
    { key: 'sortOrder', header: 'Order', accessor: (r) => r.sortOrder, sortable: true, width: '80px', filterType: 'number', filterField: 'sortOrder' },
    {
      key: 'isActive',
      header: 'Status',
      width: '100px',
      accessor: (row) => (
        <Badge variant={row.isActive ? 'success' : 'secondary'}>
          {row.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
      filterType: 'select', filterField: 'isActive',
      filterOptions: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }],
    },
    {
      key: 'actions',
      header: '',
      width: '100px',
      accessor: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openEdit(row)}
            className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
            title="Edit"
          >
            <PencilIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              confirmAction1.confirm(() => deleteMut.mutate(row.id))
            }}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
            title="Delete"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const renderForm = (isEdit: boolean) => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Code *</label>
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            disabled={isEdit}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 disabled:opacity-50"
            placeholder="e.g., RAW_MATERIAL"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Name *</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="e.g., Raw Material"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
          placeholder="Category description..."
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="w-10 h-10 rounded border cursor-pointer"
            />
            <span className="text-sm text-gray-500">{form.color}</span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Sort Order</label>
          <input
            type="number"
            min="0"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="rounded border-gray-300"
            />
            <span className="text-sm font-medium">Active</span>
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
        <Button
          variant="secondary"
          onClick={() => { isEdit ? setShowEdit(false) : setShowCreate(false); setForm(emptyForm); }}
        >
          Cancel
        </Button>
        <Button
          onClick={isEdit ? handleUpdate : handleCreate}
          isLoading={isEdit ? updateMut.isPending : createMut.isPending}
        >
          {isEdit ? 'Update' : 'Create'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 lg:space-y-6">
      <Card>
        <CardHeader
          title="Product Category Master"
          description={`${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} defined`}
          actions={
            <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }}>
              <PlusIcon className="w-4 h-4 mr-1" />
              Add Category
            </Button>
          }
        />

        <DataTable
          data={categories}
          columns={columns}
          keyExtractor={(r) => r.id}
          isLoading={isLoading}
          emptyMessage="No product categories found. Add your first category to get started."
          sorting={grid.sortingProps}
          filtering={grid.filteringProps}
          pagination={grid.paginationProps(total)}
        />
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Product Category">
        {renderForm(false)}
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title={`Edit Category — ${selected?.code}`}>
        {renderForm(true)}
      </Modal>
    
      <ConfirmDialog open={confirmAction1.confirmProps.isOpen} onCancel={confirmAction1.confirmProps.onClose} onConfirm={confirmAction1.confirmProps.onConfirm} title={confirmAction1.confirmProps.title} message={confirmAction1.confirmProps.message} variant={confirmAction1.confirmProps.variant as any} confirmLabel={confirmAction1.confirmProps.confirmText} />
    </div>
  );
}