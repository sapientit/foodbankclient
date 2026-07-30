import { HttpResponse, delay, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/msw/server';
import { authFetch } from './auth-fetch';
import { REFRESH_TIMEOUT_MS, withRefreshLock } from './refresh-lock';
import { setAccessToken, subscribeToAuthEvents, type AuthEvent } from './token-store';

/**
 * The highest-consequence file in the repo, so each test is named as the rule it
 * enforces.
 *
 * Getting this wrong signs every user out, everywhere, intermittently. The
 * server rotates the refresh token on every use and treats a second
 * presentation of an already-rotated one as theft — it revokes the whole family.
 * So "refresh twice" is not a wasted round trip, it is a logout. The handlers
 * below model that: the second refresh in any test answers `401`, which is what
 * makes a per-caller implementation fail these tests rather than merely look
 * wasteful.
 */

const SESSIONS = '/api/v1/sessions';
const REFRESH = '/api/v1/auth/refresh';
const PUBLIC_SESSIONS = '/api/v1/public/sessions';

function envelope(code: string, message: string) {
  return { error: { code, message, requestId: 'req-test' } };
}

function unauthorized() {
  return HttpResponse.json(envelope('UNAUTHORIZED', 'Sign in again.'), { status: 401 });
}

function tokenResponse(accessToken: string) {
  return {
    accessToken,
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
  };
}

let events: AuthEvent[] = [];
let unsubscribe: () => void;

beforeEach(() => {
  events = [];
  unsubscribe = subscribeToAuthEvents((event) => events.push(event));
  setAccessToken('stale-token');
});

afterEach(() => {
  unsubscribe();
  setAccessToken(null);
  vi.useRealTimers();
});

function signOutCount() {
  return events.filter((event) => event.type === 'signed-out').length;
}

describe('authFetch', () => {
  it('two simultaneous 401s produce exactly one refresh', async () => {
    const refreshes: string[] = [];
    const bearers: string[] = [];

    server.use(
      http.post(REFRESH, async () => {
        refreshes.push('refresh');
        // A second rotation is a replayed token as far as the server is
        // concerned, and it answers by revoking the family. Modelling it here is
        // what stops this test passing against an implementation that simply
        // refreshes per caller.
        if (refreshes.length > 1) return unauthorized();

        // Long enough that the second caller's 401 genuinely arrives while this
        // is still outstanding. Without it the two callers are only nominally
        // concurrent and the test proves nothing about queueing.
        await delay(10);
        return HttpResponse.json(tokenResponse('fresh-token'));
      }),
      http.get(SESSIONS, ({ request }) => {
        const bearer = request.headers.get('authorization') ?? '';
        bearers.push(bearer);
        return bearer === 'Bearer fresh-token' ? HttpResponse.json({ ok: true }) : unauthorized();
      }),
    );

    const [first, second] = await Promise.all([
      authFetch(new Request(SESSIONS)),
      authFetch(new Request(SESSIONS)),
    ]);

    expect(refreshes).toHaveLength(1);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(bearers.filter((bearer) => bearer === 'Bearer stale-token')).toHaveLength(2);
    expect(bearers.filter((bearer) => bearer === 'Bearer fresh-token')).toHaveLength(2);
    expect(signOutCount()).toBe(0);
  });

  it('queued callers retry with the new token, not the old one', async () => {
    const retried: string[] = [];

    server.use(
      http.post(REFRESH, async () => {
        await delay(10);
        return HttpResponse.json(tokenResponse('rotated-token'));
      }),
      http.get(SESSIONS, ({ request }) => {
        const bearer = request.headers.get('authorization') ?? '';
        if (bearer === 'Bearer stale-token') return unauthorized();
        retried.push(bearer);
        return HttpResponse.json({ ok: true });
      }),
    );

    await Promise.all([authFetch(new Request(SESSIONS)), authFetch(new Request(SESSIONS))]);

    // The caller that waited must present what the refresh produced. A queued
    // caller that retried with the token it captured before waiting would send
    // the rotated-away one and 401 forever.
    expect(retried).toEqual(['Bearer rotated-token', 'Bearer rotated-token']);
  });

  it('retries the original request once and does not loop when the retry also fails', async () => {
    let attempts = 0;
    let refreshes = 0;

    server.use(
      http.post(REFRESH, () => {
        refreshes += 1;
        return HttpResponse.json(tokenResponse('fresh-token'));
      }),
      http.get(SESSIONS, () => {
        attempts += 1;
        return unauthorized();
      }),
    );

    const response = await authFetch(new Request(SESSIONS));

    expect(attempts).toBe(2);
    expect(refreshes).toBe(1);
    expect(response.status).toBe(401);
  });

  it('signs out once when refresh is rejected', async () => {
    let refreshes = 0;

    server.use(
      http.post(REFRESH, async () => {
        refreshes += 1;
        await delay(10);
        return unauthorized();
      }),
      http.get(SESSIONS, () => unauthorized()),
    );

    const responses = await Promise.all([
      authFetch(new Request(SESSIONS)),
      authFetch(new Request(SESSIONS)),
      authFetch(new Request(SESSIONS)),
    ]);

    expect(refreshes).toBe(1);
    expect(signOutCount()).toBe(1);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  });

  it('a 401 after a completed refresh triggers a second refresh', async () => {
    const issued = ['first-token', 'second-token'];
    const spent = new Set(['Bearer stale-token']);
    let refreshes = 0;

    server.use(
      http.post(REFRESH, () => {
        const token = issued[refreshes] ?? 'unexpected';
        refreshes += 1;
        return HttpResponse.json(tokenResponse(token));
      }),
      // Each token works once. The second call therefore 401s on a token that
      // was minted by a refresh which has already finished, which is the only
      // way to prove the in-flight slot is cleared rather than left holding the
      // first result forever.
      http.get(SESSIONS, ({ request }) => {
        const bearer = request.headers.get('authorization') ?? '';
        if (spent.has(bearer)) return unauthorized();
        spent.add(bearer);
        return HttpResponse.json({ ok: true });
      }),
    );

    await authFetch(new Request(SESSIONS));
    await authFetch(new Request(SESSIONS));

    expect(refreshes).toBe(2);
  });

  it('resends the original body on the retry', async () => {
    const bodies: unknown[] = [];

    server.use(
      http.post(REFRESH, () => HttpResponse.json(tokenResponse('fresh-token'))),
      http.post(SESSIONS, async ({ request }) => {
        bodies.push(await request.json());
        return request.headers.get('authorization') === 'Bearer fresh-token'
          ? HttpResponse.json({ ok: true })
          : unauthorized();
      }),
    );

    // A Request's body can be read once. Retrying without a clone silently
    // sends an empty POST, which for attendance would be a parcel recorded
    // against nothing.
    const response = await authFetch(
      new Request(SESSIONS, {
        method: 'POST',
        body: JSON.stringify({ location: 'Church hall' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(200);
    expect(bodies).toEqual([{ location: 'Church hall' }, { location: 'Church hall' }]);
  });

  it('never sends the access token to a public route', async () => {
    let seen: string | null = 'not called';

    server.use(
      http.get(PUBLIC_SESSIONS, ({ request }) => {
        seen = request.headers.get('authorization');
        return HttpResponse.json([]);
      }),
    );

    await authFetch(new Request(PUBLIC_SESSIONS));

    expect(seen).toBeNull();
  });

  it('does not refresh on a 403', async () => {
    let refreshes = 0;

    server.use(
      http.post(REFRESH, () => {
        refreshes += 1;
        return HttpResponse.json(tokenResponse('never-needed'));
      }),
      http.get(SESSIONS, () =>
        HttpResponse.json(envelope('FORBIDDEN', 'Admins only.'), { status: 403 }),
      ),
    );

    const response = await authFetch(new Request(SESSIONS));

    // A 403 is a role problem. Refreshing returns a token with the same role, so
    // it would fail identically and loop.
    expect(refreshes).toBe(0);
    expect(response.status).toBe(403);
    expect(signOutCount()).toBe(0);
  });

  it('falls back to the in-process promise when the browser has no Web Locks', async () => {
    // jsdom has no `navigator.locks`, so this is the path every test above took.
    // Naming it makes the fallback a claim rather than an accident.
    expect('locks' in navigator).toBe(false);

    let refreshes = 0;
    server.use(
      http.post(REFRESH, async () => {
        refreshes += 1;
        await delay(10);
        return HttpResponse.json(tokenResponse('fresh-token'));
      }),
      http.get(SESSIONS, ({ request }) =>
        request.headers.get('authorization') === 'Bearer fresh-token'
          ? HttpResponse.json({ ok: true })
          : unauthorized(),
      ),
    );

    await Promise.all([authFetch(new Request(SESSIONS)), authFetch(new Request(SESSIONS))]);

    expect(refreshes).toBe(1);
  });
});

/**
 * The lock wrapper, driven through a fake `navigator.locks` that records
 * ordering. Testing the wrapper rather than the browser: two real tabs cannot be
 * created from a test, and the thing worth proving is that the second refresh
 * starts only after the first has finished.
 */
describe('withRefreshLock', () => {
  type LockCallback<T> = (lock: unknown) => Promise<T>;

  function installFakeLocks() {
    const events: string[] = [];
    let queue: Promise<unknown> = Promise.resolve();

    const locks = {
      request<T>(name: string, _options: unknown, callback: LockCallback<T>): Promise<T> {
        events.push(`requested:${name}`);
        const granted = queue.then(async () => {
          events.push('granted');
          return callback(null);
        });
        // A real lock is released when the callback settles, however it settles.
        queue = granted.then(
          () => undefined,
          () => undefined,
        );
        return granted;
      },
    };

    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    return {
      events,
      uninstall: () => {
        Reflect.deleteProperty(navigator, 'locks');
      },
    };
  }

  let fake: ReturnType<typeof installFakeLocks>;

  beforeEach(() => {
    fake = installFakeLocks();
  });

  afterEach(() => {
    fake.uninstall();
  });

  it('serialises refresh across tabs', async () => {
    const firstRefresh = Promise.withResolvers<string>();

    const first = withRefreshLock(() => {
      fake.events.push('first ran');
      return firstRefresh.promise;
    });
    const second = withRefreshLock(() => {
      fake.events.push('second ran');
      return Promise.resolve('second');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Both asked, only the first is running. The second is queued behind it
    // rather than presenting a cookie the first is about to rotate.
    expect(fake.events).toEqual([
      'requested:foodbank-auth-refresh',
      'requested:foodbank-auth-refresh',
      'granted',
      'first ran',
    ]);

    firstRefresh.resolve('first');

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(fake.events.at(-1)).toBe('second ran');
  });

  it('releases the refresh lock when the network hangs', async () => {
    vi.useFakeTimers();

    // A refresh that never answers and ignores its abort signal: the worst case,
    // and the one that would otherwise hold the lock for every tab forever.
    const hung = withRefreshLock(() => new Promise<string>(() => undefined));
    // Attached before the clock moves: an unhandled rejection between the two
    // would fail the run rather than the assertion.
    const timedOut = expect(hung).rejects.toThrow('Refreshing the session took too long.');

    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    await timedOut;

    // The queue moved on, which is the whole point: the lock was released.
    await expect(withRefreshLock(() => Promise.resolve('after'))).resolves.toBe('after');
  });
});
