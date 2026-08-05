import { describe, expect, it } from 'vitest';
import type { ModelParcel } from './queries';
import {
  GRID_ADULTS,
  GRID_CELL_KEYS,
  GRID_CHILDREN,
  buildContentLines,
  buildGridPayload,
  describeHouseholdClamping,
  describeHouseholdSize,
  findModelParcelByName,
  gridCellKey,
  gridCompleteness,
  normaliseModelParcelName,
  parseWholeNumber,
  sortModelParcels,
  unknownGridCells,
} from './model-parcels.logic';

const FAMILY: ModelParcel = {
  id: 'p1',
  name: 'Family parcel',
  description: null,
  displayOrder: 0,
  contents: [{ stockItemId: 's1', quantity: 4 }],
};

const SINGLE: ModelParcel = {
  id: 'p2',
  name: 'Single parcel',
  description: null,
  displayOrder: 1,
  contents: [{ stockItemId: 's1', quantity: 2 }],
};

describe('the grid cells', () => {
  it('covers every household size exactly once, adults outer and children inner', () => {
    expect(GRID_CELL_KEYS).toHaveLength(30);
    expect(GRID_CELL_KEYS[0]).toBe('1-0');
    expect(GRID_CELL_KEYS[5]).toBe('1-5');
    expect(GRID_CELL_KEYS[6]).toBe('2-0');
    expect(GRID_CELL_KEYS.at(-1)).toBe('5-5');
    expect(new Set(GRID_CELL_KEYS).size).toBe(30);
  });

  it('runs adults 1 to 5 and children 0 to 5, matching the domain rule exactly', () => {
    expect(GRID_ADULTS).toEqual([1, 2, 3, 4, 5]);
    expect(GRID_CHILDREN).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keys a cell as adults-children', () => {
    expect(gridCellKey(2, 3)).toBe('2-3');
    expect(gridCellKey(1, 0)).toBe('1-0');
  });
});

describe('describeHouseholdSize', () => {
  it('gets the singular and plural right at the edges', () => {
    expect(describeHouseholdSize(1, 0)).toBe('1 adult, 0 children');
    expect(describeHouseholdSize(1, 1)).toBe('1 adult, 1 child');
    expect(describeHouseholdSize(2, 2)).toBe('2 adults, 2 children');
  });
});

describe('sortModelParcels', () => {
  it('orders by displayOrder, then by name', () => {
    const unordered = [SINGLE, FAMILY];
    expect(sortModelParcels(unordered).map((p) => p.name)).toEqual([
      'Family parcel',
      'Single parcel',
    ]);
  });

  it('breaks a tied displayOrder by name', () => {
    const tied: ModelParcel[] = [
      { ...SINGLE, displayOrder: 0 },
      { ...FAMILY, displayOrder: 0 },
    ];
    expect(sortModelParcels(tied).map((p) => p.name)).toEqual(['Family parcel', 'Single parcel']);
  });
});

describe('normaliseModelParcelName and findModelParcelByName', () => {
  it('trims but does not fold case — verified against a running server: "Single parcel" and "single PARCEL" coexist', () => {
    expect(normaliseModelParcelName('  Single parcel  ')).toBe('Single parcel');
    expect(findModelParcelByName([SINGLE], 'single parcel')).toBeUndefined();
    expect(findModelParcelByName([SINGLE], 'Single parcel')).toEqual(SINGLE);
    expect(findModelParcelByName([SINGLE], '  Single parcel  ')).toEqual(SINGLE);
  });

  it('says nothing about an empty box', () => {
    expect(findModelParcelByName([SINGLE], '   ')).toBeUndefined();
  });
});

describe('gridCompleteness', () => {
  it('is complete only when every one of the thirty cells is filled', () => {
    const full = Object.fromEntries(GRID_CELL_KEYS.map((key) => [key, 'Family parcel']));
    expect(gridCompleteness(full)).toEqual({ isComplete: true, missingCells: [] });
  });

  it('reports the missing cells, in grid order', () => {
    const partial = { '1-0': 'Single parcel', '5-5': 'Family parcel' };
    const { isComplete, missingCells } = gridCompleteness(partial);

    expect(isComplete).toBe(false);
    expect(missingCells).toHaveLength(28);
    expect(missingCells[0]).toBe('1-1');
  });

  it('treats a blank string the same as an absent key', () => {
    expect(gridCompleteness({ '1-0': '' }).missingCells).toContain('1-0');
  });
});

describe('unknownGridCells', () => {
  it('finds a cell naming a parcel that is not in the current list', () => {
    const grid = { '1-0': 'Single parcel', '2-0': 'Deleted parcel' };
    expect(unknownGridCells(grid, ['Single parcel', 'Family parcel'])).toEqual(['2-0']);
  });

  it('says nothing is unknown when nothing is set', () => {
    expect(unknownGridCells({}, ['Single parcel'])).toEqual([]);
  });

  it('does not flag a blank cell as unknown — blank is missing, not wrong', () => {
    expect(unknownGridCells({ '1-0': '' }, ['Single parcel'])).toEqual([]);
  });
});

describe('buildGridPayload', () => {
  it('sends only the filled cells — a whole object, no blanks', () => {
    const draft = { '1-0': 'Single parcel', '1-1': '', '2-0': 'Family parcel' };
    expect(buildGridPayload(draft)).toEqual({ '1-0': 'Single parcel', '2-0': 'Family parcel' });
  });

  it('trims a value before deciding whether it counts as filled', () => {
    expect(buildGridPayload({ '1-0': '   ' })).toEqual({});
  });

  it('ignores anything on the draft that is not one of the thirty real cells', () => {
    expect(buildGridPayload({ '9-9': 'Family parcel' })).toEqual({});
  });
});

describe('describeHouseholdClamping', () => {
  it('says nothing for a household already inside the grid', () => {
    expect(describeHouseholdClamping(3, 2)).toBeNull();
    expect(describeHouseholdClamping(5, 5)).toBeNull();
  });

  it('describes a household that clamps in one dimension', () => {
    expect(describeHouseholdClamping(9, 2)).toBe(
      'A household of 9 adults, 2 children is treated as 5 adults, 2 children — households above 5 of either clamp to 5.',
    );
  });

  it('describes a household that clamps in both dimensions', () => {
    expect(describeHouseholdClamping(9, 8)).toContain('treated as 5 adults, 5 children');
  });
});

describe('parseWholeNumber', () => {
  it('accepts a whole number in range', () => {
    expect(parseWholeNumber('4', { minimum: 1, maximum: 1000 })).toEqual({ ok: true, value: 4 });
  });

  it('tells an empty box apart from a lone minus sign', () => {
    expect(parseWholeNumber('', { minimum: 0, maximum: 10 })).toEqual({
      ok: false,
      problem: 'empty',
    });
    expect(parseWholeNumber('-', { minimum: 0, maximum: 10 })).toEqual({
      ok: false,
      problem: 'not-a-whole-number',
    });
  });

  it('refuses a fraction rather than rounding it', () => {
    expect(parseWholeNumber('4.5', { minimum: 0, maximum: 10 })).toEqual({
      ok: false,
      problem: 'not-a-whole-number',
    });
  });

  it('enforces both bounds', () => {
    expect(parseWholeNumber('0', { minimum: 1, maximum: 10 })).toEqual({
      ok: false,
      problem: 'below-minimum',
    });
    expect(parseWholeNumber('11', { minimum: 1, maximum: 10 })).toEqual({
      ok: false,
      problem: 'above-maximum',
    });
  });
});

describe('buildContentLines', () => {
  it('refuses an empty parcel — every real body needs at least one line', () => {
    expect(buildContentLines([])).toEqual({
      ok: false,
      message: 'Add at least one item to this parcel.',
    });
  });

  it('parses every quantity and drops the display-only name', () => {
    expect(
      buildContentLines([
        { stockItemId: 's1', name: 'Beans', quantity: '4' },
        { stockItemId: 's2', name: 'Rice', quantity: '2' },
      ]),
    ).toEqual({
      ok: true,
      lines: [
        { stockItemId: 's1', quantity: 4 },
        { stockItemId: 's2', quantity: 2 },
      ],
    });
  });

  it('names the item in the refusal when a quantity does not parse', () => {
    expect(buildContentLines([{ stockItemId: 's1', name: 'Beans', quantity: 'six' }])).toEqual({
      ok: false,
      message: 'Check the quantity for Beans.',
    });
  });

  it('refuses a quantity of zero — remove the line instead', () => {
    const result = buildContentLines([{ stockItemId: 's1', name: 'Beans', quantity: '0' }]);
    expect(result).toEqual({ ok: false, message: 'Check the quantity for Beans.' });
  });
});
