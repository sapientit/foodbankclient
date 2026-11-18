import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { Session } from '../../sessions/queries';
import type { Referral } from '../queries';

/** Signed in as Pete, an administrator. See `test/render-app.tsx`. */
const REFRESH = '/api/v1/auth/refresh';
const REFERRALS_CHECK = '/api/v1/referrals/check';
const SESSIONS = '/api/v1/sessions';
const PAGE_SIZE = 40;

function referral(overrides: Partial<Referral> & Pick<Referral, 'id'>): Referral {
  return {
    sessionId: 's1',
    status: 'active',
    referredAt: '2026-07-01T10:00:00.000Z',
    adults: 2,
    children: 1,
    householdSize: 3,
    isDelivery: false,
    collectionMethod: 'collection',
    needsFuelHelp: false,
    referrerOrganisation: 'Riverside Church',
    referrerName: 'Sam Referrer',
    refereeFirstName: 'Jamie',
    refereeSurname: 'Rowe',
    refereeDateOfBirth: '1985-03-12',
    refereeAddress: '1 Elm Street',
    refereePostcode: 'AB1 2CD',
    refereePhone: null,
    answers: {},
    formId: null,
    ...overrides,
  };
}

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    sessionDate: '2026-08-04',
    startTime: '10:00',
    startsAtUtc: '2026-08-04T09:00:00.000Z',
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

/**
 * The real shape of `GET /referrals/check`'s envelope for a one-page answer —
 * `referrals.length` referrals, on page 1, reported as the whole match.
 */
function page(referrals: Referral[]) {
  return { referrals, page: 1, pageSize: PAGE_SIZE, totalCount: referrals.length };
}

/**
 * A handler that actually paginates, the way the server does: given the
 * whole matching set, it slices forty at a time and reports the true
 * `totalCount`, reading `page` off the request the same way the server
 * reads it. Used by the pagination tests, which need a real page 2 to
 * click through to rather than one canned response.
 */
function pagedHandler(all: Referral[]) {
  return http.get(REFERRALS_CHECK, ({ request }) => {
    const requestedPage = Number.parseInt(new URL(request.url).searchParams.get('page') ?? '1', 10);
    const referrals = all.slice((requestedPage - 1) * PAGE_SIZE, requestedPage * PAGE_SIZE);
    return HttpResponse.json({
      referrals,
      page: requestedPage,
      pageSize: PAGE_SIZE,
      totalCount: all.length,
    });
  });
}

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get(SESSIONS, () => HttpResponse.json({ sessions: [session({ id: 's1' })] })),
  );
});

describe('the referrals list', () => {
  it('does not include a session location in the filter choices', async () => {
    server.use(
      http.get(SESSIONS, () =>
        HttpResponse.json({ sessions: [session({ id: 's1', location: 'Old hall' })] }),
      ),
      http.get(REFERRALS_CHECK, () => HttpResponse.json(page([]))),
    );

    renderApp('/referrals');

    expect(await screen.findByLabelText('Session')).not.toHaveTextContent('Old hall');
  });

  it('clears the filters and the page back to the privacy-safe list URL', async () => {
    server.use(http.get(REFERRALS_CHECK, () => HttpResponse.json(page([referral({ id: 'r1' })]))));
    const { router } = renderApp('/referrals?sessionId=s1&status=cancelled&page=2');
    const user = userEvent.setup();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check referrals' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Referrals' })).toBeInTheDocument();
    expect(screen.getByLabelText('Session')).toHaveValue('s1');
    expect(screen.getByLabelText('Status')).toHaveValue('cancelled');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    expect(screen.getByLabelText('Session')).toHaveValue('');
    expect(screen.getByLabelText('Status')).toHaveValue('');
  });

  it('highlights a referral still to be read so it stands out from reviewed ones', async () => {
    server.use(
      http.get(REFERRALS_CHECK, () =>
        HttpResponse.json(
          page([
            // Surnames deliberately unlike any status word: matching a row by a
            // name that is also a label is how this assertion would pass on the
            // wrong row.
            referral({ id: 'active', status: 'active', refereeSurname: 'Unread' }),
            referral({ id: 'reviewed', status: 'reviewed', refereeSurname: 'Alreadyread' }),
          ]),
        ),
      ),
    );

    renderApp('/referrals');

    expect((await screen.findByRole('row', { name: /Unread/ })).dataset.active).toBe('true');
    expect(screen.getByRole('row', { name: /Alreadyread/ }).dataset.active).toBeUndefined();
  });

  it('names the two waiting statuses apart — the referrer decision is not the read-through', async () => {
    server.use(
      http.get(REFERRALS_CHECK, () =>
        HttpResponse.json(
          page([
            referral({ id: 'held', status: 'pending_review', refereeSurname: 'Held' }),
            referral({ id: 'unread', status: 'active', refereeSurname: 'Unread' }),
            referral({ id: 'read', status: 'reviewed', refereeSurname: 'Alreadyread' }),
          ]),
        ),
      ),
    );

    renderApp('/referrals');

    // `pending_review` is a decision about the referrer, not an earlier stage of
    // the read-through that `reviewed` records, so it must not borrow its word.
    const held = await screen.findByRole('row', { name: /Held/ });
    expect(held).toHaveTextContent('Approve referrer');
    expect(held).not.toHaveTextContent(/review(ed)?\b/i);

    expect(screen.getByRole('row', { name: /Unread/ })).toHaveTextContent('Pending review');
    expect(screen.getByRole('row', { name: /Alreadyread/ })).toHaveTextContent('Reviewed');
  });

  it('lists a referral with its household size, organisation and status', async () => {
    server.use(http.get(REFERRALS_CHECK, () => HttpResponse.json(page([referral({ id: 'r1' })]))));

    renderApp('/referrals');

    expect(await screen.findByRole('rowheader', { name: 'Rowe, Jamie' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Rowe, Jamie/ });
    expect(row).toHaveTextContent('2 adults, 1 child');
    expect(row).toHaveTextContent('Riverside Church');
    expect(row).toHaveTextContent('Pending review');
  });

  it('gives every row a named action to open it, alongside the name link', async () => {
    server.use(http.get(REFERRALS_CHECK, () => HttpResponse.json(page([referral({ id: 'r1' })]))));

    renderApp('/referrals');

    const view = await screen.findByRole('link', { name: 'View Rowe, Jamie' });
    expect(view).toHaveAttribute('href', '/referrals/r1');
  });

  it('marks pending-review referrals as needing attention', async () => {
    server.use(
      http.get(REFERRALS_CHECK, () =>
        HttpResponse.json(page([referral({ id: 'r1', status: 'pending_review' })])),
      ),
    );

    renderApp('/referrals');

    expect(await screen.findByRole('row', { name: /Rowe, Jamie/ })).toHaveAttribute(
      'data-pending-review',
      'true',
    );
  });

  /*
   * The server already returns the attention-first, thirty-day-bounded,
   * forty-at-a-time answer (`GET /referrals/check`, `../foodbankserver`
   * `INITIAL_SPEC1.txt`, "Checking referrals") — this screen's own job is
   * only to render exactly what came back, in that order. A client-side
   * re-sort here would either duplicate the server's rule or drift from
   * it, so this proves rows land in the order the mock gave them even
   * though a pending referral is deliberately placed after an active one.
   */
  it('renders rows in the order the server returns them, without re-sorting', async () => {
    server.use(
      http.get(REFERRALS_CHECK, () =>
        HttpResponse.json(
          page([
            referral({ id: 'r1', status: 'active', refereeSurname: 'First' }),
            referral({ id: 'r2', status: 'pending_review', refereeSurname: 'Second' }),
          ]),
        ),
      ),
    );

    renderApp('/referrals');

    const rows = await screen.findAllByRole('row');
    expect(rows[1]).toHaveTextContent('First');
    expect(rows[2]).toHaveTextContent('Second');
  });

  it('shows an empty state when nothing matches', async () => {
    server.use(http.get(REFERRALS_CHECK, () => HttpResponse.json(page([]))));

    renderApp('/referrals');

    expect(await screen.findByText('No referrals to show')).toBeInTheDocument();
  });

  it('filters by status, and sends only ids, the status enum and the page in the request — never a name or address', async () => {
    let requestedUrl = '';
    server.use(
      http.get(REFERRALS_CHECK, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(page([referral({ id: 'r1' })]));
      }),
    );

    renderApp('/referrals');
    const user = userEvent.setup();

    await screen.findByRole('rowheader', { name: 'Rowe, Jamie' });
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');

    await waitFor(() => {
      expect(new URL(requestedUrl).searchParams.get('status')).toBe('cancelled');
    });

    const url = new URL(requestedUrl);
    // Every key the server actually saw is an id, the status enum or the
    // page number — nothing that could be a referee's name, address or
    // phone.
    for (const key of url.searchParams.keys()) {
      expect(['sessionId', 'status', 'page']).toContain(key);
    }
  });

  it('filters by session id from the session dropdown', async () => {
    let requestedUrl = '';
    server.use(
      http.get(REFERRALS_CHECK, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(page([]));
      }),
    );

    renderApp('/referrals');
    const user = userEvent.setup();

    await screen.findByText('No referrals to show');
    await user.selectOptions(screen.getByLabelText('Session'), 's1');

    await waitFor(() => {
      expect(new URL(requestedUrl).searchParams.get('sessionId')).toBe('s1');
    });
  });

  it('pages the referral list at 40 to a page', async () => {
    const referrals = Array.from({ length: 45 }, (_, i) =>
      referral({
        id: `r${String(i + 1)}`,
        refereeSurname: `Surname${String(i + 1).padStart(2, '0')}`,
      }),
    );
    server.use(pagedHandler(referrals));

    const user = userEvent.setup();
    renderApp('/referrals');

    await screen.findByText('45 referrals found');
    expect(screen.getAllByRole('row')).toHaveLength(41); // header row + 40 referrals
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    await screen.findByText('Page 2 of 2');
    expect(screen.getAllByRole('row')).toHaveLength(6); // header row + 5 referrals
  });

  it('asks the server for page 2 by its own page parameter, not by slicing on the client', async () => {
    let requestedPages: string[] = [];
    server.use(
      http.get(REFERRALS_CHECK, ({ request }) => {
        const requestedPage = new URL(request.url).searchParams.get('page') ?? '1';
        requestedPages = [...requestedPages, requestedPage];
        return HttpResponse.json(
          requestedPage === '1'
            ? { referrals: [referral({ id: 'r1' })], page: 1, pageSize: 40, totalCount: 41 }
            : { referrals: [referral({ id: 'r2' })], page: 2, pageSize: 40, totalCount: 41 },
        );
      }),
    );

    const user = userEvent.setup();
    renderApp('/referrals');

    await screen.findByText('41 referrals found');
    await user.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => {
      expect(requestedPages).toContain('2');
    });
  });

  it('drops the page from the URL when a filter changes what the current page would show', async () => {
    const unfiltered = Array.from({ length: 45 }, (_, i) =>
      referral({ id: `r${String(i + 1)}`, refereeSurname: `Surname${String(i + 1)}` }),
    );
    const cancelled = Array.from({ length: 41 }, (_, i) =>
      referral({
        id: `c${String(i + 1)}`,
        status: 'cancelled',
        refereeSurname: `Cancelled${String(i + 1)}`,
      }),
    );
    server.use(
      http.get(REFERRALS_CHECK, ({ request }) => {
        const url = new URL(request.url);
        const status = url.searchParams.get('status');
        const all = status === null ? unfiltered : cancelled;
        const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
        return HttpResponse.json({
          referrals: all.slice((requestedPage - 1) * PAGE_SIZE, requestedPage * PAGE_SIZE),
          page: requestedPage,
          pageSize: PAGE_SIZE,
          totalCount: all.length,
        });
      }),
    );

    const user = userEvent.setup();
    const { router } = renderApp('/referrals');

    await screen.findByText('Page 1 of 2');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByRole('rowheader', { name: 'Surname45, Jamie' });
    expect(router.state.location.search).toContain('page=2');

    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');

    await screen.findByText('Page 1 of 2');
    expect(screen.getByRole('rowheader', { name: 'Cancelled1, Jamie' })).toBeInTheDocument();
    expect(screen.queryByText(/Surname/)).not.toBeInTheDocument();
    expect(router.state.location.search).not.toContain('page=');
  });

  it('shows no pager when the current filter has nothing to page through', async () => {
    server.use(
      http.get(REFERRALS_CHECK, ({ request }) => {
        const status = new URL(request.url).searchParams.get('status');
        return HttpResponse.json(page(status === null ? [referral({ id: 'r1' })] : []));
      }),
    );

    const user = userEvent.setup();
    renderApp('/referrals');

    await screen.findByText('1 referral found');
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');

    await waitFor(() => {
      expect(screen.getByText('No referrals to show')).toBeInTheDocument();
    });
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  /*
   * Regression test for `useReferralsForCheck`'s `placeholderData:
   * keepPreviousData` (`queries.ts`). Without it, picking a filter
   * combination this screen has never fetched before flips
   * `referrals.isSuccess` to `false` while it loads, which unmounts the
   * whole results section — table, row links and the pager — in favour of
   * the spinner and remounts it once the answer arrives. Anything that had
   * focus inside that section (a row link, or the pager's own
   * Previous/Next button) is dropped to `<body>` with nothing announced
   * when that happens. This proves the section stays mounted across the
   * fetch. The response is held open until the assertion runs, so this
   * proves the in-between state rather than racing it — the same
   * held-response pattern as `referral-detail-screen.test.tsx`'s
   * double-click guard test.
   */
  it('keeps the previous result on screen while a newly chosen, uncached filter is still loading', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let releaseResponse: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    server.use(
      http.get(REFERRALS_CHECK, async ({ request }) => {
        const status = new URL(request.url).searchParams.get('status');
        if (status === null) return HttpResponse.json(page([referral({ id: 'r1' })]));
        await held;
        return HttpResponse.json(page([]));
      }),
    );

    renderApp('/referrals', client);
    const user = userEvent.setup();

    await screen.findByRole('link', { name: 'View Rowe, Jamie' });

    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');

    // The new filter's request is held open deliberately: while it is in
    // flight, the previous result must still be in the document rather than
    // swapped out for the spinner or the empty state.
    expect(screen.getByRole('link', { name: 'View Rowe, Jamie' })).toBeInTheDocument();
    expect(screen.queryByText('No referrals to show')).toBeNull();

    releaseResponse?.();

    await waitFor(() => {
      expect(screen.getByText('No referrals to show')).toBeInTheDocument();
    });
  });
});
