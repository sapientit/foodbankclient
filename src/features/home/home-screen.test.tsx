import { focusManager, QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, delay, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import { platformStatsKeys } from '../platform-stats/keys';
import type { Session } from '../sessions/queries';

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    sessionDate: '2026-06-01',
    startTime: '10:00',
    startsAtUtc: '2026-06-01T09:00:00.000Z',
    durationMinutes: 90,
    location: 'St Mary’s Hall',
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    deliveryCapacity: 0,
    deliveryBooked: 0,
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
        user: { id: 'admin', email: 'admin@example.test', displayName: 'Ada Admin', role: 'admin' },
      }),
    ),
    http.get('/api/v1/sessions', () => HttpResponse.json({ sessions: [] })),
    http.get('/api/v1/referrals', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status');
      return HttpResponse.json({
        referrals: status === 'pending_review' ? [{ id: 'pending' }] : [{ id: 'active' }],
      });
    }),
    http.get('/api/v1/stock/items/low-stock-summary', () =>
      HttpResponse.json({ lowStockCount: 2 }),
    ),
    http.get('/api/v1/stock/take/volunteer-codes/latest', () =>
      HttpResponse.json({ latest: { expiresAt: 1_788_888_888, expiringSoon: false } }),
    ),
    http.get('/api/v1/sms-messages/attention-summary', () =>
      HttpResponse.json({
        activeSessionUnread: 4,
        closedSessionUnread: 3,
        unmatchedUnread: 2,
        referrerUnread: 1,
      }),
    ),
    http.get('/api/v1/platform-stats/usage/alert-summary', () =>
      HttpResponse.json({ windowDays: 14, daysWithExceededThreshold: 0 }),
    ),
  );
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('the administrator dashboard', () => {
  it('shows each non-zero administrator alert and the referral tile', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { name: "Today's sessions" })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Referrals' })).toBeInTheDocument();
    expect(await screen.findByText('2 stock items with low stock')).toBeInTheDocument();
    expect(await screen.findByText('2 referrals waiting for review')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '1 unread referrer messages' })).toHaveAttribute(
      'href',
      '/sms',
    );
    expect(
      screen.getByRole('link', { name: '3 unread messages from closed sessions' }),
    ).toHaveAttribute('href', '/sms/closed');
    expect(
      screen.getByRole('link', { name: '2 unread messages from unknown numbers' }),
    ).toHaveAttribute('href', '/sms/unknown');
    expect(
      screen.getByRole('link', { name: '4 unread messages from active sessions' }),
    ).toHaveAttribute('href', '/sms/normal');
    expect(screen.queryByText('Go to stock to reorder')).toBeNull();
    expect(screen.queryByText('Review and process referrals')).toBeNull();

    const checkReferrals = screen.getByRole('link', { name: 'Check referrals' });
    expect(checkReferrals.querySelectorAll('svg')).toHaveLength(0);
  });

  it('refreshes the SMS alerts every five minutes while the dashboard is foreground', async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    let requests = 0;
    server.use(
      http.get('/api/v1/sms-messages/attention-summary', () => {
        requests += 1;
        return HttpResponse.json({
          activeSessionUnread: 0,
          closedSessionUnread: 0,
          unmatchedUnread: 0,
          referrerUnread: 0,
        });
      }),
    );

    renderApp('/');
    await vi.waitFor(() => {
      expect(requests).toBe(1);
    });

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(requests).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => {
      expect(requests).toBe(2);
    });
  });

  it('does not poll SMS alerts while the dashboard tab is in the background', async () => {
    vi.useFakeTimers();
    focusManager.setFocused(false);
    let requests = 0;
    server.use(
      http.get('/api/v1/sms-messages/attention-summary', () => {
        requests += 1;
        return HttpResponse.json({
          activeSessionUnread: 0,
          closedSessionUnread: 0,
          unmatchedUnread: 0,
          referrerUnread: 0,
        });
      }),
    );

    renderApp('/');
    await vi.waitFor(() => {
      expect(requests).toBe(1);
    });

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(requests).toBe(1);
  });

  it('alerts an administrator when the latest volunteer code has under five days left', async () => {
    server.use(
      http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
      http.get('/api/v1/stock/items/low-stock-summary', () =>
        HttpResponse.json({ lowStockCount: 0 }),
      ),
      http.get('/api/v1/sms-messages/attention-summary', () =>
        HttpResponse.json({
          activeSessionUnread: 0,
          closedSessionUnread: 0,
          unmatchedUnread: 0,
          referrerUnread: 0,
        }),
      ),
      http.get('/api/v1/stock/take/volunteer-codes/latest', () =>
        HttpResponse.json({ latest: { expiresAt: 1_788_888_888, expiringSoon: true } }),
      ),
    );
    renderApp('/');

    const alert = await screen.findByRole('link', { name: /Volunteer code expires at/ });
    expect(alert).toHaveAttribute('href', '/stock/volunteer-code');
    expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();
  });

  it('does not show a volunteer-code alert when no unexpired code exists', async () => {
    server.use(
      http.get('/api/v1/stock/take/volunteer-codes/latest', () =>
        HttpResponse.json({ latest: null }),
      ),
    );
    renderApp('/');

    await screen.findByRole('heading', { name: 'Alerts' });
    expect(screen.queryByRole('link', { name: /Volunteer code expires at/ })).toBeNull();
  });

  it('does not show a false all-clear when checking the volunteer-code expiry fails', async () => {
    server.use(
      http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
      http.get('/api/v1/stock/items/low-stock-summary', () =>
        HttpResponse.json({ lowStockCount: 0 }),
      ),
      http.get('/api/v1/sms-messages/attention-summary', () =>
        HttpResponse.json({
          activeSessionUnread: 0,
          closedSessionUnread: 0,
          unmatchedUnread: 0,
          referrerUnread: 0,
        }),
      ),
      http.get('/api/v1/stock/take/volunteer-codes/latest', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Could not check the volunteer code',
              requestId: 'r1',
            },
          },
          { status: 500 },
        ),
      ),
    );
    renderApp('/');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong at our end');
    expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();
  });

  it('links an administrator to Cloudflare statistics when the server flags recent concerns', async () => {
    server.use(
      http.get('/api/v1/platform-stats/usage/alert-summary', () =>
        HttpResponse.json({ windowDays: 14, daysWithExceededThreshold: 2 }),
      ),
    );
    renderApp('/');

    const alert = await screen.findByRole('link', {
      name: '2 of the last 14 days exceeded a Cloudflare threshold',
    });
    expect(alert).toHaveAttribute('href', '/platform-stats/usage');
    expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();
  });

  it('does not show a false all-clear when checking Cloudflare concerns fails', async () => {
    server.use(
      http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
      http.get('/api/v1/stock/items/low-stock-summary', () =>
        HttpResponse.json({ lowStockCount: 0 }),
      ),
      http.get('/api/v1/sms-messages/attention-summary', () =>
        HttpResponse.json({
          activeSessionUnread: 0,
          closedSessionUnread: 0,
          unmatchedUnread: 0,
          referrerUnread: 0,
        }),
      ),
      http.get('/api/v1/platform-stats/usage/alert-summary', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Could not check Cloudflare usage',
              requestId: 'r1',
            },
          },
          { status: 500 },
        ),
      ),
    );
    renderApp('/');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong at our end');
    expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();
  });

  it('does not show a cached Cloudflare all-clear while a refreshed summary is loading', async () => {
    let concernDays = 0;
    let delayRefresh = false;
    server.use(
      http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
      http.get('/api/v1/stock/items/low-stock-summary', () =>
        HttpResponse.json({ lowStockCount: 0 }),
      ),
      http.get('/api/v1/stock/take/volunteer-codes/latest', () =>
        HttpResponse.json({ latest: null }),
      ),
      http.get('/api/v1/sms-messages/attention-summary', () =>
        HttpResponse.json({
          activeSessionUnread: 0,
          closedSessionUnread: 0,
          unmatchedUnread: 0,
          referrerUnread: 0,
        }),
      ),
      http.get('/api/v1/platform-stats/usage/alert-summary', async () => {
        if (delayRefresh) await delay(300);
        return HttpResponse.json({ windowDays: 14, daysWithExceededThreshold: concernDays });
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } },
    });
    renderApp('/', queryClient);

    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
    concernDays = 1;
    delayRefresh = true;
    void queryClient.invalidateQueries({ queryKey: platformStatsKeys.alertSummary() });

    expect(await screen.findByText('Loading alerts…')).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();
    expect(
      await screen.findByRole('link', {
        name: '1 of the last 14 days exceeded a Cloudflare threshold',
      }),
    ).toBeInTheDocument();
  });

  it('refreshes a cached dashboard alert after generating a replacement code', async () => {
    let expiringSoon = true;
    server.use(
      http.get('/api/v1/stock/take/volunteer-codes/latest', () =>
        HttpResponse.json({ latest: { expiresAt: 1_788_888_888, expiringSoon } }),
      ),
      http.post('/api/v1/stock/take/volunteer-codes', () => {
        expiringSoon = false;
        return HttpResponse.json(
          { code: 'KP7Q-4XZM-9RTW-2NJH', expiresAt: 1_788_888_888 },
          { status: 201 },
        );
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } },
    });
    const { router } = renderApp('/', queryClient);
    const user = userEvent.setup();

    await screen.findByRole('link', { name: /Volunteer code expires at/ });
    await router.navigate('/stock/volunteer-code');
    await user.click(await screen.findByRole('button', { name: 'Generate a code' }));
    await screen.findByText('KP7Q-4XZM-9RTW-2NJH');
    await router.navigate('/');

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /Volunteer code expires at/ })).toBeNull();
    });
  });

  /*
   * Regression test: the Referrals tile and the Alerts section used to derive
   * their counts as `data ?? 0`/`?? []` with no `isPending` check, so before
   * these admin-only queries resolved the screen showed "0 waiting for
   * review" and "Nothing needs attention" — a false all-clear a volunteer
   * could act on. Delaying the responses proves the loading window is
   * covered, not just the settled state `findByText` would wait past.
   */
  it('never shows a false all-clear while the alert counts are still loading', async () => {
    // Every other count is genuinely zero here, and only low-stock is
    // delayed — so the old `data ?? 0` logic would read "Nothing needs
    // attention" the moment auth settles, and be wrong the instant the
    // delayed query resolves non-zero a beat later.
    server.use(
      http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
      http.get('/api/v1/sms-messages/attention-summary', () =>
        HttpResponse.json({
          activeSessionUnread: 0,
          closedSessionUnread: 0,
          unmatchedUnread: 0,
          referrerUnread: 0,
        }),
      ),
      http.get('/api/v1/stock/items/low-stock-summary', async () => {
        await delay(300);
        return HttpResponse.json({ lowStockCount: 2 });
      }),
    );
    renderApp('/');
    expect(await screen.findByRole('heading', { name: "Today's sessions" })).toBeInTheDocument();

    // Still mid-flight: the low-stock query has not resolved yet.
    expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();

    expect(await screen.findByText('2 stock items with low stock')).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs attention right now.')).toBeNull();
  });

  it('puts each session happening today in its own card', async () => {
    server.use(
      http.get('/api/v1/sessions', () =>
        HttpResponse.json({
          sessions: [
            session({ id: 'morning', startTime: '09:00' }),
            session({ id: 'afternoon', startTime: '14:00' }),
          ],
        }),
      ),
    );
    renderApp('/');

    expect(await screen.findByRole('heading', { name: '09:00–10:30' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '14:00–15:30' })).toBeInTheDocument();
    const todaySection = screen
      .getByRole('heading', { name: "Today's sessions" })
      .closest('section');
    if (todaySection === null) throw new Error("Today's sessions section is missing.");
    expect(within(todaySection).getAllByText('10 of 25 bookings')).toHaveLength(2);
    expect(within(todaySection).getAllByText('Collection Only')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Run session, 09:00–10:30' })).toHaveAttribute(
      'href',
      '/run-sessions/morning',
    );
    expect(screen.getByRole('link', { name: 'Run session, 14:00–15:30' })).toHaveAttribute(
      'href',
      '/run-sessions/afternoon',
    );
    expect(
      screen.getByRole('link', { name: 'Run session, 09:00–10:30' }).querySelectorAll('svg'),
    ).toHaveLength(0);
  });

  it('takes an upcoming session date to Run a session while keeping the run and amend controls', async () => {
    server.use(
      http.get('/api/v1/sessions', () =>
        HttpResponse.json({ sessions: [session({ id: 's1', startTime: '09:00' })] }),
      ),
    );
    renderApp('/');

    const date = await screen.findByRole('link', { name: 'Mon, 1 Jun 2026, 09:00–10:30' });
    expect(date).toHaveAttribute('href', '/run-sessions/s1');
    expect(
      screen.getByRole('link', { name: 'Run session, Mon, 1 Jun 2026, 09:00–10:30' }),
    ).toHaveAttribute('href', '/run-sessions/s1');
    expect(
      screen.getByRole('link', { name: 'Amend session, Mon, 1 Jun 2026, 09:00–10:30' }),
    ).toHaveAttribute('href', '/sessions/s1');
  });
});

describe('the upcoming-sessions table, Custom range', () => {
  /*
   * Regression test: `page` was only reset to 1 inside the tab buttons'
   * `onClick`. Narrowing Custom range's own From/To fields changes the
   * fetched range without going through a tab click, so a page number kept
   * from a wider range could point past the end of a narrower one and show a
   * false "No sessions fall in this range" even though sessions exist on
   * page 1 of the new range.
   */
  it('resets to page 1 when the custom date range narrows without a tab click', async () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      session({
        id: `s${String(i + 1)}`,
        sessionDate: `2026-06-${String(i + 1).padStart(2, '0')}`,
        startsAtUtc: `2026-06-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`,
      }),
    );
    server.use(
      http.get('/api/v1/sessions', ({ request }) => {
        const url = new URL(request.url);
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '9999-12-31';
        return HttpResponse.json({
          sessions: sessions.filter((s) => s.sessionDate >= from && s.sessionDate <= to),
        });
      }),
    );

    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { name: "Today's sessions" });

    await user.click(screen.getByRole('tab', { name: 'Custom range' }));
    const from = await screen.findByLabelText('From');
    const to = screen.getByLabelText('To');
    // `type="date"` inputs are not reliably driven by `userEvent.type` in
    // jsdom — `fireEvent.change` is the pattern the rest of this codebase
    // uses for them (see `sessions-screen.test.tsx`).
    fireEvent.change(from, { target: { value: '2026-06-01' } });
    fireEvent.change(to, { target: { value: '2026-06-30' } });

    await screen.findByText('Page 1 of 2');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Page 2 of 2');

    // Narrow the range to only the first three sessions — page 2 no longer
    // exists in it.
    fireEvent.change(to, { target: { value: '2026-06-03' } });

    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(4); // header + 3 sessions
    });
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    expect(screen.queryByText('No sessions fall in this range.')).toBeNull();
  });

  it('moves through the session range tabs with the keyboard', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const thisWeek = await screen.findByRole('tab', { name: 'This week', selected: true });

    thisWeek.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Next week', selected: true })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Custom range', selected: true })).toHaveFocus();
    const custom = screen.getByRole('tab', { name: 'Custom range', selected: true });
    const panel = screen.getByRole('tabpanel');
    expect(custom).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', custom.id);
  });
});
