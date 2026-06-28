

/**
 * Full-page skeleton that mimics the MainLayout structure.
 * Used as Suspense fallback and ProtectedRoute loading state.
 */
export function PageSkeleton() {
  return (
    <div className="animate-page-enter space-y-4">
      {/* Page header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-48 animate-skeleton rounded" />
          <div className="h-4 w-32 animate-skeleton rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 animate-skeleton rounded" />
          <div className="h-9 w-32 animate-skeleton rounded" />
        </div>
      </div>

      {/* Summary cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 p-4 space-y-3"
            style={{ borderRadius: 'var(--radius)', animationDelay: `${i * 60}ms` }}
          >
            <div className="h-3 w-20 animate-skeleton rounded" />
            <div className="h-6 w-28 animate-skeleton rounded" />
            <div className="h-3 w-16 animate-skeleton rounded" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div
        className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 overflow-hidden"
        style={{ borderRadius: 'var(--radius)' }}
      >
        {/* Table header */}
        <div className="border-b border-secondary-200 dark:border-secondary-700 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="h-5 w-36 animate-skeleton rounded" />
            <div className="h-8 w-48 animate-skeleton rounded" />
          </div>
        </div>
        {/* Table rows */}
        <div className="divide-y divide-secondary-200 dark:divide-secondary-700">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-4 py-3 animate-stagger-in"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="h-4 w-32 animate-skeleton rounded" />
              <div className="h-4 w-24 animate-skeleton rounded" />
              <div className="h-4 w-40 animate-skeleton rounded flex-1" />
              <div className="h-4 w-20 animate-skeleton rounded" />
              <div className="h-4 w-16 animate-skeleton rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact skeleton for inline loading states (e.g., inside cards or sections).
 */
export function SectionSkeleton({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3 animate-stagger-in" style={{ animationDelay: `${i * 40}ms` }}>
          <div className="h-4 w-full animate-skeleton rounded" style={{ maxWidth: `${60 + (i * 17) % 40}%` }} />
        </div>
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}
