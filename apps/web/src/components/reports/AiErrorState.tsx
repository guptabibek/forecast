import { AxiosError } from 'axios';
import { Alert, Button } from '../ui';

function messageForError(error: unknown): string {
  const axiosError = error as AxiosError<{ message?: string; code?: string }>;
  const status = axiosError.response?.status;
  const code = axiosError.response?.data?.code;
  const message = axiosError.response?.data?.message;
  if (status === 403) return 'You do not have permission to run this AI report.';
  if (status === 408 || code === 'DATABASE_TIMEOUT') return 'The report took too long to run. Try a narrower date range or fewer rows.';
  if (code === 'AI_REPORTING_DISABLED') return 'AI reporting is currently disabled for this environment or tenant.';
  if (code === 'AI_SERVICE_UNAVAILABLE' || code === 'AI_REPORTING_UNAVAILABLE') return 'The AI reporting service is currently unavailable.';
  if (code === 'RATE_LIMIT_EXCEEDED' || status === 429) return message || 'AI reporting usage is temporarily limited. Please wait and try again.';
  if (code === 'PROMPT_INJECTION_REJECTED') return message || 'This request asks for unsafe access or internal details and cannot be processed.';
  if (code === 'QUERY_TOO_BROAD') return message || 'The question is too broad. Add a date range, company, branch, item, customer, or supplier filter.';
  if (status && status >= 500) return 'The server could not complete this report request.';
  return message || 'The report request could not be completed.';
}

export function AiErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="error" title="AI report failed">
      <div className="space-y-3">
        <p>{messageForError(error)}</p>
        {onRetry && <Button type="button" size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
      </div>
    </Alert>
  );
}
