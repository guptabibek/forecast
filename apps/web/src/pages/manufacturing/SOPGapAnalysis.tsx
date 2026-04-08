import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { sopGapService, sopService } from '@services/api';
import type { SOPCycle } from '@services/api/sop.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { SOPGapAnalysis } from '../../types';

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

const priorityVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  HIGH: 'error',
  MEDIUM: 'warning',
  LOW: 'secondary',
};

const statusVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  OPEN: 'warning',
  IN_PROGRESS: 'primary',
  RESOLVED: 'success',
  CLOSED: 'secondary',
};

const emptyForm = {
  cycleId: '',
  periodDate: new Date().toISOString().slice(0, 10),
  demandQty: 0,
  supplyQty: 0,
  gapRevenue: 0,
  gapCost: 0,
  resolution: '',
  priority: 'MEDIUM',
  assignedTo: '',
};

export default function SOPGapAnalysisPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [statusFilter, setStatusFilter] = useState('');

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'sop-gap-analysis', statusFilter],
    queryFn: () => sopGapService.getAll({ status: statusFilter || undefined, pageSize: 100 }),
  });

  const { data: cyclesData } = useQuery({
    queryKey: ['manufacturing', 'sop', 'cycles-list'],
    queryFn: () => sopService.getCycles({ pageSize: 200 }),
  });
  const cycleOptions: SOPCycle[] = Array.isArray(cyclesData?.items) ? cyclesData.items : Array.isArray(cyclesData) ? cyclesData : [];

  const items: SOPGapAnalysis[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => sopGapService.create({
      cycleId: d.cycleId,
      periodDate: d.periodDate,
      demandQty: Number(d.demandQty),
      supplyQty: Number(d.supplyQty),
      gapQty: Number(d.demandQty) - Number(d.supplyQty),
      gapRevenue: Number(d.gapRevenue),
      gapCost: Number(d.gapCost),
      resolution: d.resolution || undefined,
      priority: d.priority || undefined,
      assignedTo: d.assignedTo || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'sop-gap-analysis'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('S&OP gap analysis created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create gap analysis'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => sopGapService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'sop-gap-analysis'] });
      toast.success('Gap analysis deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete gap analysis'); },
  });

  const columns: Column<SOPGapAnalysis>[] = [
    { key: 'cycleId', header: 'S&OP Cycle', accessor: (r) => r.cycle?.name || r.cycleId },
    { key: 'periodDate', header: 'Period Date', accessor: (r) => safeFormat(r.periodDate, 'MMM dd, yyyy') },
    { key: 'demandQty', header: 'Demand Qty', accessor: (r) => r.demandQty?.toLocaleString(), align: 'right' },
    { key: 'supplyQty', header: 'Supply Qty', accessor: (r) => r.supplyQty?.toLocaleString(), align: 'right' },
    {
      key: 'gapQty', header: 'Gap Qty',
      accessor: (r) => (
        <span className={r.gapQty > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
          {r.gapQty?.toLocaleString()}
        </span>
      ),
      align: 'right',
    },
    { key: 'gapRevenue', header: 'Gap Revenue', accessor: (r) => `$${r.gapRevenue?.toLocaleString()}`, align: 'right' },
    {
      key: 'priority', header: 'Priority',
      accessor: (r) => r.priority ? <Badge variant={priorityVariant[r.priority] || 'secondary'} size="sm">{r.priority}</Badge> : '—',
    },
    {
      key: 'status', header: 'Status',
      accessor: (r) => <Badge variant={statusVariant[r.status] || 'secondary'} size="sm">{r.status}</Badge>,
    },
    { key: 'resolution', header: 'Resolution', accessor: (r) => r.resolution || '—' },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { if (confirm('Delete this gap analysis?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const computedGap = Number(form.demandQty) - Number(form.supplyQty);

  const FormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">S&OP Cycle *</label>
          <select
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            value={form.cycleId}
            onChange={(e) => setForm({ ...form, cycleId: e.target.value })}
          >
            <option value="">— Select a cycle —</option>
            {cycleOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Period Date *</label>
          <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.periodDate} onChange={(e) => setForm({ ...form, periodDate: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Demand Qty *</label>
          <input type="number" min={0} className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.demandQty} onChange={(e) => setForm({ ...form, demandQty: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Supply Qty *</label>
          <input type="number" min={0} className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.supplyQty} onChange={(e) => setForm({ ...form, supplyQty: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Gap Qty (auto)</label>
          <input type="number" readOnly className="w-full rounded-md border-gray-200 bg-gray-50 shadow-sm cursor-not-allowed" value={computedGap} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Gap Revenue</label>
          <input type="number" min={0} step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.gapRevenue} onChange={(e) => setForm({ ...form, gapRevenue: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Gap Cost</label>
          <input type="number" min={0} step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.gapCost} onChange={(e) => setForm({ ...form, gapCost: +e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {['HIGH', 'MEDIUM', 'LOW'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
          <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} placeholder="Assignee name" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Resolution</label>
        <textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" rows={3} value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} placeholder="Describe the resolution plan..." />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">S&OP Gap Analysis</h1>
          <p className="text-secondary-500 mt-1">Identify and manage demand-supply gaps across S&OP cycles</p>
        </div>
        <div className="flex gap-2">
          <select className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
          <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New Gap Analysis</Button>
        </div>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader title="S&OP Gap Analyses" description="All demand-supply gap analysis records" />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No gap analyses found" />
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New S&OP Gap Analysis" size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.cycleId || !form.periodDate}>Create</Button>
        </div>
      </Modal>
    </div>
  );
}
