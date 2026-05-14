import { apiClient } from './client';

export type PurchaseInvoiceListItem = {
  id: string;
  invoiceNumber: string;
  documentDate: string | null;
  orderDate: string | null;
  status: string;
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  supplierPhone: string | null;
  supplierAddress: string | null;
  supplierGstn: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  voucher: string | null;
  vcn: string | null;
  orn: string | null;
  companyId: number | null;
  totalAmount: number;
  totalQty: number;
  lineCount: number;
  currency: string;
  notes: string | null;
  source: 'MARG_SYNC' | 'CORE_GRN';
};

export type PurchaseInvoiceLineItem = {
  id: string;
  lineNumber: number;
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number;
  lineAmount: number;
  uom: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  notes: string | null;
};

export type PurchaseInvoiceDetail = PurchaseInvoiceListItem & {
  receiptNumber: string;
  lines: PurchaseInvoiceLineItem[];
};

export type PurchaseInvoiceListResponse = {
  items: PurchaseInvoiceListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type PurchaseInvoiceListParams = {
  supplierId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  companyId?: number;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: string;
};

export const purchaseInvoiceService = {
  async list(params: PurchaseInvoiceListParams = {}): Promise<PurchaseInvoiceListResponse> {
    const response = await apiClient.get('/manufacturing/purchase-invoices', { params });
    return response.data;
  },

  async getById(id: string): Promise<PurchaseInvoiceDetail> {
    const response = await apiClient.get(`/manufacturing/purchase-invoices/${id}`);
    return response.data;
  },
};
