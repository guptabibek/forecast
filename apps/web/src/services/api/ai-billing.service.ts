import { apiClient } from './client';

export type AiLedgerType =
  | 'PURCHASE' | 'MANUAL_CREDIT' | 'USAGE_CHARGE' | 'REFUND' | 'BONUS_CREDIT' | 'PROMO_CREDIT'
  | 'DISPUTE_RESOLUTION' | 'CHARGE_REVERSAL' | 'CREDIT_EXPIRY' | 'ADMIN_ADJUSTMENT' | 'CORRECTION';
export type AiPurchaseStatus = 'PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
export type AiDisputeStatus = 'OPEN' | 'UNDER_INVESTIGATION' | 'AWAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
export type AiDisputeType =
  | 'UNEXPECTED_CHARGE' | 'DUPLICATE_CHARGE' | 'FAILED_REQUEST'
  | 'INCORRECT_BILLING' | 'REFUND_REQUEST' | 'TOKEN_USAGE_DISAGREEMENT';

export interface AiWalletSummary {
  id: string;
  tenantId: string;
  currency: string;
  balance: string;
  reservedBalance: string;
  availableBalance: string;
  totalPurchased: string;
  totalConsumed: string;
  totalRefunded: string;
  totalAdjusted: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  balanceState: 'ok' | 'low' | 'critical';
  lowBalanceThreshold: string | null;
  criticalBalanceThreshold: string | null;
  lastActivityAt: string | null;
}

export interface AiWalletTransaction {
  id: string;
  type: AiLedgerType;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  referenceNo: string;
  notes: string | null;
  createdAt: string;
}

export interface AiCreditPurchase {
  id: string;
  method: 'STRIPE' | 'BANK_TRANSFER';
  amount: string;
  currency: string;
  status: AiPurchaseStatus;
  proofNote: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export interface AiUsageRow {
  id: string;
  providerName: string;
  modelCode: string;
  callType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  executionMs: number | null;
  customerCharge: string;
  status: 'CHARGED' | 'FAILED' | 'UNBILLED';
  createdAt: string;
}

export interface AiDispute {
  id: string;
  type: AiDisputeType;
  status: AiDisputeStatus;
  subject: string;
  description: string;
  resolutionNotes: string | null;
  createdAt: string;
}

export interface AiDisputeWithThread extends AiDispute {
  messages: Array<{ id: string; authorRole: string; body: string; createdAt: string }>;
}

interface Paged<T> { rows: T[]; total: number; page: number; pageSize: number }

export const aiBillingService = {
  async getWallet(): Promise<AiWalletSummary> {
    const { data } = await apiClient.get<AiWalletSummary>('/ai-billing/wallet');
    return data;
  },
  async getSummary() {
    const { data } = await apiClient.get<{
      monthToDate: { requests: number; totalTokens: number; spend: string };
      byModel: Array<{ modelCode: string; requests: number; spend: string }>;
      budget: {
        accessStatus: 'ENABLED' | 'DISABLED' | 'SUSPENDED';
        maxMonthlySpend: string | null;
        remainingMonthlyBudget: string | null;
        maxDailySpend: string | null;
        maxQueryCost: string | null;
        dailyRequestLimit: number | null;
        monthlyRequestLimit: number | null;
      };
    }>('/ai-billing/summary');
    return data;
  },
  async listTransactions(page = 1, pageSize = 50): Promise<Paged<AiWalletTransaction>> {
    const { data } = await apiClient.get('/ai-billing/transactions', { params: { page, pageSize } });
    return data;
  },
  async listUsage(page = 1, pageSize = 50): Promise<Paged<AiUsageRow>> {
    const { data } = await apiClient.get('/ai-billing/usage', { params: { page, pageSize } });
    return data;
  },
  async listPurchases(page = 1, pageSize = 50): Promise<Paged<AiCreditPurchase>> {
    const { data } = await apiClient.get('/ai-billing/purchases', { params: { page, pageSize } });
    return data;
  },
  async stripeCheckout(amount: number): Promise<{ purchaseId: string; checkoutUrl: string }> {
    const { data } = await apiClient.post('/ai-billing/purchases/stripe-checkout', { amount });
    return data;
  },
  async submitBankTransfer(input: { amount: number; proofUrl?: string; proofNote?: string }): Promise<AiCreditPurchase> {
    const { data } = await apiClient.post('/ai-billing/purchases/bank-transfer', input);
    return data;
  },
  async cancelPurchase(purchaseId: string): Promise<AiCreditPurchase> {
    const { data } = await apiClient.post(`/ai-billing/purchases/${purchaseId}/cancel`);
    return data;
  },
  async listDisputes(page = 1, pageSize = 25): Promise<Paged<AiDispute>> {
    const { data } = await apiClient.get('/ai-billing/disputes', { params: { page, pageSize } });
    return data;
  },
  async getDispute(disputeId: string): Promise<AiDisputeWithThread> {
    const { data } = await apiClient.get(`/ai-billing/disputes/${disputeId}`);
    return data;
  },
  async createDispute(input: { type: AiDisputeType; subject: string; description: string; relatedTransactionId?: string; relatedUsageLogId?: string }): Promise<AiDispute> {
    const { data } = await apiClient.post('/ai-billing/disputes', input);
    return data;
  },
  async replyDispute(disputeId: string, body: string): Promise<unknown> {
    const { data } = await apiClient.post(`/ai-billing/disputes/${disputeId}/messages`, { body });
    return data;
  },
};
