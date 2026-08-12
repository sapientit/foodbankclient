import type { ExtractRow } from './queries';

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
  return [...new Set(rows.flatMap((row) => Object.keys(row.answers)))].sort();
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
