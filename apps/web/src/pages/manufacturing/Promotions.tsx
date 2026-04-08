import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import { DocumentDuplicateIcon, EyeIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { promotionService, type Promotion, type PromotionLiftFactor } from '@services/api';
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

const PROMO_TYPES = ['PRICE_DISCOUNT','BOGO','BUNDLE','REBATE','LOYALTY_POINTS','FREE_SHIPPING','FEATURE_AD','DISPLAY','COUPON','CLEARANCE'];
const PROMO_STATUSES = ['DRAFT','PLANNED','APPROVED','ACTIVE','COMPLETED','CANCELLED'];
const statusVariant: Record<string, any> = { DRAFT: 'secondary', PLANNED: 'primary', APPROVED: 'warning', ACTIVE: 'success', COMPLETED: 'default', CANCELLED: 'error' };

const emptyPromo = { name: '', description: '', type: 'PRICE_DISCOUNT', startDate: '', endDate: '', discountPercent: 0, discountAmount: 0, marketingSpend: 0, notes: '' };

type Tab = 'all' | 'active' | 'upcoming';

export default function PromotionsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [selected, setSelected] = useState<Promotion | null>(null);
  const [form, setForm] = useState<typeof emptyPromo>(emptyPromo);
  const [copyForm, setCopyForm] = useState({ code: '', name: '', startDate: '', endDate: '', copyLiftFactors: true });
  const [statusFilter, setStatusFilter] = useState('');

  // Queries
  const { data, isLoading, isError: isAllError, error: allError } = useQuery({
    queryKey: ['manufacturing', 'promotions', statusFilter],
    queryFn: () => promotionService.getPromotions({ status: statusFilter || undefined, pageSize: 100 }),
    enabled: tab === 'all',
  });

  const { data: activeData, isLoading: activeLoading, isError: isActiveError, error: activeError } = useQuery({
    queryKey: ['manufacturing', 'promotions', 'active'],
    queryFn: () => promotionService.getActivePromotions(),
    enabled: tab === 'active',
  });

  const { data: upcomingData, isLoading: upcomingLoading, isError: isUpcomingError, error: upcomingError } = useQuery({
    queryKey: ['manufacturing', 'promotions', 'upcoming'],
    queryFn: () => promotionService.getUpcomingPromotions({ days: 90 }),
    enabled: tab === 'upcoming',
  });

  const { data: liftFactors } = useQuery({
    queryKey: ['manufacturing', 'promotion-lifts', selected?.id],
    queryFn: () => selected ? promotionService.getLiftFactors(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const { data: impact } = useQuery({
    queryKey: ['manufacturing', 'promotion-impact', selected?.id],
    queryFn: () => selected ? promotionService.getPromotionImpact(selected.id) : null,
    enabled: !!selected && showDetail,
  });

  const getItems = (): Promotion[] => {
    const src = tab === 'active' ? activeData : tab === 'upcoming' ? upcomingData : data;
    return Array.isArray(src?.items) ? src.items : Array.isArray(src) ? src : [];
  };
  const items = getItems();
  const liftItems: PromotionLiftFactor[] = Array.isArray(liftFactors?.items) ? liftFactors.items : Array.isArray(liftFactors) ? liftFactors : [];

  const hasError = isAllError || isActiveError || isUpcomingError;
  const firstError = allError || activeError || upcomingError;

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyPromo) => promotionService.createPromotion({
      name: d.name, description: d.description, type: d.type,
      startDate: d.startDate, endDate: d.endDate,
      discountPercent: Number(d.discountPercent) || undefined,
      discountAmount: Number(d.discountAmount) || undefined,
      marketingSpend: Number(d.marketingSpend) || undefined,
      notes: d.notes || undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'promotions'] }); setShowCreate(false); setForm(emptyPromo); toast.success('Promotion created'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create promotion'); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<Promotion> }) => promotionService.updatePromotion(id, dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'promotions'] }); setShowEdit(false); toast.success('Promotion updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update promotion'); },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => promotionService.updatePromotionStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'promotions'] }); toast.success('Status updated'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update status'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => promotionService.deletePromotion(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'promotions'] }); toast.success('Promotion deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete promotion'); },
  });

  const copyMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: typeof copyForm }) => promotionService.copyPromotion(id, dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manufacturing', 'promotions'] }); setShowCopy(false); toast.success('Promotion copied'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to copy promotion'); },
  });

  const columns: Column<Promotion>[] = [
    { key: 'code', header: 'Code', accessor: 'code' },
    { key: 'name', header: 'Name', accessor: 'name' },
    { key: 'type', header: 'Type', accessor: 'type' },
    {
      key: 'status', header: 'Status',
      accessor: (r) => <Badge variant={statusVariant[r.status] || 'secondary'} size="sm">{r.status}</Badge>,
    },
    { key: 'start', header: 'Start', accessor: (r) => safeFormat(r.startDate, 'yyyy-MM-dd') },
    { key: 'end', header: 'End', accessor: (r) => safeFormat(r.endDate, 'yyyy-MM-dd') },
    { key: 'discount', header: 'Discount', accessor: (r) => r.discountPercent ? `${r.discountPercent}%` : r.discountAmount ? `$${r.discountAmount}` : '—', align: 'right' },
    {
      key: 'actions', header: 'Actions',
      accessor: (r) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelected(r); setShowDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          <button onClick={() => {
            setSelected(r); setForm({ name: r.name, description: r.description || '', type: r.type, startDate: r.startDate?.split('T')[0] || '', endDate: r.endDate?.split('T')[0] || '', discountPercent: r.discountPercent || 0, discountAmount: r.discountAmount || 0, marketingSpend: r.marketingSpend || 0, notes: r.notes || '' });
            setShowEdit(true);
          }} className="p-1 text-amber-600 hover:text-amber-800"><PencilIcon className="h-4 w-4" /></button>
          <button onClick={() => { setSelected(r); setCopyForm({ code: `${r.code}-COPY`, name: `${r.name} (Copy)`, startDate: '', endDate: '', copyLiftFactors: true }); setShowCopy(true); }} className="p-1 text-indigo-600 hover:text-indigo-800"><DocumentDuplicateIcon className="h-4 w-4" /></button>
          <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(r.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 ${tab === id ? 'border-primary-500 text-primary-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`} onClick={() => setTab(id)}>{label}</button>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Promotions</h1>
          <p className="text-secondary-500 mt-1">Promotional calendar and forecast overlays</p>
        </div>
        <Button onClick={() => { setForm(emptyPromo); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>Add Promotion</Button>
      </div>

      {hasError && <QueryErrorBanner error={firstError} />}

      <div className="flex gap-1 border-b">
        <TabBtn id="all" label="All Promotions" />
        <TabBtn id="active" label="Active" />
        <TabBtn id="upcoming" label="Upcoming" />
      </div>

      {tab === 'all' && (
        <div className="flex gap-2 items-center">
          <label className="text-sm text-gray-600">Status:</label>
          <select className="rounded-md border-gray-300 shadow-sm text-sm focus:border-primary-500" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {PROMO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      <Card>
        <CardHeader title="Promotions" description={tab === 'active' ? 'Currently active promotions' : tab === 'upcoming' ? 'Upcoming in next 90 days' : 'All promotions'} />
        <DataTable data={items} columns={columns} keyExtractor={(r) => r.id} isLoading={tab === 'active' ? activeLoading : tab === 'upcoming' ? upcomingLoading : isLoading} emptyMessage="No promotions found" />
      </Card>

      {/* Create */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Promotion" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Summer Sale Campaign" />
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Type *</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{PROMO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Discount %</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Discount $</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Marketing Spend</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.marketingSpend} onChange={(e) => setForm({ ...form, marketingSpend: +e.target.value })} /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.name || !form.startDate || !form.endDate}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Edit */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title={`Edit Promotion${selected ? ` — ${selected.code}` : ''}`} size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{PROMO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Discount %</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Discount $</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: +e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Marketing Spend</label><input type="number" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.marketingSpend} onChange={(e) => setForm({ ...form, marketingSpend: +e.target.value })} /></div>
          </div>
          {selected && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <div className="flex gap-2">
                {PROMO_STATUSES.map(s => (
                  <Button key={s} size="sm" variant={selected.status === s ? 'primary' : 'secondary'} onClick={() => updateStatus.mutate({ id: selected.id, status: s })}>{s}</Button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={() => selected && updateMut.mutate({ id: selected.id, dto: { name: form.name, description: form.description, type: form.type as any, startDate: form.startDate, endDate: form.endDate, discountPercent: Number(form.discountPercent), discountAmount: Number(form.discountAmount), marketingSpend: Number(form.marketingSpend), notes: form.notes } })} isLoading={updateMut.isPending}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Copy */}
      <Modal isOpen={showCopy} onClose={() => setShowCopy(false)} title="Copy Promotion" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">New Code *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={copyForm.code} onChange={(e) => setCopyForm({ ...copyForm, code: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">New Name *</label><input type="text" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={copyForm.name} onChange={(e) => setCopyForm({ ...copyForm, name: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={copyForm.startDate} onChange={(e) => setCopyForm({ ...copyForm, startDate: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label><input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={copyForm.endDate} onChange={(e) => setCopyForm({ ...copyForm, endDate: e.target.value })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={copyForm.copyLiftFactors} onChange={(e) => setCopyForm({ ...copyForm, copyLiftFactors: e.target.checked })} />
            Copy lift factors
          </label>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowCopy(false)}>Cancel</Button>
            <Button onClick={() => selected && copyMut.mutate({ id: selected.id, dto: copyForm })} isLoading={copyMut.isPending} disabled={!copyForm.code || !copyForm.name || !copyForm.startDate || !copyForm.endDate}>Copy</Button>
          </div>
        </div>
      </Modal>

      {/* Detail */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); }} title={selected ? `${selected.code} — ${selected.name}` : 'Promotion'} size="xl">
        {selected && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Type:</span> {selected.type}</div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={statusVariant[selected.status] || 'secondary'} size="sm">{selected.status}</Badge></div>
              <div><span className="font-medium text-gray-500">Dates:</span> {safeFormat(selected.startDate, 'MMM d')} - {safeFormat(selected.endDate, 'MMM d, yyyy')}</div>
              <div><span className="font-medium text-gray-500">Discount:</span> {selected.discountPercent ? `${selected.discountPercent}%` : selected.discountAmount ? `$${selected.discountAmount}` : '—'}</div>
            </div>
            {selected.description && <p className="text-sm text-gray-600">{selected.description}</p>}

            {/* Impact Analysis */}
            {impact && (
              <div>
                <h3 className="text-base font-semibold mb-2">Impact Analysis</h3>
                <div className="grid grid-cols-4 gap-4 text-sm bg-blue-50 p-3 rounded">
                  <div><span className="font-medium text-gray-500">Baseline:</span> {(impact as any).totalBaselineForecast?.toLocaleString() ?? '—'}</div>
                  <div><span className="font-medium text-gray-500">Adjusted:</span> {(impact as any).totalAdjustedForecast?.toLocaleString() ?? '—'}</div>
                  <div><span className="font-medium text-gray-500">Lift:</span> {(impact as any).totalLiftPercent?.toFixed(1) ?? '—'}%</div>
                  <div><span className="font-medium text-gray-500">ROI:</span> {(impact as any).roi != null ? `${((impact as any).roi * 100).toFixed(0)}%` : '—'}</div>
                </div>
              </div>
            )}

            {/* Lift Factors */}
            <div>
              <h3 className="text-base font-semibold mb-2">Lift Factors ({liftItems.length})</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-right">Week</th>
                    <th className="px-3 py-2 text-right">Lift %</th><th className="px-3 py-2 text-right">Cannib %</th>
                    <th className="px-3 py-2 text-right">Halo %</th><th className="px-3 py-2 text-right">Baseline</th>
                    <th className="px-3 py-2 text-right">Adjusted</th>
                  </tr></thead>
                  <tbody>
                    {liftItems.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">No lift factors</td></tr>}
                    {liftItems.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-3 py-2">{l.product?.sku || l.productId}</td>
                        <td className="px-3 py-2 text-right">{l.weekNumber}</td>
                        <td className="px-3 py-2 text-right">{l.liftPercent}%</td>
                        <td className="px-3 py-2 text-right">{l.cannibalizationPercent ?? '—'}%</td>
                        <td className="px-3 py-2 text-right">{l.haloPercent ?? '—'}%</td>
                        <td className="px-3 py-2 text-right">{l.baselineForecast?.toLocaleString() ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{l.adjustedForecast?.toLocaleString() ?? '—'}</td>
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
