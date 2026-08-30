import styles from './toast.module.css';

/**
 * `role="status"` rather than a floating popup — read by the same means as
 * every other outcome message here. See `use-toast.ts`.
 *
 * **Considered, and deliberately not done: staying mounted with empty text
 * between presses**, so the live region always exists rather than being
 * created fresh on each press. Some browser/screen-reader combinations are
 * more reliable about a region that already existed before its text changed
 * — but this screen already has one persistent `role="status"` region of its
 * own (`RunSessionLayout`'s read-only notice), and every control that can
 * show a toast (the Print tab, Stock check, Complete Session) owns its own
 * `Toast` instance, so an always-mounted version would put two or three
 * empty status regions on the page at once, indistinguishable from each
 * other and from the one that already means something. Unproven reliability
 * gain against a real, demonstrated collision — not worth it here.
 */
export function Toast({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p className={styles.toast} role="status">
      {message}
    </p>
  );
}
