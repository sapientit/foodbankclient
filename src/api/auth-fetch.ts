import { withRefreshLock } from './refresh-lock';
import { getAccessToken, publishAuthEvent, setAccessToken, type AuthUser } from './token-store';
import { getVolunteerCode } from './volunteer-code-store';
import { markSessionEnded } from '../lib/errors';

/**
 * The bearer header and the single-flight 401 refresh. Nothing else in the app
 * retries a 401 — a retry written at a call site is exactly how the concurrent
 * refresh bug gets in.
 *
 * Refresh calls `fetch` directly rather than going through `publicApi`. Not
 * laziness: `client.ts` imports this module, so using it here would be a cycle,
 * and more importantly a refresh routed through `authFetch` could 401 and
 * refresh again. The two clients in `client.ts` are the structural version of
 * that rule; the path check below is the second lock.
 */

/**
 * Nothing under these prefixes takes a bearer token, and a 401 from one of them
 * is an answer rather than an expired token. `/auth/` in particular must never
 * engage refresh: `POST /auth/refresh` returning 401 means the cookie is gone,
 * and refreshing in response to that is an infinite loop.
 */
const UNAUTHENTICATED_PREFIXES = ['/api/v1/public/', '/api/v1/auth/'];

const REFRESH_PATH = '/api/v1/auth/refresh';

/**
 * The four operations a stock-take volunteer code reaches, and the server
 * refuses it on every other path — the item list and hand corrections included.
 * Matched exactly, so `/api/v1/stock/take/volunteer-codes` (a staff-only mint,
 * bearer as usual) is not one of them.
 */
const VOLUNTEER_CODE_PATHS = new Set([
  '/api/v1/stock/levels',
  '/api/v1/stock/groupings',
  '/api/v1/stock/crates',
  '/api/v1/stock/take',
]);

const VOLUNTEER_CODE_HEADER = 'X-Volunteer-Code';

/** No bearer, no refresh — but still `credentials`, because `/auth/*` is where the cookie lives. */
export function plainFetch(request: Request): Promise<Response> {
  return fetch(withSession(request, null));
}

export async function authFetch(request: Request): Promise<Response> {
  if (isUnauthenticated(request.url)) return plainFetch(request);

  /*
   * Volunteer-code mode. A device counting the stock never signs in, so there
   * is no bearer token and no refresh cookie: the code goes in a header and a
   * 401 is a final answer — the code has lapsed — not a token to renew. Return
   * the response untouched and let the query layer surface it; running the
   * refresh dance here would only 401 against a cookie that was never set.
   *
   * **Gated on there being no signed-in session.** A team lead who generated a
   * code and then opened `/count` has both set; their requests must stay on the
   * bearer, or a stock take they save is recorded server-side against whoever
   * the code was issued to. A signed-in staff user reaches all four endpoints
   * on their token anyway, so nothing is lost.
   *
   * While a code is the only credential, **no other path gets the refresh
   * dance** — there is no session to refresh or to end. Anything outside the
   * four goes out bare and its 401 is returned as-is, so a query added to the
   * counting screen later cannot fire a spurious sign-out.
   */
  const volunteerCode = getVolunteerCode();
  if (volunteerCode !== null && getAccessToken() === null) {
    return VOLUNTEER_CODE_PATHS.has(pathnameOf(request.url))
      ? fetch(withVolunteerCode(request, volunteerCode))
      : plainFetch(request);
  }

  // Cloned before anything reads the body: a Request's body is consumed once,
  // and the retry needs its own copy.
  const retry = request.clone();

  const response = await fetch(withSession(request, getAccessToken()));

  // A 403 is a role problem, not a token problem. Refreshing on it would return
  // a token with the same role, fail identically, and loop.
  if (response.status !== 401) return response;

  let user: AuthUser | null;
  try {
    user = await refreshSession();
  } catch {
    // The old access token may have expired, but a network failure says
    // nothing about the refresh cookie or the eight-hour sign-in. Leave the
    // session intact and let a later request try its one shared refresh again.
    return response;
  }
  // `refreshSession()` publishes the signed-out event only after both refresh
  // attempts were refused. Carry that fact with this response so the UI does
  // not mistake an unrelated or transient 401 for an ended sign-in.
  if (user === null) return markSessionEnded(response);

  // Exactly one retry. If a freshly minted token is also refused, refreshing
  // again cannot help and the caller sees the 401 — which the query layer will
  // not retry either, because it is a 4xx.
  return fetch(withSession(retry, getAccessToken()));
}

/**
 * The single-flight slot. Every 401 and the boot-time session restore go through
 * this one function, so a boot racing a 401 cannot produce two refreshes either.
 *
 * Resolves to the refreshed user, or `null` if the session is over — in which
 * case sign-out has already been published, once, no matter how many callers
 * were queued.
 */
export function refreshSession(): Promise<AuthUser | null> {
  if (inFlight === null) {
    const attempt = runRefresh();
    inFlight = attempt;
    // Cleared as the attempt settles, and before any queued caller resumes, so
    // that a later 401 starts a genuinely new refresh instead of replaying this
    // one's result.
    void attempt.then(
      () => {
        if (inFlight === attempt) inFlight = null;
      },
      () => {
        if (inFlight === attempt) inFlight = null;
      },
    );
  }

  return inFlight;
}

let inFlight: Promise<AuthUser | null> | null = null;

async function runRefresh(): Promise<AuthUser | null> {
  const firstAttempt = await withRefreshLock(requestNewToken);
  if (firstAttempt !== null) return firstAttempt;

  /*
   * A refresh cookie is rotated, so another tab can present the just-spent
   * cookie despite the lock. The server leaves that sign-in intact: retry once
   * to use the replacement cookie it has now set. A second 401 is the genuine
   * end of the sign-in, or a cookie that is gone.
   */
  const retry = await withRefreshLock(requestNewToken);
  if (retry !== null) return retry;

  endSession();
  return null;
}

async function requestNewToken(signal: AbortSignal): Promise<AuthUser | null> {
  const response = await fetch(
    new Request(REFRESH_PATH, { method: 'POST', credentials: 'same-origin', signal }),
  );

  if (response.status === 401) {
    return null;
  }
  if (!response.ok)
    throw new Error(`Refreshing the session failed with HTTP ${String(response.status)}.`);

  const token = readTokenResponse(await response.json().catch(() => null));
  if (token === null) throw new Error('Refreshing the session returned an invalid response.');

  setAccessToken(token.accessToken);
  publishAuthEvent({ type: 'refreshed', user: token.user });
  return token.user;
}

function endSession(): void {
  setAccessToken(null);
  publishAuthEvent({ type: 'signed-out', reason: 'session-ended' });
}

/**
 * `credentials` is set explicitly on every request this module issues rather
 * than left to the default. The refresh cookie is the one mechanism that keeps
 * people signed in, and `same-origin` is the whole deployment topology stated in
 * one word — see CLAUDE.md, "Deploy as one origin, not two".
 */
function withSession(request: Request, token: string | null): Request {
  const headers = new Headers(request.headers);
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);

  return new Request(request, { headers, credentials: 'same-origin' });
}

function isUnauthenticated(url: string): boolean {
  return UNAUTHENTICATED_PREFIXES.some((prefix) => pathnameOf(url).startsWith(prefix));
}

function pathnameOf(url: string): string {
  return new URL(url, location.href).pathname;
}

/**
 * The volunteer code replaces the bearer header rather than joining it — the
 * server takes the code where both are present, so sending a stale token
 * alongside it only risks confusion. `credentials` is still `same-origin` for
 * consistency with the rest of this module, though a counting device has no
 * cookie to send.
 */
function withVolunteerCode(request: Request, code: string): Request {
  const headers = new Headers(request.headers);
  headers.delete('Authorization');
  headers.set(VOLUNTEER_CODE_HEADER, code);
  return new Request(request, { headers, credentials: 'same-origin' });
}

/**
 * The refresh response is the one body in the app not typed by `openapi-fetch`,
 * because reading it through the typed client would recurse. Validated here so
 * a malformed answer can fail safely without storing `undefined` as a token or
 * ending a session that may still be valid.
 */
function readTokenResponse(body: unknown): { accessToken: string; user: AuthUser } | null {
  if (typeof body !== 'object' || body === null) return null;

  const { accessToken, user } = body as { accessToken?: unknown; user?: unknown };
  if (typeof accessToken !== 'string') return null;
  if (typeof user !== 'object' || user === null) return null;

  const { id, email, displayName, role } = user as {
    id?: unknown;
    email?: unknown;
    displayName?: unknown;
    role?: unknown;
  };
  if (typeof id !== 'string' || typeof email !== 'string' || typeof displayName !== 'string') {
    return null;
  }
  if (role !== 'admin' && role !== 'team_lead' && role !== 'fuel_admin') return null;

  return { accessToken, user: { id, email, displayName, role } };
}
