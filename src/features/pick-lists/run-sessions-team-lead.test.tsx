import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from '../sessions/queries';
import type { Parcel, PickList } from './queries';

// These route tests exercise the team-lead workflow against a deliberately
// small stock fixture. The shipped rules are separately unit-tested with their
// own matching catalogue; loading them here would make unrelated navigation
// assertions depend on every maintained stock name.
vi.mock('./preference-rules.config.json', () => ({ default: { rules: [] } }));

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
  answers: {
    Allergies: 'Gluten-free food for one person',
    Dietary: 'Vegetarian',
    'Household Components': { '0-4': { male: 1 }, 'working-age': { 'non-binary': 1 } },
  },
  lines: [
    {
      stockItemId: 'stock-1',
      name: 'Baked beans',
      description: 'In tomato sauce',
      shelfNumber: 'A2',
      quantity: 2,
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
    http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
    http.get('/api/v1/stock/items', () =>
      HttpResponse.json({
        items: [
          {
            id: 'stock-1',
            name: 'Baked beans',
            category: 'Tinned goods',
            description: 'In tomato sauce',
            shelfNumber: 'A2',
            isActive: true,
          },
        ],
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
          households: [
            {
              referralId: PARCEL.referralId,
              reminderSentAt: null,
              messageCount: 1,
              unreadCount: 1,
            },
          ],
        }),
      ),
      http.post('/api/v1/sessions/:sessionId/sms-reminders', () => {
        sent = true;
        return HttpResponse.json({ reminded: 1, failed: 0, alreadyReminded: 0 });
      }),
      http.get('/api/v1/referrals/:id/sms-messages', () =>
        HttpResponse.json({
          referralId: PARCEL.referralId,
          messages: [
            {
              id: 'sms-1',
              referralId: PARCEL.referralId,
              kind: 'household_reply',
              body: 'Running late',
              occurredAt: '2026-08-06T09:00:00.000Z',
              readAt: null,
            },
          ],
        }),
      ),
      http.post('/api/v1/referrals/:id/sms-messages/read', () =>
        HttpResponse.json({ markedRead: 1 }),
      ),
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

  /**
   * The screen used to hide anything dated before today, which is exactly the
   * session with work left on it: outcomes and details are routinely completed
   * after the event. `screenDetails.md`, "#Run a session".
   */
  it('lists an open session in the past, and leaves out the completed and cancelled', async () => {
    const past = (id: string, status: Session['status'], location: string): Session => ({
      ...SESSION,
      id,
      status,
      location,
      sessionDate: '2020-01-04',
      startsAtUtc: '2020-01-04T10:00:00.000Z',
    });

    server.use(
      http.get('/api/v1/sessions', () =>
        HttpResponse.json({
          sessions: [
            past('past-planned', 'planned', 'The Old Hall'),
            past('past-in-progress', 'in_progress', 'The Annexe'),
            past('past-confirmed', 'confirmed', 'The Signed Off Room'),
            past('past-cancelled', 'cancelled', 'The Called Off Room'),
            SESSION,
          ],
        }),
      ),
    );

    renderApp('/run-sessions');

    // Both kinds of open session, however long ago they were.
    expect(await screen.findByRole('link', { name: /The Old Hall/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /The Annexe/ })).toBeInTheDocument();
    // And the future one still, which is the behaviour that already worked.
    expect(screen.getByRole('link', { name: /St Mary’s Hall/ })).toBeInTheDocument();

    // A confirmed session is signed off and a cancelled one is not being run.
    expect(screen.queryByRole('link', { name: /The Signed Off Room/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /The Called Off Room/ })).toBeNull();
  });

  it('does not describe an empty list as having no upcoming sessions', async () => {
    server.use(
      http.get('/api/v1/sessions', () =>
        HttpResponse.json({ sessions: [{ ...SESSION, status: 'confirmed' }] }),
      ),
    );

    renderApp('/run-sessions');

    // "No upcoming sessions" would be a claim about the future on a screen
    // that is no longer about the future.
    expect(await screen.findByText('No sessions to run')).toBeInTheDocument();
    expect(screen.queryByText(/upcoming/i)).toBeNull();
  });

  it('reconciles the selected session and opens the client pick-list workflow', async () => {
    let reconciled = false;
    let savedLines = 0;
    let savedNotes: string | null = null;
    let generationBody: unknown;
    let markedReviewed = false;
    server.use(
      http.get('/api/v1/sessions/:id', ({ params }) => {
        expect(params.id).toBe(SESSION.id);
        return HttpResponse.json(SESSION);
      }),
      http.get('/api/v1/referrals', () =>
        HttpResponse.json({
          referrals: [
            {
              id: PARCEL.referralId,
              adults: PARCEL.adults,
              children: PARCEL.children,
              answers: {
                Allergies: 'Gluten-free food for one person',
                Pulses: 'Kidney beans please',
              },
            },
          ],
        }),
      ),
      http.post('/api/v1/sessions/:sessionId/pick-list', async ({ params, request }) => {
        reconciled = params.sessionId === SESSION.id;
        generationBody = await request.json();
        return HttpResponse.json({ ...PICK_LIST, parcelsCreated: 1, linesCreated: 1 });
      }),
      http.get('/api/v1/sessions/:sessionId/pick-list', ({ params }) => {
        expect(params.sessionId).toBe(SESSION.id);
        return HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] });
      }),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
      http.get('/api/v1/stock/items', () =>
        HttpResponse.json({
          items: [
            {
              id: 'stock-1',
              name: 'Baked beans',
              category: 'Tinned goods',
              description: 'In tomato sauce',
              shelfNumber: 'A2',
              isActive: true,
            },
          ],
        }),
      ),
      http.put('/api/v1/parcels/:id/lines', async ({ request, params }) => {
        expect(params.id).toBe(PARCEL.id);
        expect(await request.json()).toEqual({ stockItemId: 'stock-1', quantity: 3 });
        savedLines += 1;
        return new HttpResponse(null, { status: 204 });
      }),
      http.patch('/api/v1/parcels/:id', async ({ request, params }) => {
        expect(params.id).toBe(PARCEL.id);
        expect(await request.json()).toEqual({ notes: 'Allergies: no dairy' });
        savedNotes = 'Allergies: no dairy';
        return HttpResponse.json({ id: PARCEL.id, isActive: true });
      }),
      http.post('/api/v1/parcels/:id/review', ({ params }) => {
        expect(params.id).toBe(PARCEL.id);
        expect(savedLines).toBe(1);
        markedReviewed = true;
        return HttpResponse.json({});
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();

    expect(await screen.findByText(/St Mary’s Hall/)).toBeInTheDocument();
    expect(reconciled).toBe(true);
    expect(generationBody).toEqual({
      preferenceLines: [],
      pickListInformation: [
        {
          referralId: PARCEL.referralId,
          notes: 'Allergies: Gluten-free food for one person\nPulses: Kidney beans please',
        },
      ],
    });
    expect(screen.getByRole('button', { name: 'Print all pick lists' })).toBeDisabled();
    expect(screen.getByText(/Review every pick list before printing/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Review Pick list' }));

    const panel = screen.getByRole('heading', { name: /Pick #1: Sam Taylor/ }).parentElement;
    expect(panel).not.toBeNull();
    if (!(panel instanceof HTMLElement)) throw new Error('Pick-list panel was not rendered');
    expect(within(panel).getByText('Adults/children: 1/1')).toBeInTheDocument();
    expect(within(panel).getByRole('table', { name: 'Household composition' })).toBeInTheDocument();
    expect(within(panel).getByText('Baked beans')).toBeInTheDocument();
    expect(within(panel).getByText('Vegetarian')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Mark pick list reviewed' })).toBeEnabled();
    expect(within(panel).queryByRole('button', { name: 'Attended' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'No show' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Complete session' })).toBeNull();

    const quantity = within(panel).getByRole('spinbutton', { name: /Baked beans/ });
    await user.click(quantity);
    await user.keyboard('{Control>}a{/Control}3');
    await user.type(
      within(panel).getByRole('textbox', { name: 'Pick-list information' }),
      'Allergies: no dairy',
    );
    await user.click(within(panel).getByRole('button', { name: 'Mark pick list reviewed' }));
    await waitFor(() => {
      expect(savedLines).toBe(1);
      expect(savedNotes).toBe('Allergies: no dairy');
      expect(markedReviewed).toBe(true);
    });
  });

  it('never lists a cancelled referral as a client for the session', async () => {
    const cancelledParcel: Parcel = {
      ...PARCEL,
      id: 'parcel-cancelled',
      referralId: 'referral-cancelled',
      pickNumber: 2,
      refereeFirstName: 'Cancelled',
      refereeSurname: 'Casey',
      attendance: 'cancelled',
    };
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL, cancelledParcel] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);

    expect(await screen.findByText(/#1 Sam Taylor/)).toBeInTheDocument();
    expect(screen.queryAllByText(/Cancelled Casey/)).toHaveLength(0);
  });

  it('does not open a cancelled referral through a direct client link', async () => {
    const cancelledParcel: Parcel = { ...PARCEL, attendance: 'cancelled' };
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [cancelledParcel] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);

    expect(await screen.findByText('Client not found')).toBeInTheDocument();
  });

  it('offers every active item and a retired parcel line in category and name order', async () => {
    const apples = {
      id: 'stock-apples',
      name: 'Apples',
      category: 'Fresh food',
      description: null,
      shelfNumber: 'C1',
      isActive: true,
    };
    const beans = {
      id: 'stock-1',
      name: 'Baked beans',
      category: 'Tinned goods',
      description: 'In tomato sauce',
      shelfNumber: 'A2',
      isActive: true,
    };
    const oats = {
      id: 'stock-oats',
      name: 'Oats',
      category: 'Breakfast',
      description: null,
      shelfNumber: 'D2',
      isActive: false,
    };
    const parcelWithRetiredLine: Parcel = {
      ...PARCEL,
      lines: [
        ...PARCEL.lines,
        {
          stockItemId: oats.id,
          name: oats.name,
          description: oats.description,
          shelfNumber: oats.shelfNumber,
          quantity: 1,
        },
      ],
    };
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [parcelWithRetiredLine] }),
      ),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [oats, apples, beans] })),
    );

    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);

    const panel = (await screen.findByRole('heading', { name: /Pick #1: Sam Taylor/ }))
      .parentElement;
    if (!(panel instanceof HTMLElement)) throw new Error('Pick-list panel was not rendered');

    const quantities = await within(panel).findAllByRole('spinbutton');
    expect(quantities).toHaveLength(3);
    expect(
      within(panel)
        .getAllByRole('heading', { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(['Breakfast', 'Fresh food', 'Tinned goods']);
    expect(quantities[0]).toHaveAccessibleName('Oats (retired)');
    expect(quantities[0]).toHaveValue(1);
    expect(quantities[1]).toHaveAccessibleName('Apples');
    expect(quantities[1]).toHaveValue(null);
    expect(quantities[2]).toHaveAccessibleName(/^Baked beans/);
    expect(quantities[2]).toHaveValue(2);
  });

  it('keeps pick-list information editable after attendance until the session is confirmed', async () => {
    const attendedParcel: Parcel = {
      ...PARCEL,
      attendance: 'attended',
      notes: 'Allergies: no dairy',
    };
    let cleared = false;
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [attendedParcel] }),
      ),
      http.patch('/api/v1/parcels/:id', async ({ request }) => {
        expect(await request.json()).toEqual({ notes: null });
        cleared = true;
        return HttpResponse.json({ id: PARCEL.id, isActive: true });
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);
    const user = userEvent.setup();
    const information = await screen.findByRole('textbox', { name: 'Pick-list information' });

    expect(information).toHaveValue('Allergies: no dairy');
    expect(information).toBeEnabled();
    await user.clear(information);
    await user.click(screen.getByRole('button', { name: 'Save pick list' }));

    await waitFor(() => {
      expect(cleared).toBe(true);
    });
  });

  it('locks pick-list information once the session is confirmed', async () => {
    const confirmedSession: Session = { ...SESSION, status: 'confirmed' };
    const parcelWithInformation: Parcel = { ...PARCEL, notes: 'Allergies: no dairy' };
    let noteRequests = 0;
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(confirmedSession)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({
          pickList: { ...PICK_LIST, status: 'confirmed' },
          parcels: [parcelWithInformation],
        }),
      ),
      http.patch('/api/v1/parcels/:id', () => {
        noteRequests += 1;
        return HttpResponse.json({ id: PARCEL.id, notes: null });
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);

    expect(await screen.findByRole('textbox', { name: 'Pick-list information' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save pick list' })).toBeDisabled();
    expect(noteRequests).toBe(0);
  });

  it('filters unselected stock items locally without hiding selected or retired parcel lines', async () => {
    const beans = {
      id: 'stock-1',
      name: 'Baked beans',
      category: 'Tinned goods',
      description: 'In tomato sauce',
      shelfNumber: 'A2',
      isActive: true,
    };
    const apples = {
      id: 'stock-apples',
      name: 'Apples',
      category: 'Fresh food',
      description: null,
      shelfNumber: 'C1',
      isActive: true,
    };
    const oats = {
      id: 'stock-oats',
      name: 'Oats',
      category: 'Breakfast',
      description: null,
      shelfNumber: 'D2',
      isActive: false,
    };
    const parcelWithRetiredLine: Parcel = {
      ...PARCEL,
      lines: [
        ...PARCEL.lines,
        {
          stockItemId: oats.id,
          name: oats.name,
          description: oats.description,
          shelfNumber: oats.shelfNumber,
          quantity: 1,
        },
      ],
    };
    let stockItemRequests = 0;
    let mutations = 0;
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [parcelWithRetiredLine] }),
      ),
      http.get('/api/v1/stock/items', () => {
        stockItemRequests += 1;
        return HttpResponse.json({ items: [oats, apples, beans] });
      }),
      http.put('/api/v1/parcels/:id/lines', () => {
        mutations += 1;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('/api/v1/parcels/:id/review', () => {
        mutations += 1;
        return HttpResponse.json({});
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);
    const user = userEvent.setup();
    const panel = (await screen.findByRole('heading', { name: /Pick #1: Sam Taylor/ }))
      .parentElement;
    if (!(panel instanceof HTMLElement)) throw new Error('Pick-list panel was not rendered');

    const toggle = within(panel).getByRole('checkbox', { name: 'Show unselected Stock items' });
    expect(toggle).toBeChecked();
    expect(await within(panel).findByRole('spinbutton', { name: 'Apples' })).toBeInTheDocument();
    expect(within(panel).getByRole('spinbutton', { name: /Baked beans/ })).toBeInTheDocument();
    expect(within(panel).getByRole('spinbutton', { name: 'Oats (retired)' })).toBeInTheDocument();

    const stockItemRequestsBeforeToggle = stockItemRequests;
    const mutationsBeforeToggle = mutations;
    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(within(panel).queryByRole('spinbutton', { name: 'Apples' })).toBeNull();
    expect(within(panel).getByRole('spinbutton', { name: /Baked beans/ })).toBeInTheDocument();
    expect(within(panel).getByRole('spinbutton', { name: 'Oats (retired)' })).toBeInTheDocument();
    expect(stockItemRequests).toBe(stockItemRequestsBeforeToggle);
    expect(mutations).toBe(mutationsBeforeToggle);

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(within(panel).getByRole('spinbutton', { name: 'Apples' })).toBeInTheDocument();
    expect(stockItemRequests).toBe(stockItemRequestsBeforeToggle);
    expect(mutations).toBe(mutationsBeforeToggle);
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
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({
          pickList: PICK_LIST,
          parcels: [{ ...reviewedParcel, attendance }],
        }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
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

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();

    expect(await screen.findByRole('button', { name: 'Attended' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'No show' }));

    await waitFor(() => {
      expect(requestedOutcome).toBe('no_show');
    });
    expect(screen.queryByText(/cannot be undone/i)).toBeNull();
  });

  it('does not offer attendance controls after a session is confirmed', async () => {
    const confirmedSession: Session = { ...SESSION, status: 'confirmed' };
    const reviewedPendingParcel: Parcel = {
      ...PARCEL,
      reviewedAt: '2026-08-05T10:00:00.000Z',
    };
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(confirmedSession)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [reviewedPendingParcel] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
      http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
    );

    renderApp(`/run-sessions/${SESSION.id}`);

    await screen.findByRole('heading', { name: 'Clients' });
    expect(screen.queryByRole('button', { name: 'Attended' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'No show' })).toBeNull();
  });

  it('does not fetch, mark or open print sheets through a copied print URL before review', async () => {
    let printFetched = false;
    let markedPrinted = false;
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] }),
      ),
      http.get('/api/v1/pick-lists/:id/print', () => {
        printFetched = true;
        return HttpResponse.json({ pickList: PICK_LIST, parcels: [] });
      }),
      http.post('/api/v1/pick-lists/:id/print', () => {
        markedPrinted = true;
        return HttpResponse.json(PICK_LIST);
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}/print`);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Review every pick list before printing.',
    );
    expect(printFetched).toBe(false);
    expect(markedPrinted).toBe(false);
    expect(printSpy).not.toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('prints only after every parcel has been reviewed', async () => {
    let markedPrinted = false;
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const reviewedParcel: Parcel = {
      ...PARCEL,
      reviewedAt: '2026-08-05T10:00:00.000Z',
      answers: { ...PARCEL.answers, 'Reason for referral': 'Never print this either' },
    };
    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [reviewedParcel] }),
      ),
      http.get('/api/v1/pick-lists/:id/print', () =>
        HttpResponse.json({
          pickList: PICK_LIST,
          parcels: [
            {
              pickNumber: 1,
              refereeFirstName: 'Sam',
              refereeSurname: 'Taylor',
              isDelivery: false,
              deliveryAddress: null,
              deliveryPostcode: null,
              deliveryPhone: null,
              notes: 'Allergies: Gluten-free food for one person',
              reason: 'Never print this',
              lines: [],
            },
          ],
        }),
      ),
      http.post('/api/v1/pick-lists/:id/print', () => {
        markedPrinted = true;
        return HttpResponse.json(PICK_LIST);
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}/print`);

    await waitFor(() => {
      expect(markedPrinted).toBe(true);
      expect(printSpy).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole('table', { name: 'Household composition' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pick-list information' })).toHaveTextContent(
      'Allergies: Gluten-free food for one person',
    );
    expect(screen.queryByRole('region', { name: 'Allergies' })).toBeNull();
    expect(screen.queryByText('Never print this')).toBeNull();
    expect(screen.queryByText('Never print this either')).toBeNull();
    printSpy.mockRestore();
  });
});
