import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { ConfigurationSheetError, readGeneratedRelease } from './configuration-release-sheet';

const SPREADSHEET_ID = 'workbook-id';
const TOKEN = 'access-token';

function stubCells(cells: Readonly<Record<string, string>>) {
  server.use(
    http.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/*`,
      ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/values/')[1] ?? '');
        const sheet = range.replace(/^'|'!A2$/g, '');
        const value = cells[sheet];
        if (value === undefined) return HttpResponse.json({});
        return HttpResponse.json({ range, majorDimension: 'ROWS', values: [[value]] });
      },
    ),
  );
}

describe('readGeneratedRelease', () => {
  it('reads the questionnaire, rules and manifest cells together', async () => {
    stubCells({
      'Generated Questionnaire JSON': 'questionnaire-content',
      'Generated Rules JSON': 'rules-content',
      'Generated Configuration Release': 'manifest-content',
    });

    const release = await readGeneratedRelease(SPREADSHEET_ID, TOKEN);

    expect(release).toEqual({
      questionnaire: 'questionnaire-content',
      rules: 'rules-content',
      manifestRaw: 'manifest-content',
    });
  });

  it('sends the access token as a bearer header', async () => {
    let sawAuthorization: string | null = null;
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/*', ({ request }) => {
        sawAuthorization = request.headers.get('Authorization');
        return HttpResponse.json({ values: [['content']] });
      }),
    );

    await readGeneratedRelease(SPREADSHEET_ID, TOKEN);

    expect(sawAuthorization).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses when a generated tab has nothing in A2', async () => {
    stubCells({
      'Generated Questionnaire JSON': 'questionnaire-content',
      'Generated Rules JSON': 'rules-content',
      // Manifest tab deliberately left empty.
    });

    await expect(readGeneratedRelease(SPREADSHEET_ID, TOKEN)).rejects.toThrow(
      ConfigurationSheetError,
    );
  });

  it('names the sheet and the status when Google refuses the read', async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/*', () =>
        HttpResponse.json(
          { error: { message: 'The caller does not have permission' } },
          { status: 403 },
        ),
      ),
    );

    await expect(readGeneratedRelease(SPREADSHEET_ID, TOKEN)).rejects.toThrow(
      /Generated Questionnaire JSON.*403.*does not have permission/s,
    );
  });
});
