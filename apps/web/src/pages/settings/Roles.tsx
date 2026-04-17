import { useAuthStore } from '@/stores/auth.store';
import type { PermissionGroup, TenantRole } from '@/types';
import {
    PencilIcon,
    PlusIcon,
    ShieldCheckIcon,
    TrashIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { platformService } from '@services/api/platform.service';
import { rolesService } from '@services/api/roles.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCallback, useMemo, useState } from 'react';

const ALL_MODULES = [
  { key: 'planning', label: 'Planning' },
  { key: 'forecasting', label: 'Forecasting' },
  { key: 'manufacturing', label: 'Manufacturing' },
  { key: 'reports', label: 'Reports' },
  { key: 'data', label: 'Data Management' },
  { key: 'marg-ede', label: 'Marg EDE' },
] as const;

/** Maps permission-group keys to the tenant module they belong to.
 *  Groups not listed here (dashboard, settings, users, roles) are always visible. */
const PERM_GROUP_TO_MODULE: Record<string, string> = {
  plan: 'planning',
  forecast: 'forecasting',
  scenario: 'forecasting',
  manufacturing: 'manufacturing',
  report: 'reports',
  data: 'data',
};

export default function RolesPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  // ── Queries ──
  const { data: rolesData, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => rolesService.listRoles(),
  });

  const { data: permDefsData } = useQuery({
    queryKey: ['permission-definitions'],
    queryFn: () => rolesService.getPermissionDefinitions(),
  });

  const { data: tenantModulesData, isLoading: isModulesLoading } = useQuery({
    queryKey: ['platform', 'my-modules'],
    queryFn: () => platformService.getMyModules(),
    staleTime: 2 * 60 * 1000,
  });

  const roles = rolesData?.data ?? [];
  const permissionDefs = permDefsData?.data ?? {};
  const availableModules = useMemo(
    () => ALL_MODULES.filter(({ key }) => tenantModulesData?.[key] !== false),
    [tenantModulesData],
  );
  const availableModuleKeys = useMemo(
    () => new Set<string>(availableModules.map(({ key }) => key)),
    [availableModules],
  );
  const sanitizeModules = useCallback(
    (moduleAccess?: Record<string, boolean> | null) => {
      const next: Record<string, boolean> = {};
      for (const { key } of availableModules) {
        next[key] = Boolean(moduleAccess?.[key]);
      }
      return next;
    },
    [availableModules],
  );

  // ── Editor state ──
  const [editing, setEditing] = useState<TenantRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formModules, setFormModules] = useState<Record<string, boolean>>({});
  const [formPerms, setFormPerms] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const openCreate = useCallback(() => {
    setEditing(null);
    setCreating(true);
    setFormName('');
    setFormDesc('');
    setFormModules(sanitizeModules());
    setFormPerms(new Set());
    setError(null);
  }, [sanitizeModules]);

  const openEdit = useCallback((role: TenantRole) => {
    setEditing(role);
    setCreating(true);
    setFormName(role.name);
    setFormDesc(role.description ?? '');
    setFormModules(sanitizeModules(role.moduleAccess));
    setFormPerms(new Set(role.permissions));
    setError(null);
  }, [sanitizeModules]);

  const closeEditor = useCallback(() => {
    setEditing(null);
    setCreating(false);
    setError(null);
  }, []);

  // ── Mutations ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        moduleAccess: sanitizeModules(formModules),
        permissions: Array.from(formPerms),
      };
      if (editing) {
        return rolesService.updateRole(editing.id, payload);
      }
      return rolesService.createRole(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      closeEditor();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'Failed to save role');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rolesService.deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  // ── Permission helpers ──
  const toggleModule = (key: string) => {
    if (!availableModuleKeys.has(key)) {
      return;
    }
    setFormModules((m) => ({ ...m, [key]: !m[key] }));
  };

  const togglePerm = (key: string) => {
    setFormPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroupAll = (group: PermissionGroup) => {
    const keys = group.permissions.map((p) => p.key);
    const allChecked = keys.every((k) => formPerms.has(k));
    setFormPerms((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (allChecked ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-secondary-500">You do not have permission to manage roles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Roles & Permissions</h1>
          <p className="mt-1 text-sm text-secondary-500 dark:text-secondary-400">
            Configure dynamic roles with module access and action-level permissions.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          New Role
        </button>
      </div>

      {/* Roles list */}
      <div className="bg-white dark:bg-secondary-900 rounded-xl border border-secondary-200 dark:border-secondary-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-secondary-500">Loading roles…</div>
        ) : roles.length === 0 ? (
          <div className="p-8 text-center text-secondary-500">No roles configured yet.</div>
        ) : (
          <table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
            <thead className="bg-secondary-50 dark:bg-secondary-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">Modules</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">Permissions</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">Users</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
              {roles.map((role) => {
                const moduleCount = Object.entries(role.moduleAccess ?? {}).filter(
                  ([key, enabled]) => availableModuleKeys.has(key) && Boolean(enabled),
                ).length;
                const permCount = Array.isArray(role.permissions) ? role.permissions.length : 0;
                return (
                  <tr key={role.id} className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <ShieldCheckIcon className="h-5 w-5 text-primary-500" />
                        <div>
                          <div className="text-sm font-medium text-secondary-900 dark:text-white">
                            {role.name}
                            {role.isSystem && (
                              <span className="ml-2 inline-flex items-center rounded-full bg-secondary-100 dark:bg-secondary-700 px-2 py-0.5 text-xs font-medium text-secondary-600 dark:text-secondary-300">
                                System
                              </span>
                            )}
                            {role.isDefault && (
                              <span className="ml-1 inline-flex items-center rounded-full bg-primary-100 dark:bg-primary-900/50 px-2 py-0.5 text-xs font-medium text-primary-600 dark:text-primary-300">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-secondary-500 dark:text-secondary-400">{role.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary-600 dark:text-secondary-300">
                      {moduleCount} / {availableModules.length}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary-600 dark:text-secondary-300">
                      {permCount}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary-600 dark:text-secondary-300">
                      {role.userCount ?? 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(role)}
                          className="rounded-lg p-1.5 text-secondary-500 hover:bg-secondary-100 dark:hover:bg-secondary-700"
                          title="Edit"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        {!role.isSystem && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete role "${role.name}"?`)) {
                                deleteMutation.mutate(role.id);
                              }
                            }}
                            className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            title="Delete"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit panel */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto pt-10 pb-10">
          <div className="w-full max-w-3xl bg-white dark:bg-secondary-900 rounded-2xl shadow-2xl border border-secondary-200 dark:border-secondary-700">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-200 dark:border-secondary-700">
              <h2 className="text-lg font-semibold text-secondary-900 dark:text-white">
                {editing ? `Edit: ${editing.name}` : 'New Role'}
              </h2>
              <button onClick={closeEditor} className="rounded-lg p-1 hover:bg-secondary-100 dark:hover:bg-secondary-700">
                <XMarkIcon className="h-5 w-5 text-secondary-500" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-6 max-h-[70vh] overflow-y-auto">
              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* Name + Description */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Role Name
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    disabled={editing?.isSystem}
                    className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm text-secondary-900 dark:text-white focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                    placeholder="e.g. Regional Manager"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    disabled={editing?.isSystem}
                    className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 px-3 py-2 text-sm text-secondary-900 dark:text-white focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                    placeholder="Brief description"
                  />
                </div>
              </div>

              {/* Module Access */}
              <div>
                <h3 className="text-sm font-semibold text-secondary-800 dark:text-secondary-200 mb-2">Module Access</h3>
                {isModulesLoading ? (
                  <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 px-3 py-2 text-sm text-secondary-500 dark:text-secondary-400">
                    Loading tenant module availability…
                  </div>
                ) : availableModules.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                    No modules are enabled for this tenant. Ask the platform admin to enable modules first.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {availableModules.map(({ key, label }) => (
                      <label
                        key={key}
                        className={clsx(
                          'flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors text-sm',
                          formModules[key]
                            ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                            : 'border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-400 hover:bg-secondary-50 dark:hover:bg-secondary-800',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={!!formModules[key]}
                          onChange={() => toggleModule(key)}
                          className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Permissions */}
              <div>
                <h3 className="text-sm font-semibold text-secondary-800 dark:text-secondary-200 mb-2">Permissions</h3>
                <div className="space-y-3">
                  {Object.entries(permissionDefs).filter(([groupKey]) => {
                    const requiredModule = PERM_GROUP_TO_MODULE[groupKey];
                    return !requiredModule || availableModuleKeys.has(requiredModule);
                  }).map(([groupKey, group]) => {
                    const g = group as PermissionGroup;
                    const keys = g.permissions.map((p) => p.key);
                    const allChecked = keys.every((k) => formPerms.has(k));
                    const someChecked = keys.some((k) => formPerms.has(k));
                    return (
                      <div key={groupKey} className="rounded-lg border border-secondary-200 dark:border-secondary-700 overflow-hidden">
                        <div
                          className="flex items-center gap-2 px-3 py-2 bg-secondary-50 dark:bg-secondary-800 cursor-pointer"
                          onClick={() => toggleGroupAll(g)}
                        >
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = someChecked && !allChecked;
                            }}
                            onChange={() => toggleGroupAll(g)}
                            className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">{g.label}</span>
                          <span className="text-xs text-secondary-400">
                            ({keys.filter((k) => formPerms.has(k)).length}/{keys.length})
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 px-3 py-2">
                          {g.permissions.map((p) => (
                            <label key={p.key} className="flex items-center gap-2 text-xs text-secondary-600 dark:text-secondary-400 cursor-pointer hover:text-secondary-900 dark:hover:text-secondary-200">
                              <input
                                type="checkbox"
                                checked={formPerms.has(p.key)}
                                onChange={() => togglePerm(p.key)}
                                className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                              />
                              {p.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-secondary-200 dark:border-secondary-700">
              <button
                onClick={closeEditor}
                className="rounded-lg px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!formName.trim() || saveMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {saveMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
