import {
    Bar,
    CartesianGrid,
    Cell,
    Legend,
    BarChart as RechartsBarChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

interface DataPoint {
  [key: string]: string | number;
}

interface BarConfig {
  dataKey: string;
  name: string;
  color: string;
  stackId?: string;
}

interface BarChartProps {
  data: DataPoint[];
  bars: BarConfig[];
  xAxisKey: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  layout?: 'horizontal' | 'vertical';
  stacked?: boolean;
  referenceLines?: { y: number; label: string; color: string }[];
  formatYAxis?: (value: number) => string;
  formatTooltip?: (value: number) => string;
  colorByValue?: (value: number) => string;
}

const defaultColors = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
];

export function BarChart({
  data,
  bars,
  xAxisKey,
  xAxisLabel,
  yAxisLabel,
  height = 400,
  showGrid = true,
  showLegend = true,
  layout = 'horizontal',
  stacked = false,
  referenceLines = [],
  formatYAxis,
  formatTooltip,
  colorByValue,
}: BarChartProps) {
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
      <RechartsBarChart
        data={data}
        layout={layout}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
        {layout === 'horizontal' ? (
          <>
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
          </>
        ) : (
          <>
            <XAxis
              type="number"
              tick={{ fontSize: 12, fill: '#6B7280' }}
              tickLine={{ stroke: '#D1D5DB' }}
              axisLine={{ stroke: '#D1D5DB' }}
              tickFormatter={formatYAxis || formatNumber}
            />
            <YAxis
              type="category"
              dataKey={xAxisKey}
              tick={{ fontSize: 12, fill: '#6B7280' }}
              tickLine={{ stroke: '#D1D5DB' }}
              axisLine={{ stroke: '#D1D5DB' }}
              width={100}
            />
          </>
        )}
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
            wrapperStyle={{ fontSize: '12px' }}
          />
        )}
        {referenceLines.map((refLine, index) => (
          <ReferenceLine
            key={index}
            y={layout === 'horizontal' ? refLine.y : undefined}
            x={layout === 'vertical' ? refLine.y : undefined}
            label={refLine.label}
            stroke={refLine.color}
            strokeDasharray="5 5"
          />
        ))}
        {bars.map((bar, index) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name}
            fill={bar.color || defaultColors[index % defaultColors.length]}
            stackId={stacked ? bar.stackId || 'stack' : undefined}
            radius={[4, 4, 0, 0]}
          >
            {colorByValue &&
              data.map((entry, idx) => (
                <Cell
                  key={`cell-${idx}`}
                  fill={colorByValue(entry[bar.dataKey] as number)}
                />
              ))}
          </Bar>
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

interface WaterfallChartProps {
  data: { name: string; value: number }[];
  height?: number;
  showGrid?: boolean;
  positiveColor?: string;
  negativeColor?: string;
  totalColor?: string;
  formatValue?: (value: number) => string;
}

export function WaterfallChart({
  data,
  height = 400,
  showGrid = true,
  positiveColor = '#10B981',
  negativeColor = '#EF4444',
  totalColor = '#3B82F6',
  formatValue,
}: WaterfallChartProps) {
  // Transform data for waterfall effect
  let runningTotal = 0;
  const waterfallData = data.map((item) => {
    const isTotal = item.name.toLowerCase().includes('total');
    const start = isTotal ? 0 : runningTotal;
    runningTotal = isTotal ? item.value : runningTotal + item.value;

    return {
      name: item.name,
      value: Math.abs(item.value),
      start,
      end: runningTotal,
      isPositive: item.value >= 0,
      isTotal,
    };
  });

  const formatNumber = (value: number) => {
    if (formatValue) return formatValue(value);
    if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toFixed(0);
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={waterfallData}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12, fill: '#6B7280' }}
          tickLine={{ stroke: '#D1D5DB' }}
          axisLine={{ stroke: '#D1D5DB' }}
        />
        <YAxis
          tick={{ fontSize: 12, fill: '#6B7280' }}
          tickLine={{ stroke: '#D1D5DB' }}
          axisLine={{ stroke: '#D1D5DB' }}
          tickFormatter={formatNumber}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
          formatter={(value: number) => [formatNumber(value), 'Value']}
        />
        <Bar dataKey="start" stackId="waterfall" fill="transparent" />
        <Bar dataKey="value" stackId="waterfall" radius={[4, 4, 0, 0]}>
          {waterfallData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={
                entry.isTotal
                  ? totalColor
                  : entry.isPositive
                  ? positiveColor
                  : negativeColor
              }
            />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
