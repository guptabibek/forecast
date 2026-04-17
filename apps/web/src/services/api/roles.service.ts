import type { PermissionGroup, TenantRole } from '@/types';
import { api } from './client';

export const rolesService = {
  /** List all roles for the current tenant */
  listRoles: (): Promise<{ data: TenantRole[] }> =>
    api.get('/roles'),

  /** Get a single role */
  getRole: (id: string): Promise<{ data: TenantRole }> =>
    api.get(`/roles/${id}`),

  /** Get permission definitions */
  getPermissionDefinitions: (): Promise<{ data: Record<string, PermissionGroup> }> =>
    api.get('/roles/permissions'),

  /** Create a custom role */
  createRole: (data: {
    name: string;
    description?: string;
    moduleAccess?: Record<string, boolean>;
    permissions?: string[];
  }): Promise<{ data: TenantRole }> =>
    api.post('/roles', data),

  /** Update a role */
  updateRole: (id: string, data: {
    name?: string;
    description?: string;
    moduleAccess?: Record<string, boolean>;
    permissions?: string[];
    isDefault?: boolean;
  }): Promise<{ data: TenantRole }> =>
    api.patch(`/roles/${id}`, data),

  /** Delete a custom role */
  deleteRole: (id: string): Promise<void> =>
    api.delete(`/roles/${id}`),
};
