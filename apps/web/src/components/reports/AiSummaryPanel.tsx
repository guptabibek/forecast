import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { Card } from '../ui';

export function AiSummaryPanel({ summary }: { summary?: string | null }) {
  if (!summary) return null;
  return (
    <Card padding="sm" className="border-primary-100 bg-primary-50/50">
      <div className="flex gap-3">
        <InformationCircleIcon className="h-5 w-5 flex-shrink-0 text-primary-600" />
        <div>
          <div className="text-sm font-semibold text-primary-950">AI Summary</div>
          <p className="mt-1 text-sm leading-6 text-primary-900">{summary}</p>
        </div>
      </div>
    </Card>
  );
}
