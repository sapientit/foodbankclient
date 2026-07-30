import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { AuthProvider } from '../../auth/auth-provider';
import { routes } from '../../routes';
import type { PublicSession, ReferrerCheck } from './queries';

/**
 * The public probe as a referrer meets it: the real route table, the real auth
 * provider around it, and only the API mocked.
 *
 * **This does not use `test/render-app.tsx`, and the difference is the point.**
 * That harness turns retries off so a failure is fast, which would make two of
 * the assertions below vacuous — "does not retry a 429" cannot be proved by a
 * client that never retries anything. So the query client here mirrors the
 * app's real policy (`src/api/query-client.ts`), and what stops the retry is the
 * `retry: false` on the check query itself.
 *
 * No test here signs anybody in. `AuthProvider` is mounted anyway because that
 * is how `main.tsx` mounts it, and the whole claim being made is that mounting
 * it costs an unauthenticated visitor nothing.
 */

const SESSIONS = '/api/v1/public/sessions';
const CHECK = '/api/v1/public/referrers/check';
const REFRESH = '/api/v1/auth/refresh';

const TUESDAY: PublicSession = {
  id: 's-tue',
  sessionDate: '2026-08-04',
  startTime: '10:00',
  startsAtUtc: '2026-08-04T09:00:00.000Z',
  durationMinutes: 120,
  location: 'St Mary’s Hall',
};

const THURSDAY: PublicSession = {
  id: 's-thu',
  sessionDate: '2026-08-06',
  startTime: '14:30',
  startsAtUtc: '2026-08-06T13:30:00.000Z',
  durationMinutes: 90,
  location: 'The Community Centre',
};

function authorised(organisationName: string | null): ReferrerCheck {
  return { authorised: true, organisationName };
}

function unauthorised(): ReferrerCheck {
  return { authorised: false, organisationName: null };
}

/** Counts every `POST /auth/refresh` the page causes. It must stay at zero. */
const refreshes = vi.fn();

beforeEach(() => {
  refreshes.mockClear();
  server.use(
    http.post(REFRESH, () => {
      refreshes();
      return HttpResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in again.', requestId: 'r1' } },
        { status: 401 },
      );
    }),
    http.get(SESSIONS, () => HttpResponse.json({ sessions: [TUESDAY, THURSDAY] })),
  );
});

function renderRefer() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Deliberately the app's policy rather than "off": see the note above.
      queries: { retry: 2, retryDelay: 1, staleTime: 60_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  const router = createMemoryRouter(routes, { initialEntries: ['/refer'] });

  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** The debounce is real time, so typing has to be followed by a real wait. */
async function typeAddress(value: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Your work email address'), value);
  return user;
}

describe('the public referral page', () => {
  it('says referrals cannot be made online yet and how to make one instead', async () => {
    renderRefer();

    expect(
      await screen.findByRole('heading', { name: 'Referrals cannot be made online yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/phone the food bank/i)).toBeInTheDocument();

    // Nothing that could be mistaken for a way to submit a referral.
    expect(screen.queryByRole('button', { name: /submit|send|refer/i })).toBeNull();
  });

  it('issues no auth request for an unauthenticated visitor', async () => {
    renderRefer();

    await screen.findByText('St Mary’s Hall');
    await typeAddress('ada@charity.org');
    server.use(http.post(CHECK, () => HttpResponse.json(authorised('Charity'))));
    await screen.findByText('Yes — we have you as Charity');

    // The structural promise `/refer` makes by being a sibling of the
    // authenticated layout: no guard mounts, so nothing restores a session.
    expect(refreshes).not.toHaveBeenCalled();
  });

  it('sends no Authorization header on a public request', async () => {
    let sessionsAuth: string | null = 'not recorded';
    let checkAuth: string | null = 'not recorded';
    server.use(
      http.get(SESSIONS, ({ request }) => {
        sessionsAuth = request.headers.get('authorization');
        return HttpResponse.json({ sessions: [TUESDAY] });
      }),
      http.post(CHECK, ({ request }) => {
        checkAuth = request.headers.get('authorization');
        return HttpResponse.json(unauthorised());
      }),
    );
    renderRefer();

    await screen.findByText('St Mary’s Hall');
    await typeAddress('ada@charity.org');
    await screen.findByText('That address is not on the list yet');

    // `publicApi`, not `api`. The wrong client would attach a bearer header and,
    // on a 401, fire a refresh for somebody who has no account.
    expect(sessionsAuth).toBeNull();
    expect(checkAuth).toBeNull();
  });
});

describe('the sessions with space', () => {
  it('renders the start time the server sent, unchanged', async () => {
    renderRefer();

    // A 10:00 session is 09:00 UTC in August. Anything that formats the instant
    // instead of printing the wall clock shows the wrong hour for half the year,
    // silently, on a public page.
    expect(await screen.findByText(/at 10:00/)).toBeInTheDocument();
    expect(screen.getByText(/at 14:30/)).toBeInTheDocument();
    expect(screen.queryByText(/09:00/)).toBeNull();
    expect(screen.queryByText(/13:30/)).toBeNull();
  });

  it('orders sessions by startsAtUtc rather than the order they arrived', async () => {
    server.use(http.get(SESSIONS, () => HttpResponse.json({ sessions: [THURSDAY, TUESDAY] })));
    renderRefer();

    await screen.findByText('St Mary’s Hall');
    const rendered = screen.getAllByRole('listitem').map((item) => item.textContent);

    expect(rendered[0]).toContain('Tue, 4 Aug 2026');
    expect(rendered[1]).toContain('Thu, 6 Aug 2026');
  });

  it('says plainly when nothing has space rather than showing an empty list', async () => {
    server.use(http.get(SESSIONS, () => HttpResponse.json({ sessions: [] })));
    renderRefer();

    expect(
      await screen.findByRole('heading', { name: 'No sessions have space at the moment' }),
    ).toBeInTheDocument();
  });
});

describe('the referrer check', () => {
  it('sends the address in the body and never in the URL', async () => {
    const urls: string[] = [];
    let body: unknown = null;
    server.use(
      http.post(CHECK, async ({ request }) => {
        urls.push(request.url);
        body = await request.json();
        return HttpResponse.json(authorised('St Mary’s Primary'));
      }),
    );
    renderRefer();

    await typeAddress('Ada@Charity.ORG');
    await screen.findByText('Yes — we have you as St Mary’s Primary');

    /*
     * A URL reaches browser history, the referrer header of everything the page
     * loads, and every access log on the way to the origin. This is somebody's
     * identity at a charity.
     */
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain('@');
    expect(urls[0]).not.toContain('ada');
    expect(new URL(urls[0] ?? '').search).toBe('');
    // Trimmed and lowercased, the way the server stores an authorised address.
    expect(body).toEqual({ email: 'ada@charity.org' });
  });

  it('does not fire a request per keystroke', async () => {
    const posts = vi.fn();
    server.use(
      http.post(CHECK, () => {
        posts();
        return HttpResponse.json(authorised('Charity'));
      }),
    );
    renderRefer();

    // Fifteen characters. Undebounced, that is fifteen requests against a budget
    // of roughly sixty a minute for the whole food bank.
    await typeAddress('ada@charity.org');
    await screen.findByText('Yes — we have you as Charity');

    expect(posts).toHaveBeenCalledTimes(1);
  });

  it('surfaces the organisation name when the address is authorised', async () => {
    server.use(http.post(CHECK, () => HttpResponse.json(authorised('St Mary’s Primary'))));
    renderRefer();

    await typeAddress('ada@stmarys.sch.uk');

    // The name is what makes the answer useful: it tells the referrer the food
    // bank already knows who they are.
    expect(await screen.findByText('Yes — we have you as St Mary’s Primary')).toBeInTheDocument();
  });

  it('never renders the word null when an authorised address has no organisation', async () => {
    server.use(http.post(CHECK, () => HttpResponse.json(authorised(null))));
    renderRefer();

    await typeAddress('ada@charity.org');

    expect(
      await screen.findByText('Yes — that address can refer to this food bank'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it('gives an unauthorised address a way forward rather than an error', async () => {
    server.use(http.post(CHECK, () => HttpResponse.json(unauthorised())));
    renderRefer();

    await typeAddress('ada@charity.org');

    expect(await screen.findByText('That address is not on the list yet')).toBeInTheDocument();
    expect(
      screen.getByText(/add your organisation so the check recognises you next time/),
    ).toBeInTheDocument();
    // Not a failure. The person has done nothing wrong and an alert would say
    // they had.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces the answer in a live region', async () => {
    server.use(http.post(CHECK, () => HttpResponse.json(unauthorised())));
    renderRefer();

    // Present before the answer arrives, or assistive technology has nothing to
    // watch for a change on.
    const region = await screen.findByRole('status');
    await typeAddress('ada@charity.org');

    await waitFor(() => {
      expect(region).toHaveTextContent('That address is not on the list yet');
    });
    expect(await screen.findByLabelText('Your work email address')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining(region.id),
    );
  });

  it('tells the referrer to wait on a 429 and does not retry', async () => {
    const posts = vi.fn();
    server.use(
      http.post(CHECK, () => {
        posts();
        return HttpResponse.json(
          { error: { code: 'BAD_REQUEST', message: 'Too many requests', requestId: 'r1' } },
          { status: 429 },
        );
      }),
    );
    renderRefer();

    await typeAddress('ada@charity.org');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
    expect(screen.getByRole('alert')).toHaveTextContent('Wait a moment and try again');
    /*
     * The client's default policy backs a 429 off and retries it twice. That is
     * right for a screen someone opened; it is wrong for a check driven by
     * keystrokes, where the person is already retrying and the automatic attempt
     * only spends more of the limit that produced the 429.
     */
    await settle();
    expect(posts).toHaveBeenCalledTimes(1);
  });

  it('cannot let a slow answer overwrite a newer one', async () => {
    /*
     * The failure this exists to stop: somebody corrects a typo, the check for
     * the wrong address answers last, and the screen tells them their real
     * address is not on the list. Two addresses are two cache entries, so it is
     * structurally impossible — this is the guard against somebody replacing that
     * with a single piece of state.
     */
    const slow = deferred();
    const fast = deferred();
    const finished: string[] = [];

    server.use(
      http.post(CHECK, async ({ request }) => {
        const { email } = (await request.json()) as { email: string };

        if (email === 'typo@charity.org') {
          await slow.promise;
          finished.push(email);
          return HttpResponse.json(authorised('Wrong Organisation'));
        }

        await fast.promise;
        finished.push(email);
        return HttpResponse.json(unauthorised());
      }),
    );
    renderRefer();

    const user = await typeAddress('typo@charity.org');
    await screen.findByText('Checking that address…');

    await user.clear(screen.getByLabelText('Your work email address'));
    await user.type(screen.getByLabelText('Your work email address'), 'ada@charity.org');

    fast.resolve();
    expect(await screen.findByText('That address is not on the list yet')).toBeInTheDocument();

    slow.resolve();
    await waitFor(() => {
      expect(finished).toContain('typo@charity.org');
    });
    await settle();

    expect(screen.queryByText(/Wrong Organisation/)).toBeNull();
    expect(screen.getByText('That address is not on the list yet')).toBeInTheDocument();
  });
});

function deferred() {
  let resolve: () => void = () => {
    throw new Error('The promise executor has not run.');
  };
  const promise = new Promise<void>((settleIt) => {
    resolve = settleIt;
  });

  return {
    promise,
    resolve: () => {
      resolve();
    },
  };
}

/** Lets a resolved response finish reaching React before asserting it did not. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
