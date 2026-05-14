import { BarChart, LineChart, PieChart } from '../charts';
import { EmptyState } from '../ui';
import type { AiReportChart, AiReportColumn, AiReportRow, AiReportVisualization } from '../../services/api/ai-reporting.service';
import { asNumber, columnField, firstNumericColumn, firstTextColumn, formatAiValue, labelForColumn } from './ai-reporting-utils';
import { AiKpiCard } from './AiKpiCard';

interface AiChartRendererProps {
  chart?: AiReportChart;
  visualization?: AiReportVisualization;
  columns: AiReportColumn[];
  rows: AiReportRow[];
}

const chartColor = '#2563eb';

export function AiChartRenderer({ chart, visualization, columns, rows }: AiChartRendererProps) {
  const sourceRows = chart?.data?.length ? chart.data : rows;
  if (!sourceRows.length) {
    return <EmptyState title="No chart data" description="No matching rows were returned for this chart." />;
  }

  const y = chart?.yField ?? visualization?.y ?? firstNumericColumn(columns, sourceRows);
  const x = chart?.xField ?? visualization?.x ?? firstTextColumn(columns, y ?? undefined);
  const type = chart?.type ?? visualization?.type ?? 'table';

  if (type === 'kpi') {
    return <AiKpiSet columns={columns} row={sourceRows[0]} />;
  }

  if (!x || !y) {
    return <EmptyState title="Chart unavailable" description="The result does not include compatible chart dimensions and metrics." />;
  }

  const invalidLabels = sourceRows.filter((row) => !hasLabel(row[x])).length;
  if (invalidLabels > sourceRows.length / 2) {
    console.warn(`AI chart label field "${x}" is missing for most rows; rendering grid without a misleading chart.`);
    return <EmptyState title="Chart unavailable" description="The selected chart label is not present in the result rows." />;
  }

  const data: Array<Record<string, string | number | null | undefined>> = sourceRows
    .slice(0, type === 'pie' ? 12 : 50)
    .map((row) => {
      const point: Record<string, string | number | null | undefined> = {};
      for (const column of columns) {
        const key = columnField(column);
        const value = row[key];
        point[key] = typeof value === 'string' || typeof value === 'number' || value == null
          ? value
          : String(value);
      }
      point[x] = hasLabel(row[x]) ? String(row[x]) : 'Unknown';
      point[y] = asNumber(row[y]) ?? 0;
      return point;
    });
  const metricLabel = labelForColumn(columns, y);
  const dimensionLabel = labelForColumn(columns, x);
  const metricColumn = columns.find((column) => columnField(column) === y);
  const formatMetric = (value: number) => formatAiValue(value, metricColumn);
  const hasLongLabels = data.some((row) => String(row[x] ?? '').length > 24);
  const verticalBar = type === 'bar' && (hasLongLabels || data.length > 10);
  const chartHeight = verticalBar ? Math.min(Math.max(320, data.length * 30), 720) : 320;

  if (type === 'line') {
    return (
      <LineChart
        data={data as Array<Record<string, string | number>>}
        xAxisKey={x}
        lines={[{ dataKey: y, name: metricLabel, color: chartColor }]}
        height={320}
        showLegend={false}
        formatYAxis={formatMetric}
        formatTooltip={formatMetric}
      />
    );
  }

  if (type === 'pie') {
    return (
      <PieChart
        data={data.map((row) => ({ name: String(row[x]), value: asNumber(row[y]) ?? 0 }))}
        height={320}
        innerRadius={56}
        showLegend
        formatValue={formatMetric}
      />
    );
  }

  return (
    <BarChart
      data={data}
      xAxisKey={x}
      xAxisLabel={dimensionLabel}
      bars={[{ dataKey: y, name: metricLabel, color: chartColor }]}
      height={chartHeight}
      layout={verticalBar ? 'vertical' : 'horizontal'}
      yAxisWidth={verticalBar ? 180 : undefined}
      formatCategory={(value) => truncateLabel(String(value), verticalBar ? 28 : 18)}
      showLegend={false}
      formatYAxis={formatMetric}
      formatTooltip={formatMetric}
    />
  );
}

function AiKpiSet({ columns, row }: { columns: AiReportColumn[]; row: AiReportRow }) {
  const metricColumns = columns.filter((column) => asNumber(row[columnField(column)]) !== null);
  if (!metricColumns.length) {
    return <EmptyState title="No KPI values" description="The result does not include numeric KPI values." />;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metricColumns.slice(0, 8).map((column) => (
        <AiKpiCard key={columnField(column)} label={column.label || columnField(column)} value={row[columnField(column)]} column={column} />
      ))}
    </div>
  );
}

function hasLabel(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '' && String(value).trim() !== '-';
}

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}
