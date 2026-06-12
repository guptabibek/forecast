import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BanknotesIcon,
  ChartBarIcon,
  CpuChipIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  ReceiptPercentIcon,
  ScaleIcon,
  ShieldCheckIcon,
  WalletIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { LineChart } from '../../components/charts';
import { Button, Card, EmptyState, Modal } from '../../components/ui';
import {
  platformAiBillingService as api,
  type AiBillingModel,
  type AiBillingProvider,
} from '../../services/api/platform-ai-billing.service';

type TabKey = 'overview' | 'providers' | 'models' | 'pricing' | 'wallets' | 'review' | 'disputes' | 'audit';

const TABS: Array<[TabKey, string]> = [
  ['overview', 'Overview'],
  ['providers', 'Providers'],
  ['models', 'Models'],
  ['pricing', 'Pricing'],
  ['wallets', 'Wallets'],
  ['review', 'Review Queue'],
  ['disputes', 'Disputes'],
  ['audit', 'Audit Log'],
];

const money = (value: string | number) => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function apiErrorMessage(error: unknown): string | undefined {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
}

interface PricingForm {
  modelId?: string;
  scope: string;
  planTier?: string;
  tenantId?: string;
  effectiveFrom: string;
  providerInputCost?: number;
  providerOutputCost?: number;
  customerInputPrice?: number;
  customerOutputPrice?: number;
}

interface DisputeActionForm {
  action: string;
  kind?: string;
  amount?: number;
  transactionId?: string;
  purchaseId?: string;
  note?: string;
}

interface ReviewPurchaseRow {
  id: string;
  tenantId: string;
  tenantName?: string;
  amount: string;
  proofUrl: string | null;
  proofNote: string | null;
  createdAt: string;
}

interface AdminDisputeRow {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  subject: string;
  createdAt: string;
}

interface DisputeMessageRow {
  id: string;
  authorRole: string;
  body: string;
}

interface AuditRow {
  id: string;
  createdAt: string;
  actorEmail: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  ipAddress: string | null;
}

const inputCls = 'w-full rounded-lg border border-secondary-200 px-3 py-2 text-sm dark:border-secondary-700 dark:bg-secondary-900 dark:text-white';
const thCls = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-secondary-500';
const tdCls = 'whitespace-nowrap px-3 py-2 text-sm text-secondary-700 dark:text-secondary-300';

/**
 * Administration → AI Management. The super-admin command center of the AI
 * Billing platform: financial overview, provider/model registry (the ONLY
 * place API keys are managed), the pricing engine + simulator, tenant
 * wallets, the bank-transfer review queue, disputes, and the immutable
 * billing audit trail.
 */
export default function AiBillingAdmin() {
  const [tab, setTab] = useState<TabKey>('overview');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-secondary-900 dark:text-white lg:text-2xl">AI Management</h1>
        <p className="mt-0.5 text-sm text-secondary-500 dark:text-secondary-400">
          Billing, credits, pricing, providers, and governance for the AI platform
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-secondary-100 pb-2 dark:border-secondary-800">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'text-secondary-600 hover:bg-secondary-50 dark:text-secondary-400 dark:hover:bg-secondary-800'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'models' && <ModelsTab />}
      {tab === 'pricing' && <PricingTab />}
      {tab === 'wallets' && <WalletsTab />}
      {tab === 'review' && <ReviewQueueTab />}
      {tab === 'disputes' && <DisputesTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

function OverviewTab() {
  const overview = useQuery({ queryKey: ['ai-billing-admin', 'overview'], queryFn: () => api.overview() });
  const trends = useQuery({ queryKey: ['ai-billing-admin', 'trends'], queryFn: () => api.trends(30) });
  const models = useQuery({ queryKey: ['ai-billing-admin', 'model-report'], queryFn: () => api.modelReport(30) });
  const data = overview.data;

  const metrics = [
    { label: 'Total Revenue', value: data ? money(data.totalRevenue) : '—', icon: CurrencyDollarIcon },
    { label: 'Credits Consumed', value: data ? money(data.creditsConsumed) : '—', icon: ChartBarIcon },
    { label: 'Provider Cost', value: data ? money(data.providerCost) : '—', icon: CpuChipIcon },
    { label: 'Profit Margin', value: data ? `${money(data.profitMargin)}${data.marginPct !== null ? ` (${data.marginPct}%)` : ''}` : '—', icon: ReceiptPercentIcon },
    { label: 'Outstanding Credits', value: data ? money(data.outstandingCredits) : '—', icon: WalletIcon },
    { label: 'Refunded', value: data ? money(data.refundAmount) : '—', icon: BanknotesIcon },
    { label: 'Open Disputes', value: data ? String(data.openDisputes) : '—', icon: ExclamationTriangleIcon },
    { label: 'AI Requests', value: data ? data.totalRequests.toLocaleString() : '—', icon: ScaleIcon },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} padding="sm">
            <div className="flex items-center gap-3 p-2">
              <div className="rounded-lg bg-primary-50 p-2 text-primary-600 dark:bg-primary-900/40">
                <metric.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs text-secondary-500 dark:text-secondary-400">{metric.label}</p>
                <p className="truncate text-base font-bold text-secondary-900 dark:text-white">{metric.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-secondary-900 dark:text-white">Revenue vs Consumption vs Provider Cost (30d)</h2>
          <LineChart
            data={(trends.data ?? []) as unknown as Array<Record<string, string | number>>}
            xAxisKey="date"
            height={280}
            lines={[
              { dataKey: 'revenue', name: 'Revenue', color: '#16a34a' },
              { dataKey: 'consumed', name: 'Consumed', color: '#2563eb' },
              { dataKey: 'providerCost', name: 'Provider Cost', color: '#dc2626' },
            ]}
          />
        </div>
      </Card>
      <Card>
        <div className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-secondary-900 dark:text-white">Model Profitability (30d)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-secondary-100 dark:divide-secondary-800">
              <thead><tr><th className={thCls}>Provider</th><th className={thCls}>Model</th><th className={thCls}>Requests</th><th className={thCls}>Tokens</th><th className={thCls}>Provider Cost</th><th className={thCls}>Charged</th><th className={thCls}>Margin</th></tr></thead>
              <tbody className="divide-y divide-secondary-50 dark:divide-secondary-800/60">
                {(models.data ?? []).map((row) => (
                  <tr key={`${row.provider_name}-${row.model_code}`}>
                    <td className={tdCls}>{row.provider_name}</td>
                    <td className={tdCls}>{row.model_code}</td>
                    <td className={tdCls}>{Number(row.requests).toLocaleString()}</td>
                    <td className={tdCls}>{Number(row.total_tokens).toLocaleString()}</td>
                    <td className={tdCls}>{money(row.provider_cost)}</td>
                    <td className={tdCls}>{money(row.customer_charge)}</td>
                    <td className={`${tdCls} font-medium ${Number(row.margin) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{money(row.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ProvidersTab() {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ['ai-billing-admin', 'providers'], queryFn: () => api.listProviders() });
  const [editing, setEditing] = useState<Partial<AiBillingProvider> & { apiKey?: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ai-billing-admin'] });

  const save = useMutation({
    mutationFn: (input: Partial<AiBillingProvider> & { id?: string; apiKey?: string }) =>
      (input.id ? api.updateProvider(input.id, input as Record<string, unknown>) : api.createProvider(input)),
    onSuccess: () => { toast.success('Provider saved'); setEditing(null); refresh(); },
    onError: (error: unknown) => toast.error(apiErrorMessage(error) ??'Save failed'),
  });

  return (
    <Card>
      <div className="flex items-center justify-between p-4 pb-0">
        <h2 className="text-sm font-semibold text-secondary-900 dark:text-white">AI Providers (failover by priority)</h2>
        <Button size="sm" onClick={() => setEditing({ kind: 'openai', priority: 100 })}>Add Provider</Button>
      </div>
      <div className="overflow-x-auto p-4">
        {(providers.data?.length ?? 0) === 0 ? (
          <EmptyState icon={<CpuChipIcon className="h-10 w-10" />} title="No providers configured" description="AI features stay offline until a provider with an API key is added here." />
        ) : (
          <table className="min-w-full divide-y divide-secondary-100 dark:divide-secondary-800">
            <thead><tr><th className={thCls}>Priority</th><th className={thCls}>Name</th><th className={thCls}>Kind</th><th className={thCls}>API Key</th><th className={thCls}>Models</th><th className={thCls}>Status</th><th className={thCls} /></tr></thead>
            <tbody className="divide-y divide-secondary-50 dark:divide-secondary-800/60">
              {providers.data!.map((provider) => (
                <tr key={provider.id}>
                  <td className={tdCls}>{provider.priority}</td>
                  <td className={`${tdCls} font-medium text-secondary-900 dark:text-white`}>{provider.name}</td>
                  <td className={tdCls}>{provider.kind}</td>
                  <td className={tdCls}>{provider.hasApiKey ? `••••${provider.apiKeyLast4 ?? ''}` : <span className="text-amber-600">missing</span>}</td>
                  <td className={tdCls}>{provider._count?.models ?? 0}</td>
                  <td className={tdCls}>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${provider.status === 'ACTIVE' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800'}`}>{provider.status}</span>
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <button type="button" className="text-xs font-medium text-primary-600 hover:text-primary-700" onClick={() => setEditing(provider)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <Modal isOpen onClose={() => setEditing(null)} title={editing.id ? `Edit ${editing.name}` : 'Add Provider'}>
          <div className="space-y-3">
            <input className={inputCls} placeholder="Name (e.g. OpenAI Primary)" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <select className={inputCls} value={editing.kind ?? 'openai'} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
              {['openai', 'anthropic', 'gemini', 'azure_openai', 'custom'].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
            </select>
            <input className={inputCls} type="password" placeholder={editing.id ? 'New API key (leave blank to keep)' : 'API key'} value={editing.apiKey ?? ''} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} />
            <input className={inputCls} placeholder="Endpoint URL (optional, for azure/custom)" value={editing.endpointUrl ?? ''} onChange={(e) => setEditing({ ...editing, endpointUrl: e.target.value })} />
            <div className="flex gap-2">
              <input className={inputCls} type="number" placeholder="Priority (lower = first)" value={editing.priority ?? 100} onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })} />
              <select className={inputCls} value={editing.status ?? 'ACTIVE'} onChange={(e) => setEditing({ ...editing, status: e.target.value as 'ACTIVE' | 'DISABLED' })}>
                <option value="ACTIVE">ACTIVE</option><option value="DISABLED">DISABLED</option>
              </select>
            </div>
            <div className="flex justify-between">
              {editing.id ? (
                <Button variant="outline" size="sm" onClick={() => api.deleteProvider(editing.id!).then(() => { toast.success('Provider deleted'); setEditing(null); refresh(); })}>Delete</Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={() => save.mutate({ ...editing, apiKey: editing.apiKey || undefined })} disabled={save.isPending || !editing.name}>Save</Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function ModelsTab() {
  const queryClient = useQueryClient();
  const models = useQuery({ queryKey: ['ai-billing-admin', 'models'], queryFn: () => api.listModels() });
  const providers = useQuery({ queryKey: ['ai-billing-admin', 'providers'], queryFn: () => api.listProviders() });
  const [editing, setEditing] = useState<Partial<AiBillingModel> | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ai-billing-admin'] });

  const save = useMutation({
    mutationFn: (input: Partial<AiBillingModel> & { id?: string }) =>
      (input.id ? api.updateModel(input.id, input as Record<string, unknown>) : api.createModel(input as Record<string, unknown>)),
    onSuccess: () => { toast.success('Model saved'); setEditing(null); refresh(); },
    onError: (error: unknown) => toast.error(apiErrorMessage(error) ??'Save failed'),
  });

  return (
    <Card>
      <div className="flex items-center justify-between p-4 pb-0">
        <h2 className="text-sm font-semibold text-secondary-900 dark:text-white">Models</h2>
        <Button size="sm" onClick={() => setEditing({})}>Add Model</Button>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="min-w-full divide-y divide-secondary-100 dark:divide-secondary-800">
          <thead><tr><th className={thCls}>Model</th><th className={thCls}>Provider</th><th className={thCls}>Max Context</th><th className={thCls}>Default</th><th className={thCls}>Pricing</th><th className={thCls}>Status</th><th className={thCls} /></tr></thead>
          <tbody className="divide-y divide-secondary-50 dark:divide-secondary-800/60">
            {(models.data ?? []).map((model) => (
              <tr key={model.id}>
                <td className={`${tdCls} font-medium text-secondary-900 dark:text-white`}>{model.modelCode}</td>
                <td className={tdCls}>{model.provider?.name}</td>
                <td className={tdCls}>{model.maxContext?.toLocaleString() ?? '—'}</td>
                <td className={tdCls}>{model.isDefault ? '★ default' : ''}</td>
                <td className={tdCls}>
                  {model.hasGlobalPricing ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">priced</span>
                  ) : (model.activePricingCount ?? 0) > 0 ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title="Only PLAN/TENANT overrides exist — tenants outside them cannot run this model">no GLOBAL price</span>
                  ) : (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300" title="This model will refuse to run until an ACTIVE pricing row exists">no pricing</span>
                  )}
                </td>
                <td className={tdCls}>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${model.status === 'ACTIVE' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800'}`}>{model.status}</span>
                </td>
                <td className={`${tdCls} text-right`}>
                  <button type="button" className="text-xs font-medium text-primary-600 hover:text-primary-700" onClick={() => setEditing(model)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal isOpen onClose={() => setEditing(null)} title={editing.id ? `Edit ${editing.modelCode}` : 'Add Model'}>
          <div className="space-y-3">
            {!editing.id && (
              <>
                <select className={inputCls} value={editing.providerId ?? ''} onChange={(e) => setEditing({ ...editing, providerId: e.target.value })}>
                  <option value="">Select provider…</option>
                  {(providers.data ?? []).map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select>
                <input className={inputCls} placeholder="Model code (e.g. gpt-4o)" value={editing.modelCode ?? ''} onChange={(e) => setEditing({ ...editing, modelCode: e.target.value })} />
              </>
            )}
            <input className={inputCls} placeholder="Display name" value={editing.displayName ?? ''} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} />
            <input className={inputCls} type="number" placeholder="Max context tokens" value={editing.maxContext ?? ''} onChange={(e) => setEditing({ ...editing, maxContext: e.target.value ? Number(e.target.value) : null })} />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-secondary-700 dark:text-secondary-300">
                <input type="checkbox" checked={editing.isDefault ?? false} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} />
                Default model
              </label>
              <select className={inputCls} value={editing.status ?? 'ACTIVE'} onChange={(e) => setEditing({ ...editing, status: e.target.value as 'ACTIVE' | 'DISABLED' })}>
                <option value="ACTIVE">ACTIVE</option><option value="DISABLED">DISABLED</option>
              </select>
            </div>
            <div className="flex justify-between">
              {editing.id ? (
                <Button variant="outline" size="sm" onClick={() => api.deleteModel(editing.id!).then(() => { toast.success('Model deleted'); setEditing(null); refresh(); })}>Delete</Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={() => save.mutate(editing)} disabled={save.isPending || (!editing.id && (!editing.providerId || !editing.modelCode))}>Save</Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function PricingTab() {
  const queryClient = useQueryClient();
  const pricing = useQuery({ queryKey: ['ai-billing-admin', 'pricing'], queryFn: () => api.listPricing() });
  const models = useQuery({ queryKey: ['ai-billing-admin', 'models'], queryFn: () => api.listModels() });
  const [form, setForm] = useState<PricingForm | null>(null);
  const [sim, setSim] = useState({ modelId: '', promptTokens: 100000, completionTokens: 20000, result: null as null | { providerCost: string; customerCharge: string; margin: string; marginPct: number | null } });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ai-billing-admin', 'pricing'] });

  const save = useMutation({
    mutationFn: (input: PricingForm) => api.createPricing(input as unknown as Record<string, unknown>),
    onSuccess: () => { toast.success('Pricing created'); setForm(null); refresh(); },
    onError: (error: unknown) => toast.error(apiErrorMessage(error) ??'Save failed'),
  });

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between p-4 pb-0">
          <h2 className="text-sm font-semibold text-secondary-900 dark:text-white">Pricing Rules (per 1M tokens; TENANT &gt; PLAN &gt; GLOBAL)</h2>
          <Button size="sm" onClick={() => setForm({ scope: 'GLOBAL', effectiveFrom: new Date().toISOString().slice(0, 10) })}>Add Pricing</Button>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="min-w-full divide-y divide-secondary-100 dark:divide-secondary-800">
            <thead><tr><th className={thCls}>Model</th><th className={thCls}>Scope</th><th className={thCls}>Effective</th><th className={thCls}>Provider In/Out</th><th className={thCls}>Customer In/Out</th><th className={thCls}>Status</th><th className={thCls} /></tr></thead>
            <tbody className="divide-y divide-secondary-50 dark:divide-secondary-800/60">
              {(pricing.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td className={`${tdCls} font-medium text-secondary-900 dark:text-white`}>{row.model?.modelCode}</td>
                  <td className={tdCls}>{row.scope}{row.planTier ? ` (${row.planTier})` : ''}{row.tenantId ? ` (${row.tenantId.slice(0, 8)}…)` : ''}</td>
                  <td className={tdCls}>{new Date(row.effectiveFrom).toLocaleDateString()}{row.effectiveTo ? ` → ${new Date(row.effectiveTo).toLocaleDateString()}` : ''}</td>
                  <td className={tdCls}>{money(row.providerInputCost)} / {money(row.providerOutputCost)}</td>
                  <td className={tdCls}>{money(row.customerInputPrice)} / {money(row.customerOutputPrice)}</td>
                  <td className={tdCls}>{row.status}</td>
                  <td className={`${tdCls} text-right`}>
                    <button
                      type="button" className="text-xs font-medium text-primary-600 hover:text-primary-700"
                      onClick={() => api.updatePricing(row.id, { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }).then(refresh)}
                    >
                      {row.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-secondary-900 dark:text-white">
            <ShieldCheckIcon className="h-4 w-4 text-primary-600" /> Pricing Simulator
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select className={inputCls} value={sim.modelId} onChange={(e) => setSim({ ...sim, modelId: e.target.value, result: null })}>
              <option value="">Select model…</option>
              {(models.data ?? []).map((model) => <option key={model.id} value={model.id}>{model.modelCode}</option>)}
            </select>
            <input className={inputCls} type="number" value={sim.promptTokens} onChange={(e) => setSim({ ...sim, promptTokens: Number(e.target.value), result: null })} placeholder="Prompt tokens" />
            <input className={inputCls} type="number" value={sim.completionTokens} onChange={(e) => setSim({ ...sim, completionTokens: Number(e.target.value), result: null })} placeholder="Completion tokens" />
            <Button
              disabled={!sim.modelId}
              onClick={() => api.simulate({ modelId: sim.modelId, promptTokens: sim.promptTokens, completionTokens: sim.completionTokens })
                .then((result) => setSim((prev) => ({ ...prev, result })))
                .catch((error: unknown) => toast.error(apiErrorMessage(error) ?? 'Simulation failed'))}
            >
              Simulate
            </Button>
          </div>
          {sim.result && (
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-secondary-50 p-3 dark:bg-secondary-800"><p className="text-xs text-secondary-500">Provider Cost</p><p className="font-bold">{money(sim.result.providerCost)}</p></div>
              <div className="rounded-lg bg-secondary-50 p-3 dark:bg-secondary-800"><p className="text-xs text-secondary-500">Customer Charge</p><p className="font-bold">{money(sim.result.customerCharge)}</p></div>
              <div className="rounded-lg bg-green-50 p-3 dark:bg-green-900/30"><p className="text-xs text-green-700 dark:text-green-300">Margin</p><p className="font-bold text-green-700 dark:text-green-300">{money(sim.result.margin)}{sim.result.marginPct !== null ? ` (${sim.result.marginPct}%)` : ''}</p></div>
            </div>
          )}
        </div>
      </Card>

      {form && (
        <Modal isOpen onClose={() => setForm(null)} title="Add Pricing Rule" size="lg">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <select className={inputCls} value={form.modelId ?? ''} onChange={(e) => setForm({ ...form, modelId: e.target.value })}>
                <option value="">Model…</option>
                {(models.data ?? []).map((model) => <option key={model.id} value={model.id}>{model.modelCode}</option>)}
              </select>
              <select className={inputCls} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                <option value="GLOBAL">GLOBAL</option><option value="PLAN">PLAN</option><option value="TENANT">TENANT</option>
              </select>
            </div>
            {form.scope === 'PLAN' && (
              <select className={inputCls} value={form.planTier ?? ''} onChange={(e) => setForm({ ...form, planTier: e.target.value })}>
                <option value="">Plan…</option><option value="STARTER">STARTER</option><option value="PROFESSIONAL">PROFESSIONAL</option><option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            )}
            {form.scope === 'TENANT' && (
              <input className={inputCls} placeholder="Tenant ID (uuid)" value={form.tenantId ?? ''} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} />
            )}
            <input className={inputCls} type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
            <p className="text-xs font-semibold text-secondary-500">Provider cost / 1M tokens</p>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} type="number" step="0.000001" placeholder="Input" value={form.providerInputCost ?? ''} onChange={(e) => setForm({ ...form, providerInputCost: Number(e.target.value) })} />
              <input className={inputCls} type="number" step="0.000001" placeholder="Output" value={form.providerOutputCost ?? ''} onChange={(e) => setForm({ ...form, providerOutputCost: Number(e.target.value) })} />
            </div>
            <p className="text-xs font-semibold text-secondary-500">Customer price / 1M tokens</p>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} type="number" step="0.000001" placeholder="Input" value={form.customerInputPrice ?? ''} onChange={(e) => setForm({ ...form, customerInputPrice: Number(e.target.value) })} />
              <input className={inputCls} type="number" step="0.000001" placeholder="Output" value={form.customerOutputPrice ?? ''} onChange={(e) => setForm({ ...form, customerOutputPrice: Number(e.target.value) })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.modelId}>Create</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function WalletsTab() {
  const tenants = useQuery({ queryKey: ['ai-billing-admin', 'tenant-report'], queryFn: () => api.tenantReport(90) });
  const [selected, setSelected] = useState<{ tenantId: string; name: string } | null>(null);
  return (
    <div className="space-y-4">
      <Card>
        <div className="overflow-x-auto p-4">
          <h2 className="mb-3 text-sm font-semibold text-secondary-900 dark:text-white">Customer Wallets &amp; Usage (90d)</h2>
          {(tenants.data?.length ?? 0) === 0 ? (
            <EmptyState icon={<WalletIcon className="h-10 w-10" />} title="No AI usage yet" description="Wallets appear once tenants start using AI features." />
          ) : (
            <table className="min-w-full divide-y divide-secondary-100 dark:divide-secondary-800">
              <thead><tr><th className={thCls}>Tenant</th><th className={thCls}>Requests</th><th className={thCls}>Tokens</th><th className={thCls}>Charged</th><th className={thCls}>Provider Cost</th><th className={thCls}>Balance</th><th className={thCls} /></tr></thead>
              <tbody className="divide-y divide-secondary-50 dark:divide-secondary-800/60">
                {tenants.data!.map((row) => (
                  <tr key={row.tenant_id}>
                    <td className={`${tdCls} font-medium text-secondary-900 dark:text-white`}>{row.tenant_name}</td>
                    <td className={tdCls}>{Number(row.requests).toLocaleString()}</td>
                    <td className={tdCls}>{Number(row.total_tokens).toLocaleString()}</td>
                    <td className={tdCls}>{money(row.customer_charge)}</td>
                    <td className={tdCls}>{money(row.provider_cost)}</td>
                    <td className={tdCls}>{row.balance !== null ? money(row.balance) : '—'}</td>
                    <td className={`${tdCls} text-right`}>
                      <button type="button" className="text-xs font-medium text-primary-600 hover:text-primary-700" onClick={() => setSelected({ tenantId: row.tenant_id, name: row.tenant_name })}>Manage</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      {selected && <WalletManageModal tenantId={selected.tenantId} name={selected.name} onClose={() => setSelected(null)} />}
    </div>
  );
}

function WalletManageModal({ tenantId, name, onClose }: { tenantId: string; name: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const wallet = useQuery({ queryKey: ['ai-billing-admin', 'wallet', tenantId], queryFn: () => api.wallet(tenantId) });
  const [adjust, setAdjust] = useState({ amount: 0, type: 'MANUAL_CREDIT', reason: '' });
  const post = useMutation({
    mutationFn: () => api.adjustWallet(tenantId, adjust),
    onSuccess: () => {
      toast.success('Ledger entry posted');
      setAdjust({ amount: 0, type: 'MANUAL_CREDIT', reason: '' });
      queryClient.invalidateQueries({ queryKey: ['ai-billing-admin'] });
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error) ??'Adjustment failed'),
  });
  return (
    <Modal isOpen onClose={onClose} title={`Wallet — ${name}`}>
      <div className="space-y-4">
        {wallet.data && (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg bg-secondary-50 p-3 dark:bg-secondary-800"><p className="text-xs text-secondary-500">Balance</p><p className="font-bold">{money(wallet.data.balance)}</p></div>
            <div className="rounded-lg bg-secondary-50 p-3 dark:bg-secondary-800"><p className="text-xs text-secondary-500">Reserved</p><p className="font-bold">{money(wallet.data.reservedBalance)}</p></div>
            <div className="rounded-lg bg-secondary-50 p-3 dark:bg-secondary-800"><p className="text-xs text-secondary-500">Status</p><p className="font-bold">{wallet.data.status}</p></div>
          </div>
        )}
        <div className="space-y-2 rounded-lg border border-secondary-100 p-3 dark:border-secondary-800">
          <p className="text-xs font-semibold text-secondary-600 dark:text-secondary-400">Post manual ledger entry (signed amount; negative = debit)</p>
          <div className="flex gap-2">
            <input className={inputCls} type="number" step="0.01" value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: Number(e.target.value) })} />
            <select className={inputCls} value={adjust.type} onChange={(e) => setAdjust({ ...adjust, type: e.target.value })}>
              {['MANUAL_CREDIT', 'BONUS_CREDIT', 'PROMO_CREDIT', 'ADMIN_ADJUSTMENT', 'CORRECTION', 'CREDIT_EXPIRY'].map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <input className={inputCls} placeholder="Reason (required, goes to the immutable ledger)" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => post.mutate()} disabled={post.isPending || !adjust.amount || !adjust.reason.trim()}>Post Entry</Button>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          {wallet.data?.status === 'ACTIVE' ? (
            <Button variant="outline" size="sm" onClick={() => api.updateWalletSettings(tenantId, { status: 'SUSPENDED' }).then(() => { toast.success('Wallet suspended'); onClose(); })}>Suspend Wallet</Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => api.updateWalletSettings(tenantId, { status: 'ACTIVE' }).then(() => { toast.success('Wallet re-activated'); onClose(); })}>Re-activate Wallet</Button>
          )}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function ReviewQueueTab() {
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ['ai-billing-admin', 'review-queue'], queryFn: () => api.reviewQueue('PENDING') });
  const decide = useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => api.reviewPurchase(id, approve, note),
    onSuccess: (_data, vars) => { toast.success(vars.approve ? 'Approved — wallet credited' : 'Rejected'); queryClient.invalidateQueries({ queryKey: ['ai-billing-admin'] }); },
    onError: (error: unknown) => toast.error(apiErrorMessage(error) ??'Review failed'),
  });
  return (
    <Card>
      <div className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-secondary-900 dark:text-white">Bank Transfers Awaiting Review</h2>
        {(queue.data?.length ?? 0) === 0 ? (
          <EmptyState icon={<BanknotesIcon className="h-10 w-10" />} title="Queue is empty" description="Submitted bank transfers land here for approval." />
        ) : (
          <ul className="divide-y divide-secondary-100 dark:divide-secondary-800">
            {queue.data!.map((purchase: ReviewPurchaseRow) => (
              <li key={purchase.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-secondary-900 dark:text-white">{money(purchase.amount)} · {purchase.tenantName ?? `tenant ${purchase.tenantId.slice(0, 8)}…`}</p>
                  <p className="text-xs text-secondary-500">{new Date(purchase.createdAt).toLocaleString()} · {purchase.proofNote ?? 'no note'}</p>
                  {purchase.proofUrl && <a className="text-xs text-primary-600 hover:underline" href={purchase.proofUrl} target="_blank" rel="noreferrer">View proof</a>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => decide.mutate({ id: purchase.id, approve: true })} disabled={decide.isPending}>Approve</Button>
                  <Button variant="outline" size="sm" onClick={() => decide.mutate({ id: purchase.id, approve: false, note: 'Rejected by admin' })} disabled={decide.isPending}>Reject</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function DisputesTab() {
  const queryClient = useQueryClient();
  const disputes = useQuery({ queryKey: ['ai-billing-admin', 'disputes'], queryFn: () => api.listDisputes() });
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useQuery({
    queryKey: ['ai-billing-admin', 'dispute', activeId],
    queryFn: () => api.getDispute(activeId as string),
    enabled: Boolean(activeId),
  });
  const [action, setAction] = useState<DisputeActionForm>({ action: 'APPROVE_REFUND', kind: 'WALLET_CREDIT', amount: 0 });
  const [reply, setReply] = useState('');

  const act = useMutation({
    mutationFn: () => api.disputeAction(activeId as string, action as unknown as Record<string, unknown>),
    onSuccess: () => { toast.success('Action applied and ledgered'); queryClient.invalidateQueries({ queryKey: ['ai-billing-admin'] }); },
    onError: (error: unknown) => toast.error(apiErrorMessage(error) ??'Action failed'),
  });

  return (
    <Card>
      <div className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-secondary-900 dark:text-white">Disputes</h2>
        {((disputes.data?.rows?.length ?? 0) === 0) ? (
          <EmptyState icon={<ExclamationTriangleIcon className="h-10 w-10" />} title="No disputes" description="Customer billing disputes appear here." />
        ) : (
          <ul className="divide-y divide-secondary-100 dark:divide-secondary-800">
            {disputes.data!.rows.map((dispute: AdminDisputeRow) => (
              <li key={dispute.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-secondary-900 dark:text-white">{dispute.subject}</p>
                  <p className="text-xs text-secondary-500">{dispute.type.replace(/_/g, ' ')} · tenant {dispute.tenantId.slice(0, 8)}… · {new Date(dispute.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{dispute.status.replace(/_/g, ' ')}</span>
                  <Button variant="outline" size="sm" onClick={() => setActiveId(dispute.id)}>Work</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {activeId && active.data && (
        <Modal isOpen onClose={() => setActiveId(null)} title={active.data.subject} size="lg">
          <div className="space-y-3">
            <div className="max-h-56 space-y-2 overflow-y-auto">
              <p className="rounded-lg bg-secondary-50 p-3 text-sm dark:bg-secondary-800">{active.data.description}</p>
              {active.data.messages.map((message: DisputeMessageRow) => (
                <div key={message.id} className="rounded-lg bg-secondary-50 p-2 text-sm dark:bg-secondary-800">
                  <span className="mr-2 text-[10px] font-bold uppercase opacity-60">{message.authorRole}</span>{message.body}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input className={inputCls} placeholder="Reply to customer…" value={reply} onChange={(e) => setReply(e.target.value)} />
              <Button size="sm" disabled={!reply.trim()} onClick={() => api.replyDispute(activeId, reply).then(() => { setReply(''); queryClient.invalidateQueries({ queryKey: ['ai-billing-admin', 'dispute', activeId] }); })}>Send</Button>
            </div>
            <div className="space-y-2 rounded-lg border border-secondary-100 p-3 dark:border-secondary-800">
              <p className="text-xs font-semibold text-secondary-600 dark:text-secondary-400">Resolution action (creates ledger + audit entries)</p>
              <div className="grid grid-cols-2 gap-2">
                <select className={inputCls} value={action.action} onChange={(e) => setAction({ ...action, action: e.target.value })}>
                  {['APPROVE_REFUND', 'PARTIAL_REFUND', 'ISSUE_BONUS_CREDITS', 'REVERSE_CHARGE', 'MANUAL_ADJUSTMENT', 'REJECT', 'ESCALATE'].map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
                </select>
                {['APPROVE_REFUND', 'PARTIAL_REFUND', 'ISSUE_BONUS_CREDITS', 'MANUAL_ADJUSTMENT'].includes(action.action) && (
                  <input className={inputCls} type="number" step="0.01" placeholder="Amount" value={action.amount ?? ''} onChange={(e) => setAction({ ...action, amount: Number(e.target.value) })} />
                )}
                {['APPROVE_REFUND', 'PARTIAL_REFUND'].includes(action.action) && (
                  <select className={inputCls} value={action.kind} onChange={(e) => setAction({ ...action, kind: e.target.value })}>
                    <option value="WALLET_CREDIT">Wallet credit</option><option value="CASH">Cash (Stripe)</option>
                  </select>
                )}
                {['APPROVE_REFUND', 'PARTIAL_REFUND'].includes(action.action) && action.kind === 'CASH' && (
                  <input className={inputCls} placeholder="Original purchase ID (required for cash refunds)" value={action.purchaseId ?? ''} onChange={(e) => setAction({ ...action, purchaseId: e.target.value })} />
                )}
                {action.action === 'REVERSE_CHARGE' && (
                  <input className={inputCls} placeholder="Transaction ID to reverse" value={action.transactionId ?? ''} onChange={(e) => setAction({ ...action, transactionId: e.target.value })} />
                )}
              </div>
              <input className={inputCls} placeholder="Note (required for reject/adjustment)" value={action.note ?? ''} onChange={(e) => setAction({ ...action, note: e.target.value })} />
              <div className="flex justify-end">
                <Button size="sm" onClick={() => act.mutate()} disabled={act.isPending}>Apply Action</Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function AuditTab() {
  const audit = useQuery({ queryKey: ['ai-billing-admin', 'audit'], queryFn: () => api.auditLog(1) });
  return (
    <Card>
      <div className="overflow-x-auto p-4">
        <h2 className="mb-3 text-sm font-semibold text-secondary-900 dark:text-white">Immutable Billing Audit Trail</h2>
        <table className="min-w-full divide-y divide-secondary-100 dark:divide-secondary-800">
          <thead><tr><th className={thCls}>When</th><th className={thCls}>Actor</th><th className={thCls}>Action</th><th className={thCls}>Entity</th><th className={thCls}>Reason</th><th className={thCls}>IP</th></tr></thead>
          <tbody className="divide-y divide-secondary-50 dark:divide-secondary-800/60">
            {(audit.data?.rows ?? []).map((row: AuditRow) => (
              <tr key={row.id}>
                <td className={tdCls}>{new Date(row.createdAt).toLocaleString()}</td>
                <td className={tdCls}>{row.actorEmail ?? row.actorId?.slice(0, 8) ?? 'system'}</td>
                <td className={`${tdCls} font-medium text-secondary-900 dark:text-white`}>{row.action}</td>
                <td className={tdCls}>{row.entityType}{row.entityId ? ` ${String(row.entityId).slice(0, 8)}…` : ''}</td>
                <td className={`${tdCls} max-w-xs truncate`} title={row.reason ?? ''}>{row.reason}</td>
                <td className={tdCls}>{row.ipAddress}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
