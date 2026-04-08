import {
    Bar,
    Brush,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ReferenceArea,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

interface DataPoint {
  [key: string]: string | number;
}

interface ForecastChartProps {
  data: DataPoint[];
  xAxisKey: string;
  actualKey?: string;
  forecastKey: string;
  lowerBoundKey?: string;
  upperBoundKey?: string;
  historicalEndIndex?: number;
  height?: number;
  showBrush?: boolean;
  showConfidenceBand?: boolean;
  actualColor?: string;
  forecastColor?: string;
  confidenceColor?: string;
  formatYAxis?: (value: number) => string;
}

export function ForecastChart({
  data,
  xAxisKey,
  actualKey = 'actual',
  forecastKey = 'forecast',
  lowerBoundKey = 'lowerBound',
  upperBoundKey = 'upperBound',
  historicalEndIndex,
  height = 400,
  showBrush = false,
  showConfidenceBand = true,
  actualColor = '#3B82F6',
  forecastColor = '#10B981',
  confidenceColor = '#10B981',
  formatYAxis,
}: ForecastChartProps) {
  const formatNumber = (value: number) => {
    if (formatYAxis) return formatYAxis(value);
    if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toFixed(0);
  };

  // Prepare data with confidence band as an area
  const chartData = data.map((point) => ({
    ...point,
    confidenceRange:
      point[upperBoundKey] && point[lowerBoundKey]
        ? [point[lowerBoundKey], point[upperBoundKey]]
        : undefined,
  }));

  const renderHistoricalArea = () => {
    if (historicalEndIndex === undefined || historicalEndIndex < 0) return null;
    return (
      <ReferenceArea
        x1={data[0]?.[xAxisKey] as string}
        x2={data[historicalEndIndex]?.[xAxisKey] as string}
        fill="#F3F4F6"
        fillOpacity={0.5}
      />
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={chartData}
        margin={{ top: 20, right: 30, left: 20, bottom: showBrush ? 50 : 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        {renderHistoricalArea()}
        <XAxis
          dataKey={xAxisKey}
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
          formatter={(value: number, name: string) => [formatNumber(value), name]}
        />
        <Legend
          verticalAlign="top"
          height={36}
          iconType="line"
          wrapperStyle={{ fontSize: '12px' }}
        />

        {/* Confidence band using bar with error bars effect */}
        {showConfidenceBand && (
          <Bar
            dataKey="confidenceRange"
            fill={confidenceColor}
            fillOpacity={0.1}
            stroke="none"
            barSize={30}
          />
        )}

        {/* Actual values */}
        {actualKey && (
          <Line
            type="monotone"
            dataKey={actualKey}
            name="Actual"
            stroke={actualColor}
            strokeWidth={2}
            dot={{ r: 3, fill: actualColor }}
            activeDot={{ r: 5 }}
          />
        )}

        {/* Forecast values */}
        <Line
          type="monotone"
          dataKey={forecastKey}
          name="Forecast"
          stroke={forecastColor}
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={{ r: 3, fill: forecastColor }}
          activeDot={{ r: 5 }}
        />

        {/* Upper bound */}
        {showConfidenceBand && (
          <Line
            type="monotone"
            dataKey={upperBoundKey}
            name="Upper Bound"
            stroke={confidenceColor}
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            opacity={0.5}
          />
        )}

        {/* Lower bound */}
        {showConfidenceBand && (
          <Line
            type="monotone"
            dataKey={lowerBoundKey}
            name="Lower Bound"
            stroke={confidenceColor}
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            opacity={0.5}
          />
        )}

        {showBrush && (
          <Brush
            dataKey={xAxisKey}
            height={30}
            stroke="#9CA3AF"
            fill="#F9FAFB"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

interface AccuracyChartProps {
  data: {
    period: string;
    actual: number;
    forecast: number;
    mape?: number;
  }[];
  height?: number;
}

export function AccuracyChart({ data, height = 400 }: AccuracyChartProps) {
  const formatNumber = (value: number) => {
    if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toFixed(0);
  };

  const chartData = data.map((item) => ({
    ...item,
    variance: item.actual - item.forecast,
    variancePercent: item.actual !== 0 
      ? ((item.actual - item.forecast) / item.actual) * 100 
      : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={chartData}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="period"
          tick={{ fontSize: 12, fill: '#6B7280' }}
          tickLine={{ stroke: '#D1D5DB' }}
          axisLine={{ stroke: '#D1D5DB' }}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 12, fill: '#6B7280' }}
          tickLine={{ stroke: '#D1D5DB' }}
          axisLine={{ stroke: '#D1D5DB' }}
          tickFormatter={formatNumber}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 12, fill: '#6B7280' }}
          tickLine={{ stroke: '#D1D5DB' }}
          axisLine={{ stroke: '#D1D5DB' }}
          tickFormatter={(value) => `${value.toFixed(1)}%`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
        />
        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />

        <Bar
          yAxisId="left"
          dataKey="actual"
          name="Actual"
          fill="#3B82F6"
          opacity={0.8}
          radius={[4, 4, 0, 0]}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="forecast"
          name="Forecast"
          stroke="#10B981"
          strokeWidth={2}
          dot={{ r: 4, fill: '#10B981' }}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="variancePercent"
          name="Variance %"
          stroke="#F59E0B"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={{ r: 3, fill: '#F59E0B' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
