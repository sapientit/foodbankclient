import { useEffect, useRef, useState } from 'react';

/** How long a toast stays up: long enough to read, short enough to read as transient. */
const TOAST_DURATION_MS = 4000;

/**
 * A brief, transient echo of a reason already written down persistently
 * elsewhere on the screen — never the only place that reason lives. Settled
 * by Pete on 2026-08-30 for the unavailable session-wide controls on Run a
 * session: pressing a control that is greyed and reachable repeats its
 * `aria-describedby` sentence here, so a team lead who tried it anyway gets
 * an answer at the moment they asked, without the sentence itself ever being
 * the only way to learn it.
 *
 * Deliberately local, not a global provider: this is one small piece of
 * state per control group, the same way every other outcome message in this
 * feature (`sms-panel.tsx`, `SessionRefusal`) is a `role="status"` paragraph
 * owned by the component that produced it. Render the result with
 * `<Toast message={message} />` from `./toast`.
 */
export function useToast(): {
  readonly message: string | null;
  readonly show: (text: string) => void;
} {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const show = (text: string) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => {
      setMessage(null);
    }, TOAST_DURATION_MS);
  };

  return { message, show };
}
