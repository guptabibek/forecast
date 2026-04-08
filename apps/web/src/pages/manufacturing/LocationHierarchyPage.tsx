import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { dataService, locationHierarchyService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { LocationHierarchy } from '../../types';

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

const hierarchyTypeVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  OPERATIONAL: 'primary',
  PLANNING: 'success',
  REPORTING: 'secondary',
  DISTRIBUTION: 'warning',
};

const emptyForm = {
  locationId: '',
  parentId: '',
  level: 0,
  hierarchyType: 'OPERATIONAL',
  path: '',
};

export default function LocationHierarchyPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'location-hierarchy'],
    queryFn: () => locationHierarchyService.getAll({ pageSize: 200 }),
  });

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => dataService.getLocations(),
  });

  const items: LocationHierarchy[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const locationsData: any[] = Array.isArray(locations) ? locations : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => locationHierarchyService.create({
      locationId: d.locationId,
      parentId: d.parentId || undefined,
      level: Number(d.level),
      hierarchyType: d.hierarchyType,
      path: d.path || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'location-hierarchy'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('Location hierarchy node created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create hierarchy node'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => locationHierarchyService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'location-hierarchy'] });
      toast.success('Hierarchy node deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete hierarchy node'); },
  });

  const columns: Column<LocationHierarchy>[] = [
    {
      key: 'location', header: 'Location',
      accessor: (r) => r.location?.name || r.locationId,
    },
    { key: 'parentId', header: 'Parent', accessor: (r) => r.parentId || '—' },
    { key: 'level', header: 'Level', accessor: (r) => String(r.level), align: 'right' },
    {
      key: 'hierarchyType', header: 'Hierarchy Type',
      accessor: (r) => <Badge variant={hierarchyTypeVariant[r.hierarchyType] || 'secondary'} size="sm">{r.hierarchyType}</Badge>,
    },
    { key: 'path', header: 'Path', accessor: (r) => r.path || '—' },
    { key: 'createdAt', header: 'Created', accessor: (r) => safeFormat(r.createdAt, 'MMM dd, yyyy') },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { if (confirm('Delete this hierarchy node?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const FormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location *</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
            <option value="">Select location...</option>
            {locationsData.map((l: any) => <option key={l.id} value={l.id}>{l.name || l.code || l.id}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Parent (optional)</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
            <option value="">None (root node)</option>
            {items.map((n) => <option key={n.id} value={n.id}>{n.location?.name || n.locationId} (Level {n.level})</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Level</label>
          <input type="number" min={0} className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.level} onChange={(e) => setForm({ ...form, level: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Hierarchy Type *</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.hierarchyType} onChange={(e) => setForm({ ...form, hierarchyType: e.target.value })}>
            {['OPERATIONAL', 'PLANNING', 'REPORTING', 'DISTRIBUTION'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Path (optional)</label>
        <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} placeholder="e.g. /root/region/site" />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Location Hierarchy</h1>
          <p className="text-secondary-500 mt-1">Manage location hierarchy nodes for operational and planning structures</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New Node</Button>
        </div>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader title="Hierarchy Nodes" description="All location hierarchy records (flat view)" />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No hierarchy nodes found" />
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Hierarchy Node" size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.locationId}>Create</Button>
        </div>
      </Modal>
    </div>
  );
}
