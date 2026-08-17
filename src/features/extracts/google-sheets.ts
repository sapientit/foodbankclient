import { answerKeys, archiveRows, FIXED_HEADERS } from './archive-rows.logic';
import type { OptionSources } from '../referrals/referral-form-definition';
import type { ExtractClaim } from './queries';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const ARCHIVE = 'archive';
const MAPPING = 'mapping';
type Cell = string | number | boolean;

export class GoogleSheetsError extends Error {}

/**
 * `sources` are the maintained lookups an answer may have been chosen from —
 * the reason list, today. Threaded from the screen because an answer chosen
 * from one is stored as an id, and this writes to the charity's archive, where
 * a wrong cell is permanent.
 */
export async function writeClaim(
  spreadsheetId: string,
  accessToken: string,
  claim: ExtractClaim,
  sources: OptionSources,
): Promise<void> {
  const { keys, isEmpty } = await archiveKeys(spreadsheetId, accessToken);
  await readMappings(spreadsheetId, accessToken, keys);
  const additions = answerKeys(claim.rows).filter((key) => !keys.includes(key));
  const allKeys = [...keys, ...additions];

  /*
   * A spreadsheet nobody has extracted to yet has no key row at all, and
   * `archiveKeys` answers with the fixed keys it *should* have. They then have
   * to actually be written, from column A, alongside any new ones.
   *
   * Writing only the additions in that case — from column O, where they belong
   * on an established sheet — leaves A to N blank. The run looks like it worked,
   * and the next one reads a key row whose first fourteen cells are empty,
   * fails the format check and refuses for good. With no additions to write it
   * is worse still: nothing is written, and the appended data row lands in row
   * one and becomes the key row.
   */
  const headerKeys = isEmpty ? allKeys : additions;
  const startingColumn = isEmpty ? 1 : keys.length + 1;
  if (headerKeys.length > 0) {
    await putValues(
      spreadsheetId,
      accessToken,
      archiveHeaderRange(startingColumn, headerKeys.length, 1),
      [headerKeys],
    );
    await putValues(
      spreadsheetId,
      accessToken,
      archiveHeaderRange(startingColumn, headerKeys.length, 2),
      [headerKeys],
    );
  }
  if (additions.length > 0) {
    await appendValues(
      spreadsheetId,
      accessToken,
      `${MAPPING}!A:B`,
      // The column an addition lands in is its place in `allKeys`, which is
      // where it sits whether or not the fixed keys were written this run.
      additions.map((key, index) => [key, keys.length + 1 + index]),
    );
  }
  await appendValues(
    spreadsheetId,
    accessToken,
    `${ARCHIVE}!A:ZZ`,
    // `claim.sessionId` deliberately not passed: it completes the claim and
    // finds a duplicate row, but it is not a column. See `FIXED_HEADERS`.
    archiveRows(
      { sessionDate: claim.sessionDate, sessionLocation: claim.sessionLocation },
      claim.rows,
      allKeys,
      sources,
    ),
  );
}

/**
 * The hidden key row, and whether it was there at all. `isEmpty` is what the
 * caller needs to know: the keys returned for a blank sheet are what it *ought*
 * to hold, not what it does, and they still have to be written.
 */
async function archiveKeys(
  id: string,
  token: string,
): Promise<{ keys: string[]; isEmpty: boolean }> {
  const values = await getValues(id, token, `${ARCHIVE}!1:1`);
  const row = values[0];
  if (row === undefined || row.length === 0) return { keys: [...FIXED_HEADERS], isEmpty: true };
  const keys = row.map(String);
  if (FIXED_HEADERS.some((header, index) => keys[index] !== header))
    throw new GoogleSheetsError(
      'The hidden archive key row does not match the extract format. Nothing was written.',
    );
  return { keys, isEmpty: false };
}
function archiveHeaderRange(startColumn: number, width: number, row: number): string {
  const first = columnName(startColumn);
  const last = columnName(startColumn + width - 1);
  return `${ARCHIVE}!${first}${String(row)}:${last}${String(row)}`;
}
function columnName(column: number): string {
  let remaining = column;
  let name = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    name = String.fromCharCode(65 + digit) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name;
}
async function readMappings(
  id: string,
  token: string,
  keys: readonly string[],
): Promise<Map<string, number>> {
  const values = await getValues(id, token, `${MAPPING}!A:B`);
  if (values.length === 0) {
    await putValues(id, token, `${MAPPING}!A1:B1`, [['key', 'column']]);
    return new Map();
  }
  const [first, ...rows] = values;
  if (first?.[0] !== 'key' || first[1] !== 'column')
    throw new GoogleSheetsError(
      'The mapping sheet must have key and column headings. Nothing was written.',
    );
  const mappings = new Map<string, number>();
  for (const row of rows) {
    const key = row[0];
    const column = Number(row[1]);
    if (
      typeof key !== 'string' ||
      !Number.isInteger(column) ||
      column <= FIXED_HEADERS.length ||
      keys[column - 1] !== key ||
      mappings.has(key)
    )
      throw new GoogleSheetsError(
        'The mapping sheet contains an invalid key or column. Nothing was written.',
      );
    mappings.set(key, column);
  }
  return mappings;
}
async function getValues(id: string, token: string, range: string): Promise<unknown[][]> {
  const body = await request(id, token, `/values/${encodeURIComponent(range)}`);
  const values = body.values;
  return Array.isArray(values)
    ? values.filter((value): value is unknown[] => Array.isArray(value))
    : [];
}
async function putValues(
  id: string,
  token: string,
  range: string,
  values: Cell[][],
): Promise<void> {
  await request(id, token, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, 'PUT', {
    values,
  });
}
async function appendValues(
  id: string,
  token: string,
  range: string,
  values: Cell[][],
): Promise<void> {
  if (values.length > 0)
    await request(
      id,
      token,
      `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      'POST',
      { values },
    );
}
async function request(
  id: string,
  token: string,
  suffix: string,
  method = 'GET',
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}/${id}${suffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new GoogleSheetsError(
      `Google Sheets could not complete the write (${String(response.status)}).`,
    );
  return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
}
