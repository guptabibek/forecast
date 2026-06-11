import { ArrowRightIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { useInsights, useInsightSummary } from '../../hooks/useInsightsDashboard';
import { canUseAiReporting } from '../../permissions';
import { useAuthStore } from '../../stores/auth.store';
import { useBranding } from '../ThemeProvider';
import type { InsightSeverity } from '../../services/api/insights-dashboard.service';

const SEVERITY_DOTS: Record<InsightSeverity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-blue-400',
  info: 'bg-gray-300',
};

/**
 * Compact AI Insights section for the main Dashboard. Renders nothing when
 * the AI Reporting module/feature is off or the user lacks AI permissions,
 * so it is safe to mount unconditionally.
 */
export function AiInsightsPreview() {
  const user = useAuthStore((state) => state.user);
  const { settings } = useBranding();

  const moduleEnabled =
    (settings?.enabledModules as Record<string, boolean> | undefined)?.['ai-reporting'] !== false;
  const allowed = moduleEnabled && canUseAiReporting(user, settings?.aiReporting?.enabled === true);

  const summary = useInsightSummary(allowed);
  const insights = useInsights({ status: ['NEW', 'ACTIVE'], page: 1, pageSize: 3 }, allowed);

  if (!allowed || summary.isError || insights.isError) return null;

  const bySeverity = summary.data?.bySeverity;
  const top = insights.data?.insights ?? [];
  const isLoading = summary.isLoading || insights.isLoading;

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5 text-purple-600" />
            <h2 className="text-base font-semibold text-secondary-900 dark:text-white">AI Insights</h2>
            {!isLoading && (summary.data?.openTotal ?? 0) > 0 && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                {summary.data?.openTotal} open
              </span>
            )}
          </div>
          <Link
            to="/insights"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            Open dashboard <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
      <div className="p-4 lg:p-5">
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-5 w-2/3 rounded bg-secondary-100 dark:bg-secondary-800" />
            <div className="h-5 w-1/2 rounded bg-secondary-100 dark:bg-secondary-800" />
          </div>
        ) : !top.length ? (
          <p className="text-sm text-secondary-500 dark:text-secondary-400">
            No open insights right now. Pin reports and review generated insights on the{' '}
            <Link to="/insights" className="font-medium text-primary-600 hover:text-primary-700">
              AI Insights dashboard
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-3">
            {bySeverity && (
              <div className="flex flex-wrap gap-3 text-xs text-secondary-500 dark:text-secondary-400">
                {(['critical', 'high', 'medium'] as InsightSeverity[])
                  .filter((severity) => (bySeverity[severity] ?? 0) > 0)
                  .map((severity) => (
                    <span key={severity} className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${SEVERITY_DOTS[severity]}`} />
                      {bySeverity[severity]} {severity}
                    </span>
                  ))}
              </div>
            )}
            <ul className="divide-y divide-secondary-100 dark:divide-secondary-800">
              {top.map((insight) => (
                <li key={insight.id} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOTS[insight.severity] ?? SEVERITY_DOTS.info}`} />
                  <div className="min-w-0">
                    <Link
                      to="/insights"
                      className="block truncate text-sm font-medium text-secondary-900 hover:text-primary-700 dark:text-white"
                      title={insight.title}
                    >
                      {insight.title}
                    </Link>
                    <p className="line-clamp-1 text-xs text-secondary-500 dark:text-secondary-400">{insight.summary}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
