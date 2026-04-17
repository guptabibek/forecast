import { platformService, type PlatformStats, type TenantSummary } from '@/services/api/platform.service';
import {
    BuildingOffice2Icon,
    MagnifyingGlassIcon,
    PlusIcon,
    UsersIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  TRIAL: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  CANCELLED: 'bg-secondary-100 text-secondary-500 dark:bg-secondary-800 dark:text-secondary-400',
};

const TIER_LABELS: Record<string, string> = {
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
};

export default function PlatformDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      platformService.getStats(),
      platformService.listTenants({ limit: 100 }),
    ]).then(([s, t]) => {
      setStats(s);
      setTenants(t.data);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = tenants.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.domain && t.domain.toLowerCase().includes(q))
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-secondary-100">
            Platform Administration
          </h1>
          <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-1">
            Manage all tenants, modules, and platform configuration
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          New Tenant
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Total Tenants" value={stats.tenants.total} icon={BuildingOffice2Icon} />
          <StatCard label="Active" value={stats.tenants.active} icon={BuildingOffice2Icon} color="text-green-500" />
          <StatCard label="Trial" value={stats.tenants.trial} icon={BuildingOffice2Icon} color="text-blue-500" />
          <StatCard label="Total Users" value={stats.users.total} icon={UsersIcon} />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
          <input
            type="text"
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="TRIAL">Trial</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* Tenants Table */}
      <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary-50 dark:bg-secondary-900/50 border-b border-secondary-200 dark:border-secondary-700">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400">Tenant</th>
              <th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400">Slug</th>
              <th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400">Status</th>
              <th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400">Tier</th>
              <th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400">Users</th>
              <th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400">Created</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100 dark:divide-secondary-700">
            {filtered.map((t) => (
              <tr key={t.id} className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors">
                <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">{t.name}</td>
                <td className="px-4 py-3 text-secondary-500 dark:text-secondary-400 font-mono text-xs">{t.slug}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] || ''}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-secondary-600 dark:text-secondary-300">{TIER_LABELS[t.tier] || t.tier}</td>
                <td className="px-4 py-3 text-secondary-600 dark:text-secondary-300">{t._count.users}</td>
                <td className="px-4 py-3 text-secondary-500 dark:text-secondary-400 text-xs">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/platform/tenants/${t.id}`}
                    className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 text-sm font-medium"
                  >
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-secondary-400">
                  No tenants found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateTenantModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadData(); }}
        />
      )}
    </div>
  );
}

function CreateTenantModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [tier, setTier] = useState('STARTER');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoSlug = (val: string) => {
    setName(val);
    if (!slug || slug === toSlug(name)) {
      setSlug(toSlug(val));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim() || !adminEmail.trim() || !adminPassword.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await platformService.createTenant({
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        adminEmail: adminEmail.trim(),
        adminPassword,
        adminFirstName: adminFirstName.trim() || undefined,
        adminLastName: adminLastName.trim() || undefined,
        tier,
      });
      onCreated();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to create tenant');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto pt-10 pb-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white dark:bg-secondary-900 rounded-2xl shadow-2xl border border-secondary-200 dark:border-secondary-700"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-200 dark:border-secondary-700">
          <h2 className="text-lg font-semibold text-secondary-900 dark:text-white">New Tenant</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-secondary-100 dark:hover:bg-secondary-700">
            <XMarkIcon className="h-5 w-5 text-secondary-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Company Name</label>
              <input type="text" required value={name} onChange={(e) => autoSlug(e.target.value)}
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Slug (URL)</label>
              <input type="text" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Tier</label>
              <select value={tier} onChange={(e) => setTier(e.target.value)}
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500">
                <option value="STARTER">Starter</option>
                <option value="PROFESSIONAL">Professional</option>
                <option value="ENTERPRISE">Enterprise</option>
              </select>
            </div>
          </div>

          <hr className="border-secondary-200 dark:border-secondary-700" />
          <p className="text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">Admin User</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">First Name</label>
              <input type="text" value={adminFirstName} onChange={(e) => setAdminFirstName(e.target.value)}
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Last Name</label>
              <input type="text" value={adminLastName} onChange={(e) => setAdminLastName(e.target.value)}
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Email</label>
              <input type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Password</label>
              <input type="password" required minLength={8} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-secondary-200 dark:border-secondary-700">
          <button type="button" onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim() || !slug.trim() || !adminEmail.trim() || !adminPassword.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50 transition-colors">
            {saving ? 'Creating…' : 'Create Tenant'}
          </button>
        </div>
      </form>
    </div>
  );
}

function toSlug(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function StatCard({
  label,
  value,
  icon: Icon,
  color = 'text-primary-500',
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="bg-white dark:bg-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-700 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold text-secondary-900 dark:text-secondary-100 mt-1">{value}</p>
        </div>
        <Icon className={`w-8 h-8 ${color}`} />
      </div>
    </div>
  );
}
