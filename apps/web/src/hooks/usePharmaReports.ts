import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PharmaFilters,
  type ReorderParams,
  type ReorderPolicyInput,
  SalesPurchaseAnalysisKind,
  type SalesPurchaseDimension,
  ThreeSixtyPeriod,
  pharmaReportsService,
} from '../services/api/pharma-reports.service';

const dashboardQueryBehavior = {
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export const pharmaKeys = {
  all: ['pharma-reports'] as const,
  dashboard: () => [...pharmaKeys.all, 'dashboard'] as const,
  kpis: (f?: PharmaFilters) => [...pharmaKeys.dashboard(), 'kpis', f] as const,
  expiryLossTrend: (f?: PharmaFilters) => [...pharmaKeys.dashboard(), 'expiry-loss', f] as const,
  inventoryValueTrend: () => [...pharmaKeys.dashboard(), 'inv-value'] as const,

  threeSixty: () => [...pharmaKeys.all, '360'] as const,
  item360: (f?: { search?: string; period?: ThreeSixtyPeriod; locationId?: string }) => [...pharmaKeys.threeSixty(), 'item', f] as const,
  customer360: (f?: { search?: string; period?: ThreeSixtyPeriod; locationId?: string }) => [...pharmaKeys.threeSixty(), 'customer', f] as const,
  supplier360: (f?: { search?: string; period?: ThreeSixtyPeriod; locationId?: string }) => [...pharmaKeys.threeSixty(), 'supplier', f] as const,

  inventory: () => [...pharmaKeys.all, 'inventory'] as const,
  currentStock: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'current', f] as const,
  batchInventory: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'batch', f] as const,
  movementLedger: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'ledger', f] as const,
  reorder: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'reorder', f] as const,
  reorderConfig: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'reorder-config', f] as const,
  ageing: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'ageing', f] as const,

  expiry: () => [...pharmaKeys.all, 'expiry'] as const,
  nearExpiry: (f?: PharmaFilters) => [...pharmaKeys.expiry(), 'near', f] as const,
  expiredStock: (f?: PharmaFilters) => [...pharmaKeys.expiry(), 'expired', f] as const,
  fefo: (f?: PharmaFilters) => [...pharmaKeys.expiry(), 'fefo', f] as const,
  expiryRisk: (f?: PharmaFilters) => [...pharmaKeys.expiry(), 'risk', f] as const,

  analysis: () => [...pharmaKeys.all, 'analysis'] as const,
  deadSlow: (f?: PharmaFilters) => [...pharmaKeys.analysis(), 'dead-slow', f] as const,
  abc: (f?: PharmaFilters) => [...pharmaKeys.analysis(), 'abc', f] as const,
  xyz: (f?: PharmaFilters) => [...pharmaKeys.analysis(), 'xyz', f] as const,
  turnover: (f?: PharmaFilters) => [...pharmaKeys.analysis(), 'turnover', f] as const,

  procurement: () => [...pharmaKeys.all, 'procurement'] as const,
  suggestedPurchase: (f?: PharmaFilters) => [...pharmaKeys.procurement(), 'suggested', f] as const,
  supplierPerformance: (f?: PharmaFilters) => [...pharmaKeys.procurement(), 'supplier', f] as const,
  supplierPerformancePurchaseOrders: (supplierKey?: string, f?: PharmaFilters) => [...pharmaKeys.procurement(), 'supplier', supplierKey, 'purchase-orders', f] as const,
  supplierPerformancePurchaseInvoices: (supplierKey?: string, f?: PharmaFilters) => [...pharmaKeys.procurement(), 'supplier', supplierKey, 'purchase-invoices', f] as const,
  stockouts: (f?: PharmaFilters) => [...pharmaKeys.procurement(), 'stockouts', f] as const,
  salesPurchaseOverview: (kind: SalesPurchaseAnalysisKind, f?: PharmaFilters) => [...pharmaKeys.all, 'sales-purchase', kind, 'overview', f] as const,
  salesPurchaseBills: (kind: SalesPurchaseAnalysisKind, f?: PharmaFilters) => [...pharmaKeys.all, 'sales-purchase', kind, 'bills', f] as const,
  salesPurchaseBill: (kind: SalesPurchaseAnalysisKind, billKey?: string) => [...pharmaKeys.all, 'sales-purchase', kind, 'bill', billKey] as const,
  salesPurchaseItem: (kind: SalesPurchaseAnalysisKind, itemKey?: string, f?: PharmaFilters) => [...pharmaKeys.all, 'sales-purchase', kind, 'item', itemKey, f] as const,
  salesPurchaseParty: (kind: SalesPurchaseAnalysisKind, partyCode?: string, f?: PharmaFilters) => [...pharmaKeys.all, 'sales-purchase', kind, 'party', partyCode, f] as const,

  financial: () => [...pharmaKeys.all, 'financial'] as const,
  financialOutstanding: (f?: PharmaFilters) => [...pharmaKeys.financial(), 'outstanding', f] as const,
  financialOutstandingGroups: (f?: PharmaFilters) => [...pharmaKeys.financial(), 'outstanding-groups', f] as const,
  financialOutstandingDetail: (partyCode?: string, f?: PharmaFilters) => [...pharmaKeys.financial(), 'outstanding-detail', partyCode, f] as const,
  financialPartyLedger: (partyCode?: string, f?: PharmaFilters) => [...pharmaKeys.financial(), 'ledger', partyCode, f] as const,

  alerts: (c?: Record<string, unknown>) => [...pharmaKeys.all, 'alerts', c] as const,

  salesPurchaseDimension: (kind: SalesPurchaseAnalysisKind, dimension: string, f?: PharmaFilters) =>
    [...pharmaKeys.all, 'sales-purchase', kind, 'dimension', dimension, f] as const,
  salesPurchaseComparison: (kind: SalesPurchaseAnalysisKind, f?: PharmaFilters) =>
    [...pharmaKeys.all, 'sales-purchase', kind, 'comparison', f] as const,

  accounting: () => [...pharmaKeys.all, 'accounting'] as const,
  trialBalance: (f?: PharmaFilters) => [...pharmaKeys.accounting(), 'trial-balance', f] as const,
  accountLedger: (accountId?: string, f?: PharmaFilters) => [...pharmaKeys.accounting(), 'ledger', accountId, f] as const,
};

// ── Dashboard ────────────────────────────────────────────────────────────

export function useDashboardKPIs(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.kpis(filters),
    queryFn: () => pharmaReportsService.getDashboardKPIs(filters),
    ...dashboardQueryBehavior,
  });
}

export function useExpiryLossTrend(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.expiryLossTrend(filters),
    queryFn: () => pharmaReportsService.getExpiryLossTrend(filters),
    ...dashboardQueryBehavior,
  });
}

export function useInventoryValueTrend() {
  return useQuery({
    queryKey: pharmaKeys.inventoryValueTrend(),
    queryFn: () => pharmaReportsService.getInventoryValueTrend(),
    ...dashboardQueryBehavior,
  });
}

export function useItem360(filters?: { search?: string; period?: ThreeSixtyPeriod; locationId?: string }, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.item360(filters),
    queryFn: () => pharmaReportsService.getItem360(filters),
    enabled,
    ...dashboardQueryBehavior,
  });
}

export function useCustomer360(filters?: { search?: string; period?: ThreeSixtyPeriod; locationId?: string }, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.customer360(filters),
    queryFn: () => pharmaReportsService.getCustomer360(filters),
    enabled,
    ...dashboardQueryBehavior,
  });
}

export function useSupplier360(filters?: { search?: string; period?: ThreeSixtyPeriod; locationId?: string }, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.supplier360(filters),
    queryFn: () => pharmaReportsService.getSupplier360(filters),
    enabled,
    ...dashboardQueryBehavior,
  });
}

// ── Inventory ────────────────────────────────────────────────────────────

export function useCurrentStock(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.currentStock(filters),
    queryFn: () => pharmaReportsService.getCurrentStock(filters),
    enabled,
  });
}

export function useBatchInventory(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.batchInventory(filters),
    queryFn: () => pharmaReportsService.getBatchInventory(filters),
    enabled,
  });
}

export function useMovementLedger(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.movementLedger(filters),
    queryFn: () => pharmaReportsService.getMovementLedger(filters),
    enabled,
  });
}

export function useReorderReport(filters?: PharmaFilters & ReorderParams & { avgSalesDays?: number }, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.reorder(filters),
    queryFn: () => pharmaReportsService.getReorderReport(filters),
    enabled,
  });
}

export function useReorderConfig(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.reorderConfig(filters),
    queryFn: () => pharmaReportsService.getReorderConfig(filters),
    enabled,
  });
}

export function useUpsertReorderConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rows: ReorderPolicyInput[]) => pharmaReportsService.upsertReorderConfig(rows),
    onSuccess: () => {
      // Config changes the reorder math, so invalidate the whole inventory
      // subtree (reorder report + config list).
      void queryClient.invalidateQueries({ queryKey: pharmaKeys.inventory() });
    },
  });
}

export function useDeleteReorderConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, locationId }: { productId: string; locationId: string }) =>
      pharmaReportsService.deleteReorderConfig(productId, locationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pharmaKeys.inventory() });
    },
  });
}

export function useStockAgeing(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.ageing(filters),
    queryFn: () => pharmaReportsService.getStockAgeing(filters),
    enabled,
  });
}

// ── Expiry ────────────────────────────────────────────────────────────────

export function useNearExpiry(filters?: PharmaFilters & { thresholdDays?: number }, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.nearExpiry(filters),
    queryFn: () => pharmaReportsService.getNearExpiry(filters),
    enabled,
  });
}

export function useExpiredStock(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.expiredStock(filters),
    queryFn: () => pharmaReportsService.getExpiredStock(filters),
    enabled,
  });
}

export function useFEFOPicking(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.fefo(filters),
    queryFn: () => pharmaReportsService.getFEFOPicking(filters),
    enabled,
  });
}

export function useExpiryRisk(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.expiryRisk(filters),
    queryFn: () => pharmaReportsService.getExpiryRisk(filters),
    enabled,
  });
}

// ── Stock Analysis ───────────────────────────────────────────────────────

export function useDeadSlowStock(filters?: PharmaFilters & { deadMonths?: number }, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.deadSlow(filters),
    queryFn: () => pharmaReportsService.getDeadSlowStock(filters),
    enabled,
  });
}

export function useABCAnalysis(
  filters?: PharmaFilters & { thresholdA?: number; thresholdB?: number; periodMonths?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.abc(filters),
    queryFn: () => pharmaReportsService.getABCAnalysis(filters),
    enabled,
  });
}

export function useXYZAnalysis(
  filters?: PharmaFilters & { thresholdX?: number; thresholdY?: number; periodMonths?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.xyz(filters),
    queryFn: () => pharmaReportsService.getXYZAnalysis(filters),
    enabled,
  });
}

export function useInventoryTurnover(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.turnover(filters),
    queryFn: () => pharmaReportsService.getInventoryTurnover(filters),
    enabled,
  });
}

// ── Procurement ──────────────────────────────────────────────────────────

export function useSuggestedPurchase(filters?: PharmaFilters & ReorderParams, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.suggestedPurchase(filters),
    queryFn: () => pharmaReportsService.getSuggestedPurchase(filters),
    enabled,
  });
}

export function useSupplierPerformance(filters?: PharmaFilters & { supplierIds?: string[] }, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.supplierPerformance(filters),
    queryFn: () => pharmaReportsService.getSupplierPerformance(filters),
    enabled,
  });
}

export function useSupplierPerformancePurchaseOrders(
  supplierKey?: string,
  filters?: PharmaFilters & { supplierIds?: string[] },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.supplierPerformancePurchaseOrders(supplierKey, filters),
    queryFn: () => pharmaReportsService.getSupplierPerformancePurchaseOrders(supplierKey as string, filters),
    enabled: enabled && !!supplierKey,
  });
}

export function useSupplierPerformancePurchaseInvoices(
  supplierKey?: string,
  filters?: PharmaFilters & { supplierIds?: string[] },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.supplierPerformancePurchaseInvoices(supplierKey, filters),
    queryFn: () => pharmaReportsService.getSupplierPerformancePurchaseInvoices(supplierKey as string, filters),
    enabled: enabled && !!supplierKey,
  });
}

export function useStockOuts(filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.stockouts(filters),
    queryFn: () => pharmaReportsService.getStockOuts(filters),
    enabled,
  });
}

export function useSalesPurchaseOverview(kind: SalesPurchaseAnalysisKind, filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.salesPurchaseOverview(kind, filters),
    queryFn: () => pharmaReportsService.getSalesPurchaseOverview(kind, filters),
    enabled,
    ...dashboardQueryBehavior,
  });
}

export function useSalesPurchaseBills(kind: SalesPurchaseAnalysisKind, filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.salesPurchaseBills(kind, filters),
    queryFn: () => pharmaReportsService.getSalesPurchaseBills(kind, filters),
    enabled,
  });
}

export function useSalesPurchaseBillDrilldown(kind: SalesPurchaseAnalysisKind, billKey?: string, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.salesPurchaseBill(kind, billKey),
    queryFn: () => pharmaReportsService.getSalesPurchaseBillDrilldown(kind, billKey ?? ''),
    enabled: enabled && !!billKey,
  });
}

export function useSalesPurchaseItemDrilldown(kind: SalesPurchaseAnalysisKind, itemKey?: string, filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.salesPurchaseItem(kind, itemKey, filters),
    queryFn: () => pharmaReportsService.getSalesPurchaseItemDrilldown(kind, itemKey ?? '', filters),
    enabled: enabled && !!itemKey,
  });
}

export function useSalesPurchasePartyDrilldown(kind: SalesPurchaseAnalysisKind, partyCode?: string, filters?: PharmaFilters, enabled = true) {
  return useQuery({
    queryKey: pharmaKeys.salesPurchaseParty(kind, partyCode, filters),
    queryFn: () => pharmaReportsService.getSalesPurchasePartyDrilldown(kind, partyCode ?? '', filters),
    enabled: enabled && !!partyCode,
  });
}

export function useFinancialOutstanding(
  filters?: PharmaFilters & {
    partyType?: 'CUSTOMER' | 'SUPPLIER' | 'ALL';
    companyId?: number | string;
    asOfDate?: string;
    bucketBoundaries?: string;
    dsoDays?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.financialOutstanding(filters),
    queryFn: () => pharmaReportsService.getFinancialOutstanding(filters),
    enabled,
  });
}

export function useFinancialOutstandingByGroup(
  filters?: PharmaFilters & {
    partyType?: 'CUSTOMER' | 'SUPPLIER' | 'ALL';
    companyId?: number | string;
    asOfDate?: string;
    bucketBoundaries?: string;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.financialOutstandingGroups(filters),
    queryFn: () => pharmaReportsService.getFinancialOutstandingByGroup(filters),
    enabled,
  });
}

export function useFinancialOutstandingDetail(
  partyCode?: string,
  filters?: PharmaFilters & {
    companyId?: number | string;
    includeSettled?: boolean;
    asOfDate?: string;
    bucketBoundaries?: string;
    bucketIndex?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.financialOutstandingDetail(partyCode, filters),
    queryFn: () => pharmaReportsService.getFinancialOutstandingDetail(partyCode ?? '', filters),
    enabled: enabled && !!partyCode,
  });
}

export function useFinancialPartyLedger(
  partyCode?: string,
  filters?: PharmaFilters & { companyId?: number | string; fromDate?: string; toDate?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.financialPartyLedger(partyCode, filters),
    queryFn: () => pharmaReportsService.getFinancialPartyLedger(partyCode ?? '', filters),
    enabled: enabled && !!partyCode,
  });
}

// ── Sales/Purchase analytics extensions ──────────────────────────────────

export function useSalesPurchaseDimension(
  kind: SalesPurchaseAnalysisKind,
  dimension: SalesPurchaseDimension,
  filters?: PharmaFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.salesPurchaseDimension(kind, dimension, filters),
    queryFn: () => pharmaReportsService.getSalesPurchaseDimension(kind, dimension, filters),
    enabled,
  });
}

export function useSalesPurchaseComparison(
  kind: SalesPurchaseAnalysisKind,
  filters: PharmaFilters & {
    startDate: string;
    endDate: string;
    compareStartDate: string;
    compareEndDate: string;
    dimension?: SalesPurchaseDimension | 'none';
  },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.salesPurchaseComparison(kind, filters),
    queryFn: () => pharmaReportsService.getSalesPurchaseComparison(kind, filters),
    enabled:
      enabled &&
      !!filters.startDate &&
      !!filters.endDate &&
      !!filters.compareStartDate &&
      !!filters.compareEndDate,
  });
}

// ── Accounting ───────────────────────────────────────────────────────────

export function useTrialBalance(
  filters?: PharmaFilters & { startDate?: string; endDate?: string; accountType?: string; showZero?: boolean },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.trialBalance(filters),
    queryFn: () => pharmaReportsService.getTrialBalance(filters),
    enabled,
  });
}

export function useAccountLedger(
  accountId?: string,
  filters?: PharmaFilters & { startDate?: string; endDate?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: pharmaKeys.accountLedger(accountId, filters),
    queryFn: () => pharmaReportsService.getAccountLedger(accountId ?? '', filters),
    enabled: enabled && !!accountId,
  });
}

// ── Alerts ───────────────────────────────────────────────────────────────

export function usePharmaAlerts(config?: { nearExpiryDays?: number; aClassOnly?: boolean; alertLimit?: number }) {
  return useQuery({
    queryKey: pharmaKeys.alerts(config),
    queryFn: () => pharmaReportsService.getAlerts(config),
    ...dashboardQueryBehavior,
  });
}
