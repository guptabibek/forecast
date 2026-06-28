import React from 'react';

interface TableSkeletonProps {
  columns?: number;
  rows?: number;
  showHeader?: boolean;
  className?: string;
}

/**
 * Animated skeleton placeholder that mimics a DataTable's structure.
 * Used as the loading state inside DataTable and standalone table views.
 */
export function TableSkeleton({
  columns = 5,
  rows = 8,
  showHeader = true,
  className = '',
}: TableSkeletonProps) {
  // Vary column widths for a more realistic skeleton appearance
  const columnWidths = React.useMemo(() => {
    const presets = ['w-20', 'w-32', 'w-24', 'w-40', 'w-16', 'w-28', 'w-36', 'w-20'];
    return Array.from({ length: columns }, (_, i) => presets[i % presets.length]);
  }, [columns]);

  return (
    <div className={`overflow-hidden ${className}`} role="status" aria-label="Loading table data">
      <table className="min-w-full">
        {showHeader && (
          <thead>
            <tr className="border-b border-secondary-200 dark:border-secondary-700">
              {columnWidths.map((w, i) => (
                <th key={i} className="px-3 py-2.5 text-left">
                  <div className={`h-3 ${w} animate-skeleton rounded`} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
          {Array.from({ length: rows }, (_, rowIdx) => (
            <tr
              key={rowIdx}
              className="animate-stagger-in"
              style={{ animationDelay: `${rowIdx * 40}ms` }}
            >
              {columnWidths.map((w, colIdx) => (
                <td key={colIdx} className="px-3 py-2.5">
                  <div
                    className={`h-3.5 ${w} animate-skeleton rounded`}
                    style={{
                      // Slight width variation per row for realism
                      width: colIdx === 0 ? undefined : `${70 + (rowIdx * 7 + colIdx * 13) % 30}%`,
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">Loading...</span>
    </div>
  );
}
