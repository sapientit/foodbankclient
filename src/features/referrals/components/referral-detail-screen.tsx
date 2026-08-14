import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ErrorNotice } from '../../../components/error-notice';
import { HouseholdCompositionGrid } from '../../../components/household-composition-grid';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import {
  formatCalendarDate,
  formatLondonDateTime,
  formatSessionDate,
} from '../../../lib/london-time';
import { useReferralReasons, type AdminReferralReason } from '../../admin-setup/queries';
import { useSessions, type Session } from '../../sessions/queries';
import { describeAnswers, type AnswersDisplay } from '../referral-answers.logic';
import { referralFormDefinition } from '../referral-form-config';
import {
  dynamicQuestions,
  isAnswerableQuestion,
  isDynamicQuestion,
  type DynamicQuestion,
  type FormPage,
  type KeyFieldName,
  type KeyFieldQuestion,
} from '../referral-form-definition';
import { buildPageSchema } from '../referral-form-schema';
import { HOUSEHOLD_COMPONENTS_KEY, isHouseholdComposition } from '../household-composition';
import {
  clearDisabledAnswers,
  isEnabled,
  type AnswerValue,
  type FormAnswers,
} from '../referral-form.logic';
import { COLLECTION_METHOD_KEY, splitSubmission } from '../referral-submission.logic';
import {
  useAmendReferral,
  useCancelReferral,
  useMarkReferralReviewed,
  useReferral,
  useReviewReferral,
  useRepeatReferrals,
  type AmendReferralInput,
  type Referral,
  type RepeatReferralMatch,
  type ReviewDecision,
} from '../queries';
import {
  MAX_CANCEL_REASON_LENGTH,
  MAX_REVIEW_COMMENT_LENGTH,
  REFERRAL_STATUS_LABELS,
  describeLockedReferral,
  hasAdminFields,
  hasRepeatReferralSummary,
  isAwaitingReview,
  isPurged,
  moveCapacityWarning,
  refereeName,
} from '../referrals.logic';
import { keyFieldValue } from '../referral-key-fields';
import { ReferralQuestionField, type QuestionLookups } from './referral-question-field';
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
  // Household composition has its own compact grid in the referral details.
  // Keeping it out of the generic list prevents the stored JSON appearing a
  // second time under the form's historical label, "Generated".
  const { [HOUSEHOLD_COMPONENTS_KEY]: _householdComposition, ...otherAnswers } = referral.answers;
  const answers = describeAnswers(referralFormDefinition, { ...referral, answers: otherAnswers });

  const title = refereeName(referral) ?? 'Referral';

  return (
    <>
      <PageHeader title={title} />

      {isAdminView && !purged && (
        <AdminInfoPanel locked={locked} lockedId={lockedId} referral={referral} />
      )}

      {isAdminView && referral.status === 'active' && (
        <MarkReviewedButton referralId={referral.id} />
      )}

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

      {hasRepeatReferralSummary(referral) && <PreviousReferralsPanel referral={referral} />}

      {/* A decision about whether the household is coming belongs near the
          matching-referral context, before the editable household details. */}
      {!purged && (
        <section className={styles.section}>
          <h2>Referral actions</h2>
          {isAdminView && isAwaitingReview(referral) && <ReviewPanel referral={referral} />}
          <CancelPanel locked={locked} lockedId={lockedId} referral={referral} />
        </section>
      )}

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

      {/* Every answer, not only the preferences — this is the referral, and an
          administrator taking a correction by phone needs all of it. The
          preferences-only view is the pick-list screen's job. */}
      <section className={styles.section}>
        <h2>Answers from the referral form</h2>
        <AnswersList display={answers} />
      </section>

      {isAdminView && referral.status === 'active' && (
        <MarkReviewedButton referralId={referral.id} />
      )}
    </>
  );
}

/** The office's household note is deliberately separate from form answers. */
function AdminInfoPanel({
  referral,
  locked,
  lockedId,
}: {
  referral: Referral;
  locked: string | null;
  lockedId: string;
}) {
  const amend = useAmendReferral();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputId = useId();

  const open = () => {
    setValue(referral.adminInfo ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (locked !== null) return;
    try {
      await amend.mutateAsync({
        id: referral.id,
        patch: { adminInfo: value.trim() === '' ? null : value.trim() },
      });
      setEditing(false);
    } catch {
      // The error remains in the dialog, where the administrator can act on it.
    }
  };

  return (
    <section className={styles.adminInfo}>
      <h2>Administrator information</h2>
      <p>{referral.adminInfo ?? 'No administrator information.'}</p>
      <button
        aria-describedby={locked === null ? undefined : lockedId}
        aria-disabled={locked !== null}
        className={styles.editButton}
        onClick={() => {
          if (locked === null) open();
        }}
        type="button"
      >
        Edit administrator information
      </button>
      {editing && (
        <ConfirmDialog
          busy={amend.isPending}
          confirmLabel="Save administrator information"
          onCancel={() => {
            setEditing(false);
          }}
          onConfirm={() => void save()}
          title="Edit administrator information"
        >
          {amend.error !== null && <ErrorNotice error={amend.error} />}
          <label htmlFor={inputId}>Administrator information</label>
          <textarea
            className={styles.textarea}
            id={inputId}
            maxLength={2000}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            rows={6}
            value={value}
          />
          <p className={styles.hint}>Leave blank to remove this information.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function MarkReviewedButton({ referralId }: { referralId: string }) {
  const review = useMarkReferralReviewed();

  return (
    <div className={styles.reviewAction}>
      {review.error !== null && <ErrorNotice error={review.error} />}
      <button
        aria-disabled={review.isPending}
        className={styles.submit}
        onClick={() => {
          review.mutate(referralId);
        }}
        type="button"
      >
        {review.isPending ? 'Marking reviewed…' : 'Mark reviewed'}
      </button>
    </div>
  );
}

const REPEAT_REFERRAL_OUTCOME_LABELS: Record<RepeatReferralMatch['outcome'], string> = {
  attended: 'Attended',
  no_show: 'Did not attend',
  booked: 'Booked',
};

const REPEAT_REFERRAL_MATCH_LABELS: Record<RepeatReferralMatch['matchedOn'][number], string> = {
  date_of_birth: 'Date of birth',
  postcode: 'Postcode',
  phone: 'Phone number',
};

/**
 * The summary comes with the referral, but match details wait for this action:
 * they are another household's personal data and must not cross the wire until
 * an administrator asks for them. The results inform a decision; they never
 * disable any of the review actions above.
 */
function PreviousReferralsPanel({ referral }: { referral: Referral }) {
  const [showMatches, setShowMatches] = useState(false);
  const [excludePostcode, setExcludePostcode] = useState(false);
  const repeatReferrals = useRepeatReferrals(referral.id, excludePostcode, showMatches);
  const summary = referral.repeatReferrals;

  if (summary === undefined) return null;

  // Until the filtered request has returned, keep the original summary on
  // screen rather than pretending that an in-flight request found no matches.
  const displayedSummary = repeatReferrals.data ?? summary;

  return (
    <section className={styles.section}>
      <h2>Previous referrals</h2>
      {displayedSummary.count === 0 ? (
        <p>No previous referrals were found in the last twelve months.</p>
      ) : (
        <>
          <p>
            {`${String(displayedSummary.count)} previous possible ${displayedSummary.count === 1 ? 'referral' : 'referrals'} in the last twelve months.`}
            {displayedSummary.mostRecentSessionDate !== null && (
              <>
                {' '}
                Most recent session: {formatSessionDate(displayedSummary.mostRecentSessionDate)}.
              </>
            )}
          </p>
          {!showMatches && (
            <button
              className={styles.submit}
              onClick={() => {
                setShowMatches(true);
              }}
              type="button"
            >
              Show previous referrals
            </button>
          )}
        </>
      )}

      <label>
        <input
          checked={excludePostcode}
          onChange={(event) => {
            setExcludePostcode(event.target.checked);
            setShowMatches(true);
          }}
          type="checkbox"
        />{' '}
        Exclude postcode matches
      </label>

      {showMatches && repeatReferrals.isPending && <Spinner label="Loading previous referrals…" />}

      {showMatches && repeatReferrals.isError && (
        <ErrorNotice
          error={repeatReferrals.error}
          onRetry={() => {
            void repeatReferrals.refetch();
          }}
        />
      )}

      {showMatches && repeatReferrals.isSuccess && (
        <PreviousReferralsTable matches={repeatReferrals.data.matches} />
      )}
    </section>
  );
}

function PreviousReferralsTable({ matches }: { matches: readonly RepeatReferralMatch[] }) {
  if (matches.length === 0) return <p>No matching previous referrals were found.</p>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.previousReferralsTable}>
        <thead>
          <tr>
            <th scope="col">Household</th>
            <th scope="col">Date of birth</th>
            <th scope="col">Address</th>
            <th scope="col">Postcode</th>
            <th scope="col">Phone</th>
            <th scope="col">Session</th>
            <th scope="col">Outcome</th>
            <th scope="col">Matched on</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr key={match.referralId}>
              <td>{refereeName(match) ?? '—'}</td>
              <td>
                {match.refereeDateOfBirth === null
                  ? '—'
                  : formatCalendarDate(match.refereeDateOfBirth)}
              </td>
              <td>{match.refereeAddress ?? '—'}</td>
              <td>{match.refereePostcode ?? '—'}</td>
              <td>{match.refereePhone ?? '—'}</td>
              <td>{formatSessionDate(match.sessionDate)}</td>
              <td>{REPEAT_REFERRAL_OUTCOME_LABELS[match.outcome]}</td>
              <td>
                {match.matchedOn.map((field) => REPEAT_REFERRAL_MATCH_LABELS[field]).join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <div className={styles.actionPanel}>
      <h3>This referral is awaiting review</h3>
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
          Approve this referral
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
          confirmLabel={confirming === 'accept' ? 'Approve referral' : 'Reject referral'}
          onCancel={() => {
            setConfirming(null);
          }}
          onConfirm={() => void decide(confirming)}
          title={confirming === 'accept' ? 'Approve this referral?' : 'Reject this referral?'}
        >
          <p>
            {confirming === 'accept'
              ? 'This household will be booked in for the session and will appear on its pick list.'
              : 'This household will not be booked in, and the place it was holding on the session is given back.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
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

function storedEditorAnswer(question: DynamicQuestion, value: unknown): AnswerValue {
  switch (question.type) {
    case 'choice':
      if (typeof value === 'string') return [value];
      return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
    case 'number':
      return typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
    case 'text':
      return typeof value === 'string' ? value : '';
    case 'householdComposition':
      return isHouseholdComposition(value) ? value : '';
  }
}

function keyFieldAnswer(referral: Referral, field: KeyFieldName): string {
  switch (field) {
    case 'referrerName':
      return referral.referrerName ?? '';
    case 'referrerEmail':
      return referral.referrerEmail ?? '';
    case 'referrerOrganisation':
      return referral.referrerOrganisation;
    case 'referrerPhone':
      return referral.referrerPhone ?? '';
    case 'refereeFirstName':
      return referral.refereeFirstName ?? '';
    case 'refereeSurname':
      return referral.refereeSurname ?? '';
    case 'refereeDateOfBirth':
      return referral.refereeDateOfBirth ?? '';
    case 'refereeAddress':
      return referral.refereeAddress ?? '';
    case 'refereePostcode':
      return referral.refereePostcode ?? '';
    case 'refereePhone':
      return referral.refereePhone ?? '';
    case 'sessionId':
      return referral.sessionId;
    case 'adults':
      return String(referral.adults);
    case 'children':
      return String(referral.children);
    case 'isDelivery':
      return referral.isDelivery ? 'Yes' : '';
    case 'needsFuelHelp':
      return referral.needsFuelHelp ? 'Yes' : '';
    case 'reasonId':
      return referral.reasonId ?? '';
  }
}

function editableKeyField(field: KeyFieldName): boolean {
  return ![
    'referrerName',
    'referrerEmail',
    'referrerOrganisation',
    'referrerPhone',
    'sessionId',
  ].includes(field);
}

function addKeyFieldPatch(
  patch: AmendReferralInput,
  question: KeyFieldQuestion,
  value: string,
): void {
  const parsed = keyFieldValue(question.field, value);
  switch (question.field) {
    case 'refereeFirstName':
      if (typeof parsed === 'string') patch.refereeFirstName = parsed;
      break;
    case 'refereeSurname':
      if (typeof parsed === 'string') patch.refereeSurname = parsed;
      break;
    case 'refereeDateOfBirth':
      if (typeof parsed === 'string') patch.refereeDateOfBirth = parsed;
      break;
    case 'refereeAddress':
      if (typeof parsed === 'string') patch.refereeAddress = parsed;
      break;
    case 'refereePostcode':
      if (typeof parsed === 'string') patch.refereePostcode = parsed;
      break;
    case 'refereePhone':
      if (typeof parsed === 'string' || parsed === null) patch.refereePhone = parsed;
      break;
    case 'adults':
      if (typeof parsed === 'number') patch.adults = parsed;
      break;
    case 'children':
      if (typeof parsed === 'number') patch.children = parsed;
      break;
    case 'isDelivery':
      if (typeof parsed === 'boolean') patch.isDelivery = parsed;
      break;
    case 'needsFuelHelp':
      if (typeof parsed === 'boolean') patch.needsFuelHelp = parsed;
      break;
    case 'reasonId':
      if (typeof parsed === 'string') patch.reasonId = parsed;
      break;
    case 'referrerName':
    case 'referrerEmail':
    case 'referrerOrganisation':
    case 'referrerPhone':
    case 'sessionId':
      break;
  }
}

function AnswerPageEditor({
  page,
  referral,
  reasons,
  onCancel,
}: {
  page: FormPage;
  referral: Referral;
  reasons: readonly AdminReferralReason[];
  onCancel: () => void;
}) {
  const amend = useAmendReferral();
  const [answers, setAnswers] = useState<FormAnswers>(() => ({
    ...Object.fromEntries(
      dynamicQuestions(referralFormDefinition).map((question) => [
        question.key,
        storedEditorAnswer(question, referral.answers[question.key]),
      ]),
    ),
    ...Object.fromEntries(
      page.questions
        .filter((question): question is KeyFieldQuestion => question.type === 'keyField')
        .map((question) => [question.key, keyFieldAnswer(referral, question.field)]),
    ),
  }));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const questions = page.questions.filter(isAnswerableQuestion);
  const dynamic = questions.filter(isDynamicQuestion);
  const lookups: QuestionLookups = { sessions: [], referralReasons: reasons, organisations: [] };

  const save = async () => {
    const shown = questions.filter((question) => isEnabled(question, answers));
    // A stored referral can predate a newly required question. Keep skipped
    // questions skipped; only validate values already held or changed here.
    const toValidate = shown.filter((question) => {
      const value = answers[question.key];
      return (
        touched.has(question.key) ||
        (typeof value === 'string' && value !== '') ||
        (Array.isArray(value) && value.length > 0) ||
        isHouseholdComposition(value)
      );
    });
    const validation = buildPageSchema({ ...page, questions: toValidate }).safeParse(
      Object.fromEntries(toValidate.map((question) => [question.key, answers[question.key] ?? ''])),
    );
    if (!validation.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && nextErrors[key] === undefined)
          nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    let next: Record<string, unknown> = { ...referral.answers };
    const submitted = splitSubmission(referralFormDefinition, answers);
    for (const question of dynamic) {
      // Unchanged answers keep their exact stored form. In particular, a
      // single-choice answer is stored as a string but represented as a
      // one-item array by the edit control. Disabled answers must still be
      // removed when a changed controlling answer hides them.
      if (!touched.has(question.key) && isEnabled(question, answers)) continue;
      const value = submitted.answers[question.key];
      if (value === undefined) {
        const { [question.key]: _removed, ...remaining } = next;
        next = remaining;
      } else {
        next[question.key] = value;
      }
    }
    const patch: AmendReferralInput = { answers: next };
    // These operational columns are derived from dynamic questions. They need
    // the same update when their source is changed in an amendment as when it
    // is first submitted.
    if (touched.has(HOUSEHOLD_COMPONENTS_KEY)) {
      if (typeof submitted.keyFields.adults === 'number') patch.adults = submitted.keyFields.adults;
      if (typeof submitted.keyFields.children === 'number')
        patch.children = submitted.keyFields.children;
    }
    if (touched.has(COLLECTION_METHOD_KEY) && typeof submitted.keyFields.isDelivery === 'boolean') {
      patch.isDelivery = submitted.keyFields.isDelivery;
    }
    for (const question of shown) {
      if (question.type === 'keyField' && editableKeyField(question.field)) {
        const value = answers[question.key];
        if (typeof value === 'string') addKeyFieldPatch(patch, question, value);
      }
    }
    try {
      await amend.mutateAsync({ id: referral.id, patch });
      onCancel();
    } catch {
      // Keep the page open with its values and show the server error below.
    }
  };

  return (
    <section className={styles.section}>
      <h2>Edit {page.pageTitle}</h2>
      {amend.error !== null && <ErrorNotice error={amend.error} />}
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {questions.map((question) => (
          <ReferralQuestionField
            enabled={
              isEnabled(question, answers) &&
              (question.type !== 'keyField' || editableKeyField(question.field))
            }
            error={errors[question.key]}
            key={question.key}
            lookups={lookups}
            onChange={(value) => {
              setTouched((current) => new Set(current).add(question.key));
              setAnswers((current) =>
                clearDisabledAnswers(referralFormDefinition, { ...current, [question.key]: value }),
              );
              setErrors((current) => {
                const { [question.key]: _cleared, ...rest } = current;
                return rest;
              });
            }}
            question={question}
            value={answers[question.key] ?? ''}
          />
        ))}
        <div className={styles.formActions}>
          <button aria-disabled={amend.isPending} className={styles.submit} type="submit">
            {amend.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

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
  const [editing, setEditing] = useState<number | null>(null);
  const [showEditMenu, setShowEditMenu] = useState(false);

  if (editing !== null) {
    const page = referralFormDefinition.pages[editing];
    if (page === undefined) return null;
    return (
      <AnswerPageEditor
        onCancel={() => {
          setEditing(null);
        }}
        page={page}
        reasons={reasons}
        referral={referral}
      />
    );
  }

  const reason = reasons.find((candidate) => candidate.id === referral.reasonId);
  const householdComposition = referral.answers[HOUSEHOLD_COMPONENTS_KEY];
  return (
    <section className={styles.section}>
      <h2>Referral details</h2>
      <dl className={styles.static}>
        <dt>Name</dt>
        <dd>{refereeName(referral) ?? '—'}</dd>
        <dt>Date of birth</dt>
        <dd>
          {referral.refereeDateOfBirth === null
            ? '—'
            : formatCalendarDate(referral.refereeDateOfBirth)}
        </dd>
        <dt>Address</dt>
        <dd>{referral.refereeAddress ?? '—'}</dd>
        <dt>Postcode</dt>
        <dd>{referral.refereePostcode ?? '—'}</dd>
        <dt>Phone</dt>
        <dd>{referral.refereePhone ?? '—'}</dd>
        <dt>Adults</dt>
        <dd>{referral.adults}</dd>
        <dt>Children</dt>
        <dd>{referral.children}</dd>
        <dt>Delivery</dt>
        <dd>{referral.isDelivery ? 'Yes' : 'No'}</dd>
        <dt>Fuel help</dt>
        <dd>{referral.needsFuelHelp ? 'Yes' : 'No'}</dd>
        {isAdminView && (
          <>
            <dt>Reason for referral</dt>
            <dd>{reason?.label ?? '—'}</dd>
            <dt>Referrer phone</dt>
            <dd>{referral.referrerPhone ?? '—'}</dd>
          </>
        )}
      </dl>
      {isAdminView && isHouseholdComposition(householdComposition) && (
        <section aria-label="Household composition" className={styles.householdComposition}>
          <HouseholdCompositionGrid composition={householdComposition} />
        </section>
      )}
      {isAdminView && (
        <button
          aria-describedby={locked === null ? undefined : lockedId}
          aria-disabled={locked !== null}
          className={styles.submit}
          onClick={() => {
            if (locked === null) setShowEditMenu(true);
          }}
          type="button"
        >
          Edit
        </button>
      )}
      {isAdminView && showEditMenu && (
        <div className={styles.editMenu}>
          {referralFormDefinition.pages.map((page, index) => (
            <button
              key={page.pageNum}
              onClick={() => {
                setEditing(index);
              }}
              type="button"
            >
              {page.pageTitle}
            </button>
          ))}
        </div>
      )}
    </section>
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
          <label htmlFor={selectId}>Choose session to move to</label>
          <select
            aria-describedby={formError === null ? undefined : formErrorId}
            className={styles.select}
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
    <div className={styles.actionPanel}>
      <h3>Cancel this referral</h3>

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
    </div>
  );
}
