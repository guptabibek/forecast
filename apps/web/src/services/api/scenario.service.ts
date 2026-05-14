import type { Scenario, ScenarioType } from '@/types';
import { api } from './client';

export interface CreateScenarioDto {
  name: string;
  description?: string;
  planVersionId: string;
  scenarioType?: ScenarioType;
  color?: string;
  sortOrder?: number;
}

export interface UpdateScenarioDto {
  name?: string;
  description?: string;
  scenarioType?: ScenarioType;
  color?: string;
  sortOrder?: number;
}

export interface ScenarioComparison {
  baselineId: string;
  baselineName: string;
  scenarios: {
    id: string;
    name: string;
    scenarioType: ScenarioType;
    isBaseline: boolean;
    totalForecastAmount: number;
    variance: number;
    variancePercent: number;
    assumptionCount: number;
    forecastCount: number;
  }[];
}

export const scenarioService = {
  async getAll(params?: { planVersionId?: string }): Promise<Scenario[]> {
    try {
      const queryParams = params?.planVersionId ? { planVersionId: params.planVersionId } : undefined;
      const result = await api.get<Scenario[]>('/scenarios', queryParams);
      
      // Ensure we always return an array
      if (!result) {
        return [];
      }
      
      if (!Array.isArray(result)) {
        return [result] as Scenario[];
      }
      
      return result;
    } catch {
      return [];
    }
  },

  async getById(id: string): Promise<Scenario> {
    if (!id) {
      throw new Error('Scenario ID is required');
    }
    return api.get<Scenario>(`/scenarios/${id}`);
  },

  async create(dto: CreateScenarioDto): Promise<Scenario> {
    if (!dto.name?.trim()) {
      throw new Error('Scenario name is required');
    }
    if (!dto.planVersionId) {
      throw new Error('Plan version ID is required');
    }
    return api.post<Scenario>('/scenarios', dto);
  },

  async update(id: string, dto: UpdateScenarioDto): Promise<Scenario> {
    if (!id) {
      throw new Error('Scenario ID is required');
    }
    return api.patch<Scenario>(`/scenarios/${id}`, dto);
  },

  async delete(id: string): Promise<void> {
    if (!id) {
      throw new Error('Scenario ID is required');
    }
    await api.delete(`/scenarios/${id}`);
  },

  async compare(scenarioIds: string[]): Promise<ScenarioComparison> {
    if (!scenarioIds || scenarioIds.length === 0) {
      throw new Error('At least one scenario ID is required');
    }
    return api.get<ScenarioComparison>('/scenarios/compare', { ids: scenarioIds.join(',') });
  },

  async clone(id: string, name: string): Promise<Scenario> {
    if (!id) {
      throw new Error('Scenario ID is required');
    }
    if (!name?.trim()) {
      throw new Error('New scenario name is required');
    }
    return api.post<Scenario>(`/scenarios/${id}/clone`, { name });
  },

  async setBaseline(id: string): Promise<Scenario> {
    if (!id) {
      throw new Error('Scenario ID is required');
    }
    return api.post<Scenario>(`/scenarios/${id}/set-baseline`);
  },
};
