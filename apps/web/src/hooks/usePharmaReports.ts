import { useQuery } from '@tanstack/react-query';
import { PharmaFilters, pharmaReportsService } from '../services/api/pharma-reports.service';

export const pharmaKeys = {
  all: ['pharma-reports'] as const,
  dashboard: () => [...pharmaKeys.all, 'dashboard'] as const,
  kpis: (f?: PharmaFilters) => [...pharmaKeys.dashboard(), 'kpis', f] as const,
  expiryLossTrend: (f?: PharmaFilters) => [...pharmaKeys.dashboard(), 'expiry-loss', f] as const,
  inventoryValueTrend: () => [...pharmaKeys.dashboard(), 'inv-value'] as const,

  inventory: () => [...pharmaKeys.all, 'inventory'] as const,
  currentStock: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'current', f] as const,
  batchInventory: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'batch', f] as const,
  movementLedger: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'ledger', f] as const,
  reorder: (f?: PharmaFilters) => [...pharmaKeys.inventory(), 'reorder', f] as const,
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
  stockouts: (f?: PharmaFilters) => [...pharmaKeys.procurement(), 'stockouts', f] as const,

  alerts: (c?: Record<string, unknown>) => [...pharmaKeys.all, 'alerts', c] as const,
};

// ── Dashboard ────────────────────────────────────────────────────────────

export function useDashboardKPIs(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.kpis(filters),
    queryFn: () => pharmaReportsService.getDashboardKPIs(filters),
  });
}

export function useExpiryLossTrend(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.expiryLossTrend(filters),
    queryFn: () => pharmaReportsService.getExpiryLossTrend(filters),
  });
}

export function useInventoryValueTrend() {
  return useQuery({
    queryKey: pharmaKeys.inventoryValueTrend(),
    queryFn: () => pharmaReportsService.getInventoryValueTrend(),
  });
}

// ── Inventory ────────────────────────────────────────────────────────────

export function useCurrentStock(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.currentStock(filters),
    queryFn: () => pharmaReportsService.getCurrentStock(filters),
  });
}

export function useBatchInventory(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.batchInventory(filters),
    queryFn: () => pharmaReportsService.getBatchInventory(filters),
  });
}

export function useMovementLedger(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.movementLedger(filters),
    queryFn: () => pharmaReportsService.getMovementLedger(filters),
  });
}

export function useReorderReport(filters?: PharmaFilters & { avgSalesDays?: number }) {
  return useQuery({
    queryKey: pharmaKeys.reorder(filters),
    queryFn: () => pharmaReportsService.getReorderReport(filters),
  });
}

export function useStockAgeing(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.ageing(filters),
    queryFn: () => pharmaReportsService.getStockAgeing(filters),
  });
}

// ── Expiry ────────────────────────────────────────────────────────────────

export function useNearExpiry(filters?: PharmaFilters & { thresholdDays?: number }) {
  return useQuery({
    queryKey: pharmaKeys.nearExpiry(filters),
    queryFn: () => pharmaReportsService.getNearExpiry(filters),
  });
}

export function useExpiredStock(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.expiredStock(filters),
    queryFn: () => pharmaReportsService.getExpiredStock(filters),
  });
}

export function useFEFOPicking(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.fefo(filters),
    queryFn: () => pharmaReportsService.getFEFOPicking(filters),
  });
}

export function useExpiryRisk(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.expiryRisk(filters),
    queryFn: () => pharmaReportsService.getExpiryRisk(filters),
  });
}

// ── Stock Analysis ───────────────────────────────────────────────────────

export function useDeadSlowStock(filters?: PharmaFilters & { deadMonths?: number }) {
  return useQuery({
    queryKey: pharmaKeys.deadSlow(filters),
    queryFn: () => pharmaReportsService.getDeadSlowStock(filters),
  });
}

export function useABCAnalysis(filters?: PharmaFilters & { thresholdA?: number; thresholdB?: number; periodMonths?: number }) {
  return useQuery({
    queryKey: pharmaKeys.abc(filters),
    queryFn: () => pharmaReportsService.getABCAnalysis(filters),
  });
}

export function useXYZAnalysis(filters?: PharmaFilters & { thresholdX?: number; thresholdY?: number; periodMonths?: number }) {
  return useQuery({
    queryKey: pharmaKeys.xyz(filters),
    queryFn: () => pharmaReportsService.getXYZAnalysis(filters),
  });
}

export function useInventoryTurnover(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.turnover(filters),
    queryFn: () => pharmaReportsService.getInventoryTurnover(filters),
  });
}

// ── Procurement ──────────────────────────────────────────────────────────

export function useSuggestedPurchase(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.suggestedPurchase(filters),
    queryFn: () => pharmaReportsService.getSuggestedPurchase(filters),
  });
}

export function useSupplierPerformance(filters?: PharmaFilters & { supplierIds?: string[] }) {
  return useQuery({
    queryKey: pharmaKeys.supplierPerformance(filters),
    queryFn: () => pharmaReportsService.getSupplierPerformance(filters),
  });
}

export function useStockOuts(filters?: PharmaFilters) {
  return useQuery({
    queryKey: pharmaKeys.stockouts(filters),
    queryFn: () => pharmaReportsService.getStockOuts(filters),
  });
}

// ── Alerts ───────────────────────────────────────────────────────────────

export function usePharmaAlerts(config?: { nearExpiryDays?: number; aClassOnly?: boolean; alertLimit?: number }) {
  return useQuery({
    queryKey: pharmaKeys.alerts(config),
    queryFn: () => pharmaReportsService.getAlerts(config),
  });
}
