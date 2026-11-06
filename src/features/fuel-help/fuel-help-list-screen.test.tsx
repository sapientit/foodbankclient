import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatSessionDate } from '../../lib/london-time';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import rawFormConfig from '../referrals/referral-form.config.json';
import { fuelHelpKeys } from './keys';
import type { FuelHelpList } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const FUEL_HELP_LIST = '/api/v1/fuel-help-list';
const QUESTIONNAIRE = '/api/v1/public/questionnaire';

const LIST: FuelHelpList = {
  households: [
    {
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
        'Cause Details': 'Must not appear on this screen.',
      },
    },
  ],
};

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: {
          id: 'fuel-1',
          email: 'fuel@example.org',
          displayName: 'Fuel volunteer',
          role: 'fuel_admin',
        },
      }),
    ),
    http.get(FUEL_HELP_LIST, () => HttpResponse.json(LIST)),
    // The columns now come from the currently active release, fetched rather
    // than bundled — the shipped config verbatim, so the `forFuelTeam`
    // markers this file already asserts on stay true.
    http.get(QUESTIONNAIRE, () =>
      HttpResponse.json({ formId: 'form-1', questionnaire: JSON.stringify(rawFormConfig) }),
    ),
  );
});

describe('fuel help list', () => {
  it('shows every referral-form column marked for the fuel team', async () => {
    renderApp('/fuel-help');

    const row = await screen.findByRole('row', { name: /Jamie Rowe/ });
    // A pattern because the first row of a session date also carries its "copy
    // from" radio, labelled with the same date, inside this cell.
    expect(screen.getByRole('rowheader', { name: /Tue, 4 Aug 2026/ })).toBeInTheDocument();
    expect(row).toHaveTextContent('Tue, 4 Aug 2026');
    expect(row).toHaveTextContent('1 Example Street');
    expect(row).toHaveTextContent('AB1 2CD');
    expect(row).toHaveTextContent('01234 567890');
    expect(row).toHaveTextContent('Alex Smith');
    expect(row).toHaveTextContent('alex@example.org');
    expect(row).toHaveTextContent('Example Advice');
    expect(row).toHaveTextContent('09876 543210');
    expect(row).toHaveTextContent('jamie@example.org');
    expect(row).toHaveTextContent('Example Energy');
    expect(row).toHaveTextContent('Example Gas');
    expect(row).toHaveTextContent('3');
    expect(row).toHaveTextContent('2');
    expect(row).toHaveTextContent('1');
    // A date, not the stored string and not an age: the fuel team uses it to
    // tell two households of the same name apart.
    expect(row).toHaveTextContent('4 Aug 1975');
    expect(
      screen.getByRole('columnheader', { name: "Client's date of birth" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: "Referrer's name" })).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: "Referrer's email address" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: "Referrer's organisation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: "Referrer's contact number" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '<18' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '18+' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'State Pension age+' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Female' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Male' })).toBeNull();
    expect(
      screen.queryByRole('columnheader', {
        name: 'Are there people in the household over state pension age',
      }),
    ).toBeNull();
    expect(
      screen.getByRole('columnheader', {
        name: 'Do you give permission to share details with "Energy Manage" and/or "The Fuel Bank Foundation" who work in partnership with the foodbank to support our clients?',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fuel help list' })).toHaveAttribute('tabindex', '0');
    expect(screen.queryByText(/Read permission to ring before calling/)).toBeNull();
  });

  it('has no column for a marked field the endpoint does not send', async () => {
    /*
     * `needsFuelHelp` carried the marker while the endpoint withheld it, and the
     * column read "Not provided" on every row. The charity has since settled
     * that the fuel team does not want it — every household on this list needs
     * fuel help by definition — so the marker is off and the column is gone.
     * Asserted here because an empty column is the kind of thing a green test
     * run says nothing about.
     */
    renderApp('/fuel-help');

    await screen.findByRole('row', { name: /Jamie Rowe/ });

    expect(
      screen.queryByRole('columnheader', { name: 'Does the client need help with Energy costs?' }),
    ).toBeNull();
    expect(screen.queryByText('Not provided')).toBeNull();
  });

  it('says so plainly where a household gave no answer', async () => {
    server.use(
      http.get(FUEL_HELP_LIST, () =>
        HttpResponse.json({
          households: [
            {
              ...LIST.households[0],
              referralId: '6b88b448-1c88-4aa6-b9a6-43a495ea2dc1',
              refereeDateOfBirth: null,
              refereePhone: null,
              answers: { Permission: '' },
            },
          ],
        }),
      ),
    );

    renderApp('/fuel-help');

    const row = await screen.findByRole('row', { name: /Jamie Rowe/ });
    // A missing fixed field and an unanswered question read differently on
    // purpose: one was never sent, the other was asked and left blank.
    expect(row).toHaveTextContent('Not provided');
    expect(row).toHaveTextContent('Not answered');
  });

  it('never renders an answer without the fuel-team marker', async () => {
    renderApp('/fuel-help');

    await screen.findByRole('row', { name: /Jamie Rowe/ });

    expect(screen.queryByText('Must not appear on this screen.')).toBeNull();
    expect(screen.queryByText(/Cause Details/)).toBeNull();
  });

  it('reads its columns from the currently active release, not the bundled default', async () => {
    // A key the shipped config does not have at all — if this screen ever
    // fell back to the bundled default instead of the fetched release, this
    // column would not exist and the value would not appear.
    server.use(
      http.get(QUESTIONNAIRE, () =>
        HttpResponse.json({
          formId: 'other-form',
          questionnaire: JSON.stringify({
            version: 1,
            pages: [
              {
                pageNum: 1,
                pageTitle: 'Fuel',
                questions: [
                  {
                    questionNum: 1,
                    questionKey: 'ShoeSize',
                    questionTitle: 'Shoe size',
                    preference: false,
                    required: false,
                    forFuelTeam: true,
                    validation: { type: 'String', maxLength: 20 },
                  },
                ],
              },
            ],
          }),
        }),
      ),
      http.get(FUEL_HELP_LIST, () =>
        HttpResponse.json({
          households: [{ ...LIST.households[0], answers: { ShoeSize: 'Size 8' } }],
        }),
      ),
    );

    renderApp('/fuel-help');

    expect(await screen.findByRole('columnheader', { name: 'Shoe size' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Size 8/ })).toBeInTheDocument();
  });
});

type Household = FuelHelpList['households'][number];

function household(
  referralId: string,
  sessionDate: string,
  refereeSurname: string,
  extra: Partial<Household> = {},
): Household {
  return {
    ...LIST.households[0],
    referralId,
    sessionDate,
    refereeFirstName: 'Test',
    refereeSurname,
    ...extra,
  } as Household;
}

const JULY = household('00000000-0000-4000-8000-000000000001', '2026-07-07', 'Julyone');
const AUGUST_A = household('00000000-0000-4000-8000-000000000002', '2026-08-04', 'Augustone');
const AUGUST_B = household('00000000-0000-4000-8000-000000000003', '2026-08-04', 'Augusttwo');
const SEPTEMBER = household('00000000-0000-4000-8000-000000000004', '2026-09-01', 'Septone');
const OCTOBER = household('00000000-0000-4000-8000-000000000005', '2026-10-06', 'Octone');
const SESSIONS: FuelHelpList = { households: [JULY, AUGUST_A, AUGUST_B, SEPTEMBER] };

const DATE = {
  july: 'Tue, 7 Jul 2026',
  august: 'Tue, 4 Aug 2026',
  // Intl spells September "Sept" in en-GB; formatSessionDate owns that.
  september: formatSessionDate('2026-09-01'),
  october: 'Tue, 6 Oct 2026',
};

/** jsdom has no ClipboardItem: keep what each write was given so the Blobs can be read. */
class FakeClipboardItem {
  readonly parts: Record<string, Blob>;
  constructor(parts: Record<string, Blob>) {
    this.parts = parts;
  }
}

describe('fuel help list: copying from a session', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let write: ReturnType<typeof vi.fn<(items: FakeClipboardItem[]) => Promise<void>>>;
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

  /** Must run after `userEvent.setup()`, which installs its own clipboard stub. */
  function stubClipboard() {
    write = vi.fn<(items: FakeClipboardItem[]) => Promise<void>>().mockResolvedValue();
    writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    });
  }

  async function copiedText(): Promise<string> {
    const item = write.mock.calls[0]?.[0][0];
    return (await item?.parts['text/plain']?.text()) ?? '';
  }

  async function copiedHtml(): Promise<string> {
    const item = write.mock.calls[0]?.[0][0];
    return (await item?.parts['text/html']?.text()) ?? '';
  }

  function rowFor(surname: string): HTMLElement {
    return screen.getByRole('row', { name: new RegExp(surname) });
  }

  function highlighted(): string[] {
    return screen
      .getAllByRole('row')
      .filter((row) => row.hasAttribute('data-will-copy'))
      .map((row) => within(row).getByRole('rowheader').textContent);
  }

  async function open(list: FuelHelpList = SESSIONS) {
    server.use(http.get(FUEL_HELP_LIST, () => HttpResponse.json(list)));
    const view = renderApp('/fuel-help');
    const user = userEvent.setup();
    stubClipboard();
    await screen.findAllByRole('radio');
    return { ...view, user };
  }

  function radioFor(date: string): HTMLElement {
    return screen.getByRole('radio', { name: date });
  }

  async function chooseSession(user: ReturnType<typeof userEvent.setup>, date: string) {
    await user.click(radioFor(date));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalClipboard === undefined) {
      Reflect.deleteProperty(navigator, 'clipboard');
    } else {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    }
  });

  it('chooses nothing on opening, and Copy asks for a session and writes nothing', async () => {
    const { user } = await open();

    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(highlighted()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Copy households' }));

    expect(screen.getByRole('status')).toHaveTextContent('Choose a session first.');
    expect(write).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('offers the choice on the first row of each session date only', async () => {
    await open();

    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(within(rowFor('Julyone')).getByRole('radio')).toBeInTheDocument();
    expect(within(rowFor('Augustone')).getByRole('radio')).toBeInTheDocument();
    expect(within(rowFor('Augusttwo')).queryByRole('radio')).toBeNull();
    expect(within(rowFor('Septone')).getByRole('radio')).toBeInTheDocument();
  });

  it('names each radio by its date and describes it with the instruction', async () => {
    await open();

    for (const date of [DATE.july, DATE.august, DATE.september]) {
      expect(radioFor(date)).toHaveAccessibleDescription(
        /Choose the oldest session you still need/,
      );
    }
  });

  it('highlights exactly the chosen session and every newer one, and counts them on the button', async () => {
    const { user } = await open();

    await chooseSession(user, DATE.august);

    expect(highlighted()).toHaveLength(3);
    expect(rowFor('Julyone')).not.toHaveAttribute('data-will-copy');
    expect(rowFor('Augustone')).toHaveAttribute('data-will-copy');
    expect(rowFor('Augusttwo')).toHaveAttribute('data-will-copy');
    expect(rowFor('Septone')).toHaveAttribute('data-will-copy');
    expect(screen.getByRole('button', { name: 'Copy 3 households' })).toBeInTheDocument();

    await chooseSession(user, DATE.september);
    expect(highlighted()).toHaveLength(1);
    expect(rowFor('Septone')).toHaveAttribute('data-will-copy');
    expect(rowFor('Augusttwo')).not.toHaveAttribute('data-will-copy');
    expect(screen.getByRole('button', { name: 'Copy 1 household' })).toBeInTheDocument();
  });

  it('never splits a session: choosing a two-household date copies both', async () => {
    const { user } = await open({ households: [JULY, AUGUST_A, AUGUST_B] });

    await chooseSession(user, DATE.august);
    await user.click(screen.getByRole('button', { name: 'Copy 2 households' }));

    const lines = (await copiedText()).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Augustone');
    expect(lines[1]).toContain('Augusttwo');
  });

  it('copies exactly the highlighted rows in the order shown, with no heading row by default', async () => {
    const { user } = await open();

    await chooseSession(user, DATE.august);
    await user.click(screen.getByRole('button', { name: 'Copy 3 households' }));

    expect(write).toHaveBeenCalledTimes(1);
    const lines = (await copiedText()).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.split('\t')[0])).toEqual([
      DATE.august,
      DATE.august,
      DATE.september,
    ]);
    expect(lines[0]).toContain('Augustone');
    expect(lines[1]).toContain('Augusttwo');
    expect(lines[2]).toContain('Septone');
    expect(lines.join('\n')).not.toContain('Julyone');
    expect(lines.join('\n')).not.toContain('Session date');
    // The table's own columns, no more: the row is as wide as the table.
    const tableColumns = screen.getAllByRole('columnheader').length;
    for (const line of lines) expect(line.split('\t')).toHaveLength(tableColumns);
  });

  it('adds the column headings as the first line only when the box is ticked', async () => {
    const { user } = await open();

    await chooseSession(user, DATE.september);
    await user.click(screen.getByRole('checkbox', { name: 'Include column headings' }));
    await user.click(screen.getByRole('button', { name: 'Copy 1 household' }));

    const lines = (await copiedText()).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.split('\t')).toEqual(
      screen.getAllByRole('columnheader').map((heading) => heading.textContent),
    );
    expect(lines[1]).toContain('Septone');
  });

  it('never lets an unmarked answer reach the clipboard', async () => {
    const { user } = await open();

    await chooseSession(user, DATE.july);
    await user.click(screen.getByRole('checkbox', { name: 'Include column headings' }));
    await user.click(screen.getByRole('button', { name: 'Copy 4 households' }));

    for (const copied of [await copiedText(), await copiedHtml()]) {
      expect(copied).not.toContain('Must not appear on this screen.');
      expect(copied).not.toContain('Cause Details');
    }
  });

  it('says when the copy has worked, and how many households went', async () => {
    const { user } = await open();

    await chooseSession(user, DATE.august);
    await user.click(screen.getByRole('button', { name: 'Copy 3 households' }));

    expect(await screen.findByText(/3 households copied\. Paste them into Excel\./)).toBeVisible();
  });

  it('never claims a copy or sends text Excel would alter when the clipboard refuses, and keeps the table to select by hand', async () => {
    const { user } = await open();
    write.mockRejectedValue(new Error('Denied'));

    await chooseSession(user, DATE.august);
    await user.click(screen.getByRole('button', { name: 'Copy 3 households' }));

    expect(await screen.findByText(/Could not copy automatically/)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(/a leading zero can be lost/);
    expect(screen.queryByText(/copied\./)).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(rowFor('Septone')).toBeInTheDocument();
  });

  it('changes the status on a repeat copy, so that it is announced again', async () => {
    const { user } = await open();
    await chooseSession(user, DATE.september);
    const button = screen.getByRole('button', { name: 'Copy 1 household' });
    await user.click(button);
    await screen.findByText(/1 household copied/);

    const finishWrite = Promise.withResolvers<undefined>();
    write.mockImplementationOnce(() => finishWrite.promise);
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('status')).not.toHaveTextContent(/copied/);
    });
    finishWrite.resolve(undefined);
    expect(await screen.findByText(/1 household copied/)).toBeVisible();
  });

  it('keeps every value as written, escaping markup and marking each cell as text', async () => {
    const { user } = await open({
      households: [
        household('00000000-0000-4000-8000-000000000006', '2026-08-04', 'Formula', {
          refereePhone: '07700 900000',
          refereeAddress: '=1+1 <b>Road</b>',
        }),
      ],
    });

    await chooseSession(user, DATE.august);
    await user.click(screen.getByRole('button', { name: 'Copy 1 household' }));

    const html = await copiedHtml();
    expect(html).toContain('>=1+1 &lt;b&gt;Road&lt;/b&gt;</td>');
    expect(html).not.toContain('<b>Road');
    expect(html).toContain('>07700 900000</td>');
    expect(html).not.toMatch(/<td>/);
  });

  it('clears the highlight, and copies nothing, when a refetch drops the chosen session', async () => {
    const { user, queryClient } = await open();

    await chooseSession(user, DATE.august);
    expect(highlighted()).toHaveLength(3);

    server.use(
      http.get(FUEL_HELP_LIST, () => HttpResponse.json({ households: [JULY, SEPTEMBER] })),
    );
    await act(() => queryClient.invalidateQueries({ queryKey: fuelHelpKeys.list() }));

    await screen.findByRole('button', { name: 'Copy households' });
    expect(screen.queryByRole('row', { name: /Augustone/ })).toBeNull();
    expect(highlighted()).toEqual([]);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Copy households' }));
    expect(screen.getByRole('status')).toHaveTextContent('Choose a session first.');
    expect(write).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('extends the highlight and the count to a newer session that arrives on a refetch', async () => {
    const { user, queryClient } = await open();

    await chooseSession(user, DATE.august);
    expect(screen.getByRole('button', { name: 'Copy 3 households' })).toBeInTheDocument();

    server.use(
      http.get(FUEL_HELP_LIST, () =>
        HttpResponse.json({ households: [...SESSIONS.households, OCTOBER] }),
      ),
    );
    await act(() => queryClient.invalidateQueries({ queryKey: fuelHelpKeys.list() }));

    expect(await screen.findByRole('button', { name: 'Copy 4 households' })).toBeInTheDocument();
    expect(rowFor('Octone')).toHaveAttribute('data-will-copy');
    expect(rowFor('Julyone')).not.toHaveAttribute('data-will-copy');

    await user.click(screen.getByRole('button', { name: 'Copy 4 households' }));
    expect((await copiedText()).split('\n')).toHaveLength(4);
  });

  it('shows no copy controls when no household needs fuel follow-up', async () => {
    server.use(http.get(FUEL_HELP_LIST, () => HttpResponse.json({ households: [] })));
    renderApp('/fuel-help');

    expect(await screen.findByText('No households currently need fuel follow-up.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Copy/ })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Include column headings' })).toBeNull();
  });
});
