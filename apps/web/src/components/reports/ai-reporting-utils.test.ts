import { describe, expect, it } from 'vitest';
import { formatAiValue, formatPercent, isPercentKey } from './ai-reporting-utils';

describe('formatAiValue semantic metric typing', () => {
  it('renders percentage dataType as a percent, never currency', () => {
    // Regression: sales_contribution_pct contains "sales" so the currency
    // key-heuristic used to win and render ₹25.40.
    const column = { key: 'sales_contribution_pct', label: 'Sales Contribution Percentage', dataType: 'percentage' };
    expect(formatAiValue(25.4, column)).toBe('25.4%');
    expect(formatAiValue(91.2, column)).toBe('91.2%');
    expect(formatAiValue(18, column)).toBe('18%');
  });

  it('falls back to percent key heuristics when dataType is missing', () => {
    expect(formatAiValue(42.5, { key: 'margin_pct', label: 'Margin %' })).toBe('42.5%');
    expect(formatAiValue(67.1, { key: 'revenue_share', label: 'Share' })).toBe('67.1%');
    expect(formatAiValue(12.3, { key: 'growth_pct', label: 'Growth %' })).toBe('12.3%');
  });

  it('still renders currency dataType and currency keys as INR', () => {
    expect(formatAiValue(1500, { key: 'sales_net_amount', label: 'Net Sales', dataType: 'currency' })).toMatch(/₹/);
    expect(formatAiValue(1500, { key: 'net_amount', label: 'Net Amount' })).toMatch(/₹/);
  });

  it('renders quantity/number dataTypes as plain numerics even with currency-looking keys', () => {
    // dataType is authoritative: sales_net_quantity contains "sales" but is a count of units.
    expect(formatAiValue(3210, { key: 'sales_net_quantity', label: 'Quantity', dataType: 'number' })).toBe('3,210');
    expect(formatAiValue(3210, { key: 'sold_quantity', label: 'Quantity', dataType: 'quantity' })).toBe('3,210');
  });

  it('percent key detection is precise', () => {
    expect(isPercentKey('sales_contribution_pct')).toBe(true);
    expect(isPercentKey('discount_pct')).toBe(true);
    expect(isPercentKey('achievement_pct')).toBe(true);
    expect(isPercentKey('share')).toBe(true);
    expect(isPercentKey('net_amount')).toBe(false);
    expect(isPercentKey('sales_net_amount')).toBe(false);
  });

  it('formatPercent uses one decimal for fractions, none for integers', () => {
    expect(formatPercent(25.44)).toBe('25.4%');
    expect(formatPercent(100)).toBe('100%');
  });
});
