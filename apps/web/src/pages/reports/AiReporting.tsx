import { useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  ArrowPathIcon,
  ClockIcon,
  PaperAirplaneIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { Navigate, useLocation } from 'react-router-dom';
import { Button, Card, LoadingSpinner } from '../../components/ui';
import { AiErrorState } from '../../components/reports/AiErrorState';
import { AiLoadingState } from '../../components/reports/AiLoadingState';
import { AiReportResult } from '../../components/reports/AiReportResult';
import { PinToDashboardButton } from '../../components/insights-dashboard/PinToDashboardButton';
import { useAiDashboardQuery, useAiReportQuery, useAiReportingCatalog, useAiReportingHistory } from '../../hooks/useAiReporting';
import { canUseAiReporting, getFallbackPathForRole } from '../../permissions';
import { useAuthStore } from '../../stores/auth.store';
import type { AiCatalogMetadata, AiReportResponse } from '../../services/api/ai-reporting.service';
import { useBranding } from '../../components/ThemeProvider';

const FALLBACK_SUGGESTIONS = [
  'Top selling products this month',
  'Salesman-wise sales today',
  'Customer-wise sales this financial year',
  'Top purchasing items last month',
  'Stock below minimum',
  'Supplier-wise purchase summary',
];

function isDashboardQuestion(question: string): boolean {
  return /\bdashboard\b/i.test(question);
}

function buildSuggestions(catalog?: AiCatalogMetadata): string[] {
  const dynamic = [
    ...(catalog?.suggestedQuestions ?? []),
    ...(catalog?.reportTemplates ?? []).flatMap((template) => [
      ...((template.synonyms ?? []).slice(0, 2)),
      template.displayName,
    ]),
    ...(catalog?.dashboardTemplates ?? []).flatMap((template) => [
      ...((template.synonyms ?? []).slice(0, 1)),
      template.displayName,
    ]),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  return [...dynamic, ...FALLBACK_SUGGESTIONS]
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AiReporting() {
  const location = useLocation();
  const routeState = location.state as { initialQuestion?: string; initialResult?: AiReportResponse | null } | null;
  const user = useAuthStore((state) => state.user);
  const { settings, isLoading: isSettingsLoading } = useBranding();
  const [question, setQuestion] = useState(routeState?.initialQuestion ?? '');
  const [lastQuestion, setLastQuestion] = useState(routeState?.initialQuestion ?? '');
  const [validation, setValidation] = useState<string | null>(null);
  const [result, setResult] = useState<AiReportResponse | null>(routeState?.initialResult ?? null);

  const catalog = useAiReportingCatalog();
  const history = useAiReportingHistory(12);
  const reportQuery = useAiReportQuery();
  const dashboardQuery = useAiDashboardQuery();
  const isSubmitting = reportQuery.isPending || dashboardQuery.isPending;
  const error = reportQuery.error ?? dashboardQuery.error;
  const suggestions = useMemo(() => buildSuggestions(catalog.data), [catalog.data]);
  const reportAreas = useMemo(() => {
    if (catalog.data?.reportAreas?.length) return catalog.data.reportAreas;
    const seen = new Set<string>();
    return (catalog.data?.datasets ?? [])
      .map((dataset) => dataset.domain.replace(/\b\w/g, (char) => char.toUpperCase()))
      .filter((domain) => {
        const key = domain.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [catalog.data]);

  if (isSettingsLoading) {
    return <AiLoadingState />;
  }

  if (!canUseAiReporting(user, settings?.aiReporting?.enabled === true)) {
    return <Navigate to={getFallbackPathForRole(user?.role)} replace />;
  }

  const runQuestion = async (rawQuestion: string) => {
    const nextQuestion = rawQuestion.trim();
    if (!nextQuestion) {
      setValidation('Enter a report question before running AI reporting.');
      return;
    }
    if (isSubmitting) return;

    setValidation(null);
    setLastQuestion(nextQuestion);
    setQuestion(nextQuestion);

    try {
      const request = { question: nextQuestion, outputMode: 'auto' as const, includeSummary: true };
      const response = isDashboardQuestion(nextQuestion)
        ? await dashboardQuery.mutateAsync(request)
        : await reportQuery.mutateAsync(request);
      setResult(response);
      if (response.status === 'clarification_required') {
        toast('AI reporting needs one more detail.');
      }
    } catch {
      setResult(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runQuestion(question);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void runQuestion(question);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-950 lg:text-2xl">AI Reporting</h1>
          <p className="mt-1 text-sm text-gray-500">
            Ask questions about your sales, purchases, stock, customers, suppliers, and reports.
          </p>
        </div>
        <div className="text-xs text-gray-500">
          Catalog {catalog.data?.catalogVersion ?? 'loading'}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="space-y-5 min-w-0">
          <Card padding="sm">
            <form onSubmit={submit} className="space-y-3">
              <label htmlFor="ai-report-question" className="text-sm font-semibold text-gray-900">
                Report question
              </label>
              <div className="flex flex-col gap-3 md:flex-row">
                <textarea
                  id="ai-report-question"
                  value={question}
                  onChange={(event) => {
                    setQuestion(event.target.value);
                    if (validation) setValidation(null);
                  }}
                  onKeyDown={onKeyDown}
                  rows={3}
                  maxLength={1000}
                  disabled={isSubmitting}
                  placeholder="Show top selling products this month"
                  className="min-h-[88px] flex-1 resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50"
                />
                <div className="flex md:w-36 md:flex-col">
                  <Button
                    type="submit"
                    className="w-full"
                    isLoading={isSubmitting}
                    disabled={isSubmitting}
                    leftIcon={<PaperAirplaneIcon className="h-4 w-4" />}
                  >
                    Run
                  </Button>
                </div>
              </div>
              {validation && <p className="text-sm text-red-600">{validation}</p>}
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void runQuestion(suggestion)}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </form>
          </Card>

          {isSubmitting ? (
            <AiLoadingState />
          ) : error ? (
            <AiErrorState error={error} onRetry={lastQuestion ? () => void runQuestion(lastQuestion) : undefined} />
          ) : (
            <>
              {result && (
                <div className="flex justify-end">
                  <PinToDashboardButton result={result} />
                </div>
              )}
              <AiReportResult result={result} onAskFollowUp={runQuestion} />
            </>
          )}
        </main>

        <aside className="space-y-4">
          <Card padding="sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SparklesIcon className="h-5 w-5 text-primary-600" />
                <h2 className="text-sm font-semibold text-gray-900">Available report areas</h2>
              </div>
              {catalog.isFetching && <LoadingSpinner size="sm" />}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {reportAreas.slice(0, 10).map((domain) => (
                <span key={domain} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                  {domain}
                </span>
              ))}
            </div>
          </Card>

          <Card padding="sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClockIcon className="h-5 w-5 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-900">Recent AI reports</h2>
              </div>
              <button
                type="button"
                onClick={() => void history.refetch()}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Refresh history"
              >
                <ArrowPathIcon className="h-4 w-4" />
              </button>
            </div>
            {history.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <LoadingSpinner size="sm" />
                Loading history
              </div>
            ) : !history.data?.length ? (
              <p className="text-sm text-gray-500">No AI report history yet.</p>
            ) : (
              <div className="space-y-2">
                {history.data.map((item) => (
                  <button
                    key={item.requestId}
                    type="button"
                    onClick={() => void runQuestion(item.question)}
                    className="w-full rounded-lg border border-gray-100 bg-white p-3 text-left hover:border-primary-200 hover:bg-primary-50/40"
                  >
                    <div className="line-clamp-2 text-sm font-medium text-gray-800">{item.question}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500">
                      <span>{formatHistoryTime(item.createdAt)}</span>
                      <span className={item.status === 'success' ? 'text-green-700' : 'text-red-700'}>
                        {item.status}
                      </span>
                    </div>
                    {item.status !== 'success' && (item.errorMessage || item.errorCode) && (
                      <div className="mt-1 line-clamp-2 text-xs text-red-700">
                        {item.errorMessage || item.errorCode}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
