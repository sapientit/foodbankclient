import { ShowableError } from '../../lib/errors';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const QUESTIONNAIRE_SHEET = 'Generated Questionnaire JSON';
const RULES_SHEET = 'Generated Rules JSON';
const MANIFEST_SHEET = 'Generated Configuration Release';
const CELL = 'A2';

/**
 * Extends `ShowableError` so the sentence reaches the screen, the same
 * reasoning as `extracts/google-sheets.ts`'s `GoogleSheetsError`. An
 * administrator reading it is the only person who can fix a workbook.
 */
export class ConfigurationSheetError extends ShowableError {
  override readonly name = 'ConfigurationSheetError';
}

export interface GeneratedRelease {
  readonly questionnaire: string;
  readonly rules: string;
  readonly manifestRaw: string;
}

/**
 * Reads the three cells the Apps Script's **Generate configuration release**
 * action writes together, each to `A2` of its own tab (`A1` holds an
 * instruction for whoever opens it, not content). Read-only, using the
 * narrower `.readonly` Sheets scope — see `lib/google-auth.ts`.
 */
export async function readGeneratedRelease(
  spreadsheetId: string,
  accessToken: string,
): Promise<GeneratedRelease> {
  const [questionnaire, rules, manifestRaw] = await Promise.all([
    readCell(spreadsheetId, accessToken, QUESTIONNAIRE_SHEET),
    readCell(spreadsheetId, accessToken, RULES_SHEET),
    readCell(spreadsheetId, accessToken, MANIFEST_SHEET),
  ]);
  return { questionnaire, rules, manifestRaw };
}

async function readCell(
  spreadsheetId: string,
  accessToken: string,
  sheet: string,
): Promise<string> {
  const range = `'${sheet}'!${CELL}`;
  const response = await fetch(`${API}/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = googleErrorMessage(json);
    throw new ConfigurationSheetError(
      `Could not read “${sheet}” from the configuration workbook (${String(response.status)})${detail === null ? '.' : `: ${detail}`}`,
    );
  }
  const value = valueAtA2(json);
  if (value === null)
    throw new ConfigurationSheetError(
      `The “${sheet}” tab has nothing in ${CELL}. Generate the configuration release first.`,
    );
  return value;
}

function valueAtA2(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('values' in body)) return null;
  const values = body.values;
  if (!Array.isArray(values)) return null;
  const row: unknown = values[0];
  const cell: unknown = Array.isArray(row) ? row[0] : undefined;
  return typeof cell === 'string' && cell !== '' ? cell : null;
}

function googleErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null;
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('message' in error)) return null;
  const message = error.message;
  return typeof message === 'string' && message.trim() !== '' ? message.trim() : null;
}
