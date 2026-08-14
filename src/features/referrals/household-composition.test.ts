import { describe, expect, it } from 'vitest';
import {
  emptyHouseholdComposition,
  isHouseholdComposition,
  operationalHouseholdCounts,
} from './household-composition';

describe('isHouseholdComposition', () => {
  it('accepts only sparse positive cells in the declared age and gender grid', () => {
    expect(isHouseholdComposition({ '0-4': { female: 1 } })).toBe(true);
    expect(isHouseholdComposition({ '0-4': {} })).toBe(false);
    expect(isHouseholdComposition({ '0-4': { female: 0 } })).toBe(false);
    expect(isHouseholdComposition({ '0-4': { female: 31 } })).toBe(false);
    expect(isHouseholdComposition({ '18-24': { female: 1 } })).toBe(false);
    expect(isHouseholdComposition({ '0-4': { other: 1 } })).toBe(false);
  });
});

describe('operationalHouseholdCounts', () => {
  it('derives parcel adults and children from every age/gender cell', () => {
    const composition = {
      ...emptyHouseholdComposition(),
      '0-4': { female: 1 },
      '12-17': { male: 2 },
      'working-age': { female: 1, 'non-binary': 1 },
      'state-pension-age': { male: 1 },
    };

    expect(operationalHouseholdCounts(composition)).toEqual({ adults: 3, children: 3 });
  });
});
