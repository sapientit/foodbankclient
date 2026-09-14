import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Referral } from '../referrals/queries';

const INBOX = '/api/v1/sms-messages';
const MESSAGE_READ = '/api/v1/sms-messages/:id/read';
const REFERRAL_READ = '/api/v1/referrals/:id/sms-messages/read';
const REFRESH = '/api/v1/auth/refresh';
const REFERRAL_2 = '/api/v1/referrals/referral-2';
const REFERRAL_3 = '/api/v1/referrals/referral-3';
const REFERRAL_4 = '/api/v1/referrals/referral-4';
const REFERRAL_5 = '/api/v1/referrals/referral-5';
const REFERRAL_6 = '/api/v1/referrals/referral-6';

/*
 * Threads for this fixture:
 *  - +441111111111 (loose): message-1, message-1b — both unread, no referral.
 *  - +442222222222 (active session): message-2 — unread, referral-2.
 *  - +443333333333 (closed session): message-3 (referral-3) and message-5
 *    (referral-5) — a phone reused across a repeat referral, both unread.
 *  - +444444444444 (closed session): message-4 — a staff reply, referral-4,
 *    never unread.
 *  - +445555555555 (closed session): message-6 — a `failure` only, referral-6,
 *    arrives already read.
 *  - +446666666666 (referrer): message-7 — one reply with two possible open
 *    parcels, neither named here.
 */
const MESSAGES = [
  {
    id: 'message-1',
    referralId: null,
    kind: 'household_reply' as const,
    body: 'Can I come later?',
    occurredAt: '2026-08-22T09:00:00.000Z',
    readAt: null,
    recipientRole: null,
    location: 'unmatched' as const,
    session: null,
    simulated: false,
    phone: '+441111111111',
  },
  {
    id: 'message-1b',
    referralId: null,
    kind: 'household_reply' as const,
    body: 'Hello, anybody there?',
    occurredAt: '2026-08-22T09:05:00.000Z',
    readAt: null,
    recipientRole: null,
    location: 'unmatched' as const,
    session: null,
    simulated: false,
    phone: '+441111111111',
  },
  {
    id: 'message-2',
    referralId: 'referral-2',
    kind: 'household_reply' as const,
    body: 'I am running late.',
    occurredAt: '2026-08-22T08:00:00.000Z',
    readAt: null,
    recipientRole: null,
    location: 'active_session' as const,
    session: {
      id: 'session-2',
      sessionDate: '2026-08-23',
      startTime: '10:00',
      status: 'planned' as const,
    },
    simulated: false,
    phone: '+442222222222',
  },
  {
    id: 'message-3',
    referralId: 'referral-3',
    kind: 'household_reply' as const,
    body: 'Thank you.',
    occurredAt: '2026-08-21T08:00:00.000Z',
    readAt: null,
    recipientRole: null,
    location: 'closed_session' as const,
    session: {
      id: 'session-3',
      sessionDate: '2026-08-20',
      startTime: '10:00',
      status: 'confirmed' as const,
    },
    simulated: false,
    phone: '+443333333333',
  },
  {
    id: 'message-5',
    referralId: 'referral-5',
    kind: 'household_reply' as const,
    body: 'Are you still open today?',
    occurredAt: '2026-08-23T08:00:00.000Z',
    readAt: null,
    recipientRole: null,
    location: 'closed_session' as const,
    session: {
      id: 'session-6',
      sessionDate: '2026-08-22',
      startTime: '11:00',
      status: 'confirmed' as const,
    },
    simulated: false,
    phone: '+443333333333',
  },
  {
    id: 'message-4',
    referralId: 'referral-4',
    kind: 'staff_reply' as const,
    body: 'We will keep your parcel for you.',
    occurredAt: '2026-08-20T08:00:00.000Z',
    readAt: null,
    recipientRole: 'referee' as const,
    location: 'closed_session' as const,
    session: {
      id: 'session-3',
      sessionDate: '2026-08-20',
      startTime: '10:00',
      status: 'confirmed' as const,
    },
    simulated: true,
    phone: '+444444444444',
  },
  {
    id: 'message-6',
    referralId: 'referral-6',
    kind: 'failure' as const,
    body: 'No mobile number on file.',
    occurredAt: '2026-08-19T08:00:00.000Z',
    readAt: '2026-08-19T08:00:00.000Z',
    recipientRole: null,
    location: 'closed_session' as const,
    session: {
      id: 'session-9',
      sessionDate: '2026-08-18',
      startTime: '09:00',
      status: 'confirmed' as const,
    },
    simulated: false,
    phone: '+445555555555',
  },
  {
    id: 'message-7',
    referralId: null,
    kind: 'referrer_reply' as const,
    body: 'I can collect both parcels.',
    occurredAt: '2026-08-23T09:00:00.000Z',
    readAt: null,
    recipientRole: 'referrer' as const,
    location: 'unmatched' as const,
    session: null,
    simulated: false,
    phone: '+446666666666',
    candidateParcels: [
      {
        referralId: 'referral-7',
        sessionId: 'session-7',
        sessionDate: '2026-08-25',
        startTime: '10:00',
      },
      {
        referralId: 'referral-8',
        sessionId: 'session-8',
        sessionDate: '2026-08-26',
        startTime: '11:30',
      },
    ],
  },
];

function referralRow(overrides: Partial<Referral> & Pick<Referral, 'id'>): Referral {
  return {
    sessionId: 's1',
    status: 'active',
    referredAt: '2026-07-01T10:00:00.000Z',
    adults: 1,
    children: 0,
    householdSize: 1,
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
    piiPurgedAt: null,
    reasonId: 'q1',
    referrerEmail: 'referrer@riverside.org',
    referrerPhone: null,
    ...overrides,
  };
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
    http.get(INBOX, () => HttpResponse.json({ messages: MESSAGES })),
    http.get(REFERRAL_2, () =>
      HttpResponse.json(
        referralRow({ id: 'referral-2', refereeFirstName: 'Ada', refereeSurname: 'Rowe' }),
      ),
    ),
    http.get(REFERRAL_3, () =>
      HttpResponse.json(
        referralRow({ id: 'referral-3', refereeFirstName: 'Bea', refereeSurname: 'Rowe' }),
      ),
    ),
    http.get(REFERRAL_4, () =>
      HttpResponse.json(
        referralRow({ id: 'referral-4', refereeFirstName: 'Cass', refereeSurname: 'Rowe' }),
      ),
    ),
    http.get(REFERRAL_5, () =>
      HttpResponse.json(
        referralRow({ id: 'referral-5', refereeFirstName: 'Dee', refereeSurname: 'Rowe' }),
      ),
    ),
    http.get(REFERRAL_6, () =>
      HttpResponse.json(
        referralRow({ id: 'referral-6', refereeFirstName: 'Eve', refereeSurname: 'Rowe' }),
      ),
    ),
    // Neither read endpoint is expected to be hit unless a test opts in — a
    // 500 default means an unexpected call fails loudly rather than silently
    // succeeding.
    http.post(MESSAGE_READ, () =>
      HttpResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 }),
    ),
    http.post(REFERRAL_READ, () =>
      HttpResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 }),
    ),
  );
});

describe('SmsInboxLayout — Session messages tab', () => {
  it('groups by phone, shows the most recent household name and badges the tab with only administrator-actionable unread', async () => {
    renderApp('/sms');

    expect(await screen.findByRole('heading', { name: 'Session messages' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Messages for active sessions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Messages for closed sessions' }),
    ).toBeInTheDocument();

    expect(await screen.findByText('Ada Rowe')).toBeInTheDocument();
    // referral-3 and referral-5 share a phone number and thread together —
    // only the most recent (referral-5, "Dee Rowe") names the group.
    expect(await screen.findByText('Dee Rowe')).toBeInTheDocument();
    expect(screen.queryByText('Bea Rowe')).not.toBeInTheDocument();
    expect(await screen.findByText('Cass Rowe')).toBeInTheDocument();
    expect(await screen.findByText('Eve Rowe')).toBeInTheDocument();

    // Only the closed-session replies (referral-3 and referral-5, both on
    // the same thread) need administrator attention; the active-session one
    // stays the team leader's and is excluded from the badge.
    const sessionTab = screen.getByRole('link', { name: 'Session messages (2 unread)' });
    expect(within(sessionTab).getByText('2')).toBeInTheDocument();
  });

  it('shows the unread count in words, not colour alone', async () => {
    renderApp('/sms');

    const summary = await screen.findByText('Ada Rowe');
    expect(summary.closest('summary')).toHaveTextContent('1 unread');
  });

  it('shows an informational note, no unread flag and no mark-read control for a thread with only a failed reminder', async () => {
    renderApp('/sms');
    const user = userEvent.setup();

    const eveSummary = (await screen.findByText('Eve Rowe')).closest('summary');
    if (eveSummary === null) throw new Error('Expected a summary element');
    expect(eveSummary).toHaveTextContent('A reminder failed to send.');
    expect(eveSummary).not.toHaveTextContent('unread');

    await user.click(eveSummary);
    expect(screen.queryByRole('button', { name: 'Mark read' })).not.toBeInTheDocument();
    // Both read endpoints are stubbed to fail in `beforeEach`; an alert here
    // would mean a mark-read call fired that should not have.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not mark an active-session reply read on open, even though it is unread', async () => {
    let messageReadCalls = 0;
    let referralReadCalls = 0;
    server.use(
      http.post(MESSAGE_READ, () => {
        messageReadCalls += 1;
        return HttpResponse.json(MESSAGES[2]);
      }),
      http.post(REFERRAL_READ, () => {
        referralReadCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp('/sms');
    const user = userEvent.setup();

    const active = (
      await screen.findByRole('heading', { name: 'Messages for active sessions' })
    ).closest('section');
    if (active === null) throw new Error('Expected active-session group');
    await user.click(await within(active).findByText('Ada Rowe'));
    expect(await within(active).findByText(/I am running late/)).toBeInTheDocument();

    expect(messageReadCalls).toBe(0);
    expect(referralReadCalls).toBe(0);
  });

  it('fires one mark-read call per referralId when a closed-session thread spanning two referrals is opened', async () => {
    const readReferralIds: string[] = [];
    server.use(
      http.post(REFERRAL_READ, ({ params }) => {
        readReferralIds.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp('/sms');
    const user = userEvent.setup();

    await user.click(await screen.findByText('Dee Rowe'));

    await waitFor(() => {
      expect([...readReferralIds].sort()).toEqual(['referral-3', 'referral-5']);
    });
    // Idempotent per referral, not per message: two unread messages on the
    // thread but only one referral each, so exactly two calls in total.
    expect(readReferralIds).toHaveLength(2);
  });

  it('surfaces an error when one of two referrals on a thread fails to mark read, even though the other succeeds', async () => {
    server.use(
      http.post(REFERRAL_READ, ({ params }) => {
        if (params.id === 'referral-3') {
          return HttpResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 });
        }
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp('/sms');
    const user = userEvent.setup();

    await user.click(await screen.findByText('Dee Rowe'));

    // A shared mutation hook re-pointed at the second (successful) call
    // would silently drop the first call's failure — this proves the
    // component tracks the loop's outcome itself rather than trusting
    // `useMarkSmsRead()`'s own `isError`/`error`.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('never fires a mark-read call for a closed-session thread with no unread reply', async () => {
    let referralReadCalls = 0;
    server.use(
      http.post(REFERRAL_READ, () => {
        referralReadCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp('/sms');
    const user = userEvent.setup();

    await user.click(await screen.findByText('Cass Rowe'));
    expect(await screen.findByText('staff reply (simulated)')).toBeInTheDocument();
    expect(referralReadCalls).toBe(0);
  });
});

describe('SmsInboxLayout — Loose messages tab', () => {
  it('threads a phone with several loose replies, badged on its own tab', async () => {
    renderApp('/sms/unmatched');

    expect(await screen.findByRole('heading', { name: 'Loose messages' })).toBeInTheDocument();
    expect(await screen.findByText('Phone: +441111111111')).toBeInTheDocument();
    expect(screen.queryByText('I am running late.')).not.toBeInTheDocument();
    expect(screen.queryByText('Thank you.')).not.toBeInTheDocument();
    expect(screen.queryByText('I can collect both parcels.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Loose messages (2 unread)' })).toBeInTheDocument();
  });

  it('fires one mark-read call per unread message when a loose thread is opened', async () => {
    const readMessageIds: string[] = [];
    server.use(
      http.post(MESSAGE_READ, ({ params }) => {
        readMessageIds.push(String(params.id));
        return HttpResponse.json({ ...MESSAGES[0], readAt: '2026-08-22T09:10:00.000Z' });
      }),
    );
    renderApp('/sms/unmatched');
    const user = userEvent.setup();

    await user.click(await screen.findByText('Phone: +441111111111'));

    await waitFor(() => {
      expect([...readMessageIds].sort()).toEqual(['message-1', 'message-1b']);
    });
  });

  it('opens referral search with an unmatched sender number pre-filled without putting it in the URL', async () => {
    let searchBody: unknown;
    server.use(
      http.get('/api/v1/referral-reasons', () => HttpResponse.json({ referralReasons: [] })),
      http.post('/api/v1/referrals/search', async ({ request }) => {
        searchBody = await request.json();
        return HttpResponse.json({ count: 0, results: [] });
      }),
    );
    const { router } = renderApp('/sms/unmatched');
    const user = userEvent.setup();

    // The link only appears once the thread is opened — the same accordion
    // shape as a team lead's own thread view.
    await user.click(await screen.findByText('Phone: +441111111111'));
    await user.click(await screen.findByRole('link', { name: 'Search referrals for this number' }));

    expect(await screen.findByRole('heading', { name: 'Search referrals' })).toBeInTheDocument();
    expect(screen.getByLabelText('Phone number')).toHaveValue('+441111111111');
    expect(await screen.findByRole('heading', { name: '0 results found' })).toBeInTheDocument();
    expect(searchBody).toEqual({ phone: '+441111111111' });
    expect(router.state.location.pathname).toBe('/referrals/search');
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toBeNull();
  });
});

describe('SmsInboxLayout — Referrer messages tab', () => {
  it('keeps a referrer reply out of the other inbox tabs and shows all possible parcels without household details', async () => {
    server.use(
      http.post(MESSAGE_READ, () =>
        HttpResponse.json({ ...MESSAGES[7], readAt: '2026-08-23T09:10:00.000Z' }),
      ),
    );
    renderApp('/sms/referrers');
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Referrer messages' })).toBeInTheDocument();
    expect(await screen.findByText('Referrer: +446666666666')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Referrer messages (1 unread)' })).toBeInTheDocument();
    await user.click(screen.getByText('Referrer: +446666666666'));

    expect(screen.getByRole('link', { name: 'Tue, 25 Aug 2026 at 10:00' })).toHaveAttribute(
      'href',
      '/referrals/referral-7',
    );
    expect(screen.getByRole('link', { name: 'Wed, 26 Aug 2026 at 11:30' })).toHaveAttribute(
      'href',
      '/referrals/referral-8',
    );
    expect(screen.queryByRole('link', { name: 'Search referrals for this number' })).toBeNull();
    expect(screen.queryByText(/Jamie|Rowe|Elm Street/)).toBeNull();
  });

  it('marks referrer replies read individually when their thread is opened', async () => {
    const readMessageIds: string[] = [];
    server.use(
      http.post(MESSAGE_READ, ({ params }) => {
        readMessageIds.push(String(params.id));
        return HttpResponse.json({ ...MESSAGES[7], readAt: '2026-08-23T09:10:00.000Z' });
      }),
    );
    renderApp('/sms/referrers');
    const user = userEvent.setup();

    await user.click(await screen.findByText('Referrer: +446666666666'));
    await waitFor(() => {
      expect(readMessageIds).toEqual(['message-7']);
    });
  });
});
