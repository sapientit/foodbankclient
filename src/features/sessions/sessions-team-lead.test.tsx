import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from './queries';

/**
 * **The team lead's shift view is a different screen, not "the admin's screen
 * with six weeks that happens to come back mostly empty".** `API.md` §2 is
 * explicit about this. What is different is not a client-computed window —
 * `sessions-screen.test.tsx` proves this client never sends `from`/`to` at
 * all, for either role — it is what the screen *offers*: no "Add a session",
 * no "Weekly sessions" link, because creating and amending sessions is not a
 * team lead's job.
 *
 * Its own file because `renderApp`'s signed-in actor is fixed per module.
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
    deliveryCapacity: 0,
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
        user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
      }),
    ),
  );
});

describe('a team lead’s shift view', () => {
  it('shows their sessions without offering to add or amend one', async () => {
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({ sessions: [session({ id: 's1', location: 'Church Hall' })] }),
      ),
    );

    renderApp('/sessions');

    expect(await screen.findByRole('heading', { name: 'Your sessions' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('link', { name: 'Add a session' })).toBeNull();
    expect(within(main).queryByRole('link', { name: 'Weekly sessions' })).toBeNull();
    expect(await within(main).findByText('10 of 25 booked')).toBeInTheDocument();
  });

  it('sends the same request an admin does, and never computes a narrower horizon of its own', async () => {
    let requestedUrl = '';
    server.use(
      http.get(SESSIONS, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ sessions: [] });
      }),
    );

    renderApp('/sessions');
    await screen.findByRole('heading', { name: 'Your sessions' });

    // See the matching test in `sessions-screen.test.tsx`: the heading renders
    // before the query fires, and `new URL('')` throws.
    await waitFor(() => {
      expect(requestedUrl).not.toBe('');
    });

    // **The same window both roles send**, not one worked out from the role. A
    // `to` past the caller's horizon is clamped by the server rather than
    // refused, so nothing here has to know that a team lead sees six days and an
    // admin six weeks — and a client that guessed and got it narrow would
    // silently hide sessions that are genuinely there.
    const url = new URL(requestedUrl);
    expect(url.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(url.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(url.searchParams.has('status')).toBe(false);
  });

  it('does not offer the Weekly sessions link in the main navigation either', async () => {
    server.use(http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })));

    renderApp('/sessions');

    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('link', { name: 'Weekly sessions' })).toBeNull();
  });
});
