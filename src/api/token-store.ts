import type { components } from './schema';

/**
 * The signed-in session, held at **module level and in memory only**.
 *
 * Module level rather than React state because `auth-fetch` reads the token on
 * every request: a hook closing over it captures the value from the render it
 * was created in, and the first thing that goes wrong is a request sent with the
 * token that was just rotated away.
 *
 * In memory only because a token on disk is readable by any injected script, and
 * this app is one XSS away from names, addresses and reasons for referral.
 * Losing it on reload costs one `POST /auth/refresh`. The eslint rule banning
 * `localStorage` and `sessionStorage` makes writing it impossible; this comment
 * is why the rule is there.
 */

export type AuthUser = components['schemas']['TokenResponse']['user'];

/**
 * What `auth-fetch` tells the rest of the app about a session it changed on its
 * own — a refresh triggered by somebody's 401, or a sign-out because the refresh
 * cookie is gone. It lives here rather than in `auth-fetch` because this module
 * already owns the session state, and it is a plain callback so that the API
 * layer never imports React.
 */
export type AuthEvent = { type: 'refreshed'; user: AuthUser } | { type: 'signed-out' };

type AuthEventListener = (event: AuthEvent) => void;

let accessToken: string | null = null;
const listeners = new Set<AuthEventListener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function subscribeToAuthEvents(listener: AuthEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishAuthEvent(event: AuthEvent): void {
  // Copied first: a listener that unsubscribes itself would otherwise mutate the
  // set mid-iteration.
  for (const listener of [...listeners]) listener(event);
}
