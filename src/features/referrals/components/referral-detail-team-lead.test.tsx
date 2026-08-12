import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { Session } from '../../sessions/queries';
import type { Referral } from '../queries';

/**
 * The priority-four test `CLAUDE.md` names for this slice: "a team lead's
 * referral view renders with `reasonId` absent, and never displays it." Its
 * own file because `renderApp`'s signed-in actor is fixed per module — see
 * `test/render-app.tsx` — the same reason `sessions-team-lead.test.tsx` and
 * `admin-setup-screen-forbidden.test.tsx` are separate files from their admin
 * counterparts.
 *
 * `GET /referrals/{id}` is not admin-only (`API.md` §2), so this is a real
 * `200` with three keys genuinely missing from the JSON — not a `403` and not
 * `null` values — modelled here by simply never putting `reasonId`,
 * `referrerEmail` or `referrerPhone` on the fixture object at all.
 */
const REFRESH = '/api/v1/auth/refresh';
const REFERRAL = '/api/v1/referrals/r1';
const REPEAT_REFERRALS = '/api/v1/referrals/r1/repeat-referrals';
const SESSIONS = '/api/v1/sessions';
const REASONS = '/api/v1/referral-reasons';

function teamLeadReferral(overrides: Partial<Referral> & Pick<Referral, 'id'>): Referral {
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
    // Deliberately no reasonId, referrerEmail or referrerPhone key at all —
    // that is the shape a team lead actually receives, not `null`.
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

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
      }),
    ),
    http.get(SESSIONS, () => HttpResponse.json({ sessions: [session({ id: 's1' })] })),
  );
});

describe('a team lead’s referral detail view', () => {
  it('renders with reasonId, referrerEmail and referrerPhone absent, and never shows the string "undefined"', async () => {
    const reasonsRequested = vi.fn();
    const repeatReferralsRequested = vi.fn();
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(teamLeadReferral({ id: 'r1' }))),
      // Admin-only. If this is ever hit, that is a bug — the reason field
      // must not be reachable at all for a team lead, not merely refused.
      http.get(REASONS, () => {
        reasonsRequested();
        return HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'admin only', requestId: 'r1' } },
          { status: 403 },
        );
      }),
      http.get(REPEAT_REFERRALS, () => {
        repeatReferralsRequested();
        return HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'admin only', requestId: 'r1' } },
          { status: 403 },
        );
      }),
    );

    renderApp('/referrals/r1');

    expect(await screen.findByRole('heading', { name: 'Jamie Rowe' })).toBeInTheDocument();
    // The household fields a team lead does receive are still there.
    expect(screen.getByText('Riverside Church')).toBeInTheDocument();
    expect(screen.getAllByText('Jamie Rowe').length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument();

    // The three admin-only things are simply not on the page.
    expect(screen.queryByText('Referrer email')).toBeNull();
    expect(screen.queryByLabelText('Reason for referral')).toBeNull();
    expect(screen.queryByLabelText('Referrer phone (optional)')).toBeNull();

    // Never a literal "undefined" or "null" leaking onto the screen for a
    // field this client knows is absent rather than empty.
    expect(screen.queryByText('undefined')).toBeNull();
    // `reviewComment` rides the same role check as the other three: it can name
    // a referrer or record a suspicion, which is not a team lead's business.
    expect(screen.queryByText('Review comment')).toBeNull();
    expect(screen.queryByText('null', { exact: false })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Previous referrals' })).toBeNull();

    // And the admin-only lookup this field would need is never even
    // requested — see the module comment on `useReferralReasons`.
    expect(reasonsRequested).not.toHaveBeenCalled();
    expect(repeatReferralsRequested).not.toHaveBeenCalled();
  });

  it('can still amend the fields a team lead does have, and the request omits the admin-only ones', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.get(REFERRAL, () => HttpResponse.json(teamLeadReferral({ id: 'r1' }))),
      http.patch(REFERRAL, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'admin only', requestId: 'r1' } },
          { status: 403 },
        );
      }),
    );

    renderApp('/referrals/r1');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(receivedBody).not.toBeNull();
    });
    expect(receivedBody).not.toHaveProperty('reasonId');
    expect(receivedBody).not.toHaveProperty('referrerPhone');
    // The 403 reads as a plain explanation, never a crash.
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
  });
});
