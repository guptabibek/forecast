import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { EyeIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { capacityService, type CapacityBottleneck, type CapacityUtilization, type WorkCenter, type WorkCenterCapacity, type WorkCenterShift } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';

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

const WC_TYPES = ['MACHINE', 'LABOR', 'ASSEMBLY', 'PACKAGING', 'QUALITY', 'WAREHOUSE'];

const emptyWC = { code: '', name: '', description: '', type: 'MACHINE', costPerHour: 0, efficiencyPercent: 100 };
const emptyCapacity = { effectiveDate: '', endDate: '', standardCapacityPerHour: 1, maxCapacityPerHour: 0, availableHoursPerDay: 8, availableDaysPerWeek: 5, plannedDowntimePercent: 0 };
const emptyShift = { name: '', startTime: '06:00', endTime: '14:00', daysOfWeek: [1, 2, 3, 4, 5] as number[], effectiveDate: '', breakMinutes: 30, capacityFactor: 1 };

type Tab = 'work-centers' | 'utilization' | 'bottlenecks';

export default function CapacityPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('work-centers');
  const [showCreateWC, setShowCreateWC] = useState(false);
  const [showEditWC, setShowEditWC] = useState(false);
  const [showDetailWC, setShowDetailWC] = useState(false);
  const [showAddCapacity, setShowAddCapacity] = useState(false);
  const [showAddShift, setShowAddShift] = useState(false);
  const [selectedWC, setSelectedWC] = useState<WorkCenter | null>(null);
  const [wcForm, setWcForm] = useState<typeof emptyWC>(emptyWC);
  const [capForm, setCapForm] = useState<typeof emptyCapacity>(emptyCapacity);
  const [shiftForm, setShiftForm] = useState<typeof emptyShift>(emptyShift);

  // Queries
  const { data: wcData, isLoading: wcLoading, isError: isWcError, error: wcError, refetch: refetchWc } = useQuery({
    queryKey: ['manufacturing', 'capacity', 'work-centers'],
    queryFn: () => capacityService.getWorkCenters({ pageSize: 100 }),
  });

  const { data: wcDetail } = useQuery({
    queryKey: ['manufacturing', 'capacity', 'work-center', selectedWC?.id],
    queryFn: () => selectedWC ? capacityService.getWorkCenter(selectedWC.id) : null,
    enabled: !!selectedWC && showDetailWC,
  });

  const { data: capacities } = useQuery({
    queryKey: ['manufacturing', 'capacity', 'capacities', selectedWC?.id],
    queryFn: () => selectedWC ? capacityService.getCapacities(selectedWC.id) : null,
    enabled: !!selectedWC && showDetailWC,
  });

  const { data: shifts } = useQuery({
    queryKey: ['manufacturing', 'capacity', 'shifts', selectedWC?.id],
    queryFn: () => selectedWC ? capacityService.getShifts(selectedWC.id) : null,
    enabled: !!selectedWC && showDetailWC,
  });

  const today = new Date().toISOString().split('T')[0];
  const sixMonths = new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0];

  const { data: utilization, isLoading: utilLoading, isError: isUtilError, error: utilError } = useQuery({
    queryKey: ['manufacturing', 'capacity', 'utilization'],
    queryFn: () => capacityService.getUtilization({ startDate: today, endDate: sixMonths, granularity: 'MONTH' }),
    enabled: tab === 'utilization',
  });

  const { data: bottlenecks, isLoading: bnLoading, isError: isBnError, error: bnError } = useQuery({
    queryKey: ['manufacturing', 'capacity', 'bottlenecks'],
    queryFn: () => capacityService.detectBottlenecks({ startDate: today, endDate: sixMonths }),
    enabled: tab === 'bottlenecks',
  });

  const workCenters: WorkCenter[] = Array.isArray(wcData?.items) ? wcData.items : Array.isArray(wcData) ? wcData : [];
  const utilItems: CapacityUtilization[] = Array.isArray(utilization) ? utilization : [];
  const bnItems: CapacityBottleneck[] = Array.isArray(bottlenecks) ? bottlenecks : [];
  const capItems: WorkCenterCapacity[] = Array.isArray(capacities?.items) ? capacities.items : Array.isArray(capacities) ? capacities : [];
  const shiftItems: WorkCenterShift[] = Array.isArray(shifts?.items) ? shifts.items : Array.isArray(shifts) ? shifts : [];

  const hasError = isWcError || isUtilError || isBnError;
  const firstError = wcError || utilError || bnError;

  // Mutations
  const createWC = useMutation({
    mutationFn: (d: typeof emptyWC) => capacityService.createWorkCenter({ ...d, efficiency: d.efficiencyPercent } as any),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity'] }); setShowCreateWC(false); setWcForm(emptyWC); toast.success('Work center created'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create work center'); },
  });
  const updateWC = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<WorkCenter> }) => capacityService.updateWorkCenter(id, dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity'] }); setShowEditWC(false); toast.success('Work center updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update work center'); },
  });
  const deleteWC = useMutation({
    mutationFn: (id: string) => capacityService.deleteWorkCenter(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity'] }); toast.success('Work center deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete work center'); },
  });
  const toggleWC = useMutation({
    mutationFn: (id: string) => capacityService.toggleWorkCenterStatus(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity'] }); toast.success('Work center status toggled'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to toggle work center status'); },
  });
  const addCapacity = useMutation({
    mutationFn: ({ wcId, dto }: { wcId: string; dto: typeof emptyCapacity }) =>
      capacityService.createCapacity(wcId, {
        ...dto,
        standardCapacityPerHour: Number(dto.standardCapacityPerHour),
        maxCapacityPerHour: Number(dto.maxCapacityPerHour),
        availableHoursPerDay: Number(dto.availableHoursPerDay),
        availableDaysPerWeek: Number(dto.availableDaysPerWeek),
        plannedDowntimePercent: Number(dto.plannedDowntimePercent),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity'] }); setShowAddCapacity(false); setCapForm(emptyCapacity); toast.success('Capacity added'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to add capacity'); },
  });
  const addShift = useMutation({
    mutationFn: ({ wcId, dto }: { wcId: string; dto: typeof emptyShift }) =>
      capacityService.createShift(wcId, {
        ...dto,
        breakMinutes: Number(dto.breakMinutes),
        capacityFactor: Number(dto.capacityFactor),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity'] }); setShowAddShift(false); setShiftForm(emptyShift); toast.success('Shift added'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to add shift'); },
  });
  const deleteCapMut = useMutation({
    mutationFn: (id: string) => capacityService.deleteCapacity(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity'] }); toast.success('Capacity deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete capacity'); },
  });
  const deleteShiftMut = useMutation({
    mutationFn: (id: string) => capacityService.deleteShift(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity'] }); toast.success('Shift deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete shift'); },
  });

  // Table columns
  const wcColumns: Column<WorkCenter>[] = [
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'name', header: 'Name', accessor: 'name' },
    { key: 'type', header: 'Type', accessor: 'type' },
    { key: 'cost', header: '$/hr', accessor: (r: any) => r.costPerHour != null ? `$${Number(r.costPerHour).toFixed(2)}` : '—', align: 'right' },
    { key: 'efficiency', header: 'Efficiency', accessor: (r: any) => {
      const val = r.efficiencyPercent ?? r.efficiency;
      return val != null ? `${Number(val).toFixed(0)}%` : '—';
    }, align: 'right' },
    {
      key: 'status', header: 'Status',
      accessor: (r: any) => {
        const active = r.isActive ?? (r.status === 'ACTIVE');
        return <Badge variant={active ? 'success' : 'secondary'} size="sm">{active ? 'ACTIVE' : 'INACTIVE'}</Badge>;
      },
    },
    {
      key: 'actions', header: 'Actions',
      accessor: (r: any) => {
        const active = r.isActive ?? (r.status === 'ACTIVE');
        return (
          <div className="flex gap-1">
            <button onClick={() => { setSelectedWC(r); setShowDetailWC(true); }} className="p-1 text-blue-600 hover:text-blue-800" title="View">
              <EyeIcon className="h-4 w-4" />
            </button>
            <button onClick={() => { setSelectedWC(r); setWcForm({ code: r.code, name: r.name, description: r.description || '', type: r.type, costPerHour: Number(r.costPerHour) || 0, efficiencyPercent: Number(r.efficiencyPercent ?? r.efficiency) || 100 }); setShowEditWC(true); }} className="p-1 text-amber-600 hover:text-amber-800" title="Edit">
              <PencilIcon className="h-4 w-4" />
            </button>
            <button onClick={() => toggleWC.mutate(r.id)} className="p-1 text-indigo-600 hover:text-indigo-800" title="Toggle">
              <Badge variant={active ? 'warning' : 'success'} size="sm">{active ? 'Off' : 'On'}</Badge>
            </button>
            <button onClick={() => { if (confirm('Delete this work center?')) deleteWC.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800" title="Delete">
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
  ];

  const utilColumns: Column<CapacityUtilization>[] = [
    { key: 'wc', header: 'Work Center', accessor: (r: any) => `${r.workCenterCode ?? ''} — ${r.workCenterName ?? ''}` },
    { key: 'period', header: 'Period', accessor: 'period' },
    { key: 'available', header: 'Available', accessor: (r: any) => r.availableCapacity != null ? Number(r.availableCapacity).toFixed(0) : '—', align: 'right' },
    { key: 'planned', header: 'Planned', accessor: (r: any) => r.plannedCapacity != null ? Number(r.plannedCapacity).toFixed(0) : '—', align: 'right' },
    {
      key: 'util', header: 'Utilization',
      accessor: (r: any) => {
        const pct = Number(r.utilizationPercent ?? 0);
        return <Badge variant={pct > 95 ? 'error' : pct > 80 ? 'warning' : 'success'} size="sm">{pct.toFixed(1)}%</Badge>;
      },
    },
    {
      key: 'overloaded', header: 'Overloaded',
      accessor: (r: any) => r.isOverloaded ? <Badge variant="error" size="sm">YES</Badge> : <Badge variant="success" size="sm">NO</Badge>,
    },
  ];

  const bnColumns: Column<CapacityBottleneck>[] = [
    { key: 'wc', header: 'Work Center', accessor: (r: any) => `${r.workCenterCode ?? ''} — ${r.workCenterName ?? ''}` },
    { key: 'period', header: 'Period', accessor: 'period' },
    { key: 'util', header: 'Utilization', accessor: (r: any) => `${Number(r.utilizationPercent ?? 0).toFixed(1)}%`, align: 'right' },
    { key: 'overload', header: 'Overload Hrs', accessor: (r: any) => r.overloadHours != null ? Number(r.overloadHours).toFixed(1) : '—', align: 'right' },
    { key: 'orders', header: 'Impacted', accessor: (r: any) => r.impactedOrders ?? 0, align: 'right' },
    {
      key: 'severity', header: 'Severity',
      accessor: (r: any) => {
        const v = r.severity === 'CRITICAL' ? 'error' : r.severity === 'HIGH' ? 'warning' : r.severity === 'MEDIUM' ? 'primary' : 'secondary';
        return <Badge variant={v as any} size="sm">{r.severity}</Badge>;
      },
    },
  ];

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button
      className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 ${tab === id ? 'border-primary-500 text-primary-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
      onClick={() => setTab(id)}
    >{label}</button>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Capacity Planning</h1>
          <p className="text-secondary-500 mt-1">Work centers, shifts, utilization, and bottleneck analysis</p>
        </div>
        <Button onClick={() => { setWcForm(emptyWC); setShowCreateWC(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>
          Add Work Center
        </Button>
      </div>

      {hasError && <QueryErrorBanner error={firstError} onRetry={() => refetchWc()} />}

      <div className="flex gap-1 border-b">
        <TabBtn id="work-centers" label="Work Centers" />
        <TabBtn id="utilization" label="Utilization" />
        <TabBtn id="bottlenecks" label="Bottlenecks" />
      </div>

      {tab === 'work-centers' && (
        <Card>
          <CardHeader title="Work Centers" description="Active work centers and capabilities" />
          <DataTable data={workCenters} columns={wcColumns} keyExtractor={(r) => r.id} isLoading={wcLoading} emptyMessage="No work centers found" />
        </Card>
      )}

      {tab === 'utilization' && (
        <Card>
          <CardHeader title="Utilization Analysis" description="Capacity utilization across work centers" />
          <DataTable data={utilItems} columns={utilColumns} keyExtractor={(r) => `${r.workCenterId}-${r.period}`} isLoading={utilLoading} emptyMessage="No utilization data" />
        </Card>
      )}

      {tab === 'bottlenecks' && (
        <Card>
          <CardHeader title="Bottleneck Detection" description="Detected capacity bottlenecks" />
          <DataTable data={bnItems} columns={bnColumns} keyExtractor={(r) => `${r.workCenterId}-${r.period}`} isLoading={bnLoading} emptyMessage="No bottlenecks detected" />
        </Card>
      )}

      {/* Create Work Center Modal */}
      <Modal isOpen={showCreateWC} onClose={() => setShowCreateWC(false)} title="Create Work Center" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
              <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.code} onChange={(e) => setWcForm({ ...wcForm, code: e.target.value })} placeholder="WC-001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.name} onChange={(e) => setWcForm({ ...wcForm, name: e.target.value })} placeholder="Work Center Name" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.description} onChange={(e) => setWcForm({ ...wcForm, description: e.target.value })} rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.type} onChange={(e) => setWcForm({ ...wcForm, type: e.target.value })}>
                {WC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost $/hr</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.costPerHour} onChange={(e) => setWcForm({ ...wcForm, costPerHour: +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Efficiency %</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.efficiencyPercent} onChange={(e) => setWcForm({ ...wcForm, efficiencyPercent: +e.target.value })} min={0} max={100} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowCreateWC(false)}>Cancel</Button>
            <Button onClick={() => createWC.mutate(wcForm)} isLoading={createWC.isPending} disabled={!wcForm.code || !wcForm.name}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Work Center Modal */}
      <Modal isOpen={showEditWC} onClose={() => setShowEditWC(false)} title="Edit Work Center" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              <input type="text" className="w-full rounded-md border-gray-300 shadow-sm bg-gray-50" value={wcForm.code} disabled />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.name} onChange={(e) => setWcForm({ ...wcForm, name: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.description} onChange={(e) => setWcForm({ ...wcForm, description: e.target.value })} rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.type} onChange={(e) => setWcForm({ ...wcForm, type: e.target.value })}>
                {WC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost $/hr</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.costPerHour} onChange={(e) => setWcForm({ ...wcForm, costPerHour: +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Efficiency %</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={wcForm.efficiencyPercent} onChange={(e) => setWcForm({ ...wcForm, efficiencyPercent: +e.target.value })} min={0} max={100} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowEditWC(false)}>Cancel</Button>
            <Button onClick={() => selectedWC && updateWC.mutate({ id: selectedWC.id, dto: { name: wcForm.name, description: wcForm.description, type: wcForm.type as any, costPerHour: wcForm.costPerHour, efficiencyPercent: wcForm.efficiencyPercent } })} isLoading={updateWC.isPending}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={showDetailWC} onClose={() => { setShowDetailWC(false); setSelectedWC(null); }} title={selectedWC ? `${selectedWC.code} — ${selectedWC.name}` : 'Work Center'} size="xl">
        {selectedWC && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Type:</span> {(wcDetail as any)?.type || selectedWC.type}</div>
              <div><span className="font-medium text-gray-500">Cost/hr:</span> ${Number((wcDetail as any)?.costPerHour ?? selectedWC.costPerHour ?? 0).toFixed(2)}</div>
              <div><span className="font-medium text-gray-500">Efficiency:</span> {Number((wcDetail as any)?.efficiency ?? (wcDetail as any)?.efficiencyPercent ?? selectedWC.efficiencyPercent ?? (selectedWC as any).efficiency ?? '—')}%</div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={(selectedWC as any).isActive ?? ((selectedWC as any).status === 'ACTIVE') ? 'success' : 'secondary'} size="sm">{(selectedWC as any).isActive ?? ((selectedWC as any).status === 'ACTIVE') ? 'ACTIVE' : 'INACTIVE'}</Badge></div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-base font-semibold">Capacity Definitions</h3>
                <Button size="sm" onClick={() => { setCapForm(emptyCapacity); setShowAddCapacity(true); }} leftIcon={<PlusIcon className="h-3 w-3" />}>Add</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-3 py-2 text-left">Effective</th><th className="px-3 py-2 text-left">End</th>
                    <th className="px-3 py-2 text-right">Std Cap/hr</th><th className="px-3 py-2 text-right">Max Cap/hr</th>
                    <th className="px-3 py-2 text-right">Hrs/day</th><th className="px-3 py-2 text-right">Days/wk</th><th className="px-3 py-2"></th>
                  </tr></thead>
                  <tbody>
                    {capItems.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">No capacity records</td></tr>}
                    {capItems.map((c) => (
                      <tr key={c.id} className="border-t">
                        <td className="px-3 py-2">{safeFormat(c.effectiveDate, 'yyyy-MM-dd')}</td>
                        <td className="px-3 py-2">{safeFormat(c.endDate, 'yyyy-MM-dd')}</td>
                        <td className="px-3 py-2 text-right">{c.standardCapacityPerHour}</td>
                        <td className="px-3 py-2 text-right">{c.maxCapacityPerHour ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{c.availableHoursPerDay ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{c.availableDaysPerWeek ?? '—'}</td>
                        <td className="px-3 py-2"><button onClick={() => { if (confirm('Delete this capacity record?')) deleteCapMut.mutate(c.id); }} className="text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-base font-semibold">Shifts</h3>
                <Button size="sm" onClick={() => { setShiftForm(emptyShift); setShowAddShift(true); }} leftIcon={<PlusIcon className="h-3 w-3" />}>Add</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Start</th>
                    <th className="px-3 py-2 text-left">End</th><th className="px-3 py-2 text-left">Days</th>
                    <th className="px-3 py-2 text-right">Break</th><th className="px-3 py-2 text-left">Effective</th><th className="px-3 py-2"></th>
                  </tr></thead>
                  <tbody>
                    {shiftItems.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">No shifts</td></tr>}
                    {shiftItems.map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2">{s.name}</td>
                        <td className="px-3 py-2">{s.startTime}</td>
                        <td className="px-3 py-2">{s.endTime}</td>
                        <td className="px-3 py-2">{s.daysOfWeek?.map((d: number) => ['Su','Mo','Tu','We','Th','Fr','Sa'][d]).join(', ')}</td>
                        <td className="px-3 py-2 text-right">{s.breakMinutes ?? 0}m</td>
                        <td className="px-3 py-2">{safeFormat(s.effectiveDate, 'yyyy-MM-dd')}</td>
                        <td className="px-3 py-2"><button onClick={() => { if (confirm('Delete this shift?')) deleteShiftMut.mutate(s.id); }} className="text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Capacity Modal */}
      <Modal isOpen={showAddCapacity} onClose={() => setShowAddCapacity(false)} title="Add Capacity Definition" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Effective Date *</label>
              <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={capForm.effectiveDate} onChange={(e) => setCapForm({ ...capForm, effectiveDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={capForm.endDate} onChange={(e) => setCapForm({ ...capForm, endDate: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Std Capacity/hr *</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={capForm.standardCapacityPerHour} onChange={(e) => setCapForm({ ...capForm, standardCapacityPerHour: +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Capacity/hr</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={capForm.maxCapacityPerHour} onChange={(e) => setCapForm({ ...capForm, maxCapacityPerHour: +e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hrs/day</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={capForm.availableHoursPerDay} onChange={(e) => setCapForm({ ...capForm, availableHoursPerDay: +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Days/wk</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={capForm.availableDaysPerWeek} onChange={(e) => setCapForm({ ...capForm, availableDaysPerWeek: +e.target.value })} min={1} max={7} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Downtime %</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={capForm.plannedDowntimePercent} onChange={(e) => setCapForm({ ...capForm, plannedDowntimePercent: +e.target.value })} min={0} max={100} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowAddCapacity(false)}>Cancel</Button>
            <Button onClick={() => selectedWC && addCapacity.mutate({ wcId: selectedWC.id, dto: capForm })} isLoading={addCapacity.isPending} disabled={!capForm.effectiveDate}>Add</Button>
          </div>
        </div>
      </Modal>

      {/* Add Shift Modal */}
      <Modal isOpen={showAddShift} onClose={() => setShowAddShift(false)} title="Add Shift" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Shift Name *</label>
            <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="Day Shift" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time *</label>
              <input type="time" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={shiftForm.startTime} onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time *</label>
              <input type="time" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={shiftForm.endTime} onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Effective Date *</label>
            <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={shiftForm.effectiveDate} onChange={(e) => setShiftForm({ ...shiftForm, effectiveDate: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Break (min)</label>
              <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={shiftForm.breakMinutes} onChange={(e) => setShiftForm({ ...shiftForm, breakMinutes: +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Capacity Factor</label>
              <input type="number" step="0.1" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={shiftForm.capacityFactor} onChange={(e) => setShiftForm({ ...shiftForm, capacityFactor: +e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowAddShift(false)}>Cancel</Button>
            <Button onClick={() => selectedWC && addShift.mutate({ wcId: selectedWC.id, dto: shiftForm })} isLoading={addShift.isPending} disabled={!shiftForm.name || !shiftForm.effectiveDate}>Add Shift</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
