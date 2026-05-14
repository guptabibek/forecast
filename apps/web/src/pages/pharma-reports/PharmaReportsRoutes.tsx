import { getFallbackPathForRole, isSuperAdmin, roleMatches } from '@/permissions';
import { useAuthStore } from '@stores/auth.store';
import { Navigate, Route, Routes } from 'react-router-dom';
import GLAccountsPage from '../manufacturing/GLAccounts';
import JournalEntriesPage from '../manufacturing/JournalEntries';
import BatchManagementPage from '../manufacturing/BatchManagement';
import PurchaseInvoicesPage from '../manufacturing/PurchaseInvoices';
import PurchaseOrdersPage from '../manufacturing/PurchaseOrders';
import SuppliersPage from '../manufacturing/Suppliers';
import AlertsPage from './AlertsPage';
import ExpiryManagementPage from './ExpiryManagementPage';
import FinancialReportsPage from './FinancialReportsPage';
import GrowthAnalysisPage from './GrowthAnalysisPage';
import InventoryReportsPage from './InventoryReportsPage';
import ProcurementPage from './ProcurementPage';
import SalesPurchaseAnalysisPage from './SalesPurchaseAnalysisPage';
import StockAnalysisPage from './StockAnalysisPage';
import ThreeSixtyReportsPage from './ThreeSixtyReportsPage';
import TrialBalancePage from './TrialBalancePage';

// Accounting reports (GL/Journal/Trial Balance) are gated to roles that legitimately
// need to read the ledger: ADMIN, FINANCE, PLANNER (incl. FORECAST_PLANNER → PLANNER).
function AccountingReportsRoute({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((state) => state.user?.role);
  if (isSuperAdmin(role) || roleMatches(role, 'ADMIN', 'FINANCE', 'PLANNER')) {
    return <>{children}</>;
  }
  return <Navigate to={getFallbackPathForRole(role)} replace />;
}

export default function PharmaReportsRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="inventory" element={<InventoryReportsPage />} />
      <Route path="expiry" element={<ExpiryManagementPage />} />
      <Route path="analysis" element={<StockAnalysisPage />} />
      <Route path="sales-purchase" element={<SalesPurchaseAnalysisPage />} />
      <Route path="growth" element={<GrowthAnalysisPage />} />
      <Route path="procurement" element={<ProcurementPage />} />
      <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
      <Route path="purchase-invoices" element={<PurchaseInvoicesPage />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="batches" element={<BatchManagementPage />} />
      <Route path="financial" element={<FinancialReportsPage />} />
      <Route path="alerts" element={<AlertsPage />} />
      <Route path="360" element={<ThreeSixtyReportsPage />} />
      {/* Accounting reports moved here from /manufacturing — view-only ledger surfaces. */}
      <Route path="gl-accounts" element={<AccountingReportsRoute><GLAccountsPage /></AccountingReportsRoute>} />
      <Route path="journal-entries" element={<AccountingReportsRoute><JournalEntriesPage /></AccountingReportsRoute>} />
      <Route path="trial-balance" element={<AccountingReportsRoute><TrialBalancePage /></AccountingReportsRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
