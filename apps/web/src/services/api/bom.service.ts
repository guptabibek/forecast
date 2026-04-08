import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface BOM {
  id: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  bomType: 'ENGINEERING' | 'MANUFACTURING' | 'PLANNING' | 'COSTING';
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'OBSOLETE';
  revision: string;
  effectiveDate?: string;
  expiryDate?: string;
  standardCost?: number;
  components?: BOMComponent[];
}

export interface BOMComponent {
  id: string;
  bomId: string;
  componentProductId: string;
  componentProduct?: { id: string; sku: string; name: string };
  quantityPer: number;
  uom?: string;
  isPhantom: boolean;
  position?: number;
  wastagePercent?: number;
  componentCost?: number;
}

export interface ExplodedBOM {
  productId: string;
  product: Record<string, unknown>;
  level: number;
  quantityPer: number;
  extendedQuantity: number;
  unitCost: number;
  extendedCost: number;
  children: ExplodedBOM[];
}

// Type alias for backward compatibility
export type BillOfMaterial = BOM;

// ============================================================================
// BOM Service
// ============================================================================

export const bomService = {
  // CRUD
  async getBOMs(params?: {
    productId?: string;
    bomType?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/bom', { params });
    return response.data;
  },

  async getBOM(bomId: string) {
    const response = await apiClient.get(`/manufacturing/bom/${bomId}`);
    return response.data;
  },

  async createBOM(dto: {
    productId: string;
    bomType: string;
    revision?: string;
    effectiveDate?: string;
    expiryDate?: string;
    notes?: string;
    components?: Array<{
      componentProductId: string;
      quantityPer: number;
      uom?: string;
      isPhantom?: boolean;
      position?: number;
      wastagePercent?: number;
    }>;
  }) {
    const response = await apiClient.post('/manufacturing/bom', dto);
    return response.data;
  },

  async updateBOM(bomId: string, dto: Partial<BOM>) {
    const response = await apiClient.put(`/manufacturing/bom/${bomId}`, dto);
    return response.data;
  },

  async deleteBOM(bomId: string) {
    await apiClient.delete(`/manufacturing/bom/${bomId}`);
  },

  async updateBOMStatus(bomId: string, status: string) {
    const response = await apiClient.put(`/manufacturing/bom/${bomId}/status`, { status });
    return response.data;
  },

  // Components
  async addComponent(bomId: string, dto: {
    componentProductId: string;
    quantityPer: number;
    uom?: string;
    isPhantom?: boolean;
    position?: number;
    wastagePercent?: number;
  }) {
    const response = await apiClient.post(`/manufacturing/bom/${bomId}/components`, dto);
    return response.data;
  },

  async updateComponent(componentId: string, dto: Partial<BOMComponent>) {
    const response = await apiClient.put(`/manufacturing/bom/components/${componentId}`, dto);
    return response.data;
  },

  async removeComponent(componentId: string) {
    await apiClient.delete(`/manufacturing/bom/components/${componentId}`);
  },

  // Advanced Operations
  async explodeBOM(bomId: string, levels?: number, includePhantoms?: boolean) {
    const response = await apiClient.post(`/manufacturing/bom/${bomId}/explode`, {
      levels,
      includePhantoms,
    });
    return response.data;
  },

  async costRollup(bomId: string) {
    const response = await apiClient.post(`/manufacturing/bom/${bomId}/cost-rollup`);
    return response.data;
  },

  async getWhereUsed(productId: string, levels?: number) {
    const response = await apiClient.get(`/manufacturing/bom/where-used/${productId}`, {
      params: { levels },
    });
    return response.data;
  },

  async copyBOM(bomId: string, dto: {
    targetProductId: string;
    newRevision?: string;
    copyComponents?: boolean;
  }) {
    const response = await apiClient.post(`/manufacturing/bom/${bomId}/copy`, dto);
    return response.data;
  },

  async compareBOMs(bomIdsOrId1: string[] | string, bomId2?: string) {
    let id1: string;
    let id2: string;
    if (Array.isArray(bomIdsOrId1)) {
      [id1, id2] = bomIdsOrId1;
    } else {
      id1 = bomIdsOrId1;
      id2 = bomId2!;
    }
    const response = await apiClient.get(`/manufacturing/bom/compare/${id1}/${id2}`);
    return response.data;
  },

  // Alias for hook compatibility: get components from BOM detail
  async getComponents(bomId: string) {
    const bom = await bomService.getBOM(bomId);
    return bom.components || [];
  },
};

export default bomService;
