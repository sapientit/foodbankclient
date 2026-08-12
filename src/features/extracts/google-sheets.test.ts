import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { FIXED_HEADERS } from './archive-rows.logic';
import { writeClaim } from './google-sheets';
import type { ExtractClaim } from './queries';

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

    await writeClaim('sheet-1', 'google-token', claimWithAnswer);

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

    await writeClaim('sheet-1', 'google-token', claimWithAnswer);

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
});
