import { Navigate, Route, Routes } from 'react-router-dom';
import AlertsPage from './AlertsPage';
import ExpiryManagementPage from './ExpiryManagementPage';
import InventoryReportsPage from './InventoryReportsPage';
import ProcurementPage from './ProcurementPage';
import StockAnalysisPage from './StockAnalysisPage';

export default function PharmaReportsRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="inventory" element={<InventoryReportsPage />} />
      <Route path="expiry" element={<ExpiryManagementPage />} />
      <Route path="analysis" element={<StockAnalysisPage />} />
      <Route path="procurement" element={<ProcurementPage />} />
      <Route path="alerts" element={<AlertsPage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
