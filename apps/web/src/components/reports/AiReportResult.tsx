import { Card, CardHeader, EmptyState } from '../ui';
import type {
  AiReportGrid,
  AiReportInterpretation,
  AiReportKpi,
  AiReportMetadata,
  AiReportResponse,
} from '../../services/api/ai-reporting.service';
import { AiAssumptionsPanel } from './AiAssumptionsPanel';
import { AiChartRenderer } from './AiChartRenderer';
import { AiDashboardRenderer } from './AiDashboardRenderer';
import { AiFollowUpQuestions } from './AiFollowUpQuestions';
import { AiKpiCard } from './AiKpiCard';
import { AiReportTable } from './AiReportTable';
import { AiSummaryPanel } from './AiSummaryPanel';

interface AiReportResultProps {
  result: AiReportResponse | null;
  onAskFollowUp: (question: string) => void;
}

export function AiReportResult({ result, onAskFollowUp }: AiReportResultProps) {
  if (!result) {
    return (
      <Card>
        <EmptyState
          title="Ask a report question"
          description="Results will appear here as a table, chart, KPI summary, or dashboard."
        />
      </Card>
    );
  }

  if (result.status === 'clarification_required') {
    return (
      <Card>
        <CardHeader title={result.title || 'Clarification required'} />
        <p className="text-sm text-gray-600">
          {result.clarification || 'The report request needs one more detail before it can run.'}
        </p>
        <div className="mt-4">
          <AiFollowUpQuestions questions={result.followUpQuestions} onAsk={onAskFollowUp} />
        </div>
      </Card>
    );
  }

  if (result.status === 'unsupported') {
    return (
      <Card>
        <CardHeader title={result.title || 'Unsupported report request'} />
        <p className="text-sm text-gray-600">
          {result.unsupportedReason || 'The approved AI reporting catalog cannot answer this question.'}
        </p>
        <ErrorDetails result={result} />
        <div className="mt-4">
          <AiFollowUpQuestions questions={result.followUpQuestions} onAsk={onAskFollowUp} />
        </div>
      </Card>
    );
  }

  if (result.queryKind === 'dashboard' && result.widgets?.length) {
    return (
      <div className="space-y-4">
        <Card padding="sm">
          <CardHeader title={result.title} />
          <AiMetadataBanner metadata={result.metadata} interpretation={result.interpretation} />
        </Card>
        <AiDashboardRenderer widgets={result.widgets} />
        <AiSummaryPanel summary={result.summary} />
        <AiAssumptionsPanel assumptions={result.assumptions} />
        <AiFollowUpQuestions questions={result.followUpQuestions} onAsk={onAskFollowUp} />
      </div>
    );
  }

  const grid = normalizeGrid(result);
  const legacyChartType = result.visualization?.type ?? 'table';
  const showChart = result.chart?.enabled || (legacyChartType !== 'table' && legacyChartType !== 'dashboard');

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <CardHeader title={result.title} />
        <AiMetadataBanner metadata={result.metadata} interpretation={result.interpretation} />
      </Card>
      <AiKpiStrip kpis={result.kpis} />
      {showChart && (
        <Card padding="sm">
          <AiChartRenderer chart={result.chart} visualization={result.visualization} columns={grid.columns} rows={grid.rows} />
        </Card>
      )}
      <Card padding="sm">
        <AiReportTable title={result.title} columns={grid.columns} rows={grid.rows} totals={grid.totals} />
      </Card>
      <AiSummaryPanel summary={result.summary} />
      <AiAssumptionsPanel assumptions={result.assumptions} />
      <AiFollowUpQuestions questions={result.followUpQuestions} onAsk={onAskFollowUp} />
    </div>
  );
}

function normalizeGrid(result: AiReportResponse): AiReportGrid {
  return {
    columns: result.grid?.columns ?? result.columns ?? [],
    rows: result.grid?.rows ?? result.rows ?? [],
    totals: result.grid?.totals,
  };
}

function AiKpiStrip({ kpis }: { kpis?: AiReportKpi[] }) {
  if (!kpis?.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <AiKpiCard
          key={kpi.label}
          label={kpi.label}
          value={kpi.value}
          hint={kpi.hint}
          column={{ key: kpi.label, label: kpi.label, dataType: kpi.dataType }}
        />
      ))}
    </div>
  );
}

function AiMetadataBanner({ metadata, interpretation }: { metadata?: AiReportMetadata; interpretation?: AiReportInterpretation }) {
  const parts: string[] = [];
  if (metadata?.metricLabel) parts.push(`Metric: ${metadata.metricLabel}`);
  if (metadata?.groupedBy) parts.push(`Grouped by: ${metadata.groupedBy}`);
  if (metadata?.periodLabel) parts.push(`Period: ${metadata.periodLabel}`);
  if (!parts.length && interpretation) {
    if (interpretation.metrics.length) {
      parts.push(`Metrics: ${interpretation.metrics.map((m) => m.label).join(', ')}`);
    }
    if (interpretation.dimensions.length) {
      parts.push(`Grouped by: ${interpretation.dimensions.map((d) => d.label).join(', ')}`);
    }
    if (interpretation.timeRange) {
      parts.push(`Period: ${describeRange(interpretation.timeRange)}`);
    }
  }
  if (!parts.length) return null;
  return (
    <p className="mt-1 text-xs text-gray-500" data-testid="ai-interpretation">
      {parts.join(' | ')}
    </p>
  );
}

function ErrorDetails({ result }: { result: AiReportResponse }) {
  const details = [
    ...(result.missingCapabilities ?? []),
    ...(result.availableAlternatives ?? []).map((item) => `Alternative: ${item}`),
    result.recommendedSchemaFix ? `Schema fix: ${result.recommendedSchemaFix}` : null,
  ].filter(Boolean) as string[];
  if (!details.length) return null;
  return (
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
      {details.map((detail) => (
        <li key={detail}>{detail}</li>
      ))}
    </ul>
  );
}

function describeRange(range: AiReportInterpretation['timeRange']): string {
  if (!range) return '';
  if (range.type === 'custom' && range.startDate && range.endDate) return `${range.startDate} to ${range.endDate}`;
  return range.type.replace(/_/g, ' ');
}
