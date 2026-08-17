import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  it('sends the window it is showing, and never a status — the far end is still the token’s job', async () => {
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
    // A window is sent because the server puts no lower bound on the past at
    // all, and `Show completed` would otherwise ask for every session ever run.
    expect(url.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(url.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // `status` takes one value and this screen wants two of them, so the
    // narrowing is done on the response instead.
    expect(url.searchParams.has('status')).toBe(false);
  });

  it('puts each session in its own row, in the order the server sent them', async () => {
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

    // The link is named by date and hours together, so two sessions on one day
    // are told apart by a screen reader moving between links.
    expect(await screen.findAllByRole('link', { name: /Tue, 4 Aug 2026/ })).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Tue, 11 Aug 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /4 Aug 2026/ })).toBeNull();
    // One header row plus one per session.
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
  });

  it('shows an over-capacity session plainly, not as an error', async () => {
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({ sessions: [session({ id: 's1', booked: 27, capacity: 25 })] }),
      ),
    );

    renderApp('/sessions');

    // Found by what it says rather than by its index, so this keeps testing the
    // rule if a column is ever added before it.
    const row = await screen.findByRole('row', { name: /27 of 25 booked/ });
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

    expect(await screen.findByText('10:00–11:00')).toBeInTheDocument();
  });

  it('hides a completed or cancelled session until Show completed is ticked', async () => {
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({
          sessions: [
            session({ id: 's1', sessionDate: '2026-08-04', status: 'planned' }),
            session({ id: 's2', sessionDate: '2026-08-05', status: 'confirmed' }),
            session({ id: 's3', sessionDate: '2026-08-06', status: 'cancelled' }),
          ],
        }),
      ),
    );

    renderApp('/sessions');

    expect(await screen.findByRole('link', { name: /Tue, 4 Aug 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Wed, 5 Aug 2026/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Thu, 6 Aug 2026/ })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Show completed'));

    // Both, and cancelled deliberately: dropping the status filter left this as
    // the only route to a cancelled session, and the status column tells them
    // apart.
    expect(await screen.findByRole('link', { name: /Wed, 5 Aug 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Thu, 6 Aug 2026/ })).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('narrows the window it asks for when a date is changed', async () => {
    let requestedUrl = '';
    server.use(
      http.get(SESSIONS, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ sessions: [] });
      }),
    );

    renderApp('/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });
    await waitFor(() => {
      expect(requestedUrl).not.toBe('');
    });

    // `fireEvent` rather than `userEvent.type`: a date input takes keystrokes in
    // the locale's segment order, so typing an ISO string into one lands
    // somewhere else entirely. This is what a date picker does.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-07-01' } });

    await waitFor(() => {
      expect(new URL(requestedUrl).searchParams.get('from')).toBe('2026-07-01');
    });
  });
});
