import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

const UNMATCHED = '/api/v1/sms-messages/unmatched';
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
    phone: '+441234567890',
  },
  {
    id: 'message-2',
    referralId: null,
    kind: 'household_reply' as const,
    body: 'I need help finding the hall.',
    occurredAt: '2026-08-22T08:00:00.000Z',
    readAt: null,
    phone: '+441234567891',
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
  );
});

describe('UnmatchedSmsScreen', () => {
  it('keeps every other message actionable while one is being marked read', async () => {
    let releaseFirst: (() => void) | undefined;
    server.use(
      http.get(UNMATCHED, () => HttpResponse.json({ messages: MESSAGES })),
      http.post(READ, async ({ params }) => {
        if (params.id === 'message-1') {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return HttpResponse.json(MESSAGES.find((message) => message.id === params.id));
      }),
    );

    renderApp('/sms/unmatched');
    const user = userEvent.setup();

    expect(
      await screen.findByRole('heading', { name: 'Unmatched SMS replies' }),
    ).toBeInTheDocument();
    const [firstButton, secondButton] = await screen.findAllByRole('button', {
      name: 'Mark read',
    });
    if (firstButton === undefined || secondButton === undefined) {
      throw new Error('Expected both messages to have a Mark read button.');
    }

    await user.click(firstButton);

    await waitFor(() => {
      expect(firstButton).toBeDisabled();
    });
    expect(secondButton).toBeEnabled();

    releaseFirst?.();
    await waitFor(() => {
      expect(firstButton).toBeEnabled();
    });
  });

  it('shows a read failure beside the unmatched message that remains unread', async () => {
    server.use(
      http.get(UNMATCHED, () => HttpResponse.json({ messages: MESSAGES })),
      http.post(READ, ({ params }) => {
        if (params.id === 'message-1') {
          return HttpResponse.json(
            {
              error: {
                code: 'NOT_FOUND',
                message: 'That message is no longer available.',
                requestId: 'r1',
              },
            },
            { status: 404 },
          );
        }
        return HttpResponse.json(MESSAGES.find((message) => message.id === params.id));
      }),
    );

    renderApp('/sms/unmatched');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Unmatched SMS replies' });
    const [firstButton, secondButton] = await screen.findAllByRole('button', {
      name: 'Mark read',
    });
    if (firstButton === undefined || secondButton === undefined) {
      throw new Error('Expected both messages to have a Mark read button.');
    }

    await user.click(firstButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('That no longer exists');
    expect(secondButton).toBeEnabled();
  });
});
