/**
 * The one reporting answer for a household's make-up.  The API needs only the
 * derived adults and children for parcel sizing; this map is kept as one
 * answer for reporting, rather than as a second set of totals to maintain.
 */
export const HOUSEHOLD_AGE_BANDS = [
  { key: '0-4', label: '0–4' },
  { key: '5-11', label: '5–11' },
  { key: '12-17', label: '12–17' },
  { key: 'working-age', label: '18 to State Pension age' },
  { key: 'state-pension-age', label: 'State Pension age or over' },
] as const;

export const HOUSEHOLD_GENDERS = [
  { key: 'female', label: 'Female' },
  { key: 'male', label: 'Male' },
  { key: 'other', label: 'Other / another gender' },
] as const;

export type HouseholdAgeBand = (typeof HOUSEHOLD_AGE_BANDS)[number]['key'];
export type HouseholdGender = (typeof HOUSEHOLD_GENDERS)[number]['key'];
export type HouseholdComposition = Readonly<
  Record<HouseholdAgeBand, Readonly<Record<HouseholdGender, number>>>
>;

export function emptyHouseholdComposition(): HouseholdComposition {
  return Object.fromEntries(
    HOUSEHOLD_AGE_BANDS.map((band) => [
      band.key,
      Object.fromEntries(HOUSEHOLD_GENDERS.map((gender) => [gender.key, 0])),
    ]),
  ) as HouseholdComposition;
}

export function isHouseholdComposition(value: unknown): value is HouseholdComposition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  return HOUSEHOLD_AGE_BANDS.every((band) => {
    const row = record[band.key];
    return (
      typeof row === 'object' &&
      row !== null &&
      !Array.isArray(row) &&
      HOUSEHOLD_GENDERS.every((gender) => {
        const count = (row as Record<string, unknown>)[gender.key];
        return (
          Number.isSafeInteger(count) && typeof count === 'number' && count >= 0 && count <= 30
        );
      })
    );
  });
}

function rowTotal(composition: HouseholdComposition, band: HouseholdAgeBand): number {
  return HOUSEHOLD_GENDERS.reduce((total, gender) => total + composition[band][gender.key], 0);
}

/** The only counts the server uses to choose a model parcel. */
export function operationalHouseholdCounts(composition: HouseholdComposition): {
  readonly adults: number;
  readonly children: number;
} {
  return {
    adults: rowTotal(composition, 'working-age') + rowTotal(composition, 'state-pension-age'),
    children:
      rowTotal(composition, '0-4') + rowTotal(composition, '5-11') + rowTotal(composition, '12-17'),
  };
}
