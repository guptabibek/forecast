import { Card, CardHeader } from '../ui';
import type { AiReportKpi, AiReportWidget } from '../../services/api/ai-reporting.service';
import { AiChartRenderer } from './AiChartRenderer';
import { AiKpiCard } from './AiKpiCard';
import { AiReportTable } from './AiReportTable';
import { AiSummaryPanel } from './AiSummaryPanel';

export function AiDashboardRenderer({ widgets }: { widgets: AiReportWidget[] }) {
  if (!widgets.length) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {widgets.map((widget) => {
        const grid = widget.grid ?? { columns: widget.columns, rows: widget.rows };
        const chartType = widget.chart?.type ?? widget.visualization?.type;
        const showChart = widget.chart?.enabled || (chartType && chartType !== 'table' && chartType !== 'kpi');
        return (
          <Card key={widget.widgetId || widget.title} padding="sm" className="min-w-0">
            <CardHeader title={widget.title} className="mb-3" />
            <AiKpiStrip kpis={widget.kpis} />
            {showChart && (
              <div className={widget.kpis?.length ? 'mt-3' : undefined}>
                <AiChartRenderer chart={widget.chart} visualization={widget.visualization} columns={grid.columns} rows={grid.rows} />
              </div>
            )}
            <div className={showChart || widget.kpis?.length ? 'mt-3' : undefined}>
              <AiReportTable title={widget.title} columns={grid.columns} rows={grid.rows} totals={grid.totals} />
            </div>
            <div className="mt-3">
              <AiSummaryPanel summary={widget.summary} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function AiKpiStrip({ kpis }: { kpis?: AiReportKpi[] }) {
  if (!kpis?.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {kpis.slice(0, 4).map((kpi) => (
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
