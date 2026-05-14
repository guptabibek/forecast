import { Card, Skeleton } from '../ui';

export function AiLoadingState() {
  return (
    <Card>
      <div className="space-y-4">
        <Skeleton height={20} width="35%" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton height={80} />
          <Skeleton height={80} />
          <Skeleton height={80} />
        </div>
        <Skeleton height={260} />
      </div>
    </Card>
  );
}
