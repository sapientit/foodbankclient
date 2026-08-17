import { cleanup, screen } from '@testing-library/react';
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
      // Fetched with no window and left untouched — both keys are still sent
      // explicitly, because this form saves every field on every submit.
      deliveryWindowStart: null,
      deliveryWindowEnd: null,
      deliveriesAllowed: false,
    });
    expect(posted).not.toHaveProperty('startsAtUtc');
  });

  it('reads a both-null stored window as delivering across the session’s own hours, never as a gap', async () => {
    server.use(
      http.get(SESSION_URL, () => HttpResponse.json(session({ deliveriesAllowed: true }))),
    );

    renderApp('/sessions/s1');

    expect(
      await screen.findByText('Deliveries go out across the session’s own hours.'),
    ).toBeInTheDocument();
  });

  it('states a set delivery window, and that a session with none takes no deliveries', async () => {
    server.use(
      http.get(SESSION_URL, () =>
        HttpResponse.json(
          session({
            deliveryWindowStart: '09:00',
            deliveryWindowEnd: '11:00',
            deliveriesAllowed: true,
          }),
        ),
      ),
    );

    renderApp('/sessions/s1');

    expect(await screen.findByText('09:00–11:00')).toBeInTheDocument();
  });

  it('disables and un-marks the delivery times until the checkbox is ticked', async () => {
    server.use(http.get(SESSION_URL, () => HttpResponse.json(session())));

    renderApp('/sessions/s1');

    const start = await screen.findByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    expect(start).toBeDisabled();
    expect(end).toBeDisabled();
    expect(start).not.toBeRequired();
    expect(end).not.toBeRequired();
  });

  it('sets a delivery window on amend, once the checkbox is ticked', async () => {
    let posted: unknown = null;
    server.use(
      http.get(SESSION_URL, () => HttpResponse.json(session())),
      http.patch(SESSION_URL, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          session({ deliveryWindowStart: '09:00', deliveryWindowEnd: '11:00' }),
        );
      }),
    );

    renderApp('/sessions/s1');
    const user = userEvent.setup();

    await screen.findByDisplayValue('St Mary’s Hall');
    await user.click(screen.getByLabelText('This session takes deliveries'));
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Sessions' });

    expect(posted).toMatchObject({
      deliveryWindowStart: '09:00',
      deliveryWindowEnd: '11:00',
      deliveriesAllowed: true,
    });
  });

  it('clears an existing delivery window by sending explicit null on both keys when the checkbox is unticked', async () => {
    let posted: unknown = null;
    server.use(
      http.get(SESSION_URL, () =>
        HttpResponse.json(
          session({
            deliveryWindowStart: '09:00',
            deliveryWindowEnd: '11:00',
            deliveriesAllowed: true,
          }),
        ),
      ),
      http.patch(SESSION_URL, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(session());
      }),
    );

    renderApp('/sessions/s1');
    const user = userEvent.setup();

    await screen.findByDisplayValue('09:00');
    await user.click(screen.getByLabelText('This session takes deliveries'));

    const start = screen.getByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    expect(start).toBeDisabled();
    expect(start).toHaveValue('');
    expect(end).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Sessions' });

    expect(posted).toMatchObject({ deliveryWindowStart: null, deliveryWindowEnd: null });
  });

  /**
   * The way back to the scheduled sessions, from every state this screen has.
   * The error state matters most: a session that no longer exists leaves an
   * administrator on a page with nothing on it, and "Cancel" beside the Save
   * button is not a way out — it reads as abandoning an edit, and it is not
   * rendered at all when the session failed to load.
   */
  it('offers a way back to the sessions list, including when the session will not load', async () => {
    server.use(http.get(SESSION_URL, () => HttpResponse.json(session())));
    renderApp('/sessions/s1');

    // Waited for on the loaded screen, not on the link: the link is on the
    // loading header too, so awaiting it would resolve before the session had
    // arrived and prove nothing about either state below.
    await screen.findByDisplayValue('St Mary’s Hall');
    expect(screen.getByRole('link', { name: 'Back to sessions' })).toHaveAttribute(
      'href',
      '/sessions',
    );
    cleanup();

    server.use(
      http.get(SESSION_URL, () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'No such session.', requestId: 'r1' } },
          { status: 404 },
        ),
      ),
    );
    renderApp('/sessions/s1');

    // Same again: wait until the failure is actually on screen, then check the
    // way out is still there. This is the state it matters most in. `ErrorNotice`
    // writes its own sentence for a 404 rather than showing the server's.
    expect(await screen.findByRole('alert')).toHaveTextContent('That no longer exists');
    expect(screen.getByRole('link', { name: 'Back to sessions' })).toHaveAttribute(
      'href',
      '/sessions',
    );
  });

  /**
   * The two inputs are required together and disabled together, and the rule
   * that says so sits under the first of them. Somebody who tabs straight to
   * the second — or lands there from a screen reader's field list — would
   * otherwise meet a bare box with no hint of why it is greyed out or why it
   * later refuses to save on its own.
   */
  it('tells both delivery inputs that they are a pair, not two independent fields', async () => {
    server.use(http.get(SESSION_URL, () => HttpResponse.json(session())));

    renderApp('/sessions/s1');

    const guidance =
      'Both times are required while this session takes deliveries, and are disabled and cleared while it does not.';
    const start = await screen.findByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    // The checkbox too. This session takes no deliveries, so both inputs are
    // disabled — skipped by the tab order and by a screen reader's field list —
    // and the checkbox is the only place left to learn what ticking it turns
    // on. Without this, the guidance exists on a control nobody can reach.
    const checkbox = screen.getByLabelText('This session takes deliveries');
    expect(start).toBeDisabled();

    for (const control of [checkbox, start, end]) {
      const described = (control.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent)
        .join(' ');
      expect(described).toContain(guidance);
    }
  });

  it('refuses a ticked-on window missing its start or end, before making a request', async () => {
    const patched = vi.fn();
    server.use(
      http.get(SESSION_URL, () => HttpResponse.json(session())),
      http.patch(SESSION_URL, () => {
        patched();
        return HttpResponse.json(session());
      }),
    );

    renderApp('/sessions/s1');
    const user = userEvent.setup();

    await screen.findByDisplayValue('St Mary’s Hall');
    await user.click(screen.getByLabelText('This session takes deliveries'));
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Enter when the delivery window ends.')).toBeInTheDocument();
    expect(patched).not.toHaveBeenCalled();
  });

  it('toggles deliveriesAllowed and round-trips it and its now-required window in the save', async () => {
    let posted: unknown = null;
    server.use(
      http.get(SESSION_URL, () => HttpResponse.json(session({ deliveriesAllowed: false }))),
      http.patch(SESSION_URL, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          session({
            deliveriesAllowed: true,
            deliveryWindowStart: '09:00',
            deliveryWindowEnd: '11:00',
          }),
        );
      }),
    );

    renderApp('/sessions/s1');
    const user = userEvent.setup();

    await screen.findByDisplayValue('St Mary’s Hall');
    await user.click(screen.getByLabelText('This session takes deliveries'));
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Sessions' });

    expect(posted).toMatchObject({
      deliveriesAllowed: true,
      deliveryWindowStart: '09:00',
      deliveryWindowEnd: '11:00',
    });
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
