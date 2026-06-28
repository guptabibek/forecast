import { useApiLoadingStore } from '@stores/api-loading.store';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Non-blocking top progress bar shown whenever a mutation (POST/PUT/PATCH/DELETE)
 * is in-flight. Replaces the previous full-screen blocking overlay.
 *
 * Multiple concurrent requests are debounced correctly via the counter in
 * apiLoadingStore — the bar only disappears when ALL finish.
 *
 * Rendered once at the app root; zero impact on the rest of the component tree.
 */
export function GlobalLoadingOverlay() {
  const isLoading = useApiLoadingStore((s) => s.isLoading);

  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div
          key="global-loading-bar"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none"
          aria-live="polite"
          aria-label="Loading"
          role="progressbar"
          aria-valuetext="Loading..."
        >
          {/* Animated progress bar — like YouTube / GitHub */}
          <motion.div
            className="h-[3px] bg-gradient-to-r from-primary-400 via-primary-500 to-primary-600 shadow-sm"
            style={{
              boxShadow: '0 0 8px rgba(var(--color-primary), 0.4)',
            }}
            initial={{ width: '0%' }}
            animate={{
              width: ['0%', '70%', '85%', '92%'],
            }}
            transition={{
              duration: 8,
              ease: 'easeOut',
              times: [0, 0.3, 0.6, 1],
            }}
          />
          {/* Shimmer effect */}
          <motion.div
            className="h-[3px] w-24 absolute top-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
            animate={{ left: ['-96px', '100vw'] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'linear',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
