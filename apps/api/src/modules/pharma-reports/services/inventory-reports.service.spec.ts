import { normalizeMovementLedgerFilters } from './inventory-reports.service';

describe('normalizeMovementLedgerFilters', () => {
  it('maps display movement labels to ledger enum values', () => {
    const filters = normalizeMovementLedgerFilters([
      { field: 'entry_type', operator: 'equals', value: 'Purchase Invoice' },
      { field: 'entry_type', operator: 'equals', value: 'Sales' },
      { field: 'entry_type', operator: 'equals', value: 'Stock Adjustment' },
    ]);

    expect(filters).toEqual([
      { field: 'entry_type', operator: 'equals', value: 'LEDGER_RECEIPT' },
      { field: 'entry_type', operator: 'equals', value: 'LEDGER_ISSUE' },
      { field: 'entry_type', operator: 'equals', value: 'LEDGER_ADJUSTMENT' },
    ]);
  });

  it('maps generic transfer filters to both transfer directions', () => {
    const [filter] = normalizeMovementLedgerFilters([
      { field: 'entry_type', operator: 'equals', value: 'Stock Transfer' },
    ]);

    expect(filter).toEqual({
      field: 'entry_type',
      operator: 'in',
      value: ['LEDGER_TRANSFER_IN', 'LEDGER_TRANSFER_OUT'],
    });
  });
});
