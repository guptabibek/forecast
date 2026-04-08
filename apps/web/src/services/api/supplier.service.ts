import { apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  paymentTerms?: string;
  currency?: string;
  defaultLeadTimeDays?: number;
  minimumOrderValue?: number;
  isActive: boolean;
  isPreferred: boolean;
  products?: SupplierProduct[];
}

export interface SupplierProduct {
  id: string;
  supplierId: string;
  productId: string;
  supplier?: { id: string; code: string; name: string };
  product?: { id: string; sku: string; name: string };
  supplyType: 'BUY' | 'MAKE' | 'TRANSFER' | 'SUBCONTRACT';
  supplierPartNumber?: string;
  unitCost?: number;
  currency?: string;
  leadTimeDays?: number;
  minimumOrderQty?: number;
  orderMultiple?: number;
  isPrimary: boolean;
}

// ============================================================================
// Supplier Service
// ============================================================================

export const supplierService = {
  // Suppliers
  async getAll(params?: {
    search?: string;
    isActive?: boolean;
    isPreferred?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get('/manufacturing/suppliers', { params });
    return response.data;
  },

  async getById(supplierId: string) {
    const response = await apiClient.get(`/manufacturing/suppliers/${supplierId}`);
    return response.data;
  },

  async create(dto: {
    code: string;
    name: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    paymentTerms?: string;
    currency?: string;
    defaultLeadTimeDays?: number;
    minimumOrderValue?: number;
    isActive?: boolean;
    isPreferred?: boolean;
  }) {
    const response = await apiClient.post('/manufacturing/suppliers', dto);
    return response.data;
  },

  async update(supplierId: string, dto: Partial<Supplier>) {
    const response = await apiClient.put(`/manufacturing/suppliers/${supplierId}`, dto);
    return response.data;
  },

  async delete(supplierId: string) {
    await apiClient.delete(`/manufacturing/suppliers/${supplierId}`);
  },

  // Supplier-Product Links
  async getSupplierProducts(supplierId: string, params?: {
    search?: string;
    supplyType?: string;
    page?: number;
    pageSize?: number;
  }) {
    const response = await apiClient.get(`/manufacturing/suppliers/${supplierId}/products`, { params });
    return response.data;
  },

  async getProductSuppliers(productId: string) {
    const response = await apiClient.get(`/manufacturing/suppliers/products/${productId}/suppliers`);
    return response.data;
  },

  async compareSuppliers(productId: string) {
    const response = await apiClient.get(`/manufacturing/suppliers/products/${productId}/compare`);
    return response.data;
  },

  async linkProduct(supplierId: string, dto: {
    productId: string;
    supplyType?: string;
    supplierPartNumber?: string;
    unitCost?: number;
    currency?: string;
    leadTimeDays?: number;
    minimumOrderQty?: number;
    orderMultiple?: number;
    isPrimary?: boolean;
  }) {
    const response = await apiClient.post(`/manufacturing/suppliers/${supplierId}/products`, dto);
    return response.data;
  },

  async bulkLinkProducts(supplierId: string, products: Array<{
    productId: string;
    supplyType?: string;
    supplierPartNumber?: string;
    unitCost?: number;
    leadTimeDays?: number;
    minimumOrderQty?: number;
    isPrimary?: boolean;
  }>) {
    const response = await apiClient.post(`/manufacturing/suppliers/${supplierId}/products/bulk`, { products });
    return response.data;
  },

  async updateProductLink(supplierId: string, productId: string, dto: Partial<SupplierProduct>) {
    const response = await apiClient.put(`/manufacturing/suppliers/${supplierId}/products/${productId}`, dto);
    return response.data;
  },

  async unlinkProduct(supplierId: string, productId: string) {
    await apiClient.delete(`/manufacturing/suppliers/${supplierId}/products/${productId}`);
  },

  async setPrimarySupplier(supplierId: string, productId: string) {
    const response = await apiClient.put(`/manufacturing/suppliers/${supplierId}/products/${productId}/set-primary`);
    return response.data;
  },

  // Analytics
  async getPerformance(supplierId: string, params?: {
    startDate?: string;
    endDate?: string;
  }) {
    const response = await apiClient.get(`/manufacturing/suppliers/${supplierId}/performance`, { params });
    return response.data;
  },

  async getSourcingSummary() {
    const response = await apiClient.get('/manufacturing/suppliers/summary');
    return response.data;
  },
};

export default supplierService;
