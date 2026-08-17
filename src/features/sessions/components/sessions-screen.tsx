import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../../../auth/auth-context';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { SessionListFilters } from '../../../components/session-list-filters';
import { SessionTable } from '../../../components/session-table';
import { Spinner } from '../../../components/spinner';
import { londonToday } from '../../../lib/london-time';
import { useSessions } from '../queries';
import { filterSessionsByStatus, readSessionListSelection } from '../session-list-filters.logic';
import styles from './sessions-screen.module.css';

/**
 * The session list, and **one route rendering two different screens** rather
 * than a screen per role. `API.md` §2 is explicit that an admin's planning view
 * and a team lead's shift view "are different screens" — what makes that true
 * here is not the rows, which are now the same table `Run a session` shows, but
 * what each role is offered around them: an admin gets "Add a session" and a
 * link to the weekly templates; a team lead gets neither, because creating and
 * amending sessions is not their job.
 *
 * **The status dropdown is gone, replaced by `Show completed`.** Four statuses
 * offered one at a time could not express the one thing anybody wanted — the
 * sessions still open — and made the ordinary case a choice. Ticking the box
 * brings in confirmed and cancelled sessions together, which is now the only
 * route to a cancelled one and deliberately so.
 */
export function SessionsScreen() {
  const { state } = useAuth();
  const [searchParams] = useSearchParams();

  const selection = readSessionListSelection(searchParams, londonToday());
  // Every hook above this line runs on every render, signed in or not — the
  // narrowing return below must come after the last hook call, not before it.
  const sessions = useSessions({ from: selection.from, to: selection.to });

  // Rendered inside RequireAuth via the shell; narrowing rather than asserting.
  if (state.status !== 'signed-in') return null;
  const { role } = state.user;
  const isAdmin = role === 'admin';

  const title = isAdmin ? 'Sessions' : 'Your sessions';
  const shown = filterSessionsByStatus(sessions.data ?? [], selection.showCompleted);

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
          : 'The sessions on your schedule. You can look up to six days ahead; for anything further out, ask an administrator.'}
      </p>

      <SessionListFilters />

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
        (shown.length === 0 ? (
          <EmptyState
            headline="No sessions to show"
            sentence={
              selection.showCompleted
                ? 'Nothing falls between these dates. Try widening them.'
                : 'Nothing open falls between these dates. Try widening them, or tick Show completed.'
            }
          />
        ) : (
          <SessionTable
            caption={
              selection.showCompleted
                ? 'Sessions in this date range, completed ones included'
                : 'Open sessions in this date range'
            }
            hrefFor={(session) => `/sessions/${session.id}`}
            sessions={shown}
          />
        ))}
    </>
  );
}
