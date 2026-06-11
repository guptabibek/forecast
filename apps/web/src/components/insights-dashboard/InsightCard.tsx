import { useState } from 'react';
import {
  ArchiveBoxIcon,
  ArrowTopRightOnSquareIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  BookmarkIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CubeIcon,
  ReceiptPercentIcon,
  ShoppingCartIcon,
  SparklesIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useInsightAction } from '../../hooks/useInsightsDashboard';
import type { Insight, InsightSeverity } from '../../services/api/insights-dashboard.service';

const SEVERITY_STYLES: Record<InsightSeverity, { badge: string; bar: string; label: string }> = {
  critical: { badge: 'bg-red-600 text-white', bar: 'from-red-500 to-red-400', label: 'Critical' },
  high: { badge: 'bg-orange-500 text-white', bar: 'from-orange-500 to-amber-400', label: 'High' },
  medium: { badge: 'bg-amber-500 text-white', bar: 'from-amber-500 to-yellow-400', label: 'Medium' },
  low: { badge: 'bg-blue-500 text-white', bar: 'from-blue-500 to-sky-400', label: 'Low' },
  info: { badge: 'bg-primary-600 text-white', bar: 'from-primary-500 to-purple-500', label: 'Info' },
};

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  revenue: ChartBarIcon,
  inventory: CubeIcon,
  'stockout-risk': ClockIcon,
  'dead-stock': ArchiveBoxIcon,
  churn: UsersIcon,
  outstanding: BanknotesIcon,
  'purchase-trend': ShoppingCartIcon,
  'salesman-performance': UserGroupIcon,
  'fast-movers': ArrowTrendingUpIcon,
  'discount-anomaly': ReceiptPercentIcon,
  'executive-summary': SparklesIcon,
  'pinned-reports': BookmarkIcon,
};

interface InsightMetricsView {
  headline?: string;
  headlineLabel?: string;
  impactLabel?: string;
  impactValue?: string;
}

export function InsightCard({ insight }: { insight: Insight }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const acknowledge = useInsightAction('acknowledge');
  const resolve = useInsightAction('resolve');

  const severity = SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info;
  const Icon = PROVIDER_ICONS[insight.providerId] ?? SparklesIcon;
  const metrics = (insight.metrics ?? {}) as InsightMetricsView;
  const isOpen = insight.status === 'NEW' || insight.status === 'ACTIVE';
  const evidence = expanded ? insight.evidence : insight.evidence.slice(0, 4);
  const confidencePct = insight.confidence !== null ? Math.round(insight.confidence * 100) : null;

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
      {/* decorative gradient blob, matching the mockup but in brand tones */}
      <div className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 opacity-[0.07]" />

      {/* header: icon tile + title + severity badge */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-600 to-purple-600 text-white shadow-sm">
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold leading-snug text-gray-900">{insight.title}</h3>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-400">
              <span>{insight.category.replace(/-/g, ' ')}</span>
              {insight.status === 'NEW' && (
                <span className="rounded-full bg-primary-100 px-1.5 py-0.5 font-semibold normal-case tracking-normal text-primary-700">
                  New
                </span>
              )}
              {insight.status === 'ACKNOWLEDGED' && (
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-medium normal-case tracking-normal text-gray-600">
                  Acknowledged
                </span>
              )}
            </div>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${severity.badge}`}>
          {severity.label}
        </span>
      </div>

      {/* headline metric */}
      {metrics.headline && (
        <div className="mb-2">
          <div className="text-3xl font-extrabold tracking-tight text-gray-900">{metrics.headline}</div>
          {metrics.headlineLabel && <div className="mt-0.5 text-xs text-gray-500">{metrics.headlineLabel}</div>}
        </div>
      )}

      <p className="mb-3 text-sm leading-relaxed text-gray-600">{insight.summary}</p>

      {/* evidence checklist */}
      {evidence.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {evidence.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      )}

      {/* expandable detail: suggested actions + timestamps */}
      {expanded && (
        <div className="mb-3 space-y-2 border-t border-gray-100 pt-3">
          {insight.actions.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-gray-500">Suggested actions</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                {insight.actions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-xs text-gray-400">
            First detected {new Date(insight.firstDetectedAt).toLocaleString('en-IN')} · Last evaluated{' '}
            {new Date(insight.lastEvaluatedAt).toLocaleString('en-IN')}
          </div>
        </div>
      )}

      {/* confidence bar */}
      {confidencePct !== null && (
        <div className="mb-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${severity.bar}`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
        </div>
      )}

      {/* footer metric row */}
      <div className="mb-4 flex items-center justify-between text-xs text-gray-500">
        <span>{metrics.impactLabel ?? 'Confidence'}</span>
        <strong className="text-sm text-gray-900">{metrics.impactValue ?? (confidencePct !== null ? `${confidencePct}%` : '—')}</strong>
      </div>

      {/* actions */}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {insight.drillDownQuestion && (
          <button
            type="button"
            onClick={() => navigate('/reports/ai', { state: { initialQuestion: insight.drillDownQuestion } })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary-600 to-purple-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-transform hover:scale-[1.03]"
          >
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> View Analysis
          </button>
        )}
        {isOpen && (
          <button
            type="button"
            disabled={acknowledge.isPending}
            onClick={() =>
              acknowledge.mutate({ insightId: insight.id }, { onSuccess: () => toast.success('Insight acknowledged') })
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 text-xs font-semibold text-gray-700 transition-transform hover:scale-[1.03] hover:bg-gray-100 disabled:opacity-50"
          >
            <CheckIcon className="h-3.5 w-3.5" /> Acknowledge
          </button>
        )}
        {insight.status !== 'RESOLVED' && insight.status !== 'ARCHIVED' && (
          <button
            type="button"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ insightId: insight.id }, { onSuccess: () => toast.success('Insight resolved') })}
            className="inline-flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3.5 py-2 text-xs font-semibold text-green-700 transition-transform hover:scale-[1.03] hover:bg-green-100 disabled:opacity-50"
          >
            <CheckCircleIcon className="h-3.5 w-3.5" /> Resolve
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="ml-auto inline-flex items-center gap-1 rounded-xl px-2 py-2 text-xs font-medium text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          aria-label={expanded ? 'Collapse insight' : 'Expand insight'}
        >
          {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
