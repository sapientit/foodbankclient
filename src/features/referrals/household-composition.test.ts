import { describe, expect, it } from 'vitest';
import { emptyHouseholdComposition, operationalHouseholdCounts } from './household-composition';

describe('operationalHouseholdCounts', () => {
  it('derives parcel adults and children from every age/gender cell', () => {
    const composition = {
      ...emptyHouseholdComposition(),
      '0-4': { female: 1, male: 0, other: 0 },
      '12-17': { female: 0, male: 2, other: 0 },
      'working-age': { female: 1, male: 0, other: 1 },
      'state-pension-age': { female: 0, male: 1, other: 0 },
    };

    expect(operationalHouseholdCounts(composition)).toEqual({ adults: 3, children: 3 });
  });
});
