import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProgressBar, QueryErrorBanner } from '@components/ui';
import {
    ArrowPathIcon,
    ChartBarIcon,
    ClockIcon,
    CogIcon,
    ExclamationTriangleIcon,
    PencilIcon,
    PlusIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import {
    dataService,
    downtimeReasonService,
    downtimeRecordService,
    productionKpiService,
    productionLineService,
    scrapReasonService,
} from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';

// ============================================================================
// Helpers
// ============================================================================

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

type Tab = 'lines' | 'downtime-reasons' | 'downtime-records' | 'scrap-reasons' | 'kpis';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'lines', label: 'Production Lines', icon: CogIcon },
  { key: 'downtime-reasons', label: 'Downtime Reasons', icon: ExclamationTriangleIcon },
  { key: 'downtime-records', label: 'Downtime Records', icon: ClockIcon },
  { key: 'scrap-reasons', label: 'Scrap Reasons', icon: TrashIcon },
  { key: 'kpis', label: 'KPI Dashboard', icon: ChartBarIcon },
];

const LINE_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'DECOMMISSIONED'];
const DOWNTIME_CATEGORIES = ['MECHANICAL', 'ELECTRICAL', 'CHANGEOVER', 'MATERIAL', 'QUALITY', 'PLANNED_MAINTENANCE', 'BREAK', 'OTHER'];

// ============================================================================
// Production Lines Tab
// ============================================================================

function ProductionLinesTab() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ code: '', name: '', description: '', locationId: '', status: 'ACTIVE', outputRate: 0, outputUom: 'EA' });

  const { data: lines = [], isLoading, error } = useQuery({ queryKey: ['production-lines'], queryFn: () => productionLineService.getAll() });
  const { data: locations = [] } = useQuery({ queryKey: ['locations'], queryFn: () => dataService.getLocations() });

  const createMut = useMutation({ mutationFn: (d: any) => productionLineService.create(d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-lines'] }); toast.success('Production line created'); close(); } });
  const updateMut = useMutation({ mutationFn: ({ id, d }: any) => productionLineService.update(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-lines'] }); toast.success('Production line updated'); close(); } });
  const deleteMut = useMutation({ mutationFn: (id: string) => productionLineService.delete(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-lines'] }); toast.success('Production line deleted'); } });

  const close = () => { setShowModal(false); setEditing(null); setForm({ code: '', name: '', description: '', locationId: '', status: 'ACTIVE', outputRate: 0, outputUom: 'EA' }); };
  const openCreate = () => { close(); setShowModal(true); };
  const openEdit = (row: any) => { setEditing(row); setForm({ code: row.code, name: row.name, description: row.description || '', locationId: row.locationId || '', status: row.status || 'ACTIVE', outputRate: row.outputRate || 0, outputUom: row.outputUom || 'EA' }); setShowModal(true); };
  const save = () => { editing ? updateMut.mutate({ id: editing.id, d: form }) : createMut.mutate(form); };

  const cols: Column<any>[] = [
    { key: 'code', header: 'Code', accessor: 'code', sortable: true },
    { key: 'name', header: 'Name', accessor: 'name', sortable: true },
    { key: 'status', header: 'Status', accessor: (r: any) => <Badge variant={r.status === 'ACTIVE' ? 'success' : r.status === 'MAINTENANCE' ? 'warning' : 'default'}>{r.status}</Badge> },
    { key: 'outputRate', header: 'Output Rate', accessor: (r: any) => r.outputRate ? `${r.outputRate} ${r.outputUom || ''}` : '—' },
    { key: 'stations', header: 'Stations', accessor: (r: any) => r.stations?.length ?? 0 },
    { key: 'createdAt', header: 'Created', accessor: (r: any) => safeFormat(r.createdAt, 'dd MMM yyyy') },
    { key: 'actions', header: '', accessor: (r: any) => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(r)} className="p-1 hover:bg-gray-100 rounded"><PencilIcon className="h-4 w-4" /></button>
        <button onClick={() => { if (confirm('Delete this line?')) deleteMut.mutate(r.id); }} className="p-1 hover:bg-red-100 rounded text-red-600"><TrashIcon className="h-4 w-4" /></button>
      </div>
    )},
  ];

  const locList = Array.isArray(locations) ? locations : (locations as any)?.data ?? [];

  return (
    <>
      {error && <QueryErrorBanner error={error} />}
      <Card>
        <CardHeader title="Production Lines" description="Manage production lines and their throughput configuration" actions={<Button onClick={openCreate} size="sm"><PlusIcon className="h-4 w-4 mr-1" /> Add Line</Button>} />
        <DataTable columns={cols} data={lines} keyExtractor={(r: any) => r.id} isLoading={isLoading} emptyMessage="No production lines found" />
      </Card>

      <Modal isOpen={showModal} onClose={close} title={editing ? 'Edit Production Line' : 'New Production Line'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Code *</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editing} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea className="w-full border rounded px-3 py-2 text-sm" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Location</label>
              <select className="w-full border rounded px-3 py-2 text-sm" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                <option value="">— Select —</option>
                {locList.map((l: any) => <option key={l.id} value={l.id}>{l.name || l.code || l.id}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select className="w-full border rounded px-3 py-2 text-sm" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {LINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Output Rate</label>
              <input type="number" className="w-full border rounded px-3 py-2 text-sm" value={form.outputRate} onChange={(e) => setForm({ ...form, outputRate: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Output UOM</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.outputUom} onChange={(e) => setForm({ ...form, outputUom: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.code || !form.name}>{editing ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ============================================================================
// Downtime Reasons Tab
// ============================================================================

function DowntimeReasonsTab() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ code: '', name: '', category: 'OTHER', isPlanned: false, isActive: true });

  const { data: reasons = [], isLoading, error } = useQuery({ queryKey: ['downtime-reasons'], queryFn: () => downtimeReasonService.getAll() });

  const createMut = useMutation({ mutationFn: (d: any) => downtimeReasonService.create(d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-reasons'] }); toast.success('Downtime reason created'); close(); } });
  const updateMut = useMutation({ mutationFn: ({ id, d }: any) => downtimeReasonService.update(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-reasons'] }); toast.success('Downtime reason updated'); close(); } });
  const deleteMut = useMutation({ mutationFn: (id: string) => downtimeReasonService.delete(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-reasons'] }); toast.success('Downtime reason deleted'); } });

  const close = () => { setShowModal(false); setEditing(null); setForm({ code: '', name: '', category: 'OTHER', isPlanned: false, isActive: true }); };
  const openCreate = () => { close(); setShowModal(true); };
  const openEdit = (row: any) => { setEditing(row); setForm({ code: row.code, name: row.name, category: row.category || 'OTHER', isPlanned: row.isPlanned ?? false, isActive: row.isActive ?? true }); setShowModal(true); };
  const save = () => { editing ? updateMut.mutate({ id: editing.id, d: form }) : createMut.mutate(form); };

  const cols: Column<any>[] = [
    { key: 'code', header: 'Code', accessor: 'code', sortable: true },
    { key: 'name', header: 'Name', accessor: 'name', sortable: true },
    { key: 'category', header: 'Category', accessor: (r: any) => <Badge>{r.category || 'OTHER'}</Badge> },
    { key: 'isPlanned', header: 'Planned', accessor: (r: any) => r.isPlanned ? <Badge variant="primary">Planned</Badge> : <Badge variant="warning">Unplanned</Badge> },
    { key: 'isActive', header: 'Active', accessor: (r: any) => r.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="default">Inactive</Badge> },
    { key: 'actions', header: '', accessor: (r: any) => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(r)} className="p-1 hover:bg-gray-100 rounded"><PencilIcon className="h-4 w-4" /></button>
        <button onClick={() => { if (confirm('Delete this reason?')) deleteMut.mutate(r.id); }} className="p-1 hover:bg-red-100 rounded text-red-600"><TrashIcon className="h-4 w-4" /></button>
      </div>
    )},
  ];

  return (
    <>
      {error && <QueryErrorBanner error={error} />}
      <Card>
        <CardHeader title="Downtime Reasons" description="Define reasons for production downtime events" actions={<Button onClick={openCreate} size="sm"><PlusIcon className="h-4 w-4 mr-1" /> Add Reason</Button>} />
        <DataTable columns={cols} data={reasons} keyExtractor={(r: any) => r.id} isLoading={isLoading} emptyMessage="No downtime reasons configured" />
      </Card>

      <Modal isOpen={showModal} onClose={close} title={editing ? 'Edit Downtime Reason' : 'New Downtime Reason'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Code *</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editing} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {DOWNTIME_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isPlanned} onChange={(e) => setForm({ ...form, isPlanned: e.target.checked })} /> Planned downtime
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.code || !form.name}>{editing ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ============================================================================
// Downtime Records Tab
// ============================================================================

function DowntimeRecordsTab() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [filters, setFilters] = useState({ productionLineId: '', startDate: '', endDate: '' });
  const [form, setForm] = useState({ downtimeReasonId: '', productionLineId: '', workOrderId: '', startTime: '', endTime: '', durationMinutes: 0, notes: '' });

  const queryParams = { ...filters, startDate: filters.startDate || undefined, endDate: filters.endDate || undefined, productionLineId: filters.productionLineId || undefined };
  const { data: records = [], isLoading, error } = useQuery({ queryKey: ['downtime-records', queryParams], queryFn: () => downtimeRecordService.getAll(queryParams as any) });
  const { data: lines = [] } = useQuery({ queryKey: ['production-lines'], queryFn: () => productionLineService.getAll() });
  const { data: reasons = [] } = useQuery({ queryKey: ['downtime-reasons'], queryFn: () => downtimeReasonService.getAll() });

  const createMut = useMutation({ mutationFn: (d: any) => downtimeRecordService.create(d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-records'] }); toast.success('Downtime record created'); close(); } });
  const updateMut = useMutation({ mutationFn: ({ id, d }: any) => downtimeRecordService.update(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-records'] }); toast.success('Downtime record updated'); close(); } });
  const deleteMut = useMutation({ mutationFn: (id: string) => downtimeRecordService.delete(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-records'] }); toast.success('Downtime record deleted'); } });

  const close = () => { setShowModal(false); setEditing(null); setForm({ downtimeReasonId: '', productionLineId: '', workOrderId: '', startTime: '', endTime: '', durationMinutes: 0, notes: '' }); };
  const openCreate = () => { close(); setShowModal(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      downtimeReasonId: row.downtimeReasonId || '',
      productionLineId: row.productionLineId || '',
      workOrderId: row.workOrderId || '',
      startTime: row.startTime ? new Date(row.startTime).toISOString().slice(0, 16) : '',
      endTime: row.endTime ? new Date(row.endTime).toISOString().slice(0, 16) : '',
      durationMinutes: row.durationMinutes || 0,
      notes: row.notes || '',
    });
    setShowModal(true);
  };
  const save = () => { editing ? updateMut.mutate({ id: editing.id, d: { endTime: form.endTime || undefined, durationMinutes: form.durationMinutes || undefined, notes: form.notes || undefined } }) : createMut.mutate(form); };

  const lineList = Array.isArray(lines) ? lines : [];
  const reasonList = Array.isArray(reasons) ? reasons : [];

  const cols: Column<any>[] = [
    { key: 'productionLine', header: 'Line', accessor: (r: any) => r.productionLine?.name || r.productionLineId?.slice(0, 8) || '—' },
    { key: 'downtimeReason', header: 'Reason', accessor: (r: any) => r.downtimeReason?.name || '—' },
    { key: 'startTime', header: 'Start', accessor: (r: any) => safeFormat(r.startTime, 'dd MMM HH:mm') },
    { key: 'endTime', header: 'End', accessor: (r: any) => safeFormat(r.endTime, 'dd MMM HH:mm') },
    { key: 'durationMinutes', header: 'Duration (min)', accessor: (r: any) => r.durationMinutes ?? '—' },
    { key: 'notes', header: 'Notes', accessor: (r: any) => r.notes ? <span className="truncate max-w-[200px] inline-block">{r.notes}</span> : '—' },
    { key: 'actions', header: '', accessor: (r: any) => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(r)} className="p-1 hover:bg-gray-100 rounded"><PencilIcon className="h-4 w-4" /></button>
        <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(r.id); }} className="p-1 hover:bg-red-100 rounded text-red-600"><TrashIcon className="h-4 w-4" /></button>
      </div>
    )},
  ];

  return (
    <>
      {error && <QueryErrorBanner error={error} />}
      <Card>
        <CardHeader title="Downtime Records" description="Track and analyse production downtime events" actions={<Button onClick={openCreate} size="sm"><PlusIcon className="h-4 w-4 mr-1" /> Log Downtime</Button>} />
        <div className="flex flex-wrap gap-3 px-4 pb-3">
          <select className="border rounded px-3 py-1.5 text-sm" value={filters.productionLineId} onChange={(e) => setFilters({ ...filters, productionLineId: e.target.value })}>
            <option value="">All Lines</option>
            {lineList.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <input type="date" className="border rounded px-3 py-1.5 text-sm" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} />
          <input type="date" className="border rounded px-3 py-1.5 text-sm" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} />
        </div>
        <DataTable columns={cols} data={records} keyExtractor={(r: any) => r.id} isLoading={isLoading} emptyMessage="No downtime records found" />
      </Card>

      <Modal isOpen={showModal} onClose={close} title={editing ? 'Edit Downtime Record' : 'Log Downtime'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Production Line *</label>
              <select className="w-full border rounded px-3 py-2 text-sm" value={form.productionLineId} onChange={(e) => setForm({ ...form, productionLineId: e.target.value })} disabled={!!editing}>
                <option value="">— Select —</option>
                {lineList.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Downtime Reason *</label>
              <select className="w-full border rounded px-3 py-2 text-sm" value={form.downtimeReasonId} onChange={(e) => setForm({ ...form, downtimeReasonId: e.target.value })} disabled={!!editing}>
                <option value="">— Select —</option>
                {reasonList.map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.category})</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Start Time *</label>
              <input type="datetime-local" className="w-full border rounded px-3 py-2 text-sm" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} disabled={!!editing} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Time</label>
              <input type="datetime-local" className="w-full border rounded px-3 py-2 text-sm" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Duration (minutes)</label>
            <input type="number" className="w-full border rounded px-3 py-2 text-sm" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea className="w-full border rounded px-3 py-2 text-sm" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.productionLineId || !form.downtimeReasonId || !form.startTime}>{editing ? 'Update' : 'Log'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ============================================================================
// Scrap Reasons Tab
// ============================================================================

function ScrapReasonsTab() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ code: '', name: '', category: 'OTHER', isActive: true });

  const { data: reasons = [], isLoading, error } = useQuery({ queryKey: ['scrap-reasons'], queryFn: () => scrapReasonService.getAll() });

  const createMut = useMutation({ mutationFn: (d: any) => scrapReasonService.create(d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['scrap-reasons'] }); toast.success('Scrap reason created'); close(); } });
  const updateMut = useMutation({ mutationFn: ({ id, d }: any) => scrapReasonService.update(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['scrap-reasons'] }); toast.success('Scrap reason updated'); close(); } });
  const deleteMut = useMutation({ mutationFn: (id: string) => scrapReasonService.delete(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['scrap-reasons'] }); toast.success('Scrap reason deleted'); } });

  const close = () => { setShowModal(false); setEditing(null); setForm({ code: '', name: '', category: 'OTHER', isActive: true }); };
  const openCreate = () => { close(); setShowModal(true); };
  const openEdit = (row: any) => { setEditing(row); setForm({ code: row.code, name: row.name, category: row.category || 'OTHER', isActive: row.isActive ?? true }); setShowModal(true); };
  const save = () => { editing ? updateMut.mutate({ id: editing.id, d: form }) : createMut.mutate(form); };

  const SCRAP_CATEGORIES = ['MATERIAL_DEFECT', 'MACHINE_ERROR', 'OPERATOR_ERROR', 'DESIGN_ISSUE', 'TOOLING', 'PROCESS', 'OTHER'];

  const cols: Column<any>[] = [
    { key: 'code', header: 'Code', accessor: 'code', sortable: true },
    { key: 'name', header: 'Name', accessor: 'name', sortable: true },
    { key: 'category', header: 'Category', accessor: (r: any) => <Badge>{r.category || 'OTHER'}</Badge> },
    { key: 'isActive', header: 'Active', accessor: (r: any) => r.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="default">Inactive</Badge> },
    { key: 'actions', header: '', accessor: (r: any) => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(r)} className="p-1 hover:bg-gray-100 rounded"><PencilIcon className="h-4 w-4" /></button>
        <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(r.id); }} className="p-1 hover:bg-red-100 rounded text-red-600"><TrashIcon className="h-4 w-4" /></button>
      </div>
    )},
  ];

  return (
    <>
      {error && <QueryErrorBanner error={error} />}
      <Card>
        <CardHeader title="Scrap Reasons" description="Define reasons for scrap and waste in production" actions={<Button onClick={openCreate} size="sm"><PlusIcon className="h-4 w-4 mr-1" /> Add Reason</Button>} />
        <DataTable columns={cols} data={reasons} keyExtractor={(r: any) => r.id} isLoading={isLoading} emptyMessage="No scrap reasons configured" />
      </Card>

      <Modal isOpen={showModal} onClose={close} title={editing ? 'Edit Scrap Reason' : 'New Scrap Reason'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Code *</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editing} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {SCRAP_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.code || !form.name}>{editing ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ============================================================================
// KPI Dashboard Tab
// ============================================================================

function KPIDashboardTab() {
  const [filters, setFilters] = useState({ productionLineId: '', startDate: '', endDate: '' });
  const queryParams = { productionLineId: filters.productionLineId || undefined, startDate: filters.startDate || undefined, endDate: filters.endDate || undefined };

  const { data: kpis, isLoading, error, refetch } = useQuery({ queryKey: ['production-kpis', queryParams], queryFn: () => productionKpiService.get(queryParams as any) });
  const { data: lines = [] } = useQuery({ queryKey: ['production-lines'], queryFn: () => productionLineService.getAll() });

  const lineList = Array.isArray(lines) ? lines : [];

  const oee = kpis?.oee ?? 0;
  const availability = kpis?.availability ?? 0;
  const performance = kpis?.performance ?? 0;
  const quality = kpis?.quality ?? 0;
  const yieldRate = kpis?.yieldRate ?? 0;

  const oeeColor = oee >= 85 ? 'green' : oee >= 65 ? 'yellow' : 'red';

  return (
    <>
      {error && <QueryErrorBanner error={error} />}
      <Card>
        <CardHeader title="Production KPIs" description="Overall Equipment Effectiveness (OEE) and production metrics" actions={<Button variant="secondary" size="sm" onClick={() => refetch()}><ArrowPathIcon className="h-4 w-4 mr-1" /> Refresh</Button>} />

        <div className="flex flex-wrap gap-3 px-4 pb-4">
          <select className="border rounded px-3 py-1.5 text-sm" value={filters.productionLineId} onChange={(e) => setFilters({ ...filters, productionLineId: e.target.value })}>
            <option value="">All Lines</option>
            {lineList.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <input type="date" className="border rounded px-3 py-1.5 text-sm" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} placeholder="From" />
          <input type="date" className="border rounded px-3 py-1.5 text-sm" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} placeholder="To" />
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading KPIs…</div>
        ) : (
          <div className="p-4 space-y-6">
            {/* OEE Headline */}
            <div className="text-center">
              <div className={`text-5xl font-bold ${oeeColor === 'green' ? 'text-green-600' : oeeColor === 'yellow' ? 'text-yellow-600' : 'text-red-600'}`}>
                {(oee * 100).toFixed(1)}%
              </div>
              <div className="text-sm text-gray-500 mt-1">Overall Equipment Effectiveness</div>
            </div>

            {/* OEE Factors */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border rounded-lg p-4 text-center">
                <div className="text-2xl font-semibold text-blue-600">{(availability * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500 mb-2">Availability</div>
                <ProgressBar value={availability * 100} max={100} className="h-2" />
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-2xl font-semibold text-purple-600">{(performance * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500 mb-2">Performance</div>
                <ProgressBar value={performance * 100} max={100} className="h-2" />
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-2xl font-semibold text-teal-600">{(quality * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500 mb-2">Quality</div>
                <ProgressBar value={quality * 100} max={100} className="h-2" />
              </div>
            </div>

            {/* Additional Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border rounded-lg p-3 text-center">
                <div className="text-lg font-semibold">{kpis?.totalWorkOrders ?? 0}</div>
                <div className="text-xs text-gray-500">Work Orders</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-lg font-semibold">{kpis?.completedWorkOrders ?? 0}</div>
                <div className="text-xs text-gray-500">Completed</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-lg font-semibold">{(yieldRate * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500">Yield Rate</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-lg font-semibold">{kpis?.totalDowntimeMinutes ?? 0}</div>
                <div className="text-xs text-gray-500">Downtime (min)</div>
              </div>
            </div>

            {/* Downtime by Category */}
            {kpis?.downtimeByCategory && Object.keys(kpis.downtimeByCategory).length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Downtime by Category</h4>
                <div className="space-y-2">
                  {Object.entries(kpis.downtimeByCategory).map(([cat, mins]: [string, any]) => (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="w-40 text-sm truncate">{cat.replace(/_/g, ' ')}</span>
                      <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                        <div className="bg-red-400 h-full rounded" style={{ width: `${Math.min(100, (mins / (kpis.totalDowntimeMinutes || 1)) * 100)}%` }} />
                      </div>
                      <span className="text-sm font-medium w-16 text-right">{mins} min</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function ProductionPage() {
  const [activeTab, setActiveTab] = useState<Tab>('lines');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Production</h1>
          <p className="text-sm text-gray-500">Manage production lines, track downtime, scrap reasons, and monitor OEE metrics</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-0 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'lines' && <ProductionLinesTab />}
      {activeTab === 'downtime-reasons' && <DowntimeReasonsTab />}
      {activeTab === 'downtime-records' && <DowntimeRecordsTab />}
      {activeTab === 'scrap-reasons' && <ScrapReasonsTab />}
      {activeTab === 'kpis' && <KPIDashboardTab />}
    </div>
  );
}
