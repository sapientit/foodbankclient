import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from '../sessions/queries';
import type { Parcel, PickList } from './queries';
import {
  COMPLETE_SESSION_UNAVAILABLE_REASON,
  PRINT_UNAVAILABLE_REASON,
  STOCK_CHECK_UNAVAILABLE_REASON,
} from './run-session.logic';

/**
 * The tab strip introduced by `RunSessionLayout` on 2026-08-30 —
 * `screenDetails.md`, "Session processing": five places to look, not a row of
 * buttons, and the two remaining Clients-tab actions now repeat their own
 * reason as a toast when pressed while unavailable.
 */

// A minimal valid rule keeps `resolvePreferenceLines` cheap for these
// navigation-focused tests; the shipped rules are covered elsewhere.
vi.mock('./preference-rules.config.json', () => ({ default: { rules: [] } }));

const SESSION_ID = 'session-1';

const SESSION: Session = {
  id: SESSION_ID,
  sessionDate: '2099-08-06',
  startTime: '10:00',
  startsAtUtc: '2099-08-06T09:00:00.000Z',
  durationMinutes: 90,
  location: 'St Mary’s Hall',
  deliveryWindowStart: null,
  deliveryWindowEnd: null,
  deliveryCapacity: 0,
  deliveryBooked: 0,
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
  sessionId: SESSION_ID,
  status: 'draft',
  generatedAt: '2026-08-05T09:00:00.000Z',
  firstPrintedAt: null,
};

const PENDING_PARCEL: Parcel = {
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
  answers: {},
  lines: [],
};

const REVIEWED_PARCEL: Parcel = { ...PENDING_PARCEL, reviewedAt: '2026-08-05T10:00:00.000Z' };

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
    http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
    http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
      HttpResponse.json({ sessionId: SESSION_ID, unreadTotal: 0, households: [] }),
    ),
  );
});

describe('the run-session tab strip', () => {
  it('offers all five tabs, with Clients current on the base route', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PENDING_PARCEL] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}`);

    const nav = await screen.findByRole('navigation', { name: 'Session navigation' });
    const clients = within(nav).getByRole('link', { name: 'Clients' });
    expect(clients).toHaveAttribute('href', `/run-sessions/${SESSION_ID}`);
    expect(clients).toHaveAttribute('aria-current', 'page');

    expect(within(nav).getByRole('link', { name: 'Listener sheet' })).toHaveAttribute(
      'href',
      `/run-sessions/${SESSION_ID}/listener`,
    );
    expect(within(nav).getByRole('link', { name: 'Referral details' })).toHaveAttribute(
      'href',
      `/run-sessions/${SESSION_ID}/referral-details`,
    );
    expect(within(nav).getByRole('link', { name: 'Text messages' })).toHaveAttribute(
      'href',
      `/run-sessions/${SESSION_ID}/messages`,
    );
    // Not yet reviewed, so Print all pick lists is the unavailable button, not
    // a link — covered on its own below.
    expect(within(nav).getByRole('button', { name: /^Print all pick lists/ })).toBeInTheDocument();
  });

  it('shows Print all pick lists as a live link once every pick list is reviewed', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [REVIEWED_PARCEL] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}`);

    const print = await screen.findByRole('link', { name: 'Print all pick lists' });
    expect(print).toHaveAttribute('href', `/run-sessions/${SESSION_ID}/print`);
  });

  it('shows Print all pick lists as a disabled button naming the reason, and pressing it shows a toast without navigating', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PENDING_PARCEL] }),
      ),
    );

    const { router } = renderApp(`/run-sessions/${SESSION_ID}`);
    const user = userEvent.setup();

    const print = await screen.findByRole('button', {
      name: `Print all pick lists — unavailable. ${PRINT_UNAVAILABLE_REASON}`,
    });
    expect(print).toHaveAttribute('aria-disabled', 'true');
    expect(print).not.toBeDisabled();

    // The Clients tab already shows this same sentence persistently — see
    // `run-sessions-team-lead.test.tsx` for that — so the toast is queried by
    // its `role="status"` rather than by text, which would now match both.
    await user.click(print);

    expect(await screen.findByRole('status')).toHaveTextContent(PRINT_UNAVAILABLE_REASON);
    expect(router.state.location.pathname).toBe(`/run-sessions/${SESSION_ID}`);
  });

  it('says no pick lists were prepared, rather than offering a dead print control, on a read-only session with none', async () => {
    // A cancelled session usually never generated a pick list at all —
    // `screenDetails.md`: "it did not run, so it usually has no pick lists at
    // all" — which is the server's `404` on the read, not a `200` with an
    // empty `parcels` array. `allParcelsReviewed` is vacuously true for `[]`,
    // so a `200` with no parcels renders "View all pick lists" instead; only
    // the `404` reaches this branch. Matches the fixture
    // `completed-session-read-only.test.tsx` uses for the same case.
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

    renderApp(`/run-sessions/${SESSION_ID}`);

    // Waiting on the Clients tab's own empty-session message too, so the
    // assertion below is against the settled tab strip rather than a
    // same-looking transient render made while the pick list is still loading.
    await screen.findByText('No clients on this session.');
    expect(screen.getByText('No pick lists were prepared for this session.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Print all pick lists/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /pick lists/ })).toBeNull();
  });

  it('shows the unread count on the Text messages tab as a badge and in its accessible name, and shows neither at zero', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PENDING_PARCEL] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({
          sessionId: SESSION_ID,
          unreadTotal: 2,
          households: [{ referralId: PENDING_PARCEL.referralId, messageCount: 3, unreadCount: 2 }],
        }),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}`);

    const messages = await screen.findByRole('link', { name: 'Text messages (2 unread)' });
    // The count is read in the accessible name (asserted above) as well as
    // shown visually — colour is never the only signal.
    expect(within(messages).getByText('2')).toBeInTheDocument();
  });

  it('shows no badge and the plain name when there are no unread messages', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PENDING_PARCEL] }),
      ),
      http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
        HttpResponse.json({ sessionId: SESSION_ID, unreadTotal: 0, households: [] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}`);

    const messages = await screen.findByRole('link', { name: 'Text messages' });
    expect(messages).toHaveTextContent('Text messages');
    // No digit anywhere in the link — a zero badge would still be a false
    // "something happened here" for a session with nothing unread.
    expect(messages.textContent).toBe('Text messages');
  });
});

describe('the reconciliation race between the tab strip and the Clients tab', () => {
  /**
   * `RunSessionTabs` mounts the instant the shared layout does and calls
   * `useSessionPickList(sessionId)` unconditionally — before the Clients
   * tab's own reconciliation effect has had a chance to `POST` a pick list
   * into existence for a session nobody has opened before. On a session like
   * that, the tab strip's own `GET` is very often still in flight, heading
   * for a `404`, by the time reconciliation's `POST` succeeds.
   *
   * `useReconcilePickList`'s `onSuccess` (`queries.ts`) has to win that race:
   * it cancels the stale query (`revert: true`, closing off the in-flight
   * fetch's ability to affect the query at all — see the comment beside it
   * for the `@tanstack/query-core` mechanics), reads the real pick list with
   * a plain, uncached fetch, and writes it in with `setQueryData` — all
   * before the stale `404` is ever allowed to arrive.
   */
  it('does not let the tab strip’s stale pre-reconciliation 404 flip the Clients tab into an error once reconciliation has supplied the real pick list', async () => {
    let pickListRequests = 0;
    let releaseStaleFetch: (() => void) | undefined;
    const staleNotFound = HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'No pick list', requestId: 'req-stale' } },
      { status: 404 },
    );

    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', async () => {
        pickListRequests += 1;
        // Only the very first request — the tab strip's own, fired the
        // instant the layout mounts, before the list exists — is held open.
        // Every later one (reconciliation's own uncached read, and anything
        // refetched afterwards) answers immediately with the real pick list,
        // exactly as the server would once the list is actually there.
        if (pickListRequests === 1) {
          await new Promise<void>((resolve) => {
            releaseStaleFetch = resolve;
          });
          return staleNotFound;
        }
        return HttpResponse.json({ pickList: PICK_LIST, parcels: [PENDING_PARCEL] });
      }),
    );

    renderApp(`/run-sessions/${SESSION_ID}`);

    // Reconciliation's own `POST` succeeded while the tab strip's `GET` was
    // still held open, and its direct, uncached read won the race: the
    // Clients tab shows the household it created, not a loading state stuck
    // behind the still-pending stale request.
    expect(await screen.findByRole('cell', { name: 'Sam Taylor' })).toBeInTheDocument();
    expect(releaseStaleFetch).toBeDefined();

    // Now the stale 404 "arrives" — the network reply to the request the tab
    // strip made before the pick list existed, finally answering long after
    // everything else has settled. `setTimeout(…, 0)` here is only flushing
    // the microtask chain the release kicks off (response parsing, `unwrap`,
    // the query's retryer) — the same idiom `auth-fetch.test.ts` uses for the
    // same reason — not a delay used to construct the race itself, which is
    // already deterministic via the held-open promise above.
    await act(async () => {
      releaseStaleFetch?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // If `useReconcilePickList` still used a bare `fetchQuery` here instead of
    // cancelling first, this stale 404 would flip the query back to
    // `status: 'error'` even though its `data` stayed the real pick list, and
    // the Clients tab would show this instead of the household.
    expect(screen.queryByText('That no longer exists')).toBeNull();
    expect(screen.getByRole('cell', { name: 'Sam Taylor' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Clients on this session' })).toBeInTheDocument();
  });
});

describe('the Clients tab’s session-wide controls', () => {
  it('shows a toast repeating the reason when Stock check is pressed while unavailable', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PENDING_PARCEL] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}`);
    const user = userEvent.setup();

    const stockCheck = await screen.findByRole('button', { name: 'Stock check' });
    expect(stockCheck).toHaveAttribute('aria-disabled', 'true');

    await user.click(stockCheck);

    expect(await screen.findByText(STOCK_CHECK_UNAVAILABLE_REASON)).toBeInTheDocument();
  });

  it('shows a toast repeating the reason when Complete session is pressed while unavailable', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({ pickList: PICK_LIST, parcels: [PENDING_PARCEL] }),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}`);
    const user = userEvent.setup();

    const complete = await screen.findByRole('button', { name: 'Complete session' });
    expect(complete).toHaveAttribute('aria-disabled', 'true');

    await user.click(complete);

    expect(await screen.findByText(COMPLETE_SESSION_UNAVAILABLE_REASON)).toBeInTheDocument();
  });
});
