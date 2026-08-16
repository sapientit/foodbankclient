import { describe, expect, it } from 'vitest';
import {
  commonUsageHouseholdCounts,
  emptyHouseholdComposition,
  isHouseholdComposition,
  operationalHouseholdCounts,
} from './household-composition';

/** One female and one male in all five age bands: ten people, counted two ways. */
const oneOfEach = {
  ...emptyHouseholdComposition(),
  '0-4': { female: 1, male: 1 },
  '5-11': { female: 1, male: 1 },
  '12-17': { female: 1, male: 1 },
  'working-age': { female: 1, male: 1 },
  'state-pension-age': { female: 1, male: 1 },
};

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
  it('counts a twelve to seventeen year old as an adult', () => {
    const composition = {
      ...emptyHouseholdComposition(),
      '12-17': { male: 2 },
      'working-age': { female: 1 },
    };

    expect(operationalHouseholdCounts(composition)).toEqual({ adults: 3, children: 0 });
  });

  it('leaves the under-fives out of both counts', () => {
    const composition = {
      ...emptyHouseholdComposition(),
      '0-4': { female: 2, male: 1 },
      '5-11': { male: 1 },
      'working-age': { female: 1 },
    };

    expect(operationalHouseholdCounts(composition)).toEqual({ adults: 1, children: 1 });
  });

  it('counts one of each age and gender as six adults and two children', () => {
    expect(operationalHouseholdCounts(oneOfEach)).toEqual({ adults: 6, children: 2 });
  });

  it('sums every gender in a band, including non-binary and prefer not to say', () => {
    const composition = {
      ...emptyHouseholdComposition(),
      '5-11': { female: 1, 'prefer-not-to-say': 2 },
      'working-age': { 'non-binary': 1, male: 1 },
    };

    expect(operationalHouseholdCounts(composition)).toEqual({ adults: 2, children: 3 });
  });

  it('is zero adults for a household of nobody over eleven, which cannot be referred', () => {
    const composition = {
      ...emptyHouseholdComposition(),
      '0-4': { female: 1 },
      '5-11': { male: 2 },
    };

    expect(operationalHouseholdCounts(composition)).toEqual({ adults: 0, children: 2 });
  });
});

describe('commonUsageHouseholdCounts', () => {
  it('counts the same household as four adults and six children', () => {
    expect(commonUsageHouseholdCounts(oneOfEach)).toEqual({ adults: 4, children: 6 });
  });

  it('counts a twelve to seventeen year old as a child and includes the under-fives', () => {
    const composition = {
      ...emptyHouseholdComposition(),
      '0-4': { female: 1 },
      '12-17': { male: 2 },
      'working-age': { female: 1, 'non-binary': 1 },
      'state-pension-age': { male: 1 },
    };

    expect(commonUsageHouseholdCounts(composition)).toEqual({ adults: 3, children: 3 });
  });

  it('accounts for every person, unlike the operational pair', () => {
    const people = Object.values(oneOfEach).flatMap((row) => Object.values(row));
    const total = people.reduce((sum, count) => sum + count, 0);
    const { adults, children } = commonUsageHouseholdCounts(oneOfEach);

    expect(adults + children).toBe(total);
  });
});
