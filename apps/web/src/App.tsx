import { getFallbackPathForRole, isForecastViewerRole, isManufacturingBlockedRole } from '@/permissions';
import { ErrorBoundary } from '@components/common/ErrorBoundary';
import { useAuthStore } from '@stores/auth.store';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

// Layout
const AuthLayout = lazy(() => import('@components/layout/AuthLayout'));
const MainLayout = lazy(() => import('@components/layout/MainLayout'));

// Pages
const Dashboard = lazy(() => import('@pages/Dashboard'));
const NotFound = lazy(() => import('@pages/NotFound'));
const ForgotPassword = lazy(() => import('@pages/auth/ForgotPassword'));
const Login = lazy(() => import('@pages/auth/Login'));
const Register = lazy(() => import('@pages/auth/Register'));
const ResetPassword = lazy(() => import('@pages/auth/ResetPassword'));
const Actuals = lazy(() => import('@pages/data/Actuals'));
const DataImport = lazy(() => import('@pages/data/DataImport'));
const Dimensions = lazy(() => import('@pages/data/Dimensions'));
const ProductMaster = lazy(() => import('@pages/data/ProductMaster'));
const ForecastDashboard = lazy(() => import('@pages/forecasts/ForecastDashboard'));
const ForecastDetail = lazy(() => import('@pages/forecasts/ForecastDetail'));
const Forecasts = lazy(() => import('@pages/forecasts/Forecasts'));
const ManufacturingRoutes = lazy(() => import('@pages/manufacturing/ManufacturingRoutes'));
const CreatePlan = lazy(() => import('@pages/plans/CreatePlan'));
const PlanDetail = lazy(() => import('@pages/plans/PlanDetail'));
const Plans = lazy(() => import('@pages/plans/Plans'));
const Reports = lazy(() => import('@pages/reports/Reports'));
const Scenarios = lazy(() => import('@pages/scenarios/Scenarios'));
const AuditLog = lazy(() => import('@pages/settings/AuditLog'));
const Notifications = lazy(() => import('@pages/settings/Notifications'));
const Profile = lazy(() => import('@pages/settings/Profile'));
const Settings = lazy(() => import('@pages/settings/Settings'));
const Users = lazy(() => import('@pages/settings/Users'));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-500" />
    </div>
  );
}

// Protected Route Component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Public Route Component (redirect to dashboard if authenticated)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function RoleAwareRoute({
  restrictForecastViewer = false,
  restrictManufacturing = false,
  children,
}: {
  restrictForecastViewer?: boolean;
  restrictManufacturing?: boolean;
  children: React.ReactNode;
}) {
  const role = useAuthStore((s) => s.user?.role);

  const blocked =
    (restrictForecastViewer && isForecastViewerRole(role)) ||
    (restrictManufacturing && isManufacturingBlockedRole(role));

  if (blocked) {
    return <Navigate to={getFallbackPathForRole(role)} replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      {/* Public routes */}
      <Route element={<AuthLayout />}>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicRoute>
              <Register />
            </PublicRoute>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicRoute>
              <ForgotPassword />
            </PublicRoute>
          }
        />
        <Route
          path="/reset-password"
          element={
            <PublicRoute>
              <ResetPassword />
            </PublicRoute>
          }
        />
      </Route>

      {/* Protected routes */}
      <Route
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Plans */}
        <Route path="/plans" element={<Plans />} />
        <Route path="/plans/new" element={<CreatePlan />} />
        <Route path="/plans/:id" element={<PlanDetail />} />

        {/* Forecasts */}
        <Route path="/forecasts" element={<ErrorBoundary><Forecasts /></ErrorBoundary>} />
        <Route path="/forecasts/dashboard" element={<ErrorBoundary><ForecastDashboard /></ErrorBoundary>} />
        <Route path="/forecasts/:id" element={<ErrorBoundary><ForecastDetail /></ErrorBoundary>} />

        {/* Scenarios */}
        <Route path="/scenarios" element={<Scenarios />} />

        {/* Data Management */}
        <Route path="/data/import" element={<RoleAwareRoute restrictForecastViewer><DataImport /></RoleAwareRoute>} />
        <Route path="/data/actuals" element={<RoleAwareRoute restrictForecastViewer><Actuals /></RoleAwareRoute>} />
        <Route path="/data/dimensions" element={<RoleAwareRoute restrictForecastViewer><Dimensions /></RoleAwareRoute>} />
        <Route path="/data/products" element={<RoleAwareRoute restrictForecastViewer><ProductMaster /></RoleAwareRoute>} />

        {/* Reports */}
        <Route path="/reports" element={<Reports />} />

        {/* Settings */}
        <Route path="/settings" element={<RoleAwareRoute restrictForecastViewer><Settings /></RoleAwareRoute>} />
        <Route path="/settings/users" element={<RoleAwareRoute restrictForecastViewer><Users /></RoleAwareRoute>} />
        <Route path="/settings/profile" element={<Profile />} />
        <Route path="/settings/audit-log" element={<RoleAwareRoute restrictForecastViewer><AuditLog /></RoleAwareRoute>} />
        <Route path="/notifications" element={<Notifications />} />

        {/* Manufacturing */}
        <Route path="/manufacturing/*" element={<RoleAwareRoute restrictManufacturing><ManufacturingRoutes /></RoleAwareRoute>} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
