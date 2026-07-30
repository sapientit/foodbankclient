import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './confirm-dialog.module.css';

/**
 * The one modal confirmation in the app, on the platform's `<dialog>`.
 *
 * **Render it only when it is open** — `{target !== null && <ConfirmDialog …/>}`.
 * Mounting is opening. That keeps the caller's state the single source of truth
 * for whether a question is being asked, instead of an `open` prop that can
 * disagree with the element's own `open` attribute.
 *
 * `showModal()` is what gives the top layer, the backdrop, the inert page behind
 * it and native focus containment. jsdom implements none of it — not even the
 * method — so the fallback sets the `open` attribute, and **the fallback is the
 * path every test exercises.** That is also the path a browser without `<dialog>`
 * support takes, which is why the focus trap below is written out rather than
 * left to the platform: it is the only version that holds in both.
 *
 * Escape is handled here rather than through the native `cancel` event, for the
 * same reason — one path, tested. `preventDefault` stops a real browser closing
 * the element behind React's back, leaving a mounted dialog that is invisible.
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;

    const opener = document.activeElement;

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');

    // Cancel, not confirm: the destructive answer is never the one a stray
    // Enter or Space lands on.
    cancelRef.current?.focus();

    return () => {
      // Whatever opened the dialog is where the keyboard was, and where it has
      // to go back to. A browser does this for `showModal()`; doing it here
      // covers the fallback too, and costs nothing when it is already done.
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <dialog
      aria-labelledby={titleId}
      className={styles.dialog}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
          return;
        }

        if (event.key === 'Tab') trapFocus(event.currentTarget, event);
      }}
      ref={dialogRef}
    >
      <h2 className={styles.title} id={titleId}>
        {title}
      </h2>

      <div className={styles.body}>{children}</div>

      <div className={styles.actions}>
        <button className={styles.cancel} onClick={onCancel} ref={cancelRef} type="button">
          Cancel
        </button>
        <button className={styles.confirm} disabled={busy} onClick={onConfirm} type="button">
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Keeps Tab inside the dialog. A question with a destructive answer must not let
 * the keyboard wander onto the page behind it, where every control is one the
 * dialog is asking about.
 */
function trapFocus(dialog: HTMLDialogElement, event: React.KeyboardEvent): void {
  const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable.at(0);
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return;

  const edge = event.shiftKey ? first : last;
  if (document.activeElement !== edge) return;

  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}
