/**
 * The one reporting answer for a household's make-up.  The API needs only the
 * derived adults and children for parcel sizing; this map is kept as one
 * answer for reporting, rather than as a second set of totals to maintain.
 */
export const HOUSEHOLD_COMPONENTS_KEY = 'Household Components';
/** The frozen key used by the first version of the composition grid. */
export const LEGACY_HOUSEHOLD_COMPONENTS_KEY = 'Household composition';

export const HOUSEHOLD_AGE_BANDS = [
  { key: '0-2', label: '0–2' },
  { key: '3-11', label: '3–11' },
  { key: '12-17', label: '12–17' },
  { key: 'working-age', label: '18 to State Pension age' },
  { key: 'state-pension-age', label: 'State Pension age or over' },
] as const;

/**
 * The grid stored before the October 2026 age-band change. Referrals retain
 * their submitted answers, so operational displays must be able to read this
 * shape without relabelling it as the newer one.
 */
export const LEGACY_HOUSEHOLD_AGE_BANDS = [
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
type LegacyHouseholdAgeBand = (typeof LEGACY_HOUSEHOLD_AGE_BANDS)[number]['key'];
type AnyHouseholdAgeBand = HouseholdAgeBand | LegacyHouseholdAgeBand;
export type LegacyHouseholdComposition = Readonly<
  Partial<Record<LegacyHouseholdAgeBand, Readonly<Partial<Record<HouseholdGender, number>>>>>
>;

/** A stored composition may use either the current or the historic age bands. */
export type DisplayHouseholdComposition = HouseholdComposition | LegacyHouseholdComposition;
export type HouseholdCompositionAgeBands =
  typeof HOUSEHOLD_AGE_BANDS | typeof LEGACY_HOUSEHOLD_AGE_BANDS;

export interface HouseholdCompositionDisplay {
  readonly composition: DisplayHouseholdComposition;
  readonly ageBands: HouseholdCompositionAgeBands;
}

export interface HouseholdCompositionTotals {
  readonly under18: number;
  readonly over18: number;
  readonly statePensionAge: number;
}

export function emptyHouseholdComposition(): HouseholdComposition {
  return {};
}

export function isHouseholdComposition(value: unknown): value is HouseholdComposition {
  return isCompositionForAgeBands(value, HOUSEHOLD_AGE_BANDS);
}

export function isLegacyHouseholdComposition(value: unknown): value is LegacyHouseholdComposition {
  return isCompositionForAgeBands(value, LEGACY_HOUSEHOLD_AGE_BANDS);
}

/**
 * Returns a valid composition under either released key and with its original
 * bands intact. The current key is preferred where both are present.
 */
export function householdCompositionForDisplay(
  answers: Readonly<Record<string, unknown>>,
): HouseholdCompositionDisplay | null {
  // The earlier key is unambiguous provenance, even where its populated bands
  // are shared by both versions of the grid.
  const legacy = answers[LEGACY_HOUSEHOLD_COMPONENTS_KEY];
  if (isLegacyHouseholdComposition(legacy))
    return { composition: legacy, ageBands: LEGACY_HOUSEHOLD_AGE_BANDS };
  if (isHouseholdComposition(legacy)) return { composition: legacy, ageBands: HOUSEHOLD_AGE_BANDS };

  const normalisedLegacy = normaliseLabelledHouseholdComposition(legacy, true);
  if (normalisedLegacy !== null) return normalisedLegacy;

  const current = answers[HOUSEHOLD_COMPONENTS_KEY];
  if (isLegacyHouseholdComposition(current) && !isHouseholdComposition(current))
    return { composition: current, ageBands: LEGACY_HOUSEHOLD_AGE_BANDS };
  if (isHouseholdComposition(current))
    return { composition: current, ageBands: HOUSEHOLD_AGE_BANDS };

  return normaliseLabelledHouseholdComposition(current, false);
}

/* Older released forms wrote the visible grid labels rather than the stable
   internal keys. They remain valid historic answers: normalise only that
   known, sparse positive shape before rendering it on a pick sheet. */
const LABELLED_AGE_BANDS = {
  '0-2': '0-2',
  '0–2': '0-2',
  '3-11': '3-11',
  '3–11': '3-11',
  '0-4': '0-4',
  '0–4': '0-4',
  '5-11': '5-11',
  '5–11': '5-11',
  '12-17': '12-17',
  '12–17': '12-17',
  'working-age': 'working-age',
  'state-pension-age': 'state-pension-age',
  '18 to State Pension age': 'working-age',
  'State Pension age or over': 'state-pension-age',
} as const satisfies Readonly<Record<string, AnyHouseholdAgeBand>>;

const LABELLED_GENDERS = {
  female: 'female',
  Female: 'female',
  male: 'male',
  Male: 'male',
  'non-binary': 'non-binary',
  'Non-Binary': 'non-binary',
  'prefer-not-to-say': 'prefer-not-to-say',
  'Prefer not to say': 'prefer-not-to-say',
} as const satisfies Readonly<Record<string, HouseholdGender>>;

function normaliseLabelledHouseholdComposition(
  value: unknown,
  preferLegacyAgeBands: boolean,
): HouseholdCompositionDisplay | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const composition: Partial<
    Record<AnyHouseholdAgeBand, Partial<Record<HouseholdGender, number>>>
  > = {};
  for (const [labelledAgeBand, labelledRow] of Object.entries(value)) {
    const ageBand = labelledAgeBandKey(labelledAgeBand);
    if (
      ageBand === undefined ||
      typeof labelledRow !== 'object' ||
      labelledRow === null ||
      Array.isArray(labelledRow)
    )
      return null;

    const row: Partial<Record<HouseholdGender, number>> = {};
    for (const [labelledGender, count] of Object.entries(labelledRow)) {
      const gender = labelledGenderKey(labelledGender);
      if (
        gender === undefined ||
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > 30 ||
        row[gender] !== undefined
      )
        return null;
      row[gender] = count;
    }
    if (Object.keys(row).length === 0 || composition[ageBand] !== undefined) return null;
    composition[ageBand] = row;
  }

  const candidates = preferLegacyAgeBands
    ? [legacyCompositionDisplay(composition), currentCompositionDisplay(composition)]
    : [currentCompositionDisplay(composition), legacyCompositionDisplay(composition)];
  return candidates.find((candidate) => candidate !== null) ?? null;
}

function labelledAgeBandKey(label: string): AnyHouseholdAgeBand | undefined {
  return Object.entries(LABELLED_AGE_BANDS).find(([candidate]) => candidate === label.trim())?.[1];
}

function labelledGenderKey(label: string): HouseholdGender | undefined {
  return Object.entries(LABELLED_GENDERS).find(([candidate]) => candidate === label.trim())?.[1];
}

function currentCompositionDisplay(value: unknown): HouseholdCompositionDisplay | null {
  return isHouseholdComposition(value)
    ? { composition: value, ageBands: HOUSEHOLD_AGE_BANDS }
    : null;
}

function legacyCompositionDisplay(value: unknown): HouseholdCompositionDisplay | null {
  return isLegacyHouseholdComposition(value)
    ? { composition: value, ageBands: LEGACY_HOUSEHOLD_AGE_BANDS }
    : null;
}

/**
 * The Fuel list needs three age totals, rather than the reporting grid's
 * gender detail. It works from the released answer's own age bands so
 * retained referrals using the former 0-4 and 5-11 bands remain accurate.
 */
export function householdCompositionTotals(
  answers: Readonly<Record<string, unknown>>,
): HouseholdCompositionTotals | null {
  const displayed = householdCompositionForDisplay(answers);
  if (displayed === null) return null;

  const totalFor = (ageBands: readonly string[]) =>
    ageBands.reduce((total, ageBand) => total + displayRowTotal(displayed.composition, ageBand), 0);

  return {
    under18: totalFor(
      displayed.ageBands
        .filter((ageBand) => ageBand.key !== 'working-age' && ageBand.key !== 'state-pension-age')
        .map((ageBand) => ageBand.key),
    ),
    over18: totalFor(['working-age', 'state-pension-age']),
    statePensionAge: totalFor(['state-pension-age']),
  };
}

function displayRowTotal(composition: DisplayHouseholdComposition, ageBand: string): number {
  const row = Object.entries(composition).find(([key]) => key === ageBand)?.[1];
  return row === undefined ? 0 : Object.values(row).reduce((total, count) => total + count, 0);
}

export function householdCompositionAgeBands(
  composition: DisplayHouseholdComposition,
): HouseholdCompositionAgeBands {
  return isHouseholdComposition(composition) ? HOUSEHOLD_AGE_BANDS : LEGACY_HOUSEHOLD_AGE_BANDS;
}

export function householdCompositionCount(
  composition: DisplayHouseholdComposition,
  ageBand: string,
  gender: HouseholdGender,
): number {
  const row = Object.entries(composition).find(([key]) => key === ageBand)?.[1];
  return row?.[gender] ?? 0;
}

function isCompositionForAgeBands(
  value: unknown,
  ageBands: readonly { readonly key: string }[],
): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  return Object.entries(record).every(([ageBand, row]) => {
    if (!ageBands.some((band) => band.key === ageBand)) return false;
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
 * be.** An adult here is anyone aged 12 or over, a child is the 3-11 band
 * alone, and the 0-2 band counts towards neither — because these are the axes
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
    children: rowTotal(composition, '3-11'),
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
      rowTotal(composition, '0-2') + rowTotal(composition, '3-11') + rowTotal(composition, '12-17'),
  };
}
