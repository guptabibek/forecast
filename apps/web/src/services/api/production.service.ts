import { apiClient } from './client';

// ============================================================================
// Production Branch Service
// ============================================================================

export const productionLineService = {
  async getAll() {
    const { data } = await apiClient.get('/manufacturing/production/lines');
    return data;
  },

  async getById(id: string) {
    const { data } = await apiClient.get(`/manufacturing/production/lines/${id}`);
    return data;
  },

  async create(dto: {
    code: string;
    name: string;
    description?: string;
    locationId?: string;
    status?: string;
    outputRate?: number;
    outputUom?: string;
  }) {
    const { data } = await apiClient.post('/manufacturing/production/lines', dto);
    return data;
  },

  async update(id: string, dto: {
    name?: string;
    description?: string;
    locationId?: string;
    status?: string;
    outputRate?: number;
    outputUom?: string;
  }) {
    const { data } = await apiClient.patch(`/manufacturing/production/lines/${id}`, dto);
    return data;
  },

  async delete(id: string) {
    const { data } = await apiClient.delete(`/manufacturing/production/lines/${id}`);
    return data;
  },

  async addStation(lineId: string, dto: {
    workCenterId: string;
    sequence: number;
    stationName?: string;
    isBottleneck?: boolean;
  }) {
    const { data } = await apiClient.post(`/manufacturing/production/lines/${lineId}/stations`, dto);
    return data;
  },

  async removeStation(lineId: string, stationId: string) {
    const { data } = await apiClient.delete(`/manufacturing/production/lines/${lineId}/stations/${stationId}`);
    return data;
  },
};

export const downtimeReasonService = {
  async getAll() {
    const { data } = await apiClient.get('/manufacturing/production/downtime-reasons');
    return data;
  },

  async create(dto: {
    code: string;
    name: string;
    category?: string;
    isPlanned?: boolean;
    isActive?: boolean;
  }) {
    const { data } = await apiClient.post('/manufacturing/production/downtime-reasons', dto);
    return data;
  },

  async update(id: string, dto: {
    name?: string;
    category?: string;
    isPlanned?: boolean;
    isActive?: boolean;
  }) {
    const { data } = await apiClient.patch(`/manufacturing/production/downtime-reasons/${id}`, dto);
    return data;
  },

  async delete(id: string) {
    const { data } = await apiClient.delete(`/manufacturing/production/downtime-reasons/${id}`);
    return data;
  },
};

export const downtimeRecordService = {
  async getAll(params?: {
    productionLineId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { data } = await apiClient.get('/manufacturing/production/downtime-records', { params });
    return data;
  },

  async create(dto: {
    downtimeReasonId: string;
    productionLineId: string;
    workOrderId?: string;
    startTime: string;
    endTime?: string;
    durationMinutes?: number;
    notes?: string;
  }) {
    const { data } = await apiClient.post('/manufacturing/production/downtime-records', dto);
    return data;
  },

  async update(id: string, dto: {
    endTime?: string;
    durationMinutes?: number;
    notes?: string;
  }) {
    const { data } = await apiClient.patch(`/manufacturing/production/downtime-records/${id}`, dto);
    return data;
  },

  async delete(id: string) {
    const { data } = await apiClient.delete(`/manufacturing/production/downtime-records/${id}`);
    return data;
  },
};

export const scrapReasonService = {
  async getAll() {
    const { data } = await apiClient.get('/manufacturing/production/scrap-reasons');
    return data;
  },

  async create(dto: {
    code: string;
    name: string;
    category?: string;
    isActive?: boolean;
  }) {
    const { data } = await apiClient.post('/manufacturing/production/scrap-reasons', dto);
    return data;
  },

  async update(id: string, dto: {
    name?: string;
    category?: string;
    isActive?: boolean;
  }) {
    const { data } = await apiClient.patch(`/manufacturing/production/scrap-reasons/${id}`, dto);
    return data;
  },

  async delete(id: string) {
    const { data } = await apiClient.delete(`/manufacturing/production/scrap-reasons/${id}`);
    return data;
  },
};

export const productionKpiService = {
  async get(params?: {
    productionLineId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { data } = await apiClient.get('/manufacturing/production/kpis', { params });
    return data;
  },
};
