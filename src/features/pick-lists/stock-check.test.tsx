import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from '../sessions/queries';
import type { Parcel, PickList, StockRequirement } from './queries';

// The shipped preference rules name a maintained catalogue this file does not
// load; the stock check is about the totals the server sends back, not about
// which lines got onto a parcel.
vi.mock('./preference-rules.config.json', () => ({ default: { rules: [] } }));

/**
 * Can the warehouse cover this session? `screenDetails.md`, "#Run a session".
 *
 * The comparison is the session's reviewed pick lists added up against what is
 * on the shelves, and a team lead acts on it by walking to a shelf — so what is
 * asserted here is that the figures reach the screen unaltered, that a shortage
 * is marked as one, and that the check is not offered while the quantities
 * behind it are still moving.
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
  deliveryCapacity: 0,
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
  generatedAt: '2099-08-05T09:00:00.000Z',
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
  reviewedAt: '2099-08-05T10:00:00.000Z',
  attendance: 'pending',
  notes: null,
  answers: {},
  lines: [],
};

const REQUIREMENT: StockRequirement = {
  pickListId: PICK_LIST.id,
  items: [
    {
      id: 'stock-1',
      name: 'Baked beans',
      category: 'Tinned goods',
      description: 'In tomato sauce',
      shelfNumber: 'A2',
      isActive: true,
      quantityOnHand: 40,
      requiredQuantity: 12,
      shortfall: 0,
    },
    {
      id: 'stock-2',
      name: 'Long grain rice',
      category: 'Dry goods',
      description: null,
      shelfNumber: 'A10',
      isActive: true,
      quantityOnHand: -2,
      requiredQuantity: 9,
      shortfall: 11,
    },
  ],
};

function serveSession(parcels: readonly Parcel[]) {
  server.use(
    http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
    http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
    http.get('/api/v1/sessions/:sessionId/pick-list', () =>
      HttpResponse.json({ pickList: PICK_LIST, parcels }),
    ),
  );
}

beforeEach(() => {
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
    http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
    http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
      HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
    ),
  );
});

describe('the session stock check', () => {
  it('shows what the session needs against what is on the shelves, and marks what is short', async () => {
    serveSession([PARCEL]);
    server.use(
      http.get('/api/v1/sessions/:sessionId/stock-requirement', () =>
        HttpResponse.json(REQUIREMENT),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Stock check' }));

    expect(
      await screen.findByText('1 of the 2 stock items this session asks for cannot be covered.'),
    ).toBeInTheDocument();

    const covered = screen.getByRole('row', { name: /Baked beans/ });
    expect(within(covered).getByRole('rowheader')).toHaveTextContent('Baked beans');
    expect(covered).toHaveTextContent('12');
    expect(covered).toHaveTextContent('40');

    // The shortfall is the server's figure, and a level below zero after a
    // correction is a number rather than a fault: both are shown as sent.
    const short = screen.getByRole('row', { name: /Long grain rice/ });
    expect(short).toHaveTextContent('-2');
    expect(short).toHaveTextContent('11');
  });

  /**
   * **`aria-expanded` is how the control says the panel is already open**, to
   * anyone who is not looking at the screen. On screen the panel itself says
   * it, opening directly beneath the control that was pressed — there is no
   * caret or other mark, settled by Pete on 2026-08-17. Which leaves this
   * attribute as the only statement of the state for a screen-reader user, and
   * nothing visual would fail if it were dropped.
   */
  it('says whether its panel is open, on the control that opens it', async () => {
    serveSession([PARCEL]);
    server.use(
      http.get('/api/v1/sessions/:sessionId/stock-requirement', () =>
        HttpResponse.json(REQUIREMENT),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();

    const check = await screen.findByRole('button', { name: 'Stock check' });
    expect(check).toHaveAttribute('aria-expanded', 'false');

    await user.click(check);
    expect(await screen.findByRole('table', { name: /Stock this session needs/ })).toBeVisible();
    expect(check).toHaveAttribute('aria-expanded', 'true');

    await user.click(check);
    expect(check).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: /Stock this session needs/ })).toBeNull();
  });

  it('lists only the items the session asks for, in the order the server sent them', async () => {
    serveSession([PARCEL]);
    server.use(
      http.get('/api/v1/sessions/:sessionId/stock-requirement', () =>
        HttpResponse.json(REQUIREMENT),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Stock check' }));
    const table = await screen.findByRole('table', { name: /Stock this session needs/ });

    // Shelf order, which is how a volunteer walks the warehouse once: `A2`
    // before `A10`, and never re-sorted into the alphabetical order that would
    // send them back down the aisle.
    const rows = within(table)
      .getAllByRole('row')
      .filter((row) => row.querySelector('th[scope="row"]'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Baked beans');
    expect(rows[1]).toHaveTextContent('Long grain rice');

    // The order is what carries the walk; the shelf number itself is not on the
    // screen. A column of codes beside the three figures this table exists to
    // compare is what a volunteer reads past on a phone in a hall.
    expect(within(table).queryByRole('columnheader', { name: 'Shelf' })).toBeNull();
    expect(table).not.toHaveTextContent('A2');
    expect(table).not.toHaveTextContent('A10');
  });

  /**
   * A cancelled household is not picked for and is not waited for either — the
   * server says so in as many words, and a screen that waited for a review that
   * will never happen would hold the check shut for the rest of the session.
   */
  it('is offered when the only unreviewed parcel belongs to a cancelled household', async () => {
    serveSession([
      PARCEL,
      { ...PARCEL, id: 'parcel-2', pickNumber: 2, reviewedAt: null, attendance: 'cancelled' },
    ]);
    server.use(
      http.get('/api/v1/sessions/:sessionId/stock-requirement', () =>
        HttpResponse.json(REQUIREMENT),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();

    const check = await screen.findByRole('button', { name: 'Stock check' });
    expect(check).not.toHaveAttribute('aria-disabled');

    await user.click(check);

    expect(
      await screen.findByRole('table', { name: /Stock this session needs/ }),
    ).toBeInTheDocument();
  });

  it('is not offered while a pick list is still to be reviewed, and says why', async () => {
    let asked = 0;
    serveSession([{ ...PARCEL, reviewedAt: null }]);
    server.use(
      http.get('/api/v1/sessions/:sessionId/stock-requirement', () => {
        asked += 1;
        return HttpResponse.json(REQUIREMENT);
      }),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();

    const check = await screen.findByRole('button', { name: 'Stock check' });
    // `aria-disabled` rather than `disabled`, so the sentence explaining it
    // stays reachable from the keyboard.
    expect(check).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/Review every pick list before checking stock/)).toBeInTheDocument();

    await user.click(check);

    expect(screen.queryByRole('table', { name: /Stock this session needs/ })).toBeNull();
    expect(asked).toBe(0);
  });

  /**
   * The server refuses a total it cannot stand behind — a parcel nobody has
   * reviewed, or a line still saying an item needs attention — and the sentence
   * it sends is the only useful thing a team lead is told. Never flattened into
   * "Something went wrong".
   *
   * The screen's own gate rules both out, so this is reachable only in a race:
   * a late referral reconciled in by somebody else between this screen loading
   * and the button being pressed. That is exactly why it is worth a test —
   * nobody would notice the sentence being thrown away.
   */
  it('shows the server’s own sentence when it refuses to add the session up', async () => {
    serveSession([PARCEL]);
    server.use(
      http.get('/api/v1/sessions/:sessionId/stock-requirement', () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'Pick #2 has not been reviewed.',
              requestId: 'r1',
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderApp(`/run-sessions/${SESSION.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Stock check' }));

    expect(await screen.findByText('Pick #2 has not been reviewed.')).toBeInTheDocument();
  });

  /**
   * Both halves of the comparison move under it — a quantity edited on this
   * screen, a stock take counted on another. Somebody acts on this by walking
   * to a shelf, so asking again has to ask the server again.
   *
   * Rendered with the app's real `staleTime`, because the test harness's
   * default of `0` would refetch on remount whatever this query asked for.
   */
  it('asks again each time it is opened rather than repeating an earlier answer', async () => {
    let asked = 0;
    serveSession([PARCEL]);
    server.use(
      http.get('/api/v1/sessions/:sessionId/stock-requirement', () => {
        asked += 1;
        return HttpResponse.json(REQUIREMENT);
      }),
    );

    renderApp(
      `/run-sessions/${SESSION.id}`,
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 60_000 },
          mutations: { retry: false },
        },
      }),
    );
    const user = userEvent.setup();

    const check = await screen.findByRole('button', { name: 'Stock check' });
    await user.click(check);
    await screen.findByRole('table', { name: /Stock this session needs/ });
    expect(asked).toBe(1);

    await user.click(check);
    await user.click(check);

    await waitFor(() => {
      expect(asked).toBe(2);
    });
  });
});
