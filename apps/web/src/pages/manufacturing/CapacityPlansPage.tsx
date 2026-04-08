import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { ExclamationTriangleIcon, EyeIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { capacityPlanService, capacityService } from '@services/api';
import type { CapacityBottleneck, CapacityUtilization } from '@services/api/capacity.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { CapacityPlan, CapacityPlanBucket, CapacityPlanType } from '../../types';

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

const planTypeVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  RCCP: 'primary',
  CRP: 'success',
  FINITE: 'warning',
  INFINITE: 'secondary',
};

const statusVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  DRAFT: 'secondary',
  ACTIVE: 'success',
  APPROVED: 'primary',
  CLOSED: 'default',
};

const emptyForm = {
  name: '',
  description: '',
  planType: 'RCCP' as CapacityPlanType,
  planningHorizon: 52,
  granularity: 'WEEKLY',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
};

const emptyBucketForm = {
  workCenterId: '',
  periodDate: new Date().toISOString().slice(0, 10),
  availableCapacity: 0,
  requiredCapacity: 0,
  notes: '',
};

// --- Extracted Components (Fixed Focus Issue) ---

const PlanFormFields = ({ form, setForm }: { form: typeof emptyForm; setForm: (f: typeof emptyForm) => void }) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
      <input 
        type="text" 
        className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
        value={form.name} 
        onChange={(e) => setForm({ ...form, name: e.target.value })} 
        placeholder="Q1 Capacity Plan" 
      />
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
      <textarea 
        className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
        rows={2} 
        value={form.description} 
        onChange={(e) => setForm({ ...form, description: e.target.value })} 
      />
    </div>
    <div className="grid grid-cols-3 gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Plan Type *</label>
        <select 
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
          value={form.planType} 
          onChange={(e) => setForm({ ...form, planType: e.target.value as CapacityPlanType })}
        >
          {(['RCCP', 'CRP', 'FINITE', 'INFINITE'] as CapacityPlanType[]).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Granularity *</label>
        <select 
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
          value={form.granularity} 
          onChange={(e) => setForm({ ...form, granularity: e.target.value })}
        >
          {['WEEKLY', 'MONTHLY', 'QUARTERLY'].map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Planning Horizon</label>
        <input 
          type="number" 
          min={1} 
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
          value={form.planningHorizon} 
          onChange={(e) => setForm({ ...form, planningHorizon: +e.target.value })} 
        />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
        <input 
          type="date" 
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
          value={form.startDate} 
          onChange={(e) => setForm({ ...form, startDate: e.target.value })} 
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
        <input 
          type="date" 
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
          value={form.endDate} 
          onChange={(e) => setForm({ ...form, endDate: e.target.value })} 
        />
      </div>
    </div>
  </div>
);

const BucketFormFields = ({ 
  bucketForm, 
  setBucketForm, 
  workCentersData 
}: { 
  bucketForm: typeof emptyBucketForm; 
  setBucketForm: (f: typeof emptyBucketForm) => void; 
  workCentersData: any[] 
}) => (
  <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Work Center *</label>
        <select 
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
          value={bucketForm.workCenterId} 
          onChange={(e) => setBucketForm({ ...bucketForm, workCenterId: e.target.value })}
        >
          <option value="">Select work center...</option>
          {workCentersData.map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name || wc.code || wc.id}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Period Date *</label>
        <input 
          type="date" 
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
          value={bucketForm.periodDate} 
          onChange={(e) => setBucketForm({ ...bucketForm, periodDate: e.target.value })} 
        />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Available Capacity *</label>
        <input 
          type="number" 
          min={0} 
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
          value={bucketForm.availableCapacity} 
          onChange={(e) => setBucketForm({ ...bucketForm, availableCapacity: +e.target.value })} 
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Required Capacity</label>
        <input 
          type="number" 
          min={0} 
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
          value={bucketForm.requiredCapacity} 
          onChange={(e) => setBucketForm({ ...bucketForm, requiredCapacity: +e.target.value })} 
        />
      </div>
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
      <textarea 
        className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" 
        rows={2} 
        value={bucketForm.notes} 
        onChange={(e) => setBucketForm({ ...bucketForm, notes: e.target.value })} 
      />
    </div>
  </div>
);

// --- Main Component ---

export default function CapacityPlansPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'plans' | 'utilization'>('utilization');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showAddBucket, setShowAddBucket] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<CapacityPlan | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [bucketForm, setBucketForm] = useState<typeof emptyBucketForm>(emptyBucketForm);

  // Utilization date range (default: next 30 days)
  const [utilStartDate, setUtilStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [utilEndDate, setUtilEndDate] = useState(addDays(new Date(), 30).toISOString().slice(0, 10));
  const [utilGranularity, setUtilGranularity] = useState<'WEEK' | 'MONTH'>('WEEK');

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'capacity-plans'],
    queryFn: () => capacityPlanService.getAll({ pageSize: 100 }),
  });

  const { data: workCenters } = useQuery({
    queryKey: ['work-centers'],
    queryFn: () => capacityService.getWorkCenters(),
  });

  const { data: bucketsData, isLoading: bucketsLoading } = useQuery({
    queryKey: ['manufacturing', 'capacity-plan-buckets', selectedPlan?.id],
    queryFn: () => capacityPlanService.getBuckets(selectedPlan!.id, { pageSize: 200 }),
    enabled: !!selectedPlan?.id && showDetail,
  });

  const items: CapacityPlan[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const workCentersData: any[] = Array.isArray(workCenters?.items) ? workCenters.items : Array.isArray(workCenters) ? workCenters : [];
  const buckets: CapacityPlanBucket[] = Array.isArray(bucketsData?.items) ? bucketsData.items : Array.isArray(bucketsData) ? bucketsData : [];

  // Utilization & Bottleneck queries
  const { data: utilizationData, isLoading: utilLoading } = useQuery({
    queryKey: ['capacity-utilization', utilStartDate, utilEndDate, utilGranularity],
    queryFn: () => capacityService.getUtilization({ startDate: utilStartDate, endDate: utilEndDate, granularity: utilGranularity }),
    enabled: activeTab === 'utilization',
  });
  const { data: bottleneckData, isLoading: bottleneckLoading } = useQuery({
    queryKey: ['capacity-bottlenecks', utilStartDate, utilEndDate],
    queryFn: () => capacityService.detectBottlenecks({ startDate: utilStartDate, endDate: utilEndDate }),
    enabled: activeTab === 'utilization',
  });

  const utilItems: CapacityUtilization[] = Array.isArray(utilizationData) ? utilizationData : [];
  const bottlenecks: CapacityBottleneck[] = Array.isArray(bottleneckData) ? bottleneckData : [];

  // Aggregate utilization per work center
  const wcUtilMap = new Map<string, { name: string; code: string; totalAvail: number; totalPlanned: number; periods: CapacityUtilization[] }>();
  utilItems.forEach((u) => {
    const existing = wcUtilMap.get(u.workCenterId);
    if (existing) {
      existing.totalAvail += u.availableCapacity;
      existing.totalPlanned += u.plannedCapacity;
      existing.periods.push(u);
    } else {
      wcUtilMap.set(u.workCenterId, { name: u.workCenterName, code: u.workCenterCode, totalAvail: u.availableCapacity, totalPlanned: u.plannedCapacity, periods: [u] });
    }
  });
  const wcUtilSummary = Array.from(wcUtilMap.entries()).map(([id, v]) => ({
    id,
    ...v,
    utilPercent: v.totalAvail > 0 ? (v.totalPlanned / v.totalAvail) * 100 : 0,
  }));
  const avgUtil = wcUtilSummary.length > 0 ? wcUtilSummary.reduce((s, w) => s + w.utilPercent, 0) / wcUtilSummary.length : 0;
  const overloadedCount = wcUtilSummary.filter((w) => w.utilPercent > 100).length;
  const criticalBottlenecks = bottlenecks.filter((b) => b.severity === 'CRITICAL' || b.severity === 'HIGH').length;

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => capacityPlanService.create({
      name: d.name,
      description: d.description || undefined,
      planType: d.planType,
      planningHorizon: Number(d.planningHorizon),
      granularity: d.granularity,
      startDate: d.startDate,
      endDate: d.endDate,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity-plans'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('Capacity plan created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create capacity plan'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => capacityPlanService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity-plans'] });
      toast.success('Capacity plan deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete capacity plan'); },
  });

  const createBucketMut = useMutation({
    mutationFn: (d: typeof emptyBucketForm) => capacityPlanService.createBucket(selectedPlan!.id, {
      workCenterId: d.workCenterId,
      periodDate: d.periodDate,
      availableCapacity: Number(d.availableCapacity),
      requiredCapacity: Number(d.requiredCapacity) || undefined,
      notes: d.notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity-plan-buckets', selectedPlan?.id] });
      setShowAddBucket(false);
      setBucketForm(emptyBucketForm);
      toast.success('Bucket added');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create bucket'); },
  });

  const deleteBucketMut = useMutation({
    mutationFn: (bucketId: string) => capacityPlanService.deleteBucket(selectedPlan!.id, bucketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'capacity-plan-buckets', selectedPlan?.id] });
      toast.success('Bucket deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete bucket'); },
  });

  const planColumns: Column<CapacityPlan>[] = [
    { key: 'name', header: 'Name', accessor: 'name' },
    {
      key: 'planType', header: 'Plan Type',
      accessor: (r) => <Badge variant={planTypeVariant[r.planType] || 'secondary'} size="sm">{r.planType}</Badge>,
    },
    {
      key: 'status', header: 'Status',
      accessor: (r) => <Badge variant={statusVariant[r.status] || 'secondary'} size="sm">{r.status}</Badge>,
    },
    { key: 'startDate', header: 'Start Date', accessor: (r) => safeFormat(r.startDate, 'MMM dd, yyyy') },
    { key: 'endDate', header: 'End Date', accessor: (r) => safeFormat(r.endDate, 'MMM dd, yyyy') },
    { key: 'granularity', header: 'Granularity', accessor: 'granularity' },
    { key: 'planningHorizon', header: 'Horizon', accessor: (r) => String(r.planningHorizon), align: 'right' },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelectedPlan(r); setShowDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          <button onClick={() => { if (confirm('Delete this capacity plan?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const bucketColumns: Column<CapacityPlanBucket>[] = [
    { key: 'workCenter', header: 'Work Center', accessor: (r) => r.workCenter?.name || r.workCenterId },
    { key: 'periodDate', header: 'Period Date', accessor: (r) => safeFormat(r.periodDate, 'MMM dd, yyyy') },
    { key: 'availableCapacity', header: 'Available', accessor: (r) => Number(r.availableCapacity ?? 0).toLocaleString(), align: 'right' },
    { key: 'requiredCapacity', header: 'Required', accessor: (r) => Number(r.requiredCapacity ?? 0).toLocaleString(), align: 'right' },
    {
      key: 'loadPercent', header: 'Load %',
      accessor: (r) => {
        const lp = Number(r.loadPercent ?? 0);
        return (
          <span className={lp > 100 ? 'text-red-600 font-semibold' : lp > 85 ? 'text-amber-600' : 'text-green-600'}>
            {lp.toFixed(1)}%
          </span>
        );
      },
      align: 'right',
    },
    {
      key: 'overload', header: 'Overload',
      accessor: (r) => <Badge variant={r.overloadFlag ? 'error' : 'success'} size="sm">{r.overloadFlag ? 'Yes' : 'No'}</Badge>,
    },
    {
      key: 'actions', header: '',
      accessor: (r) => (
        <button onClick={() => { if (confirm('Delete this bucket?')) deleteBucketMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
      ),
    },
  ];

  const utilBarColor = (pct: number) =>
    pct > 100 ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : pct > 60 ? 'bg-blue-500' : 'bg-green-500';
  const severityColor: Record<string, string> = { CRITICAL: 'text-red-700 bg-red-50 border-red-200', HIGH: 'text-orange-700 bg-orange-50 border-orange-200', MEDIUM: 'text-amber-700 bg-amber-50 border-amber-200', LOW: 'text-green-700 bg-green-50 border-green-200' };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Capacity Planning</h1>
          <p className="text-secondary-500 mt-1">Utilization analysis, bottleneck detection &amp; capacity plans</p>
        </div>
        {activeTab === 'plans' && (
          <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>New Plan</Button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {(['utilization', 'plans'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              {tab === 'utilization' ? 'Utilization & Bottlenecks' : 'Capacity Plans'}
            </button>
          ))}
        </nav>
      </div>

      {/* === Utilization Tab === */}
      {activeTab === 'utilization' && (
        <div className="space-y-6">
          {/* Date range filters */}
          <Card>
            <div className="p-4 flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                <input type="date" className="rounded-md border-gray-300 shadow-sm text-sm" value={utilStartDate} onChange={(e) => setUtilStartDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
                <input type="date" className="rounded-md border-gray-300 shadow-sm text-sm" value={utilEndDate} onChange={(e) => setUtilEndDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Granularity</label>
                <select className="rounded-md border-gray-300 shadow-sm text-sm" value={utilGranularity} onChange={(e) => setUtilGranularity(e.target.value as 'WEEK' | 'MONTH')}>
                  <option value="WEEK">Weekly</option>
                  <option value="MONTH">Monthly</option>
                </select>
              </div>
            </div>
          </Card>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <div className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase">Work Centers</p>
                <p className="text-2xl font-bold mt-1">{wcUtilSummary.length}</p>
              </div>
            </Card>
            <Card>
              <div className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase">Avg Utilization</p>
                <p className={`text-2xl font-bold mt-1 ${avgUtil > 100 ? 'text-red-600' : avgUtil > 85 ? 'text-amber-600' : 'text-green-600'}`}>{avgUtil.toFixed(1)}%</p>
              </div>
            </Card>
            <Card>
              <div className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase">Overloaded</p>
                <p className={`text-2xl font-bold mt-1 ${overloadedCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{overloadedCount}</p>
              </div>
            </Card>
            <Card>
              <div className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase">Critical Bottlenecks</p>
                <p className={`text-2xl font-bold mt-1 ${criticalBottlenecks > 0 ? 'text-red-600' : 'text-green-600'}`}>{criticalBottlenecks}</p>
              </div>
            </Card>
          </div>

          {/* Work Center Utilization Bars */}
          <Card>
            <CardHeader title="Work Center Utilization" description="Capacity load for each work center in the selected period" />
            <div className="p-4 space-y-4">
              {utilLoading && <p className="text-sm text-gray-400">Loading utilization data...</p>}
              {!utilLoading && wcUtilSummary.length === 0 && (
                <p className="text-sm text-gray-400">No utilization data found for the selected period. Ensure work orders with operations exist.</p>
              )}
              {wcUtilSummary.sort((a, b) => b.utilPercent - a.utilPercent).map((wc) => (
                <div key={wc.id} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{wc.name} <span className="text-gray-400">({wc.code})</span></span>
                    <span className={wc.utilPercent > 100 ? 'text-red-600 font-semibold' : wc.utilPercent > 85 ? 'text-amber-600 font-semibold' : 'text-gray-700'}>
                      {wc.utilPercent.toFixed(1)}% &middot; {wc.totalPlanned.toLocaleString()}h / {wc.totalAvail.toLocaleString()}h
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div className={`h-3 rounded-full transition-all ${utilBarColor(wc.utilPercent)}`} style={{ width: `${Math.min(wc.utilPercent, 100)}%` }} />
                  </div>
                  {wc.utilPercent > 100 && (
                    <p className="text-xs text-red-600 font-medium">Overloaded by {(wc.totalPlanned - wc.totalAvail).toFixed(1)} hours</p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Bottleneck Alerts */}
          <Card>
            <CardHeader title="Bottleneck Alerts" description="Detected capacity constraints requiring attention" />
            <div className="p-4 space-y-3">
              {bottleneckLoading && <p className="text-sm text-gray-400">Detecting bottlenecks...</p>}
              {!bottleneckLoading && bottlenecks.length === 0 && (
                <p className="text-sm text-green-600">No bottlenecks detected for the selected period.</p>
              )}
              {bottlenecks.sort((a, b) => {
                const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
                return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
              }).map((b, index) => (
                <div key={`${b.workCenterId}-${b.period}-${index}`} className={`rounded-lg border p-4 ${severityColor[b.severity] || ''}`}>
                  <div className="flex items-start gap-3">
                    <ExclamationTriangleIcon className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold">{b.workCenterName} <span className="text-xs font-normal">({b.workCenterCode})</span></span>
                        <Badge variant={b.severity === 'CRITICAL' ? 'error' : b.severity === 'HIGH' ? 'warning' : 'secondary'} size="sm">{b.severity}</Badge>
                      </div>
                      <p className="text-sm">Period: {b.period} &middot; Utilization: {b.utilizationPercent.toFixed(1)}% &middot; Overload: {b.overloadHours.toFixed(1)}h &middot; Impacted Orders: {b.impactedOrders}</p>
                      {b.recommendations.length > 0 && (
                        <ul className="mt-2 text-xs space-y-0.5 list-disc list-inside opacity-80">
                          {b.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* === Plans Tab === */}
      {activeTab === 'plans' && (
        <>
          {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

          <Card>
            <CardHeader title="Capacity Plans" description="All capacity planning records" />
            <DataTable data={items} columns={planColumns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No capacity plans found" />
          </Card>
        </>
      )}

      {/* Create Plan Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Capacity Plan" size="lg">
        {/* Fixed: Passing props to the external component */}
        <PlanFormFields form={form} setForm={setForm} />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.name || !form.startDate || !form.endDate}>Create</Button>
        </div>
      </Modal>

      {/* Plan Detail Modal with Buckets */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelectedPlan(null); }} title={selectedPlan ? `Plan: ${selectedPlan.name}` : 'Plan Detail'} size="xl">
        {selectedPlan && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Type:</span> <Badge variant={planTypeVariant[selectedPlan.planType] || 'secondary'} size="sm">{selectedPlan.planType}</Badge></div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={statusVariant[selectedPlan.status] || 'secondary'} size="sm">{selectedPlan.status}</Badge></div>
              <div><span className="font-medium text-gray-500">Granularity:</span> {selectedPlan.granularity}</div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Start:</span> {safeFormat(selectedPlan.startDate, 'MMM dd, yyyy')}</div>
              <div><span className="font-medium text-gray-500">End:</span> {safeFormat(selectedPlan.endDate, 'MMM dd, yyyy')}</div>
              <div><span className="font-medium text-gray-500">Horizon:</span> {selectedPlan.planningHorizon} periods</div>
            </div>
            {selectedPlan.description && (
              <div className="text-sm"><span className="font-medium text-gray-500">Description:</span> {selectedPlan.description}</div>
            )}
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold">Capacity Buckets</h3>
                <Button size="sm" onClick={() => { setBucketForm(emptyBucketForm); setShowAddBucket(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>Add Bucket</Button>
              </div>
              <DataTable data={buckets} columns={bucketColumns} keyExtractor={(r) => r.id} isLoading={bucketsLoading} emptyMessage="No buckets defined for this plan" />
            </div>
          </div>
        )}
      </Modal>

      {/* Add Bucket Modal */}
      <Modal isOpen={showAddBucket} onClose={() => setShowAddBucket(false)} title="Add Capacity Bucket" size="md">
        {/* Fixed: Passing props to the external component */}
        <BucketFormFields bucketForm={bucketForm} setBucketForm={setBucketForm} workCentersData={workCentersData} />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowAddBucket(false)}>Cancel</Button>
          <Button onClick={() => createBucketMut.mutate(bucketForm)} isLoading={createBucketMut.isPending} disabled={!bucketForm.workCenterId || !bucketForm.periodDate}>Add</Button>
        </div>
      </Modal>
    </div>
  );
}