import { describe, expect, it } from 'vitest';
import type { StockItem, StockLevel } from './queries';
import {
  countableLevels,
  findStockItemByName,
  normaliseStockItemName,
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
