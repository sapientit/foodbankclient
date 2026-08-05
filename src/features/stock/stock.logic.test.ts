import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/errors';
import type { StockItem, StockLevel, StockTake } from './queries';
import {
  MOVEMENT_TYPE_LABELS,
  MOVEMENT_TYPE_OPTIONS,
  classifyPurchaseFailure,
  countableLevels,
  describeVariances,
  findStockItemByName,
  formatSignedQuantity,
  isMovementType,
  normaliseStockItemName,
  openStockTakes,
  parseQuantityDelta,
  parseWholeQuantity,
  splitByStatus,
} from './stock.logic';

const BEANS: StockItem = { id: 's1', name: 'Baked beans', shelfNumber: 'A1', isActive: true };
const RICE: StockItem = { id: 's2', name: 'Rice', shelfNumber: 'A10', isActive: false };
const ITEMS: readonly StockItem[] = [BEANS, RICE];

describe('normaliseStockItemName', () => {
  it('folds case and padding the way the server does', () => {
    expect(normaliseStockItemName('  Baked Beans  ')).toBe('baked beans');
  });
});

describe('findStockItemByName', () => {
  it('treats a name as taken whatever its capitalisation or padding', () => {
    expect(findStockItemByName(ITEMS, '  baked BEANS ')).toEqual(BEANS);
  });

  it('counts a retired item as still holding its name', () => {
    // Verified against a running server: renaming onto a retired item's name is
    // refused, and refused with a 500 rather than a 409.
    expect(findStockItemByName(ITEMS, 'Rice')).toEqual(RICE);
  });

  it('does not refuse an item the name it already has', () => {
    expect(findStockItemByName(ITEMS, 'Baked beans', BEANS.id)).toBeUndefined();
    expect(findStockItemByName(ITEMS, 'BAKED BEANS', BEANS.id)).toBeUndefined();
  });

  it('still refuses another item’s name while amending', () => {
    expect(findStockItemByName(ITEMS, 'Rice', BEANS.id)).toEqual(RICE);
  });

  it('says nothing about an empty box', () => {
    expect(findStockItemByName(ITEMS, '   ')).toBeUndefined();
  });
});

describe('splitByStatus', () => {
  it('splits active from retired without reordering either', () => {
    const { active, retired } = splitByStatus(ITEMS);

    expect(active).toEqual([BEANS]);
    expect(retired).toEqual([RICE]);
  });
});

describe('movement types', () => {
  it('offers exactly the six the server accepts', () => {
    expect(MOVEMENT_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      'opening_balance',
      'purchase',
      'donation',
      'parcel_issued',
      'wastage',
      'correction',
    ]);
  });

  it('never offers expiry — anything thrown away is wastage', () => {
    expect(Object.hasOwn(MOVEMENT_TYPE_LABELS, 'expiry')).toBe(false);
    expect(isMovementType('expiry')).toBe(false);
  });

  it('gives every option a label and a hint', () => {
    for (const option of MOVEMENT_TYPE_OPTIONS) {
      expect(option.label).not.toBe('');
      expect(option.hint).not.toBe('');
    }
  });
});

describe('parseQuantityDelta', () => {
  it('reads a signed whole number', () => {
    expect(parseQuantityDelta('6')).toEqual({ ok: true, value: 6 });
    expect(parseQuantityDelta(' -6 ')).toEqual({ ok: true, value: -6 });
    expect(parseQuantityDelta('+6')).toEqual({ ok: true, value: 6 });
  });

  it('refuses zero, because the server does', () => {
    expect(parseQuantityDelta('0')).toEqual({ ok: false, problem: 'zero' });
    expect(parseQuantityDelta('-0')).toEqual({ ok: false, problem: 'zero' });
  });

  it('refuses a fraction rather than rounding it', () => {
    expect(parseQuantityDelta('6.5')).toEqual({ ok: false, problem: 'not-a-whole-number' });
  });

  it('tells an empty box apart from a lone minus sign', () => {
    expect(parseQuantityDelta('')).toEqual({ ok: false, problem: 'empty' });
    expect(parseQuantityDelta('-')).toEqual({ ok: false, problem: 'not-a-whole-number' });
  });

  it('refuses a number too large to be counted exactly', () => {
    expect(parseQuantityDelta('99999999999999999999')).toEqual({
      ok: false,
      problem: 'too-large',
    });
  });
});

describe('formatSignedQuantity', () => {
  it('keeps the sign, because it is the whole meaning', () => {
    expect(formatSignedQuantity(6)).toBe('+6');
    expect(formatSignedQuantity(-6)).toBe('-6');
  });
});

describe('parseWholeQuantity', () => {
  it('accepts zero for a count and refuses it for a purchase line', () => {
    // The floor is the whole difference between the two callers: "the shelf is
    // empty" is a count worth recording, "we bought none" is not a line.
    expect(parseWholeQuantity('0', 0)).toEqual({ ok: true, value: 0 });
    expect(parseWholeQuantity('0', 1)).toEqual({ ok: false, problem: 'below-minimum' });
  });

  it('calls a negative below the minimum rather than not a number', () => {
    expect(parseWholeQuantity('-3', 0)).toEqual({ ok: false, problem: 'below-minimum' });
  });

  it('refuses a fraction rather than rounding it', () => {
    expect(parseWholeQuantity('6.5', 1)).toEqual({ ok: false, problem: 'not-a-whole-number' });
  });

  it('tells an empty box apart from a lone minus sign', () => {
    expect(parseWholeQuantity('   ', 0)).toEqual({ ok: false, problem: 'empty' });
    expect(parseWholeQuantity('-', 0)).toEqual({ ok: false, problem: 'not-a-whole-number' });
  });

  it('refuses a number too large to be counted exactly', () => {
    expect(parseWholeQuantity('99999999999999999999', 0)).toEqual({
      ok: false,
      problem: 'too-large',
    });
  });
});

describe('openStockTakes', () => {
  it('keeps only the takes that are still open', () => {
    const takes: StockTake[] = [
      {
        id: 't1',
        countedAt: '2026-07-01T09:00:00Z',
        status: 'open',
        note: null,
        committedAt: null,
      },
      {
        id: 't2',
        countedAt: '2026-06-01T09:00:00Z',
        status: 'committed',
        note: null,
        committedAt: '2026-06-01T10:00:00Z',
      },
      {
        id: 't3',
        countedAt: '2026-05-01T09:00:00Z',
        status: 'abandoned',
        note: null,
        committedAt: null,
      },
    ];

    expect(openStockTakes(takes).map((take) => take.id)).toEqual(['t1']);
  });
});

describe('countableLevels', () => {
  const level = (id: string, isActive: boolean, quantityOnHand: number): StockLevel => ({
    id,
    name: id,
    shelfNumber: 'A1',
    isActive,
    quantityOnHand,
  });

  it('counts a retired item that still holds a balance', () => {
    // Invisible on the levels screen, still on the ledger. A stock take is the
    // only thing that would ever find it.
    const rows = countableLevels([level('a', true, 0), level('b', false, 12)]);

    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('leaves off a retired item that is already at zero', () => {
    expect(countableLevels([level('a', false, 0)])).toEqual([]);
  });

  it('keeps the server’s shelf order', () => {
    const rows = countableLevels([level('a', true, 1), level('b', true, 1), level('c', true, 1)]);

    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('describeVariances', () => {
  const levels: StockLevel[] = [
    { id: 's1', name: 'Baked beans', shelfNumber: 'A1', isActive: true, quantityOnHand: 12 },
  ];

  it('names the item from the levels list', () => {
    expect(
      describeVariances([{ stockItemId: 's1', expected: 12, counted: 9, delta: -3 }], levels),
    ).toEqual([{ key: 's1-0', name: 'Baked beans', expected: 12, counted: 9, delta: -3 }]);
  });

  it('renders a missing number as absent rather than asserting it', () => {
    // Every field on an adjustment is optional in the contract. A `!` here is
    // the client claiming something the server never promised.
    expect(describeVariances([{}], levels)).toEqual([
      {
        key: 'unknown-0',
        name: 'An item that is no longer listed',
        expected: null,
        counted: null,
        delta: null,
      },
    ]);
  });

  it('falls back to the id when the item is not in the levels list', () => {
    const [row] = describeVariances([{ stockItemId: 'gone', delta: 1 }], levels);

    expect(row?.name).toBe('gone');
  });
});

describe('classifyPurchaseFailure', () => {
  const apiError = (status: number) =>
    new ApiError({ status, code: 'CONFLICT', message: 'no', requestId: null, details: null });

  it('treats a request that never got an answer as ambiguous, never as failed', () => {
    // The shop may well have been recorded. Calling this a failure is how a
    // second one gets posted.
    expect(classifyPurchaseFailure(new TypeError('Failed to fetch'))).toBe('ambiguous');
  });

  it('treats a 500 as ambiguous too', () => {
    expect(classifyPurchaseFailure(apiError(500))).toBe('ambiguous');
  });

  it('knows a 404 means nothing at all was written', () => {
    expect(classifyPurchaseFailure(apiError(404))).toBe('unknown-item');
  });

  it('treats any other 4xx as refused before anything was written', () => {
    expect(classifyPurchaseFailure(apiError(400))).toBe('refused');
    expect(classifyPurchaseFailure(apiError(409))).toBe('refused');
  });
});
