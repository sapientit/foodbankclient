import { Link } from 'react-router';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate } from '../../../lib/london-time';
import { useRecurringSessions, useRunSessionMaterialisation } from '../queries';
import { WEEKDAY_LABELS, describeMaterialisation } from '../sessions.logic';
import styles from './recurring-sessions-screen.module.css';

/**
 * The weekly templates a session is generated from. Admin only via the menu —
 * `/sessions/recurring/new` and `/sessions/recurring/:id` are where a session
 * that repeats every week gets set up, and this list is what a fortnight of ad
 * hoc "add a session" clicks would otherwise be standing in for.
 *
 * Amending a template here **does not retrospectively change sessions already
 * generated** — the server's `CLAUDE.md` and `API.md` §4 both say so — so this
 * screen never invalidates the sessions list; see `queries.ts`.
 */
export function RecurringSessionsScreen() {
  const recurring = useRecurringSessions();
  const generate = useRunSessionMaterialisation();

  if (recurring.isPending) {
    return (
      <>
        <PageHeader title="Weekly sessions" />
        <Spinner label="Loading weekly sessions…" />
      </>
    );
  }

  if (recurring.isError) {
    return (
      <>
        <PageHeader title="Weekly sessions" />
        <ErrorNotice
          error={recurring.error}
          onRetry={() => {
            void recurring.refetch();
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Weekly sessions"
        action={
          <Link className={styles.add} to="/sessions/recurring/new">
            Add a weekly session
          </Link>
        }
      />

      <p className={styles.intro}>
        Every Monday session, every Thursday session, and so on. A template does not create anything
        by itself: an overnight job turns the templates into actual sessions up to six weeks ahead,
        and “Generate sessions now” does the same thing immediately. Changing a template does not
        change any session already generated from it.
      </p>

      {/*
       * The one control that closes the gap between adding a template and seeing
       * a session. Without it the sessions list simply does not change after
       * adding a weekly session, and nothing on screen says why.
       *
       * A plain `disabled` is enough here, unlike the shop's save: the job is
       * idempotent, so the worst a double click can do is create nothing twice.
       */}
      <div className={styles.tools}>
        <button
          className={styles.generate}
          disabled={generate.isPending}
          onClick={() => {
            generate.mutate();
          }}
          type="button"
        >
          {generate.isPending ? 'Generating…' : 'Generate sessions now'}
        </button>

        {/* Announced, because the outcome is the whole point of pressing it and
            a sighted user gets it as a visible change three lines away. */}
        <p className={styles.result} role="status">
          {generate.isSuccess ? describeMaterialisation(generate.data) : ''}
        </p>
      </div>

      {generate.error !== null && <ErrorNotice error={generate.error} />}

      {recurring.data.length === 0 ? (
        <EmptyState
          headline="No weekly sessions yet"
          sentence="Add one to start generating sessions automatically, or use “Add a session” for a one-off."
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Day</th>
              <th scope="col">Time</th>
              <th scope="col">Location</th>
              <th className={styles.numeric} scope="col">
                Capacity
              </th>
              <th scope="col">Active</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {recurring.data.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.name}</th>
                <td>{WEEKDAY_LABELS[row.weekday] ?? row.weekday}</td>
                <td>{row.startTime}</td>
                <td>{row.location}</td>
                <td className={styles.numeric}>{row.capacity}</td>
                <td>
                  From {formatSessionDate(row.activeFrom)}
                  {row.activeUntil !== null && <> to {formatSessionDate(row.activeUntil)}</>}
                </td>
                <td>
                  <Link to={`/sessions/recurring/${row.id}`}>Amend</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
