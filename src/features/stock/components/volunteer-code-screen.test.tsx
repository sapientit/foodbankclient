import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import { formatLondonDateTime } from '../../../lib/london-time';

/**
 * Where a team lead or admin mints a stock-take code for a volunteer with no
 * account. The route is inside the signed-in shell; `renderApp`'s default actor
 * is `admin`, and `POST /auth/refresh` in `beforeEach` signs them in.
 */

const REFRESH = '/api/v1/auth/refresh';
const MINT = '/api/v1/stock/take/volunteer-codes';

const CODE = 'KP7Q-4XZM-9RTW-2NJH';
const EXPIRES_AT = 1_788_888_888; // epoch seconds; the exact value does not matter, only that it round-trips through the London formatter

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.post(MINT, () =>
      HttpResponse.json({ code: CODE, expiresAt: EXPIRES_AT }, { status: 201 }),
    ),
  );
});

describe('the volunteer code screen', () => {
  it('does not offer a route back to the stock take', async () => {
    renderApp('/stock/volunteer-code');

    await screen.findByRole('button', { name: 'Generate a code' });

    expect(screen.queryByRole('link', { name: 'Back to the stock take' })).toBeNull();
  });

  it('shows the generated code once, with its expiry as a London time', async () => {
    renderApp('/stock/volunteer-code');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Generate a code' }));

    expect(await screen.findByText(CODE)).toBeInTheDocument();
    expect(screen.getByText('This is the code to use for doing a stock take.')).toBeInTheDocument();
    // Once, and only once — a code read out twice is a code typed wrong.
    expect(screen.getAllByText(CODE)).toHaveLength(1);

    const expected = formatLondonDateTime(new Date(EXPIRES_AT * 1000).toISOString());
    expect(screen.getByText(/Stops working at/)).toHaveTextContent(expected);
  });

  it('replaces the shown code and calls the endpoint again on Generate another code', async () => {
    let calls = 0;
    const second = 'AB12-CD34-EF56-GH78';
    server.use(
      http.post(MINT, () => {
        calls += 1;
        return HttpResponse.json(
          { code: calls === 1 ? CODE : second, expiresAt: EXPIRES_AT },
          { status: 201 },
        );
      }),
    );
    renderApp('/stock/volunteer-code');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Generate a code' }));
    await screen.findByText(CODE);
    expect(screen.getByText('This is the code to use for doing a stock take.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Generate another code' }));

    expect(await screen.findByText(second)).toBeInTheDocument();
    expect(screen.queryByText(CODE)).toBeNull();
    expect(calls).toBe(2);
  });

  it('does not mint a second code while a generate is still in flight', async () => {
    let calls = 0;
    let release: () => void = () => {
      throw new Error('The mint handler has not started.');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(MINT, async () => {
        calls += 1;
        await gate;
        return HttpResponse.json({ code: CODE, expiresAt: EXPIRES_AT }, { status: 201 });
      }),
    );
    renderApp('/stock/volunteer-code');
    const user = userEvent.setup();

    // The button is `aria-disabled`, not `disabled`, so both taps reach the
    // handler — the synchronous ref guard is what refuses the second.
    const button = await screen.findByRole('button', { name: 'Generate a code' });
    await user.click(button);
    await user.click(button);

    release();
    await screen.findByText(CODE);

    expect(calls).toBe(1);
  });

  it('shows the access-denied notice and no code when the mint is forbidden', async () => {
    server.use(
      http.post(MINT, () =>
        HttpResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'This action requires the admin role',
              requestId: 'r1',
            },
          },
          { status: 403 },
        ),
      ),
    );
    renderApp('/stock/volunteer-code');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Generate a code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
    expect(screen.queryByText('Read this out or write it down')).toBeNull();
  });

  it('copies a WhatsApp-ready message with the purpose, code and expiry', async () => {
    renderApp('/stock/volunteer-code');
    const user = userEvent.setup();

    // Override userEvent's own clipboard stub with a plain spy.
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await user.click(await screen.findByRole('button', { name: 'Generate a code' }));
    await screen.findByText(CODE);

    await user.click(screen.getByRole('button', { name: 'Copy message' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      `This is the code to use for doing a stock take.\n\n${CODE}\n\nIt stops working at ${formatLondonDateTime(new Date(EXPIRES_AT * 1000).toISOString())} UK time.`,
    );
  });

  it('explains how to copy the whole message if clipboard access is unavailable', async () => {
    renderApp('/stock/volunteer-code');
    const user = userEvent.setup();
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new Error('Denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await user.click(await screen.findByRole('button', { name: 'Generate a code' }));
    await user.click(screen.getByRole('button', { name: 'Copy message' }));

    expect(
      await screen.findByText(/Select the message, code and expiry above/),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Select the message, code and expiry shown and copy them by hand.',
    );
  });
});
