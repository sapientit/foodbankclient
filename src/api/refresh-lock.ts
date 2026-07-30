/**
 * Serialises token refresh **across tabs**, and guarantees it lets go.
 *
 * A module-level in-flight promise only covers one JS context. Two tabs of the
 * same app reloading together are two contexts, so both refresh; the second
 * presents a refresh token the first already rotated, the server reads that as
 * theft and revokes the whole token family, and the user is signed out
 * everywhere. It looks like a random logout and it is not reproducible by
 * anyone testing in a single tab.
 *
 * `navigator.locks` fixes it with no dependency: the second tab waits, then
 * refreshes with the *new* cookie, which is valid. Where it is missing — older
 * browsers, and jsdom, which has no Web Locks at all — the caller's in-process
 * promise is still there and is what we fall back to. That is weaker rather than
 * broken: it is exactly the behaviour we would have had anyway.
 *
 * The timeout is the other half. A lock is held until its callback settles, so a
 * refresh that hangs on a dead network would wedge every tab of the app
 * indefinitely, including ones that could otherwise have carried on. The signal
 * aborts both the wait and the work, and the race guarantees this function
 * returns even if `run` ignores its signal — a held lock is too expensive to
 * leave resting on a callee's good behaviour.
 */

const LOCK_NAME = 'foodbank-auth-refresh';

/** Fifteen-minute access tokens; a refresh that has not answered in ten seconds is not going to. */
export const REFRESH_TIMEOUT_MS = 10_000;

/**
 * `Navigator` declares `locks` as always present, so a plain `navigator.locks
 * === undefined` reads as dead code to the compiler and to
 * `no-unnecessary-condition`. Widening through this type is what makes the
 * feature check honest.
 */
interface LockManagerHost {
  readonly locks?: LockManager;
}

export async function withRefreshLock<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REFRESH_TIMEOUT_MS);
  const { signal } = controller;

  const host: LockManagerHost = navigator;
  const locks = host.locks;

  try {
    if (locks === undefined) return await bounded(run, signal);
    return await locks.request(LOCK_NAME, { signal }, () => bounded(run, signal));
  } finally {
    clearTimeout(timer);
  }
}

function bounded<T>(run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  const attempt = run(signal);

  // If the abort wins the race, `attempt` is still outstanding and may reject
  // later with nobody listening.
  void attempt.catch(() => undefined);

  return Promise.race([attempt, rejectWhenAborted(signal)]);
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const fail = () => {
      reject(new Error('Refreshing the session took too long.'));
    };

    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
}
