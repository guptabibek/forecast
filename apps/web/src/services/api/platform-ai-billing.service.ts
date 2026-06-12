import { apiClient } from './client';
import type { AiDisputeStatus, AiPurchaseStatus } from './ai-billing.service';

export interface AiBillingOverview {
  totalRevenue: string;
  creditsSold: string;
  creditsConsumed: string;
  providerCost: string;
  customerCharged: string;
  profitMargin: string;
  marginPct: number | null;
  outstandingCredits: string;
  walletCount: number;
  refundAmount: string;
  refundCount: number;
  openDisputes: number;
  totalRequests: number;
  totalTokens: number;
}

export interface AiBillingTrendPoint {
  date: string;
  revenue: number;
  consumed: number;
  providerCost: number;
  customerCharge: number;
  requests: number;
}

export interface AiBillingProvider {
  id: string;
  name: string;
  kind: string;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  endpointUrl: string | null;
  priority: number;
  status: 'ACTIVE' | 'DISABLED';
  _count?: { models: number };
}

export interface AiBillingModel {
  id: string;
  providerId: string;
  modelCode: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  maxContext: number | null;
  isDefault: boolean;
  provider?: { name: string; kind: string; status: string };
  activePricingCount?: number;
  hasGlobalPricing?: boolean;
}

export interface AiPricingRow {
  id: string;
  modelId: string;
  scope: 'GLOBAL' | 'PLAN' | 'TENANT';
  planTier: string | null;
  tenantId: string | null;
  status: 'ACTIVE' | 'DISABLED';
  effectiveFrom: string;
  effectiveTo: string | null;
  providerInputCost: string;
  providerOutputCost: string;
  customerInputPrice: string;
  customerOutputPrice: string;
  model?: { modelCode: string; displayName: string };
}

export interface AiModelReportRow {
  provider_name: string;
  model_code: string;
  requests: string | number;
  total_tokens: string | number;
  provider_cost: string | number;
  customer_charge: string | number;
  margin: string | number;
}

export interface AiTenantReportRow {
  tenant_id: string;
  tenant_name: string;
  requests: string | number;
  total_tokens: string | number;
  customer_charge: string | number;
  provider_cost: string | number;
  balance: string | number | null;
}

export const platformAiBillingService = {
  async overview(): Promise<AiBillingOverview> {
    const { data } = await apiClient.get('/platform/ai-billing/overview');
    return data;
  },
  async trends(days = 30): Promise<AiBillingTrendPoint[]> {
    const { data } = await apiClient.get('/platform/ai-billing/trends', { params: { days } });
    return data;
  },
  async modelReport(days = 30): Promise<AiModelReportRow[]> {
    const { data } = await apiClient.get('/platform/ai-billing/reports/models', { params: { days } });
    return data;
  },
  async tenantReport(days = 30): Promise<AiTenantReportRow[]> {
    const { data } = await apiClient.get('/platform/ai-billing/reports/tenants', { params: { days } });
    return data;
  },

  async listProviders(): Promise<AiBillingProvider[]> {
    const { data } = await apiClient.get('/platform/ai-billing/providers');
    return data;
  },
  async createProvider(input: Partial<AiBillingProvider> & { apiKey?: string }): Promise<AiBillingProvider> {
    const { data } = await apiClient.post('/platform/ai-billing/providers', input);
    return data;
  },
  async updateProvider(id: string, input: Record<string, unknown>): Promise<AiBillingProvider> {
    const { data } = await apiClient.patch(`/platform/ai-billing/providers/${id}`, input);
    return data;
  },
  async deleteProvider(id: string): Promise<{ deleted: boolean }> {
    const { data } = await apiClient.delete(`/platform/ai-billing/providers/${id}`);
    return data;
  },

  async listModels(): Promise<AiBillingModel[]> {
    const { data } = await apiClient.get('/platform/ai-billing/models');
    return data;
  },
  async createModel(input: Record<string, unknown>): Promise<AiBillingModel> {
    const { data } = await apiClient.post('/platform/ai-billing/models', input);
    return data;
  },
  async updateModel(id: string, input: Record<string, unknown>): Promise<AiBillingModel> {
    const { data } = await apiClient.patch(`/platform/ai-billing/models/${id}`, input);
    return data;
  },
  async deleteModel(id: string): Promise<{ deleted: boolean }> {
    const { data } = await apiClient.delete(`/platform/ai-billing/models/${id}`);
    return data;
  },

  async listPricing(): Promise<AiPricingRow[]> {
    const { data } = await apiClient.get('/platform/ai-billing/pricing');
    return data;
  },
  async createPricing(input: Record<string, unknown>): Promise<AiPricingRow> {
    const { data } = await apiClient.post('/platform/ai-billing/pricing', input);
    return data;
  },
  async updatePricing(id: string, input: Record<string, unknown>): Promise<AiPricingRow> {
    const { data } = await apiClient.patch(`/platform/ai-billing/pricing/${id}`, input);
    return data;
  },
  async simulate(input: { modelId: string; tenantId?: string; planTier?: string; promptTokens: number; completionTokens: number }) {
    const { data } = await apiClient.post('/platform/ai-billing/pricing/simulate', input);
    return data as { providerCost: string; customerCharge: string; margin: string; marginPct: number | null };
  },

  async wallet(tenantId: string) {
    const { data } = await apiClient.get(`/platform/ai-billing/wallets/${tenantId}`);
    return data;
  },
  async walletLedger(tenantId: string, page = 1) {
    const { data } = await apiClient.get(`/platform/ai-billing/wallets/${tenantId}/transactions`, { params: { page } });
    return data;
  },
  async adjustWallet(tenantId: string, input: { amount: number; type: string; reason: string }) {
    const { data } = await apiClient.post(`/platform/ai-billing/wallets/${tenantId}/adjustments`, input);
    return data;
  },
  async updateWalletSettings(tenantId: string, input: Record<string, unknown>) {
    const { data } = await apiClient.patch(`/platform/ai-billing/wallets/${tenantId}/settings`, input);
    return data;
  },

  async reviewQueue(status?: AiPurchaseStatus) {
    const { data } = await apiClient.get('/platform/ai-billing/purchases/review-queue', { params: { status } });
    return data;
  },
  async reviewPurchase(id: string, approve: boolean, note?: string) {
    const { data } = await apiClient.post(`/platform/ai-billing/purchases/${id}/review`, { approve, note });
    return data;
  },

  async listDisputes(status?: AiDisputeStatus) {
    const { data } = await apiClient.get('/platform/ai-billing/disputes', { params: { status } });
    return data;
  },
  async getDispute(id: string) {
    const { data } = await apiClient.get(`/platform/ai-billing/disputes/${id}`);
    return data;
  },
  async disputeAction(id: string, action: Record<string, unknown>) {
    const { data } = await apiClient.post(`/platform/ai-billing/disputes/${id}/actions`, action);
    return data;
  },
  async replyDispute(id: string, body: string) {
    const { data } = await apiClient.post(`/platform/ai-billing/disputes/${id}/messages`, { body });
    return data;
  },

  async listRefunds() {
    const { data } = await apiClient.get('/platform/ai-billing/refunds');
    return data;
  },
  async createRefund(input: Record<string, unknown>) {
    const { data } = await apiClient.post('/platform/ai-billing/refunds', input);
    return data;
  },

  async auditLog(page = 1) {
    const { data } = await apiClient.get('/platform/ai-billing/audit-log', { params: { page } });
    return data;
  },
};
