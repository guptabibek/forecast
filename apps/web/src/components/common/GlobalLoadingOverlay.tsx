import { useApiLoadingStore } from '@stores/api-loading.store';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Full-screen backdrop + spinner shown whenever a mutation (POST/PUT/PATCH/DELETE)
 * is in-flight. Multiple concurrent requests are debounced correctly via the
 * counter in apiLoadingStore — the overlay only disappears when ALL finish.
 *
 * Rendered once at the app root; zero impact on the rest of the component tree.
 */
export function GlobalLoadingOverlay() {
  const isLoading = useApiLoadingStore((s) => s.isLoading);

  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div
          key="global-loading-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          // Full-screen fixed overlay — sits above everything (z-[9999])
          // pointer-events: all blocks all user interaction beneath it
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          aria-live="polite"
          aria-label="Loading"
          // Subtle frosted-glass dark backdrop that looks great in both themes
          style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(2px)' }}
        >
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col items-center gap-4 rounded-2xl bg-white/10 border border-white/20 px-10 py-8 shadow-2xl"
            style={{ backdropFilter: 'blur(16px)' }}
          >
            {/* Three-arc spinner — matches the primary brand colour */}
            <Spinner />
            <p className="text-sm font-medium text-white/90 tracking-wide select-none">
              Processing…
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Spinner() {
  return (
    <svg
      className="h-10 w-10 animate-spin"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      {/* Track */}
      <circle
        cx="20"
        cy="20"
        r="16"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="3.5"
      />
      {/* Animated arc */}
      <circle
        cx="20"
        cy="20"
        r="16"
        stroke="rgb(96 165 250)"   /* primary-400 — works in both light & dark */
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="60 41"   /* arc ≈ 3/4 circle */
        style={{ transformOrigin: 'center' }}
      />
    </svg>
  );
}
