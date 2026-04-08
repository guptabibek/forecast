import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier?: { id: string; name: string };
  orderDate: string;
  expectedDate: string;
  status: 'DRAFT' | 'RELEASED' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED';
  totalAmount?: number;
  notes?: string;
  releasedAt?: string;
  lines?: PurchaseOrderLine[];
  goodsReceipts?: GoodsReceipt[];
}

export interface PurchaseOrderLine {
  id: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  quantity: number;
  unitPrice: number;
  receivedQuantity: number;
}

export interface GoodsReceipt {
  id: string;
  grNumber: string;
  purchaseOrderId: string;
  receiptDate: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  notes?: string;
  lines?: GoodsReceiptLine[];
}

export interface GoodsReceiptLine {
  id: string;
  purchaseOrderLineId: string;
  quantity: number;
  lotNumber?: string;
}

export interface WorkOrder {
  id: string;
  woNumber: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  quantity: number;
  completedQuantity: number;
  scrapQuantity: number;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart?: string;
  actualEnd?: string;
  status: 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: number;
  workCenterId?: string;
  workCenter?: { id: string; name: string };
  bomId?: string;
  routingId?: string;
  notes?: string;
  operations?: WorkOrderOperation[];
  materialIssues?: MaterialIssue[];
  completions?: ProductionCompletion[];
}

export interface WorkOrderOperation {
  id: string;
  sequence: number;
  operationName: string;
  workCenterId?: string;
  workCenter?: { id: string; name: string };
  plannedSetupTime: number;
  plannedRunTime: number;
  actualSetupTime?: number;
  actualRunTime?: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  actualStart?: string;
  actualEnd?: string;
  notes?: string;
  laborEntries?: LaborEntry[];
}

export interface MaterialIssue {
  id: string;
  workOrderId: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  quantity: number;
  issueDate: string;
  lotNumber?: string;
  notes?: string;
}

export interface ProductionCompletion {
  id: string;
  workOrderId: string;
  operationId?: string;
  quantity: number;
  scrapQuantity: number;
  completionDate: string;
  lotNumber?: string;
  notes?: string;
}

export interface LaborEntry {
  id: string;
  operationId: string;
  laborType: 'SETUP' | 'RUN' | 'TEARDOWN' | 'REWORK';
  startTime: string;
  endTime: string;
  hours: number;
  employeeId?: string;
  notes?: string;
}

export interface InventoryTransaction {
  id: string;
  productId: string;
  product?: { id: string; sku: string; name: string };
  transactionType: 'RECEIPT' | 'ISSUE' | 'TRANSFER' | 'ADJUSTMENT' | 'PRODUCTION' | 'SCRAP' | 'RETURN';
  quantity: number;
  transactionDate: string;
  referenceType?: string;
  referenceId?: string;
  fromLocation?: string;
  toLocation?: string;
  lotNumber?: string;
  notes?: string;
}

export interface ActionMessage {
  type: 'EXPEDITE' | 'DEFER' | 'CANCEL' | 'INCREASE' | 'DECREASE';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  orderType: string;
  orderId: string;
  orderNumber: string;
  productSku: string;
  message: string;
  suggestedAction: string;
}

export interface Pegging {
  product: {
    id: string;
    sku: string;
    name: string;
    currentStock: number;
    safetyStock: number;
  };
  demand: Array<{
    type: string;
    orderId: string;
    orderNumber: string;
    parentProduct?: string;
    quantity: number;
    dueDate: string;
  }>;
  supply: Array<{
    type: string;
    orderId: string;
    orderNumber: string;
    supplier?: string;
    quantity: number;
    expectedDate: string;
  }>;
  netPosition: number;
}

export interface ScheduledReceipt {
  type: string;
  orderId: string;
  orderNumber: string;
  productId: string;
  productSku: string;
  quantity: number;
  expectedDate: string;
  status: string;
}

// ============================================================================
// Purchase Order Service
// ============================================================================

export const purchaseOrderService = {
  async getAll(params?: {
    status?: string;
    supplierId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PurchaseOrder[]> {
    const response = await apiClient.get('/manufacturing/purchase-orders', { params });
    return response.data;
  },

  async getById(id: string): Promise<PurchaseOrder> {
    const response = await apiClient.get(`/manufacturing/purchase-orders/${id}`);
    return response.data;
  },

  async create(dto: {
    supplierId: string;
    expectedDate: string;
    lines: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
    }>;
    notes?: string;
  }): Promise<PurchaseOrder> {
    const response = await apiClient.post('/manufacturing/purchase-orders', dto);
    return response.data;
  },

  async update(id: string, dto: {
    expectedDate?: string;
    notes?: string;
    lines?: Array<{
      id?: string;
      productId: string;
      quantity: number;
      unitPrice: number;
    }>;
  }): Promise<PurchaseOrder> {
    const response = await apiClient.put(`/manufacturing/purchase-orders/${id}`, dto);
    return response.data;
  },

  async release(id: string): Promise<PurchaseOrder> {
    const response = await apiClient.post(`/manufacturing/purchase-orders/${id}/release`);
    return response.data;
  },

  async cancel(id: string, reason?: string): Promise<PurchaseOrder> {
    const response = await apiClient.post(`/manufacturing/purchase-orders/${id}/cancel`, { reason });
    return response.data;
  },

  async convertFromPlanned(plannedOrderIds: string[]): Promise<PurchaseOrder[]> {
    const response = await apiClient.post('/manufacturing/purchase-orders/convert-from-planned', {
      plannedOrderIds,
    });
    return response.data;
  },
};

// ============================================================================
// Goods Receipt Service
// ============================================================================

export const goodsReceiptService = {
  async create(dto: {
    purchaseOrderId: string;
    lines: Array<{
      purchaseOrderLineId: string;
      quantity: number;
      lotNumber?: string;
    }>;
    notes?: string;
  }): Promise<GoodsReceipt> {
    const response = await apiClient.post('/manufacturing/goods-receipts', dto);
    return response.data;
  },

  async confirm(id: string): Promise<GoodsReceipt> {
    const response = await apiClient.post(`/manufacturing/goods-receipts/${id}/confirm`);
    return response.data;
  },
};

// ============================================================================
// Work Order Service
// ============================================================================

export const workOrderService = {
  async getAll(params?: {
    status?: string;
    workCenterId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<WorkOrder[]> {
    const response = await apiClient.get('/manufacturing/work-orders', { params });
    return response.data;
  },

  async getById(id: string): Promise<WorkOrder> {
    const response = await apiClient.get(`/manufacturing/work-orders/${id}`);
    return response.data;
  },

  async create(dto: {
    productId: string;
    quantity: number;
    scheduledStart: string;
    scheduledEnd: string;
    workCenterId?: string;
    bomId?: string;
    routingId?: string;
    priority?: number;
    notes?: string;
  }): Promise<WorkOrder> {
    const response = await apiClient.post('/manufacturing/work-orders', dto);
    return response.data;
  },

  async release(id: string): Promise<WorkOrder> {
    const response = await apiClient.post(`/manufacturing/work-orders/${id}/release`);
    return response.data;
  },

  async start(id: string): Promise<WorkOrder> {
    const response = await apiClient.post(`/manufacturing/work-orders/${id}/start`);
    return response.data;
  },

  async complete(id: string): Promise<WorkOrder> {
    const response = await apiClient.post(`/manufacturing/work-orders/${id}/complete`);
    return response.data;
  },

  async cancel(id: string, reason?: string): Promise<WorkOrder> {
    const response = await apiClient.post(`/manufacturing/work-orders/${id}/cancel`, { reason });
    return response.data;
  },

  async convertFromPlanned(plannedOrderIds: string[]): Promise<WorkOrder[]> {
    const response = await apiClient.post('/manufacturing/work-orders/convert-from-planned', {
      plannedOrderIds,
    });
    return response.data;
  },

  async backflush(id: string, completedQty: number): Promise<MaterialIssue[]> {
    const response = await apiClient.post(`/manufacturing/work-orders/${id}/backflush`, {
      completedQty,
    });
    return response.data;
  },

  async getLaborEntries(id: string): Promise<LaborEntry[]> {
    const response = await apiClient.get(`/manufacturing/work-orders/${id}/labor-entries`);
    return response.data;
  },
};

// ============================================================================
// Operation Service
// ============================================================================

export const operationService = {
  async start(operationId: string): Promise<WorkOrderOperation> {
    const response = await apiClient.post(`/manufacturing/operations/${operationId}/start`);
    return response.data;
  },

  async complete(operationId: string, dto: {
    actualSetupTime?: number;
    actualRunTime?: number;
    notes?: string;
  }): Promise<WorkOrderOperation> {
    const response = await apiClient.post(`/manufacturing/operations/${operationId}/complete`, dto);
    return response.data;
  },
};

// ============================================================================
// Material Issue Service
// ============================================================================

export const materialIssueService = {
  async issue(dto: {
    workOrderId: string;
    productId: string;
    quantity: number;
    lotNumber?: string;
    notes?: string;
  }): Promise<MaterialIssue> {
    const response = await apiClient.post('/manufacturing/material-issues', dto);
    return response.data;
  },
};

// ============================================================================
// Production Completion Service
// ============================================================================

export const productionCompletionService = {
  async report(dto: {
    workOrderId: string;
    quantity: number;
    scrapQuantity?: number;
    operationId?: string;
    lotNumber?: string;
    notes?: string;
  }): Promise<ProductionCompletion> {
    const response = await apiClient.post('/manufacturing/production-completions', dto);
    return response.data;
  },
};

// ============================================================================
// Labor Entry Service
// ============================================================================

export const laborEntryService = {
  async record(dto: {
    operationId: string;
    laborType: 'SETUP' | 'RUN' | 'TEARDOWN' | 'REWORK';
    startTime: string;
    endTime: string;
    employeeId?: string;
    notes?: string;
  }): Promise<LaborEntry> {
    const response = await apiClient.post('/manufacturing/labor-entries', dto);
    return response.data;
  },
};

// ============================================================================
// Inventory Transaction Service
// ============================================================================

export const inventoryTransactionService = {
  async getAll(params?: {
    productId?: string;
    transactionType?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<InventoryTransaction[]> {
    const response = await apiClient.get('/manufacturing/inventory-transactions', { params });
    return response.data;
  },

  async create(dto: {
    productId: string;
    transactionType: string;
    quantity: number;
    referenceType?: string;
    referenceId?: string;
    fromLocation?: string;
    toLocation?: string;
    lotNumber?: string;
    notes?: string;
  }): Promise<InventoryTransaction> {
    const response = await apiClient.post('/manufacturing/inventory-transactions', dto);
    return response.data;
  },

  async adjust(dto: {
    productId: string;
    quantity: number;
    reason: string;
  }): Promise<InventoryTransaction> {
    const response = await apiClient.post('/manufacturing/inventory-adjustments', dto);
    return response.data;
  },

  async transfer(dto: {
    productId: string;
    quantity: number;
    fromLocation: string;
    toLocation: string;
    notes?: string;
  }): Promise<InventoryTransaction> {
    const response = await apiClient.post('/manufacturing/inventory-transfers', dto);
    return response.data;
  },
};

// ============================================================================
// MRP Advanced Features Service
// ============================================================================

export const mrpAdvancedService = {
  async getActionMessages(): Promise<ActionMessage[]> {
    const response = await apiClient.get('/manufacturing/action-messages');
    return response.data;
  },

  async getPegging(productId: string): Promise<Pegging> {
    const response = await apiClient.get(`/manufacturing/pegging/${productId}`);
    return response.data;
  },

  async getScheduledReceipts(productId?: string): Promise<ScheduledReceipt[]> {
    const response = await apiClient.get('/manufacturing/scheduled-receipts', {
      params: productId ? { productId } : undefined,
    });
    return response.data;
  },
};

// Export all services
export default {
  purchaseOrder: purchaseOrderService,
  goodsReceipt: goodsReceiptService,
  workOrder: workOrderService,
  operation: operationService,
  materialIssue: materialIssueService,
  productionCompletion: productionCompletionService,
  laborEntry: laborEntryService,
  inventoryTransaction: inventoryTransactionService,
  mrpAdvanced: mrpAdvancedService,
};
