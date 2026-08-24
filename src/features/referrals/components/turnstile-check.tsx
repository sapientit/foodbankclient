import { useEffect, useId, useRef, useState } from 'react';
import { loadTurnstile, turnstileSiteKey } from '../turnstile';
import styles from './turnstile-check.module.css';

/**
 * The bot check on the one unauthenticated write in the system.
 *
 * **Renders nothing at all when no sitekey is configured**, which is local
 * development and matches the server skipping verification when it has no
 * secret. `turnstileRequired` is what the screen asks; this component is not
 * conditionally mounted by the caller, so there is one place that decides.
 *
 * **The token is reported upward and never held here.** It is single-use and
 * expires after five minutes, so the screen that submits has to know when it
 * goes stale — and a token cached in a child that the parent believes is still
 * good is exactly how a referrer gets "that bot check has expired" after seven
 * pages of typing.
 *
 * Two things it handles that a referrer would otherwise meet as a failed
 * submission:
 *
 * - **Expiry, before it matters.** Turnstile calls `expired-callback` at five
 *   minutes; this clears the token and asks for a fresh one immediately, so the
 *   form is ready rather than the referrer discovering it at the moment they
 *   press send. Somebody re-reading their answers on the last page will hit
 *   this and should never know.
 * - **A failed challenge.** `error-callback` clears the token and says so in a
 *   live region, because the send button is unavailable until there is one and
 *   an unexplained dead button is indistinguishable from a broken form.
 */
export function TurnstileCheck({
  onToken,
  resetSignal,
}: {
  onToken: (token: string | null) => void;
  /** Increment to spend the current token and ask for a fresh one. */
  resetSignal: number;
}) {
  const siteKey = turnstileSiteKey();
  const labelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * Held in a ref so the mount effect below does not depend on it. The screen
   * rebuilds this callback on most renders, and a dependency on it would tear
   * down and re-render the widget — minting a fresh token each time, and
   * eventually tripping Turnstile's own rate limiting.
   */
  const report = useRef(onToken);
  useEffect(() => {
    report.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (siteKey === null) return undefined;

    let cancelled = false;

    void loadTurnstile()
      .then(() => {
        // StrictMode mounts twice in development; without this the second pass
        // renders a second widget into the container the first is using.
        if (cancelled || container.current === null) return;

        widgetId.current =
          window.turnstile?.render(container.current, {
            sitekey: siteKey,
            callback: (token) => {
              setFailed(false);
              report.current(token);
            },
            'expired-callback': () => {
              report.current(null);
              if (widgetId.current !== null) window.turnstile?.reset(widgetId.current);
            },
            /*
             * Turnstile's own guidance is to reset on error, and it is right:
             * a challenge that failed once usually succeeds on a second pass.
             * The referrer is told, because the send button is unavailable
             * meanwhile and a dead button with no explanation reads as a
             * broken form — but they are not asked to do anything yet.
             */
            'error-callback': () => {
              setFailed(true);
              report.current(null);
              if (widgetId.current !== null) window.turnstile?.reset(widgetId.current);
            },
          }) ?? null;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (widgetId.current !== null) {
        window.turnstile?.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  /*
   * A spent token is worth nothing and Turnstile will refuse it a second time,
   * so a refused submission asks for a fresh one rather than leaving the
   * referrer to press send against a token the food bank has already rejected.
   *
   * Skipped on the first render: `resetSignal` starts at zero and the widget
   * has only just minted its first token.
   */
  const lastReset = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === lastReset.current) return;
    lastReset.current = resetSignal;
    if (widgetId.current !== null) {
      report.current(null);
      window.turnstile?.reset(widgetId.current);
    }
  }, [resetSignal]);

  if (siteKey === null) return null;

  return (
    <div className={styles.check}>
      <p className={styles.label} id={labelId}>
        Security check
      </p>
      <div aria-labelledby={labelId} ref={container} role="group" />
      {/*
        Never "reload the page": nothing on this form is saved anywhere, so that
        advice costs a referrer seven pages of somebody else's details. The check
        is already trying again by itself; if it truly cannot pass, the food bank
        takes referrals by phone as it always did.
      */}
      <p aria-atomic="true" className={styles.status} role="status">
        {failed
          ? 'The security check did not pass. It is trying again — if this does not clear, phone the food bank and they will take the referral over the phone.'
          : ''}
      </p>
    </div>
  );
}
