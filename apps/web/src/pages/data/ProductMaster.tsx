import type { Dimension, Product, ProductCategory, UnitOfMeasure } from '@/types';
import { Badge, Button, Card, CardHeader, Column, DataTable, Modal } from '@components/ui';
import { useTableFilters } from '@/hooks/useTableFilters';
import {
    CubeIcon,
    PencilIcon,
    PlusIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import { dataService, productCategoryService, uomService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { formatInr } from '@utils/number-format';

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

interface ProductForm {
  code: string;
  name: string;
  description: string;
  categoryId: string;
  subcategory: string;
  brand: string;
  productCompany: string;
  salt: string;
  productGroup: string;
  hsnCode: string;
  unitOfMeasureId: string;
  listPrice: string;
  standardCost: string;
  externalId: string;
  isActive: boolean;
}

const buildEmptyForm = (defaultUnitOfMeasureId = ''): ProductForm => ({
  code: '',
  name: '',
  description: '',
  categoryId: '',
  subcategory: '',
  brand: '',
  productCompany: '',
  salt: '',
  productGroup: '',
  hsnCode: '',
  unitOfMeasureId: defaultUnitOfMeasureId,
  listPrice: '',
  standardCost: '',
  externalId: '',
  isActive: true,
});

export default function ProductMaster() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(buildEmptyForm());

  // Column-level filters (server-side)
  const { filters, debouncedFilters, setFilter, clearFilter, clearAll, toQueryParam } = useTableFilters();

  const handleFilterChange = (field: string, operator: any, value: unknown) => {
    setFilter(field, operator, value);
  };

  // Fetch products — re-runs whenever debouncedFilters change
  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products-master', debouncedFilters],
    queryFn: () =>
      dataService.getDimensions('product', {
        limit: 500,
        filters: toQueryParam(),
      } as any) as Promise<Product[]>,
  });

  // Fetch UOM Master
  const { data: uomResult } = useQuery({
    queryKey: ['manufacturing', 'uoms', 'active'],
    queryFn: () => uomService.getAll({ isActive: true, pageSize: 500 }),
    staleTime: 5 * 60 * 1000,
  });
  const uomList: UnitOfMeasure[] = uomResult?.items ?? [];

  // Fetch Product Category Master
  const { data: categoryResult } = useQuery({
    queryKey: ['manufacturing', 'product-categories', 'active'],
    queryFn: () => productCategoryService.getAll({ isActive: true, pageSize: 200 }),
    staleTime: 5 * 60 * 1000,
  });
  const categoryList: ProductCategory[] = categoryResult?.data ?? [];
  const defaultUnitOfMeasureId = uomList.find((u) => u.code === 'EA')?.id ?? uomList[0]?.id ?? '';

  const getCategoryLabel = (product: Product) => {
    if (product.category) return product.category;
    return categoryList.find((category) => category.id === product.categoryId)?.name || '';
  };

  const getUnitOfMeasureLabel = (product: Product) => {
    if (product.unitOfMeasure) return product.unitOfMeasure;
    return uomList.find((unitOfMeasure) => unitOfMeasure.id === product.unitOfMeasureId)?.code || '';
  };

  const resolveCategoryId = (product: Product) =>
    categoryList.find(
      (category) =>
        category.id === product.categoryId ||
        category.name.toLowerCase() === product.category?.toLowerCase() ||
        category.code.toLowerCase() === product.category?.toLowerCase(),
    )?.id || '';

  const resolveUnitOfMeasureId = (product: Product) =>
    uomList.find(
      (unitOfMeasure) =>
        unitOfMeasure.id === product.unitOfMeasureId ||
        unitOfMeasure.code.toLowerCase() === product.unitOfMeasure?.toLowerCase() ||
        unitOfMeasure.name.toLowerCase() === product.unitOfMeasure?.toLowerCase(),
    )?.id || defaultUnitOfMeasureId;

  // Mutations
  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      dataService.createDimension('product', data as Partial<Dimension>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products-master'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-selector'] });
      queryClient.invalidateQueries({ queryKey: ['dimensions'] });
      toast.success('Product created');
      setShowCreate(false);
      setForm(buildEmptyForm(defaultUnitOfMeasureId));
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create product'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      dataService.updateDimension('product', id, data as Partial<Dimension>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products-master'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-selector'] });
      queryClient.invalidateQueries({ queryKey: ['dimensions'] });
      toast.success('Product updated');
      setShowEdit(false);
      setSelected(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update product'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => dataService.deleteDimension('product', id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products-master'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-selector'] });
      queryClient.invalidateQueries({ queryKey: ['dimensions'] });
      toast.success('Product deleted');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to delete product'),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      categoryId: form.categoryId || undefined,
      subcategory: form.subcategory || undefined,
      brand: form.brand || undefined,
      productCompany: form.productCompany,
      salt: form.salt,
      productGroup: form.productGroup,
      hsnCode: form.hsnCode,
      unitOfMeasureId: form.unitOfMeasureId || undefined,
      listPrice: form.listPrice ? parseFloat(form.listPrice) : undefined,
      standardCost: form.standardCost ? parseFloat(form.standardCost) : undefined,
      externalId: form.externalId || undefined,
      isActive: form.isActive,
    };
    createMut.mutate(payload);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const payload: Record<string, unknown> = {
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      categoryId: form.categoryId || undefined,
      subcategory: form.subcategory || undefined,
      brand: form.brand || undefined,
      productCompany: form.productCompany,
      salt: form.salt,
      productGroup: form.productGroup,
      hsnCode: form.hsnCode,
      unitOfMeasureId: form.unitOfMeasureId || undefined,
      listPrice: form.listPrice ? parseFloat(form.listPrice) : undefined,
      standardCost: form.standardCost ? parseFloat(form.standardCost) : undefined,
      externalId: form.externalId || undefined,
      isActive: form.isActive,
    };
    updateMut.mutate({ id: selected.id, data: payload });
  };

  const openEdit = (p: Product) => {
    setSelected(p);
    setForm({
      code: p.code || '',
      name: p.name || '',
      description: p.description || '',
      categoryId: resolveCategoryId(p),
      subcategory: p.subcategory || '',
      brand: p.brand || '',
      productCompany: p.productCompany || '',
      salt: p.salt || '',
      productGroup: p.productGroup || '',
      hsnCode: p.hsnCode || '',
      unitOfMeasureId: resolveUnitOfMeasureId(p),
      listPrice: p.listPrice != null ? String(Number(p.listPrice)) : '',
      standardCost: p.standardCost != null ? String(Number(p.standardCost)) : '',
      externalId: p.externalId || '',
      isActive: p.isActive ?? p.status === 'ACTIVE',
    });
    setShowEdit(true);
  };

  const openDetail = (p: Product) => {
    setSelected(p);
    setShowDetail(true);
  };

  // Table columns — every column that maps to a DB field gets a filterType
  const columns: Column<Product>[] = [
    {
      key: 'code',
      header: 'Code',
      accessor: (r: Product) => <span className="font-mono text-sm">{r.code}</span>,
      sortable: true,
      filterType: 'text',
      filterField: 'code',
    },
    {
      key: 'name',
      header: 'Name',
      accessor: 'name',
      sortable: true,
      filterType: 'text',
      filterField: 'name',
    },
    {
      key: 'category',
      header: 'Category',
      accessor: (r: Product) => getCategoryLabel(r) || '—',
      filterType: 'text',
      filterField: 'category',
    },
    {
      key: 'brand',
      header: 'Brand',
      accessor: (r: Product) => r.brand || '—',
      filterType: 'text',
      filterField: 'brand',
    },
    {
      key: 'productCompany',
      header: 'Company',
      accessor: (r: Product) => r.productCompany || '-',
      filterType: 'text',
      filterField: 'productCompany',
    },
    {
      key: 'salt',
      header: 'Salt',
      accessor: (r: Product) => r.salt || '-',
      filterType: 'text',
      filterField: 'salt',
    },
    {
      key: 'productGroup',
      header: 'Group',
      accessor: (r: Product) => r.productGroup || '-',
      filterType: 'text',
      filterField: 'productGroup',
    },
    {
      key: 'hsnCode',
      header: 'HSN',
      accessor: (r: Product) => r.hsnCode || '-',
      filterType: 'text',
      filterField: 'hsnCode',
    },
    {
      key: 'uom',
      header: 'UOM',
      accessor: (r: Product) => getUnitOfMeasureLabel(r) || '—',
      align: 'center',
    },
    {
      key: 'listPrice',
      header: 'List Price',
      align: 'right',
      accessor: (r: Product) => r.listPrice != null ? formatInr(r.listPrice) : '—',
      filterType: 'number',
      filterField: 'listPrice',
    },
    {
      key: 'stdCost',
      header: 'Std Cost',
      align: 'right',
      accessor: (r: Product) => r.standardCost != null ? formatInr(r.standardCost) : '—',
      filterType: 'number',
      filterField: 'standardCost',
    },
    {
      key: 'margin',
      header: 'Margin',
      align: 'right',
      accessor: (r: Product) => {
        const price = Number(r.listPrice);
        const cost = Number(r.standardCost);
        if (!price || !cost) return '—';
        const margin = ((price - cost) / price) * 100;
        return (
          <span className={margin >= 0 ? 'text-green-600' : 'text-red-600'}>
            {margin.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r: Product) => {
        const active = r.isActive ?? (r.status === 'ACTIVE');
        return <Badge variant={active ? 'success' : 'secondary'} size="sm">{active ? 'Active' : 'Inactive'}</Badge>;
      },
      filterType: 'select',
      filterField: 'status',
      filterOptions: STATUS_OPTIONS,
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (r: Product) => (
        <div className="flex gap-1">
          <button onClick={() => openDetail(r)} className="p-1 text-blue-600 hover:text-blue-800" title="View Details">
            <CubeIcon className="h-4 w-4" />
          </button>
          <button onClick={() => openEdit(r)} className="p-1 text-amber-600 hover:text-amber-800" title="Edit">
            <PencilIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => { if (confirm(`Delete product "${r.name}"?`)) deleteMut.mutate(r.id); }}
            className="p-1 text-red-600 hover:text-red-800"
            title="Delete"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  // Summary stats
  const activeCount = products.filter((product) => product.isActive ?? product.status === 'ACTIVE').length;
  const avgPrice = products.reduce((sum, product) => sum + (Number(product.listPrice) || 0), 0) / (products.length || 1);
  const avgCost = products.reduce((sum, product) => sum + (Number(product.standardCost) || 0), 0) / (products.length || 1);

  const ProductFormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Code <span className="text-red-500">*</span></label>
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
            maxLength={50}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="PROD-001"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Name <span className="text-red-500">*</span></label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            maxLength={200}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="Product Name"
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
          placeholder="Product description..."
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Category</label>
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="">Select...</option>
            {categoryList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Subcategory</label>
          <input
            value={form.subcategory}
            onChange={(e) => setForm({ ...form, subcategory: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="e.g., Electronic"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Brand</label>
          <input
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="e.g., Acme"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Unit of Measure</label>
          <select
            value={form.unitOfMeasureId}
            onChange={(e) => setForm({ ...form, unitOfMeasureId: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="">Select...</option>
            {uomList.map((u) => (
              <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">List Price</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">₹</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.listPrice}
              onChange={(e) => setForm({ ...form, listPrice: e.target.value })}
              className="w-full pl-7 pr-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
              placeholder="0.00"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Standard Cost</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">₹</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.standardCost}
              onChange={(e) => setForm({ ...form, standardCost: e.target.value })}
              className="w-full pl-7 pr-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Company</label>
          <input
            value={form.productCompany}
            onChange={(e) => setForm({ ...form, productCompany: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="Marg GCode"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Salt</label>
          <input
            value={form.salt}
            onChange={(e) => setForm({ ...form, salt: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="Marg GCode3"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Group</label>
          <input
            value={form.productGroup}
            onChange={(e) => setForm({ ...form, productGroup: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="Marg GCode5"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">HSN Code</label>
          <input
            value={form.hsnCode}
            onChange={(e) => setForm({ ...form, hsnCode: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="Marg GCode6"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">External ID</label>
          <input
            value={form.externalId}
            onChange={(e) => setForm({ ...form, externalId: e.target.value })}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="ERP / External system ID"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="rounded border-gray-300 text-primary-600"
            />
            <span className="text-sm font-medium">Active</span>
          </label>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <CubeIcon className="h-7 w-7 text-primary-600" />
            Product Master
          </h1>
          <p className="text-secondary-500 mt-1">Manage product catalog — pricing, cost, classification</p>
        </div>
        <Button onClick={() => { setForm(buildEmptyForm(defaultUnitOfMeasureId)); setShowCreate(true); }}>
          <PlusIcon className="h-4 w-4 mr-1" /> Add Product
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <div className="p-4">
            <div className="text-sm text-secondary-500">Total Products</div>
            <div className="text-xl lg:text-2xl font-bold">{products.length}</div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="text-sm text-secondary-500">Active</div>
            <div className="text-2xl font-bold text-green-600">{activeCount}</div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="text-sm text-secondary-500">Avg List Price</div>
            <div className="text-xl lg:text-2xl font-bold">{formatInr(avgPrice)}</div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="text-sm text-secondary-500">Avg Std Cost</div>
            <div className="text-xl lg:text-2xl font-bold">{formatInr(avgCost)}</div>
          </div>
        </Card>
      </div>

      {/* Data Table — column filters are in the header row */}
      <Card>
        <CardHeader title={`Products (${products.length})`} />
        <DataTable
          data={products}
          columns={columns}
          keyExtractor={(r: Product) => r.id}
          isLoading={isLoading}
          emptyMessage="No products found."
          onRowClick={openDetail}
          filtering={{
            filters,
            onFilterChange: handleFilterChange,
            onClearFilter: clearFilter,
            onClearAll: clearAll,
          }}
        />
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create New Product" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <ProductFormFields />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" isLoading={createMut.isPending}>Create Product</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Product" size="lg">
        <form onSubmit={handleUpdate} className="space-y-4">
          <ProductFormFields />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button type="submit" isLoading={updateMut.isPending}>Save Changes</Button>
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); }} title="Product Details" size="lg">
        {selected && (
          <div className="space-y-4 lg:space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-lg font-bold">{selected.name}</p>
                <p className="text-sm font-mono text-secondary-500">{selected.code}</p>
              </div>
              <Badge variant={(selected.isActive ?? selected.status === 'ACTIVE') ? 'success' : 'secondary'} size="sm">
                {(selected.isActive ?? selected.status === 'ACTIVE') ? 'Active' : 'Inactive'}
              </Badge>
            </div>

            {selected.description && <p className="text-secondary-600">{selected.description}</p>}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">Category</dt>
                <dd className="font-medium">{getCategoryLabel(selected) || '—'}</dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">Subcategory</dt>
                <dd className="font-medium">{selected.subcategory || '—'}</dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">Brand</dt>
                <dd className="font-medium">{selected.brand || '—'}</dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">Company</dt>
                <dd className="font-medium">{selected.productCompany || '-'}</dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">Salt</dt>
                <dd className="font-medium">{selected.salt || '-'}</dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">Group</dt>
                <dd className="font-medium">{selected.productGroup || '-'}</dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">HSN Code</dt>
                <dd className="font-medium">{selected.hsnCode || '-'}</dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">Unit of Measure</dt>
                <dd className="font-medium">{getUnitOfMeasureLabel(selected) || '—'}</dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">List Price</dt>
                <dd className="font-medium text-green-700 dark:text-green-400">
                  {selected.listPrice != null ? formatInr(selected.listPrice) : '—'}
                </dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">Standard Cost</dt>
                <dd className="font-medium">
                  {selected.standardCost != null ? formatInr(selected.standardCost) : '—'}
                </dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">Margin</dt>
                <dd className="font-medium">
                  {Number(selected.listPrice) && Number(selected.standardCost)
                    ? `${(((Number(selected.listPrice) - Number(selected.standardCost)) / Number(selected.listPrice)) * 100).toFixed(1)}%`
                    : '—'}
                </dd>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <dt className="text-secondary-500">External ID</dt>
                <dd className="font-medium">{selected.externalId || '—'}</dd>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setShowDetail(false); openEdit(selected); }}>
                <PencilIcon className="h-4 w-4 mr-1" /> Edit
              </Button>
              <Button variant="secondary" onClick={() => { setShowDetail(false); setSelected(null); }}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
