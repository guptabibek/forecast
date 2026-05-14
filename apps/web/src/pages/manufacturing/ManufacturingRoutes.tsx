import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
const BOMPage = lazy(() => import('./BOM'));
const CapacityPage = lazy(() => import('./Capacity'));
const CapacityPlansPage = lazy(() => import('./CapacityPlansPage'));
const CostingEnginePage = lazy(() => import('./CostingEngine'));
const FiscalCalendarPage = lazy(() => import('./FiscalCalendar'));
const ForecastAccuracyPage = lazy(() => import('./ForecastAccuracy'));
const LocationHierarchyPage = lazy(() => import('./LocationHierarchyPage'));
const ManufacturingDashboard = lazy(() => import('./ManufacturingDashboard').then((module) => ({ default: module.ManufacturingDashboard })));
const MRPPage = lazy(() => import('./MRP'));
const NPIPage = lazy(() => import('./NPI'));
const ProductCategoryMasterPage = lazy(() => import('./ProductCategoryMaster'));
const ProductCostingPage = lazy(() => import('./ProductCosting'));
const ProductionPage = lazy(() => import('./Production'));
const PromotionsPage = lazy(() => import('./Promotions'));
const PurchaseContractsPage = lazy(() => import('./PurchaseContracts'));
const QualityInspectionsPage = lazy(() => import('./QualityInspections'));
const SOPPage = lazy(() => import('./SOP'));
const SOPGapAnalysisPage = lazy(() => import('./SOPGapAnalysis'));
const UomConversionsPage = lazy(() => import('./UomConversions'));
const UomMasterPage = lazy(() => import('./UomMaster'));
const WorkflowPage = lazy(() => import('./Workflow'));
const WorkOrdersPage = lazy(() => import('./WorkOrders'));

function ManufacturingRouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
    </div>
  );
}

export default function ManufacturingRoutes() {
  return (
    <Suspense fallback={<ManufacturingRouteFallback />}>
    <Routes>
      <Route index element={<ManufacturingDashboard />} />
      <Route path="bom" element={<BOMPage />} />
      <Route path="mrp" element={<MRPPage />} />
      <Route path="capacity" element={<CapacityPage />} />
      <Route path="inventory" element={<Navigate to="/dashboard" replace />} />
      <Route path="suppliers" element={<Navigate to="/pharma-reports/suppliers" replace />} />
      <Route path="work-orders" element={<WorkOrdersPage />} />
      <Route path="purchase-orders" element={<Navigate to="/pharma-reports/purchase-orders" replace />} />
      <Route path="purchase-invoices" element={<Navigate to="/pharma-reports/purchase-invoices" replace />} />
      <Route path="promotions" element={<PromotionsPage />} />
      <Route path="npi" element={<NPIPage />} />
      <Route path="sop" element={<SOPPage />} />
      <Route path="workflow" element={<WorkflowPage />} />
      <Route path="fiscal-calendar" element={<FiscalCalendarPage />} />
      <Route path="quality-inspections" element={<QualityInspectionsPage />} />
      <Route path="forecast-accuracy" element={<ForecastAccuracyPage />} />
      <Route path="product-costing" element={<ProductCostingPage />} />
      <Route path="costing-engine" element={<CostingEnginePage />} />
      {/* Legacy /manufacturing/{gl-accounts,journal-entries,trial-balance} URLs redirect to
          their new home under /pharma-reports/* (the accounting reports module). */}
      <Route path="gl-accounts" element={<Navigate to="/pharma-reports/gl-accounts" replace />} />
      <Route path="journal-entries" element={<Navigate to="/pharma-reports/journal-entries" replace />} />
      <Route path="trial-balance" element={<Navigate to="/pharma-reports/trial-balance" replace />} />
      <Route path="purchase-contracts" element={<PurchaseContractsPage />} />
      <Route path="uom-master" element={<UomMasterPage />} />
      <Route path="product-categories" element={<ProductCategoryMasterPage />} />
      <Route path="uom-conversions" element={<UomConversionsPage />} />
      <Route path="location-hierarchy" element={<LocationHierarchyPage />} />
      <Route path="capacity-plans" element={<CapacityPlansPage />} />
      <Route path="sop-gap-analysis" element={<SOPGapAnalysisPage />} />
      <Route path="batches" element={<Navigate to="/pharma-reports/batches" replace />} />
      <Route path="production" element={<ProductionPage />} />
      <Route path="*" element={<ManufacturingDashboard />} />
    </Routes>
    </Suspense>
  );
}
