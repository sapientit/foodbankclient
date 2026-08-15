import { describe, expect, it } from 'vitest';
import { fuelColumns, fuelColumnValue } from './fuel-help.logic';
import type { FuelHelpList } from './queries';
import type { ReferralFormDefinition } from '../referrals/referral-form-definition';

const HOUSEHOLD: FuelHelpList['households'][number] = {
  referralId: '5a77a337-0b77-4ff5-a895-32f384df1cb0',
  sessionDate: '2026-08-04',
  refereeFirstName: 'Jamie',
  refereeSurname: 'Rowe',
  refereeDateOfBirth: '1975-08-04',
  refereeAddress: '1 Example Street',
  refereePostcode: 'AB1 2CD',
  refereePhone: '01234 567890',
  answers: {
    refereeEmail: 'jamie@example.org',
    FuelPension: 'Yes',
    'Electricity crisis': 'Example Energy',
    'Electricity Smart': 'Yes',
    'Gas crisis': 'Example Gas',
    'Gas Smart': 'Yes',
    'Electricity debt': 'Yes',
    'Gas debt': 'Yes',
    Permission: 'Yes',
    'Cause Details': 'This answer is not for the fuel team.',
  },
};

describe('fuel columns', () => {
  it('uses the marker rather than a separate list of dynamic-answer keys', () => {
    const definition: ReferralFormDefinition = {
      version: 1,
      pages: [
        {
          pageNum: 1,
          pageTitle: 'Test',
          questions: [
            {
              type: 'text',
              key: 'unmarked',
              label: 'Not for fuel',
              required: false,
              preference: false,
              maxLength: 20,
            },
            {
              type: 'text',
              key: 'new fuel question',
              label: 'New fuel question',
              required: false,
              preference: false,
              forFuelTeam: true,
              maxLength: 20,
            },
          ],
        },
      ],
    };
    const [column] = fuelColumns(definition);

    expect(column?.key).toBe('new fuel question');
    expect(
      column === undefined
        ? undefined
        : fuelColumnValue(column, {
            ...HOUSEHOLD,
            answers: { 'new fuel question': 'Shown' },
          }),
    ).toBe('Shown');
  });

  it('selects every form question marked for the fuel team in form order', () => {
    expect(fuelColumns().map(({ key }) => key)).toEqual([
      'refereeFirstName',
      'refereeSurname',
      'refereeDateOfBirth',
      'refereeEmail',
      'refereePhone',
      'refereeAddress',
      'refereePostcode',
      'FuelPension',
      'Electricity crisis',
      'Electricity Smart',
      'Gas crisis',
      'Gas Smart',
      'Electricity debt',
      'Gas debt',
      'Permission',
    ]);
  });

  it('reads marked dynamic answers but never an unmarked answer', () => {
    const byKey = new Map(fuelColumns().map((column) => [column.key, column]));
    const electricityCrisis = byKey.get('Electricity crisis');

    expect(electricityCrisis).toBeDefined();
    if (electricityCrisis !== undefined) {
      expect(fuelColumnValue(electricityCrisis, HOUSEHOLD)).toBe('Example Energy');
    }
    expect(byKey.has('Cause Details')).toBe(false);
  });

  it('shows a date of birth as a date rather than the stored string', () => {
    const dateOfBirth = fuelColumns().find((column) => column.key === 'refereeDateOfBirth');

    expect(dateOfBirth).toBeDefined();
    if (dateOfBirth !== undefined) {
      // A calendar date, formatted in UTC like every other one in this app —
      // never `new Date('1975-08-04')` read in the device's zone, which moves a
      // birthday to the day before for anyone west of Greenwich.
      expect(fuelColumnValue(dateOfBirth, HOUSEHOLD)).toBe('4 Aug 1975');
      expect(fuelColumnValue(dateOfBirth, { ...HOUSEHOLD, refereeDateOfBirth: null })).toBe(
        'Not provided',
      );
    }
  });

  it('leaves out a marked fixed field the endpoint does not return, rather than showing it empty', () => {
    /*
     * The marker lives on the referral form and the endpoint decides what it
     * actually sends, so the two can disagree — `needsFuelHelp` was marked and
     * withheld until the charity settled that the fuel team does not want it.
     * A column that reads "Not provided" on every row of every extract is worse
     * than no column at all in a table whose purpose is being pasted into Excel.
     */
    const definition: ReferralFormDefinition = {
      version: 1,
      pages: [
        {
          pageNum: 1,
          pageTitle: 'Test',
          questions: [
            {
              type: 'keyField',
              field: 'adults',
              key: 'adults',
              label: 'Adults in the household',
              required: true,
              forFuelTeam: true,
            },
            {
              type: 'keyField',
              field: 'refereeSurname',
              key: 'refereeSurname',
              label: "Client's surname",
              required: true,
              forFuelTeam: true,
            },
          ],
        },
      ],
    };

    expect(fuelColumns(definition).map(({ key }) => key)).toEqual(['refereeSurname']);
  });
});
