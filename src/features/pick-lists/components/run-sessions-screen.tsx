import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate, formatTimeRange } from '../../../lib/london-time';
import { useSession, useSessions, type Session } from '../../sessions/queries';
import { useStockItems, type StockItem } from '../../stock/queries';
import { useReferrals } from '../../referrals/queries';
import { describeAnswers } from '../../referrals/referral-answers.logic';
import { referralFormDefinition } from '../../referrals/referral-form-config';
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
import { resolvePreferenceLines } from '../preference-rules';

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
                  {formatSessionDate(session.sessionDate)},{' '}
                  {formatTimeRange(session.startTime, session.durationMinutes)} — {session.location}
                </Link>{' '}
                ({session.booked} booked)
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

export function PickListPrintScreen() {
  const { sessionId = '' } = useParams();
  const list = useSessionPickList(sessionId);
  const readyToPrint = list.data !== undefined && allParcelsReviewed(list.data.parcels);
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
        {print.data.parcels.map((parcel) => (
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
            {parcel.notes !== null && <p>{parcel.notes}</p>}
            <ul>
              {parcel.lines.map((line) => (
                <li key={line.stockItemId}>
                  {line.name}: {line.quantity}
                  {line.description !== null && <div>{line.description}</div>}
                </li>
              ))}
            </ul>
          </section>
        ))}
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

  useEffect(() => {
    if (
      sessionId !== '' &&
      requested.current !== sessionId &&
      referrals.data !== undefined &&
      stockItems.data !== undefined
    ) {
      requested.current = sessionId;
      setPickListSessionId('');
      reconcile.mutate({
        sessionId,
        preferenceLines: resolvePreferenceLines(referrals.data, stockItems.data),
      });
    }
  }, [reconcile, referrals.data, sessionId, stockItems.data]);

  const pickList = useSessionPickList(pickListSessionId);
  const complete = useConfirmSession();

  if (
    session.isPending ||
    referrals.isPending ||
    stockItems.isPending ||
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
  const allOutcomesRecorded = pickList.data.parcels.every(
    (parcel) => parcel.attendance !== 'pending',
  );
  const readyToPrint = allParcelsReviewed(pickList.data.parcels);

  return (
    <>
      <PageHeader title="Run a session" />
      <p>
        {formatSessionDate(session.data.sessionDate)},{' '}
        {formatTimeRange(session.data.startTime, session.data.durationMinutes)} —{' '}
        {session.data.location}. {session.data.booked} booked.
      </p>
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
          <>
            <button disabled type="button">
              Print all pick lists
            </button>{' '}
            Review every pick list before printing.
          </>
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
      <ul>
        {pickList.data.parcels.map((parcel) => (
          <ClientRow
            key={parcel.id}
            parcel={parcel}
            sessionId={sessionId}
            sessionStatus={session.data.status}
          />
        ))}
      </ul>
      <SessionSmsPanel parcels={pickList.data.parcels} sessionId={sessionId} />
    </>
  );
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
      ? parcel.isDelivery
        ? 'Delivered'
        : 'Attended'
      : parcel.attendance === 'no_show'
        ? parcel.isDelivery
          ? 'Not in'
          : 'No show'
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
        <>
          <button
            disabled={attendance.isPending}
            onClick={() => {
              attendance.mutate({ id: parcel.id, attendance: 'attended' });
            }}
            type="button"
          >
            {parcel.isDelivery ? 'Delivered' : 'Attended'}
          </button>{' '}
          <button
            disabled={attendance.isPending}
            onClick={() => {
              attendance.mutate({ id: parcel.id, attendance: 'no_show' });
            }}
            type="button"
          >
            {parcel.isDelivery ? 'Not in' : 'No show'}
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
  const [pickListSessionId] = useState(sessionId);
  const navigate = useNavigate();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const pickList = useSessionPickList(pickListSessionId);

  if (session.isPending || pickList.isPending) return <Spinner label="Loading client…" />;
  if (session.isError)
    return <ErrorNotice error={session.error} onRetry={() => void session.refetch()} />;
  if (pickList.isError)
    return <ErrorNotice error={pickList.error} onRetry={() => void pickList.refetch()} />;
  const parcel = pickList.data.parcels.find((candidate) => candidate.id === parcelId);
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
  const readyToPrint = allParcelsReviewed(pickList.data.parcels);

  return (
    <>
      <PageHeader title={`Pick #${String(parcel.pickNumber)}`} />
      <p>
        {formatSessionDate(session.data.sessionDate)},{' '}
        {formatTimeRange(session.data.startTime, session.data.durationMinutes)} —{' '}
        {session.data.location}.
      </p>
      <p>
        <Link onClick={linkTo(`/run-sessions/${sessionId}`)} to={`/run-sessions/${sessionId}`}>
          Back to clients
        </Link>{' '}
        ·{' '}
        {readyToPrint ? (
          <Link
            onClick={linkTo(`/run-sessions/${sessionId}/print`)}
            to={`/run-sessions/${sessionId}/print`}
          >
            Print all pick lists
          </Link>
        ) : (
          <>
            <button disabled type="button">
              Print all pick lists
            </button>{' '}
            Review every pick list before printing.
          </>
        )}
      </p>
      <ParcelPanel
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
  const [savedLines, setSavedLines] = useState(() => toDraftLines(parcel.lines));
  const [draftLines, setDraftLines] = useState(() => toDraftLines(parcel.lines));
  // A recorded outcome stops the parcel changing, but does not stop it being
  // corrected. Only confirming the containing session locks both.
  const parcelLocked = parcel.attendance !== 'pending' || sessionStatus === 'confirmed';
  const answers = describeAnswers(referralFormDefinition, {
    answers: parcel.answers,
    piiPurgedAt: null,
  });
  const preferences =
    answers.kind === 'answers' ? answers.lines.filter((line) => line.isPreference) : [];
  const changedLines = changedDraftLines(savedLines, draftLines);
  const isDirty = changedLines.length > 0;

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => {
      onDirtyChange(false);
    };
  }, [isDirty, onDirtyChange]);

  const save = (afterSave?: () => void) => {
    if (changedLines.length === 0) {
      afterSave?.();
      return;
    }
    saveLines.mutate(
      { parcelId: parcel.id, lines: changedLines },
      {
        onSuccess: () => {
          setSavedLines(draftLines);
          afterSave?.();
        },
      },
    );
  };
  const draftLineIds = new Set(draftLines.map((line) => line.stockItemId));
  const displayedStockItems = (stockItems.data ?? []).filter(
    (item) => item.isActive || draftLineIds.has(item.id),
  );
  const needsAttention = draftLines.some((line) => line.quantity === -1);

  return (
    <section className={styles.parcelPanel}>
      <h2 className={styles.parcelHeading}>
        <span>
          Pick #{parcel.pickNumber}: {parcel.refereeFirstName ?? 'Unknown'}{' '}
          {parcel.refereeSurname ?? ''}
        </span>
        <span className={styles.householdSize}>
          Adults/children: {parcel.adults}/{parcel.children}
        </span>
      </h2>
      <div className={styles.reviewAction}>
        <button
          className={styles.reviewButton}
          disabled={parcelLocked || !isDirty || saveLines.isPending || review.isPending}
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
      <div className={styles.editorColumns}>
        <section className={styles.editorPane}>
          {stockItems.isPending ? (
            <Spinner label="Loading stock items…" />
          ) : stockItems.isError ? (
            <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />
          ) : (
            <ul className={styles.itemList}>
              {groupStockItemsByCategory(displayedStockItems).map(({ category, items }) => (
                <li className={styles.categoryGroup} key={category}>
                  <h4 className={styles.categoryHeading}>{category}</h4>
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
                            locked={parcelLocked}
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
          {saveLines.error !== null && <ErrorNotice error={saveLines.error} />}
        </section>
        <section className={styles.editorPane}>
          <h3>Preferences</h3>
          {preferences.length === 0 ? (
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
        <ConfirmDialog
          busy={saveLines.isPending}
          confirmLabel="Save changes"
          onCancel={onPendingActionHandled}
          onConfirm={() => {
            save(() => {
              onPendingActionHandled();
              pendingAction();
            });
          }}
          title="Save pick list changes?"
        >
          <p>Save your pick-list changes before continuing?</p>
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
