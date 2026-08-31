import { describe, expect, it } from 'vitest';
import {
  computeShoppingList,
  groupByCategory,
  shoppingListToPlainText,
  splitGroupedColumns,
  type CategoryGroup,
  type ShoppingItem,
  type ShoppingStockLevel,
} from './shopping-list.logic';
import type { StoredTargetLine } from './target-stock-lists.logic';

const level = (
  id: string,
  name: string,
  category: string,
  quantityOnHand: number,
  isActive = true,
): ShoppingStockLevel => ({ id, name, category, quantityOnHand, isActive });

const item = (name: string, category: string, need: number): ShoppingItem => ({
  name,
  category,
  targetQuantity: need,
  quantityOnHand: 0,
  need,
  renamedFrom: null,
});

describe('computeShoppingList', () => {
  it('buys only where target exceeds what is on hand', () => {
    const lines: StoredTargetLine[] = [
      { stockItemId: 's1', name: 'Baked beans', targetQuantity: 48 },
      { stockItemId: 's2', name: 'Chopped tomatoes', targetQuantity: 24 },
    ];
    const levels = [
      level('s1', 'Baked beans', 'Tinned', 40),
      level('s2', 'Chopped tomatoes', 'Tinned', 30),
    ];

    const { groups } = computeShoppingList(lines, levels);
    expect(groups).toEqual([
      { category: 'Tinned', items: [expect.objectContaining({ name: 'Baked beans', need: 8 })] },
    ]);
  });

  it('treats negative stock on hand as a bigger shortfall', () => {
    const { groups } = computeShoppingList(
      [{ stockItemId: 's1', name: 'Baked beans', targetQuantity: 5 }],
      [level('s1', 'Baked beans', 'Tinned', -2)],
    );
    expect(groups[0]?.items[0]?.need).toBe(7);
  });

  it('pulls a retired item out — attention only, never bought', () => {
    const { groups, attention } = computeShoppingList(
      [{ stockItemId: 's1', name: 'Value rice 500g', targetQuantity: 20 }],
      [level('s1', 'Value rice 500g', 'Dry goods', 0, false)],
    );
    expect(groups).toEqual([]);
    expect(attention).toEqual([
      { storedName: 'Value rice 500g', targetQuantity: 20, kind: 'retired' },
    ]);
  });

  it('pulls a missing item out — attention only, with the stored target', () => {
    const { groups, attention } = computeShoppingList(
      [{ stockItemId: 'gone', name: 'Instant coffee 200g', targetQuantity: 6 }],
      [],
    );
    expect(groups).toEqual([]);
    expect(attention).toEqual([
      { storedName: 'Instant coffee 200g', targetQuantity: 6, kind: 'missing' },
    ]);
  });

  it('keeps a renamed item in its group and flags it', () => {
    const { groups, renamed } = computeShoppingList(
      [{ stockItemId: 's1', name: 'UHT milk 1L', targetQuantity: 60 }],
      [level('s1', 'Long-life milk 1L', 'Dairy', 10)],
    );
    expect(groups[0]?.items[0]).toMatchObject({
      name: 'Long-life milk 1L',
      need: 50,
      renamedFrom: 'UHT milk 1L',
    });
    expect(renamed).toEqual(['Long-life milk 1L']);
  });
});

describe('groupByCategory', () => {
  it('orders categories alphabetically and items alphabetically within, regardless of input order', () => {
    const grouped = groupByCategory([
      item('Washing-up liquid', 'Household', 3),
      item('Laundry powder', 'Household', 2),
      item('Baked beans', 'Tinned', 10),
    ]);
    expect(grouped.map((g) => g.category)).toEqual(['Household', 'Tinned']);
    expect(grouped[0]?.items.map((i) => i.name)).toEqual(['Laundry powder', 'Washing-up liquid']);
  });
});

describe('splitGroupedColumns', () => {
  const group = (category: string, count: number): CategoryGroup => ({
    category,
    items: Array.from({ length: count }, (_, n) => item(`${category} ${String(n)}`, category, 1)),
  });

  it('fills column-first and never separates a heading from its items', () => {
    const groups = [group('A', 3), group('B', 3), group('C', 3)];
    const columns = splitGroupedColumns(groups, 3);
    expect(columns.map((c) => c.map((g) => g.category))).toEqual([['A'], ['B'], ['C']]);
  });

  it('keeps an oversized category whole rather than splitting it', () => {
    const columns = splitGroupedColumns([group('Big', 20), group('Small', 1)], 3);
    const big = columns.flat().find((g) => g.category === 'Big');
    expect(big?.items).toHaveLength(20);
    expect(columns).toHaveLength(3);
  });

  it('returns exactly `columns` columns even with fewer groups', () => {
    const columns = splitGroupedColumns([group('Only', 2)], 3);
    expect(columns).toHaveLength(3);
    expect(columns[1]).toEqual([]);
    expect(columns[2]).toEqual([]);
  });
});

describe('shoppingListToPlainText', () => {
  it('writes category headings and tab-separated name/quantity rows', () => {
    const text = shoppingListToPlainText(
      [
        { category: 'Household', items: [item('Laundry powder', 'Household', 2)] },
        { category: 'Tinned', items: [item('Baked beans', 'Tinned', 10)] },
      ],
      [{ storedName: 'Value rice 500g', targetQuantity: 20, kind: 'retired' }],
    );
    expect(text).toBe(
      'Household\nLaundry powder\t2\n\nTinned\nBaked beans\t10\n\n' +
        "Needs an administrator's attention — not bought\nValue rice 500g\t20",
    );
  });

  it('omits the attention block when there is nothing to flag', () => {
    const text = shoppingListToPlainText(
      [{ category: 'Tinned', items: [item('Baked beans', 'Tinned', 10)] }],
      [],
    );
    expect(text).toBe('Tinned\nBaked beans\t10');
  });
});
