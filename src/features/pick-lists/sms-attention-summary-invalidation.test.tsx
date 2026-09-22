import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

/**
 * Regression test for a bug found in review: `useMarkSmsInboxMessageRead`
 * invalidated the inbox's own query but not the dashboard's
 * `smsAttentionSummary` — so clearing a flagged message on `/sms` left the
 * dashboard's unknown-message alert reading a stale, too-high count
 * until something else happened to invalidate it.
 *
 * Built with the app's real `staleTime` rather than `renderApp`'s default of
 * zero, and visiting the dashboard **before** marking the message read, so
 * the second visit can only show the new figure if the mutation actually
 * invalidated the cached query — a fresh mount would fetch correctly either
 * way and prove nothing.
 */

const REFRESH = '/api/v1/auth/refresh';
const SESSIONS = '/api/v1/sessions';
const REFERRALS = '/api/v1/referrals';
const LOW_STOCK = '/api/v1/stock/items/low-stock-summary';
const ATTENTION = '/api/v1/sms-messages/attention-summary';
const INBOX = '/api/v1/sms-messages';
const READ = '/api/v1/sms-messages/:id/read';

const MESSAGE = {
  id: 'message-1',
  referralId: null,
  kind: 'household_reply' as const,
  body: 'Can I come later?',
  occurredAt: '2026-08-22T09:00:00.000Z',
  readAt: null,
  location: 'unmatched' as const,
  session: null,
  simulated: false,
  phone: '+441234567890',
};

function cachingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // The app's real policy. Without invalidation, a second visit inside
      // the minute serves the cache and asserts nothing.
      queries: { retry: false, staleTime: 60_000 },
      mutations: { retry: false },
    },
  });
}

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'admin@x.com', displayName: 'Ada Admin', role: 'admin' },
      }),
    ),
    http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })),
    http.get(REFERRALS, () => HttpResponse.json({ referrals: [] })),
    http.get(LOW_STOCK, () => HttpResponse.json({ lowStockCount: 0 })),
    http.get(INBOX, () => HttpResponse.json({ messages: [MESSAGE] })),
  );
});

describe('marking an inbox message read', () => {
  it("refreshes the dashboard's unknown-message count, not just the inbox", async () => {
    let unmatchedUnread = 1;
    server.use(
      http.get(ATTENTION, () =>
        HttpResponse.json({
          activeSessionUnread: 0,
          closedSessionUnread: 0,
          unmatchedUnread,
          referrerUnread: 0,
        }),
      ),
      http.post(READ, () => {
        unmatchedUnread = 0;
        return HttpResponse.json({ ...MESSAGE, readAt: '2026-08-22T09:05:00.000Z' });
      }),
    );

    const { router } = renderApp('/', cachingClient());
    const user = userEvent.setup();

    expect(await screen.findByText('1 unread messages from unknown numbers')).toBeInTheDocument();

    await router.navigate('/sms/unknown');
    // Opening the thread is what marks it read now — there is no separate
    // button — the same way a team lead's own thread view already works.
    await user.click(await screen.findByText('Phone: +441234567890'));

    await router.navigate('/');
    expect(await screen.findByRole('heading', { name: "Today's sessions" })).toBeInTheDocument();

    /*
     * The invalidated query still renders its stale cached value for one
     * beat while the background refetch is in flight, so this has to wait
     * for the fresh answer rather than assert synchronously.
     */
    await waitFor(() => {
      expect(screen.queryByText('1 unread messages from unknown numbers')).toBeNull();
    });
  });
});
