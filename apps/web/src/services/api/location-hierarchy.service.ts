import type { LocationHierarchy } from '../../types';
import { apiClient } from './client';

// ============================================================================
// Location Hierarchy Service
// ============================================================================

export const locationHierarchyService = {
  async getAll(params?: {
    hierarchyType?: string;
    locationId?: string;
    parentId?: string;
    level?: number;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/location-hierarchy', { params });
    return response.data;
  },

  async getById(id: string) {
    const response = await apiClient.get(`/manufacturing/location-hierarchy/${id}`);
    return response.data;
  },

  async create(dto: {
    locationId: string;
    parentId?: string;
    level?: number;
    hierarchyType?: string;
    path?: string;
  }) {
    const response = await apiClient.post('/manufacturing/location-hierarchy', dto);
    return response.data;
  },

  async update(id: string, dto: Partial<LocationHierarchy>) {
    const response = await apiClient.patch(`/manufacturing/location-hierarchy/${id}`, dto);
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/manufacturing/location-hierarchy/${id}`);
  },

  async getTree(hierarchyType?: string) {
    const response = await apiClient.get('/manufacturing/location-hierarchy/tree', {
      params: { hierarchyType },
    });
    return response.data;
  },
};
