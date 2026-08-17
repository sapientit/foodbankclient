import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { HouseholdCompositionGrid } from '../../../components/household-composition-grid';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, describeApiError, pendingPickNumbers } from '../../../lib/errors';
import { formatSessionDate, formatTimeRange } from '../../../lib/london-time';
import { collectionOnlyLabel, describeSessionChoice } from '../../../lib/session-description';
import { useSession, useSessions, type Session } from '../../sessions/queries';
import { useStockItems, type StockItem } from '../../stock/queries';
import { useReferrals, useReferralOptionSources } from '../../referrals/queries';
import { describeAnswers } from '../../referrals/referral-answers.logic';
import { referralFormDefinition } from '../../referrals/referral-form-config';
import { dynamicQuestions, needsOptionSources } from '../../referrals/referral-form-definition';
import {
  HOUSEHOLD_COMPONENTS_KEY,
  isHouseholdComposition,
} from '../../referrals/household-composition';
import {
  useConfirmSession,
  useMarkPickListPrinted,
  usePrintPickList,
  useReconcilePickList,
  useRecordAttendance,
  useReviewParcel,
  useSessionPickList,
  useSetParcelLines,
  type Parcel,
} from '../queries';
import styles from './run-sessions-screen.module.css';
import { SessionSmsPanel } from './sms-panel';
import { resolvePreferenceLines, validatePreferenceRules } from '../preference-rules';
import {
  buildPickListInformation,
  pickListInformationNeedsOptionSources,
} from '../pick-list-information';

/**
 * Whether a parcel's preferences can only be read with a server lookup in hand
 * — a question choosing from one stores an id, and no screen may show that.
 * Read from the shipped configuration once, because the marker moves with a
 * release and not while a session is being run.
 */
const PREFERENCES_NEED_OPTION_SOURCES = needsOptionSources(
  dynamicQuestions(referralFormDefinition).filter((question) => question.preference),
);

/**
 * The operational view: no session or referral maintenance controls live here.
 *
 * **Every open session, including ones already in the past.** `screenDetails.md`:
 * outcomes and details are routinely completed after the event — the Saturday
 * session gets its no-shows recorded on the Monday — so a list that stopped at
 * today would hide exactly the sessions with work left on them. The server
 * agrees: it caps only how far forward a team lead may look and applies no
 * lower bound at all.
 *
 * Open means `planned` or `in_progress`. A `confirmed` session is signed off
 * and cannot be changed, and a `cancelled` one is not being run; neither has
 * anything left for this screen to do, and listing them would grow without
 * limit as the weeks pass.
 */
export function RunSessionsScreen() {
  const sessions = useSessions();
  const open = (sessions.data ?? []).filter(
    (session) => session.status === 'planned' || session.status === 'in_progress',
  );

  return (
    <>
      <PageHeader title="Run a session" />
      <p>Select the session you are running. Pick lists are prepared when you open it.</p>
      {sessions.isPending && <Spinner label="Loading sessions…" />}
      {sessions.isError && (
        <ErrorNotice error={sessions.error} onRetry={() => void sessions.refetch()} />
      )}
      {sessions.isSuccess &&
        (open.length === 0 ? (
          <EmptyState
            headline="No sessions to run"
            sentence="Every session has been completed or cancelled."
          />
        ) : (
          <ul>
            {open.map((session) => (
              <li key={session.id}>
                <Link to={`/run-sessions/${session.id}`}>
                  {describeSessionChoice(
                    `${formatSessionDate(session.sessionDate)}, ${formatTimeRange(session.startTime, session.durationMinutes)}`,
                    session,
                  )}
                </Link>{' '}
                ({session.booked} booked)
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

/**
 * The print control while printing is still refused, and the refusal has to
 * reach somebody who cannot see it.
 *
 * **`aria-disabled`, not `disabled`.** A disabled button leaves the tab order,
 * so a keyboard or screen-reader user meets a link that has silently become
 * nothing at all and never reaches the sentence sitting next to it explaining
 * why. This stays focusable and carries the reason as its description, so the
 * answer arrives with the control rather than beside it. It has no handler, so
 * activating it does nothing — which is the behaviour `disabled` was there for.
 */
/**
 * Which session this screen is about, as four aligned columns: the date, the
 * hours, whether it is collection only, and how many households are booked.
 *
 * **Columns rather than a sentence**, settled by Pete on 2026-08-16. A team
 * lead reads this at a glance while a hall fills up, and the parts that matter
 * sit in the same place every time rather than moving with the length of what
 * came before them. The third column stays empty for an ordinary session, which
 * is what keeps the fourth in line down a list.
 *
 * The location is gone — one hall, so it was the same words every time. See
 * `src/lib/session-description.ts`.
 */
function SessionLine({ session }: { session: Session }) {
  return (
    <p className={styles.sessionLine}>
      <span>{formatSessionDate(session.sessionDate)}</span>
      <span className={styles.sessionHours}>
        {formatTimeRange(session.startTime, session.durationMinutes)}
      </span>
      <span>{collectionOnlyLabel(session)}</span>
      <span>{session.booked} booked</span>
    </p>
  );
}

function PrintUnavailable() {
  const reasonId = useId();

  return (
    <>
      <button
        aria-describedby={reasonId}
        aria-disabled
        className={styles.unavailable}
        type="button"
      >
        Print all pick lists
      </button>{' '}
      <span id={reasonId}>Review every pick list before printing.</span>
    </>
  );
}

export function PickListPrintScreen() {
  const { sessionId = '' } = useParams();
  const list = useSessionPickList(sessionId);
  const currentParcels = (list.data?.parcels ?? []).filter(isCurrentParcel);
  const readyToPrint = list.data !== undefined && allParcelsReviewed(currentParcels);
  const print = usePrintPickList(readyToPrint ? list.data.pickList.id : '');
  const markPrinted = useMarkPickListPrinted();
  const printed = useRef<string | null>(null);

  useEffect(() => {
    if (print.data !== undefined && printed.current !== print.data.pickList.id) {
      printed.current = print.data.pickList.id;
      markPrinted.mutate(print.data.pickList.id);
      window.print();
    }
  }, [markPrinted, print.data]);

  if (list.isPending || (readyToPrint && print.isPending))
    return <Spinner label="Preparing print sheets…" />;
  if (list.isError) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  if (!readyToPrint)
    return (
      <>
        <PageHeader title="Pick lists" />
        <p role="alert">Review every pick list before printing.</p>
      </>
    );
  if (print.isError)
    return <ErrorNotice error={print.error} onRetry={() => void print.refetch()} />;
  if (print.data === undefined) return <Spinner label="Preparing print sheets…" />;
  return (
    <>
      <PageHeader title="Pick lists" />
      <div className={styles.printSheets}>
        {print.data.parcels
          .filter((parcel) =>
            currentParcels.some((current) => current.pickNumber === parcel.pickNumber),
          )
          .map((parcel) => {
            const sessionParcel = list.data.parcels.find(
              (candidate) => candidate.pickNumber === parcel.pickNumber,
            );
            const householdComposition = sessionParcel?.answers[HOUSEHOLD_COMPONENTS_KEY];
            return (
              <section className={styles.printSheet} key={parcel.pickNumber}>
                <h1 className={styles.pickNumber}>Pick #{parcel.pickNumber}</h1>
                <p>
                  {parcel.refereeFirstName ?? 'Unknown'} {parcel.refereeSurname ?? ''}
                </p>
                {parcel.isDelivery && (
                  <p className={styles.delivery}>
                    DELIVERY
                    <br />
                    {parcel.deliveryAddress}
                    <br />
                    {parcel.deliveryPostcode}
                    <br />
                    {parcel.deliveryPhone}
                  </p>
                )}
                {parcel.notes !== null && parcel.notes.trim() !== '' && (
                  /* The same words the team lead typed it under, because the
                     picker holding this sheet is the "picker" that label
                     names. */
                  <section
                    aria-label="Information for pickers"
                    className={styles.pickListInformation}
                  >
                    <h2>Information for pickers</h2>
                    <p>{parcel.notes}</p>
                  </section>
                )}
                {isHouseholdComposition(householdComposition) && (
                  <HouseholdCompositionGrid composition={householdComposition} />
                )}
                <ul>
                  {parcel.lines.map((line) => (
                    <li key={line.stockItemId}>
                      {line.name}: {line.quantity}
                      {line.description !== null && <div>{line.description}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
    </>
  );
}

export function RunSessionDetailScreen() {
  const { sessionId = '' } = useParams();
  const session = useSession(sessionId);
  const referrals = useReferrals({ sessionId });
  const stockItems = useStockItems();
  const requested = useRef<string | null>(null);
  const [pickListSessionId, setPickListSessionId] = useState('');
  const reconcile = useReconcilePickList(setPickListSessionId);
  /*
   * The reason lookup, needed only while the form marks a pick-list question
   * that chooses from it. The notes are composed here once and **saved on the
   * parcel**, so composing them without the list would print an id on a picking
   * sheet and leave it there — worth waiting for the list, and worth not
   * fetching at all the rest of the time, because this is the request standing
   * between a team lead and their pick lists.
   */
  const reasons = useReferralOptionSources(pickListInformationNeedsOptionSources());
  const preferenceRuleHealth = useMemo(
    () => (stockItems.data === undefined ? null : validatePreferenceRules(stockItems.data)),
    [stockItems.data],
  );

  useEffect(() => {
    if (
      sessionId !== '' &&
      requested.current !== sessionId &&
      referrals.data !== undefined &&
      stockItems.data !== undefined &&
      !reasons.isPending &&
      !reasons.isError &&
      preferenceRuleHealth?.errors.length === 0
    ) {
      requested.current = sessionId;
      setPickListSessionId('');
      reconcile.mutate({
        sessionId,
        preferenceLines: resolvePreferenceLines(referrals.data, stockItems.data),
        pickListInformation: buildPickListInformation(referrals.data, reasons.sources),
      });
    }
  }, [
    preferenceRuleHealth,
    reasons.isError,
    reasons.isPending,
    reasons.sources,
    reconcile,
    referrals.data,
    sessionId,
    stockItems.data,
  ]);

  const pickList = useSessionPickList(pickListSessionId);
  const complete = useConfirmSession();

  if (
    session.isPending ||
    referrals.isPending ||
    stockItems.isPending ||
    reasons.isPending ||
    (reconcile.isPending && pickList.data === undefined) ||
    (reconcile.isSuccess && pickList.isPending)
  ) {
    return (
      <>
        <PageHeader title="Run a session" />
        <Spinner label="Preparing pick lists…" />
      </>
    );
  }
  if (session.isError)
    return (
      <>
        <PageHeader title="Run a session" />
        <ErrorNotice error={session.error} onRetry={() => void session.refetch()} />
      </>
    );
  if (referrals.isError)
    return (
      <>
        <PageHeader title="Run a session" />
        <ErrorNotice error={referrals.error} onRetry={() => void referrals.refetch()} />
      </>
    );
  if (stockItems.isError)
    return (
      <>
        <PageHeader title="Run a session" />
        <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />
      </>
    );
  /* Only reachable while a pick-list question chooses from the reason lookup,
     and then the pick lists must wait: their notes are saved on the parcel, so
     composing them without the list would write an identifier onto a picking
     sheet for good. */
  if (reasons.isError)
    return (
      <>
        <PageHeader title="Run a session" />
        <ErrorNotice error={reasons.error} onRetry={() => void reasons.refetch()} />
      </>
    );
  if (preferenceRuleHealth !== null && preferenceRuleHealth.errors.length > 0)
    return (
      <>
        <PageHeader title="Run a session" />
        <div role="alert">
          <h2>Pick-list rules need attention</h2>
          <p>Ask an administrator to fix these rules before preparing the pick lists:</p>
          <ul>
            {preferenceRuleHealth.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      </>
    );
  if (reconcile.isError)
    return (
      <>
        <PageHeader title="Run a session" />
        <ErrorNotice error={reconcile.error} />
      </>
    );
  if (pickList.isError)
    return (
      <>
        <PageHeader title="Run a session" />
        <ErrorNotice error={pickList.error} onRetry={() => void pickList.refetch()} />
      </>
    );
  if (pickList.data === undefined) return null;
  const currentParcels = pickList.data.parcels.filter(isCurrentParcel);
  const allOutcomesRecorded = currentParcels.every((parcel) => parcel.attendance !== 'pending');
  const readyToPrint = allParcelsReviewed(currentParcels);

  return (
    <>
      <PageHeader title="Run a session" />
      <SessionLine session={session.data} />
      {reconcile.data !== undefined && (reconcile.data.parcelsCreated ?? 0) > 0 && (
        <p role="status">
          {reconcile.data.parcelsCreated} new pick list
          {reconcile.data.parcelsCreated === 1 ? '' : 's'}{' '}
          {pickList.data.pickList.firstPrintedAt === null
            ? 'created.'
            : 'created — print again to include them.'}
        </p>
      )}
      <h2>Clients</h2>
      <p>
        {readyToPrint ? (
          <Link to={`/run-sessions/${sessionId}/print`}>Print all pick lists</Link>
        ) : (
          <PrintUnavailable />
        )}
        {' · '}
        <Link to={`/run-sessions/${sessionId}/listener`}>Listener sheet</Link>
        {' · '}
        <Link to={`/run-sessions/${sessionId}/referral-details`}>Referral details</Link>
      </p>
      <button
        disabled={session.data.status === 'confirmed' || !allOutcomesRecorded || complete.isPending}
        onClick={() => {
          complete.mutate(sessionId);
        }}
        type="button"
      >
        Complete session
      </button>
      {complete.error !== null && <SessionRefusal error={complete.error} />}
      <ul>
        {currentParcels.map((parcel) => (
          <ClientRow
            key={parcel.id}
            parcel={parcel}
            sessionId={sessionId}
            sessionStatus={session.data.status}
          />
        ))}
      </ul>
      <SessionSmsPanel parcels={currentParcels} sessionId={sessionId} />
    </>
  );
}

/**
 * Why a session would not close.
 *
 * `POST /sessions/{id}/confirm` refuses while anybody is still unmarked and
 * names them in `details.pendingPickNumbers`. **Those numbers are the whole
 * point of showing this**: a team leader at the end of a session needs to know
 * who is missing, not that something went wrong, and there is no override to
 * offer them instead.
 *
 * Only reachable in a race — the button is disabled until every parcel on
 * screen has an outcome — which is exactly why it went unnoticed that the
 * button did nothing at all. `ErrorNotice` handles everything else this call
 * can fail with, including the `409` that arrives without the numbers.
 */
const PICK_NUMBER_LIST = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

function SessionRefusal({ error }: { error: unknown }) {
  if (!(error instanceof ApiError)) return <ErrorNotice error={error} />;

  const pending = pendingPickNumbers(error);
  if (pending === null || pending.length === 0) return <ErrorNotice error={error} />;

  return (
    <div className={styles.refusal} role="alert">
      <p>{describeApiError(error)}</p>
      <p>
        Still to be marked:{' '}
        <strong>{PICK_NUMBER_LIST.format(pending.map((number) => `#${String(number)}`))}</strong>.
      </p>
    </div>
  );
}

/** A delivery is attended by being delivered, and missed by nobody being in. */
function attendedLabel(parcel: Parcel): string {
  return parcel.isDelivery ? 'Delivered' : 'Attended';
}

function missedLabel(parcel: Parcel): string {
  return parcel.isDelivery ? 'Not in' : 'No show';
}

/** The household on a parcel, with whatever part of the name the server sent. */
function parcelName(parcel: Parcel): string {
  return [parcel.refereeFirstName ?? 'Unknown', parcel.refereeSurname ?? ''].join(' ').trim();
}

/** `pick #3, Ada Rowe` — how one row is told from another out loud. */
function describeParcel(parcel: Parcel): string {
  return `pick #${String(parcel.pickNumber)}, ${parcelName(parcel)}`;
}

function ClientRow({
  parcel,
  sessionId,
  sessionStatus,
}: {
  parcel: Parcel;
  sessionId: string;
  sessionStatus: Session['status'];
}) {
  const attendance = useRecordAttendance();
  const status =
    parcel.attendance === 'attended'
      ? attendedLabel(parcel)
      : parcel.attendance === 'no_show'
        ? missedLabel(parcel)
        : parcel.reviewedAt === null
          ? 'Pending Review'
          : 'Pick List reviewed';
  const reviewed = parcel.reviewedAt !== null;
  return (
    <li>
      #{parcel.pickNumber} {parcel.refereeFirstName ?? 'Unknown'} {parcel.refereeSurname ?? ''} |{' '}
      {status} |{' '}
      {!reviewed && parcel.attendance === 'pending' ? (
        <Link to={`/run-sessions/${sessionId}/clients/${parcel.id}`}>Review Pick list</Link>
      ) : sessionStatus !== 'confirmed' ? (
        /*
         * Named for the household, not just the outcome. Every row renders the
         * same two words, so a screen reader's list of buttons on a session of
         * twenty is twenty identical pairs — and the pick number and name that
         * tell them apart are in the surrounding text, which does not reach the
         * accessible name. These are the buttons that decide whether a household
         * is recorded as fed, so the wrong one is not a cosmetic mistake.
         *
         * The visible words come first, because that is what somebody using
         * voice control says.
         */
        <>
          <button
            aria-label={`${attendedLabel(parcel)} — ${describeParcel(parcel)}`}
            disabled={attendance.isPending}
            onClick={() => {
              attendance.mutate({ id: parcel.id, attendance: 'attended' });
            }}
            type="button"
          >
            {attendedLabel(parcel)}
          </button>{' '}
          <button
            aria-label={`${missedLabel(parcel)} — ${describeParcel(parcel)}`}
            disabled={attendance.isPending}
            onClick={() => {
              attendance.mutate({ id: parcel.id, attendance: 'no_show' });
            }}
            type="button"
          >
            {missedLabel(parcel)}
          </button>
        </>
      ) : null}
    </li>
  );
}

/** The focused workspace for one household; the client list deliberately stays on its own page. */
export function RunSessionClientScreen() {
  const { sessionId = '', parcelId = '' } = useParams();
  const session = useSession(sessionId);
  const navigate = useNavigate();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const pickList = useSessionPickList(sessionId);

  if (session.isPending || pickList.isPending) return <Spinner label="Loading client…" />;
  if (session.isError)
    return <ErrorNotice error={session.error} onRetry={() => void session.refetch()} />;
  if (pickList.isError)
    return <ErrorNotice error={pickList.error} onRetry={() => void pickList.refetch()} />;
  const parcel = pickList.data.parcels.find(
    (candidate) => candidate.id === parcelId && isCurrentParcel(candidate),
  );
  if (parcel === undefined)
    return <EmptyState headline="Client not found" sentence="Return to the session client list." />;

  const runAction = (action: () => void) => {
    if (hasUnsavedChanges) setPendingAction(() => action);
    else action();
  };
  const linkTo = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    runAction(() => {
      void navigate(path);
    });
  };
  return (
    <>
      {/* The pick number and the household, first thing on the screen and only
          once. A team lead arrives here from the client list holding a bag, and
          this is the line that says which one — so the panel below no longer
          repeats it as a heading of its own.

          The adults/children pair used to sit here and no longer does. Those
          two numbers are the grid's axes rather than a description of the
          household — an adult is anyone over 11 and the under-fives are in
          neither count — so read off a heading they say something untrue about
          the people the bag is for. The composition grid below says it properly.

          Printing is deliberately absent: it is a whole-session action, and the
          client list is where it lives. Offering it here put the one control
          that commits every sheet to paper next to the one household this
          screen is about. */}
      <PageHeader title={`Pick #${String(parcel.pickNumber)}: ${parcelName(parcel)}`} />
      <SessionLine session={session.data} />
      <p>
        <Link onClick={linkTo(`/run-sessions/${sessionId}`)} to={`/run-sessions/${sessionId}`}>
          Back to clients
        </Link>
      </p>
      {/* Keyed on the parcel, and that is load-bearing rather than tidy. The
          panel seeds its draft quantities and notes from `parcel` once, when it
          mounts. Without the key, moving between two households on this route
          reuses the instance, so the second household is shown — and saved —
          holding the first one's pick list. */}
      <ParcelPanel
        key={parcel.id}
        onDirtyChange={setHasUnsavedChanges}
        onPendingActionHandled={() => {
          setPendingAction(null);
        }}
        parcel={parcel}
        pendingAction={pendingAction}
        sessionStatus={session.data.status}
      />
    </>
  );
}

function ParcelPanel({
  parcel,
  sessionStatus,
  pendingAction,
  onPendingActionHandled,
  onDirtyChange,
}: {
  parcel: Parcel;
  sessionStatus: Session['status'];
  pendingAction: (() => void) | null;
  onPendingActionHandled: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const review = useReviewParcel();
  const saveLines = useSetParcelLines();
  const stockItems = useStockItems();
  // Only the preferences are shown here, so the lookup is fetched only if one
  // of *them* chooses from it — which none do today. It is what keeps an id off
  // the screen if the charity ever marks one that does, and every card shares
  // the one cached query rather than making a request each.
  const reasons = useReferralOptionSources(PREFERENCES_NEED_OPTION_SOURCES);
  const [savedLines, setSavedLines] = useState(() => toDraftLines(parcel.lines));
  const [draftLines, setDraftLines] = useState(() => toDraftLines(parcel.lines));
  const [savedNotes, setSavedNotes] = useState(parcel.notes ?? '');
  const [draftNotes, setDraftNotes] = useState(parcel.notes ?? '');
  const [showUnselectedStockItems, setShowUnselectedStockItems] = useState(true);
  // A recorded outcome stops the parcel changing, but does not stop it being
  // corrected. Only confirming the containing session locks both.
  const parcelLinesLocked = parcel.attendance !== 'pending' || sessionStatus === 'confirmed';
  const notesLocked = sessionStatus === 'confirmed';
  const answers = describeAnswers(
    referralFormDefinition,
    { answers: parcel.answers, piiPurgedAt: null },
    reasons.sources,
  );
  const preferences =
    answers.kind === 'answers' ? answers.lines.filter((line) => line.isPreference) : [];
  const changedLines = changedDraftLines(savedLines, draftLines);
  const notesChanged = savedNotes !== draftNotes;
  const isDirty = changedLines.length > 0 || notesChanged;

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => {
      onDirtyChange(false);
    };
  }, [isDirty, onDirtyChange]);

  /** Puts the draft back to what was last saved, so leaving without saving really does. */
  const discardDraft = () => {
    setDraftLines(savedLines);
    setDraftNotes(savedNotes);
  };

  const save = (afterSave?: () => void) => {
    if (!isDirty) {
      afterSave?.();
      return;
    }
    saveLines.mutate(
      {
        parcelId: parcel.id,
        lines: changedLines,
        ...(notesChanged ? { notes: draftNotes.trim() === '' ? null : draftNotes } : {}),
      },
      {
        onSuccess: () => {
          setSavedLines(draftLines);
          setSavedNotes(draftNotes);
          afterSave?.();
        },
      },
    );
  };
  const draftLineIds = new Set(draftLines.map((line) => line.stockItemId));
  const displayedStockItems = (stockItems.data ?? []).filter(
    (item) => draftLineIds.has(item.id) || (item.isActive && showUnselectedStockItems),
  );
  const needsAttention = draftLines.some((line) => line.quantity === -1);
  const householdComposition = parcel.answers[HOUSEHOLD_COMPONENTS_KEY];

  return (
    <section className={styles.parcelPanel}>
      {isHouseholdComposition(householdComposition) && (
        <div className={styles.householdComposition}>
          <HouseholdCompositionGrid composition={householdComposition} />
        </div>
      )}
      {/* Above the pickers' information rather than below it: `screenDetails.md`
          asks for the review button "at the top", and a team lead working down a
          hall reaches for Save and Mark reviewed far more often than they retype
          the note. */}
      <div className={styles.reviewAction}>
        <button
          className={styles.reviewButton}
          disabled={!isDirty || saveLines.isPending || review.isPending}
          onClick={() => {
            save();
          }}
          type="button"
        >
          {saveLines.isPending ? 'Saving…' : 'Save pick list'}
        </button>
        {parcel.reviewedAt === null && sessionStatus !== 'confirmed' && (
          <button
            className={styles.reviewButton}
            disabled={saveLines.isPending || review.isPending || needsAttention}
            onClick={() => {
              save(() => {
                review.mutate(parcel.id);
              });
            }}
            type="button"
          >
            {review.isPending ? 'Marking reviewed…' : 'Mark pick list reviewed'}
          </button>
        )}
        {needsAttention && (
          <p role="alert">
            Set a quantity for every item marked “Needs attention” before reviewing.
          </p>
        )}
      </div>
      <div className={styles.pickListInformationEditor}>
        <label htmlFor={`pick-list-information-${parcel.id}`}>Information for pickers</label>
        <textarea
          disabled={notesLocked}
          id={`pick-list-information-${parcel.id}`}
          maxLength={1200}
          onChange={(event) => {
            setDraftNotes(event.target.value);
          }}
          rows={4}
          value={draftNotes}
        />
      </div>
      <div className={styles.editorColumns}>
        <section className={styles.editorPane}>
          <h2 className={styles.visuallyHidden}>Pick list</h2>
          <label className={styles.unselectedItemsToggle}>
            <input
              checked={showUnselectedStockItems}
              onChange={(event) => {
                setShowUnselectedStockItems(event.target.checked);
              }}
              type="checkbox"
            />
            Show unselected Stock items
          </label>
          {stockItems.isPending ? (
            <Spinner label="Loading stock items…" />
          ) : stockItems.isError ? (
            <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />
          ) : (
            <ul className={styles.itemList}>
              {groupStockItemsByCategory(displayedStockItems).map(({ category, items }) => (
                <li className={styles.categoryGroup} key={category}>
                  <h3 className={styles.categoryHeading}>{category}</h3>
                  <ul className={styles.categoryItems}>
                    {items.map((item) => {
                      const line = draftLines.find(
                        (candidate) => candidate.stockItemId === item.id,
                      );
                      return (
                        <li key={item.id}>
                          <LineEditor
                            item={item}
                            line={line}
                            locked={parcelLinesLocked}
                            onChange={(quantity) => {
                              setDraftLines((lines) => {
                                const current = lines.find(
                                  (candidate) => candidate.stockItemId === item.id,
                                );
                                if (quantity === null)
                                  return lines.filter(
                                    (candidate) => candidate.stockItemId !== item.id,
                                  );
                                if (current === undefined)
                                  return [
                                    ...lines,
                                    {
                                      stockItemId: item.id,
                                      name: item.name,
                                      shelfNumber: item.shelfNumber,
                                      quantity,
                                    },
                                  ];
                                return lines.map((candidate) =>
                                  candidate.stockItemId === item.id
                                    ? { ...candidate, quantity }
                                    : candidate,
                                );
                              });
                            }}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {/* Only while the dialog is closed — it renders the same error itself,
              and two live regions announcing one failure is one too many. */}
          {pendingAction === null && saveLines.error !== null && (
            <ErrorNotice error={saveLines.error} />
          )}
        </section>
        <section className={styles.editorPane}>
          <h2 className={styles.paneHeading}>Preferences</h2>
          {/* Only reachable while a preference chooses from the reason lookup:
              the answers are ids until it arrives. */}
          {reasons.isPending ? (
            <Spinner label="Loading the answers…" />
          ) : preferences.length === 0 ? (
            <p>No food preferences were given.</p>
          ) : (
            <table className={styles.preferencesTable}>
              <thead>
                <tr>
                  <th scope="col">Preference</th>
                  <th scope="col">Answer</th>
                </tr>
              </thead>
              <tbody>
                {preferences.map((line) => (
                  <tr key={line.key}>
                    <th scope="row">{line.key}</th>
                    <td>{line.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {pendingAction !== null && (
        /*
         * Three answers, because the question has three. `screenDetails.md` asks
         * that leaving with unsaved work "asks whether to save first", and a
         * dialog offering only Save and Cancel cannot take no for an answer:
         * somebody who has typed a quantity onto the wrong household is left
         * with no way off the screen except to save it.
         *
         * The save error is rendered here rather than only in the editor pane
         * behind the dialog, where a modal makes it unreadable at exactly the
         * moment it matters.
         */
        <ConfirmDialog
          busy={saveLines.isPending}
          cancelLabel="Stay on this pick list"
          confirmLabel="Save changes"
          onCancel={onPendingActionHandled}
          onConfirm={() => {
            save(() => {
              onPendingActionHandled();
              pendingAction();
            });
          }}
          secondary={{
            label: 'Discard changes',
            onClick: () => {
              discardDraft();
              onPendingActionHandled();
              pendingAction();
            },
          }}
          title="Save pick list changes?"
        >
          <p>Your pick-list changes have not been saved.</p>
          {saveLines.error !== null && <ErrorNotice error={saveLines.error} />}
        </ConfirmDialog>
      )}
    </section>
  );
}

function LineEditor({
  item,
  line,
  locked,
  onChange,
}: {
  item: StockItem;
  line: DraftLine | undefined;
  locked: boolean;
  onChange: (quantity: number | null) => void;
}) {
  return (
    <label>
      <span className={styles.itemName}>
        {item.name}
        {!item.isActive && ' (retired)'}
      </span>
      {item.description !== null && (
        <span className={styles.itemDescription}>{item.description}</span>
      )}{' '}
      {line?.quantity === -1 && (
        <strong>Needs attention — choose a quantity or remove this item.</strong>
      )}
      <input
        disabled={locked}
        min="0"
        onChange={(event) => {
          if (event.target.value === '') {
            onChange(null);
            return;
          }
          const parsed = Number(event.target.value);
          if (Number.isInteger(parsed) && parsed >= 0) onChange(parsed === 0 ? null : parsed);
        }}
        type="number"
        value={line?.quantity === -1 ? '' : (line?.quantity ?? '')}
      />
    </label>
  );
}

function groupStockItemsByCategory(items: readonly StockItem[]) {
  const groups: { category: string; items: StockItem[] }[] = [];

  for (const item of items) {
    const current = groups.at(-1);
    if (current?.category === item.category) current.items.push(item);
    else groups.push({ category: item.category, items: [item] });
  }

  return groups;
}

function allParcelsReviewed(parcels: readonly Parcel[]): boolean {
  return parcels.every((parcel) => parcel.reviewedAt !== null);
}

/**
 * Parcels are immutable operational snapshots, so cancelling a referral does
 * not delete its rows. The API marks that snapshot as cancelled; it must no
 * longer become a client, a print gate, or an SMS conversation.
 */
function isCurrentParcel(parcel: Parcel): boolean {
  return parcel.attendance !== 'cancelled';
}

type DraftLine = Pick<Parcel['lines'][number], 'stockItemId' | 'name' | 'shelfNumber' | 'quantity'>;

function toDraftLines(lines: readonly Parcel['lines'][number][]): DraftLine[] {
  return lines.map(({ stockItemId, name, shelfNumber, quantity }) => ({
    stockItemId,
    name,
    shelfNumber,
    quantity,
  }));
}

function changedDraftLines(
  savedLines: readonly DraftLine[],
  draftLines: readonly DraftLine[],
): { stockItemId: string; quantity: number }[] {
  const saved = new Map(savedLines.map((line) => [line.stockItemId, line.quantity]));
  const draft = new Map(draftLines.map((line) => [line.stockItemId, line.quantity]));
  return [...new Set([...saved.keys(), ...draft.keys()])].flatMap((stockItemId) => {
    const was = saved.get(stockItemId) ?? 0;
    const now = draft.get(stockItemId) ?? 0;
    return was === now ? [] : [{ stockItemId, quantity: now }];
  });
}
