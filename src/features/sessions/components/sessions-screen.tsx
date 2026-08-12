import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../../../auth/auth-context';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate, formatTimeRange } from '../../../lib/london-time';
import { useSessions, type Session } from '../queries';
import {
  SESSION_STATUS_LABELS,
  SESSION_STATUS_OPTIONS,
  describeOccupancy,
  isSessionStatus,
  occupancy,
} from '../sessions.logic';
import styles from './sessions-screen.module.css';

const STATUS_PARAM = 'status';

/**
 * The session list, and **one route rendering two different screens** rather
 * than a screen per role. `API.md` §2 is explicit that an admin's planning view
 * and a team lead's shift view "are different screens" — what makes that true
 * here is not a client-computed date window (see `useSessions` for why this
 * never sends `from`/`to`) but what each role is offered: an admin gets
 * "Add a session" and a link to the weekly templates; a team lead gets neither,
 * because creating and amending sessions is not their job. The list itself is
 * *whatever the server returns for this token* — six weeks of it for an admin,
 * six days for a team lead — rendered without assuming which.
 */
export function SessionsScreen() {
  const { state } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const statusParam = searchParams.get(STATUS_PARAM);
  const status = isSessionStatus(statusParam) ? statusParam : undefined;
  // Every hook above this line runs on every render, signed in or not — the
  // narrowing return below must come after the last hook call, not before it.
  const sessions = useSessions(status === undefined ? {} : { status });

  // Rendered inside RequireAuth via the shell; narrowing rather than asserting.
  if (state.status !== 'signed-in') return null;
  const { role } = state.user;
  const isAdmin = role === 'admin';

  const title = isAdmin ? 'Sessions' : 'Your sessions';

  return (
    <>
      <PageHeader
        title={title}
        action={
          isAdmin ? (
            <div className={styles.actions}>
              <Link to="/sessions/recurring">Weekly sessions</Link>
              <Link className={styles.add} to="/sessions/new">
                Add a session
              </Link>
            </div>
          ) : undefined
        }
      />

      <p className={styles.intro}>
        {isAdmin
          ? 'Every session that has been generated, up to six weeks ahead. Recurring sessions further out appear once the weekly template creates them.'
          : 'The sessions on your schedule, today and up to six days ahead. For anything further out, ask an administrator.'}
      </p>

      <p className={styles.filter}>
        <label>
          Status{' '}
          <select
            onChange={(event) => {
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  if (event.target.value === '') next.delete(STATUS_PARAM);
                  else next.set(STATUS_PARAM, event.target.value);
                  return next;
                },
                { replace: true },
              );
            }}
            value={status ?? ''}
          >
            <option value="">All</option>
            {SESSION_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </p>

      {sessions.isPending && <Spinner label="Loading sessions…" />}

      {sessions.isError && (
        <ErrorNotice
          error={sessions.error}
          onRetry={() => {
            void sessions.refetch();
          }}
        />
      )}

      {sessions.isSuccess &&
        (sessions.data.length === 0 ? (
          <EmptyState
            headline="No sessions to show"
            sentence={
              isAdmin
                ? 'Add a session, or check a session started a weekly template.'
                : 'Nothing is on the schedule for the next few days.'
            }
          />
        ) : (
          <ul className={styles.list}>
            {sessions.data.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </ul>
        ))}
    </>
  );
}

function SessionRow({ session }: { session: Session }) {
  const stats = occupancy(session);

  return (
    <li className={styles.row}>
      <span className={styles.date}>{formatSessionDate(session.sessionDate)}</span>
      <Link className={styles.when} to={`/sessions/${session.id}`}>
        {formatTimeRange(session.startTime, session.durationMinutes)}
      </Link>
      <span className={styles.where}>{session.location}</span>
      <span className={styles.status} data-status={session.status}>
        {SESSION_STATUS_LABELS[session.status]}
      </span>
      <span className={styles.occupancy}>
        {describeOccupancy(stats)}
        {/* Over capacity is a deliberate admin action, not a fault — see
            `sessions.logic.ts`. It is said plainly, not styled as an error. */}
        {stats.isOverCapacity && ' (over capacity)'}
      </span>
    </li>
  );
}
