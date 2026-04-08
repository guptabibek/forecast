import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import { EyeIcon, PencilIcon, PlusIcon, RocketLaunchIcon, TrashIcon } from '@heroicons/react/24/outline';
import { dataService, npiService, type NewProductIntroduction, type NPIForecast } from '@services/api';
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

const NPI_STATUSES = ['CONCEPT','DEVELOPMENT','TESTING','PRE_LAUNCH','LAUNCHED','MATURE','DECLINING','DISCONTINUED'];
const CURVE_TYPES = ['LINEAR','EXPONENTIAL','S_CURVE','HOCKEY_STICK'];
const NPI_CATEGORIES = ['Electronics','Consumer Goods','Food & Beverage','Automotive','Healthcare','Industrial','Apparel','Software','Raw Materials','Packaging'];
const statusVariant: Record<string, any> = { CONCEPT: 'secondary', DEVELOPMENT: 'primary', TESTING: 'warning', PRE_LAUNCH: 'primary', LAUNCHED: 'success', MATURE: 'success', DECLINING: 'warning', DISCONTINUED: 'error' };

const emptyNPI = { sku: '', name: '', description: '', category: '', brand: '', launchDate: '', launchCurveType: 'S_CURVE', rampUpMonths: 6, peakMonthsSinceLaunch: 12, peakForecastUnits: 1000, initialPrice: 0, targetMargin: 0 };

export default function NPIPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<NewProductIntroduction | null>(null);
  const [form, setForm] = useState<typeof emptyNPI>(emptyNPI);
  const [statusFilter, setStatusFilter] = useState('');
  const [isNewBrand, setIsNewBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');

  // Queries
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'npi', statusFilter],
    queryFn: () => npiService.getNPIs({ status: statusFilter || undefined, pageSize: 100 }),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => dataService.getProducts(),
  });

  // Derive unique categories and brands from existing products/NPI data
  const items: NewProductIntroduction[] = data?.items ? data.items : Array.isArray(data) ? data : [];
  const derivedCategories = [...new Set([
    ...NPI_CATEGORIES,
    ...items.map(i => i.category).filter(Boolean),
    ...(productsData || []).map((p: any) => p.category).filter(Boolean),
  ])].sort();
  const derivedBrands = [...new Set([
    ...items.map(i => i.brand).filter(Boolean),
    ...(productsData || []).map((p: any) => p.brand).filter(Boolean),
  ])].sort();

  const { data: _detailData } = useQuery({
    queryKey: ['manufacturing', 'npi', selected?.id],
    queryFn: () => selected ? npiService.getNPI(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const { data: forecast } = useQuery({
    queryKey: ['manufacturing', 'npi-forecast', selected?.id],
    queryFn: () => selected ? npiService.generateNPIForecast(selected.id, { months: 24 }) : null,
    enabled: !!selected && showDetail,
  });

  const { data: performance } = useQuery({
    queryKey: ['manufacturing', 'npi-performance', selected?.id],
    queryFn: () => selected ? npiService.getNPIPerformance(selected.id) : null,
    enabled: !!selected && showDetail && (selected.status === 'LAUNCHED' || selected.status === 'MATURE'),
  });

  const { data: analogs } = useQuery({
    queryKey: ['manufacturing', 'npi-analogs', selected?.id],
    queryFn: () => selected ? npiService.findAnalogProducts(selected.id, { limit: 5 }) : null,
    enabled: !!selected && showDetail,
  });

  const forecastItems: NPIForecast[] = Array.isArray(forecast) ? forecast : [];
  const analogItems = Array.isArray(analogs) ? analogs : [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyNPI) => npiService.createNPI({
      sku: d.sku, name: d.name, description: d.description, category: d.category, brand: d.brand,
      launchDate: d.launchDate || undefined, launchCurveType: d.launchCurveType,
      rampUpMonths: Number(d.rampUpMonths), peakMonthsSinceLaunch: Number(d.peakMonthsSinceLaunch),
      peakForecastUnits: Number(d.peakForecastUnits), initialPrice: Number(d.initialPrice) || undefined,
      targetMargin: Number(d.targetMargin) || undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'npi'] }); setShowCreate(false); setForm(emptyNPI); toast.success('NPI created'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create NPI'); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<NewProductIntroduction> }) => npiService.updateNPI(id, dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'npi'] }); setShowEdit(false); toast.success('NPI updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update NPI'); },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => npiService.updateNPIStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'npi'] }); toast.success('NPI status updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update NPI status'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => npiService.deleteNPI(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'npi'] }); toast.success('NPI deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete NPI'); },
  });

  const convertMut = useMutation({
    mutationFn: (id: string) => npiService.convertToProduct(id, { createBOM: true, createRouting: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'npi'] }); toast.success('NPI converted to product'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to convert NPI'); },
  });

  const setAnalogMut = useMutation({
    mutationFn: ({ npiId, analogId, pct }: { npiId: string; analogId: string; pct: number }) => npiService.setAnalogProduct(npiId, analogId, pct),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'npi'] }); toast.success('Analog product set'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to set analog product'); },
  });

  const columns: Column<NewProductIntroduction>[] = [
    { key: 'sku', header: 'SKU', accessor: (r) => r.sku || r.product?.sku || '—' },
    { key: 'name', header: 'Name', accessor: (r) => r.name || r.product?.name || '—' },
    { key: 'category', header: 'Category', accessor: (r) => r.category || '—' },
    { key: 'brand', header: 'Brand', accessor: (r) => r.brand || '—' },
    { key: 'launch', header: 'Launch', accessor: (r) => safeFormat(r.launchDate, 'yyyy-MM-dd') },
    { key: 'curve', header: 'Curve', accessor: (r) => r.launchCurveType || '—' },
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
            setSelected(r); setForm({ sku: r.sku, name: r.name, description: r.description || '', category: r.category || '', brand: r.brand || '', launchDate: r.launchDate?.split('T')[0] || '', launchCurveType: r.launchCurveType || 'S_CURVE', rampUpMonths: r.rampUpMonths || 6, peakMonthsSinceLaunch: r.peakMonthsSinceLaunch || 12, peakForecastUnits: r.peakForecastUnits || 1000, initialPrice: r.initialPrice || 0, targetMargin: r.targetMargin || 0 });
            setShowEdit(true);
          }} className="p-1 text-amber-600 hover:text-amber-800"><PencilIcon className="h-4 w-4" /></button>
          {r.status === 'PRE_LAUNCH' && (
            <button onClick={() => { if (confirm('Convert to product?')) convertMut.mutate(r.id); }} className="p-1 text-green-600 hover:text-green-800" title="Convert to Product"><RocketLaunchIcon className="h-4 w-4" /></button>
          )}
          <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">New Product Introduction</h1>
          <p className="text-secondary-500 mt-1">Track new products from concept to launch</p>
        </div>
        <Button onClick={() => { setForm(emptyNPI); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>Add NPI</Button>
      </div>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      <div className="flex gap-2 items-center">
        <label className="text-sm text-gray-600">Status:</label>
        <select className="rounded-md border-gray-300 shadow-sm text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          {NPI_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <CardHeader title="NPI Programs" description="All NPI initiatives" />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No NPI records" />
      </Card>

      {/* Create */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create NPI" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product (SKU) *</label>
              <ProductSelector
                value={undefined}
                onChange={(_id, product) => {
                  if (product) {
                    setForm({ ...form, sku: product.code || '', name: product.name || form.name });
                  }
                }}
                placeholder="Search existing products..."
                activeOnly={false}
              />
              <input type="text" className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Or type a new SKU" />
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Category</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="">Select category...</option>{derivedCategories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
              {!isNewBrand && derivedBrands.length > 0 ? (
                <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.brand} onChange={(e) => { if (e.target.value === '__new') { setIsNewBrand(true); setNewBrandName(''); } else { setForm({ ...form, brand: e.target.value }); } }}>
                  <option value="">Select brand...</option>
                  {derivedBrands.map(b => <option key={b} value={b}>{b}</option>)}
                  <option value="__new">+ New Brand</option>
                </select>
              ) : (
                <div className="flex gap-1">
                  <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={newBrandName} onChange={(e) => { setNewBrandName(e.target.value); setForm({ ...form, brand: e.target.value }); }} placeholder="Enter brand name" />
                  {derivedBrands.length > 0 && <button type="button" className="text-xs text-primary-600 whitespace-nowrap" onClick={() => { setIsNewBrand(false); setForm({ ...form, brand: '' }); }}>Back</button>}
                </div>
              )}
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Launch Date</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.launchDate} onChange={(e) => setForm({ ...form, launchDate: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Curve Type</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.launchCurveType} onChange={(e) => setForm({ ...form, launchCurveType: e.target.value })}>{CURVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Ramp Up (mo)</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.rampUpMonths} onChange={(e) => setForm({ ...form, rampUpMonths: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Peak Month</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.peakMonthsSinceLaunch} onChange={(e) => setForm({ ...form, peakMonthsSinceLaunch: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Peak Units</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.peakForecastUnits} onChange={(e) => setForm({ ...form, peakForecastUnits: +e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Initial Price</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.initialPrice} onChange={(e) => setForm({ ...form, initialPrice: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Target Margin %</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.targetMargin} onChange={(e) => setForm({ ...form, targetMargin: +e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.sku || !form.name}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Edit */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit NPI" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">SKU</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm bg-gray-50" value={form.sku} disabled /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Category</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="">Select category...</option>{derivedCategories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
              {!isNewBrand && derivedBrands.length > 0 ? (
                <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.brand} onChange={(e) => { if (e.target.value === '__new') { setIsNewBrand(true); setNewBrandName(''); } else { setForm({ ...form, brand: e.target.value }); } }}>
                  <option value="">Select brand...</option>
                  {derivedBrands.map(b => <option key={b} value={b}>{b}</option>)}
                  <option value="__new">+ New Brand</option>
                </select>
              ) : (
                <div className="flex gap-1">
                  <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={newBrandName} onChange={(e) => { setNewBrandName(e.target.value); setForm({ ...form, brand: e.target.value }); }} placeholder="Enter brand name" />
                  {derivedBrands.length > 0 && <button type="button" className="text-xs text-primary-600 whitespace-nowrap" onClick={() => { setIsNewBrand(false); setForm({ ...form, brand: '' }); }}>Back</button>}
                </div>
              )}
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Launch Date</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.launchDate} onChange={(e) => setForm({ ...form, launchDate: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Curve</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.launchCurveType} onChange={(e) => setForm({ ...form, launchCurveType: e.target.value })}>{CURVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Ramp (mo)</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.rampUpMonths} onChange={(e) => setForm({ ...form, rampUpMonths: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Peak Mo</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.peakMonthsSinceLaunch} onChange={(e) => setForm({ ...form, peakMonthsSinceLaunch: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Peak Qty</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.peakForecastUnits} onChange={(e) => setForm({ ...form, peakForecastUnits: +e.target.value })} /></div>
          </div>
          {selected && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status Transition</label>
              <div className="flex gap-2 flex-wrap">
                {NPI_STATUSES.map(s => (
                  <Button key={s} size="sm" variant={selected.status === s ? 'primary' : 'secondary'} onClick={() => updateStatus.mutate({ id: selected.id, status: s })}>{s.replace('_', ' ')}</Button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={() => selected && updateMut.mutate({ id: selected.id, dto: { name: form.name, description: form.description, category: form.category, brand: form.brand, launchDate: form.launchDate || undefined, launchCurveType: form.launchCurveType as any, rampUpMonths: Number(form.rampUpMonths), peakMonthsSinceLaunch: Number(form.peakMonthsSinceLaunch), peakForecastUnits: Number(form.peakForecastUnits), initialPrice: Number(form.initialPrice), targetMargin: Number(form.targetMargin) } })} isLoading={updateMut.isPending}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Detail */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); }} title={selected ? `${selected.sku} — ${selected.name}` : 'NPI'} size="xl">
        {selected && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={statusVariant[selected.status] || 'secondary'} size="sm">{selected.status}</Badge></div>
              <div><span className="font-medium text-gray-500">Category:</span> {selected.category || '—'}</div>
              <div><span className="font-medium text-gray-500">Brand:</span> {selected.brand || '—'}</div>
              <div><span className="font-medium text-gray-500">Launch:</span> {safeFormat(selected.launchDate, 'MMM d, yyyy')}</div>
            </div>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Curve:</span> {selected.launchCurveType || '—'}</div>
              <div><span className="font-medium text-gray-500">Ramp Up:</span> {selected.rampUpMonths ?? '—'} months</div>
              <div><span className="font-medium text-gray-500">Peak Month:</span> {selected.peakMonthsSinceLaunch ?? '—'}</div>
              <div><span className="font-medium text-gray-500">Peak Units:</span> {selected.peakForecastUnits?.toLocaleString() ?? '—'}</div>
            </div>
            {selected.analogProduct && (
              <div className="text-sm bg-amber-50 p-3 rounded">
                <span className="font-medium text-gray-500">Analog Product:</span> {selected.analogProduct.sku} — {selected.analogProduct.name} ({selected.analogSimilarityPercent}% similarity)
              </div>
            )}

            {/* Performance (if launched) */}
            {performance && (
              <div>
                <h3 className="text-base font-semibold mb-2">Performance</h3>
                <div className="grid grid-cols-4 gap-4 text-sm bg-green-50 p-3 rounded">
                  <div><span className="font-medium text-gray-500">Months Live:</span> {(performance as any).monthsSinceLaunch ?? '—'}</div>
                  <div><span className="font-medium text-gray-500">Actuals:</span> {(performance as any).actualsTotal?.toLocaleString() ?? '—'}</div>
                  <div><span className="font-medium text-gray-500">Variance:</span> {(performance as any).variancePercent?.toFixed(1) ?? '—'}%</div>
                  <div><span className="font-medium text-gray-500">On Track:</span> <Badge variant={(performance as any).onTrack ? 'success' : 'error'} size="sm">{(performance as any).onTrack ? 'YES' : 'NO'}</Badge></div>
                </div>
              </div>
            )}

            {/* Forecast */}
            {forecastItems.length > 0 && (
              <div>
                <h3 className="text-base font-semibold mb-2">Forecast ({forecastItems.length} periods)</h3>
                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="min-w-full text-sm border">
                    <thead className="bg-gray-50 sticky top-0"><tr>
                      <th className="px-3 py-2 text-left">Period</th><th className="px-3 py-2 text-right">Forecast</th>
                      <th className="px-3 py-2 text-right">Cumulative</th><th className="px-3 py-2 text-right">Ramp %</th>
                    </tr></thead>
                    <tbody>
                      {forecastItems.map((f, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{safeFormat(f.periodDate, 'MMM yyyy')}</td>
                          <td className="px-3 py-2 text-right">{f.forecast?.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right">{f.cumulative?.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right">{(f.rampPercentage * 100)?.toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Analog Suggestions */}
            {analogItems.length > 0 && (
              <div>
                <h3 className="text-base font-semibold mb-2">Analog Suggestions</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border">
                    <thead className="bg-gray-50"><tr>
                      <th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-right">Similarity</th>
                      <th className="px-3 py-2">Same Cat</th><th className="px-3 py-2 text-right">Actuals Mo</th><th className="px-3 py-2"></th>
                    </tr></thead>
                    <tbody>
                      {analogItems.map((a: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{a.product?.sku} — {a.product?.name}</td>
                          <td className="px-3 py-2 text-right">{(a.similarityScore * 100)?.toFixed(0)}%</td>
                          <td className="px-3 py-2">{a.sameCategory ? 'Yes' : 'No'}</td>
                          <td className="px-3 py-2 text-right">{a.actualsMonths}</td>
                          <td className="px-3 py-2">
                            <Button size="sm" variant="secondary" onClick={() => setAnalogMut.mutate({ npiId: selected.id, analogId: a.product.id, pct: Math.round(a.similarityScore * 100) })}>Set Analog</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
