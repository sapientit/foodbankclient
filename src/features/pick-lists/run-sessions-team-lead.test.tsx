import { act, screen, waitFor } from '@testing-library/react';
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
  deliveryWindowStart: null,
  deliveryWindowEnd: null,
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
    Pulses: 'Vegetarian',
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
    // Every run-session screen now reads the session itself, because whether it
    // is finished with is what decides between a workspace and a record. A test
    // that needs a different status still overrides this with its own handler.
    http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
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
    expect(await screen.findByRole('link', { name: /6 Aug 2099/ })).toBeInTheDocument();
  });

  /**
   * The screen used to hide anything dated before today, which is exactly the
   * session with work left on it: outcomes and details are routinely completed
   * after the event. `screenDetails.md`, "#Run a session".
   */
  it('lists an open session in the past, and leaves out the completed and cancelled', async () => {
    // These used to be told apart by their locations. The list no longer names
    // one — the charity runs from a single hall — so they differ by the time
    // they start, which is what actually distinguishes two sessions on one day.
    const past = (id: string, status: Session['status'], startTime: string): Session => ({
      ...SESSION,
      id,
      status,
      startTime,
      sessionDate: '2020-01-04',
      startsAtUtc: '2020-01-04T10:00:00.000Z',
    });

    server.use(
      http.get('/api/v1/sessions', () =>
        HttpResponse.json({
          sessions: [
            past('past-planned', 'planned', '09:00'),
            past('past-in-progress', 'in_progress', '11:00'),
            past('past-confirmed', 'confirmed', '13:00'),
            past('past-cancelled', 'cancelled', '15:00'),
            SESSION,
          ],
        }),
      ),
    );

    renderApp('/run-sessions');

    // Both kinds of open session, however long ago they were.
    expect(await screen.findByText('09:00–10:30')).toBeInTheDocument();
    expect(screen.getByText('11:00–12:30')).toBeInTheDocument();
    // And the future one still, which is the behaviour that already worked.
    expect(screen.getByRole('link', { name: /6 Aug 2099/ })).toBeInTheDocument();

    // A confirmed session is signed off and a cancelled one is not being run,
    // so neither is on the list of what is left to do.
    expect(screen.queryByText('13:00–14:30')).toBeNull();
    expect(screen.queryByText('15:00–16:30')).toBeNull();
  });

  /**
   * Two sessions on one day is ordinary here, and the hours are in a column a
   * screen reader moving between links never visits. A list of identical
   * "Sat, 4 Jan 2020" links is a way to open the wrong session — on the screen
   * where attendance is recorded.
   */
  it('names each session link by its date and its hours, so two on one day are told apart', async () => {
    const sameDay = (id: string, startTime: string): Session => ({
      ...SESSION,
      id,
      startTime,
      sessionDate: '2020-01-04',
      startsAtUtc: '2020-01-04T10:00:00.000Z',
    });

    server.use(
      http.get('/api/v1/sessions', () =>
        HttpResponse.json({ sessions: [sameDay('morning', '09:00'), sameDay('midday', '11:00')] }),
      ),
    );

    renderApp('/run-sessions');

    expect(
      await screen.findByRole('link', { name: 'Sat, 4 Jan 2020, 09:00–10:30' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sat, 4 Jan 2020, 11:00–12:30' })).toBeInTheDocument();
    // The visible column layout is unchanged: only the date is drawn in the cell.
    expect(screen.getAllByText('Sat, 4 Jan 2020')).toHaveLength(2);
  });

  it('brings back the completed and the cancelled when Show completed is ticked', async () => {
    const past = (id: string, status: Session['status'], startTime: string): Session => ({
      ...SESSION,
      id,
      status,
      startTime,
      sessionDate: '2020-01-04',
      startsAtUtc: '2020-01-04T10:00:00.000Z',
    });

    server.use(
      http.get('/api/v1/sessions', () =>
        HttpResponse.json({
          sessions: [
            past('past-planned', 'planned', '09:00'),
            past('past-confirmed', 'confirmed', '13:00'),
            past('past-cancelled', 'cancelled', '15:00'),
          ],
        }),
      ),
    );

    renderApp('/run-sessions');

    expect(await screen.findByText('09:00–10:30')).toBeInTheDocument();
    expect(screen.queryByText('13:00–14:30')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Show completed'));

    // A completed session is a record of what happened, not work to do, and
    // this is how somebody gets back to one.
    expect(await screen.findByText('13:00–14:30')).toBeInTheDocument();
    // Cancelled too, deliberately: it is the only route left to one, and the
    // status column is what tells them apart.
    expect(screen.getByText('15:00–16:30')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
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
    expect(await screen.findByText('No sessions to show')).toBeInTheDocument();
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

    expect(await screen.findByText(/6 Aug 2099/)).toBeInTheDocument();
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
    /*
     * `aria-disabled`, and still in the tab order. A `disabled` button cannot be
     * focused, so the sentence next to it never reaches anybody using a keyboard
     * or a screen reader — they meet a control that has silently become nothing.
     * The reason has to arrive with the control, which is what the description
     * assertion is checking.
     */
    const print = screen.getByRole('button', { name: 'Print all pick lists' });
    expect(print).toHaveAttribute('aria-disabled', 'true');
    expect(print).not.toBeDisabled();
    expect(print).toHaveAccessibleDescription('Review every pick list before printing.');
    await user.click(screen.getByRole('link', { name: 'Review Pick list' }));

    // The pick number and household name are the screen's own heading, and the
    // only place they appear — queried at level one because a second copy below
    // it is exactly what this asserts is gone.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pick #1: Sam Taylor' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Pick #1/)).toHaveLength(1);
    // The composition grid is the only account of the household here. The
    // adults/children pair is the grid's sizing axes — an adult is anyone over
    // 11 and the under-fives count towards neither — so it must not be read
    // back to a team lead as a description of who the bag is for.
    expect(screen.getByRole('table', { name: 'Household composition' })).toBeInTheDocument();
    expect(screen.queryByText(/Adults\/children/)).toBeNull();
    expect(screen.getByText('Baked beans')).toBeInTheDocument();
    expect(screen.getByText('Vegetarian')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark pick list reviewed' })).toBeEnabled();
    // Attendance and completion belong to the client list, and printing is a
    // whole-session action — none of the three may reach this screen. Matched
    // loosely on purpose: each attendance button is named for its household as
    // well as its outcome, and an exact-name query here would pass by failing to
    // match rather than by the button being absent.
    expect(screen.queryByRole('button', { name: /^Attended/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^No show/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complete session' })).toBeNull();
    expect(screen.queryByText('Print all pick lists')).toBeNull();
    expect(screen.queryByText('Review every pick list before printing.')).toBeNull();

    const quantity = screen.getByRole('spinbutton', { name: /Baked beans/ });
    await user.click(quantity);
    await user.keyboard('{Control>}a{/Control}3');
    await user.type(
      screen.getByRole('textbox', { name: 'Information for pickers' }),
      'Allergies: no dairy',
    );
    await user.click(screen.getByRole('button', { name: 'Mark pick list reviewed' }));
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

    expect(await screen.findByRole('cell', { name: 'Sam Taylor' })).toBeInTheDocument();
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

    await screen.findByRole('heading', { level: 1, name: 'Pick #1: Sam Taylor' });

    const quantities = await screen.findAllByRole('spinbutton');
    expect(quantities).toHaveLength(3);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
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
    const information = await screen.findByRole('textbox', { name: 'Information for pickers' });

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

    expect(await screen.findByRole('textbox', { name: 'Information for pickers' })).toBeDisabled();
    // Absent rather than disabled: nothing on a locked panel can become dirty,
    // so a greyed-out Save would only ever say that something is wrong.
    expect(screen.queryByRole('button', { name: 'Save pick list' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark pick list reviewed' })).toBeNull();
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
    await screen.findByRole('heading', { level: 1, name: 'Pick #1: Sam Taylor' });

    const toggle = screen.getByRole('checkbox', { name: 'Show unselected Stock items' });
    expect(toggle).toBeChecked();
    expect(await screen.findByRole('spinbutton', { name: 'Apples' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /Baked beans/ })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Oats (retired)' })).toBeInTheDocument();

    const stockItemRequestsBeforeToggle = stockItemRequests;
    const mutationsBeforeToggle = mutations;
    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('spinbutton', { name: 'Apples' })).toBeNull();
    expect(screen.getByRole('spinbutton', { name: /Baked beans/ })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Oats (retired)' })).toBeInTheDocument();
    expect(stockItemRequests).toBe(stockItemRequestsBeforeToggle);
    expect(mutations).toBe(mutationsBeforeToggle);

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: 'Apples' })).toBeInTheDocument();
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

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pick #1: Sam Taylor' }),
    ).toBeInTheDocument();
    expect(loadedPickList).toBe(true);
  });

  it('never carries one household’s unsaved pick list onto another', async () => {
    /*
     * The workspace seeds its draft quantities from the parcel once, when it
     * mounts. This route is `clients/:parcelId`, so React reuses the component
     * across a change of household unless it is keyed — and the second household
     * would then be shown, and saved, holding the first one's pick list. Nothing
     * links between two clients today; this is what stops that link being
     * dangerous to add.
     */
    const secondParcel: Parcel = {
      ...PARCEL,
      id: 'parcel-2',
      referralId: 'referral-2',
      pickNumber: 2,
      refereeFirstName: 'Jo',
      refereeSurname: 'Patel',
      lines: [
        {
          ...(PARCEL.lines[0] ?? { name: '', description: null, shelfNumber: '' }),
          stockItemId: 'stock-1',
          quantity: 5,
        },
      ],
    };
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL, secondParcel] }),
      ),
    );

    const { router } = renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);
    const user = userEvent.setup();

    const quantity = await screen.findByRole('spinbutton', { name: /Baked beans/ });
    expect(quantity).toHaveValue(2);
    await user.click(quantity);
    await user.keyboard('{Control>}a{/Control}9');
    expect(quantity).toHaveValue(9);

    await act(async () => {
      await router.navigate(`/run-sessions/${SESSION.id}/clients/${secondParcel.id}`);
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pick #2: Jo Patel' }),
    ).toBeInTheDocument();
    // Jo Patel's own five tins, not Sam Taylor's abandoned nine.
    expect(screen.getByRole('spinbutton', { name: /Baked beans/ })).toHaveValue(5);
  });

  it('lets a team lead leave a pick list without saving, and does not save when they do', async () => {
    /*
     * `screenDetails.md` asks that leaving with unsaved changes "asks whether to
     * save first". Offering only Save and Cancel cannot take no for an answer:
     * somebody who has typed a quantity onto the wrong household would have no
     * way off the screen except to save it.
     */
    let saves = 0;
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
      http.put('/api/v1/parcels/:id/lines', () => {
        saves += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);
    const user = userEvent.setup();

    const quantity = await screen.findByRole('spinbutton', { name: /Baked beans/ });
    await user.click(quantity);
    await user.keyboard('{Control>}a{/Control}7');

    await user.click(screen.getByRole('link', { name: 'Back to clients' }));
    expect(await screen.findByRole('heading', { name: 'Save pick list changes?' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(saves).toBe(0);
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

    // The household is part of the name, so one session's worth of rows does not
    // present a screen reader with twenty identical pairs of buttons.
    expect(
      await screen.findByRole('button', { name: 'Attended — pick #1, Sam Taylor' }),
    ).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'No show — pick #1, Sam Taylor' }));

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
    expect(screen.queryByRole('button', { name: /^Attended/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^No show/ })).toBeNull();
  });

  it('names the pick numbers still waiting when the session refuses to close', async () => {
    /*
     * `screenDetails.md`: "When the screen refuses to close a session it names
     * the pick numbers still waiting, because what the team leader needs to know
     * is who is missing."
     *
     * Reaching it takes a race, which is the point. The button is disabled until
     * every parcel on screen has an outcome, so a `409` means somebody else
     * added a household — a late referral reconciled in — between this screen
     * loading and the tap. That is the end of a session, in a hall, with
     * somebody waiting to go home, and until now the button simply did nothing.
     */
    const attendedParcel: Parcel = {
      ...PARCEL,
      reviewedAt: '2026-08-05T10:00:00.000Z',
      attendance: 'attended',
    };
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [attendedParcel] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
      http.post('/api/v1/sessions/:sessionId/confirm', () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'Every household must be marked before the session can be completed.',
              requestId: 'req-confirm',
              details: { pendingPickNumbers: [4, 11] },
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Complete session' }));

    const refusal = await screen.findByRole('alert');
    expect(refusal).toHaveTextContent(
      'Every household must be marked before the session can be completed.',
    );
    // The numbers themselves, because "someone is missing" is not actionable.
    expect(refusal).toHaveTextContent('4');
    expect(refusal).toHaveTextContent('11');
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

  it("shows a client's name as plain text, with no way through to their referral", async () => {
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);

    // The name is there — this must fail because the link is absent, not
    // because the row never rendered.
    expect(await screen.findByRole('cell', { name: 'Sam Taylor' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sam Taylor' })).toBeNull();
    // Amending and cancelling a referral are administrator work, so nothing on
    // this screen points a team lead at that screen for any household.
    expect(
      screen.queryByRole('link', { name: new RegExp(`referrals/${PARCEL.referralId}`) }),
    ).toBeNull();
  });

  it('says a session has nobody on it rather than drawing column headings with nothing under them', async () => {
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);

    expect(await screen.findByText('No clients on this session.')).toBeInTheDocument();
    // A header-only table reads as a list that failed to load, so there must
    // be no table at all rather than an empty one.
    expect(screen.queryByRole('table', { name: 'Clients on this session' })).toBeNull();
  });

  it('lists a client as a table row naming its pick number, household, status and action', async () => {
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);

    // The table's own name for anyone who cannot see the `Clients` heading
    // above it — a caption rather than a second, visible title.
    expect(
      await screen.findByRole('table', { name: 'Clients on this session' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Pick #' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Client' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();

    // The pick number is the row header — what matches a sheet in a hall to
    // this row — and the rest of the row is read off it: the household, the
    // outcome so far, and the one thing there is to do about it.
    expect(screen.getByRole('rowheader', { name: '#1' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Sam Taylor' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Pending Review' })).toBeInTheDocument();
    expect(
      screen.getByRole('cell', { name: 'Review Pick list' }).querySelector('a'),
    ).toHaveAttribute('href', `/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);
  });

  it('marks Complete session aria-disabled, not disabled, while a client still lacks an outcome, and does not submit when clicked', async () => {
    let confirmCalled = false;
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
      http.post('/api/v1/sessions/:sessionId/confirm', () => {
        confirmCalled = true;
        return HttpResponse.json({ ...PICK_LIST, status: 'confirmed' });
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();

    // Still findable by role and still in the tab order — a `disabled`
    // button leaves the accessible tree entirely, which is exactly what a
    // keyboard or screen-reader user must not meet here.
    const complete = await screen.findByRole('button', { name: 'Complete session' });
    expect(complete).toHaveAttribute('aria-disabled', 'true');
    expect(complete).not.toBeDisabled();
    expect(complete).toHaveAccessibleDescription(
      'Record an outcome for every client before completing session.',
    );

    await user.click(complete);

    expect(confirmCalled).toBe(false);
  });

  it('enables Complete session as a live button once every client has an outcome', async () => {
    const attendedParcel: Parcel = {
      ...PARCEL,
      reviewedAt: '2026-08-05T10:00:00.000Z',
      attendance: 'attended',
    };
    server.use(
      http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
      http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [attendedParcel] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);

    const complete = await screen.findByRole('button', { name: 'Complete session' });
    expect(complete).toBeEnabled();
    // Live: `aria-disabled="false"` while the request is not in flight, which
    // is what the button carries the rest of the time. Asserted as the value
    // rather than the attribute's absence, because the in-flight state is the
    // same attribute reading `true` — an absence assertion would pass if the
    // wiring were dropped altogether.
    expect(complete).toHaveAttribute('aria-disabled', 'false');
    expect(
      screen.queryByText('Record an outcome for every client before completing session.'),
    ).toBeNull();
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
    expect(screen.getByRole('region', { name: 'Information for pickers' })).toHaveTextContent(
      'Allergies: Gluten-free food for one person',
    );
    expect(screen.queryByRole('region', { name: 'Allergies' })).toBeNull();
    expect(screen.queryByText('Never print this')).toBeNull();
    expect(screen.queryByText('Never print this either')).toBeNull();
    printSpy.mockRestore();
  });
});
