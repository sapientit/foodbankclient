import { describe, expect, it } from 'vitest';
import {
  answerKeys,
  archiveRows,
  FIXED_HEADERS,
  HOUSEHOLD_COMPOSITION_SHEET_COLUMNS,
} from './archive-rows.logic';
import { emptyHouseholdComposition } from '../referrals/household-composition';
import { HOUSEHOLD_COMPONENTS_KEY } from '../referrals/household-composition';
import type { ExtractRow } from './queries';

const row: ExtractRow = {
  referralId: '00000000-0000-4000-8000-000000000001',
  status: 'active',
  referredAt: '2026-08-07T09:00:00Z',
  referrerOrganisation: 'Organisation',
  refereeDateOfBirth: null,
  refereePostcode: null,
  adults: 1,
  children: 0,
  isDelivery: false,
  needsFuelHelp: false,
  reason: null,
  reviewComment: null,
  answers: { tea: ['Tea', 'Coffee'], notes: 'No onions' },
};

const session = { sessionDate: '2026-08-07', sessionLocation: "St Mary's Hall" };

describe('spreadsheet archive rows', () => {
  it('keeps names, addresses, email addresses and phone numbers out of the archive format', () => {
    expect(FIXED_HEADERS).toEqual(
      expect.not.arrayContaining([
        'referrerName',
        'referrerEmail',
        'referrerPhone',
        'refereeFirstName',
        'refereeSurname',
        'refereeAddress',
        'refereePhone',
      ]),
    );
    expect(FIXED_HEADERS).toEqual(
      expect.arrayContaining(['refereeDateOfBirth', 'refereePostcode']),
    );
  });

  it('keeps every answer key in its own stable column', () => {
    expect(answerKeys([row])).toEqual(['notes', 'tea']);
    const headers = [...FIXED_HEADERS, 'notes', 'tea'];
    expect(archiveRows(session, [row], headers)[0]).toEqual(
      expect.arrayContaining(['2026-08-07', "St Mary's Hall", 'No onions', '["Tea","Coffee"]']),
    );
  });

  it('expands household composition into its reporting columns, never one JSON cell', () => {
    const composition = {
      ...emptyHouseholdComposition(),
      '0-4': { female: 1 },
      'state-pension-age': { male: 2, 'prefer-not-to-say': 1 },
    };
    const compositionRow = { ...row, answers: { [HOUSEHOLD_COMPONENTS_KEY]: composition } };
    const headers = [...FIXED_HEADERS, ...HOUSEHOLD_COMPOSITION_SHEET_COLUMNS];
    const cells = archiveRows(session, [compositionRow], headers)[0] ?? [];

    expect(answerKeys([compositionRow])).toEqual(HOUSEHOLD_COMPOSITION_SHEET_COLUMNS);
    expect(cells[headers.indexOf('householdComposition.0-4.female')]).toBe(1);
    expect(cells[headers.indexOf('householdComposition.state-pension-age.male')]).toBe(2);
    expect(cells[headers.indexOf('householdComposition.state-pension-age.prefer-not-to-say')]).toBe(
      1,
    );
    expect(cells).not.toContain(JSON.stringify(composition));
  });

  /**
   * The sheet used to get the session's UUID here, which is unreadable to
   * everybody the spreadsheet is shared with. Both halves are asserted: that
   * the location arrives in the session column, and that no id reaches the
   * sheet at all — a row that gained the location while keeping the UUID
   * beside it would still be the bug.
   */
  it('writes the session location and never the session id', () => {
    const headers = [...FIXED_HEADERS];
    const written = archiveRows(session, [row], headers);

    expect(headers).toContain('sessionLocation');
    expect(headers).not.toContain('sessionId');

    const cells = written[0] ?? [];
    expect(cells[headers.indexOf('sessionLocation')]).toBe("St Mary's Hall");
    expect(cells[headers.indexOf('sessionDate')]).toBe('2026-08-07');
    expect(cells).not.toContain('00000000-0000-4000-8000-000000000099');
  });
});
