import type { Dimension } from '@/types';
import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, QueryErrorBanner } from '@components/ui';
import {
    ArrowPathIcon,
    ArrowTrendingDownIcon,
    ArrowTrendingUpIcon,
    BanknotesIcon,
    CalendarDaysIcon,
    ChartBarIcon,
    CubeIcon,
    ExclamationTriangleIcon,
    LockClosedIcon,
    LockOpenIcon,
} from '@heroicons/react/24/outline';
import { costingEngineService, dataService, fiscalCalendarService } from '@services/api';
import type {
    CostLayer,
    CostVariance,
    InventoryValuationItem,
    RevaluationHistory
} from '@services/api/costing-engine.service';
import type { FiscalPeriod } from '@services/api/fiscal-calendar.service';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { useSettings } from '../../hooks/useSettings';
import { useAuthStore } from '../../stores/auth.store';

// ─── Constants ────────────────────────────────────────────────────────
const FINANCIAL_DECIMALS = 4;
const QTY_DECIMALS = 0;
const DEFAULT_PAGE_SIZE = 50;

const COST_MUTATION_ROLES = ['ADMIN', 'PLANNER', 'FINANCE'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────
const fmt = (v?: number | null, decimals = FINANCIAL_DECIMALS) =>
  v != null ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—';
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : '—');

/** Currency-aware formatter — never hardcode $ */
const fmtCurrency = (v?: number | null, currency?: string, decimals = FINANCIAL_DECIMALS) => {
  if (v == null) return '—';
  try {
    return v.toLocaleString(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    // Fallback for unknown currency codes
    return `${currency || 'USD'} ${fmt(v, decimals)}`;
  }
};

const statusVariant: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'secondary'> = {
  OPEN: 'success',
  DEPLETED: 'secondary',
  FROZEN: 'warning',
  DRAFT: 'default',
  POSTED: 'primary',
  REVERSED: 'error',
  CLOSING: 'warning',
  CLOSED: 'error',
  REOPENED: 'primary',
};

const favorabilityColor: Record<string, string> = {
  FAVORABLE: 'text-green-600',
  UNFAVORABLE: 'text-red-600',
  NEUTRAL: 'text-gray-500',
};

// ─── Auth Gate Hook ───────────────────────────────────────────────────
function useCanMutateCosts(): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  return COST_MUTATION_ROLES.includes(user.role as any);
}

// ─── Confirmation Dialog Component ────────────────────────────────────
function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  isLoading = false,
  variant = 'primary',
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  isLoading?: boolean;
  variant?: 'primary' | 'error';
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="flex items-start gap-3 mb-6">
        <ExclamationTriangleIcon className={`h-6 w-6 flex-shrink-0 ${variant === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
        <p className="text-sm text-gray-600">{message}</p>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>Cancel</Button>
        <Button
          variant={variant === 'error' ? 'danger' : 'primary'}
          onClick={onConfirm}
          isLoading={isLoading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ─── Tab Types ────────────────────────────────────────────────────────
type Tab = 'valuation' | 'layers' | 'variances' | 'revaluation' | 'period-close' | 'profiles';

export default function CostingEnginePage() {
  const [activeTab, setActiveTab] = useState<Tab>('valuation');

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'valuation', label: 'Inventory Valuation', icon: BanknotesIcon },
    { key: 'layers', label: 'Cost Layers', icon: CubeIcon },
    { key: 'variances', label: 'Variances', icon: ChartBarIcon },
    { key: 'revaluation', label: 'Revaluation', icon: ArrowPathIcon },
    { key: 'period-close', label: 'Period Close', icon: CalendarDaysIcon },
    { key: 'profiles', label: 'Cost Profiles', icon: CubeIcon },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Costing Engine</h1>
        <p className="text-secondary-500 mt-1">Enterprise inventory costing, valuation, and period management</p>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium transition-colors ${
                activeTab === key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'valuation' && <InventoryValuationTab />}
      {activeTab === 'layers' && <CostLayersTab />}
      {activeTab === 'variances' && <VariancesTab />}
      {activeTab === 'revaluation' && <RevaluationTab />}
      {activeTab === 'period-close' && <PeriodCloseTab />}
      {activeTab === 'profiles' && <CostProfilesTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// INVENTORY VALUATION TAB
// ═══════════════════════════════════════════════════════════════════════
function InventoryValuationTab() {
  const { data: settings } = useSettings();
  const currency = settings?.defaultCurrency || 'USD';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['costing-engine', 'inventory-valuation'],
    queryFn: () => costingEngineService.getInventoryValuation(),
  });

  const columns: Column<InventoryValuationItem>[] = [
    { key: 'product', header: 'Product', accessor: (r) => `${r.productCode} — ${r.productName}` },
    { key: 'location', header: 'Location', accessor: (r) => r.locationCode },
    { key: 'method', header: 'Method', accessor: (r) => <Badge variant="primary" size="sm">{r.costingMethod}</Badge> },
    { key: 'qty', header: 'On Hand', accessor: (r) => fmt(r.onHandQty, QTY_DECIMALS), align: 'right' },
    { key: 'unitCost', header: 'Unit Cost', accessor: (r) => fmtCurrency(r.unitCost, currency), align: 'right' },
    { key: 'stdCost', header: 'Std Cost', accessor: (r) => fmtCurrency(r.standardCost, currency), align: 'right' },
    {
      key: 'totalValue', header: 'Total Value',
      accessor: (r) => <span className="font-semibold">{fmtCurrency(r.totalValue, currency)}</span>,
      align: 'right',
    },
  ];

  return (
    <>
      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card>
          <div className="p-4">
            <p className="text-sm text-gray-500">Total Inventory Value</p>
            <p className="text-2xl font-bold">{fmtCurrency(data?.totalValuation, currency, 2)}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-sm text-gray-500">Unique Items</p>
            <p className="text-2xl font-bold">{data?.itemCount ?? 0}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-sm text-gray-500">Avg Unit Value</p>
            <p className="text-2xl font-bold">
              {/*
                Server should provide avgUnitValue; fallback to client division only as safety net.
                Division by zero is guarded.
              */}
              {data?.itemCount && data.itemCount > 0
                ? fmtCurrency(data.totalValuation / data.itemCount, currency, 2)
                : '—'}
            </p>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Inventory Valuation" description="Current inventory value by product and location" />
        <DataTable data={data?.items ?? []} columns={columns} keyExtractor={(r) => `${r.productId}-${r.locationId}`} isLoading={isLoading} emptyMessage="No inventory on hand" />
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COST LAYERS TAB
// ═══════════════════════════════════════════════════════════════════════
function CostLayersTab() {
  const { data: settings } = useSettings();
  const currency = settings?.defaultCurrency || 'USD';
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = DEFAULT_PAGE_SIZE;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['costing-engine', 'cost-layers', statusFilter, page],
    queryFn: () => costingEngineService.getCostLayers({
      status: statusFilter || undefined,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    placeholderData: keepPreviousData,
  });

  const totalPages = data?.total ? Math.ceil(data.total / pageSize) : 1;

  const columns: Column<CostLayer>[] = [
    { key: 'date', header: 'Layer Date', accessor: (r) => fmtDate(r.layerDate) },
    { key: 'method', header: 'Method', accessor: (r) => <Badge variant="primary" size="sm">{r.costingMethod}</Badge> },
    { key: 'ref', header: 'Reference', accessor: (r) => `${r.referenceType} — ${r.referenceNumber || r.referenceId.slice(0, 8)}` },
    { key: 'origQty', header: 'Original Qty', accessor: (r) => fmt(r.originalQty, QTY_DECIMALS), align: 'right' },
    { key: 'remQty', header: 'Remaining', accessor: (r) => fmt(r.remainingQty, QTY_DECIMALS), align: 'right' },
    { key: 'unitCost', header: 'Unit Cost', accessor: (r) => fmtCurrency(r.unitCost, currency), align: 'right' },
    { key: 'landedCost', header: 'Landed', accessor: (r) => r.landedCost ? fmtCurrency(r.landedCost, currency) : '—', align: 'right' },
    { key: 'totalCost', header: 'Total Cost', accessor: (r) => <span className="font-semibold">{fmtCurrency(r.totalCost, currency)}</span>, align: 'right' },
    { key: 'status', header: 'Status', accessor: (r) => <Badge variant={statusVariant[r.status] || 'default'} size="sm">{r.status}</Badge> },
  ];

  return (
    <>
      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}
      <div className="flex gap-2 mb-4">
        {['', 'OPEN', 'DEPLETED', 'FROZEN'].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              statusFilter === s ? 'bg-primary-100 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
        <span className="ml-auto text-sm text-gray-500">{data?.total ?? 0} layers</span>
      </div>
      <Card>
        <CardHeader title="Cost Layers" description="FIFO/LIFO cost layers for receipt-level tracking" />
        <DataTable data={data?.items ?? []} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No cost layers" />
        {/* Pagination */}
        <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// VARIANCES TAB
// ═══════════════════════════════════════════════════════════════════════
function VariancesTab() {
  const { data: settings } = useSettings();
  const currency = settings?.defaultCurrency || 'USD';
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = DEFAULT_PAGE_SIZE;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['costing-engine', 'variances', typeFilter, page],
    queryFn: () => costingEngineService.getCostVariances({
      varianceType: typeFilter || undefined,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    placeholderData: keepPreviousData,
  });

  const totalPages = data?.total ? Math.ceil(data.total / pageSize) : 1;

  const columns: Column<CostVariance>[] = [
    { key: 'type', header: 'Variance Type', accessor: (r) => <Badge variant="secondary" size="sm">{r.varianceType.replace(/_/g, ' ')}</Badge> },
    { key: 'ref', header: 'Reference', accessor: (r) => `${r.referenceType} ${r.referenceId.slice(0, 8)}` },
    { key: 'std', header: 'Standard', accessor: (r) => fmtCurrency(r.standardAmount, currency), align: 'right' },
    { key: 'actual', header: 'Actual', accessor: (r) => fmtCurrency(r.actualAmount, currency), align: 'right' },
    {
      key: 'variance', header: 'Variance',
      accessor: (r) => (
        <span className={`font-semibold ${r.varianceAmount < 0 ? 'text-green-600' : r.varianceAmount > 0 ? 'text-red-600' : ''}`}>
          {fmtCurrency(r.varianceAmount, currency)}
        </span>
      ),
      align: 'right',
    },
    { key: 'pct', header: '%', accessor: (r) => r.variancePct ? `${fmt(r.variancePct, 1)}%` : '—', align: 'right' },
    {
      key: 'favorability', header: 'Favorability',
      accessor: (r) => (
        <span className={`flex items-center gap-1 ${favorabilityColor[r.favorability ?? ''] ?? ''}`}>
          {r.favorability === 'FAVORABLE' && <ArrowTrendingDownIcon className="h-4 w-4" />}
          {r.favorability === 'UNFAVORABLE' && <ArrowTrendingUpIcon className="h-4 w-4" />}
          {r.favorability ?? '—'}
        </span>
      ),
    },
    { key: 'date', header: 'Date', accessor: (r) => fmtDate(r.createdAt) },
  ];

  const types = ['', 'MATERIAL_USAGE', 'LABOR', 'OVERHEAD', 'TOTAL_PRODUCTION'];

  return (
    <>
      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}
      <div className="flex gap-2 mb-4">
        {types.map((t) => (
          <button
            key={t}
            onClick={() => { setTypeFilter(t); setPage(1); }}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              typeFilter === t ? 'bg-primary-100 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t ? t.replace(/_/g, ' ') : 'All'}
          </button>
        ))}
        <span className="ml-auto text-sm text-gray-500">{data?.total ?? 0} variances</span>
      </div>
      <Card>
        <CardHeader title="Cost Variances" description="Standard vs. Actual variance analysis" />
        <DataTable data={data?.items ?? []} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No variances recorded" />
        <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// REVALUATION TAB
// ═══════════════════════════════════════════════════════════════════════
function RevaluationTab() {
  const { data: settings } = useSettings();
  const currency = settings?.defaultCurrency || 'USD';
  const queryClient = useQueryClient();
  const canMutate = useCanMutateCosts();
  const [showRevalue, setShowRevalue] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [form, setForm] = useState({ productId: '', locationId: '', newUnitCost: 0, reason: '' });
  const [page, setPage] = useState(1);
  const pageSize = DEFAULT_PAGE_SIZE;

  const { data: productsRaw } = useQuery({ queryKey: ['dimensions', 'product'], queryFn: () => dataService.getProducts() });
  const { data: locationsRaw } = useQuery({ queryKey: ['dimensions', 'location'], queryFn: () => dataService.getLocations() });
  const productOptions: Dimension[] = Array.isArray(productsRaw) ? productsRaw : [];
  const locationOptions: Dimension[] = Array.isArray(locationsRaw) ? locationsRaw : [];

  const { data: history, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['costing-engine', 'revaluation-history', page],
    queryFn: () => costingEngineService.getRevaluationHistory({
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    placeholderData: keepPreviousData,
  });

  const totalPages = history?.total ? Math.ceil(history.total / pageSize) : 1;

  const revalueMut = useMutation({
    mutationFn: () => costingEngineService.revalueInventory({
      productId: form.productId,
      locationId: form.locationId,
      newUnitCost: form.newUnitCost,
      reason: form.reason,
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['costing-engine'] });
      setShowRevalue(false);
      setShowConfirm(false);
      setForm({ productId: '', locationId: '', newUnitCost: 0, reason: '' });
      toast.success(`Revaluation ${result.revaluationNumber} posted: ${fmtCurrency(result.revaluationAmount, currency)}`);
    },
    onError: (err: any) => {
      setShowConfirm(false);
      toast.error(err?.response?.data?.message || 'Revaluation failed');
    },
  });

  const handleRevalueSubmit = useCallback(() => {
    setShowRevalue(false);
    setShowConfirm(true);
  }, []);

  const columns: Column<RevaluationHistory>[] = [
    { key: 'number', header: 'Reval #', accessor: (r) => r.revaluationNumber },
    { key: 'type', header: 'Type', accessor: (r) => r.revaluationType },
    { key: 'product', header: 'Product', accessor: (r) => r.productId.slice(0, 8) },
    { key: 'oldCost', header: 'Old Cost', accessor: (r) => fmtCurrency(r.oldUnitCost, currency), align: 'right' },
    { key: 'newCost', header: 'New Cost', accessor: (r) => fmtCurrency(r.newUnitCost, currency), align: 'right' },
    { key: 'qty', header: 'Affected Qty', accessor: (r) => fmt(r.affectedQty, QTY_DECIMALS), align: 'right' },
    {
      key: 'amount', header: 'Reval Amount',
      accessor: (r) => (
        <span className={`font-semibold ${r.revaluationAmount < 0 ? 'text-red-600' : 'text-green-600'}`}>
          {fmtCurrency(r.revaluationAmount, currency)}
        </span>
      ),
      align: 'right',
    },
    { key: 'status', header: 'Status', accessor: (r) => <Badge variant={statusVariant[r.status] || 'default'} size="sm">{r.status}</Badge> },
    { key: 'date', header: 'Date', accessor: (r) => fmtDate(r.performedAt) },
  ];

  return (
    <>
      {isError && <QueryErrorBanner error={error} onRetry={() => refetch()} />}
      <div className="flex justify-end mb-4">
        {canMutate ? (
          <Button onClick={() => setShowRevalue(true)} leftIcon={<ArrowPathIcon className="h-4 w-4" />}>New Revaluation</Button>
        ) : (
          <span className="text-sm text-gray-400 italic">Insufficient permissions for revaluation</span>
        )}
      </div>
      <Card>
        <CardHeader title="Revaluation History" description="Inventory cost adjustments and revaluations" />
        <DataTable data={history?.items ?? []} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No revaluations" />
        <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      {/* Form Modal */}
      <Modal isOpen={showRevalue} onClose={() => setShowRevalue(false)} title="Revalue Inventory" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
            <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
              <option value="">— Select a product —</option>
              {productOptions.map((p) => <option key={p.id} value={p.id}>{p.name || p.code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location *</label>
            <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
              <option value="">— Select a location —</option>
              {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name || l.code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Unit Cost ({currency}) *</label>
            <input type="number" step="0.0001" min="0.0001" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.newUnitCost} onChange={(e) => setForm({ ...form, newUnitCost: +e.target.value })} />
            {form.newUnitCost <= 0 && <p className="text-xs text-red-500 mt-1">Unit cost must be greater than zero</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
            <textarea className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for revaluation" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowRevalue(false)}>Cancel</Button>
          <Button onClick={handleRevalueSubmit} disabled={!form.productId || !form.locationId || !form.reason || form.newUnitCost <= 0}>Review & Confirm</Button>
        </div>
      </Modal>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setShowRevalue(true); }}
        onConfirm={() => revalueMut.mutate()}
        title="Confirm Revaluation"
        message={`This will revalue inventory for product ${form.productId.slice(0, 12)}... to ${fmtCurrency(form.newUnitCost, currency)}. This writes a GL journal entry and cannot be easily undone. Proceed?`}
        confirmLabel="Post Revaluation"
        isLoading={revalueMut.isPending}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PERIOD CLOSE TAB
// ═══════════════════════════════════════════════════════════════════════
function PeriodCloseTab() {
  const { data: settings } = useSettings();
  const currency = settings?.defaultCurrency || 'USD';
  const queryClient = useQueryClient();
  const canMutate = useCanMutateCosts();
  const [fiscalPeriodId, setFiscalPeriodId] = useState('');

  const { data: activeCalendar } = useQuery({
    queryKey: ['fiscal-calendar', 'active'],
    queryFn: () => fiscalCalendarService.getActiveCalendar(),
  });
  const { data: periodsData } = useQuery({
    queryKey: ['fiscal-calendar', 'periods', activeCalendar?.id],
    queryFn: () => fiscalCalendarService.getPeriods(activeCalendar!.id),
    enabled: !!activeCalendar?.id,
  });
  const periodOptions: FiscalPeriod[] = Array.isArray(periodsData?.items) ? periodsData.items : Array.isArray(periodsData) ? periodsData : [];
  const [confirmAction, setConfirmAction] = useState<'snapshot' | 'close' | null>(null);

  const { data: checkpoint, refetch, isError: isPeriodError, error: periodError } = useQuery({
    queryKey: ['costing-engine', 'period-close', fiscalPeriodId],
    queryFn: () => costingEngineService.getPeriodCloseStatus(fiscalPeriodId),
    enabled: !!fiscalPeriodId,
  });

  const snapshotMut = useMutation({
    mutationFn: () => costingEngineService.snapshotPeriodValuation(fiscalPeriodId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['costing-engine'] });
      setConfirmAction(null);
      toast.success(`Snapshot complete. Valuation: ${fmtCurrency(result.inventoryValuationTotal, currency, 2)}. ${result.isReconciled ? 'GL reconciled' : `GL discrepancy: ${fmtCurrency(result.discrepancy, currency, 2)}`}`);
    },
    onError: (err: any) => { setConfirmAction(null); toast.error(err?.response?.data?.message || 'Snapshot failed'); },
  });

  const closeMut = useMutation({
    mutationFn: () => costingEngineService.closePeriod(fiscalPeriodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['costing-engine'] });
      setConfirmAction(null);
      toast.success('Period closed successfully');
    },
    onError: (err: any) => { setConfirmAction(null); toast.error(err?.response?.data?.message || 'Close failed'); },
  });

  const [reopenReason, setReopenReason] = useState('');
  const [showReopen, setShowReopen] = useState(false);
  const reopenMut = useMutation({
    mutationFn: () => costingEngineService.reopenPeriod(fiscalPeriodId, reopenReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['costing-engine'] });
      setShowReopen(false);
      toast.success('Period reopened');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Reopen failed'),
  });

  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Fiscal Period</label>
          <select
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            value={fiscalPeriodId}
            onChange={(e) => setFiscalPeriodId(e.target.value)}
          >
            <option value="">— Select a fiscal period —</option>
            {periodOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.periodName} ({new Date(p.startDate).toLocaleDateString()} – {new Date(p.endDate).toLocaleDateString()})
              </option>
            ))}
          </select>
          {!activeCalendar && <p className="text-xs text-amber-600 mt-1">No active fiscal calendar configured.</p>}
        </div>
        <Button onClick={() => refetch()} disabled={!fiscalPeriodId}>Load Status</Button>
      </div>

      {isPeriodError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-700">
            Failed to load period status: {(periodError as any)?.response?.data?.message || (periodError as Error)?.message || 'Unknown error'}
          </p>
        </div>
      )}

      {checkpoint && (
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Period Close Status</h3>
              <Badge variant={statusVariant[checkpoint.status] || 'default'} size="lg">{checkpoint.status}</Badge>
            </div>

            <div className="grid grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-500">Inventory Valuation</p>
                <p className="text-xl font-bold">{fmtCurrency(checkpoint.inventoryValuationTotal, currency, 2)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">GL Inventory Total</p>
                <p className="text-xl font-bold">{fmtCurrency(checkpoint.glInventoryTotal, currency, 2)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Discrepancy</p>
                <p className={`text-xl font-bold ${(checkpoint.discrepancy ?? 0) !== 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmtCurrency(checkpoint.discrepancy, currency, 2)}
                </p>
              </div>
            </div>

            {checkpoint.varianceSummary && Object.keys(checkpoint.varianceSummary).length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Variance Summary</p>
                <div className="grid grid-cols-4 gap-3">
                  {Object.entries(checkpoint.varianceSummary).map(([type, amount]) => (
                    <div key={type} className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-xs text-gray-500">{type.replace(/_/g, ' ')}</p>
                      <p className={`font-semibold ${(amount as number) < 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmtCurrency(amount as number, currency, 2)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canMutate ? (
              <div className="flex gap-3 pt-4 border-t">
                {(!checkpoint.status || checkpoint.status === 'OPEN' || checkpoint.status === 'REOPENED') && (
                  <Button onClick={() => setConfirmAction('snapshot')} isLoading={snapshotMut.isPending} leftIcon={<ChartBarIcon className="h-4 w-4" />}>
                    Run Valuation Snapshot
                  </Button>
                )}
                {checkpoint.status === 'CLOSING' && (
                  <Button onClick={() => setConfirmAction('close')} isLoading={closeMut.isPending} leftIcon={<LockClosedIcon className="h-4 w-4" />} variant="primary">
                    Close Period
                  </Button>
                )}
                {checkpoint.status === 'CLOSED' && (
                  <Button onClick={() => setShowReopen(true)} leftIcon={<LockOpenIcon className="h-4 w-4" />} variant="secondary">
                    Reopen Period
                  </Button>
                )}
              </div>
            ) : (
              <div className="pt-4 border-t">
                <span className="text-sm text-gray-400 italic">Insufficient permissions for period management</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Snapshot Confirmation */}
      <ConfirmDialog
        isOpen={confirmAction === 'snapshot'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => snapshotMut.mutate()}
        title="Confirm Valuation Snapshot"
        message="This will capture the current inventory valuation and compare it against the GL. This snapshot is used for period-end reconciliation. Proceed?"
        confirmLabel="Run Snapshot"
        isLoading={snapshotMut.isPending}
      />

      {/* Close Period Confirmation */}
      <ConfirmDialog
        isOpen={confirmAction === 'close'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => closeMut.mutate()}
        title="Confirm Period Close"
        message="Closing this fiscal period will prevent any further cost transactions from being posted against it. This action can only be reversed by an administrator reopening the period. Proceed?"
        confirmLabel="Close Period"
        isLoading={closeMut.isPending}
        variant="error"
      />

      {/* Reopen Dialog */}
      <Modal isOpen={showReopen} onClose={() => setShowReopen(false)} title="Reopen Fiscal Period" size="sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="h-6 w-6 flex-shrink-0 text-amber-500" />
            <p className="text-sm text-gray-600">Reopening a closed period will allow new transactions. This should only be done for corrections and requires audit justification.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
            <textarea className="w-full rounded-md border-gray-300 shadow-sm" rows={3} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowReopen(false)}>Cancel</Button>
          <Button onClick={() => reopenMut.mutate()} isLoading={reopenMut.isPending} disabled={!reopenReason}>Reopen</Button>
        </div>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COST PROFILES TAB
// ═══════════════════════════════════════════════════════════════════════
function CostProfilesTab() {
  const { data: settings } = useSettings();
  const currency = settings?.defaultCurrency || 'USD';
  const queryClient = useQueryClient();
  const canMutate = useCanMutateCosts();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    productId: '',
    locationId: '',
    costingMethod: 'STANDARD',
    standardCostVersion: '',
    enableLandedCost: false,
    overheadRate: 0,
    laborRate: 0,
  });

  const { data: productsRaw } = useQuery({ queryKey: ['dimensions', 'product'], queryFn: () => dataService.getProducts() });
  const { data: locationsRaw } = useQuery({ queryKey: ['dimensions', 'location'], queryFn: () => dataService.getLocations() });
  const productOptions: Dimension[] = Array.isArray(productsRaw) ? productsRaw : [];
  const locationOptions: Dimension[] = Array.isArray(locationsRaw) ? locationsRaw : [];

  const { data: profiles, isLoading, isError: isProfileError, error: profileError } = useQuery({
    queryKey: ['costing-engine', 'cost-profiles'],
    queryFn: () => costingEngineService.getCostProfiles(),
  });

  const upsertMut = useMutation({
    mutationFn: () => costingEngineService.upsertCostProfile({
      productId: form.productId,
      locationId: form.locationId || undefined,
      costingMethod: form.costingMethod,
      standardCostVersion: form.standardCostVersion || undefined,
      enableLandedCost: form.enableLandedCost,
      overheadRate: form.overheadRate || undefined,
      laborRate: form.laborRate || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['costing-engine', 'cost-profiles'] });
      setShowCreate(false);
      toast.success('Cost profile saved');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to save profile'),
  });

  const methodVariant: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'secondary'> = {
    STANDARD: 'primary',
    MOVING_AVERAGE: 'success',
    FIFO: 'warning',
    LIFO: 'secondary',
    ACTUAL_JOB_COSTING: 'error',
  };

  const columns: Column<any>[] = [
    { key: 'product', header: 'Product', accessor: (r) => r.productId.slice(0, 12) },
    { key: 'location', header: 'Location', accessor: (r) => r.locationId || 'All' },
    { key: 'method', header: 'Method', accessor: (r) => <Badge variant={methodVariant[r.costingMethod] || 'default'} size="sm">{r.costingMethod.replace(/_/g, ' ')}</Badge> },
    { key: 'landed', header: 'Landed Cost', accessor: (r) => r.enableLandedCost ? <Badge variant="success" size="sm">ON</Badge> : <Badge variant="secondary" size="sm">OFF</Badge> },
    { key: 'overhead', header: 'Overhead Rate', accessor: (r) => r.overheadRate ? `${fmt(r.overheadRate, 2)}%` : '—' },
    { key: 'labor', header: 'Labor Rate', accessor: (r) => r.laborRate ? fmtCurrency(r.laborRate, currency, 2) + '/hr' : '—' },
  ];

  return (
    <>
      <div className="flex justify-end mb-4">
        {canMutate ? (
          <Button onClick={() => setShowCreate(true)}>Add/Update Cost Profile</Button>
        ) : (
          <span className="text-sm text-gray-400 italic">Insufficient permissions to manage cost profiles</span>
        )}
      </div>
      {isProfileError && (
        <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-700">Failed to load cost profiles: {(profileError as Error)?.message ?? 'Unknown error'}</p>
        </div>
      )}
      <Card>
        <CardHeader title="Item Cost Profiles" description="Per-item costing method configuration" />
        <DataTable data={profiles ?? []} columns={columns} keyExtractor={(r) => r.id} isLoading={isLoading} emptyMessage="No cost profiles configured" />
      </Card>

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Cost Profile" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
            <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
              <option value="">— Select a product —</option>
              {productOptions.map((p) => <option key={p.id} value={p.id}>{p.name || p.code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
              <option value="">— All locations —</option>
              {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name || l.code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Costing Method *</label>
            <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.costingMethod} onChange={(e) => setForm({ ...form, costingMethod: e.target.value })}>
              {['STANDARD', 'MOVING_AVERAGE', 'FIFO', 'LIFO', 'ACTUAL_JOB_COSTING'].map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="landedCost" checked={form.enableLandedCost} onChange={(e) => setForm({ ...form, enableLandedCost: e.target.checked })} />
            <label htmlFor="landedCost" className="text-sm text-gray-700">Enable Landed Cost</label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Overhead Rate (%)</label>
              <input type="number" step="0.01" min="0" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.overheadRate} onChange={(e) => setForm({ ...form, overheadRate: +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Labor Rate ({currency}/hr)</label>
              <input type="number" step="0.01" min="0" className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500" value={form.laborRate} onChange={(e) => setForm({ ...form, laborRate: +e.target.value })} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => upsertMut.mutate()} isLoading={upsertMut.isPending} disabled={!form.productId}>Save</Button>
        </div>
      </Modal>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGINATION CONTROLS
// ═══════════════════════════════════════════════════════════════════════
function PaginationControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
      <span className="text-sm text-gray-500">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}
