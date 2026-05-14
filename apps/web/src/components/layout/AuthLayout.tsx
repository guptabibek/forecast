import { motion } from 'framer-motion';
import { Outlet } from 'react-router-dom';
import { useBranding } from '../ThemeProvider';

export default function AuthLayout() {
  const { settings } = useBranding();
  const brandName = settings?.name || 'ForecastPro';
  const tagline = settings?.brandTagline || 'Planning & Forecasting Platform';
  const loginBg = settings?.loginBgUrl;
  const logoUrl = settings?.logoUrl;

  const leftStyle: React.CSSProperties = loginBg
    ? { backgroundImage: `linear-gradient(to bottom right, rgba(37,99,235,0.85), rgba(29,78,216,0.9)), url(${loginBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};

  return (
    <div className="min-h-screen flex">
      {/* Left side - Branding */}
      <div
        className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-600 to-primary-800 p-12 flex-col justify-between"
        style={leftStyle}
      >
        <div>
          <div className="flex items-center gap-3">
            {logoUrl && <img src={logoUrl} alt={brandName} className="w-10 h-10 rounded-lg object-contain bg-white/10 p-1" />}
            <h1 className="text-3xl font-bold text-white">{brandName}</h1>
          </div>
          <p className="text-primary-200 mt-2">{tagline}</p>
        </div>

        <div className="space-y-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="flex items-start space-x-4"
          >
            <div className="flex-shrink-0 w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">
                AI-Powered Forecasting
              </h3>
              <p className="text-primary-200 text-sm mt-1">
                8+ statistical models including AI Hybrid for accurate predictions
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="flex items-start space-x-4"
          >
            <div className="flex-shrink-0 w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">
                Multi-Tenant Architecture
              </h3>
              <p className="text-primary-200 text-sm mt-1">
                Secure data isolation with enterprise-grade RBAC
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
            className="flex items-start space-x-4"
          >
            <div className="flex-shrink-0 w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">
                ERP-Agnostic Data Ingestion
              </h3>
              <p className="text-primary-200 text-sm mt-1">
                Import from any source via API, CSV, or Excel
              </p>
            </div>
          </motion.div>
        </div>

        <div className="text-primary-300 text-sm">
          &copy; {new Date().getFullYear()} {brandName}. Enterprise Planning Solutions.
        </div>
      </div>

      {/* Right side - Auth forms */}
      <div className="flex-1 flex items-center justify-center p-8 bg-secondary-50 dark:bg-secondary-900">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Outlet />
        </motion.div>
      </div>
    </div>
  );
}
