import { Dialog, Transition } from '@headlessui/react';
import {
  ArrowTopRightOnSquareIcon,
  ClockIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { Fragment, useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAiDashboardQuery, useAiReportQuery, useAiReportingCatalog, useAiReportingHistory } from '../../hooks/useAiReporting';
import { canUseAiReporting } from '../../permissions';
import type { AiCatalogMetadata, AiReportColumn, AiReportResponse, AiReportRow } from '../../services/api/ai-reporting.service';
import { useAuthStore } from '../../stores/auth.store';
import { useBranding } from '../ThemeProvider';
import { Button, LoadingSpinner } from '../ui';
import { columnField, formatAiValue } from './ai-reporting-utils';

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
    .slice(0, 7);
}

export function AiReportingAssistant() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { settings } = useBranding();
  const isAvailable = canUseAiReporting(user, settings?.aiReporting?.enabled === true);
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [result, setResult] = useState<AiReportResponse | null>(null);

  const catalog = useAiReportingCatalog(isAvailable && isOpen);
  const history = useAiReportingHistory(5, isAvailable && isOpen);
  const reportQuery = useAiReportQuery();
  const dashboardQuery = useAiDashboardQuery();
  const isSubmitting = reportQuery.isPending || dashboardQuery.isPending;
  const error = reportQuery.error ?? dashboardQuery.error;
  const suggestions = useMemo(() => buildSuggestions(catalog.data), [catalog.data]);

  if (!isAvailable) return null;

  const runQuestion = async (rawQuestion: string) => {
    const nextQuestion = rawQuestion.trim();
    if (!nextQuestion) {
      setValidation('Enter a report question.');
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

  const openWorkspace = () => {
    setIsOpen(false);
    navigate('/reports/ai', {
      state: {
        initialQuestion: question || lastQuestion,
        initialResult: result,
      },
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg shadow-primary-900/20 transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        aria-label="Open AI Reporting Assistant"
        title="AI Reporting Assistant"
      >
        <SparklesIcon className="h-6 w-6" />
      </button>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsOpen(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-950/30" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-hidden">
            <div className="absolute inset-0 flex justify-end">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-out duration-300"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in duration-200"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="flex h-full w-full max-w-[28rem] flex-col border-l border-gray-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                    <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-gray-950">
                      <SparklesIcon className="h-5 w-5 text-primary-600" />
                      AI Reporting Assistant
                    </Dialog.Title>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={openWorkspace}
                        className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                        aria-label="Open full report workspace"
                        title="Open full report workspace"
                      >
                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                        aria-label="Close AI Reporting Assistant"
                      >
                        <XMarkIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                    <CompactResult
                      result={result}
                      isLoading={isSubmitting}
                      error={error}
                      onRetry={lastQuestion ? () => void runQuestion(lastQuestion) : undefined}
                      onOpenWorkspace={openWorkspace}
                      onAskFollowUp={runQuestion}
                    />

                    <section>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Prompts</h3>
                        {catalog.isFetching && <LoadingSpinner size="sm" />}
                      </div>
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
                    </section>

                    <section>
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <ClockIcon className="h-4 w-4" />
                        Recent
                      </div>
                      {!history.data?.length ? (
                        <p className="text-sm text-gray-500">No recent AI reports.</p>
                      ) : (
                        <div className="space-y-2">
                          {history.data.map((item) => (
                            <button
                              key={item.requestId}
                              type="button"
                              onClick={() => void runQuestion(item.question)}
                              className="w-full rounded-lg border border-gray-100 bg-white p-2.5 text-left text-sm text-gray-700 hover:border-primary-200 hover:bg-primary-50/40"
                            >
                              <span className="line-clamp-2">{item.question}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  <form onSubmit={submit} className="border-t border-gray-200 p-3">
                    <textarea
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
                      className="block min-h-[84px] w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50"
                    />
                    {validation && <p className="mt-2 text-sm text-red-600">{validation}</p>}
                    <div className="mt-3 flex items-center justify-end">
                      <Button
                        type="submit"
                        size="sm"
                        isLoading={isSubmitting}
                        disabled={isSubmitting}
                        leftIcon={<PaperAirplaneIcon className="h-4 w-4" />}
                      >
                        Run
                      </Button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}

function CompactResult({
  result,
  isLoading,
  error,
  onRetry,
  onOpenWorkspace,
  onAskFollowUp,
}: {
  result: AiReportResponse | null;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  onOpenWorkspace: () => void;
  onAskFollowUp: (question: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-primary-100 bg-primary-50 p-4">
        <div className="flex items-center gap-3 text-sm font-medium text-primary-800">
          <LoadingSpinner size="sm" />
          Running AI report
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-800">AI report failed</p>
        <p className="mt-1 text-sm text-red-700">{errorMessage(error)}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-3 text-sm font-semibold text-red-800 underline">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-800">Ready for report questions</p>
      </div>
    );
  }

  if (result.status === 'clarification_required' || result.status === 'unsupported') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">{result.title}</p>
        <p className="mt-1 text-sm text-amber-800">
          {result.clarification || result.unsupportedReason || 'The report request needs another detail.'}
        </p>
        <FollowUpButtons questions={result.followUpQuestions} onAsk={onAskFollowUp} />
      </div>
    );
  }

  if (result.queryKind === 'dashboard' && result.widgets?.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <ResultHeader title={result.title} onOpenWorkspace={onOpenWorkspace} />
        <div className="mt-3 space-y-2">
          {result.widgets.slice(0, 4).map((widget) => (
            <div key={widget.widgetId || widget.title} className="rounded-md border border-gray-100 bg-gray-50 p-2">
              <p className="text-sm font-medium text-gray-800">{widget.title}</p>
              <p className="text-xs text-gray-500">{(widget.grid?.rows ?? widget.rows ?? []).length} rows</p>
            </div>
          ))}
        </div>
        <FollowUpButtons questions={result.followUpQuestions} onAsk={onAskFollowUp} />
      </div>
    );
  }

  const grid = {
    columns: result.grid?.columns ?? result.columns ?? [],
    rows: result.grid?.rows ?? result.rows ?? [],
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <ResultHeader title={result.title} onOpenWorkspace={onOpenWorkspace} />
      {result.summary && <p className="mt-2 text-sm text-gray-600">{result.summary}</p>}
      {!!result.kpis?.length && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {result.kpis.slice(0, 4).map((kpi) => (
            <div key={kpi.label} className="rounded-md bg-gray-50 p-2">
              <p className="truncate text-[11px] font-medium uppercase tracking-wide text-gray-500">{kpi.label}</p>
              <p className="mt-1 truncate text-sm font-semibold text-gray-900">
                {String(kpi.value ?? '-')}
              </p>
            </div>
          ))}
        </div>
      )}
      <CompactTable columns={grid.columns} rows={grid.rows} />
      <FollowUpButtons questions={result.followUpQuestions} onAsk={onAskFollowUp} />
    </div>
  );
}

function ResultHeader({ title, onOpenWorkspace }: { title: string; onOpenWorkspace: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h3 className="min-w-0 text-sm font-semibold text-gray-950">{title}</h3>
      <button
        type="button"
        onClick={onOpenWorkspace}
        className="flex-shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        aria-label="Open full report workspace"
        title="Open full report workspace"
      >
        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function CompactTable({ columns, rows }: { columns: AiReportColumn[]; rows: AiReportRow[] }) {
  const displayColumns = columns
    .map((column) => ({ ...column, key: columnField(column) }))
    .filter((column): column is AiReportColumn & { key: string } => typeof column.key === 'string' && column.key.length > 0)
    .slice(0, 4);
  const previewRows = rows.slice(0, 6);
  if (!displayColumns.length || !previewRows.length) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            {displayColumns.map((column) => (
              <th key={column.key} className={clsx('px-2 py-2 text-left font-semibold text-gray-500', isNumericColumn(column.key) && 'text-right')}>
                {column.label || column.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {previewRows.map((row, index) => (
            <tr key={index}>
              {displayColumns.map((column) => (
                <td key={column.key} className={clsx('max-w-[8rem] truncate px-2 py-2 text-gray-700', isNumericColumn(column.key) && 'text-right tabular-nums')}>
                  {formatAiValue(row[column.key], column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FollowUpButtons({ questions, onAsk }: { questions?: string[]; onAsk: (question: string) => void }) {
  if (!questions?.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {questions.slice(0, 3).map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onAsk(question)}
          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-primary-300 hover:text-primary-700"
        >
          {question}
        </button>
      ))}
    </div>
  );
}

function isNumericColumn(key: string) {
  return /(amount|value|sales|purchase|outstanding|balance|quantity|qty|rate|count|tax|discount|gross|net|stock|total)$/i.test(key);
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const response = (error as { response?: { data?: { message?: string | string[] } } }).response;
    const message = response?.data?.message;
    if (Array.isArray(message)) return message.join(' ');
    if (message) return message;
  }
  return error instanceof Error ? error.message : 'The AI provider or report service rejected the request.';
}
