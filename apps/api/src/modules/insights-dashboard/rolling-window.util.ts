import { SemanticReportQuery } from '../ai-reporting/semantic-query.types';

const DAY_MS = 86_400_000;

/**
 * Keeps relative questions relative after pinning. The NLQ pipeline
 * compiles phrases like "last 30 days" / "next 90 days" into CONCRETE
 * custom dates, so a pinned widget would silently freeze at its pin-date
 * window. If the stored custom range was anchored to the pin date (its
 * end — past windows — or its start — future windows — falls within a day
 * of when the widget was pinned), the whole window is shifted forward so
 * it stays anchored to today. Genuinely historical ranges (e.g. "sales for
 * Jan–Mar 2025") are not anchored to the pin date and stay fixed.
 * Preset ranges ("this_month" etc.) already re-resolve at compile time.
 */
export function applyRollingWindow(
  query: SemanticReportQuery,
  pinnedAt: Date,
  now: Date = new Date(),
): SemanticReportQuery {
  const range = query.timeRange;
  if (range?.preset !== 'custom' || !range.startDate || !range.endDate) return query;

  const start = Date.parse(`${range.startDate}T00:00:00Z`);
  const end = Date.parse(`${range.endDate}T00:00:00Z`);
  const pinnedDay = Date.parse(`${pinnedAt.toISOString().slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if ([start, end, pinnedDay, today].some(Number.isNaN)) return query;

  const shift = today - pinnedDay;
  if (shift <= 0) return query;
  const anchored = Math.abs(end - pinnedDay) <= DAY_MS || Math.abs(start - pinnedDay) <= DAY_MS;
  if (!anchored) return query;

  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    ...query,
    timeRange: { ...range, startDate: toIso(start + shift), endDate: toIso(end + shift) },
  };
}
