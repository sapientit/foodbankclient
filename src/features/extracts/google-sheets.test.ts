import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { FIXED_HEADERS, HOUSEHOLD_COMPOSITION_SHEET_COLUMNS } from './archive-rows.logic';
import { GoogleSheetsError, writeClaim } from './google-sheets';
import type { ExtractClaim } from './queries';
import {
  emptyHouseholdComposition,
  HOUSEHOLD_COMPONENTS_KEY,
} from '../referrals/household-composition';

const SESSION_ID = '00000000-0000-4000-8000-000000000099';
const DYNAMIC_KEY = 'Cause Details';

const extractRow: ExtractClaim['rows'][number] = {
  referralId: '00000000-0000-4000-8000-000000000002',
  status: 'active',
  referredAt: '2026-08-07T09:00:00Z',
  referrerOrganisation: 'Organisation',
  refereeDateOfBirth: null,
  refereePostcode: null,
  adults: 1,
  children: 0,
  isDelivery: false,
  needsFuelHelp: false,
  reason: 'Low income',
  reviewComment: null,
  answers: {},
};

const claim: ExtractClaim = {
  claimId: '00000000-0000-4000-8000-000000000001',
  expiresAt: '2026-08-07T12:00:00Z',
  sessionId: SESSION_ID,
  sessionDate: '2026-08-07',
  sessionLocation: "St Mary's Hall",
  rows: [extractRow],
};

interface SheetsWrite {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function stubSheets(
  archiveKeys: readonly string[],
  mappingRows: readonly unknown[][],
): SheetsWrite[] {
  const writes: SheetsWrite[] = [];
  server.use(
    http.all('https://sheets.googleapis.com/v4/spreadsheets/*', async ({ request }) => {
      const url = new URL(request.url);
      const path = decodeURIComponent(url.pathname);

      if (request.method === 'GET') {
        return HttpResponse.json({
          values: path.includes('/values/archive!') ? [archiveKeys] : mappingRows,
        });
      }

      writes.push({
        method: request.method,
        path,
        body: await request.json(),
      });
      return HttpResponse.json({});
    }),
  );
  return writes;
}

function writeAt(writes: readonly SheetsWrite[], path: string): SheetsWrite {
  const write = writes.find((candidate) => candidate.path === path);
  if (write === undefined) throw new Error(`No write for ${path}`);
  return write;
}

/**
 * A spreadsheet that remembers what was written to it.
 *
 * `stubSheets` above answers every read from a fixed fixture, which is right for
 * asserting the shape of one write. It cannot see the fresh-sheet failure,
 * because that one only appears on the **second** extract: the first leaves
 * behind a hidden key row, and the question is whether the next run can read it.
 * So this models enough of the API to be written to and read back — cell writes
 * at an A1 range, appends at the end, and Google's habit of omitting `values`
 * entirely for a range that holds nothing.
 */
interface FakeSpreadsheet {
  archive: (string | number | boolean)[][];
  mapping: (string | number | boolean)[][];
}

const CELL_RANGE = /^(archive|mapping)!([A-Z]+)(\d+):[A-Z]+\d+$/;

/** `A` is 1, `O` is 15, `AH` is 34 — the inverse of `columnName` in the module under test. */
function columnIndex(name: string): number {
  let index = 0;
  for (let position = 0; position < name.length; position += 1) {
    index = index * 26 + (name.charCodeAt(position) - 64);
  }
  return index;
}

function stubSpreadsheet(): FakeSpreadsheet {
  const sheet: FakeSpreadsheet = { archive: [], mapping: [] };

  server.use(
    http.all('https://sheets.googleapis.com/v4/spreadsheets/*', async ({ request }) => {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const range = path.slice(path.lastIndexOf('/values/') + '/values/'.length);

      if (request.method === 'GET') {
        // Sheets omits `values` for an empty range rather than sending [[]].
        const rows = range.startsWith('archive!') ? sheet.archive.slice(0, 1) : sheet.mapping;
        return HttpResponse.json(rows.length === 0 ? {} : { values: rows });
      }

      const { values } = (await request.json()) as { values: (string | number | boolean)[][] };
      const target = range.startsWith('archive!') ? sheet.archive : sheet.mapping;

      if (range.endsWith(':append')) {
        target.push(...values);
        return HttpResponse.json({});
      }

      const cells = CELL_RANGE.exec(range);
      if (cells === null) throw new Error(`Unhandled range ${range}`);
      const startColumn = columnIndex(cells[2] ?? '');
      const rowIndex = Number(cells[3]) - 1;

      const row = (target[rowIndex] ??= []);
      values[0]?.forEach((value, offset) => {
        // Cells left of the write stay blank, exactly as they would on the real
        // sheet — which is the whole mechanism of the bug this file now covers.
        for (let index = row.length; index < startColumn - 1 + offset; index += 1) row[index] = '';
        row[startColumn - 1 + offset] = value;
      });
      return HttpResponse.json({});
    }),
  );

  return sheet;
}

describe('writing a claim to the spreadsheet', () => {
  it('uses hidden keys, not editable headings, to write an existing answer column', async () => {
    const keys = [...FIXED_HEADERS, DYNAMIC_KEY];
    const writes = stubSheets(keys, [
      ['key', 'column'],
      [DYNAMIC_KEY, keys.length],
    ]);
    const claimWithAnswer: ExtractClaim = {
      ...claim,
      rows: [{ ...extractRow, answers: { [DYNAMIC_KEY]: 'No money for food' } }],
    };

    await writeClaim('sheet-1', 'google-token', claimWithAnswer, {});

    expect(writes.filter((write) => write.method === 'PUT')).toEqual([]);
    const archiveWrite = writeAt(writes, '/v4/spreadsheets/sheet-1/values/archive!A:ZZ:append');
    expect(archiveWrite.body).toEqual({
      values: [expect.arrayContaining(["St Mary's Hall", 'No money for food'])],
    });
  });

  it('adds a new key to both archive header rows and mapping before appending its data', async () => {
    const writes = stubSheets(FIXED_HEADERS, [['key', 'column']]);
    const claimWithAnswer: ExtractClaim = {
      ...claim,
      rows: [{ ...extractRow, answers: { [DYNAMIC_KEY]: 'No money for food' } }],
    };

    await writeClaim('sheet-1', 'google-token', claimWithAnswer, {});

    expect(writeAt(writes, '/v4/spreadsheets/sheet-1/values/archive!O1:O1').body).toEqual({
      values: [[DYNAMIC_KEY]],
    });
    expect(writeAt(writes, '/v4/spreadsheets/sheet-1/values/archive!O2:O2').body).toEqual({
      values: [[DYNAMIC_KEY]],
    });
    expect(writeAt(writes, '/v4/spreadsheets/sheet-1/values/mapping!A:B:append').body).toEqual({
      values: [[DYNAMIC_KEY, FIXED_HEADERS.length + 1]],
    });

    const archiveWrite = writeAt(writes, '/v4/spreadsheets/sheet-1/values/archive!A:ZZ:append');
    expect(archiveWrite.body).toEqual({
      values: [expect.arrayContaining(["St Mary's Hall", 'No money for food'])],
    });
    expect(JSON.stringify(writes)).not.toContain(SESSION_ID);
  });

  it('adds stable columns for a composition grid and writes individual counts', async () => {
    const writes = stubSheets(FIXED_HEADERS, [['key', 'column']]);
    const composition = {
      ...emptyHouseholdComposition(),
      '0-4': { female: 1 },
      'state-pension-age': { male: 2 },
    };

    await writeClaim(
      'sheet-1',
      'google-token',
      {
        ...claim,
        rows: [{ ...extractRow, answers: { [HOUSEHOLD_COMPONENTS_KEY]: composition } }],
      },
      {},
    );

    expect(writeAt(writes, '/v4/spreadsheets/sheet-1/values/archive!O1:AH1').body).toEqual({
      values: [HOUSEHOLD_COMPOSITION_SHEET_COLUMNS],
    });
    expect(writeAt(writes, '/v4/spreadsheets/sheet-1/values/archive!A:ZZ:append').body).toEqual({
      values: [expect.arrayContaining([1, 2])],
    });
    expect(JSON.stringify(writes)).not.toContain(JSON.stringify(composition));
  });
});

/**
 * The first extract into a spreadsheet nobody has extracted to yet.
 *
 * `archiveKeys` invents `FIXED_HEADERS` when row one is blank, and everything
 * downstream then assumes those fourteen keys are *on the sheet*. If they are
 * never written there, the run looks like it worked and the next one cannot
 * read what it left — so both tests below end by extracting a second time,
 * which is the only assertion that would have caught it.
 */
describe('the first claim written to an empty spreadsheet', () => {
  const claimWithAnswer: ExtractClaim = {
    ...claim,
    rows: [{ ...extractRow, answers: { [DYNAMIC_KEY]: 'No money for food' } }],
  };

  it('writes the fixed keys with the new one, so the next extract can still read the key row', async () => {
    const sheet = stubSpreadsheet();

    await writeClaim('sheet-1', 'google-token', claimWithAnswer, {});

    expect(sheet.archive[0]).toEqual([...FIXED_HEADERS, DYNAMIC_KEY]);
    expect(sheet.archive[1]).toEqual([...FIXED_HEADERS, DYNAMIC_KEY]);

    await expect(
      writeClaim('sheet-1', 'google-token', claimWithAnswer, {}),
    ).resolves.toBeUndefined();
    expect(sheet.archive[0]).toEqual([...FIXED_HEADERS, DYNAMIC_KEY]);
  });

  it('writes the fixed keys even when the claim adds no answer column of its own', async () => {
    // The case with nothing to add is the worse one: with no header write at
    // all, the appended data row becomes row one and *is* the hidden key row.
    const sheet = stubSpreadsheet();

    await writeClaim('sheet-1', 'google-token', claim, {});

    expect(sheet.archive[0]).toEqual([...FIXED_HEADERS]);
    await expect(writeClaim('sheet-1', 'google-token', claim, {})).resolves.toBeUndefined();
  });
});

/**
 * The real key row from the charity's test spreadsheet, as Google returned it
 * on 2026-08-17. An older format: it identifies the session by id rather than
 * by where it was, and it carries seven columns of names, addresses, emails and
 * phone numbers that the extract is not allowed to write — `screenDetails.md`:
 * "The extract contains no names, addresses, email addresses or telephone
 * numbers. Its only personal-information columns are postcode and date of
 * birth."
 *
 * Kept verbatim because refusing this sheet is the behaviour that matters most
 * in this file: the check is the last thing standing between a household's
 * address and a Google spreadsheet.
 */
const OLD_FORMAT_KEY_ROW = [
  'sessionDate',
  'sessionId',
  'referralId',
  'status',
  'referredAt',
  'referrerOrganisation',
  'referrerName',
  'referrerEmail',
  'referrerPhone',
  'refereeFirstName',
  'refereeSurname',
  'refereeDateOfBirth',
  'refereeAddress',
  'refereePostcode',
  'refereePhone',
  'adults',
  'children',
  'isDelivery',
  'needsFuelHelp',
  'reason',
  'reviewComment',
  'Contact approved',
  'Household',
  'Oil',
];

describe('an archive whose key row is not the extract format', () => {
  it('refuses a sheet still carrying name and address columns, and writes nothing', async () => {
    const writes = stubSheets(OLD_FORMAT_KEY_ROW, [['key', 'column']]);

    await expect(writeClaim('sheet-1', 'google-token', claim, {})).rejects.toBeInstanceOf(
      GoogleSheetsError,
    );
    // Nothing at all, and that is the point: the check runs before the mapping
    // sheet is read or seeded, so a wrong sheet is left exactly as it was.
    expect(writes).toEqual([]);
  });

  it('names the column that disagrees, so an administrator can go and fix it', async () => {
    stubSheets(OLD_FORMAT_KEY_ROW, [['key', 'column']]);

    // "Does not match the extract format" is true and useless against thirty
    // hidden keys. This is the sentence that gets read off the screen.
    await expect(writeClaim('sheet-1', 'google-token', claim, {})).rejects.toThrow(
      /Column B should be .sessionLocation. and reads .sessionId./,
    );
  });

  it('says which cell is empty when the key row is short rather than wrong', async () => {
    stubSheets(['sessionDate'], [['key', 'column']]);

    await expect(writeClaim('sheet-1', 'google-token', claim, {})).rejects.toThrow(/\(empty\)/);
  });
});
