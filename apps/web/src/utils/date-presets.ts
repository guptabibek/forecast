/**
 * Date-range and comparison-range preset helpers for analytics reports.
 *
 * All values are ISO date strings (YYYY-MM-DD) in local time so they bind
 * cleanly to <input type="date"> and to backend ::date casts. Compare ranges
 * always span the same length as the current range, anchored either to the
 * immediately-prior period or to the same fiscal slice in the previous year.
 *
 * fiscalYearStart: 1-indexed month when the fiscal year begins (1=Jan, 4=Apr).
 * India standard is April (4). All FY-dependent presets (qtd, ytd, last-year,
 * this-year-vs-last-year, qtd-vs-last-qtd, ytd-vs-last-ytd) respect this.
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

/**
 * Returns the first day of the fiscal year that contains `d`.
 * fiscalYearStart is 1-indexed (4 = April for India).
 * JS Date handles month overflow, so new Date(y, 12, 1) == Jan 1, y+1.
 */
export function startOfFiscalYear(d: Date, fiscalYearStart: number): Date {
  const m0 = fiscalYearStart - 1; // 0-indexed
  const fyYear = d.getMonth() >= m0 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(fyYear, m0, 1);
}

/** Returns the last day of the fiscal year that contains `d`. */
export function endOfFiscalYear(d: Date, fiscalYearStart: number): Date {
  const fyStart = startOfFiscalYear(d, fiscalYearStart);
  // 12 months after FY start, day 0 = last day of prev month
  return new Date(fyStart.getFullYear(), fyStart.getMonth() + 12, 0);
}

/**
 * Returns the first day of the fiscal quarter containing `d`.
 * Fiscal quarters are 3-month windows starting from fiscalYearStart.
 * For April start: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar.
 */
export function startOfFiscalQuarter(d: Date, fiscalYearStart: number): Date {
  const fyStart = startOfFiscalYear(d, fiscalYearStart);
  const monthsIntoFY = ((d.getMonth() - fyStart.getMonth()) + 12) % 12;
  const qIndex = Math.floor(monthsIntoFY / 3); // 0-3
  // fyStart.getMonth() + qIndex*3 may exceed 11; Date handles the overflow.
  return new Date(fyStart.getFullYear(), fyStart.getMonth() + qIndex * 3, 1);
}

/** First day of the fiscal quarter immediately before the one containing `d`. */
function prevFiscalQuarterStart(d: Date, fiscalYearStart: number): Date {
  const qStart = startOfFiscalQuarter(d, fiscalYearStart);
  return new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1);
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
  { id: 'ytd', label: 'FY to date' },
  { id: 'last-year', label: 'Last fiscal year' },
  { id: 'custom', label: 'Custom' },
] as const;

export type SingleRangePresetId = (typeof SINGLE_RANGE_PRESETS)[number]['id'];

/**
 * @param fiscalYearStart 1-indexed month when the FY begins (default 4 = April, India).
 */
export function resolveSingleRange(
  preset: SingleRangePresetId,
  today = new Date(),
  fiscalYearStart = 4,
): DateRange | null {
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
      const qStart = startOfFiscalQuarter(t, fiscalYearStart);
      return { startDate: iso(qStart), endDate: iso(t) };
    }
    case 'ytd': {
      const fyStart = startOfFiscalYear(t, fiscalYearStart);
      return { startDate: iso(fyStart), endDate: iso(t) };
    }
    case 'last-year': {
      // Complete previous fiscal year
      const fyStart = startOfFiscalYear(t, fiscalYearStart);
      const prevFYStart = new Date(fyStart.getFullYear(), fyStart.getMonth() - 12, 1);
      const prevFYEnd = new Date(fyStart.getFullYear(), fyStart.getMonth(), 0);
      return { startDate: iso(prevFYStart), endDate: iso(prevFYEnd) };
    }
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
  { id: 'ytd-vs-last-ytd', label: 'FY to date vs same period last FY' },
  { id: 'this-year-vs-last-year', label: 'This FY vs last FY' },
  { id: 'last-month-vs-prior', label: 'Last month vs month before' },
  { id: 'custom', label: 'Custom' },
] as const;

export type ComparisonPresetId = (typeof COMPARISON_PRESETS_DEFINITION)[number]['id'];

/**
 * @param fiscalYearStart 1-indexed month when the FY begins (default 4 = April, India).
 */
export function resolveComparisonRange(
  preset: ComparisonPresetId,
  today = new Date(),
  fiscalYearStart = 4,
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
      const qStart = startOfFiscalQuarter(t, fiscalYearStart);
      const offsetDays = lengthDays(qStart, t) - 1;
      const lastQStart = prevFiscalQuarterStart(t, fiscalYearStart);
      const lastQEnd = addDays(lastQStart, offsetDays);
      return {
        current: span(qStart, t),
        compare: span(lastQStart, lastQEnd),
      };
    }
    case 'ytd-vs-last-ytd': {
      const fyStart = startOfFiscalYear(t, fiscalYearStart);
      const offsetDays = lengthDays(fyStart, t) - 1;
      const lastFYStart = new Date(fyStart.getFullYear(), fyStart.getMonth() - 12, 1);
      const lastFYEnd = addDays(lastFYStart, offsetDays);
      return { current: span(fyStart, t), compare: span(lastFYStart, lastFYEnd) };
    }
    case 'this-year-vs-last-year': {
      const fyStart = startOfFiscalYear(t, fiscalYearStart);
      const fyEnd = endOfFiscalYear(t, fiscalYearStart);
      const lastFYStart = new Date(fyStart.getFullYear(), fyStart.getMonth() - 12, 1);
      const lastFYEnd = new Date(lastFYStart.getFullYear(), lastFYStart.getMonth() + 12, 0);
      return { current: span(fyStart, fyEnd), compare: span(lastFYStart, lastFYEnd) };
    }
    case 'custom':
    default:
      return null;
  }
}
