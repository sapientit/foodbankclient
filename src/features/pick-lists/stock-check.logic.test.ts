import { describe, expect, it } from 'vitest';
import { describeStockCheck, isShort, summariseStockCheck } from './stock-check.logic';
import type { StockRequirementLine } from './queries';

function line(overrides: Partial<StockRequirementLine>): StockRequirementLine {
  return {
    id: 'stock-1',
    name: 'Baked beans',
    category: 'Tinned Goods',
    description: null,
    shelfNumber: 'A2',
    isActive: true,
    quantityOnHand: 10,
    requiredQuantity: 4,
    shortfall: 0,
    ...overrides,
  };
}

describe('isShort', () => {
  it('reads the server’s shortfall and nothing else', () => {
    expect(isShort(line({ shortfall: 0 }))).toBe(false);
    expect(isShort(line({ shortfall: 1 }))).toBe(true);
  });

  it('does not second-guess the shortfall against the two figures beside it', () => {
    // The server floors the subtraction at zero and this client does not repeat
    // it. A line whose numbers look short but whose shortfall is nought is the
    // server's answer, not a rounding error to correct on screen — and a
    // negative `quantityOnHand` is exactly where a re-derivation goes wrong.
    expect(isShort(line({ requiredQuantity: 12, quantityOnHand: -3, shortfall: 15 }))).toBe(true);
  });
});

describe('summariseStockCheck', () => {
  it('counts the items asked for and the ones that cannot be covered', () => {
    const summary = summariseStockCheck([
      line({ id: 'a', shortfall: 0 }),
      line({ id: 'b', shortfall: 6 }),
      line({ id: 'c', shortfall: 1 }),
    ]);

    expect(summary).toEqual({ itemCount: 3, shortCount: 2 });
  });

  it('is empty for a session asking for nothing', () => {
    expect(summariseStockCheck([])).toEqual({ itemCount: 0, shortCount: 0 });
  });
});

describe('describeStockCheck', () => {
  it('leads with how many items are short', () => {
    expect(describeStockCheck({ itemCount: 12, shortCount: 3 })).toBe(
      '3 of the 12 stock items this session asks for cannot be covered.',
    );
  });

  it('says so plainly when the warehouse covers the session', () => {
    expect(describeStockCheck({ itemCount: 12, shortCount: 0 })).toBe(
      'Every one of the 12 stock items this session asks for is covered.',
    );
  });

  it('reads as English for a single item', () => {
    expect(describeStockCheck({ itemCount: 1, shortCount: 0 })).toBe(
      'The one stock item this session asks for is covered.',
    );
    expect(describeStockCheck({ itemCount: 1, shortCount: 1 })).toBe(
      'The one stock item this session asks for cannot be covered.',
    );
  });

  it('has something to say about a session that asks for nothing at all', () => {
    expect(describeStockCheck({ itemCount: 0, shortCount: 0 })).toBe(
      'This session asks for no stock items.',
    );
  });
});
