import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { EyeIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { sopService, userService, type SOPAssumption, type SOPCycle, type SOPForecast } from '@services/api';
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
  } catch { return fallback; }
};

const SOP_STATUSES = ['DRAFT', 'DEMAND_REVIEW', 'SUPPLY_REVIEW', 'EXECUTIVE_REVIEW', 'FINALIZED'];
const statusVariant: Record<string, any> = { DRAFT: 'secondary', DEMAND_REVIEW: 'primary', SUPPLY_REVIEW: 'warning', EXECUTIVE_REVIEW: 'primary', FINALIZED: 'success' };
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const emptyCycle = { name: '', year: new Date().getFullYear(), month: new Date().getMonth() + 1, description: '', horizonMonths: 18, demandReviewDate: '', supplyReviewDate: '', executiveMeetingDate: '' };
const emptyAssumption = { category: '', assumption: '', impactDescription: '', quantitativeImpact: 0, riskLevel: 'MEDIUM', mitigationPlan: '', owner: '', dueDate: '' };
const ASSUMPTION_CATEGORIES = ['Demand','Supply','Pricing','Capacity','Inventory','Market','Regulatory','Operations','Financial'];

export default function SOPPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showAddAssumption, setShowAddAssumption] = useState(false);
  const [selected, setSelected] = useState<SOPCycle | null>(null);
  const [form, setForm] = useState<typeof emptyCycle>(emptyCycle);
  const [assumptionForm, setAssumptionForm] = useState<typeof emptyAssumption>(emptyAssumption);
  const [statusFilter, setStatusFilter] = useState('');

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'sop', 'cycles', statusFilter],
    queryFn: () => sopService.getCycles({ status: statusFilter || undefined, pageSize: 100 }),
  });

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => userService.getAll(),
  });

  const sopUsers: any[] = usersData?.data || [];

  const { data: cycleSummary } = useQuery({
    queryKey: ['manufacturing', 'sop', 'summary', selected?.id],
    queryFn: () => selected ? sopService.getCycleSummary(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const { data: forecasts } = useQuery({
    queryKey: ['manufacturing', 'sop', 'forecasts', selected?.id],
    queryFn: () => selected ? sopService.getForecasts(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const { data: assumptions } = useQuery({
    queryKey: ['manufacturing', 'sop', 'assumptions', selected?.id],
    queryFn: () => selected ? sopService.getAssumptions(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const { data: _forecastComparison } = useQuery({
    queryKey: ['manufacturing', 'sop', 'comparison', selected?.id],
    queryFn: () => selected ? sopService.getForecastComparison(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const items: SOPCycle[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const forecastItems: SOPForecast[] = Array.isArray(forecasts?.items) ? forecasts.items : Array.isArray(forecasts) ? forecasts : [];
  const assumptionItems: SOPAssumption[] = Array.isArray(assumptions?.items) ? assumptions.items : Array.isArray(assumptions) ? assumptions : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyCycle) => sopService.createCycle({
      year: Number(d.year), month: Number(d.month), name: d.name || `S&OP ${d.year}-${String(d.month).padStart(2, '0')}`,
      description: d.description, horizonMonths: Number(d.horizonMonths),
      demandReviewDate: d.demandReviewDate || undefined, supplyReviewDate: d.supplyReviewDate || undefined,
      executiveMeetingDate: d.executiveMeetingDate || undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'sop'] }); setShowCreate(false); setForm(emptyCycle); toast.success('S&OP cycle created'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create cycle'); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<SOPCycle> }) => sopService.updateCycle(id, dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'sop'] }); setShowEdit(false); toast.success('Cycle updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update cycle'); },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => sopService.updateCycleStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'sop'] }); toast.success('Status updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update status'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => sopService.deleteCycle(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'sop'] }); toast.success('Cycle deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete cycle'); },
  });

  const importStatistical = useMutation({
    mutationFn: (cycleId: string) => sopService.importStatisticalForecast(cycleId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'sop'] }); toast.success('Statistical forecast imported'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to import forecast'); },
  });

  const createAssumptionMut = useMutation({
    mutationFn: ({ cycleId, dto }: { cycleId: string; dto: typeof emptyAssumption }) =>
      sopService.createAssumption(cycleId, {
        category: dto.category, assumption: dto.assumption, impactDescription: dto.impactDescription,
        quantitativeImpact: Number(dto.quantitativeImpact) || undefined, riskLevel: dto.riskLevel,
        mitigationPlan: dto.mitigationPlan, owner: dto.owner, dueDate: dto.dueDate || undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'sop'] }); setShowAddAssumption(false); setAssumptionForm(emptyAssumption); toast.success('Assumption added'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to add assumption'); },
  });

  const columns: Column<SOPCycle>[] = [
    { key: 'name', header: 'Cycle', accessor: 'name' },
    { key: 'year', header: 'Year', accessor: (r) => r.year ?? (r as any).fiscalYear ?? '—', align: 'right' },
    { key: 'month', header: 'Month', accessor: (r) => r.month ?? (r as any).fiscalPeriod ?? '—', align: 'right' },
    { key: 'horizon', header: 'Horizon', accessor: (r) => r.horizonMonths ? `${r.horizonMonths}mo` : '—' },
    { key: 'demandReview', header: 'Demand Review', accessor: (r) => safeFormat(r.demandReviewDate, 'MMM d') },
    {
      key: 'status', header: 'Status',
      accessor: (r) => <Badge variant={statusVariant[r.status] || 'secondary'} size="sm">{r.status?.replace('_', ' ')}</Badge>,
    },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelected(r); setShowDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          <button onClick={() => {
            setSelected(r); setForm({ name: r.name, year: r.year, month: r.month, description: r.description || '', horizonMonths: r.horizonMonths || 18, demandReviewDate: r.demandReviewDate?.split('T')[0] || '', supplyReviewDate: r.supplyReviewDate?.split('T')[0] || '', executiveMeetingDate: r.executiveMeetingDate?.split('T')[0] || '' });
            setShowEdit(true);
          }} className="p-1 text-amber-600 hover:text-amber-800"><PencilIcon className="h-4 w-4" /></button>
          <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">S&OP</h1>
          <p className="text-secondary-500 mt-1">Sales and operations planning cycles</p>
        </div>
        <Button onClick={() => { setForm(emptyCycle); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New Cycle</Button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <div className="flex gap-2 items-center">
        <label className="text-sm text-gray-600">Status:</label>
        <select className="rounded-md border-gray-300 shadow-sm text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          {SOP_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      <Card>
        <CardHeader title="S&OP Cycles" description="Monthly consensus planning" />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No S&OP cycles" />
      </Card>

      {/* Create */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create S&OP Cycle" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Year *</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.year} onChange={(e) => setForm({ ...form, year: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Month *</label><input type="number" min={1} max={12} className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.month} onChange={(e) => setForm({ ...form, month: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Horizon (months)</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.horizonMonths} onChange={(e) => setForm({ ...form, horizonMonths: +e.target.value })} /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Name</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Auto-generated if blank" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Demand Review</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.demandReviewDate} onChange={(e) => setForm({ ...form, demandReviewDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Supply Review</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.supplyReviewDate} onChange={(e) => setForm({ ...form, supplyReviewDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Executive Meeting</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.executiveMeetingDate} onChange={(e) => setForm({ ...form, executiveMeetingDate: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending}>Create Cycle</Button>
          </div>
        </div>
      </Modal>

      {/* Edit */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit S&OP Cycle" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Year</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm bg-gray-50" value={form.year} disabled /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Month</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm bg-gray-50" value={form.month} disabled /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Horizon</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.horizonMonths} onChange={(e) => setForm({ ...form, horizonMonths: +e.target.value })} /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Name</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Demand Review</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.demandReviewDate} onChange={(e) => setForm({ ...form, demandReviewDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Supply Review</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.supplyReviewDate} onChange={(e) => setForm({ ...form, supplyReviewDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Executive Meeting</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.executiveMeetingDate} onChange={(e) => setForm({ ...form, executiveMeetingDate: e.target.value })} /></div>
          </div>
          {selected && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status Progression</label>
              <div className="flex gap-2">
                {SOP_STATUSES.map(s => (
                  <Button key={s} size="sm" variant={selected.status === s ? 'primary' : 'secondary'} onClick={() => updateStatus.mutate({ id: selected.id, status: s })}>{s.replace('_', ' ')}</Button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={() => selected && updateMut.mutate({ id: selected.id, dto: { name: form.name, description: form.description, horizonMonths: Number(form.horizonMonths), demandReviewDate: form.demandReviewDate || undefined, supplyReviewDate: form.supplyReviewDate || undefined, executiveMeetingDate: form.executiveMeetingDate || undefined } as any })} isLoading={updateMut.isPending}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Detail */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); }} title={selected ? selected.name : 'S&OP Cycle'} size="xl">
        {selected && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Period:</span> {selected.year}-{String(selected.month).padStart(2, '0')}</div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={statusVariant[selected.status] || 'secondary'} size="sm">{selected.status?.replace('_', ' ')}</Badge></div>
              <div><span className="font-medium text-gray-500">Horizon:</span> {selected.horizonMonths ?? '—'} months</div>
              <div><span className="font-medium text-gray-500">Created By:</span> {selected.createdBy?.name ?? '—'}</div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Demand Review:</span> {safeFormat(selected.demandReviewDate, 'MMM d, yyyy')}</div>
              <div><span className="font-medium text-gray-500">Supply Review:</span> {safeFormat(selected.supplyReviewDate, 'MMM d, yyyy')}</div>
              <div><span className="font-medium text-gray-500">Executive:</span> {safeFormat(selected.executiveMeetingDate, 'MMM d, yyyy')}</div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => importStatistical.mutate(selected.id)} isLoading={importStatistical.isPending}>Import Statistical Forecast</Button>
              <Button size="sm" variant="secondary" onClick={() => { setAssumptionForm(emptyAssumption); setShowAddAssumption(true); }}>Add Assumption</Button>
            </div>

            {/* Summary */}
            {cycleSummary && (
              <div className="grid grid-cols-4 gap-4 text-sm bg-blue-50 p-3 rounded">
                <div><span className="font-medium text-gray-500">Total Products:</span> {(cycleSummary as any).totalProducts ?? '—'}</div>
                <div><span className="font-medium text-gray-500">Total Locations:</span> {(cycleSummary as any).totalLocations ?? '—'}</div>
                <div><span className="font-medium text-gray-500">Forecast Entries:</span> {(cycleSummary as any).totalForecasts ?? '—'}</div>
                <div><span className="font-medium text-gray-500">Assumptions:</span> {(cycleSummary as any).totalAssumptions ?? '—'}</div>
              </div>
            )}

            {/* Forecasts */}
            <div>
              <h3 className="text-base font-semibold mb-2">Forecasts ({forecastItems.length})</h3>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="min-w-full text-sm border">
                  <thead className="bg-gray-50 sticky top-0"><tr>
                    <th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-left">Location</th>
                    <th className="px-3 py-2 text-left">Period</th><th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-right">Units</th><th className="px-3 py-2 text-right">Revenue</th>
                  </tr></thead>
                  <tbody>
                    {forecastItems.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No forecasts yet</td></tr>}
                    {forecastItems.slice(0, 50).map((f) => (
                      <tr key={f.id} className="border-t">
                        <td className="px-3 py-2">{f.product?.sku || f.productId}</td>
                        <td className="px-3 py-2">{f.location?.code || f.locationId}</td>
                        <td className="px-3 py-2">{safeFormat(f.periodDate, 'MMM yyyy')}</td>
                        <td className="px-3 py-2"><Badge variant="secondary" size="sm">{f.source}</Badge></td>
                        <td className="px-3 py-2 text-right">{f.quantityUnits?.toLocaleString() ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{f.quantityRevenue ? `$${f.quantityRevenue.toLocaleString()}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Assumptions */}
            <div>
              <h3 className="text-base font-semibold mb-2">Assumptions ({assumptionItems.length})</h3>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="min-w-full text-sm border">
                  <thead className="bg-gray-50 sticky top-0"><tr>
                    <th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-left">Assumption</th>
                    <th className="px-3 py-2">Risk</th><th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-left">Owner</th><th className="px-3 py-2 text-left">Due</th>
                  </tr></thead>
                  <tbody>
                    {assumptionItems.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No assumptions</td></tr>}
                    {assumptionItems.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td className="px-3 py-2">{a.category}</td>
                        <td className="px-3 py-2 max-w-xs truncate">{a.assumption}</td>
                        <td className="px-3 py-2"><Badge variant={a.riskLevel === 'CRITICAL' ? 'error' : a.riskLevel === 'HIGH' ? 'warning' : 'secondary'} size="sm">{a.riskLevel}</Badge></td>
                        <td className="px-3 py-2"><Badge variant={a.status === 'RESOLVED' ? 'success' : 'secondary'} size="sm">{a.status}</Badge></td>
                        <td className="px-3 py-2">{a.owner || '—'}</td>
                        <td className="px-3 py-2">{safeFormat(a.dueDate, 'MMM d')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Assumption */}
      <Modal isOpen={showAddAssumption} onClose={() => setShowAddAssumption(false)} title="Add Assumption" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Category *</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={assumptionForm.category} onChange={(e) => setAssumptionForm({ ...assumptionForm, category: e.target.value })}><option value="">Select category...</option>{ASSUMPTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Risk Level</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={assumptionForm.riskLevel} onChange={(e) => setAssumptionForm({ ...assumptionForm, riskLevel: e.target.value })}>{RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Assumption *</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={assumptionForm.assumption} onChange={(e) => setAssumptionForm({ ...assumptionForm, assumption: e.target.value })} rows={2} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Impact</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={assumptionForm.impactDescription} onChange={(e) => setAssumptionForm({ ...assumptionForm, impactDescription: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Owner</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={assumptionForm.owner} onChange={(e) => setAssumptionForm({ ...assumptionForm, owner: e.target.value })}><option value="">Select owner...</option>{sopUsers.map((u: any) => <option key={u.id} value={u.name || u.email}>{u.name || u.email}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={assumptionForm.dueDate} onChange={(e) => setAssumptionForm({ ...assumptionForm, dueDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Impact Qty</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={assumptionForm.quantitativeImpact} onChange={(e) => setAssumptionForm({ ...assumptionForm, quantitativeImpact: +e.target.value })} /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Mitigation Plan</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={assumptionForm.mitigationPlan} onChange={(e) => setAssumptionForm({ ...assumptionForm, mitigationPlan: e.target.value })} rows={2} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowAddAssumption(false)}>Cancel</Button>
            <Button onClick={() => selected && createAssumptionMut.mutate({ cycleId: selected.id, dto: assumptionForm })} isLoading={createAssumptionMut.isPending} disabled={!assumptionForm.category || !assumptionForm.assumption}>Add</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
