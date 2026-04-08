import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { forecastAccuracyService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { ForecastAccuracyMetric } from '../../types';

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

const mapeColor = (mape?: number) => {
  if (mape == null) return 'secondary';
  if (mape < 10) return 'success';
  if (mape <= 25) return 'warning';
  return 'error';
};

const emptyForm = {
  productId: '',
  locationId: '',
  periodDate: new Date().toISOString().slice(0, 10),
  forecastQty: 0,
  actualQty: 0,
  mape: 0,
  bias: 0,
  trackingSignal: 0,
  forecastModel: '',
  granularity: 'MONTHLY',
};

export default function ForecastAccuracyPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'forecast-accuracy'],
    queryFn: () => forecastAccuracyService.getAll({ pageSize: 100 }),
  });

  const items: ForecastAccuracyMetric[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => forecastAccuracyService.create({
      productId: d.productId,
      locationId: d.locationId || undefined,
      periodDate: d.periodDate,
      forecastQty: Number(d.forecastQty),
      actualQty: Number(d.actualQty),
      mape: Number(d.mape) || undefined,
      bias: Number(d.bias) || undefined,
      trackingSignal: Number(d.trackingSignal) || undefined,
      forecastModel: d.forecastModel || undefined,
      granularity: d.granularity || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'forecast-accuracy'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('Forecast accuracy metric created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create metric'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => forecastAccuracyService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'forecast-accuracy'] });
      toast.success('Metric deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete metric'); },
  });

  const columns: Column<ForecastAccuracyMetric>[] = [
    { key: 'product', header: 'Product', accessor: (r) => r.product?.name || r.productId },
    { key: 'location', header: 'Location', accessor: (r) => r.location?.name || r.locationId || '—' },
    { key: 'periodDate', header: 'Period', accessor: (r) => safeFormat(r.periodDate, 'MMM yyyy') },
    { key: 'forecastQty', header: 'Forecast Value', accessor: (r) => r.forecastQty?.toLocaleString(), align: 'right' },
    { key: 'actualQty', header: 'Actual Value', accessor: (r) => r.actualQty?.toLocaleString(), align: 'right' },
    {
      key: 'mape', header: 'MAPE %',
      accessor: (r) => (
        <Badge variant={mapeColor(r.mape) as any} size="sm">
          {r.mape != null ? `${r.mape.toFixed(1)}%` : '—'}
        </Badge>
      ),
      align: 'right',
    },
    { key: 'bias', header: 'Bias %', accessor: (r) => r.bias != null ? `${r.bias.toFixed(1)}%` : '—', align: 'right' },
    { key: 'trackingSignal', header: 'Tracking Signal', accessor: (r) => r.trackingSignal != null ? r.trackingSignal.toFixed(2) : '—', align: 'right' },
    { key: 'model', header: 'Model Used', accessor: (r) => r.forecastModel || '—' },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { if (confirm('Delete this metric?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const FormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
          <ProductSelector value={form.productId || undefined} onChange={(id) => setForm({ ...form, productId: id })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Period Date *</label>
          <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.periodDate} onChange={(e) => setForm({ ...form, periodDate: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Forecast Qty *</label>
          <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.forecastQty} onChange={(e) => setForm({ ...form, forecastQty: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Actual Qty *</label>
          <input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.actualQty} onChange={(e) => setForm({ ...form, actualQty: +e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">MAPE %</label>
          <input type="number" step="0.1" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.mape} onChange={(e) => setForm({ ...form, mape: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bias %</label>
          <input type="number" step="0.1" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.bias} onChange={(e) => setForm({ ...form, bias: +e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tracking Signal</label>
          <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.trackingSignal} onChange={(e) => setForm({ ...form, trackingSignal: +e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Model Used</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.forecastModel} onChange={(e) => setForm({ ...form, forecastModel: e.target.value })}>
            <option value="">Select model...</option>
            {['ARIMA', 'Prophet', 'Holt-Winters', 'ETS', 'Linear Regression', 'Moving Average', 'Naive', 'Manual'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Granularity</label>
          <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.granularity} onChange={(e) => setForm({ ...form, granularity: e.target.value })}>
            {['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'].map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Forecast Accuracy</h1>
          <p className="text-secondary-500 mt-1">Monitor and track forecast accuracy metrics by product and location</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>Add Metric</Button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <Card>
        <CardHeader title="Forecast Accuracy Metrics" description="Comparison of forecast vs actual values with accuracy indicators" />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No forecast accuracy metrics found" />
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Add Forecast Accuracy Metric" size="lg">
        <FormFields />
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.productId || !form.periodDate}>Create</Button>
        </div>
      </Modal>
    </div>
  );
}
