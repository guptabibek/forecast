import { Card } from '../ui';
import type { AiReportColumn } from '../../services/api/ai-reporting.service';
import { formatAiValue } from './ai-reporting-utils';

interface AiKpiCardProps {
  label: string;
  value: unknown;
  column?: AiReportColumn;
  hint?: string;
}

export function AiKpiCard({ label, value, column, hint }: AiKpiCardProps) {
  return (
    <Card padding="sm" className="min-h-[92px]">
      <div className="text-xs font-medium uppercase text-gray-500 truncate" title={label}>{label}</div>
      {/* Never truncate the value — clipping a currency figure hides its
          magnitude. Let it wrap/shrink so the full amount is always readable. */}
      <div className="mt-2 text-xl font-semibold text-gray-950 break-words tabular-nums">{formatAiValue(value, column)}</div>
      {hint && <div className="mt-1 text-xs text-gray-500 truncate" title={hint}>{hint}</div>}
    </Card>
  );
}
