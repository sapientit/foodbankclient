import { useId, useMemo, useState } from 'react';
import foodbankLogo from '../../../assets/foodbank-logo.webp';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
import { describeDeliveryWindow } from '../delivery-window.logic';
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

  const summaryId = useId();

  const page = referralFormDefinition.pages[pageIndex];
  const isLastPage = pageIndex === referralFormDefinition.pages.length - 1;

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

  const goNext = () => {
    if (!validatePage()) return;
    setPageIndex((index) => index + 1);
    // A wizard that changes its whole content without moving focus leaves a
    // screen-reader user on a button that no longer exists.
    document.getElementById(summaryId)?.focus();
  };

  const goBack = () => {
    // Deliberately not validated: going back to fix something must never be
    // blocked by the thing you are going back to fix.
    setErrors({});
    setPageIndex((index) => Math.max(0, index - 1));
    document.getElementById(summaryId)?.focus();
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

    try {
      const result = await submit.mutateAsync(built.body);
      setReceipt(result);
    } catch {
      // Rendered by `ErrorNotice` below. Never retried automatically: a
      // referral submission is not idempotent, and a retry that succeeds the
      // second time may have succeeded the first.
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

      {submit.error !== null && <ErrorNotice error={submit.error} />}

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
          <button aria-disabled={submit.isPending} className={styles.primary} type="submit">
            {isLastPage ? 'Send this referral' : 'Next'}
          </button>
        </div>
      </form>
    </main>
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
