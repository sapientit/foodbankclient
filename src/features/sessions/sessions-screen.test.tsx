import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from './queries';

/**
 * The admin's planning view. `sessions-team-lead.test.tsx` is the other half —
 * its own file because `renderApp`'s signed-in actor is fixed per module, the
 * same reason the users and stock role splits each get a dedicated file.
 */

const SESSIONS = '/api/v1/sessions';

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    sessionDate: '2026-08-04',
    startTime: '10:00',
    startsAtUtc: '2026-08-04T09:00:00.000Z',
    durationMinutes: 90,
    location: 'St Mary’s Hall',
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
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
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
  );
});

describe('an admin’s planning view', () => {
  it('offers Add a session and Weekly sessions, which a team lead does not get', async () => {
    server.use(http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })));

    renderApp('/sessions');

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
    // Scoped to <main>: the nav also carries a "Weekly sessions" link for an
    // admin, and this is asserting the screen's own action, not the menu.
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Add a session' })).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: 'Weekly sessions' })).toBeInTheDocument();
  });

  it('never sends from or to — the window is the token’s job, not this client’s', async () => {
    let requestedUrl = '';
    server.use(
      http.get(SESSIONS, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ sessions: [] });
      }),
    );

    renderApp('/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });

    // The heading renders before the query fires, so the request has to be
    // waited for rather than assumed: `new URL('')` throws, which surfaced as an
    // intermittent failure in the rule this test exists to protect.
    await waitFor(() => {
      expect(requestedUrl).not.toBe('');
    });

    const url = new URL(requestedUrl);
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('to')).toBe(false);
  });

  it('puts each session date on its own line, in the order the server sent them', async () => {
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            session({
              id: 's1',
              sessionDate: '2026-08-04',
              startTime: '09:00',
              location: 'Hall A',
            }),
            session({
              id: 's2',
              sessionDate: '2026-08-04',
              startTime: '11:00',
              location: 'Hall B',
            }),
            session({
              id: 's3',
              sessionDate: '2026-08-11',
              startTime: '09:00',
              location: 'Hall A',
            }),
          ],
        }),
      ),
    );

    renderApp('/sessions');

    expect(await screen.findAllByText('Tue, 4 Aug 2026')).toHaveLength(2);
    expect(screen.getByText('Tue, 11 Aug 2026')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /4 Aug 2026/ })).toBeNull();
    // Scoped to <main>: the nav is also a <ul> of <li>s.
    expect(within(screen.getByRole('main')).getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows an over-capacity session plainly, not as an error', async () => {
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({ sessions: [session({ id: 's1', booked: 27, capacity: 25 })] }),
      ),
    );

    renderApp('/sessions');

    const main = await screen.findByRole('main');
    const row = await within(main).findByRole('listitem');
    expect(within(row).getByText(/27 of 25 booked/)).toBeInTheDocument();
    expect(within(row).getByText(/over capacity/)).toBeInTheDocument();
    // Not flagged as a failure: the shared error surface never appears.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('displays startTime exactly as it arrived, unmoved by the BST changeover', async () => {
    // startsAtUtc is deliberately at a different clock time than startTime
    // would be under a naive UTC read, to prove the screen never reconstructs
    // a Date from the two and reformats it.
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            session({
              id: 's1',
              sessionDate: '2026-03-29',
              startTime: '10:00',
              startsAtUtc: '2026-03-29T09:00:00.000Z',
              durationMinutes: 60,
            }),
          ],
        }),
      ),
    );

    renderApp('/sessions');

    expect(await screen.findByRole('link', { name: '10:00–11:00' })).toBeInTheDocument();
  });

  it('filters by status through the URL', async () => {
    let lastStatus: string | null = 'unset';
    server.use(
      http.get(SESSIONS, ({ request }) => {
        lastStatus = new URL(request.url).searchParams.get('status');
        return HttpResponse.json({ sessions: [] });
      }),
    );

    renderApp('/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });

    // Waited for, not asserted outright: the heading renders before the query
    // fires, so a bare `expect` here races the request and reads the sentinel
    // instead of the captured value. The second half of this test already had
    // to wait for the same reason.
    await waitFor(() => {
      expect(lastStatus).toBeNull();
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');

    await waitFor(() => {
      expect(lastStatus).toBe('cancelled');
    });
  });
});
