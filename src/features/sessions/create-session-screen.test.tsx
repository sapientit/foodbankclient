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
    deliveryCapacity: 0,
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

/**
 * The delivery capacity is a number box now rather than a tick, so a test that
 * wants a delivering session has to say how many — and one that wants none
 * says nought rather than leaving the box alone.
 */
async function setDeliveryCapacity(user: ReturnType<typeof userEvent.setup>, places: string) {
  const box = screen.getByLabelText('Delivery capacity');
  await user.clear(box);
  await user.type(box, places);
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
      // Nought — settled 2026-08-16 — so an untouched box opts a new session
      // out of deliveries and the window pair is omitted entirely. A driver is
      // the exception rather than the assumption.
      deliveryCapacity: 0,
    });
    expect(posted).not.toHaveProperty('startsAtUtc');
    expect(posted).not.toHaveProperty('deliveryWindowStart');
    expect(posted).not.toHaveProperty('deliveryWindowEnd');
  });

  it('disables and un-marks the delivery times until the delivery capacity is above nought', async () => {
    server.use(http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })));

    renderApp('/sessions/new');
    const user = userEvent.setup();

    const start = await screen.findByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    expect(start).toBeDisabled();
    expect(end).toBeDisabled();
    expect(start).not.toBeRequired();
    expect(end).not.toBeRequired();

    await setDeliveryCapacity(user, '8');

    expect(start).toBeEnabled();
    expect(end).toBeEnabled();
    expect(start).toBeRequired();
    expect(end).toBeRequired();
  });

  it('sends the delivery window pair together once the session delivers', async () => {
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
    await setDeliveryCapacity(user, '8');
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
      // A share of the capacity above, not a flag beside it.
      deliveryCapacity: 8,
    });
  });

  it('clears the delivery times and omits the pair again when the capacity returns to nought', async () => {
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

    await setDeliveryCapacity(user, '8');
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');
    // Back to nought: the window is cleared the instant it is, never left
    // stale for a later submit to paper over.
    await setDeliveryCapacity(user, '0');

    const start = screen.getByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    expect(start).toHaveValue('');
    expect(end).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Add session' }));
    await screen.findByRole('heading', { name: 'Sessions' });

    expect(posted).not.toHaveProperty('deliveryWindowStart');
    expect(posted).not.toHaveProperty('deliveryWindowEnd');
  });

  it('refuses a delivering session’s window missing its start or end, before making a request', async () => {
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
    await setDeliveryCapacity(user, '8');
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
    await setDeliveryCapacity(user, '8');
    await user.type(screen.getByLabelText('Delivery window starts'), '11:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '09:00');

    await user.click(screen.getByRole('button', { name: 'Add session' }));

    expect(
      await screen.findByText('The delivery window must end after it starts.'),
    ).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });

  it('refuses more delivery places than the session has places, before making a request', async () => {
    // The session's delivery places are a share of its capacity, never a
    // second figure beside it. The server refuses this too — a `400` here and
    // a `422` on the amend screen — but a page-level notice beside two boxes
    // that both look fine is not an answer anybody can act on.
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
    const capacity = screen.getByLabelText('Capacity');
    await user.clear(capacity);
    await user.type(capacity, '25');
    await setDeliveryCapacity(user, '26');
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');

    await user.click(screen.getByRole('button', { name: 'Add session' }));

    expect(
      await screen.findByText('A session cannot have more delivery places than places.'),
    ).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });

  it('lets every place on the session be a delivery', async () => {
    // The two numbers are independent except for that one bound, so a session
    // may be entirely deliveries — a refusal at the boundary would be the
    // off-by-one nobody notices until an administrator cannot save.
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
    await setDeliveryCapacity(user, '25');
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');

    await user.click(screen.getByRole('button', { name: 'Add session' }));
    await screen.findByRole('heading', { name: 'Sessions' });

    expect(posted).toMatchObject({ capacity: 25, deliveryCapacity: 25 });
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
