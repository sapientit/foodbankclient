import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from './queries';

const SESSIONS = '/api/v1/sessions';

function created(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    sessionDate: '2026-08-04',
    startTime: '10:00',
    startsAtUtc: '2026-08-04T09:00:00.000Z',
    durationMinutes: 90,
    location: 'St Mary’s Hall',
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    deliveriesAllowed: false,
    capacity: 25,
    booked: 0,
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

describe('adding an ad hoc session', () => {
  it('sends named fields only, defaulting capacity to 25, and never sends startsAtUtc', async () => {
    let posted: unknown = null;
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })),
      http.post(SESSIONS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(created(), { status: 201 });
      }),
    );

    renderApp('/sessions/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Date'), '2026-08-04');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');
    // Capacity keeps its default of 25 — nothing typed into it.

    await user.click(screen.getByRole('button', { name: 'Add session' }));

    await screen.findByRole('heading', { name: 'Sessions' });

    expect(posted).toEqual({
      sessionDate: '2026-08-04',
      startTime: '10:00',
      durationMinutes: 90,
      location: 'St Mary’s Hall',
      capacity: 25,
      // Deliberately the opposite of the server's own create default of
      // `true` — settled 2026-08-16 — so an untouched checkbox opts a new
      // session out of deliveries and the window pair is omitted entirely.
      deliveriesAllowed: false,
    });
    expect(posted).not.toHaveProperty('startsAtUtc');
    expect(posted).not.toHaveProperty('deliveryWindowStart');
    expect(posted).not.toHaveProperty('deliveryWindowEnd');
  });

  it('disables and un-marks the delivery times until the checkbox is ticked', async () => {
    server.use(http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })));

    renderApp('/sessions/new');
    const user = userEvent.setup();

    const start = await screen.findByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    expect(start).toBeDisabled();
    expect(end).toBeDisabled();
    expect(start).not.toBeRequired();
    expect(end).not.toBeRequired();

    await user.click(screen.getByLabelText('This session takes deliveries'));

    expect(start).toBeEnabled();
    expect(end).toBeEnabled();
    expect(start).toBeRequired();
    expect(end).toBeRequired();
  });

  it('sends the delivery window pair together once ticked on, and omits it again once ticked off', async () => {
    let posted: unknown = null;
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })),
      http.post(SESSIONS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(created(), { status: 201 });
      }),
    );

    renderApp('/sessions/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Date'), '2026-08-04');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');
    await user.click(screen.getByLabelText('This session takes deliveries'));
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');

    await user.click(screen.getByRole('button', { name: 'Add session' }));
    await screen.findByRole('heading', { name: 'Sessions' });

    expect(posted).toEqual({
      sessionDate: '2026-08-04',
      startTime: '10:00',
      durationMinutes: 90,
      location: 'St Mary’s Hall',
      capacity: 25,
      deliveryWindowStart: '09:00',
      deliveryWindowEnd: '11:00',
      deliveriesAllowed: true,
    });
  });

  it('clears the delivery times and omits the pair again when the checkbox is unticked', async () => {
    let posted: unknown = null;
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })),
      http.post(SESSIONS, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(created(), { status: 201 });
      }),
    );

    renderApp('/sessions/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Date'), '2026-08-04');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');

    const checkbox = screen.getByLabelText('This session takes deliveries');
    await user.click(checkbox);
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');
    await user.click(checkbox);

    const start = screen.getByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    expect(start).toHaveValue('');
    expect(end).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Add session' }));
    await screen.findByRole('heading', { name: 'Sessions' });

    expect(posted).not.toHaveProperty('deliveryWindowStart');
    expect(posted).not.toHaveProperty('deliveryWindowEnd');
  });

  it('refuses a ticked-on window missing its start or end, before making a request', async () => {
    const created = vi.fn();
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })),
      http.post(SESSIONS, () => {
        created();
        return new HttpResponse(null, { status: 201 });
      }),
    );

    renderApp('/sessions/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Date'), '2026-08-04');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');
    await user.click(screen.getByLabelText('This session takes deliveries'));
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');

    await user.click(screen.getByRole('button', { name: 'Add session' }));

    expect(await screen.findByText('Enter when the delivery window ends.')).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });

  it('refuses a delivery window that ends at or before it starts, before making a request', async () => {
    const created = vi.fn();
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })),
      http.post(SESSIONS, () => {
        created();
        return new HttpResponse(null, { status: 201 });
      }),
    );

    renderApp('/sessions/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Date'), '2026-08-04');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');
    await user.click(screen.getByLabelText('This session takes deliveries'));
    await user.type(screen.getByLabelText('Delivery window starts'), '11:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '09:00');

    await user.click(screen.getByRole('button', { name: 'Add session' }));

    expect(
      await screen.findByText('The delivery window must end after it starts.'),
    ).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });

  it('refuses to submit an incomplete form before making a request', async () => {
    const created = vi.fn();
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })),
      http.post(SESSIONS, () => {
        created();
        return new HttpResponse(null, { status: 201 });
      }),
    );

    renderApp('/sessions/new');
    const user = userEvent.setup();

    await screen.findByLabelText('Date');
    await user.click(screen.getByRole('button', { name: 'Add session' }));

    expect(await screen.findByText('Choose a date.')).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });
});
