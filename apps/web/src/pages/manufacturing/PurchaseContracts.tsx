import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { EyeIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { purchaseContractService, supplierService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { PurchaseContract, PurchaseContractLine, PurchaseContractType } from '../../types';

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

const statusVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  DRAFT: 'secondary',
  ACTIVE: 'success',
  EXPIRED: 'warning',
  CANCELLED: 'error',
  COMPLETED: 'primary',
};

const typeVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  BLANKET: 'primary',
  FRAMEWORK: 'success',
  QUANTITY: 'warning',
  VALUE: 'secondary',
};

interface LineForm {
  productId: string;
  agreedPrice: number;
  agreedQty: number;
  minOrderQty: number;
  leadTimeDays: number;
  uom: string;
}

const emptyForm = {
  contractNumber: '',
  supplierId: '',
  contractType: 'BLANKET' as PurchaseContractType,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  totalValue: 0,
  currency: 'USD',
  paymentTerms: 'NET30',
  notes: '',
};

export default function PurchaseContractsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<PurchaseContract | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [linesForms, setLinesForms] = useState<LineForm[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'purchase-contracts', statusFilter],
    queryFn: () => purchaseContractService.getAll({ status: statusFilter || undefined, pageSize: 100 }),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['manufacturing', 'suppliers'],
    queryFn: () => supplierService.getAll({ pageSize: 200 }),
  });

  const { data: contractDetail } = useQuery({
    queryKey: ['manufacturing', 'purchase-contract', selected?.id],
    queryFn: () => selected ? purchaseContractService.getById(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const { data: contractLines } = useQuery({
    queryKey: ['manufacturing', 'purchase-contract-lines', selected?.id],
    queryFn: () => selected ? purchaseContractService.getLines(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const items: PurchaseContract[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const suppliersData: any[] = Array.isArray(suppliers?.items) ? suppliers.items : Array.isArray(suppliers) ? suppliers : [];
  const linesData: PurchaseContractLine[] = Array.isArray(contractLines?.items) ? contractLines.items : Array.isArray(contractLines) ? contractLines : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: async (d: typeof emptyForm) => {
      const contract = await purchaseContractService.create({
        contractNumber: d.contractNumber,
        supplierId: d.supplierId,
        contractType: d.contractType,
        startDate: d.startDate,
        endDate: d.endDate,
        totalValue: Number(d.totalValue) || undefined,
        currency: d.currency,
        paymentTerms: d.paymentTerms || undefined,
        notes: d.notes || undefined,
      });
      // Create lines if any
      for (const line of linesForms) {
        if (line.productId) {
          await purchaseContractService.createLine(contract.id, {
            productId: line.productId,
            agreedPrice: Number(line.agreedPrice),
            agreedQty: Number(line.agreedQty) || undefined,
            minOrderQty: Number(line.minOrderQty) || undefined,
            leadTimeDays: Number(line.leadTimeDays) || undefined,
            uom: line.uom || undefined,
          });
        }
      }
      return contract;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'purchase-contracts'] });
      setShowCreate(false);
      setForm(emptyForm);
      setLinesForms([]);
      toast.success('Purchase contract created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create contract'); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<PurchaseContract> }) => purchaseContractService.update(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'purchase-contracts'] });
      setShowEdit(false);
      toast.success('Contract updated');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update contract'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => purchaseContractService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'purchase-contracts'] });
      toast.success('Contract deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete contract'); },
  });

  const addLine = () => {
    setLinesForms([...linesForms, { productId: '', agreedPrice: 0, agreedQty: 0, minOrderQty: 0, leadTimeDays: 0, uom: 'EA' }]);
  };

  const updateLine = (index: number, field: keyof LineForm, value: any) => {
    const newLines = [...linesForms];
    newLines[index] = { ...newLines[index], [field]: value };
    setLinesForms(newLines);
  };

  const removeLine = (index: number) => {
    setLinesForms(linesForms.filter((_, i) => i !== index));
  };

  const columns: Column<PurchaseContract>[] = [
    { key: 'contractNumber', header: 'Contract #', accessor: 'contractNumber' },
    { key: 'supplier', header: 'Supplier', accessor: (r) => r.supplier?.name || r.supplierId },
    {
      key: 'type', header: 'Type',
      accessor: (r) => <Badge variant={typeVariant[r.contractType] || 'secondary'} size="sm">{r.contractType}</Badge>,
    },
    { key: 'startDate', header: 'Start Date', accessor: (r) => safeFormat(r.startDate, 'MMM dd, yyyy') },
    { key: 'endDate', header: 'End Date', accessor: (r) => safeFormat(r.endDate, 'MMM dd, yyyy') },
    { key: 'totalValue', header: 'Total Value', accessor: (r) => r.totalValue ? `${r.currency} ${r.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—', align: 'right' },
    { key: 'currency', header: 'Currency', accessor: 'currency' },
    {
      key: 'status', header: 'Status',
      accessor: (r) => <Badge variant={statusVariant[r.status] || 'secondary'} size="sm">{r.status}</Badge>,
    },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelected(r); setShowDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          <button onClick={() => {
            setSelected(r);
            setForm({
              contractNumber: r.contractNumber,
              supplierId: r.supplierId,
              contractType: r.contractType,
              startDate: r.startDate?.slice(0, 10) || '',
              endDate: r.endDate?.slice(0, 10) || '',
              totalValue: r.totalValue || 0,
              currency: r.currency || 'USD',
              paymentTerms: r.paymentTerms || 'NET30',
              notes: r.notes || '',
            });
            setShowEdit(true);
          }} className="p-1 text-amber-600 hover:text-amber-800"><PencilIcon className="h-4 w-4" /></button>
          <button onClick={() => { if (confirm('Delete this contract?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const FormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Contract Number *</label>
          <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.contractNumber} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })} placeholder="PC-001" disabled={showEdit} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
            <option value="">Select supplier...</option>
            {suppliersData.map((s: any) => <option key={s.id} value={s.id}>{s.name || s.code}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Contract Type</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value as PurchaseContractType })}>
            {(['BLANKET', 'FRAMEWORK', 'QUANTITY', 'VALUE'] as PurchaseContractType[]).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'CAD', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
          <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
          <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Total Value</label>
          <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.totalValue} onChange={(e) => setForm({ ...form, totalValue: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
            {['COD', 'NET15', 'NET30', 'NET45', 'NET60', 'NET90'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </div>
  );

  const LineItems = () => (
    <div className="space-y-3 mt-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Contract Lines</h3>
        <Button variant="secondary" size="sm" onClick={addLine} leftIcon={<PlusIcon className="h-3 w-3" />}>Add Line</Button>
      </div>
      {linesForms.map((line, idx) => (
        <div key={idx} className="grid grid-cols-6 gap-2 items-end border p-2 rounded">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Product</label>
            <ProductSelector value={line.productId || undefined} onChange={(id) => updateLine(idx, 'productId', id)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Agreed Price</label>
            <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-primary-500 focus:ring-primary-500" value={line.agreedPrice} onChange={(e) => updateLine(idx, 'agreedPrice', +e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Agreed Qty</label>
            <input type="number" className="w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-primary-500 focus:ring-primary-500" value={line.agreedQty} onChange={(e) => updateLine(idx, 'agreedQty', +e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Min Order Qty</label>
            <input type="number" className="w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-primary-500 focus:ring-primary-500" value={line.minOrderQty} onChange={(e) => updateLine(idx, 'minOrderQty', +e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Lead Time (d)</label>
            <input type="number" className="w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-primary-500 focus:ring-primary-500" value={line.leadTimeDays} onChange={(e) => updateLine(idx, 'leadTimeDays', +e.target.value)} />
          </div>
          <div>
            <button onClick={() => removeLine(idx)} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
      {linesForms.length === 0 && <p className="text-sm text-gray-400">No line items added yet</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Purchase Contracts</h1>
          <p className="text-secondary-500 mt-1">Manage long-term purchase agreements with suppliers</p>
        </div>
        <div className="flex gap-2">
          <select className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="COMPLETED">Completed</option>
          </select>
          <Button onClick={() => { setForm(emptyForm); setLinesForms([]); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New Contract</Button>
        </div>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader title="Purchase Contracts" description="Supplier contract agreements" />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No purchase contracts found" />
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Purchase Contract" size="xl">
        <FormFields />
        <LineItems />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.contractNumber || !form.supplierId || !form.endDate}>Create</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Purchase Contract" size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
          <Button onClick={() => selected && updateMut.mutate({
            id: selected.id,
            dto: {
              contractType: form.contractType,
              startDate: form.startDate,
              endDate: form.endDate,
              totalValue: Number(form.totalValue) || undefined,
              currency: form.currency,
              paymentTerms: form.paymentTerms || undefined,
              notes: form.notes || undefined,
            } as Partial<PurchaseContract>,
          })} isLoading={updateMut.isPending}>Save</Button>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); }} title={selected ? `Contract ${selected.contractNumber}` : 'Contract Detail'} size="xl">
        {selected && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Supplier:</span> {(contractDetail as any)?.supplier?.name || selected.supplier?.name || selected.supplierId}</div>
              <div><span className="font-medium text-gray-500">Type:</span> <Badge variant={typeVariant[selected.contractType] || 'secondary'} size="sm">{selected.contractType}</Badge></div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={statusVariant[selected.status] || 'secondary'} size="sm">{selected.status}</Badge></div>
              <div><span className="font-medium text-gray-500">Currency:</span> {selected.currency}</div>
            </div>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Start:</span> {safeFormat(selected.startDate, 'MMM dd, yyyy')}</div>
              <div><span className="font-medium text-gray-500">End:</span> {safeFormat(selected.endDate, 'MMM dd, yyyy')}</div>
              <div><span className="font-medium text-gray-500">Total Value:</span> {selected.totalValue ? `${selected.currency} ${selected.totalValue.toLocaleString()}` : '—'}</div>
              <div><span className="font-medium text-gray-500">Consumed:</span> {selected.currency} {selected.consumedValue?.toLocaleString() ?? 0}</div>
            </div>
            {selected.paymentTerms && (
              <div className="text-sm"><span className="font-medium text-gray-500">Payment Terms:</span> {selected.paymentTerms}</div>
            )}
            {selected.notes && (
              <div className="text-sm"><span className="font-medium text-gray-500">Notes:</span> {selected.notes}</div>
            )}

            {/* Contract Lines */}
            <div>
              <h3 className="text-base font-semibold mb-2">Contract Lines ({linesData.length})</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Agreed Price</th>
                    <th className="px-3 py-2 text-right">Agreed Qty</th>
                    <th className="px-3 py-2 text-right">Consumed Qty</th>
                    <th className="px-3 py-2 text-right">Min Order Qty</th>
                    <th className="px-3 py-2 text-right">Lead Time</th>
                    <th className="px-3 py-2">UOM</th>
                  </tr></thead>
                  <tbody>
                    {linesData.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">No contract lines</td></tr>}
                    {linesData.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-3 py-2">{l.product?.name || l.productId}</td>
                        <td className="px-3 py-2 text-right">{selected.currency} {l.agreedPrice?.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{l.agreedQty?.toLocaleString() ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{l.consumedQty?.toLocaleString() ?? 0}</td>
                        <td className="px-3 py-2 text-right">{l.minOrderQty ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{l.leadTimeDays ? `${l.leadTimeDays}d` : '—'}</td>
                        <td className="px-3 py-2">{l.uom || '—'}</td>
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
