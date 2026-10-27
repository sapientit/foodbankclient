import { describe, expect, it } from 'vitest';
import {
  countPickListInformationLines,
  firstPrintPageHasStockCapacity,
  splitPrintLines,
  splitPrintLinesIntoTwoPages,
} from './pick-list-print.logic';

describe('countPickListInformationLines', () => {
  it('counts blank lines and long wrapped information lines', () => {
    expect(countPickListInformationLines(null)).toBe(0);
    expect(countPickListInformationLines(`Allergies: none\n\n${'x'.repeat(111)}`)).toBe(4);
  });
});

describe('splitPrintLines', () => {
  it('always supplies an identifying second side when the parcel fits on the front', () => {
    const lines = [
      { id: 1, description: null },
      { id: 2, description: 'One described item block' },
    ];

    expect(splitPrintLinesIntoTwoPages(lines, 0)).toEqual({
      pages: [[lines], []],
      overflows: false,
    });
  });

  it('keeps an information-filled front separate from stock on the back', () => {
    const line = { id: 1, description: null };

    expect(splitPrintLinesIntoTwoPages([line], 21)).toEqual({
      pages: [[], [[line]]],
      overflows: false,
    });
  });

  it('holds a parcel back when Information for pickers cannot fit the front', () => {
    expect(splitPrintLinesIntoTwoPages([], 22)).toEqual({
      pages: [[], []],
      overflows: true,
    });
  });

  it('holds an oversized parcel back rather than dropping lines beyond its second side', () => {
    const lines = Array.from({ length: 134 }, (_, index) => ({
      id: index + 1,
      description: null,
    }));

    const layout = splitPrintLinesIntoTwoPages(lines, 0);

    expect(layout.overflows).toBe(true);
    expect(layout.pages.flat(2).map((line) => line.id)).toEqual(
      Array.from({ length: 96 }, (_, index) => index + 1),
    );
  });

  it('keeps shelf order down complete columns before starting the next page', () => {
    const lines = Array.from({ length: 75 }, (_, index) => ({
      id: index + 1,
      description: null,
    }));

    expect(
      splitPrintLines(lines, 0).map((page) => page.map((column) => column.map((line) => line.id))),
    ).toEqual([
      [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
        [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39],
      ],
      [
        [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58],
        [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75],
      ],
    ]);
  });

  it('reserves two units for the compact continuation-sheet identity', () => {
    const lines = Array.from({ length: 75 }, (_, index) => ({
      id: index + 1,
      description: index === 73 ? 'One described item block' : null,
    }));

    expect(
      splitPrintLines(lines, 0).map((page) => page.map((column) => column.map((line) => line.id))),
    ).toEqual([
      [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
        [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39],
      ],
      [
        [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58],
        [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75],
      ],
    ]);
  });

  it('allows for the photographed information block and every described item', () => {
    const lines = Array.from({ length: 34 }, (_, index) => ({
      id: index + 1,
      description: [0, 1, 2, 12, 13].includes(index) ? 'One described item block' : null,
    }));

    expect(
      splitPrintLines(lines, 2).map((page) => page.map((column) => column.map((line) => line.id))),
    ).toEqual([
      [
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
        [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
        [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      ],
      [[31, 32, 33, 34]],
    ]);
  });

  it('leaves a further item-block margin on the UAT snapshot front sheet', () => {
    const lines = [
      null,
      null,
      null,
      null,
      '0.5Kg = 1 unit',
      '0.5Kg = 1 unit',
      null,
      null,
      null,
      null,
      null,
      'Small tin = 1 unit Large tin = 2 units',
      null,
      'If multi-pack give intact',
      null,
      null,
      '500g = 1 unit',
      null,
      null,
      null,
      'Sponge pudding/jelly/desserts',
      null,
      null,
      null,
      null,
      null,
      'If pouches double quant',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ].map((description, index) => ({ id: index + 1, description }));

    expect(
      splitPrintLines(lines, 2).map((page) => page.map((column) => column.map((line) => line.id))),
    ).toEqual([
      [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        [11, 12, 13, 14, 15, 16, 17, 18, 19],
        [20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
      ],
      [[30, 31, 32, 33, 34, 35, 36, 37]],
    ]);
  });

  it('uses the three added information lines to reduce only the first-page capacity', () => {
    const lines = Array.from({ length: 34 }, (_, index) => ({
      id: index + 1,
      description: [0, 1, 2, 12, 13].includes(index) ? 'One described item block' : null,
    }));

    expect(
      splitPrintLines(lines, 5).map((page) => page.map((column) => column.map((line) => line.id))),
    ).toEqual([
      [
        [1, 2, 3, 4, 5, 6, 7],
        [8, 9, 10, 11, 12, 13, 14, 15],
        [16, 17, 18, 19, 20, 21, 22, 23, 24],
      ],
      [[25, 26, 27, 28, 29, 30, 31, 32, 33, 34]],
    ]);
  });

  it('moves stock to the next page when information cannot fit the next complete item', () => {
    const described = { id: 1, description: 'One described item block' };
    const plain = { id: 2, description: null };

    expect(firstPrintPageHasStockCapacity(34, described)).toBe(false);
    expect(firstPrintPageHasStockCapacity(34, plain)).toBe(false);
    expect(splitPrintLines([described], 34)).toEqual([[[described]]]);
  });
});
