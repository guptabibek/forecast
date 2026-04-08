import {
    CartesianGrid,
    Legend,
    Line,
    LineChart as RechartsLineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

interface DataPoint {
  [key: string]: string | number;
}

interface LineConfig {
  dataKey: string;
  name: string;
  color: string;
  strokeDasharray?: string;
  strokeWidth?: number;
}

interface LineChartProps {
  data: DataPoint[];
  lines: LineConfig[];
  xAxisKey: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  referenceLines?: { y: number; label: string; color: string }[];
  formatYAxis?: (value: number) => string;
  formatTooltip?: (value: number) => string;
}

const defaultColors = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
];

export function LineChart({
  data,
  lines,
  xAxisKey,
  xAxisLabel,
  yAxisLabel,
  height = 400,
  showGrid = true,
  showLegend = true,
  referenceLines = [],
  formatYAxis,
  formatTooltip,
}: LineChartProps) {
  const formatNumber = (value: number) => {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toFixed(0);
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
        <XAxis
          dataKey={xAxisKey}
          tick={{ fontSize: 12, fill: '#6B7280' }}
          tickLine={{ stroke: '#D1D5DB' }}
          axisLine={{ stroke: '#D1D5DB' }}
          label={
            xAxisLabel
              ? { value: xAxisLabel, position: 'bottom', offset: 0, fill: '#6B7280' }
              : undefined
          }
        />
        <YAxis
          tick={{ fontSize: 12, fill: '#6B7280' }}
          tickLine={{ stroke: '#D1D5DB' }}
          axisLine={{ stroke: '#D1D5DB' }}
          tickFormatter={formatYAxis || formatNumber}
          label={
            yAxisLabel
              ? { value: yAxisLabel, angle: -90, position: 'insideLeft', fill: '#6B7280' }
              : undefined
          }
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
          formatter={(value: number, name: string) => [
            formatTooltip ? formatTooltip(value) : formatNumber(value),
            name,
          ]}
        />
        {showLegend && (
          <Legend
            verticalAlign="top"
            height={36}
            iconType="line"
            wrapperStyle={{ fontSize: '12px' }}
          />
        )}
        {referenceLines.map((refLine, index) => (
          <ReferenceLine
            key={index}
            y={refLine.y}
            label={refLine.label}
            stroke={refLine.color}
            strokeDasharray="5 5"
          />
        ))}
        {lines.map((line, index) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.color || defaultColors[index % defaultColors.length]}
            strokeWidth={line.strokeWidth || 2}
            strokeDasharray={line.strokeDasharray}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
