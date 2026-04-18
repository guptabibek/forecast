import { getFallbackPathForRole, isForecastViewerRole, isManufacturingBlockedRole, isSuperAdmin } from '@/permissions';
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
const ResetPassword = lazy(() => import('@pages/auth/ResetPassword'));
const ForceResetPassword = lazy(() => import('@pages/auth/ForceResetPassword'));
const Actuals = lazy(() => import('@pages/data/Actuals'));
const DataImport = lazy(() => import('@pages/data/DataImport'));
const Dimensions = lazy(() => import('@pages/data/Dimensions'));
const ProductMaster = lazy(() => import('@pages/data/ProductMaster'));
const Locations = lazy(() => import('@pages/data/Locations'));
const ForecastDashboard = lazy(() => import('@pages/forecasts/ForecastDashboard'));
const ForecastDetail = lazy(() => import('@pages/forecasts/ForecastDetail'));
const Forecasts = lazy(() => import('@pages/forecasts/Forecasts'));
const ManufacturingRoutes = lazy(() => import('@pages/manufacturing/ManufacturingRoutes'));
const CreatePlan = lazy(() => import('@pages/plans/CreatePlan'));
const PlanDetail = lazy(() => import('@pages/plans/PlanDetail'));
const Plans = lazy(() => import('@pages/plans/Plans'));
const Reports = lazy(() => import('@pages/reports/Reports'));
const PharmaReportsRoutes = lazy(() => import('@pages/pharma-reports/PharmaReportsRoutes'));
const Scenarios = lazy(() => import('@pages/scenarios/Scenarios'));
const AuditLog = lazy(() => import('@pages/settings/AuditLog'));
const Notifications = lazy(() => import('@pages/settings/Notifications'));
const Profile = lazy(() => import('@pages/settings/Profile'));
const MargEde = lazy(() => import('@pages/settings/MargEde'));
const Settings = lazy(() => import('@pages/settings/Settings'));
const Users = lazy(() => import('@pages/settings/Users'));
const Roles = lazy(() => import('@pages/settings/Roles'));
const PlatformDashboard = lazy(() => import('@pages/platform/PlatformDashboard'));
const TenantManage = lazy(() => import('@pages/platform/TenantManage'));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-500" />
    </div>
  );
}

// Protected Route Component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();

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

  // Force password reset before accessing any protected route
  if (user?.mustResetPassword) {
    return <Navigate to="/force-reset-password" replace />;
  }

  return <>{children}</>;
}

// Public Route Component (redirect to dashboard if authenticated)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();

  if (isAuthenticated) {
    return <Navigate to={getFallbackPathForRole(user?.role)} replace />;
  }

  return <>{children}</>;
}

function HomeRoute() {
  const role = useAuthStore((s) => s.user?.role);
  return <Navigate to={getFallbackPathForRole(role)} replace />;
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

  // SUPER_ADMIN is never blocked
  if (isSuperAdmin(role)) return <>{children}</>;

  const blocked =
    (restrictForecastViewer && isForecastViewerRole(role)) ||
    (restrictManufacturing && isManufacturingBlockedRole(role));

  if (blocked) {
    return <Navigate to={getFallbackPathForRole(role)} replace />;
  }

  return <>{children}</>;
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  if (!isSuperAdmin(role)) {
    return <Navigate to={getFallbackPathForRole(role)} replace />;
  }
  return <>{children}</>;
}

function TenantOnlyRoute({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  if (isSuperAdmin(role)) {
    return <Navigate to="/platform" replace />;
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

      {/* Force password reset — authenticated but must change password */}
      <Route path="/force-reset-password" element={<ForceResetPassword />} />

      {/* Protected routes */}
      <Route
        element={
          <ProtectedRoute>
            <TenantOnlyRoute>
              <MainLayout />
            </TenantOnlyRoute>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<HomeRoute />} />
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
        <Route path="/data/locations" element={<RoleAwareRoute restrictForecastViewer><Locations /></RoleAwareRoute>} />

        {/* Reports */}
        <Route path="/reports" element={<Reports />} />
        <Route path="/pharma-reports/*" element={<PharmaReportsRoutes />} />

        {/* Settings */}
        <Route path="/settings" element={<RoleAwareRoute restrictForecastViewer><Settings /></RoleAwareRoute>} />
        <Route path="/settings/users" element={<RoleAwareRoute restrictForecastViewer><Users /></RoleAwareRoute>} />
        <Route path="/settings/roles" element={<RoleAwareRoute restrictForecastViewer><Roles /></RoleAwareRoute>} />
        <Route path="/settings/marg-ede" element={<RoleAwareRoute restrictForecastViewer><MargEde /></RoleAwareRoute>} />
        <Route path="/settings/profile" element={<Profile />} />
        <Route path="/settings/audit-log" element={<RoleAwareRoute restrictForecastViewer><AuditLog /></RoleAwareRoute>} />
        <Route path="/notifications" element={<Notifications />} />

        {/* Manufacturing */}
        <Route path="/manufacturing/*" element={<RoleAwareRoute restrictManufacturing><ManufacturingRoutes /></RoleAwareRoute>} />
      </Route>

      <Route
        element={
          <ProtectedRoute>
            <SuperAdminRoute>
              <MainLayout />
            </SuperAdminRoute>
          </ProtectedRoute>
        }
      >
        <Route path="/platform" element={<PlatformDashboard />} />
        <Route path="/platform/tenants/:id" element={<TenantManage />} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
