import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from './queries';

const SESSION_URL = '/api/v1/sessions/s1';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
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

describe('the session detail screen', () => {
  it('prefills the form from the fetched session and never sends startsAtUtc when saving', async () => {
    let posted: unknown = null;
    server.use(
      http.get(SESSION_URL, () => HttpResponse.json(session())),
      http.patch(SESSION_URL, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(session({ location: 'New hall' }));
      }),
    );

    renderApp('/sessions/s1');
    const user = userEvent.setup();

    expect(await screen.findByDisplayValue('St Mary’s Hall')).toBeInTheDocument();
    expect(screen.getByDisplayValue('90')).toBeInTheDocument();
    expect(screen.getByDisplayValue('25')).toBeInTheDocument();

    const locationInput = screen.getByLabelText('Location');
    await user.clear(locationInput);
    await user.type(locationInput, 'New hall');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Sessions' });

    expect(posted).toEqual({
      sessionDate: '2026-08-04',
      startTime: '10:00',
      durationMinutes: 90,
      location: 'New hall',
      capacity: 25,
    });
    expect(posted).not.toHaveProperty('startsAtUtc');
  });

  it('shows the occupancy, including over capacity, without treating it as an error', async () => {
    server.use(
      http.get(SESSION_URL, () => HttpResponse.json(session({ booked: 27, capacity: 25 }))),
    );

    renderApp('/sessions/s1');

    expect(await screen.findByText(/27 of 25 booked/)).toBeInTheDocument();
    expect(screen.getByText(/over capacity/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('predicts that a confirmed session cannot be changed, and disables Save with a reason', async () => {
    const patched = vi.fn();
    server.use(
      http.get(SESSION_URL, () => HttpResponse.json(session({ status: 'confirmed' }))),
      http.patch(SESSION_URL, () => {
        patched();
        return HttpResponse.json(session());
      }),
    );

    renderApp('/sessions/s1');
    const user = userEvent.setup();

    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/confirmed and closed/)).toBeInTheDocument();

    await user.click(save);
    expect(patched).not.toHaveBeenCalled();
  });

  it('shows the server’s 409 verbatim for a refusal it did not predict', async () => {
    // Fetched as planned — nothing here predicts a lock — but the server says
    // otherwise, because somebody else confirmed it a moment ago.
    server.use(
      http.get(SESSION_URL, () => HttpResponse.json(session({ status: 'planned' }))),
      http.patch(SESSION_URL, () =>
        HttpResponse.json(
          {
            error: { code: 'CONFLICT', message: 'The session has been confirmed', requestId: 'r1' },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp('/sessions/s1');
    const user = userEvent.setup();

    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(save);

    expect(await screen.findByRole('alert')).toHaveTextContent('The session has been confirmed');
  });

  it('cancels the session with an optional reason', async () => {
    let posted: unknown = null;
    server.use(
      http.get(SESSION_URL, () => HttpResponse.json(session())),
      http.post(`${SESSION_URL}/cancel`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(session({ status: 'cancelled', cancelledReason: 'Flooding' }));
      }),
    );

    renderApp('/sessions/s1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Cancel this session' }));
    await user.type(await screen.findByLabelText('Reason (optional)'), 'Flooding');
    await user.click(screen.getByRole('button', { name: 'Cancel the session' }));

    expect(await screen.findByText('Flooding')).toBeInTheDocument();
    expect(posted).toEqual({ reason: 'Flooding' });
  });

  it('shows that the session no longer exists rather than crashing on a stale link', async () => {
    server.use(
      http.get(SESSION_URL, () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Session not found', requestId: 'r1' } },
          { status: 404 },
        ),
      ),
    );

    renderApp('/sessions/s1');

    expect(await screen.findByRole('alert')).toHaveTextContent('That no longer exists');
  });
});
