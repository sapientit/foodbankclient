import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../../auth/auth-context';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { HouseholdCompositionGrid } from '../../../components/household-composition-grid';
import { PageHeader } from '../../../components/page-header';
import { SessionListFilters } from '../../../components/session-list-filters';
import { SessionTable } from '../../../components/session-table';
import { Spinner } from '../../../components/spinner';
import { ApiError, describeApiError, isNotFound, pendingPickNumbers } from '../../../lib/errors';
import { formatSessionDate, formatTimeRange, londonToday } from '../../../lib/london-time';
import { collectionOnlyLabel } from '../../../lib/session-description';
import { useSession, useSessions, type Session } from '../../sessions/queries';
import {
  filterSessionsByStatus,
  readSessionListSelection,
} from '../../sessions/session-list-filters.logic';
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
import {
  attendedLabel,
  describeReadOnlySession,
  isSessionReadOnly,
  missedLabel,
  parcelStatus,
} from '../run-session.logic';
import styles from './run-sessions-screen.module.css';
import { SessionSmsPanel } from './sms-panel';
import { StockCheckPanel } from './stock-check-panel';
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
 * **Open sessions by default, including ones already in the past.**
 * `screenDetails.md`: outcomes and details are routinely completed after the
 * event — the Saturday session gets its no-shows recorded on the Monday — so a
 * list that stopped at today would hide exactly the sessions with work left on
 * them. Open means `planned` or `in_progress`.
 *
 * **`Show completed` brings back the ones that are finished with**, because a
 * completed session is now something to look at rather than something to do:
 * who attended, what each household was given, the listener sheet. It is off by
 * default so the list a team lead opens mid-shift is the work in front of them.
 * A date window bounds it either way — the server puts no lower bound on the
 * past at all, so without one this would grow without limit as the weeks pass.
 */
export function RunSessionsScreen() {
  const [searchParams] = useSearchParams();
  const selection = readSessionListSelection(searchParams, londonToday());
  const sessions = useSessions({ from: selection.from, to: selection.to });
  const shown = filterSessionsByStatus(sessions.data ?? [], selection.showCompleted);

  return (
    <>
      <PageHeader title="Run a session" />
      <p>
        Select the session you are running. Pick lists are prepared when you open it. A completed
        session opens as a record of what happened and cannot be changed.
      </p>
      <SessionListFilters />
      {sessions.isPending && <Spinner label="Loading sessions…" />}
      {sessions.isError && (
        <ErrorNotice error={sessions.error} onRetry={() => void sessions.refetch()} />
      )}
      {sessions.isSuccess &&
        (shown.length === 0 ? (
          <EmptyState
            headline="No sessions to show"
            sentence={
              selection.showCompleted
                ? 'Nothing falls between these dates. Try widening them.'
                : 'Nothing left to run between these dates. Try widening them, or tick Show completed to look back.'
            }
          />
        ) : (
          <SessionTable
            caption={
              selection.showCompleted
                ? 'Sessions in this date range, completed ones included'
                : 'Sessions still to run in this date range'
            }
            hrefFor={(session) => `/run-sessions/${session.id}`}
            sessions={shown}
          />
        ))}
    </>
  );
}

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

/**
 * Everything a team lead does to the session as a whole, on one row above the
 * client list: the three sheets, and the one tap that closes the session.
 *
 * **Together, and above the `Clients` heading.** These act on the session, not
 * on a household, so they sat oddly under a heading naming the list they are
 * not part of — and split across a paragraph of middots and a loose button they
 * read as three unrelated things rather than the set of things there is to do.
 * Settled by Pete on 2026-08-17.
 *
 * **`aria-disabled`, not `disabled`, for both unavailable controls.** A
 * disabled button leaves the tab order, so a keyboard or screen-reader user
 * meets a control that has silently become nothing at all and never reaches the
 * sentence explaining why. These stay focusable and carry the reason as their
 * description. Neither has a handler, so activating one does nothing — which is
 * the behaviour `disabled` was there for. `complete.isPending` is the one real
 * `disabled` left, because that is a control that genuinely works and is busy.
 *
 * The reasons sit under the row rather than beside the control they belong to:
 * in the row they broke the alignment that is the point of grouping these, and
 * `aria-describedby` ties each to its own without relying on proximity.
 */
function SessionActions({
  allOutcomesRecorded,
  completing,
  onComplete,
  onToggleStockCheck,
  readOnly,
  readyToPrint,
  sessionId,
  stockCheckOpen,
  stockCheckPanelId,
}: {
  readonly allOutcomesRecorded: boolean;
  readonly completing: boolean;
  readonly onComplete: () => void;
  readonly onToggleStockCheck: () => void;
  readonly readOnly: boolean;
  readonly readyToPrint: boolean;
  readonly sessionId: string;
  readonly stockCheckOpen: boolean;
  readonly stockCheckPanelId: string;
}) {
  const printReasonId = useId();
  const completeReasonId = useId();
  const stockCheckReasonId = useId();
  const printUnavailable = !readOnly && !readyToPrint;
  const completeUnavailable = !readOnly && !allOutcomesRecorded;
  const stockCheckUnavailable = !readOnly && !readyToPrint;

  return (
    <>
      <div className={styles.actions}>
        {readyToPrint ? (
          <Link className={styles.action} to={`/run-sessions/${sessionId}/print`}>
            {readOnly ? 'View all pick lists' : 'Print all pick lists'}
          </Link>
        ) : readOnly ? (
          <span>No pick lists were prepared for this session.</span>
        ) : (
          <button
            aria-describedby={printReasonId}
            aria-disabled
            className={styles.unavailable}
            type="button"
          >
            Print all pick lists
          </button>
        )}
        {/* **Gone on a finished session, not greyed.** Settled by Pete on
            2026-08-17. The comparison answers "what does this session ask for,
            and is it on the shelves" — a question with a use before the doors
            open and none afterwards, because an attended household's stock has
            already left `quantityOnHand` while its parcel still counts towards
            what was needed, so every line would read as a shortage that never
            happened. Unlike the two controls above, this one is not waiting for
            anything a team lead could do, so there is no sentence to keep
            reachable and nothing to explain. */}
        {readOnly ? null : stockCheckUnavailable ? (
          <button
            aria-describedby={stockCheckReasonId}
            aria-disabled
            className={styles.unavailable}
            type="button"
          >
            Stock check
          </button>
        ) : (
          <button
            aria-controls={stockCheckPanelId}
            aria-expanded={stockCheckOpen}
            className={styles.action}
            onClick={onToggleStockCheck}
            type="button"
          >
            Stock check
          </button>
        )}
        <Link className={styles.action} to={`/run-sessions/${sessionId}/listener`}>
          Listener sheet
        </Link>
        <Link className={styles.action} to={`/run-sessions/${sessionId}/referral-details`}>
          Referral details
        </Link>
        {/* Absent rather than unavailable once the session is closed: after
            `POST /sessions/{id}/confirm` there is no override to offer, and a
            dead button on a session from three weeks ago only invites somebody
            to wonder what is wrong. */}
        {readOnly ? null : allOutcomesRecorded ? (
          /*
           * `aria-disabled` while the request is in flight, not `disabled` —
           * the same reason as the two unavailable controls, and the same shape
           * the SMS panel already uses for `Send SMS reminders`. A real
           * `disabled` takes the control out of the tab order the instant it is
           * pressed, so somebody who activated it by keyboard loses their place
           * and hears nothing at all until the screen re-renders. The guard is
           * what stops a second press submitting twice.
           */
          <button
            aria-disabled={completing}
            className={styles.action}
            onClick={() => {
              if (completing) return;
              onComplete();
            }}
            type="button"
          >
            {completing ? 'Completing session…' : 'Complete session'}
          </button>
        ) : (
          <button
            aria-describedby={completeReasonId}
            aria-disabled
            className={styles.unavailable}
            type="button"
          >
            Complete session
          </button>
        )}
      </div>
      {(printUnavailable || stockCheckUnavailable || completeUnavailable) && (
        <div className={styles.hints}>
          {printUnavailable && <p id={printReasonId}>Review every pick list before printing.</p>}
          {stockCheckUnavailable && (
            <p id={stockCheckReasonId}>
              Review every pick list before checking stock — until then the quantities are still
              moving.
            </p>
          )}
          {completeUnavailable && (
            <p id={completeReasonId}>
              Record an outcome for every client before completing session.
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function PickListPrintScreen() {
  const { sessionId = '' } = useParams();
  const session = useSession(sessionId);
  const list = useSessionPickList(sessionId);
  const currentParcels = (list.data?.parcels ?? []).filter(isCurrentParcel);
  const readyToPrint = list.data !== undefined && allParcelsReviewed(currentParcels);
  const print = usePrintPickList(readyToPrint ? list.data.pickList.id : '');
  const markPrinted = useMarkPickListPrinted();
  const printed = useRef<string | null>(null);
  const readOnly = session.data === undefined ? null : isSessionReadOnly(session.data.status);

  useEffect(() => {
    if (
      readOnly !== null &&
      print.data !== undefined &&
      printed.current !== print.data.pickList.id
    ) {
      printed.current = print.data.pickList.id;
      /*
       * **The sheets still render; the record of a print does not get written.**
       * `POST /pick-lists/{id}/print` is a `409` on a confirmed list, and there
       * is nothing to record anyway — a reprint of a session that is finished is
       * somebody wanting to read what was picked, not the session's first sheets
       * going to paper. `firstPrintedAt` must keep saying when they did.
       */
      if (!readOnly) markPrinted.mutate(print.data.pickList.id);
      window.print();
    }
  }, [markPrinted, print.data, readOnly]);

  if (session.isPending || list.isPending || (readyToPrint && print.isPending))
    return <Spinner label="Preparing print sheets…" />;
  if (session.isError)
    return <ErrorNotice error={session.error} onRetry={() => void session.refetch()} />;
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
  const { state: authState } = useAuth();
  /*
   * **An administrator can open a household's referral from its name here; a
   * team lead cannot.** Settled by Pete on 2026-08-17. The referral screen is
   * administrator work — checking, amending, cancelling — and is not on a team
   * lead's menu, so offering the name as a link to somebody who has no business
   * on that screen is a dead end dressed as a control.
   *
   * **Read from the role, and that is right here.** The rule against gating on
   * the signed-in role is about *fields* on a referral, which are absent rather
   * than `null` and must be gated on reading the object. This is navigation —
   * whether to offer a way through to another screen — which is exactly what
   * `screenDetails.md` means by roles driving menus. The route itself is not
   * role-guarded, and the server's check on the signed token stays the only one
   * that means anything.
   */
  const canOpenReferral = authState.status === 'signed-in' && authState.user.role === 'admin';
  const session = useSession(sessionId);
  /** `null` while the session is still loading — not yet known to be either. */
  const readOnly = session.data === undefined ? null : isSessionReadOnly(session.data.status);
  /*
   * The stock check is asked for rather than shown. It is a second request, and
   * the answer is a table long enough to push the client list — the thing this
   * screen is for — off a phone.
   */
  const stockCheckPanelId = useId();
  const [stockCheckOpen, setStockCheckOpen] = useState(false);
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
   *
   * A finished session composes nothing, so it does not ask for the lookup at
   * all.
   */
  const reasons = useReferralOptionSources(
    pickListInformationNeedsOptionSources() && readOnly === false,
  );
  const preferenceRuleHealth = useMemo(
    () => (stockItems.data === undefined ? null : validatePreferenceRules(stockItems.data)),
    [stockItems.data],
  );

  useEffect(() => {
    /*
     * **A finished session is read, never reconciled.** `POST` on a confirmed
     * pick list is not refused — the server locks the list and answers `200`
     * having created nothing — so an unguarded screen would look like it worked
     * while making a pointless write every time somebody looked back at a
     * session, with no error anywhere to say so. The `GET` is enabled directly
     * instead of waiting on a mutation that must not happen.
     *
     * Nothing here waits for referrals, stock or the preference rules either.
     * Those exist to compose the request body; making a completed session
     * unreadable because a rule names a stock item that has since been retired
     * would lose the record of a session that has already happened.
     */
    if (readOnly === true && sessionId !== '' && requested.current !== sessionId) {
      requested.current = sessionId;
      setPickListSessionId(sessionId);
      return;
    }

    if (
      readOnly === false &&
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
    readOnly,
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

  // The four queries behind reconciliation are only needed to compose the
  // request body, so a read-only session neither waits for them nor fails on
  // them: what is on screen is a record of a session that already happened.
  const preparing = readOnly !== true;

  if (
    session.isPending ||
    (preparing && (referrals.isPending || stockItems.isPending || reasons.isPending)) ||
    (preparing && reconcile.isPending && pickList.data === undefined) ||
    (preparing && reconcile.isSuccess && pickList.isPending) ||
    (readOnly === true && pickList.isPending)
  ) {
    return (
      <>
        <PageHeader title="Run a session" />
        <Spinner label={readOnly === true ? 'Loading the session…' : 'Preparing pick lists…'} />
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
  if (preparing && referrals.isError)
    return (
      <>
        <PageHeader title="Run a session" />
        <ErrorNotice error={referrals.error} onRetry={() => void referrals.refetch()} />
      </>
    );
  if (preparing && stockItems.isError)
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
  if (preparing && reasons.isError)
    return (
      <>
        <PageHeader title="Run a session" />
        <ErrorNotice error={reasons.error} onRetry={() => void reasons.refetch()} />
      </>
    );
  if (preparing && preferenceRuleHealth !== null && preferenceRuleHealth.errors.length > 0)
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
  if (preparing && reconcile.isError)
    return (
      <>
        <PageHeader title="Run a session" />
        <ErrorNotice error={reconcile.error} />
      </>
    );
  const readOnlyReason = describeReadOnlySession(session.data.status);
  /*
   * A session that never had a pick list — cancelled before anybody opened it —
   * is a `404` on the read, and reads as an empty session rather than as a
   * failure. Only worth saying on a read-only session: while one is being run
   * the `GET` follows a `POST` that has just created the list.
   */
  const noPickList = readOnly === true && pickList.isError && isNotFound(pickList.error);
  if (pickList.isError && !noPickList)
    return (
      <>
        <PageHeader title="Run a session" />
        <SessionLine session={session.data} />
        {/* Announced here too. The `ErrorNotice` beside it says the pick list
            would not load; this says why the session cannot be changed, and
            that sentence is the only thing explaining the missing controls. */}
        {readOnlyReason !== null && (
          <p className={styles.readOnlyNotice} role="status">
            {readOnlyReason}
          </p>
        )}
        <ErrorNotice error={pickList.error} onRetry={() => void pickList.refetch()} />
      </>
    );
  /*
   * **Never render one session's households under another session's heading.**
   *
   * The pick list is fetched through `pickListSessionId`, which an effect sets,
   * while the heading comes straight from the route. Moving between two
   * sessions does not remount this screen, so on the render after the route
   * changes the two disagree for one paint — and if the previous session's pick
   * list is still cached (a minute's `staleTime`, and going back and forth
   * between two sessions is ordinary), nothing above is pending, so the old
   * parcels would render under the new session's date. Names, outcomes and
   * pick-list information, on the wrong session.
   *
   * The same rule `ParcelPanel`'s `key={parcel.id}` enforces one level down, on
   * the household rather than the session, and for the same reason.
   */
  if (pickListSessionId !== sessionId) return null;
  if (pickList.data === undefined && !noPickList) return null;
  const currentParcels = (pickList.data?.parcels ?? []).filter(isCurrentParcel);
  const allOutcomesRecorded = currentParcels.every((parcel) => parcel.attendance !== 'pending');
  const readyToPrint = pickList.data !== undefined && allParcelsReviewed(currentParcels);
  /*
   * The panel follows the control rather than the state behind it. A late
   * referral reconciled in arrives unreviewed, which takes the check away — and
   * an open panel whose button has become unavailable is a panel with nothing
   * left to close it, still showing a total that no longer holds.
   */
  const stockCheckOnScreen = stockCheckOpen && readOnly === false && readyToPrint;

  return (
    <>
      <PageHeader title="Run a session" />
      <SessionLine session={session.data} />
      {readOnlyReason !== null && (
        <p className={styles.readOnlyNotice} role="status">
          {readOnlyReason}
        </p>
      )}
      {reconcile.data !== undefined &&
        pickList.data !== undefined &&
        (reconcile.data.parcelsCreated ?? 0) > 0 && (
          <p className={styles.reconciledNotice} role="status">
            {reconcile.data.parcelsCreated} new pick list
            {reconcile.data.parcelsCreated === 1 ? '' : 's'}{' '}
            {pickList.data.pickList.firstPrintedAt === null
              ? 'created.'
              : 'created — print again to include them.'}
          </p>
        )}
      <SessionActions
        allOutcomesRecorded={allOutcomesRecorded}
        completing={complete.isPending}
        onComplete={() => {
          complete.mutate(sessionId);
        }}
        onToggleStockCheck={() => {
          setStockCheckOpen((open) => !open);
        }}
        readOnly={readOnly === true}
        readyToPrint={readyToPrint}
        sessionId={sessionId}
        stockCheckOpen={stockCheckOnScreen}
        stockCheckPanelId={stockCheckPanelId}
      />
      {complete.error !== null && <SessionRefusal error={complete.error} />}
      {/* Between the actions and the client list: it answers a question about
          the session as a whole, and it belongs under the control that opened
          it rather than below twenty households. */}
      <StockCheckPanel id={stockCheckPanelId} open={stockCheckOnScreen} sessionId={sessionId} />
      <h2>Clients</h2>
      {currentParcels.length === 0 ? (
        <p>No clients on this session.</p>
      ) : (
        /*
         * Focusable, because a table that scrolls sideways on a phone is
         * unreachable by keyboard otherwise — the same wrapper `SessionTable`
         * uses, and this is the screen a volunteer runs a hall from.
         */
        <div
          className={styles.clientsTableWrap}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable table needs a keyboard focus target.
          tabIndex={0}
        >
          <table className={styles.clientsTable}>
            {/* Named for anyone who cannot see the `Clients` heading above it,
                and drawn only for them: the heading is already saying this. */}
            <caption className={styles.visuallyHidden}>Clients on this session</caption>
            <thead>
              <tr>
                <th scope="col">Pick #</th>
                <th scope="col">Client</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {currentParcels.map((parcel) => (
                <ClientRow
                  canOpenReferral={canOpenReferral}
                  key={parcel.id}
                  parcel={parcel}
                  readOnly={readOnly === true}
                  sessionId={sessionId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SessionSmsPanel
        parcels={currentParcels}
        readOnly={readOnly === true}
        sessionId={sessionId}
      />
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

/** The household on a parcel, with whatever part of the name the server sent. */
function parcelName(parcel: Parcel): string {
  return [parcel.refereeFirstName ?? 'Unknown', parcel.refereeSurname ?? ''].join(' ').trim();
}

/** `pick #3, Ada Rowe` — how one row is told from another out loud. */
function describeParcel(parcel: Parcel): string {
  return `pick #${String(parcel.pickNumber)}, ${parcelName(parcel)}`;
}

/**
 * What opening a reviewed household's pick list now does — which is not the
 * same thing all session. Until an outcome is recorded the lines can still be
 * changed; after one they cannot, and a link still saying Amend would send a
 * team lead in to find every quantity locked with nothing saying why.
 */
function pickListLabel(parcel: Parcel): string {
  return parcel.attendance === 'pending' ? 'Amend Pick list' : 'View Pick list';
}

function ClientRow({
  canOpenReferral,
  parcel,
  readOnly,
  sessionId,
}: {
  canOpenReferral: boolean;
  parcel: Parcel;
  readOnly: boolean;
  sessionId: string;
}) {
  const attendance = useRecordAttendance();
  const status = parcelStatus(parcel);
  const reviewed = parcel.reviewedAt !== null;
  return (
    <tr>
      {/* The pick number heads the row: it is what matches a sheet in a hall to
          a line on this screen, and it is what the refusal to close the session
          names. Its own column so the numbers align down one edge rather than
          moving with the length of the name before them. */}
      <th className={styles.pickCell} scope="row">
        #{parcel.pickNumber}
      </th>
      {/* The household's referral, opened by their name — the same screen the
          referral list and the search reach. An id in the path and never a
          name: see `.claude/rules/pii-security.md`. Plain text for a team lead,
          for whom that screen is not a task. */}
      <td>
        {canOpenReferral ? (
          <Link to={`/referrals/${parcel.referralId}`}>{parcelName(parcel)}</Link>
        ) : (
          parcelName(parcel)
        )}
      </td>
      <td>
        <span className={styles.status} data-status={status.state}>
          {status.label}
        </span>
      </td>
      <td>
        {/* On a finished session the workspace is still worth opening — it is
            where the parcel's contents are — but there is nothing left to
            review, so the link says what it now does. */}
        {readOnly ? (
          <Link
            className={styles.pickListLink}
            to={`/run-sessions/${sessionId}/clients/${parcel.id}`}
          >
            View Pick list
          </Link>
        ) : !reviewed && parcel.attendance === 'pending' ? (
          <Link
            className={styles.pickListLink}
            to={`/run-sessions/${sessionId}/clients/${parcel.id}`}
          >
            Review Pick list
          </Link>
        ) : (
          /*
           * Named for the household, not just the outcome. Every row renders the
           * same two words, so a screen reader's list of buttons on a session of
           * twenty is twenty identical pairs — and the pick number and name that
           * tell them apart are in neighbouring cells, which do not reach the
           * accessible name. These are the buttons that decide whether a
           * household is recorded as fed, so the wrong one is not a cosmetic
           * mistake.
           *
           * The visible words come first, because that is what somebody using
           * voice control says.
           */
          <div className={styles.rowActions}>
            <button
              aria-label={`${attendedLabel(parcel)} — ${describeParcel(parcel)}`}
              disabled={attendance.isPending}
              onClick={() => {
                attendance.mutate({ id: parcel.id, attendance: 'attended' });
              }}
              type="button"
            >
              {attendedLabel(parcel)}
            </button>
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
            {/*
             * The way back into the household's pick list, which reviewing used
             * to take away. Reviewing settles the quantities; it does not close
             * the list — the server keeps the lines editable right up to the
             * session being confirmed, and a stock check answering that an item
             * is short is exactly the moment a team lead needs to go back in and
             * take it out of a bag. Recording an outcome is the step that stops
             * the parcel changing, because by then its stock has moved, so from
             * there the same link only reads.
             *
             * Named for the household like the buttons beside it: three controls
             * a row, twenty rows, and the pick number and name that tell them
             * apart sit in neighbouring cells that no accessible name reaches.
             */}
            <Link
              aria-label={`${pickListLabel(parcel)} — ${describeParcel(parcel)}`}
              className={styles.pickListLink}
              to={`/run-sessions/${sessionId}/clients/${parcel.id}`}
            >
              {pickListLabel(parcel)}
            </Link>
          </div>
        )}
      </td>
    </tr>
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
        readOnly={isSessionReadOnly(session.data.status)}
      />
    </>
  );
}

function ParcelPanel({
  parcel,
  readOnly,
  pendingAction,
  onPendingActionHandled,
  onDirtyChange,
}: {
  parcel: Parcel;
  readOnly: boolean;
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
  // corrected. Only closing the containing session locks both.
  const parcelLinesLocked = parcel.attendance !== 'pending' || readOnly;
  const notesLocked = readOnly;
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
      {/* Both controls are absent on a finished session rather than disabled.
          Nothing here can become dirty once the inputs are locked, so a Save
          button would sit permanently greyed out saying only that something is
          wrong. */}
      {!readOnly && (
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
          {parcel.reviewedAt === null && (
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
      )}
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
