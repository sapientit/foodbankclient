import { refreshSession } from '../api/auth-fetch';
import { publicApi } from '../api/client';
import { queryClient } from '../api/query-client';
import { setAccessToken, type AuthUser } from '../api/token-store';
import { unwrap, unwrapVoid } from '../api/unwrap';

/**
 * Starting, restoring and ending a session. No React here, so all three are
 * testable on their own.
 */

/**
 * Rebuilds the session from the refresh cookie, **once per page load**.
 *
 * It boots on `POST /auth/refresh`, never `GET /auth/me`. `/me` sits behind
 * `requireAuth`, and after a reload there is no access token in memory, so it can
 * only 401 — you would then refresh anyway. And the refresh response already
 * carries the user *including `displayName`*, which `/me` does not return. `/me`
 * costs an extra round trip to learn less.
 *
 * The memoised promise is what makes "once" true. React's StrictMode
 * double-invokes effects in development, so the route guard's effect runs,
 * cleans up and runs again; without this the second call is a second
 * `POST /auth/refresh`, the server sees the first token replayed, revokes the
 * family, and every development reload signs you out for reasons that look
 * supernatural. It is never cleared: one page load, one boot.
 */
export function ensureSession(): Promise<AuthUser | null> {
  boot ??= refreshSession();
  return boot;
}

let boot: Promise<AuthUser | null> | null = null;

/**
 * `dev-login` takes only `{ email }`. The display name and role come from the
 * `users` row, and anything else sent here is silently dropped by the server —
 * which is why the sign-in screen has no role picker.
 */
export async function signIn(email: string): Promise<AuthUser> {
  const { accessToken, user } = await unwrap(
    publicApi.POST('/api/v1/auth/dev-login', { body: { email } }),
  );

  setAccessToken(accessToken);

  // A sign-in is the one moment the app knows the person may have changed, so
  // it is the last place to catch a cache the sign-out path somehow left behind
  // — signing in as somebody else without signing out first, say. Clearing an
  // already-empty cache costs nothing.
  queryClient.clear();

  return user;
}

export async function signOut(): Promise<void> {
  try {
    // 204 — `unwrap` would throw on the success case. See unwrap.ts.
    await unwrapVoid(publicApi.POST('/api/v1/auth/logout'));
  } catch {
    // Either the cookie family is revoked or it is not; either way the local
    // session ends now. Staying signed in because the network blipped is the
    // worse failure on a laptop three volunteers share.
  }

  setAccessToken(null);

  // Load-bearing. Without it the next person to sign in on this machine sees the
  // previous user's referrals rendered from cache before their own load.
  queryClient.clear();
}
