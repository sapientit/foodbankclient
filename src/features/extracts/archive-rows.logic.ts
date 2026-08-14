import type { ExtractRow } from './queries';
import {
  HOUSEHOLD_AGE_BANDS,
  HOUSEHOLD_GENDERS,
  HOUSEHOLD_COMPONENTS_KEY,
  isHouseholdComposition,
  type HouseholdAgeBand,
  type HouseholdGender,
} from '../referrals/household-composition';

/**
 * Stable hidden Sheet keys for the grid. Row two is freely editable, but these
 * keys say which report value belongs in each column and must never be renamed.
 */
export const HOUSEHOLD_COMPOSITION_SHEET_COLUMNS = HOUSEHOLD_AGE_BANDS.flatMap((band) =>
  HOUSEHOLD_GENDERS.map((gender) => `householdComposition.${band.key}.${gender.key}`),
);

/**
 * The fixed keys, in order, and the order is part of the format — the archive's
 * hidden first row refuses a write whose first columns disagree.
 *
 * **The session is identified by where and when it was, never by its id.** A
 * UUID in a spreadsheet helps nobody who has to read one, which is the same
 * reason `reason` is the label rather than `reasonId`. The claim still carries
 * `sessionId` — it completes the claim and finds a duplicate row — but it is
 * not a column here.
 */
export const FIXED_HEADERS = [
  'sessionDate',
  'sessionLocation',
  'referralId',
  'status',
  'referredAt',
  'referrerOrganisation',
  'refereeDateOfBirth',
  'refereePostcode',
  'adults',
  'children',
  'isDelivery',
  'needsFuelHelp',
  'reason',
  'reviewComment',
] as const;

export function answerKeys(rows: readonly ExtractRow[]): string[] {
  const ordinaryKeys = new Set<string>();
  let hasComposition = false;

  for (const row of rows) {
    for (const [key, value] of Object.entries(row.answers)) {
      if (key === HOUSEHOLD_COMPONENTS_KEY && isHouseholdComposition(value)) {
        hasComposition = true;
      } else {
        ordinaryKeys.add(key);
      }
    }
  }

  return [...ordinaryKeys].sort().concat(hasComposition ? HOUSEHOLD_COMPOSITION_SHEET_COLUMNS : []);
}
export function valueForSheet(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return JSON.stringify(value);
}
/**
 * The session columns every row in one claim shares. An object rather than two
 * positional strings on purpose: they are the same type, and the previous
 * signature took the session's id in the slot the location now occupies.
 */
export interface ArchiveSession {
  readonly sessionDate: string;
  readonly sessionLocation: string;
}

export function archiveRows(
  session: ArchiveSession,
  rows: readonly ExtractRow[],
  headers: readonly string[],
): (string | number | boolean)[][] {
  return rows.map((row) => headers.map((header) => fixedValue(header, session, row)));
}
function fixedValue(
  header: string,
  session: ArchiveSession,
  row: ExtractRow,
): string | number | boolean {
  if (header === 'sessionLocation') return session.sessionLocation;
  if (header === 'sessionDate') return session.sessionDate;
  const compositionCell = compositionValue(header, row.answers[HOUSEHOLD_COMPONENTS_KEY]);
  if (compositionCell !== null) return compositionCell;
  if (header in row.answers) return valueForSheet(row.answers[header]);
  const values: Record<string, string | number | boolean | null> = {
    referralId: row.referralId,
    status: row.status,
    referredAt: row.referredAt,
    referrerOrganisation: row.referrerOrganisation,
    refereeDateOfBirth: row.refereeDateOfBirth,
    refereePostcode: row.refereePostcode,
    adults: row.adults,
    children: row.children,
    isDelivery: row.isDelivery,
    needsFuelHelp: row.needsFuelHelp,
    reason: row.reason,
    reviewComment: row.reviewComment,
  };
  return valueForSheet(values[header]);
}

function compositionValue(header: string, value: unknown): number | '' | null {
  const prefix = 'householdComposition.';
  if (!header.startsWith(prefix)) return null;
  if (!isHouseholdComposition(value)) return '';

  const parts = header.slice(prefix.length).split('.');
  const [ageBand, gender] = parts;
  if (
    parts.length !== 2 ||
    !HOUSEHOLD_AGE_BANDS.some((band) => band.key === ageBand) ||
    !HOUSEHOLD_GENDERS.some((column) => column.key === gender)
  ) {
    return '';
  }
  return value[ageBand as HouseholdAgeBand]?.[gender as HouseholdGender] ?? '';
}
