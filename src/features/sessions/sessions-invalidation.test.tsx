import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from './queries';

/**
 * Amending or cancelling a session has to be visible back on the list without
 * a manual refresh — a team lead planning around "which sessions still have
 * room" reading a stale row is exactly the failure a missed invalidation
 * produces.
 *
 * These build a query client with the app's real `staleTime` rather than
 * taking `renderApp`'s default of zero: under `staleTime: 0` every remount
 * refetches regardless, and the assertion would pass whether or not the
 * mutation invalidated anything. Same reasoning as
 * `src/features/stock/stock-invalidation.test.tsx`.
 */

const SESSIONS = '/api/v1/sessions';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    sessionDate: '2026-08-04',
    startTime: '10:00',
    startsAtUtc: '2026-08-04T09:00:00.000Z',
    durationMinutes: 90,
    location: 'Old hall',
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

function cachingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60_000 },
      mutations: { retry: false },
    },
  });
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

describe('the sessions list', () => {
  it('reflects an amendment made on the detail screen', async () => {
    let current = session();
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions: [current] })),
      http.get(`${SESSIONS}/s1`, () => HttpResponse.json(current)),
      http.patch(`${SESSIONS}/s1`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        current = { ...current, location: String(body.location) };
        return HttpResponse.json(current);
      }),
    );

    const { router } = renderApp('/sessions', cachingClient());
    const user = userEvent.setup();

    expect(await screen.findByText('Old hall')).toBeInTheDocument();

    await router.navigate('/sessions/s1');
    const locationInput = await screen.findByDisplayValue('Old hall');
    await user.clear(locationInput);
    await user.type(locationInput, 'New hall');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Sessions' });

    // The cache is fresh for another minute, so this can only change if the
    // amend mutation invalidated the list query.
    await waitFor(() => {
      expect(screen.getByText('New hall')).toBeInTheDocument();
    });
  });

  /*
   * The point of the whole feature: an admin adds a weekly template, generates,
   * and expects sessions to be there. Under `renderApp`'s default `staleTime` of
   * zero the navigation back would refetch on its own and this would pass with
   * no invalidation at all, so it uses the caching client like its neighbours.
   */
  it('shows sessions the materialisation job has just generated', async () => {
    let sessions: Session[] = [];
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions })),
      http.get('/api/v1/recurring-sessions', () =>
        HttpResponse.json({
          recurringSessions: [
            {
              id: 't1',
              name: 'Tuesday session',
              weekday: 2,
              startTime: '10:00',
              durationMinutes: 90,
              location: 'St Mary’s Hall',
              capacity: 25,
              activeFrom: '2026-01-01',
              activeUntil: null,
            },
          ],
        }),
      ),
      http.post('/api/v1/jobs/session-materialisation/run', () => {
        sessions = [session({ location: 'Generated hall' })];
        return HttpResponse.json({ sessionsCreated: 1 });
      }),
    );

    const { router } = renderApp('/sessions', cachingClient());
    const user = userEvent.setup();

    expect(await screen.findByText('No sessions to show')).toBeInTheDocument();

    await router.navigate('/sessions/recurring');
    await user.click(await screen.findByRole('button', { name: 'Generate sessions now' }));
    await screen.findByText('Created 1 session from the weekly templates.');

    await router.navigate('/sessions');

    await waitFor(() => {
      expect(screen.getByText('Generated hall')).toBeInTheDocument();
    });
  });

  it('reflects a cancellation made on the detail screen', async () => {
    let current = session();
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions: [current] })),
      http.get(`${SESSIONS}/s1`, () => HttpResponse.json(current)),
      http.post(`${SESSIONS}/s1/cancel`, () => {
        current = { ...current, status: 'cancelled', cancelledReason: null };
        return HttpResponse.json(current);
      }),
    );

    const { router } = renderApp('/sessions', cachingClient());
    const user = userEvent.setup();

    expect(await screen.findByText('Planned')).toBeInTheDocument();

    await router.navigate('/sessions/s1');
    await user.click(await screen.findByRole('button', { name: 'Cancel this session' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel the session' }));

    await screen.findByText('Cancelled', { selector: 'dd' });

    await router.navigate('/sessions');

    await waitFor(() => {
      expect(screen.getByText('Cancelled')).toBeInTheDocument();
    });
  });
});
