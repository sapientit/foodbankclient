import type { SessionStatus } from '../sessions/keys';

/**
 * Whether a session is finished with, and every run-session screen is therefore
 * a record of what happened rather than a place to change it.
 *
 * **One named rule, threaded as a boolean.** The screens used to pass
 * `sessionStatus` around and compare it to `'confirmed'` in five places; each
 * of those was a place to forget the second status. A cancelled session is
 * frozen for a different reason — it is not being run — but the screens treat
 * it identically, and the server refuses the same writes either way.
 *
 * **The controls are absent, not disabled.** After
 * `POST /sessions/{id}/confirm` every write behind these screens is a `409` with
 * no override, and `API.md` is explicit that a screen should make that
 * impossible rather than let somebody attempt it and be refused. A greyed-out
 * button on a session from three weeks ago is an invitation to wonder what is
 * wrong with the app.
 *
 * No React, no fetching, tested directly.
 */
export function isSessionReadOnly(status: SessionStatus): boolean {
  return status === 'confirmed' || status === 'cancelled';
}

/**
 * Why the screen cannot be changed, in one sentence, or `null` while it can.
 *
 * The two reasons are genuinely different and a team lead deserves to be told
 * which: a confirmed session has been signed off and its stock figures must not
 * move, a cancelled one never ran at all.
 */
export function describeReadOnlySession(status: SessionStatus): string | null {
  if (status === 'confirmed') {
    return 'This session has been completed and signed off. It is shown as a record of what happened and cannot be changed.';
  }
  if (status === 'cancelled') {
    return 'This session was cancelled, so it did not run and nothing on it can be changed.';
  }
  return null;
}
