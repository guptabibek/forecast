import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { EyeIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supplierService, type Supplier, type SupplierProduct } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';

const emptySup = { code: '', name: '', contactName: '', email: '', phone: '', country: '', currency: 'USD', paymentTerms: 'NET30', defaultLeadTimeDays: 14, minimumOrderValue: 0 };

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [form, setForm] = useState<typeof emptySup>(emptySup);

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'suppliers'],
    queryFn: () => supplierService.getAll({ pageSize: 100 }),
  });

  const { data: detailData } = useQuery({
    queryKey: ['manufacturing', 'supplier', selected?.id],
    queryFn: () => selected ? supplierService.getById(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const { data: supplierProducts } = useQuery({
    queryKey: ['manufacturing', 'supplier-products', selected?.id],
    queryFn: () => selected ? supplierService.getSupplierProducts(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const { data: performance } = useQuery({
    queryKey: ['manufacturing', 'supplier-performance', selected?.id],
    queryFn: () => selected ? supplierService.getPerformance(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const items: Supplier[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const prodItems: SupplierProduct[] = Array.isArray(supplierProducts?.items) ? supplierProducts.items : Array.isArray(supplierProducts) ? supplierProducts : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptySup) => supplierService.create({
      code: d.code, name: d.name, contactName: d.contactName, contactEmail: d.email,
      contactPhone: d.phone, country: d.country, currency: d.currency,
      paymentTerms: d.paymentTerms, defaultLeadTimeDays: Number(d.defaultLeadTimeDays),
      minimumOrderValue: Number(d.minimumOrderValue),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'suppliers'] }); setShowCreate(false); setForm(emptySup); toast.success('Supplier created'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create supplier'); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<Supplier> }) => supplierService.update(id, dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'suppliers'] }); setShowEdit(false); toast.success('Supplier updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update supplier'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => supplierService.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'suppliers'] }); toast.success('Supplier deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete supplier'); },
  });

  const columns: Column<Supplier>[] = [
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'name', header: 'Name', accessor: 'name' },
    { key: 'contact', header: 'Contact', accessor: (r) => r.contactName || '—' },
    { key: 'email', header: 'Email', accessor: (r) => r.contactEmail || '—' },
    { key: 'country', header: 'Country', accessor: (r) => r.country || '—' },
    { key: 'leadTime', header: 'Lead Time', accessor: (r) => r.defaultLeadTimeDays ? `${r.defaultLeadTimeDays}d` : '—', align: 'right' },
    {
      key: 'status', header: 'Status',
      accessor: (r) => {
        const isActive = r.isActive ?? (r as any).status === 'ACTIVE';
        return <Badge variant={isActive ? 'success' : 'secondary'} size="sm">{isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>;
      },
    },
    {
      key: 'preferred', header: 'Preferred',
      accessor: (r) => r.isPreferred ? <Badge variant="primary" size="sm">YES</Badge> : <span className="text-gray-400">—</span>,
    },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelected(r); setShowDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          <button onClick={() => {
            setSelected(r);
            setForm({ code: r.code, name: r.name, contactName: r.contactName || '', email: r.contactEmail || '', phone: r.contactPhone || '', country: r.country || '', currency: r.currency || 'USD', paymentTerms: r.paymentTerms || 'NET30', defaultLeadTimeDays: r.defaultLeadTimeDays || 14, minimumOrderValue: r.minimumOrderValue || 0 });
            setShowEdit(true);
          }} className="p-1 text-amber-600 hover:text-amber-800"><PencilIcon className="h-4 w-4" /></button>
          <button onClick={() => { if (confirm('Delete this supplier?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const FormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
          <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SUP-001" disabled={showEdit} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
          <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
            <option value="">Select country...</option>
            {['United States','United Kingdom','Canada','Germany','France','Japan','China','India','Australia','Brazil','Mexico','South Korea','Italy','Spain','Netherlands','Singapore','Switzerland','Sweden','Norway','Nepal','UAE','South Africa','Saudi Arabia','Turkey','Thailand','Vietnam','Indonesia','Malaysia','Philippines','Taiwan'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {['USD','EUR','GBP','JPY','CNY','INR','CAD','AUD'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
            {['COD','NET15','NET30','NET45','NET60','NET90'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Lead Time (days)</label>
          <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.defaultLeadTimeDays} onChange={(e) => setForm({ ...form, defaultLeadTimeDays: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Min Order ($)</label>
          <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.minimumOrderValue} onChange={(e) => setForm({ ...form, minimumOrderValue: +e.target.value })} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="text-secondary-500 mt-1">Supplier master data and sourcing relationships</p>
        </div>
        <Button onClick={() => { setForm(emptySup); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>Add Supplier</Button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader title="Suppliers" description="Approved supplier list" />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No suppliers found" />
      </Card>

      {/* Create */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Add Supplier" size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.code || !form.name}>Create</Button>
        </div>
      </Modal>

      {/* Edit */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Supplier" size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
          <Button onClick={() => selected && updateMut.mutate({ id: selected.id, dto: { name: form.name, contactName: form.contactName, contactEmail: form.email, contactPhone: form.phone, country: form.country, currency: form.currency, paymentTerms: form.paymentTerms, defaultLeadTimeDays: Number(form.defaultLeadTimeDays), minimumOrderValue: Number(form.minimumOrderValue) } })} isLoading={updateMut.isPending}>Save</Button>
        </div>
      </Modal>

      {/* Detail */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); }} title={selected ? `${selected.code} — ${selected.name}` : 'Supplier'} size="xl">
        {selected && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Contact:</span> {(detailData as any)?.contactName || selected.contactName || '—'}</div>
              <div><span className="font-medium text-gray-500">Email:</span> {(detailData as any)?.contactEmail || selected.contactEmail || '—'}</div>
              <div><span className="font-medium text-gray-500">Country:</span> {(detailData as any)?.country || selected.country || '—'}</div>
              <div><span className="font-medium text-gray-500">Terms:</span> {(detailData as any)?.paymentTerms || selected.paymentTerms || '—'}</div>
            </div>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Currency:</span> {selected.currency || '—'}</div>
              <div><span className="font-medium text-gray-500">Lead Time:</span> {selected.defaultLeadTimeDays ?? '—'} days</div>
              <div><span className="font-medium text-gray-500">Min Order:</span> ${selected.minimumOrderValue ?? 0}</div>
              <div><span className="font-medium text-gray-500">Preferred:</span> {selected.isPreferred ? 'Yes' : 'No'}</div>
            </div>

            {/* Performance */}
            {performance && (
              <div>
                <h3 className="text-base font-semibold mb-2">Performance</h3>
                <div className="grid grid-cols-3 gap-4 text-sm bg-gray-50 p-3 rounded">
                  <div><span className="font-medium text-gray-500">On-time %:</span> {(performance as any)?.onTimePercent ?? '—'}%</div>
                  <div><span className="font-medium text-gray-500">Quality %:</span> {(performance as any)?.qualityPercent ?? '—'}%</div>
                  <div><span className="font-medium text-gray-500">Total Orders:</span> {(performance as any)?.totalOrders ?? '—'}</div>
                </div>
              </div>
            )}

            {/* Linked Products */}
            <div>
              <h3 className="text-base font-semibold mb-2">Linked Products ({prodItems.length})</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-left">Part #</th>
                    <th className="px-3 py-2 text-left">Supply Type</th>
                    <th className="px-3 py-2 text-right">Unit Cost</th>
                    <th className="px-3 py-2 text-right">Lead Time</th>
                    <th className="px-3 py-2 text-right">Min Qty</th>
                    <th className="px-3 py-2">Primary</th>
                  </tr></thead>
                  <tbody>
                    {prodItems.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">No linked products</td></tr>}
                    {prodItems.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-2">{p.product?.sku || p.productId}</td>
                        <td className="px-3 py-2">{p.supplierPartNumber || '—'}</td>
                        <td className="px-3 py-2">{p.supplyType}</td>
                        <td className="px-3 py-2 text-right">{p.unitCost ? `$${p.unitCost.toFixed(2)}` : '—'}</td>
                        <td className="px-3 py-2 text-right">{p.leadTimeDays ?? '—'}d</td>
                        <td className="px-3 py-2 text-right">{p.minimumOrderQty ?? '—'}</td>
                        <td className="px-3 py-2">{p.isPrimary ? <Badge variant="primary" size="sm">YES</Badge> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
