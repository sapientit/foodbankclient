import { useState, type ReactNode } from 'react';
import { ApiError, describeApiError, issuesToFieldErrors } from '../lib/errors';
import styles from './error-notice.module.css';

/**
 * The one place the charter's error table turns into words on a screen.
 *
 * Every failure the API can produce is answered here, so that no screen has to
 * remember which statuses carry a message worth showing. Two of them do, and
 * they are the two that get flattened into "Something went wrong" everywhere
 * else: **`409` and `422` are rendered verbatim**, because the server writes
 * them to be read — _that session is full_, _this list is confirmed_, _that
 * reason is no longer offered_. Throwing that sentence away costs the person the
 * only useful thing they were told.
 *
 * `describeApiError` is reused rather than re-implemented wherever the sentence
 * it produces is the right one. The statuses handled separately here are the
 * ones that need more than a sentence: field lists, a copyable reference, or an
 * explanation that the fault is ours.
 *
 * The server's `code` is never rendered. `FORBIDDEN` on a screen tells a
 * volunteer nothing and looks like a crash.
 */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);

  const retry =
    onRetry === undefined ? null : (
      <button className={styles.action} onClick={onRetry} type="button">
        Try again
      </button>
    );

  /*
   * Everything the API layer throws is an `ApiError` — `unwrap` builds one from
   * every non-2xx response. So anything else here is the request never having
   * left, which is what a hall's wifi looks like, and the answer is the same
   * either way: try again.
   */
  if (!(error instanceof ApiError)) {
    return (
      <Notice headline="We could not reach the server">
        <p>Check your connection and try again.</p>
        {retry}
      </Notice>
    );
  }

  if (error.status === 400) {
    const fieldErrors = Object.entries(issuesToFieldErrors(error));

    return (
      <Notice headline="Check these fields">
        {fieldErrors.length === 0 ? (
          <p>{describeApiError(error)}</p>
        ) : (
          // The server names the field and the rule and never echoes the value,
          // so there is nothing here to render "you entered X" from.
          <ul className={styles.issues}>
            {fieldErrors.map(([field, message]) => (
              <li key={field}>
                <strong>{field}</strong>: {message}
              </li>
            ))}
          </ul>
        )}
      </Notice>
    );
  }

  if (error.status === 403) {
    return (
      <Notice headline="You do not have access to this">
        {/* Roles pick menus and never gate routes, so a 403 means the menu and
            the server disagree. That is our bug, and saying so is more use than
            implying the person did something wrong. */}
        <p>
          This looks like a mistake in our menu rather than anything you did. Tell an administrator
          which link you followed.
        </p>
      </Notice>
    );
  }

  if (error.status === 404) {
    return (
      <Notice headline="That no longer exists">
        <p>It may have been removed since this page was opened.</p>
      </Notice>
    );
  }

  if (error.status === 429) {
    // Deliberately no retry button. The public endpoints allow roughly sixty
    // calls a minute per IP, and a button someone taps six times is exactly how
    // a food bank loses that budget on nothing.
    return (
      <Notice headline="Too many requests">
        <p>{describeApiError(error)}</p>
      </Notice>
    );
  }

  if (error.status >= 500) {
    const { requestId } = error;

    return (
      <Notice headline="Something went wrong at our end">
        <p>Nothing you did caused this.</p>
        {requestId !== null && (
          <p className={styles.reference}>
            Quote this reference if you report it: <code className={styles.code}>{requestId}</code>{' '}
            <button
              className={styles.copy}
              onClick={() => {
                void copyToClipboard(requestId).then(setCopied);
              }}
              type="button"
            >
              {copied ? 'Copied' : 'Copy reference'}
            </button>
          </p>
        )}
        {retry}
      </Notice>
    );
  }

  // 409 and 422 land here, and so does anything else with a message: the
  // server's sentence, unaltered. A 401 reaches this only if the single-flight
  // refresh has already given up, in which case the sign-in screen is next.
  return (
    <Notice headline="We could not do that">
      <p>{describeApiError(error)}</p>
    </Notice>
  );
}

function Notice({ headline, children }: { headline: string; children: ReactNode }) {
  return (
    <div className={styles.notice} role="alert">
      <h2 className={styles.headline}>{headline}</h2>
      {children}
    </div>
  );
}

/**
 * Resolves false where the clipboard is unavailable or refused — an insecure
 * origin, an older browser, a denied permission. The reference is on screen and
 * selectable regardless, so the button is a convenience and never the only way
 * to get the value.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
