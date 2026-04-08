import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { EyeIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { qualityInspectionService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { QualityInspection, QualityInspectionStatus, QualityInspectionType } from '../../types';

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
  PENDING: 'secondary',
  IN_PROGRESS: 'primary',
  PASSED: 'success',
  FAILED: 'error',
  CONDITIONALLY_ACCEPTED: 'warning',
};

const emptyForm = {
  inspectionType: 'INCOMING' as QualityInspectionType,
  productId: '',
  inspectedQty: 0,
  acceptedQty: 0,
  rejectedQty: 0,
  defectType: '',
  defectDescription: '',
  notes: '',
  inspectionDate: new Date().toISOString().slice(0, 10),
};

export default function QualityInspectionsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<QualityInspection | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'quality-inspections', statusFilter],
    queryFn: () => qualityInspectionService.getAll({ status: (statusFilter || undefined) as QualityInspectionStatus | undefined, pageSize: 100 }),
  });

  const items: QualityInspection[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => qualityInspectionService.create({
      inspectionType: d.inspectionType,
      productId: d.productId,
      inspectedQty: Number(d.inspectedQty),
      defectType: d.defectType || undefined,
      defectDescription: d.defectDescription || undefined,
      notes: d.notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'quality-inspections'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('Quality inspection created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create inspection'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => qualityInspectionService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'quality-inspections'] });
      toast.success('Inspection deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete inspection'); },
  });

  const columns: Column<QualityInspection>[] = [
    { key: 'inspectionNumber', header: 'Inspection #', accessor: 'inspectionNumber' },
    {
      key: 'type', header: 'Type',
      accessor: (r) => <Badge variant="primary" size="sm">{r.inspectionType}</Badge>,
    },
    {
      key: 'status', header: 'Status',
      accessor: (r) => <Badge variant={statusVariant[r.status] || 'secondary'} size="sm">{r.status}</Badge>,
    },
    { key: 'product', header: 'Product', accessor: (r) => r.product?.name || r.productId },
    { key: 'inspectedQty', header: 'Inspected', accessor: (r) => r.inspectedQty?.toLocaleString(), align: 'right' },
    { key: 'acceptedQty', header: 'Accepted', accessor: (r) => r.acceptedQty?.toLocaleString(), align: 'right' },
    { key: 'rejectedQty', header: 'Rejected', accessor: (r) => r.rejectedQty?.toLocaleString(), align: 'right' },
    { key: 'inspectionDate', header: 'Inspection Date', accessor: (r) => safeFormat(r.inspectionDate, 'MMM dd, yyyy') },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelected(r); setShowDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          <button onClick={() => { if (confirm('Delete this inspection?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const FormFields = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
        <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.inspectionType} onChange={(e) => setForm({ ...form, inspectionType: e.target.value as QualityInspectionType })}>
          {(['INCOMING', 'IN_PROCESS', 'FINAL', 'RECEIVING'] as QualityInspectionType[]).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
          <ProductSelector value={form.productId || undefined} onChange={(id) => setForm({ ...form, productId: id })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Inspection Date</label>
          <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.inspectionDate} onChange={(e) => setForm({ ...form, inspectionDate: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Inspected Qty *</label>
          <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.inspectedQty} onChange={(e) => setForm({ ...form, inspectedQty: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Accepted Qty</label>
          <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.acceptedQty} onChange={(e) => setForm({ ...form, acceptedQty: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Rejected Qty</label>
          <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.rejectedQty} onChange={(e) => setForm({ ...form, rejectedQty: +e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Defect Type</label>
          <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.defectType} onChange={(e) => setForm({ ...form, defectType: e.target.value })} placeholder="e.g. Dimensional, Surface, Functional" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Defect Description</label>
          <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.defectDescription} onChange={(e) => setForm({ ...form, defectDescription: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Quality Inspections</h1>
          <p className="text-secondary-500 mt-1">Track and manage quality inspections across production and receiving</p>
        </div>
        <div className="flex gap-2">
          <select className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="PASSED">Passed</option>
            <option value="FAILED">Failed</option>
            <option value="CONDITIONALLY_ACCEPTED">Conditional</option>
          </select>
          <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New Inspection</Button>
        </div>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader title="Quality Inspections" description="All quality inspection records" />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No quality inspections found" />
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Quality Inspection" size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.productId}>Create</Button>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); }} title={selected ? `Inspection ${selected.inspectionNumber}` : 'Inspection Detail'} size="lg">
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Type:</span> {selected.inspectionType}</div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={statusVariant[selected.status] || 'secondary'} size="sm">{selected.status}</Badge></div>
              <div><span className="font-medium text-gray-500">Product:</span> {selected.product?.name || selected.productId}</div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Inspected Qty:</span> {selected.inspectedQty}</div>
              <div><span className="font-medium text-gray-500">Accepted Qty:</span> {selected.acceptedQty}</div>
              <div><span className="font-medium text-gray-500">Rejected Qty:</span> {selected.rejectedQty}</div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Inspection Date:</span> {safeFormat(selected.inspectionDate, 'MMM dd, yyyy')}</div>
              <div><span className="font-medium text-gray-500">Completed Date:</span> {safeFormat(selected.completedDate, 'MMM dd, yyyy')}</div>
              <div><span className="font-medium text-gray-500">Defect Type:</span> {selected.defectType || '—'}</div>
            </div>
            {selected.defectDescription && (
              <div className="text-sm"><span className="font-medium text-gray-500">Defect Description:</span> {selected.defectDescription}</div>
            )}
            {selected.notes && (
              <div className="text-sm"><span className="font-medium text-gray-500">Notes:</span> {selected.notes}</div>
            )}
            {selected.workOrder && (
              <div className="text-sm"><span className="font-medium text-gray-500">Work Order:</span> {selected.workOrder.woNumber}</div>
            )}
            {selected.purchaseOrder && (
              <div className="text-sm"><span className="font-medium text-gray-500">Purchase Order:</span> {selected.purchaseOrder.poNumber}</div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
