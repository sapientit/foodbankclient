import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PencilIcon, TrashIcon } from '../../../components/icons';
import { PageHeader } from '../../../components/page-header';
import { ResponsiveIconLabel } from '../../../components/responsive-icon-label';
import { Spinner } from '../../../components/spinner';
import { classNames } from '../../../lib/class-names';
import { formatSessionDate } from '../../../lib/london-time';
import { listPathFor, listReturnContext, useReturnedListItem } from '../../../lib/list-return';
import {
  useDeleteRecurringSession,
  useRecurringSessions,
  useRunSessionMaterialisation,
  type RecurringSession,
} from '../queries';
import { WEEKDAY_LABELS, describeDeliveries, describeMaterialisation } from '../sessions.logic';
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
  const location = useLocation();
  const recurring = useRecurringSessions();
  const generate = useRunSessionMaterialisation();
  const remove = useDeleteRecurringSession();
  const [deleting, setDeleting] = useState<RecurringSession | null>(null);
  const [deletedName, setDeletedName] = useState<string | null>(null);
  const addLinkRef = useRef<HTMLAnchorElement>(null);
  const [returnedSessionId, returnedSessionRef] = useReturnedListItem<HTMLAnchorElement>(
    recurring.isSuccess && !recurring.isFetching,
  );

  useEffect(() => {
    if (deletedName !== null) addLinkRef.current?.focus();
  }, [deletedName]);

  const confirmDelete = (template: RecurringSession) => {
    remove.mutate(template.id, {
      onSuccess: () => {
        setDeleting(null);
        setDeletedName(template.name);
        // The Delete button vanishes with its row, so restore the keyboard to
        // the action that remains available after a successful deletion.
      },
      onError: () => {
        setDeleting(null);
      },
    });
  };

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
          <div className={styles.headerActions}>
            <Link
              className={classNames(styles.add, 'button-link')}
              ref={addLinkRef}
              to="/sessions/recurring/new"
            >
              Add a weekly session
            </Link>
          </div>
        }
      />

      <p aria-live="polite" className={styles.visuallyHidden} role="status">
        {deletedName !== null && `Deleted ${deletedName}.`}
      </p>

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
      {remove.error !== null && <ErrorNotice error={remove.error} />}

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
              <th scope="col">Deliveries</th>
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
                <td>{describeDeliveries(row)}</td>
                <td className={styles.actions}>
                  <Link
                    aria-label={`Amend ${row.name}`}
                    className="button-link button-plain"
                    ref={row.id === returnedSessionId ? returnedSessionRef : undefined}
                    state={listReturnContext(
                      listPathFor(location.pathname, location.search),
                      row.id,
                    )}
                    title={`Amend ${row.name}`}
                    to={`/sessions/recurring/${row.id}`}
                  >
                    <ResponsiveIconLabel label="Edit">
                      <PencilIcon />
                    </ResponsiveIconLabel>
                  </Link>
                  <button
                    aria-label={`Delete ${row.name}`}
                    className="button-danger button-plain"
                    onClick={() => {
                      setDeleting(row);
                    }}
                    title={`Delete ${row.name}`}
                    type="button"
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {deleting !== null && (
        <ConfirmDialog
          busy={remove.isPending}
          confirmLabel="Delete"
          destructive
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={() => {
            confirmDelete(deleting);
          }}
          title={`Delete ${deleting.name}?`}
        >
          <p>
            This stops future weekly sessions from being created. Sessions already on the calendar
            remain and can be managed individually.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
