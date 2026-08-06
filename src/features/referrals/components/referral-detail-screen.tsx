import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useMemo, useState } from 'react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import * as z from 'zod';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import {
  formatCalendarDate,
  formatLondonDateTime,
  formatSessionDate,
  isCalendarDate,
  londonToday,
} from '../../../lib/london-time';
import { useReferralReasons, type AdminReferralReason } from '../../admin-setup/queries';
import { useSessions, type Session } from '../../sessions/queries';
import { describeAnswers, type AnswersDisplay } from '../referral-answers.logic';
import { referralFormDefinition } from '../referral-form-config';
import {
  useAmendReferral,
  useCancelReferral,
  useReferral,
  useReviewReferral,
  type AmendReferralInput,
  type Referral,
  type ReviewDecision,
} from '../queries';
import {
  ADULTS_BOUNDS,
  CHILDREN_BOUNDS,
  MAX_CANCEL_REASON_LENGTH,
  MAX_REVIEW_COMMENT_LENGTH,
  MAX_REFEREE_ADDRESS_LENGTH,
  MAX_NAME_PART_LENGTH,
  REFEREE_POSTCODE_BOUNDS,
  REFERRAL_STATUS_LABELS,
  describeLockedReferral,
  hasAdminFields,
  isAwaitingReview,
  isPurged,
  moveCapacityWarning,
  parseWholeNumber,
  refereeName,
} from '../referrals.logic';
import styles from './referral-detail-screen.module.css';

/**
 * One referral: its fixed fields, its household preference answers, and —
 * amend, move and cancel. **Not role-gated in the component**, the same
 * convention every other amend screen in this app follows: the server's real
 * `403` on a genuine mutation attempt is the only check that means anything.
 *
 * **Reading, though, is not gated at all.** `GET /referrals/{id}` is not
 * admin-only (`API.md` §2: "Read sessions, stock, referrals, model parcels" is
 * both roles), so a team lead opening this screen gets a real `200` with three
 * fields missing — `reasonId`, `referrerEmail`, `referrerPhone` — rather than a
 * `403`. `hasAdminFields` is the one place that distinction is read, and every
 * admin-only piece of UI on this screen — the reason field, the referrer email
 * line, the referrer phone field — is gated on it rather than on a role read
 * from `useAuth`, so it stays correct even if the two ever disagreed.
 */
export function ReferralDetailScreen() {
  const { referralId = '' } = useParams();
  const referral = useReferral(referralId);

  if (referral.isPending) {
    return (
      <>
        <PageHeader title="Referral" />
        <Spinner label="Loading the referral…" />
      </>
    );
  }

  if (referral.isError) {
    return (
      <>
        <PageHeader title="Referral" />
        <ErrorNotice
          error={referral.error}
          onRetry={() => {
            void referral.refetch();
          }}
        />
      </>
    );
  }

  return <ReferralDetail referral={referral.data} />;
}

function ReferralDetail({ referral }: { referral: Referral }) {
  const isAdminView = hasAdminFields(referral);
  const purged = isPurged(referral);
  const locked = describeLockedReferral(referral);
  const lockedId = useId();

  const sessions = useSessions();
  // Never fetched for a team lead — see the module comment and
  // `useReferralReasons`'s own comment on why `enabled` exists at all.
  const reasons = useReferralReasons(isAdminView);

  const session = sessions.data?.find((candidate) => candidate.id === referral.sessionId);
  const answers = describeAnswers(referralFormDefinition, referral);

  const title = refereeName(referral) ?? 'Referral';

  return (
    <>
      <PageHeader title={title} />

      <dl className={styles.static}>
        <dt>Status</dt>
        <dd>
          <span className={styles.status} data-status={referral.status}>
            {REFERRAL_STATUS_LABELS[referral.status]}
          </span>
        </dd>
        <dt>Referred</dt>
        <dd>{formatLondonDateTime(referral.referredAt)}</dd>
        <dt>Session</dt>
        <dd>
          {session === undefined ? (
            'Not in the current session list'
          ) : (
            <Link to={`/sessions/${referral.sessionId}`}>
              {formatSessionDate(session.sessionDate)}, {session.startTime} — {session.location}
            </Link>
          )}
        </dd>
        <dt>Date of birth</dt>
        <dd>
          {referral.refereeDateOfBirth === null
            ? '—'
            : formatCalendarDate(referral.refereeDateOfBirth)}
        </dd>
        <dt>Referring organisation</dt>
        <dd>{referral.referrerOrganisation}</dd>
        <dt>Referrer</dt>
        <dd>{referral.referrerName ?? '—'}</dd>
        {/* Admin only, and not amendable here — the email is the referrer's
            identity, the same reasoning `API.md` gives for a user's login
            email never being amendable on the users screens. */}
        {isAdminView && (
          <>
            <dt>Referrer email</dt>
            <dd>{referral.referrerEmail ?? '—'}</dd>
          </>
        )}
        {/* Admin only, for the same reason as the email: it can name a referrer
            or record a suspicion. Shown whenever there is one — a rejected
            referral's reason is the thing somebody asks about six months
            later, and there is no review history to look it up in. */}
        {isAdminView && referral.reviewComment !== null && (
          <>
            <dt>Review comment</dt>
            <dd>{referral.reviewComment}</dd>
          </>
        )}
      </dl>

      {purged && (
        <p className={styles.purgedNotice}>
          This household&rsquo;s personal details were removed by the retention process
          {referral.piiPurgedAt !== null && ` on ${formatLondonDateTime(referral.piiPurgedAt)}`}.
          There is nothing here to amend.
        </p>
      )}

      {locked !== null && (
        <p className={styles.refusal} id={lockedId}>
          {locked}
        </p>
      )}

      {/* Above the amend form on purpose: whether this household is coming at
          all is the first question somebody opening a pending referral has. */}
      {isAdminView && isAwaitingReview(referral) && <ReviewPanel referral={referral} />}

      {/* Every answer, not only the preferences — this is the referral, and an
          administrator taking a correction by phone needs all of it. The
          preferences-only view is the pick-list screen's job. */}
      <h2>Answers from the referral form</h2>
      <AnswersList display={answers} />

      {!purged &&
        (isAdminView && reasons.isPending ? (
          <Spinner label="Loading reasons for referral…" />
        ) : isAdminView && reasons.isError ? (
          <ErrorNotice
            error={reasons.error}
            onRetry={() => {
              void reasons.refetch();
            }}
          />
        ) : (
          <DetailsForm
            isAdminView={isAdminView}
            locked={locked}
            lockedId={lockedId}
            reasons={isAdminView ? (reasons.data ?? []) : []}
            referral={referral}
          />
        ))}

      <MovePanel
        locked={locked}
        lockedId={lockedId}
        referral={referral}
        sessions={sessions.data ?? []}
      />

      <CancelPanel locked={locked} lockedId={lockedId} referral={referral} />
    </>
  );
}

/**
 * Accept or reject a referral whose referrer the charity did not recognise.
 *
 * **Rendered only for an admin, and only while the referral is
 * `pending_review`.** Both conditions are read off the object rather than a
 * role from `useAuth` — `hasAdminFields` for the first, `status` for the
 * second — so the panel cannot appear on a referral the server would refuse to
 * review.
 *
 * There is no "approve and authorise this referrer for the future" button:
 * `referral details.txt` asks for one, but what it should write to the
 * authorised list is genuinely underdetermined — one address or a whole
 * domain, and under which organisation name. That is **Q22**, and inventing an
 * answer could quietly authorise an entire council.
 */
function ReviewPanel({ referral }: { referral: Referral }) {
  const review = useReviewReferral();
  const [comment, setComment] = useState('');
  const [confirming, setConfirming] = useState<ReviewDecision | null>(null);
  const commentId = useId();

  const decide = async (decision: ReviewDecision) => {
    setConfirming(null);
    try {
      await review.mutateAsync({ id: referral.id, decision, comment });
    } catch {
      // Rendered by `ErrorNotice` below — a 409 here means another
      // administrator reviewed it first, and its message says so.
    }
  };

  return (
    <section className={styles.section}>
      <h2>This referral is awaiting review</h2>
      <p>
        We do not recognise{' '}
        {referral.referrerEmail === null ? 'the referrer’s email address' : referral.referrerEmail},
        so this referral is not booked in yet. Accepting it keeps the place it is already holding on
        the session; rejecting it gives that place back.
      </p>

      {review.error !== null && <ErrorNotice error={review.error} />}

      <div className={styles.field}>
        <label htmlFor={commentId}>Comment (optional)</label>
        <input
          className={styles.input}
          id={commentId}
          maxLength={MAX_REVIEW_COMMENT_LENGTH}
          onChange={(event) => {
            setComment(event.target.value);
          }}
          type="text"
          value={comment}
        />
        <p className={styles.hint}>
          One line, for whoever reads this later. Only administrators can see it.
        </p>
      </div>

      <div className={styles.actions}>
        <button
          aria-disabled={review.isPending}
          onClick={() => {
            setConfirming('accept');
          }}
          type="button"
        >
          Accept this referral
        </button>
        <button
          aria-disabled={review.isPending}
          className={styles.danger}
          onClick={() => {
            setConfirming('reject');
          }}
          type="button"
        >
          Reject this referral
        </button>
      </div>

      {confirming !== null && (
        <ConfirmDialog
          busy={review.isPending}
          confirmLabel={confirming === 'accept' ? 'Accept referral' : 'Reject referral'}
          onCancel={() => {
            setConfirming(null);
          }}
          onConfirm={() => void decide(confirming)}
          title={confirming === 'accept' ? 'Accept this referral?' : 'Reject this referral?'}
        >
          <p>
            {confirming === 'accept'
              ? 'This household will be booked in for the session and will appear on its pick list.'
              : 'This household will not be booked in, and the place it was holding on the session is given back.'}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function AnswersList({ display }: { display: AnswersDisplay }) {
  switch (display.kind) {
    case 'purged':
      return <p className={styles.answersNote}>These were removed by the retention process.</p>;
    case 'no-answers':
      return <p className={styles.answersNote}>No preference answers were given.</p>;
    case 'answers':
      return (
        <dl className={styles.answers}>
          {display.lines.map((line) => (
            <div className={styles.answerLine} key={line.key}>
              <dt>
                {line.label}
                {line.isUnknownKey && (
                  <span className={styles.unknownTag}> (no longer on the form)</span>
                )}
              </dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

const ADULTS_MESSAGES: Record<string, string> = {
  empty: 'Enter how many adults are in the household.',
  'not-a-whole-number': 'Use a whole number, for example 2.',
  'below-minimum': 'Every referral needs at least one adult.',
  'above-maximum': 'Use 30 or fewer.',
};

const CHILDREN_MESSAGES: Record<string, string> = {
  empty: 'Enter how many children are in the household — 0 if none.',
  'not-a-whole-number': 'Use a whole number, for example 0.',
  'below-minimum': 'Cannot be negative.',
  'above-maximum': 'Use 30 or fewer.',
};

/**
 * Built per render rather than at module scope, because whether `reasonId` is
 * required depends on `isAdminView` — a team lead's form never shows that
 * field, so nothing should block submission on it being empty. Both branches
 * produce the same shape (`z.string()` either way; `.min` only adds a check),
 * so `DetailsFormValues` is stable regardless of which branch ran.
 */
function buildDetailsFormSchema(isAdminView: boolean) {
  return z.object({
    refereeFirstName: z
      .string()
      .trim()
      .min(1, 'Enter the client’s first name.')
      .max(MAX_NAME_PART_LENGTH, `Use ${String(MAX_NAME_PART_LENGTH)} characters or fewer.`),
    refereeSurname: z
      .string()
      .trim()
      .min(1, 'Enter the client’s surname.')
      .max(MAX_NAME_PART_LENGTH, `Use ${String(MAX_NAME_PART_LENGTH)} characters or fewer.`),
    refereeDateOfBirth: z.string().superRefine((value, ctx) => {
      if (!isCalendarDate(value)) {
        ctx.addIssue({ code: 'custom', message: 'Enter a date of birth as day, month and year.' });
        return;
      }
      if (value > londonToday()) {
        ctx.addIssue({ code: 'custom', message: 'That date is in the future.' });
      }
    }),
    refereeAddress: z
      .string()
      .trim()
      .min(1, 'Enter an address.')
      .max(
        MAX_REFEREE_ADDRESS_LENGTH,
        `Use ${String(MAX_REFEREE_ADDRESS_LENGTH)} characters or fewer.`,
      ),
    refereePostcode: z
      .string()
      .trim()
      .min(REFEREE_POSTCODE_BOUNDS.minLength, 'Enter a postcode.')
      .max(
        REFEREE_POSTCODE_BOUNDS.maxLength,
        `Use ${String(REFEREE_POSTCODE_BOUNDS.maxLength)} characters or fewer.`,
      ),
    refereePhone: z.string(),
    referrerPhone: z.string(),
    adults: z.string().superRefine((value, ctx) => {
      const parsed = parseWholeNumber(value, ADULTS_BOUNDS);
      if (!parsed.ok) ctx.addIssue({ code: 'custom', message: ADULTS_MESSAGES[parsed.problem] });
    }),
    children: z.string().superRefine((value, ctx) => {
      const parsed = parseWholeNumber(value, CHILDREN_BOUNDS);
      if (!parsed.ok) ctx.addIssue({ code: 'custom', message: CHILDREN_MESSAGES[parsed.problem] });
    }),
    isDelivery: z.boolean(),
    needsFuelHelp: z.boolean(),
    reasonId: isAdminView ? z.string().min(1, 'Choose a reason.') : z.string(),
  });
}

type DetailsFormValues = z.infer<ReturnType<typeof buildDetailsFormSchema>>;

/**
 * Edits the fixed personal-detail fields. **There is no editor for the dynamic
 * `answers` here yet** — deliberate, not an oversight. A referrer can no longer
 * amend their own referral at all (`screenDetails.md`, "After a referral is
 * submitted"), so an administrator editing an answer on somebody's behalf is a
 * real requirement rather than a nicety, and it wants the same generic
 * question renderer the public form uses rather than a second hand-written one.
 * The answers are shown in full via `describeAnswers` — reading them is this
 * slice's job. See `STATUS.md`.
 */
function DetailsForm({
  referral,
  isAdminView,
  reasons,
  locked,
  lockedId,
}: {
  referral: Referral;
  isAdminView: boolean;
  reasons: readonly AdminReferralReason[];
  locked: string | null;
  lockedId: string;
}) {
  const amend = useAmendReferral();
  const schema = useMemo(() => buildDetailsFormSchema(isAdminView), [isAdminView]);

  const nameId = useId();
  const nameErrorId = useId();
  const surnameId = useId();
  const surnameErrorId = useId();
  const dobId = useId();
  const dobErrorId = useId();
  const fuelId = useId();
  const addressId = useId();
  const addressErrorId = useId();
  const postcodeId = useId();
  const postcodeErrorId = useId();
  const phoneId = useId();
  const referrerPhoneId = useId();
  const adultsId = useId();
  const adultsErrorId = useId();
  const childrenId = useId();
  const childrenErrorId = useId();
  const reasonSelectId = useId();
  const reasonErrorId = useId();

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<DetailsFormValues>({
    resolver: zodResolver(schema),
    // Not reset on failure, so whatever was typed survives a 400. The three
    // admin-only fields default from `?? ''` rather than a branch on
    // `isAdminView`: when they are genuinely absent (a team lead) the field is
    // never rendered anyway, so an unused default of `''` costs nothing and
    // sidesteps narrowing a value TypeScript has no way to know is safe here.
    defaultValues: {
      refereeFirstName: referral.refereeFirstName ?? '',
      refereeSurname: referral.refereeSurname ?? '',
      refereeDateOfBirth: referral.refereeDateOfBirth ?? '',
      refereeAddress: referral.refereeAddress ?? '',
      refereePostcode: referral.refereePostcode ?? '',
      refereePhone: referral.refereePhone ?? '',
      referrerPhone: referral.referrerPhone ?? '',
      adults: String(referral.adults),
      children: String(referral.children),
      isDelivery: referral.isDelivery,
      needsFuelHelp: referral.needsFuelHelp,
      reasonId: referral.reasonId ?? '',
    },
  });

  const submit = handleSubmit(async (values) => {
    if (locked !== null) return;

    const adults = parseWholeNumber(values.adults, ADULTS_BOUNDS);
    const children = parseWholeNumber(values.children, CHILDREN_BOUNDS);
    if (!adults.ok || !children.ok) return;

    const patch: AmendReferralInput = { answers: referral.answers };

    try {
      await amend.mutateAsync({ id: referral.id, patch });
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  return (
    <>
      <h2>Amend details</h2>

      {amend.error !== null && !isFieldFailure(amend.error) && <ErrorNotice error={amend.error} />}

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={nameId}>First name</label>
          <input
            {...register('refereeFirstName')}
            aria-describedby={errors.refereeFirstName === undefined ? undefined : nameErrorId}
            aria-invalid={errors.refereeFirstName === undefined ? undefined : true}
            className={styles.input}
            id={nameId}
            maxLength={MAX_NAME_PART_LENGTH}
            type="text"
          />
          {errors.refereeFirstName !== undefined && (
            <p className={styles.fieldError} id={nameErrorId}>
              {errors.refereeFirstName.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={surnameId}>Surname</label>
          <input
            {...register('refereeSurname')}
            aria-describedby={errors.refereeSurname === undefined ? undefined : surnameErrorId}
            aria-invalid={errors.refereeSurname === undefined ? undefined : true}
            className={styles.input}
            id={surnameId}
            maxLength={MAX_NAME_PART_LENGTH}
            type="text"
          />
          {errors.refereeSurname !== undefined && (
            <p className={styles.fieldError} id={surnameErrorId}>
              {errors.refereeSurname.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={dobId}>Date of birth</label>
          <input
            {...register('refereeDateOfBirth')}
            aria-describedby={errors.refereeDateOfBirth === undefined ? undefined : dobErrorId}
            aria-invalid={errors.refereeDateOfBirth === undefined ? undefined : true}
            className={styles.input}
            id={dobId}
            max={londonToday()}
            type="date"
          />
          {errors.refereeDateOfBirth !== undefined && (
            <p className={styles.fieldError} id={dobErrorId}>
              {errors.refereeDateOfBirth.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={addressId}>Address</label>
          <textarea
            {...register('refereeAddress')}
            aria-describedby={errors.refereeAddress === undefined ? undefined : addressErrorId}
            aria-invalid={errors.refereeAddress === undefined ? undefined : true}
            className={styles.textarea}
            id={addressId}
            maxLength={MAX_REFEREE_ADDRESS_LENGTH}
            rows={2}
          />
          {errors.refereeAddress !== undefined && (
            <p className={styles.fieldError} id={addressErrorId}>
              {errors.refereeAddress.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={postcodeId}>Postcode</label>
          <input
            {...register('refereePostcode')}
            aria-describedby={errors.refereePostcode === undefined ? undefined : postcodeErrorId}
            aria-invalid={errors.refereePostcode === undefined ? undefined : true}
            className={styles.input}
            id={postcodeId}
            maxLength={REFEREE_POSTCODE_BOUNDS.maxLength}
            type="text"
          />
          {errors.refereePostcode !== undefined && (
            <p className={styles.fieldError} id={postcodeErrorId}>
              {errors.refereePostcode.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={phoneId}>Referee phone (optional)</label>
          <input {...register('refereePhone')} className={styles.input} id={phoneId} type="tel" />
        </div>

        {/* Admin only — see the module comment. Absent entirely from a team
            lead's form, not merely disabled, because there is no value loaded
            to show. */}
        {isAdminView && (
          <div className={styles.field}>
            <label htmlFor={referrerPhoneId}>Referrer phone (optional)</label>
            <input
              {...register('referrerPhone')}
              className={styles.input}
              id={referrerPhoneId}
              type="tel"
            />
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor={adultsId}>Adults</label>
          <input
            {...register('adults')}
            aria-describedby={errors.adults === undefined ? undefined : adultsErrorId}
            aria-invalid={errors.adults === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={adultsId}
            inputMode="numeric"
            type="text"
          />
          {errors.adults !== undefined && (
            <p className={styles.fieldError} id={adultsErrorId}>
              {errors.adults.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={childrenId}>Children</label>
          <input
            {...register('children')}
            aria-describedby={errors.children === undefined ? undefined : childrenErrorId}
            aria-invalid={errors.children === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={childrenId}
            inputMode="numeric"
            type="text"
          />
          {errors.children !== undefined && (
            <p className={styles.fieldError} id={childrenErrorId}>
              {errors.children.message}
            </p>
          )}
        </div>

        <div className={styles.checkboxField}>
          <label>
            <input {...register('isDelivery')} type="checkbox" /> This is a delivery
          </label>
        </div>

        <div className={styles.checkboxField}>
          <label htmlFor={fuelId}>
            <input {...register('needsFuelHelp')} id={fuelId} type="checkbox" /> Needs help with gas
            or electricity
          </label>
        </div>

        {/* Admin only. The reason for referral is never shown to a team lead
            (`API.md` §2), so this field simply is not in their form. */}
        {isAdminView && (
          <div className={styles.field}>
            <label htmlFor={reasonSelectId}>Reason for referral</label>
            <select
              {...register('reasonId')}
              aria-describedby={errors.reasonId === undefined ? undefined : reasonErrorId}
              aria-invalid={errors.reasonId === undefined ? undefined : true}
              id={reasonSelectId}
            >
              <option value="">Choose a reason</option>
              {reasons.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.label}
                  {reason.isActive ? '' : ' (retired)'}
                </option>
              ))}
            </select>
            {errors.reasonId !== undefined && (
              <p className={styles.fieldError} id={reasonErrorId}>
                {errors.reasonId.message}
              </p>
            )}
          </div>
        )}

        <div className={styles.formActions}>
          <button
            aria-describedby={locked === null ? undefined : lockedId}
            aria-disabled={locked !== null}
            className={styles.submit}
            type="submit"
          >
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * `screenDetails.md`: moving a referral may exceed the target session's
 * capacity, "with a client generated warning" — so the control is **never
 * disabled** on that account, only on the referral being locked (cancelled)
 * or on nothing having been chosen yet. `acknowledgeOverCapacity` is set from
 * the same warning the operator just read, which is the server half of that
 * same acceptance (`openapi.yaml`).
 */
function MovePanel({
  referral,
  sessions,
  locked,
  lockedId,
}: {
  referral: Referral;
  sessions: readonly Session[];
  locked: string | null;
  lockedId: string;
}) {
  const move = useAmendReferral();
  const [targetSessionId, setTargetSessionId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const selectId = useId();
  const formErrorId = useId();

  const options = sessions.filter((session) => session.id !== referral.sessionId);
  const target = sessions.find((session) => session.id === targetSessionId);
  const warning = target === undefined ? null : moveCapacityWarning(target);

  const submit = async () => {
    if (locked !== null) return;

    if (targetSessionId === '') {
      setFormError('Choose a session to move this referral to.');
      return;
    }
    setFormError(null);

    try {
      await move.mutateAsync({
        id: referral.id,
        patch: { sessionId: targetSessionId, acknowledgeOverCapacity: warning !== null },
        // So the session being left also gets its cached `booked` count
        // invalidated — see the comment on `useAmendReferral`.
        previousSessionId: referral.sessionId,
      });
      setTargetSessionId('');
    } catch {
      // move.error renders below.
    }
  };

  return (
    <section className={styles.section}>
      <h2>Move to another session</h2>

      {move.error !== null && <ErrorNotice error={move.error} />}

      <form
        className={styles.moveForm}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className={styles.field}>
          <label htmlFor={selectId}>Session</label>
          <select
            aria-describedby={formError === null ? undefined : formErrorId}
            id={selectId}
            onChange={(event) => {
              setTargetSessionId(event.target.value);
              setFormError(null);
            }}
            value={targetSessionId}
          >
            <option value="">Choose a session</option>
            {options.map((session) => (
              <option key={session.id} value={session.id}>
                {formatSessionDate(session.sessionDate)}, {session.startTime} — {session.location} (
                {session.booked} of {session.capacity} booked)
              </option>
            ))}
          </select>
        </div>

        {formError !== null && (
          <p className={styles.fieldError} id={formErrorId}>
            {formError}
          </p>
        )}

        {/* A warning, not a refusal — see the function comment on
            `moveCapacityWarning`. The button below stays enabled regardless. */}
        {warning !== null && (
          <p className={styles.warning} role="status">
            {warning}
          </p>
        )}

        <button
          aria-describedby={locked === null ? undefined : lockedId}
          aria-disabled={locked !== null}
          type="submit"
        >
          {move.isPending ? 'Moving…' : 'Move to this session'}
        </button>
      </form>
    </section>
  );
}

function CancelPanel({
  referral,
  locked,
  lockedId,
}: {
  referral: Referral;
  locked: string | null;
  lockedId: string;
}) {
  const cancel = useCancelReferral();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const reasonFieldId = useId();

  const confirmCancel = () => {
    cancel.mutate(
      { id: referral.id, reason },
      {
        onSuccess: () => {
          setCancelling(false);
        },
      },
    );
  };

  return (
    <section className={styles.section}>
      <h2>Cancel this referral</h2>

      {cancel.error !== null && <ErrorNotice error={cancel.error} />}

      <button
        aria-describedby={locked === null ? undefined : lockedId}
        aria-disabled={locked !== null}
        className={styles.danger}
        onClick={() => {
          if (locked !== null) return;
          setCancelling(true);
        }}
        type="button"
      >
        Cancel this referral
      </button>

      {cancelling && (
        <ConfirmDialog
          busy={cancel.isPending}
          confirmLabel="Cancel the referral"
          onCancel={() => {
            setCancelling(false);
          }}
          onConfirm={confirmCancel}
          title="Cancel this referral?"
        >
          <p>This frees its place in the session. It cannot be undone from here.</p>
          <div className={styles.reasonField}>
            <label htmlFor={reasonFieldId}>Reason (optional)</label>
            <input
              className={styles.input}
              id={reasonFieldId}
              maxLength={MAX_CANCEL_REASON_LENGTH}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              type="text"
              value={reason}
            />
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<DetailsFormValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;

  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (
      path === 'refereeFirstName' ||
      path === 'refereeSurname' ||
      path === 'refereeDateOfBirth' ||
      path === 'needsFuelHelp' ||
      path === 'refereeAddress' ||
      path === 'refereePostcode' ||
      path === 'refereePhone' ||
      path === 'referrerPhone' ||
      path === 'adults' ||
      path === 'children' ||
      path === 'isDelivery' ||
      path === 'reasonId'
    ) {
      setError(path, { message });
    }
  }
}
