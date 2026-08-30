import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

const INBOX = '/api/v1/sms-messages';
const READ = '/api/v1/sms-messages/:id/read';
const REFRESH = '/api/v1/auth/refresh';

const MESSAGES = [
  {
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
  },
  {
    id: 'message-2',
    referralId: 'referral-2',
    kind: 'household_reply' as const,
    body: 'I am running late.',
    occurredAt: '2026-08-22T08:00:00.000Z',
    readAt: null,
    location: 'active_session' as const,
    session: {
      id: 'session-2',
      sessionDate: '2026-08-23',
      startTime: '10:00',
      status: 'planned' as const,
    },
    simulated: false,
  },
  {
    id: 'message-3',
    referralId: 'referral-3',
    kind: 'household_reply' as const,
    body: 'Thank you.',
    occurredAt: '2026-08-21T08:00:00.000Z',
    readAt: null,
    location: 'closed_session' as const,
    session: {
      id: 'session-3',
      sessionDate: '2026-08-20',
      startTime: '10:00',
      status: 'confirmed' as const,
    },
    simulated: false,
  },
  {
    id: 'message-4',
    referralId: 'referral-4',
    kind: 'staff_reply' as const,
    body: 'We will keep your parcel for you.',
    occurredAt: '2026-08-20T08:00:00.000Z',
    readAt: null,
    location: 'closed_session' as const,
    session: {
      id: 'session-3',
      sessionDate: '2026-08-20',
      startTime: '10:00',
      status: 'confirmed' as const,
    },
    simulated: true,
  },
];

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
  );
});

describe('SmsInboxScreen', () => {
  it('labels every retained message by its session ownership without exposing a linked household phone', async () => {
    renderApp('/sms');

    expect(await screen.findByRole('heading', { name: 'SMS Messages' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Unmatched messages' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Messages for active sessions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Messages for closed sessions' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Phone: +441234567890')).toBeInTheDocument();
    expect(screen.getByText(/Active session:/)).toHaveTextContent('Sun, 23 Aug 2026 at 10:00');
    expect(screen.getAllByText(/Closed session:/)[0]).toHaveTextContent(
      'Thu, 20 Aug 2026 at 10:00',
    );
    expect(screen.getByText('staff reply (simulated)')).toBeInTheDocument();
    expect(screen.getAllByText('Needs administrator attention.')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Mark read' })).toHaveLength(2);
  });

  it('does not offer an administrator a way to clear an active-session reply', async () => {
    renderApp('/sms');

    const active = (
      await screen.findByRole('heading', {
        name: 'Messages for active sessions',
      })
    ).parentElement;
    if (active === null) throw new Error('Expected active-session group');
    expect(within(active).getByText(/I am running late/)).toBeInTheDocument();
    expect(within(active).queryByRole('button', { name: 'Mark read' })).toBeNull();
  });

  it('marks one closed-session message read without clearing the other attention item', async () => {
    server.use(
      http.post(READ, ({ params }) =>
        HttpResponse.json(MESSAGES.find((message) => message.id === params.id)),
      ),
    );
    renderApp('/sms');
    const user = userEvent.setup();
    const closed = (
      await screen.findByRole('heading', {
        name: 'Messages for closed sessions',
      })
    ).parentElement;
    if (closed === null) throw new Error('Expected closed-session group');
    await user.click(within(closed).getByRole('button', { name: 'Mark read' }));
    const unmatched = (await screen.findByRole('heading', { name: 'Unmatched messages' }))
      .parentElement;
    if (unmatched === null) throw new Error('Expected unmatched group');
    expect(within(unmatched).getByRole('button', { name: 'Mark read' })).toBeInTheDocument();
  });
});
