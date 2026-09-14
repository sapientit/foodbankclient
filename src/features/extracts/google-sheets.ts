import { answerKeys, archiveRows, FIXED_HEADERS } from './archive-rows.logic';
import {
  STOCK_ITEM_USAGE_FIXED_HEADERS,
  stockItemUsageColumns,
  stockItemUsageRow,
  type StockItemUsageSession,
} from './stock-item-usage.logic';
import { ShowableError } from '../../lib/errors';
import type { OptionSources } from '../referrals/referral-form-definition';
import type { ExtractClaim } from './queries';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const ARCHIVE = 'archive';
const MAPPING = 'mapping';
const STOCK_ITEM_USAGE = 'stock item usage';
const STOCK_ITEM_USAGE_MAPPING = 'stock item usage mapping';
const STOCK_ITEM_USAGE_RANGE = `'${STOCK_ITEM_USAGE}'`;
const STOCK_ITEM_USAGE_MAPPING_RANGE = `'${STOCK_ITEM_USAGE_MAPPING}'`;
type Cell = string | number | boolean;

/**
 * Extends `ShowableError` so the sentence reaches the screen. Every message
 * raised here names the thing that is wrong with the spreadsheet, and an
 * administrator is the only person who can go and fix it — which they cannot do
 * if they are told the server is unreachable.
 */
export class GoogleSheetsError extends ShowableError {
  override readonly name = 'GoogleSheetsError';
}

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
  // Check the other sheet before adding any archive data. There is no
  // cross-sheet transaction, but a bad usage tab must not be discovered after
  // referral rows have already been appended.
  const [{ keys, isEmpty }] = await Promise.all([
    archiveKeys(spreadsheetId, accessToken).then(async (archive) => {
      await assertMappingsValid(spreadsheetId, accessToken, archive.keys);
      return archive;
    }),
    stockItemUsageKeys(spreadsheetId, accessToken).then(async (stockUsage) => {
      await assertStockItemUsageMappingsValid(spreadsheetId, accessToken, stockUsage.keys);
      return stockUsage;
    }),
  ]);
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
  await writeStockItemUsage(spreadsheetId, accessToken, claim);
}

/**
 * Kept separate from `writeClaim` so the stock sheet's format can be tested
 * against an extract session without pretending that stock usage is a referral
 * answer. `writeClaim` calls this before it completes the shared reservation.
 */
export async function writeStockItemUsage(
  spreadsheetId: string,
  accessToken: string,
  session: StockItemUsageSession,
): Promise<void> {
  const { keys, isEmpty } = await stockItemUsageKeys(spreadsheetId, accessToken);
  await assertStockItemUsageMappingsValid(spreadsheetId, accessToken, keys);
  const additions = stockItemUsageColumns(session.stockItemUsage).filter(
    ({ key }) => !keys.includes(key),
  );
  const allKeys = [...keys, ...additions.map(({ key }) => key)];
  const headerKeys = isEmpty ? allKeys : additions.map(({ key }) => key);
  const headings = isEmpty
    ? [...STOCK_ITEM_USAGE_FIXED_HEADERS, ...additions.map(({ heading }) => heading)]
    : additions.map(({ heading }) => heading);
  const startingColumn = isEmpty ? 1 : keys.length + 1;
  if (headerKeys.length > 0) {
    await putValues(
      spreadsheetId,
      accessToken,
      stockItemUsageHeaderRange(startingColumn, headerKeys.length, 1),
      [headerKeys],
    );
    await putValues(
      spreadsheetId,
      accessToken,
      stockItemUsageHeaderRange(startingColumn, headings.length, 2),
      [headings],
    );
  }
  if (additions.length > 0) {
    await appendValues(
      spreadsheetId,
      accessToken,
      `${STOCK_ITEM_USAGE_MAPPING_RANGE}!A:B`,
      additions.map(({ key }, index) => [key, keys.length + 1 + index]),
    );
  }
  await appendValues(spreadsheetId, accessToken, `${STOCK_ITEM_USAGE_RANGE}!A:ZZ`, [
    stockItemUsageRow(session, allKeys),
  ]);
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
  /*
   * **Name the column that disagrees.** "Does not match the extract format" is
   * true and useless: the administrator holding it has a hidden row of thirty
   * keys and no way to tell which one is wrong without reading the network tab,
   * which is exactly how this was diagnosed the first time. The column letter
   * and both keys are what they need to go and fix it.
   */
  const wrong = FIXED_HEADERS.findIndex((header, index) => keys[index] !== header);
  if (wrong !== -1)
    throw new GoogleSheetsError(
      `The archive's hidden key row does not match the extract format, so nothing was written. Column ${columnName(wrong + 1)} should be “${FIXED_HEADERS[wrong] ?? ''}” and reads “${keys[wrong] ?? '(empty)'}”.`,
    );
  return { keys, isEmpty: false };
}
function archiveHeaderRange(startColumn: number, width: number, row: number): string {
  const first = columnName(startColumn);
  const last = columnName(startColumn + width - 1);
  return `${ARCHIVE}!${first}${String(row)}:${last}${String(row)}`;
}
function stockItemUsageHeaderRange(startColumn: number, width: number, row: number): string {
  const first = columnName(startColumn);
  const last = columnName(startColumn + width - 1);
  return `${STOCK_ITEM_USAGE_RANGE}!${first}${String(row)}:${last}${String(row)}`;
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
async function assertMappingsValid(
  id: string,
  token: string,
  keys: readonly string[],
): Promise<void> {
  const values = await getValues(id, token, `${MAPPING}!A:B`);
  if (values.length === 0) {
    await putValues(id, token, `${MAPPING}!A1:B1`, [['key', 'column']]);
    return;
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
}
async function stockItemUsageKeys(
  id: string,
  token: string,
): Promise<{ keys: string[]; isEmpty: boolean }> {
  const values = await getValues(id, token, `${STOCK_ITEM_USAGE_RANGE}!1:1`);
  const row = values[0];
  if (row === undefined || row.length === 0)
    return { keys: [...STOCK_ITEM_USAGE_FIXED_HEADERS], isEmpty: true };
  const keys = row.map(String);
  const wrong = STOCK_ITEM_USAGE_FIXED_HEADERS.findIndex((header, index) => keys[index] !== header);
  if (wrong !== -1)
    throw new GoogleSheetsError(
      `The stock item usage sheet's hidden key row does not match the extract format, so nothing was written. Column ${columnName(wrong + 1)} should be “${STOCK_ITEM_USAGE_FIXED_HEADERS[wrong] ?? ''}” and reads “${keys[wrong] ?? '(empty)'}”.`,
    );
  return { keys, isEmpty: false };
}
async function assertStockItemUsageMappingsValid(
  id: string,
  token: string,
  keys: readonly string[],
): Promise<void> {
  const values = await getValues(id, token, `${STOCK_ITEM_USAGE_MAPPING_RANGE}!A:B`);
  if (values.length === 0) {
    await putValues(id, token, `${STOCK_ITEM_USAGE_MAPPING_RANGE}!A1:B1`, [['key', 'column']]);
    return;
  }
  const [first, ...rows] = values;
  if (first?.[0] !== 'key' || first[1] !== 'column')
    throw new GoogleSheetsError(
      'The stock item usage mapping sheet must have key and column headings. Nothing was written.',
    );
  const mappings = new Map<string, number>();
  for (const row of rows) {
    const key = row[0];
    const column = Number(row[1]);
    if (
      typeof key !== 'string' ||
      !Number.isInteger(column) ||
      column <= STOCK_ITEM_USAGE_FIXED_HEADERS.length ||
      keys[column - 1] !== key ||
      mappings.has(key)
    )
      throw new GoogleSheetsError(
        'The stock item usage mapping sheet contains an invalid key or column. Nothing was written.',
      );
    mappings.set(key, column);
  }
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
  if (!response.ok) {
    const detail = googleErrorMessage(json);
    throw new GoogleSheetsError(
      `Google Sheets could not complete the write (${String(response.status)})${detail === null ? '.' : `: ${detail}`}`,
    );
  }
  return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
}
function googleErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null;
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('message' in error)) return null;
  const message = error.message;
  return typeof message === 'string' && message.trim() !== '' ? message.trim() : null;
}
