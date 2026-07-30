import { useId, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate } from '../../../lib/london-time';
import { normaliseEmail } from '../public-referral.logic';
import { usePublicSessions, useReferrerCheck, type ReferrerCheck } from '../queries';
import { CHECK_DEBOUNCE_MS, useDebouncedValue } from '../use-debounced-value';
import styles from './public-referral-screen.module.css';

/**
 * The public referral route. **Referrals are not taken here yet, and the page
 * says so first.**
 *
 * What it does do is the two questions a referrer can usefully ask before they
 * pick up the phone: when is there space, and are we allowed to refer. Both come
 * from unauthenticated endpoints, so this whole screen is the proof that the
 * third way into the system works — `/refer` is a sibling of the authenticated
 * layout, not a child of it, so it renders no shell, mounts no route guard, and
 * issues **no request to `/auth/refresh`**. A referrer has no account and never
 * will; making them wait on a round trip that could only fail would be a bug
 * that hurts exactly the people the service exists for.
 *
 * **It is deliberately not a form, and must not become one by accident.** There
 * is no submit button, no `<form>` element and no field a referral could be
 * typed into: a page that looks like it takes referrals and does not would leave
 * somebody believing a household had been booked in. The one input on it checks
 * an address and says so on the label. The real form, Turnstile and the
 * fifteen-minute edit window are Slice 6, and they arrive under this same route.
 */
export function PublicReferralScreen() {
  const sessions = usePublicSessions();

  const [typed, setTyped] = useState('');
  /*
   * Debounced, then normalised, then used as both the cache key and the request
   * body. The debounce is the rate-limit defence (see `use-debounced-value.ts`)
   * and the key is what makes a slow answer for an old address unable to
   * overwrite a fresh answer for the current one — they are two cache entries,
   * not one variable being raced.
   */
  const email = normaliseEmail(useDebouncedValue(typed, CHECK_DEBOUNCE_MS));
  const check = useReferrerCheck(email);

  const emailId = useId();
  const hintId = useId();
  const verdictId = useId();
  const errorId = useId();

  const describedBy = [hintId, verdictId, check.isError ? errorId : null]
    .filter((id) => id !== null)
    .join(' ');

  return (
    <main className={styles.screen}>
      <PageHeader title="Refer someone to the food bank" />

      <div className={styles.notice}>
        <h2 className={styles.noticeHeadline}>Referrals cannot be made online yet</h2>
        <p>
          There is nothing on this page that sends a referral. To refer somebody today, please phone
          the food bank and they will take the details over the phone.
        </p>
        <p>
          While you are here, you can check when there is space and whether your organisation is
          already on the food bank&rsquo;s list of referrers.
        </p>
      </div>

      <section className={styles.section}>
        <h2>When there is space</h2>
        <p>
          These are the sessions with room for another household in the next fortnight. Mention the
          one you want when you ring.
        </p>

        {sessions.isPending && <Spinner label="Loading sessions…" />}

        {sessions.isError && (
          <ErrorNotice
            error={sessions.error}
            onRetry={() => {
              void sessions.refetch();
            }}
          />
        )}

        {sessions.isSuccess &&
          (sessions.data.length === 0 ? (
            <EmptyState
              headline="No sessions have space at the moment"
              sentence="Nothing in the next fortnight has room for another household. Phone the food bank anyway — they will know what is coming up."
            />
          ) : (
            <ul className={styles.sessions}>
              {sessions.data.map((session) => (
                <li className={styles.session} key={session.id}>
                  {/*
                   * The date is a calendar day and the time is a wall clock,
                   * printed exactly as the charity typed them. No end time: that
                   * is `startTime` plus `durationMinutes`, which has to be right
                   * past midnight, and a wrong closing time on a public page
                   * sends somebody to a locked hall.
                   */}
                  <span className={styles.when}>
                    {formatSessionDate(session.sessionDate)} at {session.startTime}
                  </span>
                  <span className={styles.where}>{session.location}</span>
                </li>
              ))}
            </ul>
          ))}
      </section>

      <section className={styles.section}>
        <h2>Whether your organisation can refer</h2>
        <p>
          Food banks take referrals from named organisations — a school, a GP surgery, a support
          worker. Type your work email address and we will tell you whether it is on the list.
        </p>

        <div className={styles.field}>
          <label htmlFor={emailId}>Your work email address</label>
          <input
            aria-describedby={describedBy}
            autoComplete="email"
            className={styles.input}
            id={emailId}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            type="email"
            value={typed}
          />
          <p className={styles.hint} id={hintId}>
            Checked as you type. This only looks the address up — it does not make a referral and
            does not tell the food bank you were here.
          </p>
        </div>

        {/*
         * A live region that is always in the DOM, so the answer is announced
         * when it arrives rather than hoping an inserted element is noticed.
         * `role="status"` is polite: it waits for a pause instead of cutting
         * across somebody still typing their address.
         *
         * The shared `Spinner` is not used inside it — that component is itself
         * a `role="status"`, and a live region nested in a live region gets the
         * same sentence announced twice.
         */}
        <div aria-atomic="true" className={styles.verdict} id={verdictId} role="status">
          {check.isFetching ? (
            <p>Checking that address…</p>
          ) : (
            check.data !== undefined && <Verdict result={check.data} />
          )}
        </div>

        {check.isError && (
          <div id={errorId}>
            <ErrorNotice error={check.error} />
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * The two answers, and neither is an error.
 *
 * "Not on the list" is the one that matters. The person reading it has done
 * nothing wrong — most often their organisation refers by phone and has never
 * been added — so it gets a way forward rather than a red box. Treating it as a
 * failure would turn a five-minute phone call into somebody deciding the food
 * bank cannot help them.
 */
function Verdict({ result }: { result: ReferrerCheck }) {
  if (!result.authorised) {
    return (
      <>
        <p className={styles.verdictHeadline}>That address is not on the list yet</p>
        <p>
          That does not mean you cannot refer somebody. Phone the food bank: they can take the
          referral over the phone, and add your organisation so the check recognises you next time.
        </p>
      </>
    );
  }

  return (
    <>
      {/*
       * `organisationName` is typed `string | null` even when authorised, so the
       * name is only ever named when there is one. Rendering it unguarded would
       * put the word "null" in the middle of the sentence somebody is relying on.
       */}
      <p className={styles.verdictHeadline}>
        {result.organisationName === null
          ? 'Yes — that address can refer to this food bank'
          : `Yes — we have you as ${result.organisationName}`}
      </p>
      <p>
        Phone the food bank with the household&rsquo;s details and the session you want, and they
        will book them in.
      </p>
    </>
  );
}
