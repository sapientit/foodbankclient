import { describe, expect, it } from 'vitest';
import {
  fuelColumns,
  fuelColumnValue,
  fuelCopyCells,
  fuelCopyHeadings,
  fuelCopyHtml,
  fuelCopyText,
  householdsToCopy,
} from './fuel-help.logic';
import { householdCompositionTotals } from '../referrals/household-composition';
import type { FuelHelpList } from './queries';
import type { ReferralFormDefinition } from '../referrals/referral-form-definition';

const HOUSEHOLD: FuelHelpList['households'][number] = {
  referralId: '5a77a337-0b77-4ff5-a895-32f384df1cb0',
  sessionDate: '2026-08-04',
  referrerName: 'Alex Smith',
  referrerEmail: 'alex@example.org',
  referrerOrganisation: 'Example Advice',
  referrerPhone: '09876 543210',
  refereeFirstName: 'Jamie',
  refereeSurname: 'Rowe',
  refereeDateOfBirth: '1975-08-04',
  refereeAddress: '1 Example Street',
  refereePostcode: 'AB1 2CD',
  refereePhone: '01234 567890',
  needsFuelHelp: true,
  formId: null,
  answers: {
    refereeEmail: 'jamie@example.org',
    'Household Components': {
      '0-2': { female: 1 },
      '3-11': { male: 1 },
      '12-17': { 'non-binary': 1 },
      'working-age': { female: 1 },
      'state-pension-age': { male: 1 },
    },
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
        : fuelColumnValue(column, { ...HOUSEHOLD, answers: { 'new fuel question': 'Shown' } }, {}),
    ).toBe('Shown');
  });

  it('selects present fixed fields and marked dynamic answers in form order', () => {
    expect(fuelColumns(undefined, [HOUSEHOLD]).map(({ key }) => key)).toEqual([
      'referrerName',
      'referrerEmail',
      'referrerOrganisation',
      'referrerPhone',
      'refereeFirstName',
      'refereeSurname',
      'refereeDateOfBirth',
      'refereeEmail',
      'refereePhone',
      'refereeAddress',
      'refereePostcode',
      'Household Components:under18',
      'Household Components:over18',
      'Household Components:statePensionAge',
      'Electricity crisis',
      'Electricity Smart',
      'Gas crisis',
      'Gas Smart',
      'Electricity debt',
      'Gas debt',
      'Permission',
    ]);
  });

  it('calculates fuel totals for current and historic composition without sex detail', () => {
    expect(householdCompositionTotals(HOUSEHOLD.answers)).toEqual({
      under18: 3,
      over18: 2,
      statePensionAge: 1,
    });
    expect(
      householdCompositionTotals({
        'Household composition': {
          '0-4': { female: 2 },
          '5-11': { male: 1 },
          '12-17': { female: 1 },
          'working-age': { male: 2 },
          'state-pension-age': { female: 1 },
        },
      }),
    ).toEqual({ under18: 4, over18: 3, statePensionAge: 1 });
  });

  it('renders the three composition totals as separate fuel columns', () => {
    const columns = fuelColumns(undefined, [HOUSEHOLD]).filter(
      (column) => column.householdCompositionTotal !== undefined,
    );

    expect(columns.map(({ label }) => label)).toEqual(['<18', '18+', 'State Pension age+']);
    expect(columns.map((column) => fuelColumnValue(column, HOUSEHOLD, {}))).toEqual([
      '3',
      '2',
      '1',
    ]);
  });

  it('uses composition totals and ignores the legacy pension flag from an older release', () => {
    const definition: ReferralFormDefinition = {
      version: 1,
      pages: [
        {
          pageNum: 1,
          pageTitle: 'Test',
          questions: [
            {
              type: 'householdComposition',
              key: 'Household Components',
              label: 'Household composition',
              required: true,
              preference: false,
            },
            {
              type: 'choice',
              key: 'FuelPension',
              label: 'Are there people in the household over state pension age',
              required: false,
              preference: false,
              forFuelTeam: true,
              answerMin: 0,
              answerMax: 1,
              options: [{ value: 'Yes', label: 'Yes' }],
            },
          ],
        },
      ],
    };

    expect(fuelColumns(definition).map(({ label }) => label)).toEqual([
      '<18',
      '18+',
      'State Pension age+',
    ]);
  });

  it('reads marked dynamic answers but never an unmarked answer', () => {
    const byKey = new Map(
      fuelColumns(undefined, [HOUSEHOLD]).map((column) => [column.key, column]),
    );
    const electricityCrisis = byKey.get('Electricity crisis');

    expect(electricityCrisis).toBeDefined();
    if (electricityCrisis !== undefined) {
      expect(fuelColumnValue(electricityCrisis, HOUSEHOLD, {})).toBe('Example Energy');
    }
    expect(byKey.has('Cause Details')).toBe(false);
  });

  it('shows a date of birth as a date rather than the stored string', () => {
    const dateOfBirth = fuelColumns(undefined, [HOUSEHOLD]).find(
      (column) => column.key === 'refereeDateOfBirth',
    );

    expect(dateOfBirth).toBeDefined();
    if (dateOfBirth !== undefined) {
      // A calendar date, formatted in UTC like every other one in this app —
      // never `new Date('1975-08-04')` read in the device's zone, which moves a
      // birthday to the day before for anyone west of Greenwich.
      expect(fuelColumnValue(dateOfBirth, HOUSEHOLD, {})).toBe('4 Aug 1975');
      expect(fuelColumnValue(dateOfBirth, { ...HOUSEHOLD, refereeDateOfBirth: null }, {})).toBe(
        'Not provided',
      );
    }
  });

  it('uses the endpoint fields rather than reapplying the current form marker', () => {
    /*
     * `refereeSurname` is deliberately not marked in this active form. The
     * endpoint supplied it because the referral's own release marked it, and
     * that permission must not be undone by re-reading today's form.
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
              field: 'refereeSurname',
              key: 'refereeSurname',
              label: "Client's surname",
              required: true,
            },
          ],
        },
      ],
    };

    const surnameHousehold: FuelHelpList['households'][number] = {
      referralId: '6b88b448-1c88-4aa6-b9a6-43a495ea2dc1',
      sessionDate: '2026-08-04',
      refereeSurname: 'Rowe',
      needsFuelHelp: true,
      formId: null,
      answers: {},
    };

    expect(fuelColumns(definition, [surnameHousehold]).map(({ key }) => key)).toEqual([
      'refereeSurname',
    ]);
  });

  it('leaves out a fixed field absent from every endpoint row', () => {
    const definition: ReferralFormDefinition = {
      version: 1,
      pages: [
        {
          pageNum: 1,
          pageTitle: 'Test',
          questions: [
            {
              type: 'keyField',
              field: 'referrerEmail',
              key: 'referrerEmail',
              label: "Referrer's email address",
              required: true,
            },
          ],
        },
      ],
    };

    const householdWithoutReferrerEmail: FuelHelpList['households'][number] = {
      referralId: '6b88b448-1c88-4aa6-b9a6-43a495ea2dc1',
      sessionDate: '2026-08-04',
      needsFuelHelp: true,
      formId: null,
      answers: {},
    };

    expect(fuelColumns(definition, [householdWithoutReferrerEmail])).toEqual([]);
  });

  it('keeps an endpoint field whose question has been removed from today’s form', () => {
    const definition: ReferralFormDefinition = {
      version: 1,
      pages: [
        {
          pageNum: 1,
          pageTitle: 'Today',
          questions: [
            {
              type: 'text',
              key: 'current fuel answer',
              label: 'Current fuel answer',
              required: false,
              preference: false,
              forFuelTeam: true,
              maxLength: 20,
            },
          ],
        },
      ],
    };

    const columns = fuelColumns(definition, [HOUSEHOLD]);
    const referrerEmail = columns.find((column) => column.key === 'referrerEmail');

    expect(referrerEmail?.label).toBe("Referrer's email address");
    expect(
      referrerEmail === undefined ? undefined : fuelColumnValue(referrerEmail, HOUSEHOLD, {}),
    ).toBe('alex@example.org');
  });
});

type Household = FuelHelpList['households'][number];

function onDate(referralId: string, sessionDate: string): Household {
  return { ...HOUSEHOLD, referralId, sessionDate };
}

describe('which households a copy takes', () => {
  const july = onDate('a', '2026-07-07');
  const augustOne = onDate('b', '2026-08-04');
  const augustTwo = onDate('c', '2026-08-04');
  const september = onDate('d', '2026-09-01');
  const list = [july, augustOne, augustTwo, september];

  it('takes nothing while no session is chosen', () => {
    expect(householdsToCopy(list, null)).toEqual([]);
  });

  it('takes the chosen session and every newer one, whole, oldest first', () => {
    expect(householdsToCopy(list, '2026-08-04')).toEqual([augustOne, augustTwo, september]);
    expect(householdsToCopy(list, '2026-07-07')).toEqual(list);
    expect(householdsToCopy(list, '2026-09-01')).toEqual([september]);
  });

  it('takes nothing, not everything, when the chosen date is no longer on the list', () => {
    expect(householdsToCopy([augustOne, september], '2026-07-07')).toEqual([]);
    expect(householdsToCopy([], '2026-08-04')).toEqual([]);
  });
});

describe('what a copy carries', () => {
  const columns = fuelColumns(undefined, [HOUSEHOLD]);

  it('heads the copy with the table headings, the date column first', () => {
    expect(fuelCopyHeadings(columns)).toEqual(['Session date', ...columns.map((c) => c.label)]);
  });

  it('copies the same values the table shows, with the formatted date first', () => {
    const [row] = fuelCopyCells([HOUSEHOLD], columns, {});

    expect(row?.[0]).toBe('Tue, 4 Aug 2026');
    expect(row?.slice(1)).toEqual(columns.map((column) => fuelColumnValue(column, HOUSEHOLD, {})));
    expect(row).toContain('4 Aug 1975');
  });

  it('never carries an answer the fuel team marker does not cover', () => {
    const cells = fuelCopyCells([HOUSEHOLD], columns, {});

    expect(JSON.stringify(cells)).not.toContain('This answer is not for the fuel team.');
    expect(cells[0]).toHaveLength(columns.length + 1);
  });

  it('keeps a tab or line break in an answer within its own cell and row', () => {
    const text = fuelCopyText([
      ['a', 'one\ttwo', 'three\r\nfour\nfive'],
      ['x', 'y', 'z'],
    ]);

    expect(text).toBe('a\tone two\tthree four five\nx\ty\tz');
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.split('\t').length)).toEqual([3, 3]);
  });

  it('escapes markup in an answer and marks every cell as text for Excel', () => {
    const html = fuelCopyHtml([
      ['07700 900123', '<b>"A" & B</b>'],
      ['=1+1', 'plain'],
    ]);

    expect(html).toContain('&lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;');
    expect(html).not.toContain('<b>');
    const cellCount = html.match(/<td /g)?.length;
    expect(cellCount).toBe(4);
    expect(html.match(/<td style="mso-number-format:'\\@'">/g)?.length).toBe(4);
    expect(html.match(/<tr>/g)?.length).toBe(2);
    expect(html).toContain('>=1+1</td>');
  });
});
