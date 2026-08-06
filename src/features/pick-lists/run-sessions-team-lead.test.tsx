import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from '../sessions/queries';
import type { Parcel, PickList } from './queries';

/**
 * A team lead starts their shift in the operational view. The screen creates
 * or reconciles its session pick list before it shows a household; it must not
 * send them to the administrator's referral or session-maintenance screens.
 */

const SESSION: Session = {
  id: 'session-1',
  sessionDate: '2099-08-06',
  startTime: '10:00',
  startsAtUtc: '2099-08-06T09:00:00.000Z',
  durationMinutes: 90,
  location: 'St Mary’s Hall',
  deliveryTime: null,
  deliveriesAllowed: false,
  capacity: 25,
  booked: 1,
  status: 'planned',
  cancelledReason: null,
  isCustomised: false,
  recurringSessionId: null,
  occurrenceDate: null,
};

const PICK_LIST: PickList = {
  id: 'pick-list-1',
  sessionId: SESSION.id,
  status: 'draft',
  generatedAt: '2026-08-05T09:00:00.000Z',
  firstPrintedAt: null,
  confirmedAt: null,
};

const PARCEL: Parcel = {
  id: 'parcel-1',
  referralId: 'referral-1',
  pickNumber: 1,
  refereeFirstName: 'Sam',
  refereeSurname: 'Taylor',
  isDelivery: false,
  adults: 1,
  children: 1,
  householdSize: 2,
  reviewedAt: null,
  attendance: 'pending',
  notes: null,
  answers: { Dietary: 'Vegetarian' },
  lines: [
    {
      stockItemId: 'stock-1',
      name: 'Baked beans',
      shelfNumber: 'A2',
      quantity: 2,
      source: 'model',
    },
  ],
};

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

describe('a team lead running a session', () => {
  it('sends reminders and opens a household conversation without exposing a phone number', async () => {
    let sent = false;
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({
          sessionId: SESSION.id,
          unreadTotal: 1,
          households: [{ referralId: PARCEL.referralId, reminderSentAt: null, messageCount: 1, unreadCount: 1 }],
        }),
      ),
      http.post('/api/v1/sessions/:sessionId/sms-reminders', () => {
        sent = true;
        return HttpResponse.json({ reminded: 1, failed: 0, alreadyReminded: 0 });
      }),
      http.get('/api/v1/referrals/:id/sms-messages', () =>
        HttpResponse.json({ referralId: PARCEL.referralId, messages: [{ id: 'sms-1', referralId: PARCEL.referralId, kind: 'household_reply', body: 'Running late', occurredAt: '2026-08-06T09:00:00.000Z', readAt: null }] }),
      ),
      http.post('/api/v1/referrals/:id/sms-messages/read', () => HttpResponse.json({ markedRead: 1 })),
    );
    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send SMS reminders' }));
    expect(await screen.findByText(/1 sent; 0 failed/)).toBeInTheDocument();
    expect(sent).toBe(true);
    await user.click(screen.getByText(/Sam Taylor: 1 message, 1 unread/));
    expect(await screen.findByText(/Running late/)).toBeInTheDocument();
    expect(screen.queryByText(/\+44|phone/i)).toBeNull();
  });

  it('is offered Run a session and not the administrator maintenance links', async () => {
    server.use(http.get('/api/v1/sessions', () => HttpResponse.json({ sessions: [SESSION] })));

    renderApp('/run-sessions');

    expect(await screen.findByRole('heading', { name: 'Run a session' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Run a session' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sessions' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Referrals' })).toBeNull();
    expect(await screen.findByRole('link', { name: /St Mary’s Hall/ })).toBeInTheDocument();
  });

  it('reconciles the selected session and opens the client pick-list workflow', async () => {
    let reconciled = false;
    let savedLines = 0;
    server.use(
      http.get('/api/v1/sessions/:id', ({ params }) => {
        expect(params.id).toBe(SESSION.id);
        return HttpResponse.json(SESSION);
      }),
      http.post('/api/v1/sessions/:sessionId/pick-list', ({ params }) => {
        reconciled = params.sessionId === SESSION.id;
        return HttpResponse.json({ ...PICK_LIST, parcelsCreated: 1, linesCreated: 1 });
      }),
      http.get('/api/v1/sessions/:sessionId/pick-list', ({ params }) => {
        expect(params.sessionId).toBe(SESSION.id);
        return HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] });
      }),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
      http.put('/api/v1/parcels/:id/lines', async ({ request, params }) => {
        expect(params.id).toBe(PARCEL.id);
        expect(await request.json()).toEqual({ stockItemId: 'stock-1', quantity: 3 });
        savedLines += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();

    expect(await screen.findByText(/St Mary’s Hall/)).toBeInTheDocument();
    expect(reconciled).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Review Pick list' }));

    const panel = screen.getByRole('heading', { name: 'Pick #1: Sam Taylor' }).parentElement;
    expect(panel).not.toBeNull();
    if (!(panel instanceof HTMLElement)) throw new Error('Pick-list panel was not rendered');
    expect(within(panel).getByText('Baked beans')).toBeInTheDocument();
    expect(within(panel).getByText('Vegetarian')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Mark pick list reviewed' })).toBeEnabled();
    expect(within(panel).getByRole('button', { name: 'Attended' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'No show' })).toBeDisabled();

    const quantity = within(panel).getByRole('spinbutton', { name: /Baked beans/ });
    await user.click(quantity);
    await user.keyboard('{Control>}a{/Control}3');
    await user.click(within(panel).getByRole('button', { name: 'Save pick list' }));
    await waitFor(() => {
      expect(savedLines).toBe(1);
    });
  });

  it('loads the pick list when a client workspace is opened directly', async () => {
    let loadedPickList = false;
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.get('/api/v1/sessions/:sessionId/pick-list', ({ params }) => {
        loadedPickList = params.sessionId === SESSION.id;
        return HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] });
      }),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
    );

    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);

    expect(await screen.findByRole('heading', { name: 'Pick #1' })).toBeInTheDocument();
    expect(loadedPickList).toBe(true);
  });

  it('allows a reviewed household outcome to change while its session remains open', async () => {
    let attendance = 'attended';
    let requestedOutcome: string | undefined;
    const reviewedParcel: Parcel = {
      ...PARCEL,
      attendance: 'attended',
      reviewedAt: '2026-08-05T10:00:00.000Z',
    };
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({
          pickList: PICK_LIST,
          parcels: [{ ...reviewedParcel, attendance }],
        }),
      ),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
      http.post('/api/v1/parcels/:id/attendance', async ({ request, params }) => {
        expect(params.id).toBe(PARCEL.id);
        const body = await request.json();
        if (typeof body === 'object' && body !== null && 'attendance' in body) {
          requestedOutcome = String(body.attendance);
          attendance = requestedOutcome;
        }
        return HttpResponse.json({
          id: PARCEL.id,
          attendance,
          stockMoved: false,
          alreadyRecorded: false,
        });
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);
    const user = userEvent.setup();

    const panel = (await screen.findByRole('heading', { name: 'Pick #1: Sam Taylor' }))
      .parentElement;
    expect(panel).not.toBeNull();
    if (!(panel instanceof HTMLElement)) throw new Error('Pick-list panel was not rendered');

    expect(within(panel).getByRole('button', { name: 'Attended' })).toBeEnabled();
    await user.click(within(panel).getByRole('button', { name: 'No show' }));

    await waitFor(() => {
      expect(requestedOutcome).toBe('no_show');
    });
    expect(screen.queryByText(/cannot be undone/i)).toBeNull();
  });

  it('disables attendance controls after a session is confirmed', async () => {
    const confirmedSession: Session = { ...SESSION, status: 'confirmed' };
    const reviewedPendingParcel: Parcel = {
      ...PARCEL,
      reviewedAt: '2026-08-05T10:00:00.000Z',
    };
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(confirmedSession)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [reviewedPendingParcel] }),
      ),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
    );

    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);

    const panel = (await screen.findByRole('heading', { name: 'Pick #1: Sam Taylor' }))
      .parentElement;
    expect(panel).not.toBeNull();
    if (!(panel instanceof HTMLElement)) throw new Error('Pick-list panel was not rendered');

    expect(within(panel).getByRole('button', { name: 'Attended' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'No show' })).toBeDisabled();
  });
});
