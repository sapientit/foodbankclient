import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { AdminReferralReason } from '../../admin-setup/queries';
import type { Session } from '../../sessions/queries';
import type { Referral } from '../queries';

/**
 * Signed in as Pete, an administrator — see `test/render-app.tsx`. The
 * team-lead view of this same screen is `referral-detail-team-lead.test.tsx`,
 * its own file because `renderApp`'s signed-in actor is fixed per module.
 */
const REFRESH = '/api/v1/auth/refresh';
const REFERRAL = '/api/v1/referrals/r1';
const REFERRAL_CANCEL = '/api/v1/referrals/r1/cancel';
const REFERRAL_ACCEPT = '/api/v1/referrals/r1/accept';
const REFERRAL_REJECT = '/api/v1/referrals/r1/reject';
const REFERRAL_REVIEW = '/api/v1/referrals/r1/review';
const REFERRAL_COPY = '/api/v1/referrals/r1/copy';
const REPEAT_REFERRALS = '/api/v1/referrals/r1/repeat-referrals';
const SESSIONS = '/api/v1/sessions';
const REASONS = '/api/v1/referral-reasons';

function referral(overrides: Partial<Referral> & Pick<Referral, 'id'>): Referral {
  return {
    sessionId: 's1',
    status: 'active',
    referredAt: '2026-07-01T10:00:00.000Z',
    adults: 2,
    children: 1,
    householdSize: 3,
    isDelivery: false,
    needsFuelHelp: false,
    referrerOrganisation: 'Riverside Church',
    referrerName: 'Sam Referrer',
    refereeFirstName: 'Jamie',
    refereeSurname: 'Rowe',
    refereeDateOfBirth: '1985-03-12',
    refereeAddress: '1 Elm Street',
    refereePostcode: 'AB1 2CD',
    refereePhone: null,
    answers: {},
    piiPurgedAt: null,
    reasonId: 'q1',
    referrerEmail: 'referrer@riverside.org',
    referrerPhone: null,
    reviewComment: null,
    repeatReferrals: { count: 0, mostRecentSessionDate: null },
    ...overrides,
  };
}

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    sessionDate: '2026-08-04',
    startTime: '10:00',
    startsAtUtc: '2026-08-04T09:00:00.000Z',
    durationMinutes: 90,
    location: 'St Mary’s Hall',
    deliveryTime: null,
    deliveriesAllowed: false,
    capacity: 25,
    booked: 10,
    status: 'planned',
    cancelledReason: null,
    isCustomised: false,
    recurringSessionId: null,
    occurrenceDate: null,
    ...overrides,
  };
}

const REASON: AdminReferralReason = {
  id: 'q1',
  code: 'financial_hardship',
  label: 'Financial hardship',
  displayOrder: 0,
  isActive: true,
};

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get(REASONS, () => HttpResponse.json({ referralReasons: [REASON] })),
    http.get(SESSIONS, () =>
      HttpResponse.json({
        sessions: [
          session({ id: 's1', location: 'Church Hall' }),
          session({ id: 's2', location: 'Community Centre', booked: 25, capacity: 25 }),
        ],
      }),
    ),
  );
});

describe('the admin referral detail screen', () => {
  it('marks an active referral reviewed from one button, beside the other actions', async () => {
    let reviews = 0;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'active' }))),
      http.post(REFERRAL_REVIEW, ({ request }) => {
        reviews += 1;
        expect(request.headers.get('content-type')).toBeNull();
        return HttpResponse.json(referral({ id: 'r1', status: 'reviewed' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    // One button, not one at each end of the page.
    const markReviewed = await screen.findByRole('button', { name: 'Mark reviewed' });
    expect(markReviewed.parentElement).toBe(
      screen.getByRole('button', { name: 'Cancel this referral' }).parentElement,
    );
    await user.click(markReviewed);

    await waitFor(() => {
      expect(reviews).toBe(1);
    });
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).toBeNull();
  });

  it('renders the fixed fields, the reason (admin only) and the referrer email (admin only)', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));

    renderApp('/referrals/r1');

    expect(await screen.findByRole('heading', { name: 'Jamie Rowe' })).toBeInTheDocument();
    expect(screen.getByText('referrer@riverside.org')).toBeInTheDocument();
    expect(screen.getByText('Riverside Church')).toBeInTheDocument();
    expect(await screen.findByText('Financial hardship')).toBeInTheDocument();
  });

  it('labels the household counts with the ages they actually cover', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));

    renderApp('/referrals/r1');

    // An administrator corrects these two numbers, so the screen has to say what
    // they count. Bare "Adults" would read as everyone over 18, which is not
    // what sizes the parcel and not what a correction should be typed against.
    expect(await screen.findByText('Adults (>11)')).toBeInTheDocument();
    expect(screen.getByText('Children (5-11)')).toBeInTheDocument();
    expect(screen.queryByText('Adults', { exact: true })).toBeNull();
  });

  it('shows the compact household composition grid for an administrator', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            answers: { 'Household Components': { '0-4': { male: 1 } } },
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    const grid = await screen.findByRole('table', { name: 'Household composition' });
    expect(within(grid).getByText('1')).toBeInTheDocument();
    expect(within(grid).getByText('0–4, Male:', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Generated')).toBeNull();
  });

  it('prefills stored page-one answers in their editing controls', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            answers: {
              gender: 'Female',
              ethnicity: 'White -British',
              languages: 'English',
              'Household Components': { '0-4': { male: 1 }, 'working-age': { female: 1 } },
              'Collection method': 'On Foot',
            },
          }),
        ),
      ),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Edit' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Referrer and client details' }));

    expect(await screen.findByLabelText("Client's gender")).toHaveValue('Female');
    await user.clear(screen.getByLabelText('0–4, Male'));
    await user.type(screen.getByLabelText('0–4, Male'), '2');
    await user.selectOptions(
      screen.getByLabelText('How will the parcel be collected'),
      'Delivery Requested',
    );
    await user.selectOptions(
      screen.getByLabelText('Please confirm the client meets these criteria'),
      'Yes',
    );
    const surname = screen.getByLabelText(/Client.s surname/i);
    await user.clear(surname);
    await user.type(surname, 'Rowe-Smith');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(receivedBody).toMatchObject({
        refereeSurname: 'Rowe-Smith',
        // Two under-fives and one working-age adult: the operational pair the
        // grid is indexed by, so the under-fives count towards neither number.
        adults: 1,
        children: 0,
        isDelivery: true,
        answers: {
          gender: 'Female',
          ethnicity: 'White -British',
          languages: 'English',
          'Household Components': { '0-4': { male: 2 }, 'working-age': { female: 1 } },
          'Collection method': 'Delivery Requested',
          deliveryConfirm: 'Yes',
        },
      });
    });
  });

  it('edits administrator notes separately from the form answers', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', adminInfo: 'Ring after 2pm' })),
      ),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1', adminInfo: 'Use side entrance' }));
      }),
    );
    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByText('Ring after 2pm');
    await user.click(screen.getByRole('button', { name: 'Edit administrator notes' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit administrator notes' }));
    const input = dialog.getByLabelText('Administrator notes');
    await user.clear(input);
    await user.type(input, 'Use side entrance');
    await user.click(dialog.getByRole('button', { name: 'Save administrator notes' }));
    await waitFor(() => {
      expect(receivedBody).toEqual({ adminInfo: 'Use side entrance' });
    });
  });

  it('shows a known answer by its label and an unknown key still, flagged as older', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            answers: { Allergies: 'Nut allergy', legacyQuestion: 'some old answer' },
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByText('Nut allergy')).toBeInTheDocument();
    expect(screen.getByText(/cannot eat certain foods/)).toBeInTheDocument();
    expect(screen.getByText('legacyQuestion')).toBeInTheDocument();
    expect(screen.getByText('some old answer')).toBeInTheDocument();
    expect(screen.getByText('(no longer on the form)')).toBeInTheDocument();
  });

  it('edits one referral-form page and never logs the referral to the console', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let receivedBody: unknown = null;

    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', answers: { legacy: 'kept' } })),
      ),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          referral({ id: 'r1', answers: { legacy: 'kept', Other: 'Nut allergy' } }),
        );
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    // Waits for the reasons query too — the form does not render until it
    // settles, since the reason field's options come from it.
    await screen.findByRole('button', { name: 'Edit' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Anything else' }));
    const dietary = await screen.findByLabelText('Any additional information?');
    await user.type(dietary, 'Nut allergy');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(receivedBody).toMatchObject({ answers: { legacy: 'kept', Other: 'Nut allergy' } });
    });

    logSpy.mockRestore();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('edits a fixed field on its configured form page without sending referrer identity', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1', refereeSurname: 'Rowe-Smith' }));
      }),
    );
    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Edit' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Referrer and client details' }));
    expect(
      await screen.findByRole('heading', { name: 'Edit Referrer and client details' }),
    ).toBeInTheDocument();
    const surname = await screen.findByLabelText(/Client.s surname/i);
    await user.clear(surname);
    await user.type(surname, 'Rowe-Smith');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(receivedBody).toMatchObject({ refereeSurname: 'Rowe-Smith', answers: {} });
    });
    expect(receivedBody).not.toHaveProperty('referrerEmail');
  });

  it('cancels a page edit without saving it', async () => {
    let amendments = 0;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.patch(REFERRAL, () => {
        amendments += 1;
        return HttpResponse.json(referral({ id: 'r1' }));
      }),
    );
    renderApp('/referrals/r1');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Edit' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Anything else' }));
    await user.type(await screen.findByLabelText('Any additional information?'), 'Do not save');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { name: 'Referral details' })).toBeInTheDocument();
    expect(amendments).toBe(0);
  });

  it('cancels the referral through the confirm dialog', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.post(REFERRAL_CANCEL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled' })),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Cancel this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Cancel this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Cancel the referral' }));

    await waitFor(() => {
      expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    });
  });

  it('warns when moving into a full session, and still allows the move', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1', sessionId: 's2' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Move to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Move to another session?' }));
    // Waits for the sessions query itself, not just the referral — selecting
    // before the option list has loaded is a race, not a real interaction.
    await dialog.findByRole('option', { name: /Community Centre/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to move to'), 's2');

    expect(await dialog.findByText(/already has 25 of 25 places booked/)).toBeInTheDocument();

    const moveButton = dialog.getByRole('button', { name: 'Move to this session' });
    expect(moveButton).not.toHaveAttribute('disabled');
    await user.click(moveButton);

    await waitFor(() => {
      expect(receivedBody).toMatchObject({ sessionId: 's2', acknowledgeOverCapacity: true });
    });
  });

  it('moves into a session with room without any warning, and does not acknowledge over capacity', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            session({ id: 's1', location: 'Church Hall' }),
            session({ id: 's3', location: 'Spare Hall', booked: 2, capacity: 25 }),
          ],
        }),
      ),
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r1', sessionId: 's3' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Move to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Move to another session?' }));
    await dialog.findByRole('option', { name: /Spare Hall/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to move to'), 's3');
    await user.click(dialog.getByRole('button', { name: 'Move to this session' }));

    await waitFor(() => {
      expect(receivedBody).toMatchObject({ sessionId: 's3', acknowledgeOverCapacity: false });
    });
    expect(screen.queryByText(/places booked/)).toBeNull();
  });

  it('renders a purged referral as purged, with no amend form and no crash', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            refereeFirstName: null,
            refereeSurname: null,
            refereeAddress: null,
            refereePostcode: null,
            refereePhone: null,
            answers: {},
            piiPurgedAt: '2026-08-01T12:00:00.000Z',
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    // Deliberately not `findByRole('heading', { name: 'Referral' })` first —
    // the loading state's own `PageHeader` uses that exact literal title too,
    // so it would resolve on the very first render rather than proving the
    // referral actually loaded. Wait on content that only exists once it has.
    expect(await screen.findByText(/nothing here to amend/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Referral' })).toBeInTheDocument();
    expect(screen.getByText('These were removed by the retention process.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByText('undefined')).toBeNull();
    // Cancel and move travel together now, so neither is offered once the
    // details are gone — the guess recorded as Q35 in `OPEN-QUESTIONS.md`.
    expect(screen.queryByRole('button', { name: 'Move to another session' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel this referral' })).toBeNull();
  });

  it('shows the previous-referral summary without requesting household details', async () => {
    const matchesRequested = vi.fn();
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            repeatReferrals: { count: 2, mostRecentSessionDate: '2026-08-11' },
          }),
        ),
      ),
      http.get(REPEAT_REFERRALS, () => {
        matchesRequested();
        return HttpResponse.json({ count: 2, mostRecentSessionDate: '2026-08-11', matches: [] });
      }),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByRole('heading', { name: 'Previous referrals' })).toBeInTheDocument();
    expect(screen.getByText(/2 previous possible referrals/)).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element !== null &&
          element.tagName === 'P' &&
          element.textContent.includes('Most recent session: Tue, 11 Aug 2026'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show previous referrals' })).toBeInTheDocument();
    expect(matchesRequested).not.toHaveBeenCalled();
  });

  it('shows matching previous referrals only after an administrator asks', async () => {
    const excludePostcodeRequests: string[] = [];
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            repeatReferrals: { count: 2, mostRecentSessionDate: '2026-08-11' },
          }),
        ),
      ),
      http.get(REPEAT_REFERRALS, ({ request }) => {
        excludePostcodeRequests.push(
          new URL(request.url).searchParams.get('excludePostcode') ?? '',
        );
        return HttpResponse.json({
          count: 2,
          mostRecentSessionDate: '2026-08-11',
          matches: [
            {
              referralId: 'r0',
              sessionId: 's0',
              sessionDate: '2026-08-11',
              outcome: 'booked',
              matchedOn: ['date_of_birth', 'postcode', 'phone'],
              refereeFirstName: 'Jamie',
              refereeSurname: 'Rowe',
              refereeDateOfBirth: '1985-03-12',
              refereeAddress: '1 Elm Street',
              refereePostcode: 'AB1 2CD',
              refereePhone: null,
            },
            {
              referralId: 'r-older',
              sessionId: 's-older',
              sessionDate: '2026-07-04',
              outcome: 'no_show',
              matchedOn: ['postcode'],
              refereeFirstName: null,
              refereeSurname: null,
              refereeDateOfBirth: null,
              refereeAddress: null,
              refereePostcode: null,
              refereePhone: '07123 456789',
            },
          ],
        });
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('button', { name: 'Show previous referrals' });
    await user.click(screen.getByRole('button', { name: 'Show previous referrals' }));

    expect(await screen.findByText('Booked')).toBeInTheDocument();
    expect(screen.getByText('Did not attend')).toBeInTheDocument();
    expect(screen.getByText('Date of birth, Postcode, Phone number')).toBeInTheDocument();
    expect(screen.getByText('Tue, 11 Aug 2026')).toBeInTheDocument();
    expect(screen.getByText('07123 456789')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(excludePostcodeRequests).toEqual(['false']);
    await user.click(screen.getByRole('checkbox', { name: 'Exclude postcode matches' }));
    await waitFor(() => {
      expect(excludePostcodeRequests).toEqual(['false', 'true']);
    });
  });

  it('shows an honest empty previous-referrals summary without offering a detail request', async () => {
    const matchesRequested = vi.fn();
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({ id: 'r1', repeatReferrals: { count: 0, mostRecentSessionDate: null } }),
        ),
      ),
      http.get(REPEAT_REFERRALS, () => {
        matchesRequested();
        return HttpResponse.json({ count: 0, mostRecentSessionDate: null, matches: [] });
      }),
    );

    renderApp('/referrals/r1');

    expect(
      await screen.findByText('No previous referrals were found in the last twelve months.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show previous referrals' })).toBeNull();
    expect(matchesRequested).not.toHaveBeenCalled();
  });

  it('offers accept and reject only while a referral waits on its referrer', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));
    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    // A referral whose referrer is recognised has no such decision outstanding —
    // it is only waiting to be read through, which is a different pass.
    expect(screen.queryByRole('button', { name: 'Approve this referral' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject this referral' })).toBeNull();
  });

  it('approves a referral without asking for a reason', async () => {
    let body: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(referral({ id: 'r1', status: 'active' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(
      screen.getByRole('heading', {
        name: 'This referral is waiting for the referrer to be approved',
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Approve this referral?' }));
    // Approving an unrecognised referrer is the ordinary outcome: nowhere to
    // type a reason, and nothing sent.
    expect(dialog.queryByLabelText(/Reason/)).toBeNull();
    await user.click(dialog.getByRole('button', { name: 'Approve referral' }));

    await waitFor(() => {
      expect(body).toEqual({});
    });
    // The panel goes once there is nothing left to decide.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Approve this referral' })).toBeNull();
    });
  });

  it('rejects with the reason typed in the rejection dialog', async () => {
    let body: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_REJECT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(referral({ id: 'r1', status: 'rejected' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Reject this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Reject this referral?' }));
    await user.type(
      dialog.getByLabelText('Reason for rejection (optional)'),
      'Rang the school, they had not heard of them.',
    );
    await user.click(dialog.getByRole('button', { name: 'Reject referral' }));

    await waitFor(() => {
      expect(body).toEqual({ comment: 'Rang the school, they had not heard of them.' });
    });
  });

  it('rejects without a comment rather than sending an empty one', async () => {
    let body: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_REJECT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(referral({ id: 'r1', status: 'rejected' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Reject this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Reject this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Reject referral' }));

    // `''` would be a 400 on a field nobody filled in — the server's bound is
    // `minLength: 1`.
    await waitFor(() => {
      expect(body).toEqual({});
    });
  });

  it('shows the server’s message when another administrator reviewed it first', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'pending_review' }))),
      http.post(REFERRAL_ACCEPT, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'That referral is not awaiting review.',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Approve this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Approve this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Approve referral' }));

    // A 409 carries the one useful sentence; a generic apology throws it away.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That referral is not awaiting review.',
    );
  });

  it('offers the way back to the search results only when that is where it was opened from', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));

    // Reached from the referrals list: nothing to go back to.
    const { router } = renderApp('/referrals/r1');
    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(screen.queryByRole('link', { name: 'Back to search results' })).toBeNull();

    // The flag a search result link carries — a boolean, never the search
    // itself, because history is not a place a date of birth may go.
    await router.navigate('/referrals/r1', { state: { fromSearch: true } });

    expect(await screen.findByRole('link', { name: 'Back to search results' })).toHaveAttribute(
      'href',
      '/referrals/search',
    );
  });

  it('cancel and move sit together as two buttons, and moving asks which session', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel this referral' });
    const moveButton = screen.getByRole('button', { name: 'Move to another session' });
    // The same row, which is what puts them on one line.
    expect(moveButton.parentElement).toBe(cancelButton.parentElement);

    // The session list is a prompt, not something sitting open on the screen.
    expect(screen.queryByLabelText('Choose session to move to')).toBeNull();
    await user.click(moveButton);
    expect(
      within(screen.getByRole('dialog', { name: 'Move to another session?' })).getByLabelText(
        'Choose session to move to',
      ),
    ).toBeInTheDocument();
  });

  it('shows the review comment on an already-reviewed referral', async () => {
    // There is no review history, so this one line is the whole answer to "why
    // was this rejected?" six months later.
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            status: 'rejected',
            reviewComment: 'Referrer could not be reached.',
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByText('Referrer could not be reached.')).toBeInTheDocument();
  });

  it('a cancelled referral shows why its controls are refused, without hiding them', async () => {
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1', status: 'cancelled' }))),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(
      await screen.findByText(
        'This referral has been cancelled, so it can no longer be amended or moved from here.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel this referral' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('copying a referral', () => {
  it('shows the outcome and a copy button for a household that did not turn up', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'reviewed', outcome: 'no_show' })),
      ),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(screen.getByText('Outcome')).toBeInTheDocument();
    expect(screen.getByText('No Show/Not in')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy to another session' })).toBeInTheDocument();
  });

  // The server refuses both once a parcel has an outcome — "the same stopping
  // point as a move", settled 2026-08-15 — and `screenDetails.md` is explicit
  // that moving and copying "must not be offered as alternatives for the same
  // referral". An administrator mid-call who picks Move here would rewrite the
  // record of a session that has already happened instead of making a booking.
  it('does not offer cancelling or moving a household who did not turn up', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'reviewed', outcome: 'no_show' })),
      ),
    );

    renderApp('/referrals/r1');
    await screen.findByRole('heading', { name: 'Jamie Rowe' });

    expect(screen.getByRole('button', { name: 'Cancel this referral' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Move to another session' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText(/did not turn up/)).toBeInTheDocument();
  });

  it('does not offer cancelling or moving a household who already collected, and offers no copy either', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'reviewed', outcome: 'attended' })),
      ),
    );

    renderApp('/referrals/r1');
    await screen.findByRole('heading', { name: 'Jamie Rowe' });

    expect(screen.getByRole('button', { name: 'Cancel this referral' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Move to another session' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Feeding them again is an ordinary new referral, not a copy.
    expect(
      screen.queryByRole('button', { name: 'Copy to another session' }),
    ).not.toBeInTheDocument();
  });

  it('leaves cancelling and moving live for a household still to come', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'active', outcome: 'booked' })),
      ),
    );

    renderApp('/referrals/r1');
    await screen.findByRole('heading', { name: 'Jamie Rowe' });

    expect(screen.getByRole('button', { name: 'Cancel this referral' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Move to another session' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('does not offer to copy a referral still on its way to being fed — that is a move, not a copy', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'active', outcome: 'booked' })),
      ),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(screen.queryByRole('button', { name: 'Copy to another session' })).toBeNull();
  });

  it('offers a copy on a cancelled referral, without ever showing "Still booked" beside "Cancelled"', async () => {
    // The server sends outcome: "booked" on a cancelled referral (nothing
    // happened on the day) — `displayedOutcome` must not let that reach the
    // screen next to the word "Cancelled".
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
    );

    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    expect(screen.getByRole('button', { name: 'Copy to another session' })).toBeInTheDocument();
    expect(screen.queryByText('Still booked')).toBeNull();
    expect(screen.queryByText('Outcome')).toBeNull();
  });

  it('copies a referral onto the chosen session and then shows the new referral, not the original', async () => {
    let receivedBody: unknown = null;
    const copiedReferral = referral({
      id: 'r2',
      sessionId: 's1',
      status: 'reviewed',
      outcome: 'booked',
      refereeFirstName: 'Alex',
      refereeSurname: 'Carter',
      adminInfo: 'Copied from referral dated 2026-07-01',
    });
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(copiedReferral);
      }),
      http.get('/api/v1/referrals/r2', () => HttpResponse.json(copiedReferral)),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    // Unlike the move picker, the referral's own session is offered here — a
    // household who cancelled and rang back can be copied straight back onto
    // the session they cancelled from.
    await dialog.findByRole('option', { name: /Church Hall/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to copy to'), 's1');
    await user.click(dialog.getByRole('button', { name: 'Copy to this session' }));

    await waitFor(() => {
      expect(receivedBody).toEqual({ sessionId: 's1', acknowledgeOverCapacity: false });
    });

    // The screen now shows the copy, not the referral it was made from.
    expect(await screen.findByRole('heading', { name: 'Alex Carter' })).toBeInTheDocument();
    expect(screen.getByText('Copied from referral dated 2026-07-01')).toBeInTheDocument();
  });

  it('refuses to confirm with no session chosen, and sends no request', async () => {
    let posts = 0;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, () => {
        posts += 1;
        return HttpResponse.json(referral({ id: 'r2', sessionId: 's1', status: 'reviewed' }));
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Copy to this session' }));

    expect(
      await dialog.findByText('Choose a session to copy this referral to.'),
    ).toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it('warns when copying into a full session, and still allows confirming with acknowledgeOverCapacity', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(referral({ id: 'r2', sessionId: 's2', status: 'reviewed' }));
      }),
      http.get('/api/v1/referrals/r2', () =>
        HttpResponse.json(referral({ id: 'r2', sessionId: 's2', status: 'reviewed' })),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await dialog.findByRole('option', { name: /Community Centre/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to copy to'), 's2');

    expect(await dialog.findByText(/already has 25 of 25 places booked/)).toBeInTheDocument();

    const confirmButton = dialog.getByRole('button', { name: 'Copy to this session' });
    expect(confirmButton).not.toHaveAttribute('disabled');
    await user.click(confirmButton);

    await waitFor(() => {
      expect(receivedBody).toEqual({ sessionId: 's2', acknowledgeOverCapacity: true });
    });
  });

  it('shows the server’s message verbatim on a 409, not a generic apology', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'This session has been confirmed and cannot take a copy.',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await dialog.findByRole('option', { name: /Church Hall/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to copy to'), 's1');
    await user.click(dialog.getByRole('button', { name: 'Copy to this session' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'This session has been confirmed and cannot take a copy.',
    );
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });

  /**
   * The route is not idempotent and the server does not refuse a second copy
   * (`API.md`, "Guard the button against a double press") — two landed clicks
   * make two referrals, two places held and two bags packed. The button relies
   * on a synchronous `useRef`, not `aria-disabled` alone, because `disabled`
   * only takes effect on the next render and a real double tap lands both
   * clicks first. `fireEvent` fires both clicks in the same tick, and the
   * server-side request is held open until after both have landed, so this
   * would catch the guard being removed or swapped for `disabled`.
   */
  it('guards the confirm button against a double click, sending exactly one copy request', async () => {
    let posts = 0;
    let releaseResponse: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const copiedReferral = referral({ id: 'r2', sessionId: 's1', status: 'reviewed' });
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(referral({ id: 'r1', status: 'cancelled', outcome: 'booked' })),
      ),
      http.post(REFERRAL_COPY, async () => {
        posts += 1;
        await held;
        return HttpResponse.json(copiedReferral);
      }),
      http.get('/api/v1/referrals/r2', () => HttpResponse.json(copiedReferral)),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Copy to another session' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy this referral?' }));
    await dialog.findByRole('option', { name: /Church Hall/ });
    await user.selectOptions(dialog.getByLabelText('Choose session to copy to'), 's1');

    const confirmButton = dialog.getByRole('button', { name: 'Copy to this session' });
    // Both clicks dispatched inside one `act` batch, so React has not yet
    // re-rendered `ConfirmDialog`'s own `disabled={busy}` between them — the
    // same landing pattern as two real taps arriving before the browser has
    // painted the first response, which is exactly what `copying.current`
    // guards against.
    act(() => {
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
    });

    releaseResponse?.();

    await waitFor(() => {
      expect(posts).toBe(1);
    });
  });
});
