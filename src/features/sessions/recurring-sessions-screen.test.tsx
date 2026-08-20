import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { RecurringSession } from './queries';

const RECURRING = '/api/v1/recurring-sessions';

function template(
  overrides: Partial<RecurringSession> & Pick<RecurringSession, 'id'>,
): RecurringSession {
  return {
    name: 'Tuesday session',
    weekday: 2,
    startTime: '10:00',
    durationMinutes: 90,
    location: 'St Mary’s Hall',
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    deliveryCapacity: 0,
    capacity: 25,
    activeFrom: '2026-01-01',
    activeUntil: null,
    ...overrides,
  };
}

/**
 * The delivery capacity is a number box now rather than a tick, so a test that
 * wants delivering occurrences has to say how many — and one that wants none
 * says nought rather than unticking.
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

describe('the weekly session list', () => {
  /**
   * A weekly session is a template for the scheduled sessions rather than one
   * of them, so somebody who came here to check a template needs the way back
   * to the list it feeds without going out to the menu to find it.
   */
  it('offers a way back to the scheduled sessions alongside adding a template', async () => {
    server.use(http.get(RECURRING, () => HttpResponse.json({ recurringSessions: [] })));

    renderApp('/sessions/recurring');

    // Waited for on the screen's own action rather than on the back link: the
    // back link is on the loading header too, so awaiting it would resolve
    // before the list had arrived and assert nothing about this screen.
    expect(await screen.findByRole('link', { name: 'Add a weekly session' })).toHaveAttribute(
      'href',
      '/sessions/recurring/new',
    );
    expect(screen.getByRole('link', { name: 'Back to sessions' })).toHaveAttribute(
      'href',
      '/sessions',
    );
  });

  it('orders templates by weekday then start time, not by the order the server sent them', async () => {
    server.use(
      http.get(RECURRING, () =>
        HttpResponse.json({
          recurringSessions: [
            template({ id: 't1', name: 'Thursday club', weekday: 4, startTime: '10:00' }),
            template({ id: 't2', name: 'Monday late shift', weekday: 1, startTime: '14:00' }),
            template({ id: 't3', name: 'Monday early shift', weekday: 1, startTime: '09:00' }),
          ],
        }),
      ),
    );

    renderApp('/sessions/recurring');

    const rows = await screen.findAllByRole('row');
    // rows[0] is the header row.
    expect(within(rows[1]!).getByText('Monday early shift')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Monday late shift')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Thursday club')).toBeInTheDocument();
  });

  it('shows an open-ended template without an end date', async () => {
    server.use(
      http.get(RECURRING, () =>
        HttpResponse.json({ recurringSessions: [template({ id: 't1', activeUntil: null })] }),
      ),
    );

    renderApp('/sessions/recurring');

    const row = await screen.findByRole('row', { name: /Tuesday session/ });
    expect(row).toHaveTextContent('From Thu, 1 Jan 2026');
    expect(row).not.toHaveTextContent(/From.*to/);
  });

  it('reads a both-null stored window as delivering across the session’s own hours, never as a gap', async () => {
    server.use(
      http.get(RECURRING, () =>
        HttpResponse.json({
          recurringSessions: [
            template({
              id: 't1',
              deliveryWindowStart: null,
              deliveryWindowEnd: null,
              deliveryCapacity: 8,
            }),
          ],
        }),
      ),
    );

    renderApp('/sessions/recurring');

    const row = await screen.findByRole('row', { name: /Tuesday session/ });
    expect(row).toHaveTextContent('Deliveries go out across the session’s own hours.');
  });

  it('states a set delivery window, and that a template with none takes no deliveries', async () => {
    server.use(
      http.get(RECURRING, () =>
        HttpResponse.json({
          recurringSessions: [
            template({ id: 't1', name: 'Delivers', deliveryCapacity: 0 }),
            template({
              id: 't2',
              name: 'Windowed',
              weekday: 3,
              deliveryWindowStart: '09:00',
              deliveryWindowEnd: '11:00',
              deliveryCapacity: 8,
            }),
          ],
        }),
      ),
    );

    renderApp('/sessions/recurring');

    expect(await screen.findByRole('row', { name: /Delivers/ })).toHaveTextContent(
      'This session does not take deliveries.',
    );
    expect(screen.getByRole('row', { name: /Windowed/ })).toHaveTextContent('09:00–11:00');
  });
});

describe('generating sessions from the templates', () => {
  const JOB = '/api/v1/jobs/session-materialisation/run';

  async function pressGenerate() {
    renderApp('/sessions/recurring');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Generate sessions now' }));
  }

  beforeEach(() => {
    server.use(
      http.get(RECURRING, () => HttpResponse.json({ recurringSessions: [template({ id: 't1' })] })),
    );
  });

  it('reports how many sessions were created', async () => {
    server.use(
      http.post(JOB, () =>
        HttpResponse.json({
          from: '2026-08-01',
          to: '2026-09-12',
          templatesConsidered: 1,
          occurrencesPlanned: 6,
          sessionsCreated: 6,
        }),
      ),
    );

    await pressGenerate();

    expect(
      await screen.findByText('Created 6 sessions from the weekly templates.'),
    ).toBeInTheDocument();
  });

  it('reads a zero count as already up to date rather than as a failure', async () => {
    server.use(http.post(JOB, () => HttpResponse.json({ sessionsCreated: 0 })));

    await pressGenerate();

    expect(
      await screen.findByText(
        'No new sessions — every session up to six weeks ahead already existed.',
      ),
    ).toBeInTheDocument();
  });

  // `openapi.yaml` marks no field on the job report as required, so a count can
  // be absent. Defaulting it to zero would state "no new sessions" on a response
  // that never said so.
  it('claims no count when the server did not send one', async () => {
    server.use(http.post(JOB, () => HttpResponse.json({ templatesConsidered: 1 })));

    await pressGenerate();

    expect(
      await screen.findByText('Sessions generated from the weekly templates.'),
    ).toBeInTheDocument();
  });

  // The route is not role-guarded, so a team lead who reaches this screen makes
  // the real request and gets a real 403. It must explain itself rather than
  // crash — and `ErrorNotice` deliberately renders its own sentence for a 403
  // instead of the server's, because the server's `code` and message tell a
  // volunteer nothing useful about a link they should not have been shown.
  it('explains the refusal when the account may not run the job', async () => {
    server.use(
      http.post(JOB, () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Admins only', requestId: 'r1' } },
          { status: 403 },
        ),
      ),
    );

    await pressGenerate();

    expect(await screen.findByText('You do not have access to this')).toBeInTheDocument();
    // The failure must not be reported as success.
    expect(screen.queryByText(/^Created /)).not.toBeInTheDocument();
  });
});

describe('adding a weekly session', () => {
  it('sends the day as a number and treats a blank end date as no end', async () => {
    let posted: unknown = null;
    server.use(
      http.get(RECURRING, () => HttpResponse.json({ recurringSessions: [] })),
      http.post(RECURRING, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(template({ id: 't1' }), { status: 201 });
      }),
    );

    renderApp('/sessions/recurring/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Tuesday session');
    await user.selectOptions(screen.getByLabelText('Day of the week'), 'Tuesday');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');
    await user.type(screen.getByLabelText('Starts from'), '2026-01-01');

    await user.click(screen.getByRole('button', { name: 'Add weekly session' }));
    await screen.findByRole('heading', { name: 'Weekly sessions' });

    expect(posted).toEqual({
      name: 'Tuesday session',
      weekday: 2,
      startTime: '10:00',
      durationMinutes: 90,
      location: 'St Mary’s Hall',
      capacity: 25,
      activeFrom: '2026-01-01',
      activeUntil: null,
      // Deliberately the opposite of the server's own create default of
      // `true` — settled 2026-08-16 — so an untouched checkbox opts a new
      // template out of deliveries and the window pair is omitted entirely.
      deliveryCapacity: 0,
    });
    expect(posted).not.toHaveProperty('deliveryWindowStart');
    expect(posted).not.toHaveProperty('deliveryWindowEnd');
  });

  it('disables the delivery times until the checkbox is ticked', async () => {
    server.use(http.get(RECURRING, () => HttpResponse.json({ recurringSessions: [] })));

    renderApp('/sessions/recurring/new');

    const start = await screen.findByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    expect(start).toBeDisabled();
    expect(end).toBeDisabled();
  });

  it('sends the delivery window pair together once ticked on', async () => {
    let posted: unknown = null;
    server.use(
      http.get(RECURRING, () => HttpResponse.json({ recurringSessions: [] })),
      http.post(RECURRING, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(template({ id: 't1' }), { status: 201 });
      }),
    );

    renderApp('/sessions/recurring/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Tuesday session');
    await user.selectOptions(screen.getByLabelText('Day of the week'), 'Tuesday');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');
    await user.type(screen.getByLabelText('Starts from'), '2026-01-01');
    await setDeliveryCapacity(user, '8');
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');

    await user.click(screen.getByRole('button', { name: 'Add weekly session' }));
    await screen.findByRole('heading', { name: 'Weekly sessions' });

    expect(posted).toMatchObject({
      deliveryWindowStart: '09:00',
      deliveryWindowEnd: '11:00',
      deliveryCapacity: 8,
    });
  });

  it('refuses a ticked-on window missing its start, before making a request', async () => {
    const created = vi.fn();
    server.use(
      http.get(RECURRING, () => HttpResponse.json({ recurringSessions: [] })),
      http.post(RECURRING, () => {
        created();
        return new HttpResponse(null, { status: 201 });
      }),
    );

    renderApp('/sessions/recurring/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Tuesday session');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');
    await user.type(screen.getByLabelText('Starts from'), '2026-01-01');
    await setDeliveryCapacity(user, '8');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');

    await user.click(screen.getByRole('button', { name: 'Add weekly session' }));

    expect(await screen.findByText('Enter when the delivery window starts.')).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });

  it('refuses an end date before the start date', async () => {
    server.use(http.get(RECURRING, () => HttpResponse.json({ recurringSessions: [] })));

    renderApp('/sessions/recurring/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Tuesday session');
    await user.type(screen.getByLabelText('Start time'), '10:00');
    await user.type(screen.getByLabelText('Duration (minutes)'), '90');
    await user.type(screen.getByLabelText('Location'), 'St Mary’s Hall');
    await user.type(screen.getByLabelText('Starts from'), '2026-06-01');
    await user.type(screen.getByLabelText('Ends after (optional)'), '2026-01-01');

    await user.click(screen.getByRole('button', { name: 'Add weekly session' }));

    expect(
      await screen.findByText('The end date cannot be before the start date.'),
    ).toBeInTheDocument();
  });
});

describe('amending a weekly session', () => {
  it('prefills from the cached list — there is no single-item GET — and saves a patch', async () => {
    let posted: unknown = null;
    server.use(
      http.get(RECURRING, () =>
        HttpResponse.json({ recurringSessions: [template({ id: 't1', name: 'Tuesday session' })] }),
      ),
      http.patch(`${RECURRING}/t1`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(template({ id: 't1', location: 'New hall' }));
      }),
    );

    renderApp('/sessions/recurring/t1');
    const user = userEvent.setup();

    const locationInput = await screen.findByDisplayValue('St Mary’s Hall');
    await user.clear(locationInput);
    await user.type(locationInput, 'New hall');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Weekly sessions' });

    expect(posted).toMatchObject({ location: 'New hall' });
  });

  it('disables the delivery times until the checkbox is ticked', async () => {
    server.use(
      http.get(RECURRING, () =>
        HttpResponse.json({ recurringSessions: [template({ id: 't1', name: 'Tuesday session' })] }),
      ),
    );

    renderApp('/sessions/recurring/t1');

    const start = await screen.findByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    expect(start).toBeDisabled();
    expect(end).toBeDisabled();
  });

  it('sets a delivery window on amend, once the checkbox is ticked', async () => {
    let posted: unknown = null;
    server.use(
      http.get(RECURRING, () =>
        HttpResponse.json({ recurringSessions: [template({ id: 't1', name: 'Tuesday session' })] }),
      ),
      http.patch(`${RECURRING}/t1`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          template({
            id: 't1',
            deliveryWindowStart: '09:00',
            deliveryWindowEnd: '11:00',
            deliveryCapacity: 8,
          }),
        );
      }),
    );

    renderApp('/sessions/recurring/t1');
    const user = userEvent.setup();

    await screen.findByDisplayValue('St Mary’s Hall');
    await setDeliveryCapacity(user, '8');
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Weekly sessions' });

    expect(posted).toMatchObject({
      deliveryWindowStart: '09:00',
      deliveryWindowEnd: '11:00',
      deliveryCapacity: 8,
    });
  });

  it('clears an existing delivery window by sending explicit null on both keys when the capacity returns to nought', async () => {
    let posted: unknown = null;
    server.use(
      http.get(RECURRING, () =>
        HttpResponse.json({
          recurringSessions: [
            template({
              id: 't1',
              name: 'Tuesday session',
              deliveryWindowStart: '09:00',
              deliveryWindowEnd: '11:00',
              deliveryCapacity: 8,
            }),
          ],
        }),
      ),
      http.patch(`${RECURRING}/t1`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(template({ id: 't1' }));
      }),
    );

    renderApp('/sessions/recurring/t1');
    const user = userEvent.setup();

    await screen.findByDisplayValue('09:00');
    await setDeliveryCapacity(user, '0');

    const start = screen.getByLabelText('Delivery window starts');
    const end = screen.getByLabelText('Delivery window ends');
    expect(start).toBeDisabled();
    expect(start).toHaveValue('');
    expect(end).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Weekly sessions' });

    expect(posted).toMatchObject({ deliveryWindowStart: null, deliveryWindowEnd: null });
  });

  it('changes the delivery capacity and round-trips it and its now-required window in the save', async () => {
    let posted: unknown = null;
    server.use(
      http.get(RECURRING, () =>
        HttpResponse.json({
          recurringSessions: [template({ id: 't1', name: 'Tuesday session', deliveryCapacity: 0 })],
        }),
      ),
      http.patch(`${RECURRING}/t1`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          template({
            id: 't1',
            deliveryCapacity: 8,
            deliveryWindowStart: '09:00',
            deliveryWindowEnd: '11:00',
          }),
        );
      }),
    );

    renderApp('/sessions/recurring/t1');
    const user = userEvent.setup();

    await screen.findByDisplayValue('St Mary’s Hall');
    await setDeliveryCapacity(user, '8');
    await user.type(screen.getByLabelText('Delivery window starts'), '09:00');
    await user.type(screen.getByLabelText('Delivery window ends'), '11:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { name: 'Weekly sessions' });

    expect(posted).toMatchObject({
      deliveryCapacity: 8,
      deliveryWindowStart: '09:00',
      deliveryWindowEnd: '11:00',
    });
  });

  it('shows that the weekly session is not in the list rather than crashing on a stale link', async () => {
    server.use(http.get(RECURRING, () => HttpResponse.json({ recurringSessions: [] })));

    renderApp('/sessions/recurring/does-not-exist');

    expect(await screen.findByText('That weekly session is not in the list')).toBeInTheDocument();
  });
});
