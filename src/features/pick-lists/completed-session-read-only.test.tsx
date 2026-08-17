import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from '../sessions/queries';
import type { Parcel, PickList } from './queries';

/**
 * A completed session is a record of what happened, and every screen behind it
 * must read without writing anything.
 *
 * **The writes are what these tests are for, not the layout.** The server
 * refuses most of them with a `409`, but the two that matter here do not
 * announce themselves: `POST /sessions/{id}/pick-list` on a confirmed list is a
 * silent `200` that creates nothing, and marking an SMS thread read has no
 * button in front of it at all. Neither would show on screen if it fired, so
 * each is asserted against the request rather than the DOM.
 */

vi.mock('./preference-rules.config.json', () => ({ default: { rules: [] } }));

const SESSION: Session = {
  id: 'session-1',
  sessionDate: '2026-08-01',
  startTime: '10:00',
  startsAtUtc: '2026-08-01T09:00:00.000Z',
  durationMinutes: 90,
  location: 'St Mary’s Hall',
  deliveryWindowStart: null,
  deliveryWindowEnd: null,
  deliveriesAllowed: false,
  capacity: 25,
  booked: 1,
  status: 'confirmed',
  cancelledReason: null,
  isCustomised: false,
  recurringSessionId: null,
  occurrenceDate: null,
};

const PICK_LIST: PickList = {
  id: 'pick-list-1',
  sessionId: SESSION.id,
  status: 'confirmed',
  generatedAt: '2026-08-01T09:00:00.000Z',
  firstPrintedAt: '2026-08-01T09:30:00.000Z',
  confirmedAt: '2026-08-01T12:00:00.000Z',
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
  reviewedAt: '2026-08-01T09:15:00.000Z',
  attendance: 'attended',
  notes: 'Allergies: no dairy',
  answers: { Allergies: 'No dairy' },
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

/** Every write the run-session screens can make, counted rather than stubbed silently. */
interface Writes {
  reconcile: number;
  attendance: number;
  review: number;
  lines: number;
  notes: number;
  confirm: number;
  markPrinted: number;
  smsReminders: number;
  smsRead: number;
  smsReply: number;
}

let writes: Writes;

beforeEach(() => {
  writes = {
    reconcile: 0,
    attendance: 0,
    review: 0,
    lines: 0,
    notes: 0,
    confirm: 0,
    markPrinted: 0,
    smsReminders: 0,
    smsRead: 0,
    smsReply: 0,
  };

  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
      }),
    ),
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
    http.get('/api/v1/sessions/:sessionId/pick-list', () =>
      HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] }),
    ),
    http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
      HttpResponse.json({
        sessionId: SESSION.id,
        unreadTotal: 1,
        households: [{ referralId: PARCEL.referralId, messageCount: 2, unreadCount: 1 }],
      }),
    ),
    http.get('/api/v1/referrals/:id/sms-messages', () =>
      HttpResponse.json({
        messages: [
          {
            id: 'sms-1',
            referralId: PARCEL.referralId,
            kind: 'reminder',
            body: 'Your parcel is ready',
            occurredAt: '2026-08-01T08:00:00.000Z',
            readAt: null,
            phone: null,
          },
        ],
      }),
    ),

    // Every write, counted. None of these may be reached.
    http.post('/api/v1/sessions/:sessionId/pick-list', () => {
      writes.reconcile += 1;
      return HttpResponse.json(PICK_LIST);
    }),
    http.post('/api/v1/parcels/:id/attendance', () => {
      writes.attendance += 1;
      return HttpResponse.json({ parcelId: PARCEL.id, attendance: 'attended' });
    }),
    http.post('/api/v1/parcels/:id/review', () => {
      writes.review += 1;
      return HttpResponse.json(PARCEL);
    }),
    http.put('/api/v1/parcels/:id/lines', () => {
      writes.lines += 1;
      return HttpResponse.json(PARCEL);
    }),
    http.patch('/api/v1/parcels/:id', () => {
      writes.notes += 1;
      return HttpResponse.json(PARCEL);
    }),
    http.post('/api/v1/sessions/:sessionId/confirm', () => {
      writes.confirm += 1;
      return HttpResponse.json(SESSION);
    }),
    http.post('/api/v1/pick-lists/:id/print', () => {
      writes.markPrinted += 1;
      return HttpResponse.json(PICK_LIST);
    }),
    http.post('/api/v1/sessions/:sessionId/sms-reminders', () => {
      writes.smsReminders += 1;
      return HttpResponse.json({ reminded: 0, failed: 0, alreadyReminded: 0 });
    }),
    http.post('/api/v1/referrals/:id/sms-messages/read', () => {
      writes.smsRead += 1;
      return HttpResponse.json({ updated: 0 });
    }),
    http.post('/api/v1/referrals/:id/sms-messages', () => {
      writes.smsReply += 1;
      return HttpResponse.json({
        id: 'sms-2',
        referralId: PARCEL.referralId,
        kind: 'reply',
        body: 'x',
        occurredAt: '2026-08-01T13:00:00.000Z',
        readAt: null,
        phone: null,
      });
    }),
  );
});

describe('a completed session', () => {
  it('never reconciles its pick list, which the server would accept in silence', async () => {
    renderApp(`/run-sessions/${SESSION.id}`);

    // Asserted on the request, not the screen. `POST /sessions/{id}/pick-list`
    // on a confirmed list answers `200` having created nothing, so an unguarded
    // screen would look exactly like this one while writing on every visit.
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(writes.reconcile).toBe(0);
  });

  it('shows what happened, and offers nothing that would change it', async () => {
    renderApp(`/run-sessions/${SESSION.id}`);

    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'This session has been completed and signed off.',
    );

    // The outcome is on screen; the two buttons that would change it are gone,
    // and so is the one that would close a session already closed.
    expect(screen.getByText(/Attended/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Attended/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^No show/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complete session' })).toBeNull();
    expect(writes.attendance).toBe(0);
    expect(writes.confirm).toBe(0);
  });

  /**
   * **Gone, not greyed.** Settled by Pete on 2026-08-17, closing the second
   * half of Q41. The stock check answers "can the warehouse cover this
   * session", and once the session has been run it cannot answer anything: an
   * attended household's stock has left `quantityOnHand` while its parcel still
   * counts towards what was needed, so every line would read as a shortage that
   * never happened. A disabled control would invite somebody to work out why;
   * there is nothing to work out.
   */
  it('does not offer the stock check at all', async () => {
    renderApp(`/run-sessions/${SESSION.id}`);

    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    // The sheets are still there to read — this is the one control that goes.
    expect(screen.getByRole('link', { name: 'View all pick lists' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stock check' })).toBeNull();
    expect(screen.queryByText(/before checking stock/)).toBeNull();
  });

  it('still opens each household’s pick list, with nothing on it editable', async () => {
    renderApp(`/run-sessions/${SESSION.id}/clients/${PARCEL.id}`);

    expect(await screen.findByRole('heading', { name: 'Pick #1: Sam Taylor' })).toBeInTheDocument();
    // What the household was given is the whole point of looking back at this.
    const quantity = await screen.findByRole('spinbutton', { name: /Baked beans/ });
    expect(quantity).toHaveValue(2);
    expect(quantity).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Information for pickers' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save pick list' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark pick list reviewed' })).toBeNull();
    expect(writes.lines).toBe(0);
    expect(writes.notes).toBe(0);
    expect(writes.review).toBe(0);
  });

  it('renders the sheets again without recording a second print', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    server.use(
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
              notes: 'Allergies: no dairy',
              reason: 'Never print this',
              lines: [],
            },
          ],
        }),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}/print`);

    await waitFor(() => {
      expect(printSpy).toHaveBeenCalledOnce();
    });
    // `firstPrintedAt` must keep saying when the sheets actually went to paper.
    expect(writes.markPrinted).toBe(0);
    // And the sheet is the same sheet: still no reason for referral on it.
    expect(screen.queryByText('Never print this')).toBeNull();
    printSpy.mockRestore();
  });

  it('reads the message threads without sending, replying or marking one read', async () => {
    renderApp(`/run-sessions/${SESSION.id}`);

    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send SMS reminders' })).toBeNull();

    const user = userEvent.setup();
    await user.click(await screen.findByText(/Sam Taylor: 2 messages/));

    expect(await screen.findByText(/Your parcel is ready/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Reply by SMS' })).toBeNull();
    // Opening a year-old thread must not consume the one signal an administrator
    // has that somebody said something nobody answered.
    expect(writes.smsRead).toBe(0);
    expect(writes.smsReminders).toBe(0);
    expect(writes.smsReply).toBe(0);
  });

  it('reads as an empty session rather than a failure when no pick list was ever made', async () => {
    server.use(
      http.get('/api/v1/sessions/:id', () =>
        HttpResponse.json({ ...SESSION, status: 'cancelled' }),
      ),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'No pick list', requestId: 'r1' } },
          { status: 404 },
        ),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);

    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.getByText('No pick lists were prepared for this session.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('This session was cancelled');
    expect(writes.reconcile).toBe(0);
  });
});
