import { useEffect, useId, useMemo, useRef, useState } from 'react';
import foodbankLogo from '../../../assets/foodbank-logo.webp';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, describeApiError } from '../../../lib/errors';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
import {
  deliveryWindowConfirmation,
  describeDeliveryWindow,
  refusedForDeliveryPlaces,
} from '../delivery-window.logic';
import {
  CHECK_DEBOUNCE_MS,
  normaliseEmail,
  referrerVerdict,
  suggestedOrganisation,
  type ReferrerVerdict,
} from '../public-referral.logic';
import { referralFormDefinition } from '../referral-form-config';
import {
  isAnswerableQuestion,
  keyFieldKey,
  type AnswerableQuestion,
} from '../referral-form-definition';
import { buildPageSchema, defaultAnswers } from '../referral-form-schema';
import {
  clearDisabledAnswers,
  describePageProgress,
  isEnabled,
  type AnswerValue,
  type FormAnswers,
} from '../referral-form.logic';
import type { ReferralLookups } from '../referral-lookups';
import { describeSubmission, splitSubmission } from '../referral-submission.logic';
import {
  buildSubmissionBody,
  usePublicOrganisations,
  usePublicReferralReasons,
  usePublicSessions,
  useReferrerCheck,
  useSubmitReferral,
  type ReferralReceipt,
} from '../queries';
import { ReferralQuestionField, type QuestionLookups } from './referral-question-field';
import styles from './public-referral-screen.module.css';

/**
 * The public referral form: seven pages of the charity's own questions, from
 * `referral-form.config.json`.
 *
 * `/refer` is a **sibling** of the authenticated layout rather than a child of
 * it, so this renders no shell, mounts no route guard and issues **no request
 * to `/auth/refresh`**. A referrer has no account and never will; making them
 * wait on a round trip that could only fail would be a bug that hurts exactly
 * the people the service exists for. A test asserts no refresh is issued.
 *
 * **The answers live in `useState` and nowhere else.** Not React Hook Form,
 * which every other form in this codebase uses, and the divergence is
 * deliberate: the field set is built at runtime from a config, a checkbox group
 * hands back a list rather than a string, and validation runs a page at a time
 * against a schema built for that page. Controlled state over the answer map
 * `referral-submission.logic.ts` already expects is simpler than three
 * `Controller`s and a resolver that changes per page — and every rule it
 * enforces is pure and tested without a DOM.
 *
 * **Nothing reaches disk.** No draft, no resume, no autosave — a seven-page
 * form on a phone is exactly where somebody reaches for `localStorage`, and
 * `.claude/rules/pii-security.md` forbids it. Losing the form on navigation is
 * the correct behaviour, and the last page says so before it is too late.
 */

/**
 * The two answers this screen reaches for by name, looked up rather than
 * spelled: a key field's question key and the column it writes are independent
 * in the config. `undefined` would mean a released config that no longer asks
 * for one of them, in which case the check simply has nothing to work on —
 * `buildSubmissionBody` is what says so, on the page that can act on it.
 */
const REFERRER_EMAIL_KEY = keyFieldKey(referralFormDefinition, 'referrerEmail');
const REFERRER_ORGANISATION_KEY = keyFieldKey(referralFormDefinition, 'referrerOrganisation');
const SESSION_KEY = keyFieldKey(referralFormDefinition, 'sessionId');
const REASON_KEY = keyFieldKey(referralFormDefinition, 'reasonId');

/**
 * The tick a delivery refusal takes back, or `null` where this questionnaire
 * asks for no such confirmation. Read from the config once, like the key
 * fields above, because the charity's form is what names its own questions.
 */
const WINDOW_CONFIRMATION = deliveryWindowConfirmation(referralFormDefinition);

export function PublicReferralScreen() {
  const sessions = usePublicSessions();
  const reasons = usePublicReferralReasons();
  const organisations = usePublicOrganisations();
  const submit = useSubmitReferral();

  const [answers, setAnswers] = useState<FormAnswers>(() => defaultAnswers(referralFormDefinition));
  const [pageIndex, setPageIndex] = useState(0);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [receipt, setReceipt] = useState<ReferralReceipt | null>(null);
  const [misconfigured, setMisconfigured] = useState<readonly string[]>([]);
  // Whether the referrer has finished with the address. See `referrerVerdict`:
  // it is what separates "we do not recognise you" from a verdict on half a
  // domain, and `change` withdraws it the moment they edit the address again.
  const [addressLeft, setAddressLeft] = useState(false);
  // Whether a submission may have landed without us hearing so. See `sending`.
  const [sendUncertain, setSendUncertain] = useState(false);

  /**
   * The lock on the one unauthenticated write in the system, and the one whose
   * duplicate books a household onto a session twice and takes two places off
   * it that another household needed.
   *
   * **A ref rather than `disabled`, per `.claude/rules/data-fetching.md`.**
   * `disabled` lands on the next render and a real double tap gets both clicks
   * in first; `aria-disabled` lets the second click reach this handler, where
   * the ref refuses it. It also has to be independent of `submit.isPending`,
   * which is observer state and goes back to idle if the mutation is reset —
   * as it is on every page change, so that a refusal does not follow the
   * referrer forward.
   *
   * **Released only on a `4xx`, where the food bank has said it wrote
   * nothing.** A network failure or a `5xx` may well have written, and
   * re-arming the button after one is exactly how the duplicate gets made.
   */
  const sending = useRef(false);

  const summaryId = useId();
  const uncertainNoticeId = useId();

  /*
   * The page the referrer is actually on, readable from an `await` that
   * started on another one. `recoverOnPageOne` reads it after its refetch, and
   * a stale capture there would be the difference between a correct form and a
   * dead end — see the guard at its use.
   *
   * Written from an effect rather than during render, which a lint rule
   * forbids: this is only ever read from a continuation that resumes long
   * after paint, so the effect's timing costs it nothing.
   */
  const pageRef = useRef(pageIndex);
  useEffect(() => {
    pageRef.current = pageIndex;
  }, [pageIndex]);

  const page = referralFormDefinition.pages[pageIndex];
  const isLastPage = pageIndex === referralFormDefinition.pages.length - 1;
  // Only a 4xx proves the food bank wrote nothing. A timeout or 5xx keeps the
  // separate uncertain-outcome warning below, because a second referral could
  // book the household twice.
  const submissionRefused =
    submit.error instanceof ApiError && submit.error.status >= 400 && submit.error.status < 500;

  const lookups: QuestionLookups = useMemo(
    () => ({
      sessions: sessions.data ?? [],
      referralReasons: reasons.data ?? [],
      organisations: organisations.data ?? [],
    }),
    [sessions.data, reasons.data, organisations.data],
  );

  /**
   * What `$deliveryTime` reads as, for the session chosen on this page.
   *
   * `null` until a session is picked, which hides the line and the confirmation
   * that refers to it rather than asking a referrer to agree to a blank. This
   * is why the session question sits **above** the collection method in the
   * config: it is the answer both of them depend on.
   */
  const variables = useMemo(() => {
    // `keyFieldKey` answers from the config, so a form with no session question
    // is expressible. Nothing to resolve against then, and the line hides.
    if (SESSION_KEY === undefined) return { deliveryTime: null };

    const chosen = answers[SESSION_KEY];
    const session =
      typeof chosen === 'string'
        ? lookups.sessions.find((candidate) => candidate.id === chosen)
        : undefined;
    return { deliveryTime: session === undefined ? null : describeDeliveryWindow(session) };
  }, [answers, lookups.sessions]);

  // The check lives here rather than in the notice because two things depend on
  // it: what the notice says, and the organisation the form fills in below.
  const typedAddress = REFERRER_EMAIL_KEY === undefined ? '' : answers[REFERRER_EMAIL_KEY];
  const settledAddress = normaliseEmail(
    useDebouncedValue(typeof typedAddress === 'string' ? typedAddress : '', CHECK_DEBOUNCE_MS),
  );
  const check = useReferrerCheck(settledAddress);

  const suggestion = suggestedOrganisation(check.data, organisations.data ?? []);

  /*
   * `screenDetails.md`: "When the address is recognised, the organisation it
   * belongs to is already known and the form fills that in for them rather than
   * asking."
   *
   * React's "adjusting state when a prop changes" — compared against the last
   * verdict and set during render, not from an effect, so the box is filled
   * before anybody sees it empty and no second render is scheduled.
   *
   * **Only ever into an empty box, and only when the verdict itself changes.**
   * An organisation the referrer chose is never overwritten, and one they
   * deliberately cleared — which is also how "my organisation is not listed"
   * starts — does not reappear under their hands.
   */
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  if (suggestion !== filledFrom) {
    setFilledFrom(suggestion);
    if (suggestion !== null && REFERRER_ORGANISATION_KEY !== undefined) {
      setAnswers((current) =>
        current[REFERRER_ORGANISATION_KEY] === ''
          ? { ...current, [REFERRER_ORGANISATION_KEY]: suggestion }
          : current,
      );
    }
  }

  if (receipt !== null) {
    return <Confirmation answers={answers} lookups={lookups} receipt={receipt} />;
  }

  if (sessions.isPending || reasons.isPending || organisations.isPending) {
    return (
      <main className={styles.screen}>
        <FoodbankBanner />
        <PageHeader title="Refer someone to the food bank" />
        <Spinner label="Loading the form…" />
      </main>
    );
  }

  // Without the sessions there is no form to fill in — every referral has to
  // name one — so this is a stop rather than a degraded page.
  if (sessions.isError) {
    return (
      <main className={styles.screen}>
        <FoodbankBanner />
        <PageHeader title="Refer someone to the food bank" />
        <ErrorNotice
          error={sessions.error}
          onRetry={() => {
            void sessions.refetch();
          }}
        />
      </main>
    );
  }

  if (page === undefined) return null;

  const change = (key: string, value: AnswerValue) => {
    setAnswers((current) => {
      const next = { ...current, [key]: value };
      // Run every time an answer changes, so a question that has just greyed
      // out forgets what was typed into it rather than submitting it unseen.
      return clearDisabledAnswers(referralFormDefinition, next);
    });
    // Clear this field's error as soon as it is touched: an error that
    // outlives the thing it complained about reads as a form that will not
    // let you past.
    setErrors((current) => {
      if (current[key] === undefined) return current;
      const { [key]: _cleared, ...rest } = current;
      return rest;
    });
    // A verdict is a verdict on the address as it stood. Editing it takes back
    // "we do not recognise that address" until they have finished again.
    if (key === REFERRER_EMAIL_KEY) setAddressLeft(false);
  };

  const validatePage = (): boolean => {
    // Only what is on screen. A greyed-out question is not answerable, so
    // holding somebody to its rules would be a refusal they cannot act on.
    const answerable = page.questions.filter(
      (question): question is AnswerableQuestion =>
        isAnswerableQuestion(question) && isEnabled(question, answers),
    );
    const schema = buildPageSchema({ ...page, questions: answerable });

    const subject: Record<string, AnswerValue> = {};
    for (const question of answerable) subject[question.key] = answers[question.key] ?? '';

    const result = schema.safeParse(subject);
    if (result.success) {
      setErrors({});
      return true;
    }

    const found: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && found[key] === undefined) found[key] = issue.message;
    }
    setErrors(found);
    return false;
  };

  /**
   * A refusal belongs to the page it sent the referrer to, and to nothing
   * after it. Without this, "that session is full" follows them onto the page
   * about pet food and reads as a form that has broken — the same reasoning as
   * the field errors cleared beside it, applied to the one notice that
   * survives a page change.
   */
  const leavePage = (to: (index: number) => number) => {
    submit.reset();
    setPageIndex(to);
    // A wizard that changes its whole content without moving focus leaves a
    // screen-reader user on a button that no longer exists.
    document.getElementById(summaryId)?.focus();
  };

  const goNext = () => {
    if (!validatePage()) return;
    leavePage((index) => index + 1);
  };

  const goBack = () => {
    // Deliberately not validated: going back to fix something must never be
    // blocked by the thing you are going back to fix.
    setErrors({});
    leavePage((index) => Math.max(0, index - 1));
  };

  /**
   * Puts a referrer back where they can act on a refusal, and refreshes the
   * list that produced it.
   *
   * **The food bank refuses six things outright.** Five are `409`s — the
   * session at its capacity, cancelled, or already signed off; the 16:00
   * cut-off the day before having passed; and a delivery to a session whose
   * delivery places are gone, which includes one that takes no deliveries at
   * all. The sixth is a `422`, a cause of crisis no longer offered. Every one
   * of them is answered on page one, and every one is a race rather than a
   * mistake: what the referrer chose was true of the list when they chose it.
   * So this is a recovery and not an error screen — nothing they typed is
   * thrown away, and they arrive at the one page holding the answers to
   * change.
   *
   * **Nothing here names the cause, deliberately.** All five `409`s carry
   * `code: "CONFLICT"`; `openapi.yaml` documents each one's sentence and puts
   * `details` on two of them, but the only thing separating the other three is
   * free text, and a client that matched on it would break silently the day
   * the food bank reworded a message. So the server's own sentence is the
   * whole of what is said about what went wrong — the submission failure notice
   * renders `409` and `422` verbatim — and this adds no wording of its own. One cause *is*
   * read, and structurally: see `WINDOW_CONFIRMATION` below.
   *
   * **Refetching is what stops the second refusal.** A session that has just
   * filled is gone from the list by the time they look, so the same doomed
   * choice cannot be made twice. And where the chosen one has gone the answer
   * is cleared with it: the question is a controlled `<select>`, so an id no
   * longer among the options renders as an empty box that the form still holds
   * as answered — the referrer would see nothing wrong, press send, and be
   * refused again for a session they can no longer see.
   */
  const recoverOnPageOne = async (error: ApiError) => {
    const { status } = error;
    setPageIndex(0);
    // Page seven's failures are not page one's. Anything still showing here
    // belongs to a page they are no longer on.
    setErrors({});
    // The same move `goNext` and `goBack` make: a wizard that changes its
    // whole content without moving focus leaves a screen-reader user on a
    // button that no longer exists. The refusal itself is announced by
    // the submission failure notice's `role="alert"`, independently of where
    // focus lands.
    document.getElementById(summaryId)?.focus();

    /*
     * **The one confirmation a refusal can invalidate.**
     * `screenDetails.md`: a delivery refusal takes back the tick saying the
     * household will be at home for the delivery time, because the session
     * they pick next may quote a different window — and a referrer must not be
     * left having visibly confirmed a line they were never shown. The other
     * tick, that the household meets the criteria for delivery, is a fact
     * about the household and survives untouched.
     *
     * **Only this refusal, and only read from `details`.** A full, cancelled or
     * confirmed session, or one whose cutoff has passed, leaves the window
     * exactly as it was, so clearing the tick there would make somebody
     * re-answer something that never changed.
     */
    if (WINDOW_CONFIRMATION !== null && refusedForDeliveryPlaces(error.details)) {
      const { key: confirmationKey, value } = WINDOW_CONFIRMATION;
      setAnswers((current) => {
        const ticked = current[confirmationKey];
        if (!Array.isArray(ticked) || !ticked.includes(value)) return current;
        return { ...current, [confirmationKey]: ticked.filter((tick) => tick !== value) };
      });
    }

    const stale = status === 422 ? await reasons.refetch() : await sessions.refetch();
    const options = stale.data;
    const key = status === 422 ? REASON_KEY : SESSION_KEY;
    if (options === undefined || key === undefined) return;

    /*
     * **Only while they are still on page one.** The refetch is a round trip,
     * and on a hall's wifi it is a slow one — long enough for somebody to press
     * Next through the pages they have already filled in and reach Send again.
     * Clearing the answer under a page they have moved past would punch a hole
     * in a page the form has already validated and will not validate again: it
     * validates a page at a time, so nothing downstream catches it, and the
     * submission fails as a *missing field* — which the screen reports as a
     * fault at our end, and never clears. Leaving the stale id alone instead
     * costs them a second refusal, which recovers exactly like the first.
     */
    if (pageRef.current !== 0) return;

    setAnswers((current) => {
      const chosen = current[key];
      if (typeof chosen !== 'string' || options.some((option) => option.id === chosen)) {
        return current;
      }
      return { ...current, [key]: '' };
    });
  };

  const send = async () => {
    if (!validatePage()) return;

    const { keyFields, answers: dynamic } = splitSubmission(referralFormDefinition, answers);
    const built = buildSubmissionBody(keyFields, dynamic);
    if (!built.ok) {
      // Only reachable if a released config lost a question the contract
      // requires — a bug here, not a mistake the referrer made, so it says so
      // rather than blaming the form they just filled in.
      setMisconfigured(built.missing);
      return;
    }

    if (sending.current) return;
    sending.current = true;

    try {
      const result = await submit.mutateAsync(built.body);
      setReceipt(result);
    } catch (error) {
      // Rendered by the dedicated failure notice below. Never retried
      // automatically: a referral submission is not idempotent, and a retry
      // that succeeds the second time may have succeeded the first.
      const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (refused) {
        sending.current = false;
      } else {
        // The lock stays on, because the referral may well have landed. Say so
        // rather than leaving a button that looks live and swallows the click,
        // which is indistinguishable from a broken form.
        setSendUncertain(true);
      }

      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
        await recoverOnPageOne(error);
      }
    }
  };

  return (
    <main className={styles.screen}>
      <FoodbankBanner />
      <PageHeader title="Refer someone to the food bank" />

      <p className={styles.progress} id={summaryId} tabIndex={-1}>
        {describePageProgress(referralFormDefinition, pageIndex)}
      </p>

      <h2>{page.pageTitle}</h2>

      {pageIndex === 0 && (
        <ReferrerNotice
          verdict={referrerVerdict({
            checking: check.isFetching,
            result: check.data,
            left: addressLeft,
          })}
        />
      )}

      {submissionRefused && <SubmissionFailureNotice error={submit.error} />}

      {sendUncertain && (
        <p className={styles.finalNotice} id={uncertainNoticeId} role="alert">
          This referral may or may not have reached the food bank.{' '}
          <strong>Do not send it again</strong> — that could book the household in twice and take
          two places on the session. Please phone the food bank to check.
        </p>
      )}

      {misconfigured.length > 0 && (
        <p className={styles.finalNotice} role="alert">
          This form is missing {misconfigured.join(', ')}, which the food bank&rsquo;s system needs.
          That is a fault at our end, not yours. Please phone the food bank with the
          household&rsquo;s details.
        </p>
      )}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (isLastPage) void send();
          else goNext();
        }}
      >
        {page.questions.map((question) => (
          <ReferralQuestionField
            enabled={isEnabled(question, answers)}
            error={question.type === 'information' ? undefined : errors[question.key]}
            key={question.type === 'information' ? question.label : question.key}
            lookups={lookups}
            onChange={(value) => {
              if (question.type !== 'information') change(question.key, value);
            }}
            question={question}
            value={question.type === 'information' ? '' : (answers[question.key] ?? '')}
            variables={variables}
            {...(question.type !== 'information' && question.key === REFERRER_EMAIL_KEY
              ? {
                  onBlur: () => {
                    setAddressLeft(true);
                  },
                }
              : {})}
          />
        ))}

        {isLastPage && (
          <p className={styles.finalNotice}>
            Once you send this you cannot change it. If something needs correcting afterwards, phone
            the food bank and they will do it.
          </p>
        )}

        <div className={styles.actions}>
          {pageIndex > 0 && (
            <button onClick={goBack} type="button">
              Back
            </button>
          )}
          <button
            aria-describedby={sendUncertain ? uncertainNoticeId : undefined}
            aria-disabled={submit.isPending || sendUncertain}
            className={styles.primary}
            type="submit"
          >
            {isLastPage ? 'Send this referral' : 'Next'}
          </button>
        </div>
      </form>
    </main>
  );
}

/**
 * A submission failure must interrupt somebody who has just completed seven
 * pages. Its reason is deliberately the server's sentence where available;
 * this client cannot safely infer why a session refusal happened.
 */
function SubmissionFailureNotice({ error }: { error: unknown }) {
  const reason =
    error instanceof ApiError
      ? describeApiError(error)
      : 'We could not reach the food bank. Check your connection and try again.';

  return (
    <section className={styles.submissionFailure} role="alert">
      <h2 className={styles.submissionFailureHeading}>FAILED!!</h2>
      <p className={styles.submissionFailureSummary}>
        This client could not be referred for the selected session
      </p>
      <p className={styles.submissionFailureReason}>Reason: {reason}</p>
    </section>
  );
}

/**
 * What the referrer check has to say on page one.
 *
 * **An address the charity does not recognise is not a refusal any more.** The
 * referral is still taken; it waits for an administrator. Saying so here — and
 * not after they have typed a household's details — is the whole point of
 * checking early, and saying it as information rather than as an error is the
 * difference between somebody carrying on and somebody deciding the food bank
 * cannot help them.
 *
 * **When each verdict is fair to show is `referrerVerdict`'s decision**, not
 * this component's: a half-typed address is a complete-looking one, and saying
 * "we do not recognise that address" about it is a claim about the person
 * rather than about what they have typed so far.
 */
function ReferrerNotice({ verdict }: { verdict: ReferrerVerdict }) {
  return (
    <div aria-atomic="true" className={styles.verdict} role="status">
      {verdict.kind === 'checking' && <p>Checking that address…</p>}

      {verdict.kind === 'unrecognised' && (
        <p>
          We do not recognise that address, so an administrator will need to approve this referral
          before the household is booked in. You can carry on and send it.
        </p>
      )}

      {verdict.kind === 'authorised' && (
        <p>
          {verdict.organisationName === null
            ? 'That address can refer to this food bank.'
            : `We have you as ${verdict.organisationName}.`}
        </p>
      )}
    </div>
  );
}

function FoodbankBanner() {
  return <img alt="Foodbank logo" className={styles.banner} src={foodbankLogo} />;
}

/**
 * What the referrer is left with, and the whole of their relationship with the
 * system from here.
 *
 * `screenDetails.md`, "After a referral is submitted": there is no amending and
 * no withdrawing, so this page shows back every answer that had to be given —
 * it is the only chance anybody has to notice that a surname or a session date
 * is wrong before it becomes a phone call.
 *
 * Which is why it takes the lookups: the session and the reason were submitted
 * as ids, and a referrer cannot check a UUID. They read back as the words they
 * were chosen by — see `confirmationValue`.
 */
function Confirmation({
  answers,
  lookups,
  receipt,
}: {
  answers: FormAnswers;
  lookups: ReferralLookups;
  receipt: ReferralReceipt;
}) {
  const lines = describeSubmission(referralFormDefinition, answers, lookups);
  const pending = receipt.status === 'pending_review';

  return (
    <main className={styles.screen}>
      <FoodbankBanner />
      <PageHeader title={pending ? 'Referral sent for approval' : 'Referral sent'} />

      <div className={pending ? styles.pendingNotice : styles.sentNotice}>
        {pending ? (
          /* **Deliberately more cautious than what the session actually does,
             and not to be "corrected" to match it.** This referral is already
             holding its place: it counts against capacity, a parcel is picked
             for it, and if the household turns up the team leader serves them
             (`screenDetails.md`, "Referrals awaiting a decision"). But it may
             still be rejected, and a household sent to a hall to be turned away
             at the door is the worst outcome there is — so the referrer is told
             to check rather than to rely on it. Settled by Pete on 2026-08-16. */
          <>
            <h2 className={styles.noticeHeadline}>This household is not booked in yet</h2>
            <p>
              We do not recognise the email address you gave, so an administrator has to approve
              this referral first. Nobody should turn up to a session until the food bank confirms
              it — please phone them to check.
            </p>
          </>
        ) : (
          <>
            <h2 className={styles.noticeHeadline}>The household is booked in</h2>
            <p>There is nothing more you need to do.</p>
          </>
        )}
      </div>

      <h2>What you sent</h2>
      <p>
        Please check this now. <strong>You cannot change a referral once it is sent</strong> — if
        anything here is wrong, phone the food bank and they will correct it.
      </p>

      <dl className={styles.summary}>
        {lines.map((line) => (
          <div className={styles.summaryLine} key={line.label}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
