import { Outlet, useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { Spinner } from '../../../components/spinner';
import { useSession } from '../../sessions/queries';
import { describeReadOnlySession, isSessionReadOnly } from '../run-session.logic';
import { RunSessionTabs } from './run-session-tabs';
import { SessionLine } from './run-sessions-screen';
import styles from './run-session-layout.module.css';

/**
 * The chrome shared by every tab of one session: which session this is, why
 * it cannot be changed if it cannot, and the way to the other four tabs.
 *
 * **No page-level heading here.** Each tab keeps the `<h1>` it already had —
 * "Pick lists", "Listener sheet", "Referral details", "Text messages", "Run a
 * session" — so this stays the smallest change to the four screens that
 * already worked, and a screen reader never meets two level-one headings on
 * one page.
 *
 * **Only `useSession`, not the pick list.** A team lead who lands directly on
 * Listener sheet or Referral details needs none of that, and every child
 * route already fetches what it needs itself — `useSessionPickList` shares
 * one TanStack Query cache across this layout, the Clients tab and the tab
 * strip, so nothing here duplicates a request.
 */
export function RunSessionLayout() {
  const { sessionId = '' } = useParams();
  const session = useSession(sessionId);

  if (session.isPending) return <Spinner label="Loading the session…" />;
  if (session.isError)
    return <ErrorNotice error={session.error} onRetry={() => void session.refetch()} />;

  const readOnly = isSessionReadOnly(session.data.status);
  const readOnlyReason = describeReadOnlySession(session.data.status);

  return (
    <>
      {/* Hidden on paper: none of the four printable tabs showed this line or
          this navigation before today, and a printed sheet gaining a stray
          date line and a row of tab labels is not the change this was. */}
      <div className={styles.screenOnly}>
        <SessionLine session={session.data} />
        {readOnlyReason !== null && (
          <p className={styles.readOnlyNotice} role="status">
            {readOnlyReason}
          </p>
        )}
        <RunSessionTabs readOnly={readOnly} sessionId={sessionId} />
      </div>
      <Outlet />
    </>
  );
}
