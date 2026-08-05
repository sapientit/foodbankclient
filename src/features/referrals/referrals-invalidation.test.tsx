import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from '../sessions/queries';
import type { Referral } from './queries';

/**
 * **Why `useAmendReferral`/`useCancelReferral` invalidate `sessionKeys`, not
 * just their own `referralKeys`.** `Session.booked` is derived from exactly
 * the referrals this feature mutates — cancelling one frees a place — so a
 * session detail screen already open elsewhere would show a stale count
 * without this.
 *
 * This test builds its own query client with the app's real `staleTime`
 * rather than `renderApp`'s default of zero — the same reasoning
 * `stock-invalidation.test.tsx` and `model-parcels-invalidation.test.tsx`
 * give: under `staleTime: 0`, a second mount refetches regardless of whether
 * anything was invalidated, which would make this assertion pass whether or
 * not the cross-feature invalidation actually happened.
 */
const REFRESH = '/api/v1/auth/refresh';
const SESSIONS = '/api/v1/sessions';
const SESSION = '/api/v1/sessions/s1';
const REFERRAL = '/api/v1/referrals/r1';
const REFERRAL_CANCEL = '/api/v1/referrals/r1/cancel';
const REASONS = '/api/v1/referral-reasons';

let booked = 10;

function sessionRow(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    sessionDate: '2026-08-04',
    startTime: '10:00',
    startsAtUtc: '2026-08-04T09:00:00.000Z',
    durationMinutes: 90,
    location: 'St Mary’s Hall',
    capacity: 25,
    booked,
    status: 'planned',
    cancelledReason: null,
    isCustomised: false,
    recurringSessionId: null,
    occurrenceDate: null,
    ...overrides,
  };
}

function referralRow(overrides: Partial<Referral> & Pick<Referral, 'id'>): Referral {
  return {
    sessionId: 's1',
    status: 'active',
    referredAt: '2026-07-01T10:00:00.000Z',
    adults: 1,
    children: 0,
    householdSize: 1,
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
    ...overrides,
  };
}

function cachingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60_000 },
      mutations: { retry: false },
    },
  });
}

beforeEach(() => {
  booked = 10;
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get(SESSIONS, () => HttpResponse.json({ sessions: [sessionRow({ id: 's1' })] })),
    http.get(SESSION, () => HttpResponse.json(sessionRow({ id: 's1' }))),
    http.get(REASONS, () => HttpResponse.json({ referralReasons: [] })),
  );
});

describe('cancelling a referral and the sessions cache', () => {
  it('leaves the session’s own detail screen showing the fresh booked count, not the stale one', async () => {
    const client = cachingClient();

    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referralRow({ id: 'r1' }))),
      http.post(REFERRAL_CANCEL, () => {
        booked = 9;
        return HttpResponse.json(referralRow({ id: 'r1', status: 'cancelled' }));
      }),
    );

    renderApp('/sessions/s1', client);
    expect(await screen.findByText('10 of 25 booked')).toBeInTheDocument();
    cleanup();

    renderApp('/referrals/r1', client);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await user.click(screen.getByRole('button', { name: 'Cancel this referral' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Cancel this referral?' }));
    await user.click(dialog.getByRole('button', { name: 'Cancel the referral' }));

    await waitFor(() => {
      expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    });
    cleanup();

    // Same client, a fresh mount: without the cross-feature invalidation this
    // would still answer from the cache holding the pre-cancel count of 10.
    renderApp('/sessions/s1', client);
    expect(await screen.findByText('9 of 25 booked')).toBeInTheDocument();
  });
});

describe('moving a referral away and the session it left', () => {
  it('invalidates the previous session’s detail cache via previousSessionId, not just the new one', async () => {
    const client = cachingClient();
    const SESSION_S2 = '/api/v1/sessions/s2';

    server.use(
      http.get(REFERRAL, () => HttpResponse.json(referralRow({ id: 'r1' }))),
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            sessionRow({ id: 's1' }),
            sessionRow({ id: 's2', booked: 2, location: 'Spare Hall' }),
          ],
        }),
      ),
      http.get(SESSION_S2, () =>
        HttpResponse.json(sessionRow({ id: 's2', booked: 2, location: 'Spare Hall' })),
      ),
      http.patch(REFERRAL, () => {
        booked = 9;
        return HttpResponse.json(referralRow({ id: 'r1', sessionId: 's2' }));
      }),
    );

    // Populate the old session's own cache entry first, the same way an
    // admin who had it open in another tab would.
    renderApp('/sessions/s1', client);
    expect(await screen.findByText('10 of 25 booked')).toBeInTheDocument();
    cleanup();

    renderApp('/referrals/r1', client);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Jamie Rowe' });
    await screen.findByRole('option', { name: /Spare Hall/ });
    await user.selectOptions(screen.getByLabelText('Session'), 's2');
    await user.click(screen.getByRole('button', { name: 'Move to this session' }));

    // The static "Session" line only shows Spare Hall once `referral.sessionId`
    // has actually become `s2` — proof the move round-tripped, not just that
    // the button was clicked.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Spare Hall/ })).toBeInTheDocument();
    });
    cleanup();

    // Without `previousSessionId`, this would still read 10 from the cache
    // populated at the start of the test.
    renderApp('/sessions/s1', client);
    expect(await screen.findByText('9 of 25 booked')).toBeInTheDocument();
  });
});
