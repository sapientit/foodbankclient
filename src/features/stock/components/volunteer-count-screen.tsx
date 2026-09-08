import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import foodbankLogo from '../../../assets/foodbank-logo.webp';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import {
  getVolunteerCode,
  normaliseVolunteerCode,
  setVolunteerCode,
  subscribeToVolunteerCode,
} from '../../../api/volunteer-code-store';
import { stockKeys } from '../keys';
import { StockTakeScreen } from './stock-take-screen';
import styles from './volunteer-count-screen.module.css';

/**
 * The stock take on a device that never signs in (`screenDetails.md`, "The
 * stock take" and "#Login").
 *
 * A volunteer reaches this from "Doing a stock take?" on the sign-in screen,
 * types the code a team lead read out, and lands straight on the count — no
 * menu, no other screen. The code is held in memory only (see
 * `volunteer-code-store.ts`): a reload asks for it again, and leaving this
 * screen clears it so the next person on a shared device starts fresh.
 *
 * On this screen a 401 is final — the code has lapsed, and only a team lead can
 * issue a new one. `StockTakeScreen` reports that through `onAuthError`; there
 * is no refresh to attempt.
 */
export function VolunteerCountScreen() {
  const code = useSyncExternalStore(subscribeToVolunteerCode, getVolunteerCode);
  const queryClient = useQueryClient();
  const [expired, setExpired] = useState(false);
  const [entry, setEntry] = useState('');
  const [confirmingFinish, setConfirmingFinish] = useState(false);

  // Held in memory only, and only while this screen is open. Navigating away —
  // browser back, a bookmark, the across-deploy redirect — must not leave a
  // live code in the tab for the next person. The stock queries are left to
  // TanStack Query's own garbage collection; `startCode` drops them explicitly
  // on the path that matters (a fresh code after a lapse).
  useEffect(() => {
    return () => {
      setVolunteerCode(null);
    };
  }, []);

  const handleAuthError = useCallback(() => {
    // The stock queries are now in their 401 state. Leave them for `startCode`
    // to drop once nothing is observing them — clearing here, while
    // `StockTakeScreen` is still mounted, would have it re-observe a removed
    // query and refetch into the same failure. The typed code stays put so the
    // volunteer can fix one wrong character rather than retype nineteen.
    setVolunteerCode(null);
    setExpired(true);
  }, []);

  const finish = useCallback(() => {
    // Not `removeQueries` here — `startCode` does that before the next mount,
    // and clearing while the signed-in-staff case still has real stock cached
    // would only cost a refetch.
    setVolunteerCode(null);
    setExpired(false);
    setEntry('');
    setConfirmingFinish(false);
  }, []);

  const startCode = useCallback(
    (entered: string) => {
      // Nothing is mounted on the count now, so this removes the previous
      // code's cached stock — an old 401 especially — cleanly, and the next
      // mount of `StockTakeScreen` starts from a pending fetch.
      queryClient.removeQueries({ queryKey: stockKeys.all });
      setExpired(false);
      setVolunteerCode(entered);
    },
    [queryClient],
  );

  if (code !== null) {
    return (
      <div className={styles.screen}>
        <header className={styles.header}>
          <img alt="Foodbank logo" className={styles.banner} src={foodbankLogo} />
          <button
            className="button-secondary"
            onClick={() => {
              setConfirmingFinish(true);
            }}
            type="button"
          >
            Finish counting
          </button>
        </header>
        <main className={styles.main}>
          <StockTakeScreen onAuthError={handleAuthError} />
        </main>
        {confirmingFinish && (
          <ConfirmDialog
            title="Finish the stock take?"
            confirmLabel="Finish counting"
            cancelLabel="Keep counting"
            onConfirm={finish}
            onCancel={() => {
              setConfirmingFinish(false);
            }}
          >
            <p>
              You will need a new code from your team leader to count again. Any counts you have
              entered on this page but not saved will be lost.
            </p>
          </ConfirmDialog>
        )}
      </div>
    );
  }

  return (
    <CodeEntry expired={expired} onSubmit={startCode} value={entry} onValueChange={setEntry} />
  );
}

function CodeEntry({
  expired,
  value,
  onValueChange,
  onSubmit,
}: {
  readonly expired: boolean;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: (code: string) => void;
}) {
  const codeId = useId();
  const hintId = useId();
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  // A code that lapsed mid-count drops the volunteer back here. Land them on the
  // reason, the same as the sign-in screen does with a failed sign-in.
  useEffect(() => {
    if (expired) alertRef.current?.focus();
  }, [expired]);

  const startCounting = () => {
    const entered = normaliseVolunteerCode(value);
    if (entered === '') {
      setError('Enter the code your team leader gave you.');
      return;
    }
    setError(null);
    onSubmit(entered);
  };

  const describedBy = [hintId, error === null ? null : errorId]
    .filter((id) => id !== null)
    .join(' ');

  return (
    <main className={styles.entry}>
      <img alt="Foodbank logo" className={styles.banner} src={foodbankLogo} />
      <h1>Stock take</h1>

      {expired && (
        <p className={styles.expired} ref={alertRef} role="alert" tabIndex={-1}>
          That code has stopped working. It may have expired, or been typed wrong. Ask your team
          leader to read it out again, or to generate a new one.
        </p>
      )}

      <p className={styles.intro}>
        Enter the counting code your team leader gave you. You do not need to sign in.
      </p>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          startCounting();
        }}
      >
        <div className={styles.field}>
          <label htmlFor={codeId}>Counting code</label>
          <p className={styles.hint} id={hintId}>
            Four groups of letters and numbers. Capitals and the dashes between groups do not
            matter.
          </p>
          <input
            aria-describedby={describedBy}
            aria-invalid={error === null ? undefined : true}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            className={styles.input}
            id={codeId}
            inputMode="text"
            onChange={(event) => {
              onValueChange(event.target.value.toUpperCase());
            }}
            spellCheck={false}
            value={value}
          />
          {error !== null && (
            <p className={styles.fieldError} id={errorId}>
              {error}
            </p>
          )}
        </div>

        <button className={styles.submit} type="submit">
          Start counting
        </button>
      </form>
    </main>
  );
}
