import { useEffect, useState } from 'react';
import styles from './spinner.module.css';

/**
 * A busy indicator that waits before showing itself.
 *
 * Most responses here are cached or come off a local API in under a frame, and a
 * spinner that appears and vanishes inside 100 ms reads as a flicker — it makes a
 * fast app look broken. So nothing is drawn until the wait is long enough to be
 * worth admitting to.
 *
 * `delayMs={0}` opts out, for the one case where the spinner *is* the page: the
 * session restore blanks the whole screen until it resolves, and a blank screen
 * is worse than an immediate spinner.
 */
const DEFAULT_DELAY_MS = 150;

export function Spinner({
  label,
  delayMs = DEFAULT_DELAY_MS,
}: {
  label: string;
  delayMs?: number;
}) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) return undefined;

    const timer = setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div className={styles.spinner} role="status">
      <span aria-hidden="true" className={styles.disc} />
      <span>{label}</span>
    </div>
  );
}
