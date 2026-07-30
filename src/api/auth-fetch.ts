import { withRefreshLock } from './refresh-lock';
import { getAccessToken, publishAuthEvent, setAccessToken, type AuthUser } from './token-store';

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

/** No bearer, no refresh — but still `credentials`, because `/auth/*` is where the cookie lives. */
export function plainFetch(request: Request): Promise<Response> {
  return fetch(withSession(request, null));
}

export async function authFetch(request: Request): Promise<Response> {
  if (isUnauthenticated(request.url)) return plainFetch(request);

  // Cloned before anything reads the body: a Request's body is consumed once,
  // and the retry needs its own copy.
  const retry = request.clone();

  const response = await fetch(withSession(request, getAccessToken()));

  // A 403 is a role problem, not a token problem. Refreshing on it would return
  // a token with the same role, fail identically, and loop.
  if (response.status !== 401) return response;

  const user = await refreshSession();
  if (user === null) return response;

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
    void attempt.finally(() => {
      if (inFlight === attempt) inFlight = null;
    });
  }

  return inFlight;
}

let inFlight: Promise<AuthUser | null> | null = null;

async function runRefresh(): Promise<AuthUser | null> {
  try {
    return await withRefreshLock(requestNewToken);
  } catch {
    // A refresh that timed out or failed at the network cannot be told apart
    // from a revoked family without another round trip, and guessing "still
    // signed in" leaves the app making requests that will all 401.
    endSession();
    return null;
  }
}

async function requestNewToken(signal: AbortSignal): Promise<AuthUser | null> {
  const response = await fetch(
    new Request(REFRESH_PATH, { method: 'POST', credentials: 'same-origin', signal }),
  );

  if (!response.ok) {
    endSession();
    return null;
  }

  const token = readTokenResponse(await response.json().catch(() => null));
  if (token === null) {
    endSession();
    return null;
  }

  setAccessToken(token.accessToken);
  publishAuthEvent({ type: 'refreshed', user: token.user });
  return token.user;
}

function endSession(): void {
  setAccessToken(null);
  publishAuthEvent({ type: 'signed-out' });
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
  const { pathname } = new URL(url, location.href);
  return UNAUTHENTICATED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * The refresh response is the one body in the app not typed by `openapi-fetch`,
 * because reading it through the typed client would recurse. Validated here
 * instead, so a malformed answer ends the session rather than storing
 * `undefined` as a token.
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
  if (role !== 'admin' && role !== 'team_lead') return null;

  return { accessToken, user: { id, email, displayName, role } };
}
