import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, delay, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
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
    http.get('/api/v1/sms-messages/attention-summary', () => HttpResponse.json({ unreadTotal: 3 })),
  );
});

describe('the administrator dashboard', () => {
  it('shows each non-zero administrator alert and the referral tile', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { name: "Today's sessions" })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Referrals' })).toBeInTheDocument();
    expect(await screen.findByText('2 stock items with low stock')).toBeInTheDocument();
    expect(await screen.findByText('2 referrals waiting for review')).toBeInTheDocument();
    expect(await screen.findByText('3 unread SMS messages')).toBeInTheDocument();
    expect(screen.queryByText('Go to stock to reorder')).toBeNull();
    expect(screen.queryByText('Review and process referrals')).toBeNull();
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
        HttpResponse.json({ unreadTotal: 0 }),
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
    expect(screen.getAllByText('10 of 25')).toHaveLength(4);
    expect(screen.queryByText('10 of 25 booked')).toBeNull();
    expect(screen.getByRole('link', { name: 'Run session, 09:00–10:30' })).toHaveAttribute(
      'href',
      '/run-sessions/morning',
    );
    expect(screen.getByRole('link', { name: 'Run session, 14:00–15:30' })).toHaveAttribute(
      'href',
      '/run-sessions/afternoon',
    );
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
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 2');

    // Narrow the range to only the first three sessions — page 2 no longer
    // exists in it.
    fireEvent.change(to, { target: { value: '2026-06-03' } });

    expect(await screen.findByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.queryByText('No sessions fall in this range.')).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(4); // header + 3 sessions
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
