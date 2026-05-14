import { Card } from '../ui';

export function AiAssumptionsPanel({ assumptions }: { assumptions?: string[] }) {
  if (!assumptions?.length) return null;
  return (
    <Card padding="sm">
      <div className="text-sm font-semibold text-gray-900">Assumptions</div>
      <ul className="mt-2 space-y-1 text-sm text-gray-600">
        {assumptions.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
