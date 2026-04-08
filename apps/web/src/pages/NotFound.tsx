import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  HomeIcon,
  ArrowLeftIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-secondary-50 dark:bg-secondary-900 flex items-center justify-center p-4">
      <div className="max-w-lg w-full text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* 404 Animation */}
          <div className="relative mb-8">
            <motion.div
              className="text-[180px] font-bold text-secondary-200 dark:text-secondary-800 leading-none select-none"
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              404
            </motion.div>
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <div className="p-4 rounded-full bg-primary-100 dark:bg-primary-900/30">
                <MagnifyingGlassIcon className="w-16 h-16 text-primary-500" />
              </div>
            </motion.div>
          </div>

          {/* Message */}
          <h1 className="text-3xl font-bold text-secondary-900 dark:text-white mb-4">
            Page Not Found
          </h1>
          <p className="text-secondary-500 mb-8 max-w-md mx-auto">
            Oops! The page you're looking for doesn't exist or has been moved. 
            Let's get you back on track.
          </p>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/" className="btn-primary">
              <HomeIcon className="w-5 h-5 mr-2" />
              Go to Dashboard
            </Link>
            <button
              onClick={() => window.history.back()}
              className="btn-secondary"
            >
              <ArrowLeftIcon className="w-5 h-5 mr-2" />
              Go Back
            </button>
          </div>

          {/* Quick Links */}
          <div className="mt-12 pt-8 border-t border-secondary-200 dark:border-secondary-700">
            <p className="text-sm text-secondary-500 mb-4">
              Here are some helpful links:
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                to="/plans"
                className="text-primary-600 hover:text-primary-700 text-sm font-medium"
              >
                Plans
              </Link>
              <Link
                to="/forecasts"
                className="text-primary-600 hover:text-primary-700 text-sm font-medium"
              >
                Forecasts
              </Link>
              <Link
                to="/scenarios"
                className="text-primary-600 hover:text-primary-700 text-sm font-medium"
              >
                Scenarios
              </Link>
              <Link
                to="/data/import"
                className="text-primary-600 hover:text-primary-700 text-sm font-medium"
              >
                Import Data
              </Link>
              <Link
                to="/reports"
                className="text-primary-600 hover:text-primary-700 text-sm font-medium"
              >
                Reports
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
