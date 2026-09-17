import { useEffect, useRef, useState } from 'react';
import { ErrorNotice } from '../../../components/error-notice';
import {
  ClipboardCheckIcon,
  ClockIcon,
  CopyIcon,
  KeyIcon,
  RefreshIcon,
  UsersIcon,
} from '../../../components/icons';
import { PageHeader } from '../../../components/page-header';
import { classNames } from '../../../lib/class-names';
import { copyToClipboard } from '../../../lib/clipboard';
import { formatLondonDateTime } from '../../../lib/london-time';
import { useGenerateVolunteerCode, type VolunteerCode } from '../queries';
import styles from './volunteer-code-screen.module.css';

/**
 * Where a team lead or admin mints a counting code for a volunteer with no
 * account (`screenDetails.md`, "The stock take").
 *
 * **The code is in the response and nowhere else** — only a hash is stored, so
 * nothing fetches it again. It is shown once, big enough to read out across a
 * warehouse, alongside the time it stops working. If it is lost the answer is
 * always another press of the button; every earlier code lapses at its own
 * expiry time.
 */
export function VolunteerCodeScreen() {
  const generate = useGenerateVolunteerCode();
  const [issued, setIssued] = useState<VolunteerCode | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resultRef = useRef<HTMLHeadingElement>(null);

  /*
   * A write with no idempotency key: the guard is a synchronous ref, not the
   * button's `disabled`, so a real double tap has its second click refused here
   * rather than landing a second mint (`.claude/rules/data-fetching.md`).
   *
   * **The lock releases on every outcome, including a 5xx or a dropped
   * connection** — a deliberate divergence from that rule's "a network failure
   * or a 5xx does not unlock". The rule guards writes where a duplicate costs
   * something; here a second code leaves the first valid until its own expiry.
   * Holding the lock after a failed request would instead leave a team lead
   * with a dead button and no code, which is the worse outcome. The guard still
   * earns its place against the fast double tap.
   */
  const inFlight = useRef(false);

  const run = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setCopyState('idle');
    generate.mutate(undefined, {
      onSuccess: (code) => {
        setIssued(code);
      },
      onSettled: () => {
        inFlight.current = false;
      },
    });
  };

  // A screen-reader team lead who pressed "Generate a code" needs to land on the
  // result, not hunt down the page for it.
  useEffect(() => {
    if (issued !== null) resultRef.current?.focus();
  }, [issued]);

  const busy = generate.isPending;

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader
          description={
            <p>
              Generate a code for whoever is counting the shelves this morning. They enter it on the
              stock-take sign-in — no account needed — and it lets them onto the stock take and
              nothing else. The expiry date and time come from the code you generate.
            </p>
          }
          icon={<UsersIcon />}
          title="Volunteer counting code"
        />
      </div>

      {generate.isError && <ErrorNotice error={generate.error} />}

      {issued !== null && (
        <div className={styles.result}>
          <div className={styles.resultTitle}>
            <span className={styles.resultIcon}>
              <KeyIcon />
            </span>
            <h2 className={styles.resultHeading} ref={resultRef} tabIndex={-1}>
              Your volunteer code
            </h2>
          </div>
          <p className={styles.shareText}>This is the code to use for doing a stock take.</p>
          <div className={styles.codeBox}>
            <p className={styles.code}>{issued.code}</p>
            <button
              aria-label={
                copyState === 'copied' ? 'Code and message copied' : 'Copy code and message'
              }
              className={classNames('button-plain', styles.copyButton)}
              onClick={() => {
                void copyToClipboard(volunteerCodeMessage(issued)).then((ok) => {
                  setCopyState(ok ? 'copied' : 'failed');
                });
              }}
              type="button"
            >
              {copyState === 'copied' ? <ClipboardCheckIcon /> : <CopyIcon />}
            </button>
          </div>
          <p className={styles.expiry}>
            <ClockIcon className={styles.expiryIcon} />
            Stops working at {expiryTime(issued.expiresAt)}.
          </p>
          <p className={styles.once}>
            It will not be shown again. If it is lost, generate another and this one will lapse on
            its own.
          </p>
          {copyState === 'failed' && (
            <p className={styles.copyError}>
              Copy did not work on this device. Select the message, code and expiry above and copy
              them by hand.
            </p>
          )}
          <p className={styles.srOnly} role="status">
            {copyState === 'copied'
              ? 'Code copied to the clipboard.'
              : copyState === 'failed'
                ? 'Copy did not work. Select the message, code and expiry shown and copy them by hand.'
                : ''}
          </p>
        </div>
      )}

      <div className={styles.actions}>
        <button
          aria-busy={busy}
          aria-disabled={busy}
          className={styles.generate}
          onClick={run}
          type="button"
        >
          {issued !== null && !busy && <RefreshIcon className={styles.generateIcon} />}
          {busy ? 'Generating…' : issued === null ? 'Generate a code' : 'Generate another code'}
        </button>
      </div>
    </div>
  );
}

/** `expiresAt` is epoch seconds — an instant, so formatting it in London is correct. */
function expiryTime(expiresAt: number): string {
  return `${formatLondonDateTime(new Date(expiresAt * 1000).toISOString())} UK time`;
}

/** The full, self-contained message a team lead can paste directly into WhatsApp. */
function volunteerCodeMessage(issued: VolunteerCode): string {
  return `This is the code to use for doing a stock take.\n\n${issued.code}\n\nIt stops working at ${expiryTime(issued.expiresAt)}.`;
}
