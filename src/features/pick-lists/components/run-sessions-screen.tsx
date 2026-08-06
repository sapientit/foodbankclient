import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate, formatTimeRange, londonToday } from '../../../lib/london-time';
import { useSession, useSessions, type Session } from '../../sessions/queries';
import { useStockItems } from '../../stock/queries';
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

/** The operational view: no session or referral maintenance controls live here. */
export function RunSessionsScreen() {
  const sessions = useSessions();
  const upcoming = (sessions.data ?? []).filter(
    (session) => session.sessionDate >= londonToday() && session.status !== 'cancelled',
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
        (upcoming.length === 0 ? (
          <EmptyState
            headline="No upcoming sessions"
            sentence="There are no sessions ready to run."
          />
        ) : (
          <ul>
            {upcoming.map((session) => (
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
  const print = usePrintPickList(list.data?.pickList.id ?? '');
  const markPrinted = useMarkPickListPrinted();
  const printed = useRef<string | null>(null);

  useEffect(() => {
    if (print.data !== undefined && printed.current !== print.data.pickList.id) {
      printed.current = print.data.pickList.id;
      markPrinted.mutate(print.data.pickList.id);
      window.print();
    }
  }, [markPrinted, print.data]);

  if (list.isPending || print.isPending) return <Spinner label="Preparing print sheets…" />;
  if (list.isError) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  if (print.isError)
    return <ErrorNotice error={print.error} onRetry={() => void print.refetch()} />;
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
  const requested = useRef<string | null>(null);
  const [pickListSessionId, setPickListSessionId] = useState('');
  const reconcile = useReconcilePickList(setPickListSessionId);

  useEffect(() => {
    if (sessionId !== '' && requested.current !== sessionId) {
      requested.current = sessionId;
      setPickListSessionId('');
      reconcile.mutate(sessionId);
    }
  }, [reconcile, sessionId]);

  const pickList = useSessionPickList(pickListSessionId);
  const complete = useConfirmSession();

  if (
    session.isPending ||
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
        <Link to={`/run-sessions/${sessionId}/print`}>Print all pick lists</Link>
        {' · '}
        <Link to={`/run-sessions/${sessionId}/listener`}>Listener sheet</Link>
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
        <Link
          onClick={linkTo(`/run-sessions/${sessionId}/print`)}
          to={`/run-sessions/${sessionId}/print`}
        >
          Print all pick lists
        </Link>
      </p>
      <ParcelPanel
        onDirtyChange={setHasUnsavedChanges}
        onPendingActionHandled={() => {
          setPendingAction(null);
        }}
        parcel={parcel}
        pendingAction={pendingAction}
        sessionId={sessionId}
        sessionStatus={session.data.status}
      />
    </>
  );
}

function ParcelPanel({
  parcel,
  sessionId,
  sessionStatus,
  pendingAction,
  onPendingActionHandled,
  onDirtyChange,
}: {
  parcel: Parcel;
  sessionId: string;
  sessionStatus: Session['status'];
  pendingAction: (() => void) | null;
  onPendingActionHandled: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const attendance = useRecordAttendance();
  const review = useReviewParcel();
  const complete = useConfirmSession();
  const saveLines = useSetParcelLines();
  const stockItems = useStockItems();
  const [confirmSession, setConfirmSession] = useState(false);
  const [savedLines, setSavedLines] = useState(() => toDraftLines(parcel.lines));
  const [draftLines, setDraftLines] = useState(() => toDraftLines(parcel.lines));
  const [newStockItemId, setNewStockItemId] = useState('');
  const [saveBeforeAction, setSaveBeforeAction] = useState<(() => void) | null>(null);
  // A recorded outcome stops the parcel changing, but does not stop it being
  // corrected. Only confirming the containing session locks both.
  const parcelLocked = parcel.attendance !== 'pending' || sessionStatus === 'confirmed';
  const attendanceLocked = sessionStatus === 'confirmed';
  const attendedLabel = parcel.isDelivery ? 'Delivered' : 'Attended';
  const absentLabel = parcel.isDelivery ? 'Not in' : 'No show';
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
  const requestAction = (action: () => void) => {
    if (isDirty) setSaveBeforeAction(() => action);
    else action();
  };
  const availableStockItems = (stockItems.data ?? []).filter(
    (item) => !draftLines.some((line) => line.stockItemId === item.id),
  );

  return (
    <section className={styles.parcelPanel}>
      <h2>
        Pick #{parcel.pickNumber}: {parcel.refereeFirstName ?? 'Unknown'}{' '}
        {parcel.refereeSurname ?? ''}
      </h2>
      <div className={styles.editorColumns}>
        <section className={styles.editorPane}>
          <h3>Pick list</h3>
          <ul>
            {draftLines.map((line) => (
              <li key={line.stockItemId}>
                <LineEditor
                  line={line}
                  locked={parcelLocked}
                  onChange={(quantity) => {
                    setDraftLines((lines) =>
                      lines.map((current) =>
                        current.stockItemId === line.stockItemId
                          ? { ...current, quantity }
                          : current,
                      ),
                    );
                  }}
                />
              </li>
            ))}
          </ul>
          <label>
            Add item{' '}
            <select
              disabled={parcelLocked || stockItems.isPending || availableStockItems.length === 0}
              onChange={(event) => {
                setNewStockItemId(event.target.value);
              }}
              value={newStockItemId}
            >
              <option value="">Choose an item</option>
              {availableStockItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.shelfNumber})
                </option>
              ))}
            </select>
          </label>{' '}
          <button
            disabled={parcelLocked || newStockItemId === ''}
            onClick={() => {
              const item = availableStockItems.find((candidate) => candidate.id === newStockItemId);
              if (item === undefined) return;
              setDraftLines((lines) => [
                ...lines,
                {
                  stockItemId: item.id,
                  name: item.name,
                  shelfNumber: item.shelfNumber,
                  quantity: 1,
                },
              ]);
              setNewStockItemId('');
            }}
            type="button"
          >
            Add
          </button>
          <p>
            <button
              disabled={parcelLocked || !isDirty || saveLines.isPending}
              onClick={() => {
                save();
              }}
              type="button"
            >
              {saveLines.isPending ? 'Saving…' : 'Save pick list'}
            </button>
          </p>
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
      {attendance.error !== null && <ErrorNotice error={attendance.error} />}
      {parcel.reviewedAt === null && sessionStatus !== 'confirmed' && (
        <button
          disabled={review.isPending}
          onClick={() => {
            review.mutate(parcel.id);
          }}
          type="button"
        >
          {review.isPending ? 'Marking reviewed…' : 'Mark pick list reviewed'}
        </button>
      )}{' '}
      <button
        disabled={attendanceLocked || parcel.reviewedAt === null || attendance.isPending}
        onClick={() => {
          requestAction(() => {
            attendance.mutate({ id: parcel.id, attendance: 'attended' });
          });
        }}
        type="button"
      >
        {attendedLabel}
      </button>{' '}
      <button
        disabled={attendanceLocked || parcel.reviewedAt === null || attendance.isPending}
        onClick={() => {
          requestAction(() => {
            attendance.mutate({ id: parcel.id, attendance: 'no_show' });
          });
        }}
        type="button"
      >
        {absentLabel}
      </button>{' '}
      <button
        disabled={sessionStatus === 'confirmed' || complete.isPending}
        onClick={() => {
          requestAction(() => {
            setConfirmSession(true);
          });
        }}
        type="button"
      >
        Complete session
      </button>
      {confirmSession && (
        <ConfirmDialog
          busy={complete.isPending}
          confirmLabel="Complete session"
          onCancel={() => {
            setConfirmSession(false);
          }}
          onConfirm={() => {
            complete.mutate(sessionId);
            setConfirmSession(false);
          }}
          title="Complete this session?"
        >
          <p>Every client must already be marked. No further changes will be possible.</p>
        </ConfirmDialog>
      )}
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
      {saveBeforeAction !== null && (
        <ConfirmDialog
          busy={saveLines.isPending}
          confirmLabel="Save changes"
          onCancel={() => {
            setSaveBeforeAction(null);
          }}
          onConfirm={() => {
            save(() => {
              const action = saveBeforeAction;
              setSaveBeforeAction(null);
              action();
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
  line,
  locked,
  onChange,
}: {
  line: DraftLine;
  locked: boolean;
  onChange: (quantity: number) => void;
}) {
  return (
    <label>
      {line.name}{' '}
      <input
        disabled={locked}
        min="0"
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (event.target.value !== '' && Number.isInteger(parsed) && parsed >= 0)
            onChange(parsed);
        }}
        type="number"
        value={line.quantity}
      />
    </label>
  );
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
