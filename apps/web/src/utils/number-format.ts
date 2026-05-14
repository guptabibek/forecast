const EMPTY_VALUE = '\u2014';
const INR_SYMBOL = '\u20B9';

function asFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function formatIndianNumber(
  value: number | string | null | undefined,
  decimals = 0,
): string {
  const numberValue = asFiniteNumber(value);
  if (numberValue === null) return EMPTY_VALUE;

  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(numberValue);
}

export function formatInr(
  value: number | string | null | undefined,
  decimals = 2,
): string {
  const numberValue = asFiniteNumber(value);
  if (numberValue === null) return EMPTY_VALUE;

  const sign = numberValue < 0 ? '-' : '';
  return `${sign}${INR_SYMBOL}${formatIndianNumber(Math.abs(numberValue), decimals)}`;
}

export function formatIndianCompactNumber(
  value: number | string | null | undefined,
  decimals = 1,
): string {
  const numberValue = asFiniteNumber(value);
  if (numberValue === null) return EMPTY_VALUE;

  const sign = numberValue < 0 ? '-' : '';
  const abs = Math.abs(numberValue);
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(decimals)} Cr`;
  if (abs >= 100_000) return `${sign}${(abs / 100_000).toFixed(decimals)} L`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(decimals)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function formatInrCompact(
  value: number | string | null | undefined,
  decimals = 1,
): string {
  const numberValue = asFiniteNumber(value);
  if (numberValue === null) return EMPTY_VALUE;

  const sign = numberValue < 0 ? '-' : '';
  const compact = formatIndianCompactNumber(Math.abs(numberValue), decimals);
  return `${sign}${INR_SYMBOL}${compact}`;
}
