import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';
import {
    ArchiveBoxIcon,
    ArrowPathIcon,
    CalendarDaysIcon,
    ClockIcon,
    ExclamationTriangleIcon,
    EyeIcon,
    PlusIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import { batchService, dataService, uomService } from '@services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, format } from 'date-fns';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { Batch, BatchStatus } from '../../types';

type BatchViewMode = 'stock' | 'nearExpiry' | 'expired' | 'ageing';
type AgeBucketFilter = '' | '0-3m' | '3-6m' | '6-12m' | '>12m';
type BatchListResult = Awaited<ReturnType<typeof batchService.getAll>>;

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

const BATCH_STATUSES: BatchStatus[] = ['CREATED', 'IN_PROCESS', 'AVAILABLE', 'QUARANTINE', 'EXPIRED', 'CONSUMED', 'RECALLED'];
const NEAR_EXPIRY_WINDOWS = [30, 90, 180, 365] as const;
const AGE_BUCKETS: Array<{ key: AgeBucketFilter; label: string; description: string }> = [
  { key: '', label: 'All ages', description: 'All manufactured lots' },
  { key: '0-3m', label: '0-3 months', description: 'Freshly produced stock' },
  { key: '3-6m', label: '3-6 months', description: 'Monitor for rotation' },
  { key: '6-12m', label: '6-12 months', description: 'Use before ageing risk' },
  { key: '>12m', label: '12+ months', description: 'Potential FEFO pressure' },
];
const VIEW_OPTIONS: Array<{
  key: BatchViewMode;
  label: string;
  description: string;
  tableTitle: string;
  tableDescription: string;
  icon: typeof ArchiveBoxIcon;
}> = [
  {
    key: 'stock',
    label: 'Batch-wise stock',
    description: 'All Marg-backed batches with available stock and value.',
    tableTitle: 'Live Batch Stock',
    tableDescription: 'Every active batch row with stock, ageing, and expiry context.',
    icon: ArchiveBoxIcon,
  },
  {
    key: 'nearExpiry',
    label: 'Near-expiry',
    description: 'Upcoming expiry exposure inside a selected horizon.',
    tableTitle: 'Near-expiry Watchlist',
    tableDescription: 'Batches expiring inside the selected planning window.',
    icon: ClockIcon,
  },
  {
    key: 'expired',
    label: 'Expired',
    description: 'Already expired lots that need disposition or write-off.',
    tableTitle: 'Expired Batches',
    tableDescription: 'Expired inventory that should be blocked from issue.',
    icon: ExclamationTriangleIcon,
  },
  {
    key: 'ageing',
    label: 'Ageing',
    description: 'Age buckets for FEFO-style monitoring and rotation decisions.',
    tableTitle: 'Batch Ageing View',
    tableDescription: 'Manufacturing-date driven age buckets across all tracked lots.',
    icon: CalendarDaysIcon,
  },
];
const EMPTY_SUMMARY: NonNullable<BatchListResult['summary']> = {
  totalBatches: 0,
  totalQty: 0,
  totalAvailableQty: 0,
  totalValue: 0,
  expiredQty: 0,
  expiredValue: 0,
  nearExpiry30Qty: 0,
  nearExpiry30Value: 0,
  nearExpiry90Qty: 0,
  nearExpiry90Value: 0,
  ageBuckets: {
    '0-3m': 0,
    '3-6m': 0,
    '6-12m': 0,
    '>12m': 0,
  },
};

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const statusVariant: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
  CREATED: 'secondary',
  IN_PROCESS: 'primary',
  AVAILABLE: 'success',
  QUARANTINE: 'warning',
  EXPIRED: 'error',
  CONSUMED: 'secondary',
  RECALLED: 'error',
};

const emptyForm = {
  productId: '',
  locationId: '',
  quantity: 0,
  uom: 'EA',
  status: 'CREATED' as BatchStatus,
  manufacturingDate: '',
  expiryDate: '',
  costPerUnit: 0,
  notes: '',
};

const safeParseDate = (dateVal?: string | null) => {
  if (!dateVal) return null;
  const date = new Date(dateVal);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const formatMetric = (value: number) => numberFormatter.format(Number(value || 0));

const formatLabel = (value: string) =>
  value
    .split('_')
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(' ');

const getDaysToExpiry = (expiryDate?: string) => {
  const date = safeParseDate(expiryDate);
  if (!date) return null;
  return differenceInCalendarDays(date, startOfToday());
};

const getAgeDays = (manufacturingDate?: string) => {
  const date = safeParseDate(manufacturingDate);
  if (!date) return null;
  return Math.max(0, differenceInCalendarDays(startOfToday(), date));
};

const getAgeBucket = (manufacturingDate?: string) => {
  const ageDays = getAgeDays(manufacturingDate);
  if (ageDays == null) return 'unknown';
  if (ageDays <= 90) return '0-3m';
  if (ageDays <= 180) return '3-6m';
  if (ageDays <= 365) return '6-12m';
  return '>12m';
};

const getExpiryBadge = (expiryDate?: string) => {
  const days = getDaysToExpiry(expiryDate);
  if (days == null) {
    return { label: 'No expiry captured', variant: 'secondary' as const };
  }
  if (days < 0) {
    return { label: `Expired ${Math.abs(days)}d ago`, variant: 'error' as const };
  }
  if (days <= 30) {
    return { label: `${days}d left`, variant: 'warning' as const };
  }
  if (days <= 90) {
    return { label: `${days}d left`, variant: 'primary' as const };
  }
  return { label: `${days}d left`, variant: 'success' as const };
};

export default function BatchManagementPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<Batch | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [viewMode, setViewMode] = useState<BatchViewMode>('stock');
  const [nearExpiryWindow, setNearExpiryWindow] = useState<number>(90);
  const [ageBucketFilter, setAgeBucketFilter] = useState<AgeBucketFilter>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const currentView = VIEW_OPTIONS.find((option) => option.key === viewMode) || VIEW_OPTIONS[0];

  const batchQuery = {
    status: statusFilter || undefined,
    page,
    pageSize,
    ...(viewMode === 'nearExpiry' ? { daysToExpiry: nearExpiryWindow } : {}),
    ...(viewMode === 'expired' ? { expiredOnly: true } : {}),
    ...(viewMode === 'ageing' && ageBucketFilter ? { ageBucket: ageBucketFilter } : {}),
  };

  // Queries
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['manufacturing', 'batches', viewMode, statusFilter, nearExpiryWindow, ageBucketFilter, page, pageSize],
    queryFn: () => batchService.getAll(batchQuery),
  });

  const { data: fefoData, isLoading: fefoLoading } = useQuery({
    queryKey: ['manufacturing', 'batches', 'fefo-queue'],
    queryFn: () => batchService.getAll({ page: 1, pageSize: 50 }),
    staleTime: 60_000,
  });

  // Fetch locations for dropdown
  const { data: locations = [] } = useQuery({
    queryKey: ['locations-list'],
    queryFn: () => dataService.getLocations(),
    staleTime: 60_000,
  });

  // Fetch UOMs for dropdown
  const { data: uomData } = useQuery({
    queryKey: ['uoms-list'],
    queryFn: () => uomService.getAll({ isActive: true, pageSize: 200 }),
    staleTime: 60_000,
  });
  const locationsData: any[] = Array.isArray(locations)
    ? locations
    : Array.isArray((locations as any)?.items)
      ? (locations as any).items
      : [];
  const uomList: { id: string; code: string; name: string }[] = Array.isArray(uomData?.items) ? uomData.items : Array.isArray(uomData) ? uomData : [];

  const items: Batch[] = Array.isArray(data?.items) ? data.items : [];
  const summary = data?.summary ?? EMPTY_SUMMARY;
  const missingExpiryCount = items.filter((batch) => !batch.expiryDate).length;
  const negativeAvailabilityCount = items.filter((batch) => Number(batch.availableQty) < 0).length;
  const fefoCandidates = (fefoData?.items ?? [])
    .filter((batch) => Number(batch.availableQty) > 0 && !!batch.expiryDate)
    .slice(0, 5);

  // Mutations
  const createMut = useMutation({
    mutationFn: (d: typeof emptyForm) => batchService.create({
      productId: d.productId,
      locationId: d.locationId,
      quantity: Number(d.quantity),
      uom: d.uom || 'EA',
      status: d.status || undefined,
      manufacturingDate: d.manufacturingDate || undefined,
      expiryDate: d.expiryDate || undefined,
      costPerUnit: d.costPerUnit ? Number(d.costPerUnit) : undefined,
      notes: d.notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'batches'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('Batch created');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to create batch'); },
  });

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => batchService.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'batches'] });
      toast.success('Batch status updated');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to update batch'); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => batchService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing', 'batches'] });
      toast.success('Batch deleted');
    },
    onError: (err: any) => { toast.error(err?.response?.data?.message || 'Failed to delete batch'); },
  });

  const columns: Column<Batch>[] = [
    {
      key: 'batchNumber',
      header: 'Batch',
      accessor: (row) => (
        <div className="space-y-1">
          <div className="font-semibold text-gray-900">{row.batchNumber}</div>
          <div className="text-xs text-secondary-500">Synced {safeFormat(row.updatedAt, 'MMM dd, yyyy')}</div>
        </div>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      accessor: (row) => (
        <div className="space-y-1">
          <div className="font-medium text-gray-900">{row.product?.name || row.productId}</div>
          <div className="text-xs text-secondary-500">{row.product?.code || row.productId}</div>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      accessor: (row) => (
        <div className="space-y-1">
          <div className="font-medium text-gray-900">{row.location?.name || row.locationId}</div>
          <div className="text-xs text-secondary-500">{row.location?.code || 'Primary location'}</div>
        </div>
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      accessor: (row) => (
        <div className="space-y-1">
          <div className={`font-medium ${Number(row.quantity) < 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {formatMetric(Number(row.quantity))} {row.uom}
          </div>
          <div className="text-xs text-secondary-500">Available {formatMetric(Number(row.availableQty))}</div>
        </div>
      ),
      align: 'right',
    },
    {
      key: 'ageing',
      header: 'Ageing',
      accessor: (row) => {
        const ageBucket = getAgeBucket(row.manufacturingDate);
        const ageDays = getAgeDays(row.manufacturingDate);
        const ageVariant = ageBucket === '>12m' ? 'warning' : ageBucket === 'unknown' ? 'secondary' : 'primary';

        return (
          <div className="space-y-1">
            <div className="text-sm text-gray-900">{safeFormat(row.manufacturingDate, 'MMM dd, yyyy')}</div>
            <div className="flex items-center gap-2">
              <Badge variant={ageVariant} size="sm">
                {ageBucket === 'unknown' ? 'Unknown age' : AGE_BUCKETS.find((bucket) => bucket.key === ageBucket)?.label || ageBucket}
              </Badge>
              {ageDays != null && <span className="text-xs text-secondary-500">{ageDays}d old</span>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'expiryDate',
      header: 'Expiry',
      accessor: (row) => {
        const expiryBadge = getExpiryBadge(row.expiryDate);

        return (
          <div className="space-y-1">
            <div className="text-sm text-gray-900">{safeFormat(row.expiryDate, 'MMM dd, yyyy')}</div>
            <Badge variant={expiryBadge.variant} size="sm">{expiryBadge.label}</Badge>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => (
        <Badge variant={statusVariant[row.status] || 'secondary'} size="sm">{formatLabel(row.status)}</Badge>
      ),
      align: 'center',
    },
    {
      key: 'value',
      header: 'Value',
      accessor: (row) => {
        const totalValue = Number(row.quantity || 0) * Number(row.costPerUnit || 0);

        return (
          <div className="space-y-1 text-right">
            <div className="font-medium text-gray-900">{row.costPerUnit != null ? formatMetric(totalValue) : '—'}</div>
            <div className="text-xs text-secondary-500">
              {row.costPerUnit != null ? `${formatMetric(Number(row.costPerUnit))}/${row.uom}` : 'No unit cost'}
            </div>
          </div>
        );
      },
      align: 'right',
    },
    {
      key: 'actions', header: 'Actions',
      accessor: (row) => (
        <div className="flex gap-1">
          <button onClick={() => { setSelected(row); setShowDetail(true); }} className="p-1 text-blue-600 hover:text-blue-800"><EyeIcon className="h-4 w-4" /></button>
          <button onClick={() => { if (confirm('Delete this batch?')) deleteMut.mutate(row.id); }} className="p-1 text-red-600 hover:text-red-800"><TrashIcon className="h-4 w-4" /></button>
        </div>
      ),
      align: 'center',
    },
  ];

  const metricCards = [
    {
      label: 'Tracked batches',
      value: summary.totalBatches,
      detail: `${formatMetric(summary.totalQty)} total units`,
    },
    {
      label: 'Available stock',
      value: formatMetric(summary.totalAvailableQty),
      detail: 'Free quantity after holds and consumption',
    },
    {
      label: 'Inventory value',
      value: formatMetric(summary.totalValue),
      detail: 'Quantity x cost across filtered batches',
    },
    {
      label: 'Near-expiry 30d',
      value: formatMetric(summary.nearExpiry30Qty),
      detail: `${formatMetric(summary.nearExpiry30Value)} at risk`,
    },
    {
      label: 'Near-expiry 90d',
      value: formatMetric(summary.nearExpiry90Qty),
      detail: `${formatMetric(summary.nearExpiry90Value)} in pipeline`,
    },
    {
      label: 'Expired qty',
      value: formatMetric(summary.expiredQty),
      detail: `${formatMetric(summary.expiredValue)} blocked value`,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-amber-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-white">
              Phase 1
              <span className="rounded-full bg-white/20 px-2 py-0.5 tracking-normal">Batch intelligence</span>
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Batch-wise stock, expiry, and ageing</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Monitor live Marg-backed batches by stock position, near-expiry risk, expired lots, and manufacturing age so operations can prioritize rotation and disposition.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => refetch()} leftIcon={<ArrowPathIcon className="h-4 w-4" />} isLoading={isFetching}>
              Refresh
            </Button>
            <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} leftIcon={<PlusIcon className="h-4 w-4" />}>
              New Batch
            </Button>
          </div>
        </div>
      </section>

      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}

      {(missingExpiryCount > 0 || negativeAvailabilityCount > 0) && (
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 text-amber-600" />
              <div>
                <h2 className="text-sm font-semibold text-amber-900">Data watchlist</h2>
                <p className="mt-1 text-sm text-amber-800">
                  {missingExpiryCount > 0 ? `${missingExpiryCount} batches are missing expiry dates. ` : ''}
                  {negativeAvailabilityCount > 0 ? `${negativeAvailabilityCount} batches currently show negative available stock.` : ''}
                </p>
              </div>
            </div>
            <div className="text-xs text-amber-700">Live quantities reflect current Marg sync, including reversals and corrections.</div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metricCards.map((card) => (
          <Card key={card.label} className="overflow-hidden">
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-500">{card.label}</div>
              <div className="text-3xl font-semibold tracking-tight text-slate-900">{card.value}</div>
              <div className="text-sm text-slate-500">{card.detail}</div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden bg-slate-950 text-white">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">
              Phase 2 starter
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">FEFO queue</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Earliest-expiry lots to consume first using the live batch pool. Supplier-wise and procurement analytics are still blocked because the current Marg party payload does not yet carry usable supplier master data.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Ready now</div>
            <div className="mt-2 text-3xl font-semibold">{fefoCandidates.length}</div>
            <div className="text-xs text-slate-400">Available batches with expiry dates</div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {fefoLoading && Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
              <div className="mt-4 h-6 w-32 animate-pulse rounded bg-white/10" />
              <div className="mt-3 h-4 w-24 animate-pulse rounded bg-white/10" />
            </div>
          ))}

          {!fefoLoading && fefoCandidates.map((batch, index) => (
            <div key={batch.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Priority {index + 1}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{batch.batchNumber}</div>
                </div>
                <Badge variant={getExpiryBadge(batch.expiryDate).variant} size="sm">{getExpiryBadge(batch.expiryDate).label}</Badge>
              </div>
              <div className="mt-4 space-y-2 text-sm text-slate-300">
                <div className="font-medium text-white">{batch.product?.name || batch.productId}</div>
                <div>{formatMetric(Number(batch.availableQty))} {batch.uom} available</div>
                <div>Expiry {safeFormat(batch.expiryDate, 'MMM dd, yyyy')}</div>
                <div>Location {batch.location?.name || batch.locationId}</div>
              </div>
            </div>
          ))}

          {!fefoLoading && fefoCandidates.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-5 text-sm text-slate-300 md:col-span-2 xl:col-span-5">
              No FEFO candidates are currently available. Lots need both available quantity and expiry dates before the FEFO queue can rank them.
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="space-y-5">
          <div className="grid gap-3 xl:grid-cols-4">
            {VIEW_OPTIONS.map((view) => {
              const Icon = view.icon;
              const isActive = view.key === viewMode;

              return (
                <button
                  key={view.key}
                  type="button"
                  onClick={() => {
                    setViewMode(view.key);
                    setPage(1);
                  }}
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    isActive
                      ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                      : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-xl p-2 ${isActive ? 'bg-white/10' : 'bg-slate-100'}`}>
                      <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-slate-700'}`} />
                    </div>
                    <div className="text-sm font-semibold">{view.label}</div>
                  </div>
                  <p className={`mt-3 text-sm leading-6 ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>{view.description}</p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {BATCH_STATUSES.map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}
              </select>

              {viewMode === 'nearExpiry' && (
                <div className="flex flex-wrap gap-2">
                  {NEAR_EXPIRY_WINDOWS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => {
                        setNearExpiryWindow(days);
                        setPage(1);
                      }}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        nearExpiryWindow === days
                          ? 'bg-amber-500 text-white'
                          : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                      }`}
                    >
                      {days} days
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="text-sm text-slate-500">
              {data?.total ?? 0} rows in {currentView.label.toLowerCase()}
            </div>
          </div>

          {viewMode === 'ageing' && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {AGE_BUCKETS.map((bucket) => {
                const isActive = ageBucketFilter === bucket.key;
                const bucketValue = bucket.key ? summary.ageBuckets[bucket.key] : summary.totalQty;

                return (
                  <button
                    key={bucket.label}
                    type="button"
                    onClick={() => {
                      setAgeBucketFilter(bucket.key);
                      setPage(1);
                    }}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      isActive
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">{bucket.label}</div>
                    <div className="mt-2 text-2xl font-semibold">{formatMetric(bucketValue)}</div>
                    <div className={`mt-1 text-sm ${isActive ? 'text-blue-50' : 'text-slate-500'}`}>{bucket.description}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title={currentView.tableTitle} description={currentView.tableDescription} />
        <DataTable
          data={items}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={`No batches found for the ${currentView.label.toLowerCase()} view`}
          pagination={{
            page,
            pageSize,
            total: data?.total ?? 0,
            onPageChange: (nextPage) => setPage(nextPage),
            onPageSizeChange: (nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            },
          }}
        />
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Batch" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
              <ProductSelector value={form.productId || undefined} onChange={(id) => setForm({ ...form, productId: id })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location *</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                <option value="">Select location...</option>
                {locationsData.map((loc: any) => (
                  <option key={loc.id} value={loc.id}>{loc.name || loc.code || loc.id}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
              <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">UOM *</label>
              <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })}>
                <option value="">Select UOM...</option>
                {uomList.map((u: any) => (
                  <option key={u.id} value={u.code}>{u.code} — {u.name}</option>
                ))}
                {uomList.length === 0 && <option value="EA">EA — Each</option>}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost per Unit</label>
              <input type="number" step="0.01" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: +e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manufacturing Date</label>
              <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.manufacturingDate} onChange={(e) => setForm({ ...form, manufacturingDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
              <input type="date" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate(form)} isLoading={createMut.isPending} disabled={!form.productId || !form.locationId || form.quantity <= 0}>Create</Button>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setSelected(null); }} title={selected ? `Batch ${selected.batchNumber}` : 'Batch Detail'} size="lg">
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Product:</span> {selected.product?.name || selected.productId}</div>
              <div><span className="font-medium text-gray-500">Location:</span> {selected.location?.name || selected.locationId}</div>
              <div><span className="font-medium text-gray-500">Status:</span> <Badge variant={statusVariant[selected.status] || 'secondary'} size="sm">{formatLabel(selected.status)}</Badge></div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Quantity:</span> {Number(selected.quantity).toLocaleString()} {selected.uom}</div>
              <div><span className="font-medium text-gray-500">Available:</span> {Number(selected.availableQty).toLocaleString()} {selected.uom}</div>
              <div><span className="font-medium text-gray-500">Cost/Unit:</span> {selected.costPerUnit != null ? `$${Number(selected.costPerUnit).toFixed(2)}` : '—'}</div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Mfg Date:</span> {safeFormat(selected.manufacturingDate, 'MMM dd, yyyy')}</div>
              <div><span className="font-medium text-gray-500">Expiry Date:</span> {safeFormat(selected.expiryDate, 'MMM dd, yyyy')}</div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Batch Age:</span> {getAgeDays(selected.manufacturingDate) != null ? `${getAgeDays(selected.manufacturingDate)} days` : 'Unknown'}</div>
              <div><span className="font-medium text-gray-500">Expiry Horizon:</span> {getExpiryBadge(selected.expiryDate).label}</div>
            </div>
            {selected.notes && (
              <div className="text-sm"><span className="font-medium text-gray-500">Notes:</span> {selected.notes}</div>
            )}
            <div className="border-t pt-4 mt-4">
              <h3 className="text-sm font-semibold mb-2">Change Status</h3>
              <div className="flex gap-2 flex-wrap">
                {BATCH_STATUSES.filter(s => s !== selected.status).map(s => (
                  <Button key={s} variant="secondary" size="sm" onClick={() => {
                    updateStatusMut.mutate({ id: selected.id, status: s });
                    setSelected({ ...selected, status: s });
                  }}>{formatLabel(s)}</Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
