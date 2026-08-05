import { screen, waitFor, within } from '@testing-library/react';
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
  it('renders the fixed fields, the reason (admin only) and the referrer email (admin only)', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));

    renderApp('/referrals/r1');

    expect(await screen.findByRole('heading', { name: 'Jamie Rowe' })).toBeInTheDocument();
    expect(screen.getByText('referrer@riverside.org')).toBeInTheDocument();
    expect(screen.getByText('Riverside Church')).toBeInTheDocument();
    expect(await screen.findByLabelText('Reason for referral')).toHaveValue('q1');
  });

  it('shows a known answer by its label and an unknown key still, flagged as older', async () => {
    server.use(
      http.get(REFERRAL, () =>
        HttpResponse.json(
          referral({
            id: 'r1',
            answers: { Dietary: 'Nut allergy', legacyQuestion: 'some old answer' },
          }),
        ),
      ),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByText('Nut allergy')).toBeInTheDocument();
    expect(screen.getByText('Please specify any dietary requirements')).toBeInTheDocument();
    expect(screen.getByText('legacyQuestion')).toBeInTheDocument();
    expect(screen.getByText('some old answer')).toBeInTheDocument();
    expect(screen.getByText('(no longer on the form)')).toBeInTheDocument();
  });

  it('amends the fixed fields and never logs the referral to the console', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
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

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    // Waits for the reasons query too — the form does not render until it
    // settles, since the reason field's options come from it.
    const nameField = await screen.findByLabelText('Surname');
    await user.clear(nameField);
    await user.type(nameField, 'Rowe-Smith');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(receivedBody).toMatchObject({ refereeSurname: 'Rowe-Smith' });
    });

    logSpy.mockRestore();
    expect(logSpy).not.toHaveBeenCalled();
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
    // Waits for the sessions query itself, not just the referral — selecting
    // before the option list has loaded is a race, not a real interaction.
    await screen.findByRole('option', { name: /Community Centre/ });
    await user.selectOptions(screen.getByLabelText('Session'), 's2');

    expect(await screen.findByText(/already has 25 of 25 places booked/)).toBeInTheDocument();

    const moveButton = screen.getByRole('button', { name: 'Move to this session' });
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
    await screen.findByRole('option', { name: /Spare Hall/ });
    await user.selectOptions(screen.getByLabelText('Session'), 's3');
    await user.click(screen.getByRole('button', { name: 'Move to this session' }));

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
    // The screen still isn't broken elsewhere: moving and cancelling remain offered.
    expect(screen.getByRole('heading', { name: 'Move to another session' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cancel this referral' })).toBeInTheDocument();
  });

  it('offers accept and reject only while a referral is awaiting review', async () => {
    server.use(http.get(REFERRAL, () => HttpResponse.json(referral({ id: 'r1' }))));
    renderApp('/referrals/r1');

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    // An active referral has nothing to review.
    expect(screen.queryByRole('button', { name: 'Accept this referral' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject this referral' })).toBeNull();
  });

  it('accepts a referral awaiting review, sending the one-line comment', async () => {
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
    expect(screen.getByText(/This referral is awaiting review/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Comment (optional)'), 'Rang the school, they are real.');
    await user.click(screen.getByRole('button', { name: 'Accept this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Accept this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Accept referral' }));

    await waitFor(() => {
      expect(body).toEqual({ comment: 'Rang the school, they are real.' });
    });
    // The panel goes once there is nothing left to decide.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Accept this referral' })).toBeNull();
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
    await user.click(screen.getByRole('button', { name: 'Accept this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Accept this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Accept referral' }));

    // A 409 carries the one useful sentence; a generic apology throws it away.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That referral is not awaiting review.',
    );
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
