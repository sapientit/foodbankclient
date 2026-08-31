import { describe, expect, it } from 'vitest';
import {
  buildEditorModel,
  buildListPayload,
  findTargetStockListByName,
  hasUnresolvedLines,
  reconcileLines,
  sortTargetStockLists,
  type EditorCatalogueItem,
  type StoredTargetLine,
} from './target-stock-lists.logic';

const active = (id: string, name: string, category = 'Tinned'): EditorCatalogueItem => ({
  id,
  name,
  category,
  isActive: true,
});
const retired = (id: string, name: string, category = 'Tinned'): EditorCatalogueItem => ({
  ...active(id, name, category),
  isActive: false,
});

describe('sortTargetStockLists', () => {
  it('orders by name', () => {
    const sorted = sortTargetStockLists([{ name: 'Standard week' }, { name: 'Christmas' }]);
    expect(sorted.map((l) => l.name)).toEqual(['Christmas', 'Standard week']);
  });
});

describe('findTargetStockListByName', () => {
  const lists = [
    { id: 'a', name: 'Christmas' },
    { id: 'b', name: 'Standard week' },
  ];

  it('matches on the trimmed name, case-sensitively', () => {
    expect(findTargetStockListByName(lists, '  Christmas ')?.id).toBe('a');
    expect(findTargetStockListByName(lists, 'christmas')).toBeUndefined();
  });

  it('does not clash a list with itself', () => {
    expect(findTargetStockListByName(lists, 'Christmas', 'a')).toBeUndefined();
  });

  it('ignores an empty name', () => {
    expect(findTargetStockListByName(lists, '   ')).toBeUndefined();
  });
});

describe('reconcileLines', () => {
  const lines: StoredTargetLine[] = [
    { stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 48 },
    { stockItemId: 's2', name: 'Value rice 500g', targetQuantity: 20 },
    { stockItemId: 's3', name: 'UHT milk 1L', targetQuantity: 60 },
    { stockItemId: 's4', name: 'Teabags 80s', targetQuantity: 12 },
  ];
  const catalogue = [
    active('s1', 'Baked beans 400g'),
    retired('s2', 'Value rice 500g'),
    active('s3', 'Long-life milk 1L'),
    // s4 is gone
  ];

  it('classifies ok, renamed, retired and missing', () => {
    const result = reconcileLines(lines, catalogue);
    expect(result.map((r) => r.discrepancy)).toEqual([null, 'retired', 'renamed', 'missing']);
    expect(result[2]).toMatchObject({ storedName: 'UHT milk 1L', liveName: 'Long-life milk 1L' });
    expect(result[3]).toMatchObject({ liveName: null, targetQuantity: 12 });
  });
});

describe('buildEditorModel', () => {
  const catalogue = [
    active('s1', 'Baked beans 400g'),
    active('s2', 'Chopped tomatoes 400g'),
    active('s3', 'Long-life milk 1L', 'Dairy'),
    retired('s9', 'Value rice 500g'),
  ];

  it('gives one row per active item, targets pre-filled, blank where not on the list', () => {
    const { rows } = buildEditorModel(catalogue, [
      { stockItemId: 's1', name: 'Baked beans 400g', targetQuantity: 48 },
    ]);
    expect(rows.map((r) => [r.stockItemId, r.target])).toEqual([
      ['s1', '48'],
      ['s2', ''],
      ['s3', ''],
    ]);
  });

  it('preserves the catalogue order it was given', () => {
    const { rows } = buildEditorModel(catalogue, []);
    expect(rows.map((r) => r.stockItemId)).toEqual(['s1', 's2', 's3']);
  });

  it('shows a renamed line on its active item row with renamedFrom set, not as attention', () => {
    const { rows, attention } = buildEditorModel(catalogue, [
      { stockItemId: 's3', name: 'UHT milk 1L', targetQuantity: 60 },
    ]);
    const milk = rows.find((r) => r.stockItemId === 's3');
    expect(milk).toMatchObject({
      name: 'Long-life milk 1L',
      target: '60',
      renamedFrom: 'UHT milk 1L',
    });
    expect(attention).toEqual([]);
  });

  it('pulls retired and missing stored lines into the attention list', () => {
    const { attention } = buildEditorModel(catalogue, [
      { stockItemId: 's9', name: 'Value rice 500g', targetQuantity: 20 },
      { stockItemId: 'gone', name: 'Instant coffee 200g', targetQuantity: 6 },
    ]);
    expect(attention).toEqual([
      { stockItemId: 's9', storedName: 'Value rice 500g', targetQuantity: 20, kind: 'retired' },
      {
        stockItemId: 'gone',
        storedName: 'Instant coffee 200g',
        targetQuantity: 6,
        kind: 'missing',
      },
    ]);
  });
});

describe('hasUnresolvedLines', () => {
  it('is true only while retired or missing lines remain', () => {
    expect(hasUnresolvedLines([])).toBe(false);
    expect(
      hasUnresolvedLines([
        { stockItemId: 'x', storedName: 'X', targetQuantity: 1, kind: 'retired' },
      ]),
    ).toBe(true);
  });
});

describe('buildListPayload', () => {
  it('keeps only rows with a value and drops cleared boxes', () => {
    const result = buildListPayload([
      { stockItemId: 's1', name: 'Baked beans', target: '48' },
      { stockItemId: 's2', name: 'Rice', target: '  ' },
      { stockItemId: 's3', name: 'Milk', target: '60' },
    ]);
    expect(result).toEqual({
      ok: true,
      lines: [
        { stockItemId: 's1', name: 'Baked beans', targetQuantity: 48 },
        { stockItemId: 's3', name: 'Milk', targetQuantity: 60 },
      ],
    });
  });

  it('re-snapshots the live name passed in the row', () => {
    const result = buildListPayload([
      { stockItemId: 's3', name: 'Long-life milk 1L', target: '60' },
    ]);
    expect(result).toEqual({
      ok: true,
      lines: [{ stockItemId: 's3', name: 'Long-life milk 1L', targetQuantity: 60 }],
    });
  });

  it('rejects a non-numeric target, naming the item and pointing focus at it', () => {
    const result = buildListPayload([{ stockItemId: 's1', name: 'Baked beans', target: 'lots' }]);
    expect(result).toEqual({
      ok: false,
      message: 'Check the target quantity for Baked beans.',
      focusStockItemId: 's1',
    });
  });

  it('rejects 0 with advice to clear the box instead', () => {
    const result = buildListPayload([{ stockItemId: 's1', name: 'Baked beans', target: '0' }]);
    expect(result).toEqual({
      ok: false,
      message: 'Enter 1 or more for Baked beans, or clear the box to leave it off the list.',
      focusStockItemId: 's1',
    });
  });

  it('rejects a list with nothing on it, with no row to focus', () => {
    const result = buildListPayload([{ stockItemId: 's1', name: 'Baked beans', target: '' }]);
    expect(result).toEqual({
      ok: false,
      message: 'Set a target quantity for at least one item.',
      focusStockItemId: null,
    });
  });
});
