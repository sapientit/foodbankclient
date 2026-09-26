import { useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { EmptyState } from '../../../components/empty-state';
import { ApiError } from '../../../lib/errors';
import { formatSessionDate } from '../../../lib/london-time';
import { describeSessionChoice, standingFromCapacity } from '../../../lib/session-description';
import { useReferralReasons, type AdminReferralReason } from '../../admin-setup/queries';
import { useSessions, type Session } from '../../sessions/queries';
import { usePublicReferralFormDefinition } from '../queries';
import {
  isAnswerableQuestion,
  type AnswerableQuestion,
  type OptionSources,
  type ReferralFormDefinition,
} from '../referral-form-definition';
import { buildPageSchema } from '../referral-form-schema';
import {
  clearDisabledAnswers,
  describePageProgress,
  isEnabled,
  type AnswerValue,
  type FormAnswers,
} from '../referral-form.logic';
import { splitSubmission } from '../referral-submission.logic';
import { buildReReferInitialAnswers, reReferPages } from '../re-refer.logic';
import {
  canCopyReferral,
  copyCapacityWarning,
  hasAdminFields,
  refereeName,
  type TargetSessionOccupancy,
} from '../referrals.logic';
import { buildReReferBody, useReferral, useReReferReferral, type Referral } from '../queries';
import { ReferralQuestionField, type QuestionLookups } from './referral-question-field';
import styles from './re-refer-screen.module.css';

/**
 * What "Copy this referral" opens instead of the ordinary copy dialog, once
 * the referral form has changed since the source was answered —
 * `screenDetails.md`, "Copying a referral", and
 * `docs/planning/versioned-configuration-releases.md`, "Copying a referral
 * (admin only)". Opened in a new tab; abandoning it creates nothing.
 *
 * **The referrer is never shown as an editable field here.** The server
 * carries it forward from the source referral unquestioned and refuses it as
 * a request field entirely — see `useReReferReferral`. It is shown read-only
 * for context.
 *
 * **The session is chosen through the same warn-not-refuse picker Copy and
 * Move already use**, not as an ordinary page question — see
 * `re-refer.logic.ts` for why.
 */
export function ReReferScreen() {
  const { referralId = '' } = useParams();
  const source = useReferral(referralId);
  const form = usePublicReferralFormDefinition();
  const sessions = useSessions();
  const reasons = useReferralReasons(true);

  if (source.isPending || form.isPending || sessions.isPending || reasons.isPending) {
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Review this referral" />
        </div>
        <Spinner label="Loading the current referral form…" />
      </div>
    );
  }

  if (source.isError)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Review this referral" />
        </div>
        <ErrorNotice error={source.error} onRetry={() => void source.refetch()} />
      </div>
    );
  if (form.isError)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Review this referral" />
        </div>
        <ErrorNotice
          error={form.error}
          onRetry={() => {
            void form.refetch();
          }}
        />
      </div>
    );
  if (sessions.isError)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Review this referral" />
        </div>
        <ErrorNotice error={sessions.error} onRetry={() => void sessions.refetch()} />
      </div>
    );
  if (reasons.isError)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Review this referral" />
        </div>
        <ErrorNotice error={reasons.error} onRetry={() => void reasons.refetch()} />
      </div>
    );

  if (!hasAdminFields(source.data)) {
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Review this referral" />
        </div>
        <EmptyState
          headline="Not available"
          sentence="Reviewing a referral onto today's form is an administrator task."
        />
      </div>
    );
  }

  if (!canCopyReferral(source.data)) {
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Review this referral" />
        </div>
        <EmptyState
          headline="Not available"
          sentence="This referral can still be completed, so it should be moved rather than copied."
        />
      </div>
    );
  }

  return (
    <ReReferForm
      definition={form.data.definition}
      reasons={reasons.data}
      sessions={sessions.data}
      source={source.data}
    />
  );
}

function ReReferForm({
  source,
  definition,
  sessions,
  reasons,
}: {
  source: Referral & { reasonId: string };
  definition: ReferralFormDefinition;
  sessions: readonly Session[];
  reasons: readonly AdminReferralReason[];
}) {
  const navigate = useNavigate();
  const reRefer = useReReferReferral();

  const pages = useMemo(() => reReferPages(definition), [definition]);
  const reReferDefinition = useMemo<ReferralFormDefinition>(
    () => ({ version: definition.version, pages }),
    [definition.version, pages],
  );

  // Only reasons still offered — the same list the public form itself would
  // show, so a retired reason is never a selectable option here either. See
  // `carriedKeyFieldValue` for why the source's own reason is only pre-filled
  // when it is in this list.
  const activeReasons = useMemo(() => reasons.filter((reason) => reason.isActive), [reasons]);
  const sources: OptionSources = useMemo(
    () => ({
      referralReasons: activeReasons.map((reason) => ({ value: reason.id, label: reason.label })),
    }),
    [activeReasons],
  );
  const lookups: QuestionLookups = useMemo(
    () => ({ sessions: [], referralReasons: activeReasons, organisations: [] }),
    [activeReasons],
  );

  const [answers, setAnswers] = useState<FormAnswers>(() =>
    buildReReferInitialAnswers(source, reReferDefinition, sources),
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [sessionId, setSessionId] = useState('');
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [misconfigured, setMisconfigured] = useState<readonly string[]>([]);
  const submitting = useRef(false);

  const sessionFieldId = useId();
  const sessionErrorId = useId();

  const page = pages[pageIndex];
  const isLastPage = pageIndex === pages.length - 1;
  const target: TargetSessionOccupancy | undefined = sessions.find(
    (session) => session.id === sessionId,
  );
  const sessionWarning = target === undefined ? null : copyCapacityWarning(target);

  if (page === undefined) return null;

  const change = (key: string, value: AnswerValue) => {
    setAnswers((current) => clearDisabledAnswers(reReferDefinition, { ...current, [key]: value }));
    setErrors((current) => {
      if (current[key] === undefined) return current;
      const { [key]: _cleared, ...rest } = current;
      return rest;
    });
  };

  const validatePage = (): boolean => {
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
  };

  const goBack = () => {
    setErrors({});
    setPageIndex((index) => Math.max(0, index - 1));
  };

  const submit = async () => {
    if (!validatePage()) return;
    if (sessionId === '') {
      setSessionError('Choose a session for this referral.');
      return;
    }
    setSessionError(null);

    const { keyFields, answers: dynamic } = splitSubmission(reReferDefinition, answers);
    const built = buildReReferBody(keyFields, dynamic, sessionId, sessionWarning !== null);
    if (!built.ok) {
      setMisconfigured(built.missing);
      return;
    }

    if (submitting.current) return;
    submitting.current = true;

    try {
      const created = await reRefer.mutateAsync({ id: source.id, body: built.body });
      void navigate(`/referrals/${created.id}`, { replace: true, state: { fromCopy: true } });
    } catch (error) {
      // Only a `4xx` proves nothing was written — the same reasoning
      // `ReferralActionsPanel`'s own copy guard uses. A network failure or a
      // `5xx` may well have landed, so the lock stays on rather than risking
      // a second referral for a click that already worked.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        submitting.current = false;
      }
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Review this referral" />
      </div>

      <div className={styles.notice} role="note">
        <p>
          This household&rsquo;s referral was made on an earlier version of this form. Review each
          page, answer anything new, and check the details below are still correct before choosing a
          session and submitting. Nothing is created until you submit; closing this tab leaves the
          original referral exactly as it was.
        </p>
      </div>

      <dl className={styles.referrer}>
        <dt>Referred by</dt>
        <dd>
          {source.referrerName ?? '—'}
          {source.referrerOrganisation !== '' && `, ${source.referrerOrganisation}`}
        </dd>
        {source.referrerEmail !== null && (
          <>
            <dt>Referrer email</dt>
            <dd>{source.referrerEmail}</dd>
          </>
        )}
        {source.referrerPhone !== null && (
          <>
            <dt>Referrer phone</dt>
            <dd>{source.referrerPhone}</dd>
          </>
        )}
      </dl>

      <p className={styles.progress}>
        {describePageProgress(reReferDefinition, pageIndex)}
        {refereeName(source) !== null && ` — ${refereeName(source) ?? ''}`}
      </p>

      <h2>{page.pageTitle}</h2>

      {misconfigured.length > 0 && (
        <p className={styles.finalNotice} role="alert">
          This form is missing {misconfigured.join(', ')}, which the food bank&rsquo;s system needs.
          That is a fault at our end.
        </p>
      )}

      {reRefer.error !== null && <ErrorNotice error={reRefer.error} />}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (isLastPage) void submit();
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
            variables={{}}
          />
        ))}

        {isLastPage && (
          <div className={styles.field}>
            <label htmlFor={sessionFieldId}>Choose session</label>
            <select
              aria-describedby={sessionError === null ? undefined : sessionErrorId}
              className={styles.select}
              id={sessionFieldId}
              onChange={(event) => {
                setSessionId(event.target.value);
                setSessionError(null);
              }}
              value={sessionId}
            >
              <option value="">Choose a session</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {describeSessionChoice(
                    `${formatSessionDate(session.sessionDate)}, ${session.startTime}`,
                    standingFromCapacity(session.deliveryCapacity),
                  )}{' '}
                  ({session.booked} of {session.capacity} booked)
                </option>
              ))}
            </select>
            {sessionError !== null && (
              <p className={styles.fieldError} id={sessionErrorId} role="alert">
                {sessionError}
              </p>
            )}
            {sessionWarning !== null && (
              <p className={styles.warning} role="status">
                {sessionWarning}
              </p>
            )}
          </div>
        )}

        <div className={styles.actions}>
          {pageIndex > 0 && (
            <button className="button-secondary" onClick={goBack} type="button">
              Back
            </button>
          )}
          <button aria-disabled={reRefer.isPending} className={styles.submit} type="submit">
            {isLastPage ? (reRefer.isPending ? 'Submitting…' : 'Submit this referral') : 'Next'}
          </button>
        </div>
      </form>
    </div>
  );
}
