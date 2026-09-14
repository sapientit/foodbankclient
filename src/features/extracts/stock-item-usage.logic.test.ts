import { describe, expect, it } from 'vitest';
import {
  STOCK_ITEM_USAGE_FIXED_HEADERS,
  stockItemUsageColumns,
  stockItemUsageKey,
  stockItemUsageRow,
} from './stock-item-usage.logic';

const session = {
  sessionId: '00000000-0000-4000-8000-000000000099',
  sessionDate: '2026-09-13',
  sessionLocation: "St Mary's Hall",
  stockItemUsage: [
    { stockItemId: 'item-b', stockItemName: 'Baked beans', quantity: 12 },
    { stockItemId: 'item-a', stockItemName: 'Pasta', quantity: 4 },
  ],
} as const;

describe('stock-item usage sheet rows', () => {
  it('uses a stable item-id key in row one and item name as its initial heading', () => {
    expect(stockItemUsageColumns(session.stockItemUsage)).toEqual([
      { key: 'stockItem.item-a', heading: 'Pasta' },
      { key: 'stockItem.item-b', heading: 'Baked beans' },
    ]);
  });

  it('writes one session row with its reconciliation id and blank unused item cells', () => {
    const headers = [...STOCK_ITEM_USAGE_FIXED_HEADERS, 'stockItem.item-a', 'stockItem.item-c'];

    expect(stockItemUsageRow(session, headers)).toEqual([
      session.sessionId,
      '2026-09-13',
      "St Mary's Hall",
      4,
      '',
    ]);
  });

  it('writes a session with no issued stock as a row with blank usage columns', () => {
    const headers = [...STOCK_ITEM_USAGE_FIXED_HEADERS, stockItemUsageKey('item-a')];

    expect(stockItemUsageRow({ ...session, stockItemUsage: [] }, headers)).toEqual([
      session.sessionId,
      '2026-09-13',
      "St Mary's Hall",
      '',
    ]);
  });
});
