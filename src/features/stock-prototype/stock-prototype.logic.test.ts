import { describe, expect, it } from 'vitest';
import {
  applyPackingUnit,
  computeCrateReferenceCount,
  countingStatus,
  decomposeCrateCount,
  decomposeCrateShortfall,
  groupByCategory,
  isCrateMember,
  packUnitLabelFor,
  shelvesWithMultipleItems,
  validateStock,
} from './stock-prototype.logic';
import type { Crate, ProtoStockItem, StockPrototypeState } from './types';

function item(overrides: Partial<ProtoStockItem> & { id: string }): ProtoStockItem {
  return {
    name: overrides.id,
    category: 'Test',
    shelfNumber: 'X1',
    quantityOnHand: 0,
    unitsPerPack: null,
    packUnitLabel: null,
    groupingId: null,
    ...overrides,
  };
}

const CRATE: Crate = {
  id: 'crate-1',
  name: 'Test crate',
  shelfKey: 'F9',
  groupingId: 'grp-1',
  sizePerCrate: 50,
  members: [
    { stockItemId: 'a', stockCompositionPercent: 60, shoppingCompositionPercent: 25 },
    { stockItemId: 'b', stockCompositionPercent: 40, shoppingCompositionPercent: 75 },
  ],
};

describe('isCrateMember', () => {
  it('is true for a declared member of any crate', () => {
    expect(isCrateMember(item({ id: 'a' }), [CRATE])).toBe(true);
  });

  it('is false for an item no crate declares', () => {
    expect(isCrateMember(item({ id: 'z' }), [CRATE])).toBe(false);
  });
});

describe('countingStatus', () => {
  it('is direct when the item has a grouping and is not a crate member', () => {
    const stockItem = item({ id: 'a', groupingId: 'grp-1' });
    expect(countingStatus(stockItem, [])).toBe('direct');
  });

  it('is crate when the item is a declared crate member with no direct grouping', () => {
    const stockItem = item({ id: 'a', groupingId: null });
    expect(countingStatus(stockItem, [CRATE])).toBe('crate');
  });

  it('is uncounted when neither applies', () => {
    const stockItem = item({ id: 'z', groupingId: null });
    expect(countingStatus(stockItem, [CRATE])).toBe('uncounted');
  });

  it('is double-counted when both apply', () => {
    const stockItem = item({ id: 'a', groupingId: 'grp-1' });
    expect(countingStatus(stockItem, [CRATE])).toBe('double-counted');
  });
});

describe('shelvesWithMultipleItems', () => {
  it('only returns shelves with more than one item', () => {
    const items = [
      item({ id: 'a', shelfNumber: 'F9' }),
      item({ id: 'b', shelfNumber: 'F9' }),
      item({ id: 'c', shelfNumber: 'D1' }),
    ];
    const result = shelvesWithMultipleItems(items);
    expect([...result.keys()]).toEqual(['F9']);
    expect(result.get('F9')).toHaveLength(2);
  });
});

describe('computeCrateReferenceCount', () => {
  it('sums member stock and divides by crate size', () => {
    const items = [item({ id: 'a', quantityOnHand: 60 }), item({ id: 'b', quantityOnHand: 40 })];
    expect(computeCrateReferenceCount(CRATE, items)).toBe(2); // (60 + 40) / 50
  });

  it('is zero for a zero-size crate rather than dividing by zero', () => {
    const zeroSize: Crate = { ...CRATE, sizePerCrate: 0 };
    expect(computeCrateReferenceCount(zeroSize, [])).toBe(0);
  });
});

describe('decomposeCrateCount', () => {
  it('splits a fractional count by stock-composition percentages', () => {
    // 3.5 crates * 50/crate = 175 units; 60/40 split -> 105 / 70
    const result = decomposeCrateCount(CRATE, 3.5);
    expect(result).toEqual(
      expect.arrayContaining([
        { stockItemId: 'a', quantityOnHand: 105 },
        { stockItemId: 'b', quantityOnHand: 70 },
      ]),
    );
  });

  it('divides by the percentage sum rather than assuming it is 100', () => {
    const midEdit: Crate = {
      ...CRATE,
      members: [
        { stockItemId: 'a', stockCompositionPercent: 30, shoppingCompositionPercent: 0 },
        { stockItemId: 'b', stockCompositionPercent: 30, shoppingCompositionPercent: 0 },
      ],
    };
    // Percentages sum to 60, not 100 — an even split should still come out even.
    const result = decomposeCrateCount(midEdit, 2); // 100 units total
    expect(result).toEqual(
      expect.arrayContaining([
        { stockItemId: 'a', quantityOnHand: 50 },
        { stockItemId: 'b', quantityOnHand: 50 },
      ]),
    );
  });

  it('gives every member zero when percentages are all zero, rather than dividing by zero', () => {
    const allZero: Crate = {
      ...CRATE,
      members: [
        { stockItemId: 'a', stockCompositionPercent: 0, shoppingCompositionPercent: 0 },
        { stockItemId: 'b', stockCompositionPercent: 0, shoppingCompositionPercent: 0 },
      ],
    };
    expect(decomposeCrateCount(allZero, 3)).toEqual(
      expect.arrayContaining([
        { stockItemId: 'a', quantityOnHand: 0 },
        { stockItemId: 'b', quantityOnHand: 0 },
      ]),
    );
  });
});

describe('decomposeCrateShortfall', () => {
  it('is zero for every member when current stock already meets the target', () => {
    const items = [item({ id: 'a', quantityOnHand: 60 }), item({ id: 'b', quantityOnHand: 40 })];
    // current = (60+40)/50 = 2 crates; target 2 -> no shortfall
    const result = decomposeCrateShortfall(CRATE, 2, items);
    expect(result).toEqual(
      expect.arrayContaining([
        { stockItemId: 'a', quantity: 0 },
        { stockItemId: 'b', quantity: 0 },
      ]),
    );
  });

  it('splits a real shortfall by shopping-composition percentages', () => {
    const items = [item({ id: 'a', quantityOnHand: 0 }), item({ id: 'b', quantityOnHand: 0 })];
    // current = 0; target 2 crates * 50 = 100 units short; 25/75 split -> 25 / 75
    const result = decomposeCrateShortfall(CRATE, 2, items);
    expect(result).toEqual(
      expect.arrayContaining([
        { stockItemId: 'a', quantity: 25 },
        { stockItemId: 'b', quantity: 75 },
      ]),
    );
  });
});

describe('applyPackingUnit', () => {
  it('multiplies a pack count by units per pack', () => {
    expect(applyPackingUnit(4, 24)).toBe(96);
  });

  it('rounds a fractional pack count to a whole unit total', () => {
    expect(applyPackingUnit(2.5, 24)).toBe(60);
  });
});

describe('packUnitLabelFor', () => {
  it('uses the item’s own counting-unit name when it has one', () => {
    expect(packUnitLabelFor(item({ id: 'a', packUnitLabel: 'cases' }))).toBe('cases');
  });

  it('falls back to "packs" when unset', () => {
    expect(packUnitLabelFor(item({ id: 'a', packUnitLabel: null }))).toBe('packs');
  });

  it('falls back to "packs" when set to blank', () => {
    expect(packUnitLabelFor(item({ id: 'a', packUnitLabel: '   ' }))).toBe('packs');
  });
});

describe('groupByCategory', () => {
  it('groups and sorts by category then by name', () => {
    const rows = [
      { name: 'Zebra soup', category: 'Tinned' },
      { name: 'Apple juice', category: 'Drinks' },
      { name: 'Baked beans', category: 'Tinned' },
    ];
    expect(groupByCategory(rows)).toEqual([
      { category: 'Drinks', rows: [{ name: 'Apple juice', category: 'Drinks' }] },
      {
        category: 'Tinned',
        rows: [
          { name: 'Baked beans', category: 'Tinned' },
          { name: 'Zebra soup', category: 'Tinned' },
        ],
      },
    ]);
  });
});

describe('validateStock', () => {
  const baseState: StockPrototypeState = {
    groupings: [{ id: 'grp-1', name: 'Non-perishables' }],
    items: [],
    crates: [],
    itemTargets: [],
    crateTargets: [],
  };

  it('flags a shelf with more than one item and no crate', () => {
    const state: StockPrototypeState = {
      ...baseState,
      items: [
        item({ id: 'a', shelfNumber: 'F9', groupingId: 'grp-1' }),
        item({ id: 'b', shelfNumber: 'F9', groupingId: 'grp-1' }),
      ],
    };
    expect(validateStock(state).map((i) => i.kind)).toContain('shelf-without-crate');
  });

  it('flags a crate with one or fewer members', () => {
    const state: StockPrototypeState = {
      ...baseState,
      items: [item({ id: 'a', shelfNumber: 'F9' })],
      crates: [
        {
          ...CRATE,
          shelfKey: 'F9',
          members: [
            { stockItemId: 'a', stockCompositionPercent: 100, shoppingCompositionPercent: 100 },
          ],
        },
      ],
    };
    expect(validateStock(state).map((i) => i.kind)).toContain('crate-too-few-members');
  });

  it('flags a member whose shelf no longer matches the crate key', () => {
    const state: StockPrototypeState = {
      ...baseState,
      items: [item({ id: 'a', shelfNumber: 'D2' }), item({ id: 'b', shelfNumber: 'F9' })],
      crates: [CRATE],
    };
    expect(validateStock(state).map((i) => i.kind)).toContain('member-shelf-mismatch');
  });

  it('flags an item counted by neither mechanism', () => {
    const state: StockPrototypeState = {
      ...baseState,
      items: [item({ id: 'a', groupingId: null })],
    };
    expect(validateStock(state).map((i) => i.kind)).toContain('item-uncounted');
  });

  it('flags an item counted by both mechanisms', () => {
    const state: StockPrototypeState = {
      ...baseState,
      items: [
        item({ id: 'a', shelfNumber: 'F9', groupingId: 'grp-1' }),
        item({ id: 'b', shelfNumber: 'F9', groupingId: 'grp-1' }),
      ],
      crates: [
        {
          ...CRATE,
          shelfKey: 'F9',
          members: [
            { stockItemId: 'a', stockCompositionPercent: 50, shoppingCompositionPercent: 50 },
            { stockItemId: 'b', stockCompositionPercent: 50, shoppingCompositionPercent: 50 },
          ],
        },
      ],
    };
    expect(validateStock(state).map((i) => i.kind)).toContain('item-double-counted');
  });

  it('is empty for a fully consistent state', () => {
    const state: StockPrototypeState = {
      ...baseState,
      items: [item({ id: 'a', shelfNumber: 'D1', groupingId: 'grp-1' })],
    };
    expect(validateStock(state)).toEqual([]);
  });
});
