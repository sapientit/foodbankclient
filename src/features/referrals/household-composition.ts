/**
 * The one reporting answer for a household's make-up.  The API needs only the
 * derived adults and children for parcel sizing; this map is kept as one
 * answer for reporting, rather than as a second set of totals to maintain.
 */
export const HOUSEHOLD_COMPONENTS_KEY = 'Household Components';

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
  { key: 'non-binary', label: 'Non-Binary' },
  { key: 'prefer-not-to-say', label: 'Prefer not to say' },
] as const;

export type HouseholdAgeBand = (typeof HOUSEHOLD_AGE_BANDS)[number]['key'];
export type HouseholdGender = (typeof HOUSEHOLD_GENDERS)[number]['key'];
export type HouseholdComposition = Readonly<
  Partial<Record<HouseholdAgeBand, Readonly<Partial<Record<HouseholdGender, number>>>>>
>;

export function emptyHouseholdComposition(): HouseholdComposition {
  return {};
}

export function isHouseholdComposition(value: unknown): value is HouseholdComposition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  return Object.entries(record).every(([ageBand, row]) => {
    if (!HOUSEHOLD_AGE_BANDS.some((band) => band.key === ageBand)) return false;
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
    const entries = Object.entries(row);
    return (
      entries.length > 0 &&
      entries.every(
        ([gender, count]) =>
          HOUSEHOLD_GENDERS.some((candidate) => candidate.key === gender) &&
          Number.isSafeInteger(count) &&
          typeof count === 'number' &&
          count > 0 &&
          count <= 30,
      )
    );
  });
}

function rowTotal(composition: HouseholdComposition, band: HouseholdAgeBand): number {
  return HOUSEHOLD_GENDERS.reduce(
    (total, gender) => total + (composition[band]?.[gender.key] ?? 0),
    0,
  );
}

/**
 * The two counts the rules run on: the model parcel's grid cell, the
 * preference rules, and the pair sent to the server as `adults` and `children`.
 *
 * **They are not the everyday meanings of the two words and are not meant to
 * be.** An adult here is anyone aged 12 or over, a child is the 5-11 band
 * alone, and the 0-4 band counts towards neither — because these are the axes
 * of the household grid, which is the charity's rule about how much food a
 * household needs rather than a description of who lives there. A teenager
 * eats an adult's share; an infant is fed from elsewhere.
 *
 * The server stores this pair and compares it without being told what it
 * means, so the definition can change here without a migration there. Anything
 * shown to a person who did not ask about parcel sizing wants
 * {@link commonUsageHouseholdCounts} instead.
 */
export function operationalHouseholdCounts(composition: HouseholdComposition): {
  readonly adults: number;
  readonly children: number;
} {
  return {
    adults:
      rowTotal(composition, '12-17') +
      rowTotal(composition, 'working-age') +
      rowTotal(composition, 'state-pension-age'),
    children: rowTotal(composition, '5-11'),
  };
}

/**
 * The same household counted the way the two words are normally used: adults
 * are 18 or over, children are everyone under 18, and nobody is left out.
 *
 * Only the referrer's confirmation page reads this. A referrer has just filled
 * in the grid and is checking it describes the household they know, so reading
 * back the operational pair would show a household of ten as eight and call a
 * fourteen-year-old an adult. It is never sent and never sizes a parcel.
 */
export function commonUsageHouseholdCounts(composition: HouseholdComposition): {
  readonly adults: number;
  readonly children: number;
} {
  return {
    adults: rowTotal(composition, 'working-age') + rowTotal(composition, 'state-pension-age'),
    children:
      rowTotal(composition, '0-4') + rowTotal(composition, '5-11') + rowTotal(composition, '12-17'),
  };
}
