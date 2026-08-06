import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { Session } from '../../sessions/queries';
import type { Referral } from '../queries';

/** Signed in as Pete, an administrator. See `test/render-app.tsx`. */
const REFRESH = '/api/v1/auth/refresh';
const REFERRALS = '/api/v1/referrals';
const SESSIONS = '/api/v1/sessions';

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
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get(SESSIONS, () => HttpResponse.json({ sessions: [session({ id: 's1' })] })),
  );
});

describe('the referrals list', () => {
  it('lists a referral with its household size, organisation and status', async () => {
    server.use(
      http.get(REFERRALS, () => HttpResponse.json({ referrals: [referral({ id: 'r1' })] })),
    );

    renderApp('/referrals');

    expect(await screen.findByRole('rowheader', { name: 'Rowe, Jamie' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Rowe, Jamie/ });
    expect(row).toHaveTextContent('2 adults, 1 child');
    expect(row).toHaveTextContent('Riverside Church');
    expect(row).toHaveTextContent('Active');
  });

  it('shows a purged referral as removed, never as a blank or "undefined"', async () => {
    server.use(
      http.get(REFERRALS, () =>
        HttpResponse.json({
          referrals: [
            referral({
              id: 'r1',
              refereeFirstName: null,
              refereeSurname: null,
              refereeAddress: null,
              refereePostcode: null,
              refereePhone: null,
              piiPurgedAt: '2026-08-01T00:00:00.000Z',
            }),
          ],
        }),
      ),
    );

    renderApp('/referrals');

    expect(await screen.findByRole('rowheader', { name: 'Details removed' })).toBeInTheDocument();
    expect(screen.queryByText('undefined')).toBeNull();
    expect(screen.queryByText('null')).toBeNull();
  });

  it('shows an empty state when nothing matches', async () => {
    server.use(http.get(REFERRALS, () => HttpResponse.json({ referrals: [] })));

    renderApp('/referrals');

    expect(await screen.findByText('No referrals to show')).toBeInTheDocument();
  });

  it('filters by status, and sends only ids and the status enum in the request — never a name or address', async () => {
    let requestedUrl = '';
    server.use(
      http.get(REFERRALS, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ referrals: [referral({ id: 'r1' })] });
      }),
    );

    renderApp('/referrals');
    const user = userEvent.setup();

    await screen.findByRole('rowheader', { name: 'Rowe, Jamie' });
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');

    await waitFor(() => {
      expect(new URL(requestedUrl).searchParams.get('status')).toBe('cancelled');
    });

    const url = new URL(requestedUrl);
    // Every key the server actually saw is an id or the status enum — nothing
    // that could be a referee's name, address or phone.
    for (const key of url.searchParams.keys()) {
      expect(['sessionId', 'status']).toContain(key);
    }
  });

  it('filters by session id from the session dropdown', async () => {
    let requestedUrl = '';
    server.use(
      http.get(REFERRALS, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ referrals: [] });
      }),
    );

    renderApp('/referrals');
    const user = userEvent.setup();

    await screen.findByText('No referrals to show');
    await user.selectOptions(screen.getByLabelText('Session'), 's1');

    await waitFor(() => {
      expect(new URL(requestedUrl).searchParams.get('sessionId')).toBe('s1');
    });
  });
});
