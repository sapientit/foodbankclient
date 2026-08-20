import { describe, expect, it } from 'vitest';
import { splitPrintLines } from './pick-list-print.logic';

describe('splitPrintLines', () => {
  it('keeps shelf order down each column before continuing to the next', () => {
    expect(splitPrintLines(['A1', 'A2', 'A10', 'B1', 'B2', 'C1', 'C2'])).toEqual([
      ['A1', 'A2', 'A10'],
      ['B1', 'B2', 'C1'],
      ['C2'],
    ]);
  });
});
