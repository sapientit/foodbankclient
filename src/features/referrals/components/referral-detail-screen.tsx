import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ErrorNotice } from '../../../components/error-notice';
import { HouseholdCompositionGrid } from '../../../components/household-composition-grid';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError } from '../../../lib/errors';
import {
  formatCalendarDate,
  formatLondonDateTime,
  formatSessionDate,
} from '../../../lib/london-time';
import { describeSessionChoice } from '../../../lib/session-description';
import { useReferralReasons, type AdminReferralReason } from '../../admin-setup/queries';
import { useSessions, type Session } from '../../sessions/queries';
import { describeAnswers, type AnswersDisplay } from '../referral-answers.logic';
import { referralFormDefinition } from '../referral-form-config';
import {
  allQuestions,
  dynamicQuestions,
  isAnswerableQuestion,
  isDynamicQuestion,
  needsOptionSources,
  type DynamicQuestion,
  type FormPage,
  type KeyFieldName,
  type KeyFieldQuestion,
} from '../referral-form-definition';
import { reasonOptionSources } from '../referral-lookups';
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
  useCopyReferral,
  useMarkReferralReviewed,
  useReferral,
  useReviewReferral,
  useRepeatReferrals,
  type AmendReferralInput,
  type Referral,
  type RepeatReferralMatch,
  type ReviewDecision,
  useReferralOptionSources,
} from '../queries';
import {
  MAX_CANCEL_REASON_LENGTH,
  MAX_REVIEW_COMMENT_LENGTH,
  REFERRAL_OUTCOME_LABELS,
  REFERRAL_STATUS_LABELS,
  cameFromCopy,
  cameFromSearch,
  canCopyReferral,
  copyCapacityWarning,
  describeLockedReferral,
  describeSettledReferral,
  displayedOutcome,
  hasAdminFields,
  hasRepeatReferralSummary,
  isPurged,
  moveCapacityWarning,
  needsReferrerApproval,
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
  const outcome = displayedOutcome(referral);
  const locked = describeLockedReferral(referral);
  const lockedId = useId();

  const sessions = useSessions();
  // Never fetched for a team lead — see the module comment and
  // `useReferralReasons`'s own comment on why `enabled` exists at all.
  const reasons = useReferralReasons(isAdminView);
  /*
   * Reading the answers back needs the same lookup the form chose from, because
   * a question drawing on it stored the reason's id. An administrator already
   * has the admin list above, which names retired reasons too; a team lead is
   * refused that endpoint and reads the public list instead.
   */
  const answerLookupNeeded = needsOptionSources(allQuestions(referralFormDefinition)) && !purged;
  const publicReasons = useReferralOptionSources(answerLookupNeeded && !isAdminView);
  const answerSources = isAdminView
    ? reasonOptionSources(reasons.data ?? [])
    : publicReasons.sources;
  const answerLookupPending = isAdminView ? reasons.isPending : publicReasons.isPending;
  const answerLookupError = isAdminView ? reasons.error : publicReasons.error;

  const session = sessions.data?.find((candidate) => candidate.id === referral.sessionId);
  // Household composition has its own compact grid in the referral details.
  // Keeping it out of the generic list prevents the stored JSON appearing a
  // second time under the form's historical label, "Generated".
  const { [HOUSEHOLD_COMPONENTS_KEY]: _householdComposition, ...otherAnswers } = referral.answers;
  const answers = describeAnswers(
    referralFormDefinition,
    { ...referral, answers: otherAnswers },
    answerSources,
  );

  const title = refereeName(referral) ?? 'Referral';

  // `useLocation().state` is `any` from the router. Narrowing it to `unknown`
  // here is what keeps both readers below honest — neither may assume a shape.
  const locationState: unknown = useLocation().state;
  // Only when the search is where this referral was opened from. The results
  // themselves are still in the query cache, so the link returns to the same
  // list rather than an empty form — see `useReferralSearchMemory`.
  const fromSearch = cameFromSearch(locationState);
  const fromCopy = cameFromCopy(locationState);

  /**
   * A copy replaces this screen with a different household's record, in a
   * navigation the administrator did not choose from a link. The button that
   * opened the dialog has gone with it — a fresh copy is not itself copyable —
   * so the dialog's focus restore lands on a node that no longer exists and a
   * keyboard or screen-reader user is left on `<body>` with nothing said.
   * Focusing this notice puts them on the sentence that explains the swap.
   */
  const copiedNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (fromCopy) copiedNotice.current?.focus();
  }, [fromCopy]);

  return (
    <>
      <PageHeader
        action={fromSearch ? <Link to="/referrals/search">Back to search results</Link> : undefined}
        title={title}
      />

      {fromCopy && (
        <p className={styles.copiedNotice} ref={copiedNotice} role="status" tabIndex={-1}>
          This is a new referral, copied from the one you were reading. It holds a place on the
          session you chose, and the referral you copied is unchanged.
        </p>
      )}

      {isAdminView && !purged && (
        <AdminInfoPanel locked={locked} lockedId={lockedId} referral={referral} />
      )}

      <dl className={styles.static}>
        <dt>Status</dt>
        <dd>
          <span className={styles.status} data-status={referral.status}>
            {REFERRAL_STATUS_LABELS[referral.status]}
          </span>
        </dd>
        {/* What became of the *household*, which the status does not say: a
            referral can read Reviewed whether they collected their parcel or
            never turned up. Shown only where it adds something — a cancelled or
            rejected referral reads `outcome: "booked"`, correctly (nothing
            happened on the day), and "Still booked" beside "Cancelled" reads as
            a household who is coming after all. See `displayedOutcome`. */}
        {outcome !== null && (
          <>
            <dt>Outcome</dt>
            <dd>
              <span className={styles.outcome} data-outcome={outcome}>
                {REFERRAL_OUTCOME_LABELS[outcome]}
              </span>
            </dd>
          </>
        )}
        <dt>Referred</dt>
        <dd>{formatLondonDateTime(referral.referredAt)}</dd>
        <dt>Session</dt>
        <dd>
          {session === undefined ? (
            'Not in the current session list'
          ) : (
            <Link to={`/sessions/${referral.sessionId}`}>
              {describeSessionChoice(
                `${formatSessionDate(session.sessionDate)}, ${session.startTime}`,
                session,
              )}
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
      {/* Mark reviewed, cancel and move now sit together, so all three follow
          cancel's rule and none is offered on a purged referral — where moving
          and marking reviewed once were, having sections of their own. Booking a
          household whose details are gone into a future session would put a
          nameless parcel on a pick list, and there is nothing left to read
          through; but nobody has actually decided either, so both are recorded
          as guesses in `../foodbankserver/OPEN-QUESTIONS.md` Q35. */}
      {!purged && (
        <section className={styles.section}>
          <h2>Referral actions</h2>
          {isAdminView && needsReferrerApproval(referral) && <ReviewPanel referral={referral} />}
          <ReferralActionsPanel
            canCopy={isAdminView && canCopyReferral(referral)}
            canMarkReviewed={isAdminView && referral.status === 'active'}
            locked={locked}
            lockedId={lockedId}
            referral={referral}
            sessions={sessions.data ?? []}
          />
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

      {/* Every answer, not only the preferences — this is the referral, and an
          administrator taking a correction by phone needs all of it. The
          preferences-only view is the pick-list screen's job. */}
      <section className={styles.section}>
        <h2>Answers from the referral form</h2>
        {/* Held until the lookup lands: an answer chosen from it is an id until
            then, and an id is not something anybody may be shown. Only where
            there are answers to resolve — a purged referral says so at once. */}
        {answers.kind !== 'answers' ? (
          <AnswersList display={answers} />
        ) : answerLookupPending ? (
          <Spinner label="Loading reasons for referral…" />
        ) : answerLookupError !== null ? (
          <ErrorNotice
            error={answerLookupError}
            onRetry={() => {
              void (isAdminView ? reasons.refetch() : publicReasons.refetch());
            }}
          />
        ) : (
          <AnswersList display={answers} />
        )}
      </section>
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
      <h2>Administrator notes</h2>
      <p>{referral.adminInfo ?? 'No administrator notes.'}</p>
      <button
        aria-describedby={locked === null ? undefined : lockedId}
        aria-disabled={locked !== null}
        className={styles.editButton}
        onClick={() => {
          if (locked === null) open();
        }}
        type="button"
      >
        Edit administrator notes
      </button>
      {editing && (
        <ConfirmDialog
          busy={amend.isPending}
          confirmLabel="Save administrator notes"
          onCancel={() => {
            setEditing(false);
          }}
          onConfirm={() => void save()}
          title="Edit administrator notes"
        >
          {amend.error !== null && <ErrorNotice error={amend.error} />}
          <label htmlFor={inputId}>Administrator notes</label>
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
          <p className={styles.hint}>Leave blank to remove these notes.</p>
        </ConfirmDialog>
      )}
    </section>
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
      // Approving sends no comment at all, whatever a reject dialog opened and
      // abandoned earlier left in the box.
      await review.mutateAsync({
        id: referral.id,
        decision,
        comment: decision === 'reject' ? comment : '',
      });
    } catch {
      // Rendered by `ErrorNotice` below — a 409 here means another
      // administrator reviewed it first, and its message says so.
    }
  };

  return (
    <div className={styles.actionPanel}>
      {/* Names the referrer, not "review": this panel is the decision about
          whether the sender is one the charity accepts, and the separate
          read-through pass is what "Reviewed" records. */}
      <h3>This referral is waiting for the referrer to be approved</h3>
      <p>
        We do not recognise{' '}
        {referral.referrerEmail === null ? 'the referrer’s email address' : referral.referrerEmail},
        so nobody has decided yet whether to accept it. Accepting keeps the place this referral is
        already holding on the session; rejecting gives that place back.
      </p>

      {review.error !== null && <ErrorNotice error={review.error} />}

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
          {/* Only a rejection is explained. Approving an unrecognised referrer
              is the ordinary outcome and needs no reason; a rejection is the
              one somebody asks about six months later, and there is no review
              history to look it up in. */}
          {confirming === 'reject' && (
            <div className={styles.field}>
              <label htmlFor={commentId}>Reason for rejection (optional)</label>
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
          )}
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
        {/* Labelled with their real bounds, because "Adults: 6" for a household
            of ten is only wrong to somebody who does not know these are the
            grid's axes.  An admin corrects them, so an admin has to know what
            they are counting.  A team lead reads the composition grid below
            instead — the same household, without a definition to learn. */}
        {isAdminView && (
          <>
            <dt>Adults (&gt;11)</dt>
            <dd>{referral.adults}</dd>
            <dt>Children (5-11)</dt>
            <dd>{referral.children}</dd>
          </>
        )}
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
      {/* Not gated on the role: the grid is how a team lead knows the shape of
          the household they are packing for, and they already read it on the
          pick-list screens.  It is what they get here in place of the two
          operational counts above. */}
      {isHouseholdComposition(householdComposition) && (
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
 * Cancel and move, side by side: they are the two answers to the same phone
 * call, the household cannot come to this session. Each opens its own dialog,
 * so a session list nobody needs most of the time stays off the screen and the
 * capacity warning sits next to the button that acts on it.
 *
 * `screenDetails.md`: moving a referral may exceed the target session's
 * capacity, "with a client generated warning" — so the move is **never refused**
 * on that account, only on the referral being locked (cancelled) or on no
 * session having been chosen. `acknowledgeOverCapacity` is set from the same
 * warning the operator just read, which is the server half of that same
 * acceptance (`openapi.yaml`).
 */
function ReferralActionsPanel({
  referral,
  sessions,
  locked,
  lockedId,
  canMarkReviewed,
  canCopy,
}: {
  referral: Referral;
  sessions: readonly Session[];
  locked: string | null;
  lockedId: string;
  canMarkReviewed: boolean;
  canCopy: boolean;
}) {
  const cancel = useCancelReferral();
  const move = useAmendReferral();
  const copy = useCopyReferral();
  const markReviewed = useMarkReferralReviewed();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'cancel' | 'move' | 'copy' | null>(null);
  const [reason, setReason] = useState('');
  const [targetSessionId, setTargetSessionId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [copyUncertain, setCopyUncertain] = useState(false);

  /**
   * Copying is not idempotent and the server deliberately does not refuse a
   * second one (`OPEN-QUESTIONS.md` Q36, answered: not to be restricted), so two
   * landed clicks are two referrals, two places held and two bags packed.
   *
   * **The disabling on `ConfirmDialog`'s confirm button cannot be relied on to
   * stop that.** It is a real DOM `disabled`, which its focus trap needs, and a
   * real `disabled` only takes effect on the next render — a genuine double tap
   * lands both clicks before React gets there. So the second click is refused
   * here instead, synchronously, where no render has to have happened.
   *
   * Released only on a `4xx`, where the server has said it wrote nothing. A
   * network failure or a `5xx` may well have written, and re-arming the button
   * after one is exactly how the duplicate gets made.
   */
  const copying = useRef(false);

  const reasonFieldId = useId();
  const selectId = useId();
  const copySelectId = useId();
  const formErrorId = useId();
  const settledId = useId();

  /**
   * Cancelling and moving have two separate refusals, and both have to be read
   * before either button is offered: a cancelled or rejected referral is locked
   * (`locked`), and so is one whose household already has an attendance
   * outcome (`settled`) — "the same stopping point as a move, settled by the
   * charity on 2026-08-15". Copying is governed by neither; it is what a
   * settled referral has instead.
   */
  const settled = describeSettledReferral(referral);
  const blocked = locked ?? settled;
  const blockedId = locked === null ? settledId : lockedId;

  const options = sessions.filter((session) => session.id !== referral.sessionId);
  const target = sessions.find((session) => session.id === targetSessionId);
  const warning = target === undefined ? null : moveCapacityWarning(target);
  const copyWarning = target === undefined ? null : copyCapacityWarning(target);

  const open = (which: 'cancel' | 'move') => {
    if (blocked !== null) return;
    setFormError(null);
    setDialog(which);
  };

  const confirmCancel = () => {
    cancel.mutate(
      { id: referral.id, reason },
      {
        onSuccess: () => {
          setDialog(null);
        },
      },
    );
  };

  const confirmCopy = () => {
    if (targetSessionId === '') {
      setFormError('Choose a session to copy this referral to.');
      return;
    }
    setFormError(null);

    if (copying.current) return;
    copying.current = true;

    copy.mutate(
      {
        id: referral.id,
        sessionId: targetSessionId,
        acknowledgeOverCapacity: copyWarning !== null,
      },
      {
        onSuccess: (created) => {
          setTargetSessionId('');
          setDialog(null);
          // The administrator is now working with the copy, not the referral
          // they copied — `screenDetails.md`, "#Copying a referral". Replacing
          // rather than pushing keeps Back going where it went before, and no
          // location state travels: the copy is a new referral, not one of the
          // search results this screen may have been opened from.
          // The administrator is now working with the copy. The flag is a bare
          // boolean and nothing else — history state is not a place a household
          // may go — and it is what tells the destination to say what just
          // happened rather than silently swapping one household for another.
          void navigate(`/referrals/${created.id}`, { replace: true, state: { fromCopy: true } });
        },
        onError: (error) => {
          // Only a `4xx` proves nothing was written. See the `copying` comment.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            copying.current = false;
            return;
          }
          // Otherwise the lock stays on, because the copy may well have landed.
          // Say so: a button that looks live and silently swallows the click is
          // indistinguishable from a broken one, and the administrator needs to
          // know that reloading is how they find out whether it worked.
          setCopyUncertain(true);
        },
      },
    );
  };

  const confirmMove = async () => {
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
      setDialog(null);
    } catch {
      // move.error renders in the dialog, where the administrator still is.
    }
  };

  return (
    <div className={styles.actionPanel}>
      {markReviewed.error !== null && <ErrorNotice error={markReviewed.error} />}

      <div className={styles.actions}>
        {/* Once, here, with the other two. Reading a referral through, deciding
            it cannot come, and moving it are the same job on the same screen —
            and this button used to be at both ends of the page, which read as
            two different actions. */}
        {canMarkReviewed && (
          <button
            aria-disabled={markReviewed.isPending}
            className={styles.submit}
            onClick={() => {
              markReviewed.mutate(referral.id);
            }}
            type="button"
          >
            {markReviewed.isPending ? 'Marking reviewed…' : 'Mark reviewed'}
          </button>
        )}
        <button
          aria-describedby={blocked === null ? undefined : blockedId}
          aria-disabled={blocked !== null}
          className={styles.danger}
          onClick={() => {
            open('cancel');
          }}
          type="button"
        >
          Cancel this referral
        </button>
        <button
          aria-describedby={blocked === null ? undefined : blockedId}
          aria-disabled={blocked !== null}
          onClick={() => {
            open('move');
          }}
          type="button"
        >
          Move to another session
        </button>
        {/* Deliberately gated on neither refusal, unlike the other two: copying
            is the one action a cancelled, rejected or no-show referral still
            has, and it is the whole point of the button. See
            `canCopyReferral`. */}
        {canCopy && (
          <button
            onClick={() => {
              setFormError(null);
              setDialog('copy');
            }}
            type="button"
          >
            Copy to another session
          </button>
        )}
      </div>

      {/* The parent already renders `locked`, so this is only the other
          refusal. It says why cancelling and moving are inert, and for a
          no-show it names copying as the answer instead. */}
      {locked === null && settled !== null && (
        <p className={styles.refusal} id={settledId}>
          {settled}
        </p>
      )}

      {dialog === 'cancel' && (
        <ConfirmDialog
          busy={cancel.isPending}
          confirmLabel="Cancel the referral"
          onCancel={() => {
            setDialog(null);
          }}
          onConfirm={confirmCancel}
          title="Cancel this referral?"
        >
          {cancel.error !== null && <ErrorNotice error={cancel.error} />}
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

      {dialog === 'copy' && (
        <ConfirmDialog
          /* `busy` also holds the button down once the outcome is unknown, so
             it is genuinely disabled rather than live-looking and inert. */
          busy={copy.isPending || copyUncertain}
          confirmLabel="Copy to this session"
          onCancel={() => {
            setDialog(null);
          }}
          onConfirm={confirmCopy}
          title="Copy this referral?"
        >
          {copy.error !== null && <ErrorNotice error={copy.error} />}
          {copyUncertain && (
            <p className={styles.warning} role="alert">
              This copy may or may not have been made. Close this and reload the referral before
              trying again — copying twice would book the household in twice.
            </p>
          )}
          <p>
            This referral stays exactly as it is. The copy holds a place on the session you choose,
            approved and read, with the household&rsquo;s details and answers as they are here. The
            administrator notes will say which referral it was copied from.
          </p>
          <div className={styles.field}>
            <label htmlFor={copySelectId}>Choose session to copy to</label>
            <select
              aria-describedby={formError === null ? undefined : formErrorId}
              className={styles.select}
              id={copySelectId}
              onChange={(event) => {
                setTargetSessionId(event.target.value);
                setFormError(null);
              }}
              value={targetSessionId}
            >
              <option value="">Choose a session</option>
              {/* Every session, unlike the move list below, which leaves out the
                  one the referral is already on. A household who cancelled and
                  rang back can be copied onto the very session they cancelled
                  from, and that is the ordinary case rather than an edge. */}
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {describeSessionChoice(
                    `${formatSessionDate(session.sessionDate)}, ${session.startTime}`,
                    session,
                  )}{' '}
                  ({session.booked} of {session.capacity} booked)
                </option>
              ))}
            </select>
          </div>

          {formError !== null && (
            <p className={styles.fieldError} id={formErrorId}>
              {formError}
            </p>
          )}

          {/* A warning, not a refusal — capacity works exactly as it does for a
              move, and the server accepts `acknowledgeOverCapacity` so it does
              not have to refuse. */}
          {copyWarning !== null && (
            <p className={styles.warning} role="status">
              {copyWarning}
            </p>
          )}
        </ConfirmDialog>
      )}

      {dialog === 'move' && (
        <ConfirmDialog
          busy={move.isPending}
          confirmLabel={move.isPending ? 'Moving…' : 'Move to this session'}
          onCancel={() => {
            setDialog(null);
          }}
          onConfirm={() => void confirmMove()}
          title="Move to another session?"
        >
          {move.error !== null && <ErrorNotice error={move.error} />}
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
                  {describeSessionChoice(
                    `${formatSessionDate(session.sessionDate)}, ${session.startTime}`,
                    session,
                  )}{' '}
                  ({session.booked} of {session.capacity} booked)
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
              `moveCapacityWarning`. The confirm button stays live regardless. */}
          {warning !== null && (
            <p className={styles.warning} role="status">
              {warning}
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
