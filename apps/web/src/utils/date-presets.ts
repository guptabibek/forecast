/**
 * Date-range and comparison-range preset helpers for analytics reports.
 *
 * All values are ISO date strings (YYYY-MM-DD) in local time so they bind
 * cleanly to <input type="date"> and to backend ::date casts. Compare ranges
 * always span the same length as the current range, anchored either to the
 * immediately-prior period or to the same calendar slice in the previous year.
 */

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface ComparisonPreset {
  id: string;
  label: string;
  current: DateRange;
  compare: DateRange;
}

/** Single-range presets for "filter the report to this window" UX. */
export const SINGLE_RANGE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'mtd', label: 'Month to date' },
  { id: 'last-month', label: 'Last month' },
  { id: 'qtd', label: 'Quarter to date' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last-year', label: 'Last year' },
  { id: 'custom', label: 'Custom' },
] as const;

export type SingleRangePresetId = (typeof SINGLE_RANGE_PRESETS)[number]['id'];

export function resolveSingleRange(preset: SingleRangePresetId, today = new Date()): DateRange | null {
  const t = startOfDay(today);
  switch (preset) {
    case 'today':
      return { startDate: iso(t), endDate: iso(t) };
    case 'yesterday': {
      const y = addDays(t, -1);
      return { startDate: iso(y), endDate: iso(y) };
    }
    case 'last7':
      return { startDate: iso(addDays(t, -6)), endDate: iso(t) };
    case 'last30':
      return { startDate: iso(addDays(t, -29)), endDate: iso(t) };
    case 'mtd':
      return { startDate: iso(startOfMonth(t)), endDate: iso(t) };
    case 'last-month': {
      const prev = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      return { startDate: iso(startOfMonth(prev)), endDate: iso(endOfMonth(prev)) };
    }
    case 'qtd': {
      const qStartMonth = Math.floor(t.getMonth() / 3) * 3;
      return {
        startDate: iso(new Date(t.getFullYear(), qStartMonth, 1)),
        endDate: iso(t),
      };
    }
    case 'ytd':
      return { startDate: iso(startOfYear(t)), endDate: iso(t) };
    case 'last-year':
      return {
        startDate: iso(new Date(t.getFullYear() - 1, 0, 1)),
        endDate: iso(new Date(t.getFullYear() - 1, 11, 31)),
      };
    case 'custom':
    default:
      return null;
  }
}

/**
 * Comparison presets — each yields BOTH a current range and the matching prior
 * window. "Calendar" comparisons (this month vs last month) align by month
 * boundaries; "rolling" comparisons (last 30d vs prior 30d) align by length.
 */
export const COMPARISON_PRESETS_DEFINITION = [
  { id: 'last7-vs-prior7', label: 'Last 7d vs prior 7d' },
  { id: 'last30-vs-prior30', label: 'Last 30d vs prior 30d' },
  { id: 'mtd-vs-last-mtd', label: 'MTD vs same period last month' },
  { id: 'this-month-vs-last-month', label: 'This month vs last month' },
  { id: 'qtd-vs-last-qtd', label: 'QTD vs same period last quarter' },
  { id: 'ytd-vs-last-ytd', label: 'YTD vs same period last year' },
  { id: 'this-year-vs-last-year', label: 'This year vs last year' },
  { id: 'last-month-vs-prior', label: 'Last month vs month before' },
  { id: 'custom', label: 'Custom' },
] as const;

export type ComparisonPresetId = (typeof COMPARISON_PRESETS_DEFINITION)[number]['id'];

export function resolveComparisonRange(
  preset: ComparisonPresetId,
  today = new Date(),
): { current: DateRange; compare: DateRange } | null {
  const t = startOfDay(today);

  const span = (start: Date, end: Date): DateRange => ({ startDate: iso(start), endDate: iso(end) });
  const lengthDays = (start: Date, end: Date) =>
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  switch (preset) {
    case 'last7-vs-prior7': {
      const currStart = addDays(t, -6);
      const compareEnd = addDays(currStart, -1);
      const compareStart = addDays(compareEnd, -6);
      return { current: span(currStart, t), compare: span(compareStart, compareEnd) };
    }
    case 'last30-vs-prior30': {
      const currStart = addDays(t, -29);
      const compareEnd = addDays(currStart, -1);
      const compareStart = addDays(compareEnd, -29);
      return { current: span(currStart, t), compare: span(compareStart, compareEnd) };
    }
    case 'mtd-vs-last-mtd': {
      const currStart = startOfMonth(t);
      const dayOfMonth = t.getDate();
      const lastMonthStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const lastMonthEnd = new Date(t.getFullYear(), t.getMonth() - 1, dayOfMonth);
      const cap = endOfMonth(lastMonthStart);
      const safeEnd = lastMonthEnd > cap ? cap : lastMonthEnd;
      return {
        current: span(currStart, t),
        compare: span(lastMonthStart, safeEnd),
      };
    }
    case 'this-month-vs-last-month': {
      const currStart = startOfMonth(t);
      const currEnd = endOfMonth(t);
      const lastMonthRef = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      return {
        current: span(currStart, currEnd),
        compare: span(startOfMonth(lastMonthRef), endOfMonth(lastMonthRef)),
      };
    }
    case 'last-month-vs-prior': {
      const lastMonthRef = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const priorRef = new Date(t.getFullYear(), t.getMonth() - 2, 1);
      return {
        current: span(startOfMonth(lastMonthRef), endOfMonth(lastMonthRef)),
        compare: span(startOfMonth(priorRef), endOfMonth(priorRef)),
      };
    }
    case 'qtd-vs-last-qtd': {
      const qStartMonth = Math.floor(t.getMonth() / 3) * 3;
      const currStart = new Date(t.getFullYear(), qStartMonth, 1);
      const offsetDays = lengthDays(currStart, t) - 1;
      const lastQStart = new Date(t.getFullYear(), qStartMonth - 3, 1);
      const lastQEnd = addDays(lastQStart, offsetDays);
      return {
        current: span(currStart, t),
        compare: span(lastQStart, lastQEnd),
      };
    }
    case 'ytd-vs-last-ytd': {
      const currStart = startOfYear(t);
      const lastStart = new Date(t.getFullYear() - 1, 0, 1);
      const lastEnd = new Date(t.getFullYear() - 1, t.getMonth(), t.getDate());
      return { current: span(currStart, t), compare: span(lastStart, lastEnd) };
    }
    case 'this-year-vs-last-year': {
      const currStart = startOfYear(t);
      const currEnd = new Date(t.getFullYear(), 11, 31);
      const lastStart = new Date(t.getFullYear() - 1, 0, 1);
      const lastEnd = new Date(t.getFullYear() - 1, 11, 31);
      return { current: span(currStart, currEnd), compare: span(lastStart, lastEnd) };
    }
    case 'custom':
    default:
      return null;
  }
}
