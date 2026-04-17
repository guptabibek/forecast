import {
    platformService,
    type TenantDetail,
    type TenantDomainResetResult,
    type TenantLicenseStatus,
    type TenantModuleConfig,
    type TenantResetResult,
    type TenantUser,
} from '@/services/api/platform.service';
import {
    ArrowLeftIcon,
    CheckCircleIcon,
    ExclamationTriangleIcon,
    XCircleIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const MODULE_LABELS: Record<string, { name: string; description: string }> = {
  planning: { name: 'Planning', description: 'Budget plans, plan versions, and approval workflows' },
  forecasting: { name: 'Forecasting', description: 'AI forecasting, scenarios, overrides, and reconciliation' },
  manufacturing: { name: 'Manufacturing', description: 'BOM, MRP, work orders, inventory, quality, S&OP' },
  reports: { name: 'Reports', description: 'Dashboard analytics, report builder, and data export' },
  data: { name: 'Data Management', description: 'Data import, actuals, products, locations, dimensions' },
  'marg-ede': { name: 'Marg EDE Integration', description: 'Sync data from Marg ERP via EDE API' },
};

const STATUS_OPTIONS = ['ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED'] as const;
const TIER_OPTIONS = ['STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const;

export default function TenantManage() {
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [modules, setModules] = useState<TenantModuleConfig[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [showDomainResetDialog, setShowDomainResetDialog] = useState(false);
  const [domainResetConfirmText, setDomainResetConfirmText] = useState('');

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [t, m, u] = await Promise.all([
        platformService.getTenant(id),
        platformService.getModules(id),
        platformService.listTenantUsers(id, { limit: 100 }),
      ]);
      setTenant(t);
      setModules(m);
      setUsers(u.data);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load tenant data' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggleModule = async (module: string, enabled: boolean) => {
    if (!id) return;
    setSaving(true);
    try {
      const updated = await platformService.toggleModule(id, module, enabled);
      setModules(updated);
      setMessage({ type: 'success', text: `${MODULE_LABELS[module]?.name || module} ${enabled ? 'enabled' : 'disabled'}` });
    } catch {
      setMessage({ type: 'error', text: 'Failed to update module' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleUpdateTenant = async (
    patch: Partial<{
      status: string;
      tier: string;
      licenseStatus: TenantLicenseStatus;
      licenseExpiresAt: string | null;
    }>,
  ) => {
    if (!id) return;
    setSaving(true);
    try {
      const updated = await platformService.updateTenant(id, patch);
      setTenant((prev) => prev ? { ...prev, ...updated } : prev);
      setMessage({ type: 'success', text: 'Tenant updated' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to update tenant' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleResetTenantData = async () => {
    if (!id || !tenant) return;

    setSaving(true);
    try {
      const result: TenantResetResult = await platformService.resetTenantData(id);
      await loadData();
      setShowResetDialog(false);
      setResetConfirmText('');
      setMessage({
        type: 'success',
        text: `Tenant data cleared. Preserved ${result.preservedAdminEmails.length} admin login(s) and removed ${result.totalRowsDeleted} record(s).`,
      });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.response?.data?.message ?? 'Failed to reset tenant data',
      });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleResetTenantDomains = async () => {
    if (!id || !tenant) return;

    setSaving(true);
    try {
      const result: TenantDomainResetResult = await platformService.resetTenantDomains(id);
      await loadData();
      setShowDomainResetDialog(false);
      setDomainResetConfirmText('');
      setMessage({
        type: 'success',
        text: `Domain settings reset. ${result.deletedDomainMappings} custom domain mapping(s) removed and workspace subdomain restored to ${result.subdomain}.`,
      });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.response?.data?.message ?? 'Failed to reset tenant domains',
      });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (!tenant) {
    return <div className="text-center py-12 text-secondary-400">Tenant not found</div>;
  }

  const effectiveLicenseState = getEffectiveLicenseState(tenant);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/platform" className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700">
          <ArrowLeftIcon className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-secondary-100">{tenant.name}</h1>
          <p className="text-sm text-secondary-500 dark:text-secondary-400 font-mono">{tenant.slug}</p>
        </div>
      </div>

      {/* Status Message */}
      {message && (
        <div className={`px-4 py-2 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
            : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tenant Info */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-5 space-y-4">
            <h2 className="font-semibold text-secondary-900 dark:text-secondary-100">Tenant Details</h2>

            <div>
              <label className="block text-xs text-secondary-500 dark:text-secondary-400 mb-1">Status</label>
              <select
                value={tenant.status}
                onChange={(e) => handleUpdateTenant({ status: e.target.value })}
                disabled={saving}
                className="w-full px-3 py-1.5 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-900 text-sm"
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-secondary-500 dark:text-secondary-400 mb-1">Tier</label>
              <select
                value={tenant.tier}
                onChange={(e) => handleUpdateTenant({ tier: e.target.value })}
                disabled={saving}
                className="w-full px-3 py-1.5 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-900 text-sm"
              >
                {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-secondary-500 dark:text-secondary-400 mb-1">License Status</label>
              <select
                value={tenant.licenseStatus}
                onChange={(e) => handleUpdateTenant({ licenseStatus: e.target.value as TenantLicenseStatus })}
                disabled={saving}
                className="w-full px-3 py-1.5 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-900 text-sm"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-secondary-500 dark:text-secondary-400 mb-1">License Expiry</label>
              <input
                type="date"
                value={toDateInputValue(tenant.licenseExpiresAt)}
                onChange={(e) => handleUpdateTenant({
                  licenseExpiresAt: e.target.value
                    ? `${e.target.value}T23:59:59.999Z`
                    : null,
                })}
                disabled={saving}
                className="w-full px-3 py-1.5 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-900 text-sm"
              />
              <p className="mt-1 text-xs text-secondary-500 dark:text-secondary-400">
                Leave blank for a non-expiring license.
              </p>
            </div>

            <InfoRow label="Domain" value={tenant.domain || '—'} />
            <InfoRow label="Subdomain" value={tenant.subdomain || '—'} />
            <InfoRow label="Effective License" value={effectiveLicenseState} />
            <InfoRow label="Timezone" value={tenant.timezone} />
            <InfoRow label="Currency" value={tenant.defaultCurrency} />
            <InfoRow label="Users" value={String(tenant._count.users)} />
            <InfoRow label="Products" value={String(tenant._count.products)} />
            <InfoRow label="Actuals" value={String(tenant._count.actuals)} />
            <InfoRow label="Created" value={new Date(tenant.createdAt).toLocaleDateString()} />
          </div>

          <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-secondary-900 dark:text-secondary-100">Domain Configuration</h2>
                <p className="mt-1 text-xs text-secondary-500 dark:text-secondary-400">
                  Primary domain and verified custom domain mappings for this tenant workspace.
                </p>
              </div>
              <button
                onClick={() => setShowDomainResetDialog(true)}
                disabled={saving}
                className="inline-flex items-center rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800/60 dark:text-amber-300 dark:hover:bg-amber-900/20"
              >
                Reset Domains
              </button>
            </div>

            <InfoRow label="Workspace URL" value={tenant.subdomain ? `${tenant.subdomain}` : '—'} />
            <InfoRow label="Primary Domain" value={tenant.domain || '—'} />

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
                Custom Domain Mappings
              </p>
              {tenant.domainMappings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-secondary-300 px-3 py-4 text-sm text-secondary-500 dark:border-secondary-700 dark:text-secondary-400">
                  No custom domain mappings configured.
                </div>
              ) : (
                <div className="space-y-2">
                  {tenant.domainMappings.map((mapping) => (
                    <div
                      key={mapping.id}
                      className="flex items-center justify-between rounded-lg border border-secondary-200 px-3 py-2 text-sm dark:border-secondary-700"
                    >
                      <div>
                        <p className="font-medium text-secondary-900 dark:text-secondary-100">{mapping.domain}</p>
                        <p className="text-xs text-secondary-500 dark:text-secondary-400">
                          Added {new Date(mapping.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${mapping.isVerified ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                        {mapping.isVerified ? 'Verified' : 'Pending verification'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modules */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-5">
            <h2 className="font-semibold text-secondary-900 dark:text-secondary-100 mb-4">
              Enabled Modules
            </h2>
            <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-4">
              Control which modules this tenant can access. Disabled modules are hidden from the sidebar and blocked on the API.
            </p>

            <div className="space-y-3">
              {modules.map((m) => {
                const meta = MODULE_LABELS[m.module] || { name: m.module, description: '' };
                return (
                  <div
                    key={m.module}
                    className="flex items-center justify-between p-3 rounded-lg border border-secondary-200 dark:border-secondary-700 hover:bg-secondary-50 dark:hover:bg-secondary-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {m.enabled ? (
                        <CheckCircleIcon className="w-5 h-5 text-green-500" />
                      ) : (
                        <XCircleIcon className="w-5 h-5 text-secondary-300 dark:text-secondary-600" />
                      )}
                      <div>
                        <p className="font-medium text-sm text-secondary-900 dark:text-secondary-100">
                          {meta.name}
                        </p>
                        <p className="text-xs text-secondary-500 dark:text-secondary-400">
                          {meta.description}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleToggleModule(m.module, !m.enabled)}
                      disabled={saving}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        m.enabled ? 'bg-primary-600' : 'bg-secondary-300 dark:bg-secondary-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white transform transition-transform ${
                          m.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Users */}
          <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-5">
            <h2 className="font-semibold text-secondary-900 dark:text-secondary-100 mb-4">
              Users ({users.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-secondary-200 dark:border-secondary-700">
                    <th className="text-left px-3 py-2 text-secondary-500 dark:text-secondary-400 font-medium">Name</th>
                    <th className="text-left px-3 py-2 text-secondary-500 dark:text-secondary-400 font-medium">Email</th>
                    <th className="text-left px-3 py-2 text-secondary-500 dark:text-secondary-400 font-medium">Role</th>
                    <th className="text-left px-3 py-2 text-secondary-500 dark:text-secondary-400 font-medium">Status</th>
                    <th className="text-left px-3 py-2 text-secondary-500 dark:text-secondary-400 font-medium">Last Login</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-100 dark:divide-secondary-700">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="px-3 py-2 text-secondary-900 dark:text-secondary-100">
                        {u.firstName} {u.lastName}
                      </td>
                      <td className="px-3 py-2 text-secondary-500 dark:text-secondary-400">{u.email}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-secondary-500 dark:text-secondary-400">{u.status}</td>
                      <td className="px-3 py-2 text-xs text-secondary-400">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-secondary-800 rounded-xl border border-red-200 dark:border-red-900/40 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2 text-red-600 dark:bg-red-900/30 dark:text-red-300">
                <ExclamationTriangleIcon className="h-5 w-5" />
              </div>
              <div className="flex-1 space-y-2">
                <div>
                  <h2 className="font-semibold text-red-700 dark:text-red-300">Danger Zone</h2>
                  <p className="text-sm text-secondary-600 dark:text-secondary-400 mt-1">
                    Delete all tenant-scoped business data while preserving the tenant workspace, enabled modules, RBAC roles, domain mapping, and admin login accounts.
                  </p>
                </div>
                <button
                  onClick={() => setShowResetDialog(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  <ExclamationTriangleIcon className="h-4 w-4" />
                  Reset Tenant Data
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showResetDialog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto pt-10 pb-10">
          <div className="w-full max-w-lg bg-white dark:bg-secondary-900 rounded-2xl shadow-2xl border border-red-200 dark:border-red-900/40">
            <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-200 dark:border-secondary-700">
              <h2 className="text-lg font-semibold text-secondary-900 dark:text-white">Reset Tenant Data</h2>
              <button
                onClick={() => {
                  setShowResetDialog(false);
                  setResetConfirmText('');
                }}
                className="rounded-lg p-1 hover:bg-secondary-100 dark:hover:bg-secondary-700"
              >
                <XMarkIcon className="h-5 w-5 text-secondary-500" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-900/40 dark:text-red-300">
                This permanently removes tenant data, deletes non-admin users, and revokes all sessions. Admin login accounts remain so the tenant can sign in again and re-import data.
              </div>

              <div className="space-y-2 text-sm text-secondary-600 dark:text-secondary-400">
                <p>Type <span className="font-mono font-semibold text-secondary-900 dark:text-secondary-100">{tenant.slug}</span> to confirm.</p>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm font-mono text-secondary-900 dark:text-white focus:ring-2 focus:ring-red-500"
                  placeholder={tenant.slug}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-secondary-200 dark:border-secondary-700">
              <button
                onClick={() => {
                  setShowResetDialog(false);
                  setResetConfirmText('');
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetTenantData}
                disabled={saving || resetConfirmText !== tenant.slug}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Resetting…' : 'Delete Tenant Data'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDomainResetDialog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto pt-10 pb-10">
          <div className="w-full max-w-lg bg-white dark:bg-secondary-900 rounded-2xl shadow-2xl border border-amber-200 dark:border-amber-900/40">
            <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-200 dark:border-secondary-700">
              <h2 className="text-lg font-semibold text-secondary-900 dark:text-white">Reset Tenant Domains</h2>
              <button
                onClick={() => {
                  setShowDomainResetDialog(false);
                  setDomainResetConfirmText('');
                }}
                className="rounded-lg p-1 hover:bg-secondary-100 dark:hover:bg-secondary-700"
              >
                <XMarkIcon className="h-5 w-5 text-secondary-500" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:border-amber-900/40 dark:text-amber-300">
                This clears the tenant primary domain, deletes all custom domain mappings, and restores the workspace subdomain to <span className="font-mono">{tenant.slug}</span>.
              </div>

              <div className="space-y-2 text-sm text-secondary-600 dark:text-secondary-400">
                <p>Type <span className="font-mono font-semibold text-secondary-900 dark:text-secondary-100">{tenant.slug}</span> to confirm.</p>
                <input
                  type="text"
                  value={domainResetConfirmText}
                  onChange={(e) => setDomainResetConfirmText(e.target.value)}
                  className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm font-mono text-secondary-900 dark:text-white focus:ring-2 focus:ring-amber-500"
                  placeholder={tenant.slug}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-secondary-200 dark:border-secondary-700">
              <button
                onClick={() => {
                  setShowDomainResetDialog(false);
                  setDomainResetConfirmText('');
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetTenantDomains}
                disabled={saving || domainResetConfirmText !== tenant.slug}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Resetting…' : 'Reset Domains'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getEffectiveLicenseState(tenant: TenantDetail) {
  if (tenant.licenseStatus !== 'ACTIVE') {
    return 'SUSPENDED';
  }

  if (tenant.licenseExpiresAt && new Date(tenant.licenseExpiresAt).getTime() <= Date.now()) {
    return 'EXPIRED';
  }

  return 'ACTIVE';
}

function toDateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : '';
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-secondary-500 dark:text-secondary-400">{label}</span>
      <span className="text-secondary-900 dark:text-secondary-100 font-medium">{value}</span>
    </div>
  );
}
