import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PencilIcon, TargetIcon, TrashIcon } from '../../../components/icons';
import { ResponsiveIconLabel } from '../../../components/responsive-icon-label';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useDeleteTargetStockList, useTargetStockLists, type TargetStockList } from '../queries';
import styles from './target-stock-lists-screen.module.css';

/**
 * The named target stock lists an administrator maintains — "Standard week",
 * "Christmas". A team lead may *read* the lists (the Shopping screen needs
 * them), so a team lead who reaches this URL sees the table; the `403` only
 * comes on a write — Delete here, Save on the editor — and `ErrorNotice`
 * renders it plainly. There is no role guard on the route. The Shopping screen
 * is the team-lead half of this feature.
 *
 * Delete only — a list has no retire state, and nothing else references it, so
 * there is no `409` to explain the way `model-parcels` has.
 */
export function TargetStockListsScreen() {
  const lists = useTargetStockLists();
  const remove = useDeleteTargetStockList();
  const [deleting, setDeleting] = useState<TargetStockList | null>(null);
  const [deletedName, setDeletedName] = useState<string | null>(null);
  const addLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (deletedName !== null) addLinkRef.current?.focus();
  }, [deletedName]);

  if (lists.isPending) {
    return (
      <>
        <TargetListsHeader />
        <Spinner label="Loading target stock lists…" />
      </>
    );
  }

  if (lists.isError) {
    return (
      <>
        <TargetListsHeader />
        <ErrorNotice error={lists.error} onRetry={() => void lists.refetch()} />
      </>
    );
  }

  const confirmDelete = (list: TargetStockList) => {
    remove.mutate(list.id, {
      onSuccess: () => {
        setDeleting(null);
        setDeletedName(list.name);
        // The Delete button that opened the dialog is about to unmount with its
        // row, so after ConfirmDialog has closed the effect lands on the one
        // control that is always here.
      },
      onError: () => {
        setDeleting(null);
      },
    });
  };

  return (
    <>
      <TargetListsHeader
        action={
          <Link className="button-link" ref={addLinkRef} to="/stock/target-lists/new">
            Add a target stock list
          </Link>
        }
      />

      <p aria-live="polite" className={styles.visuallyHidden} role="status">
        {deletedName !== null && `Deleted ${deletedName}.`}
      </p>

      {remove.error !== null && <ErrorNotice error={remove.error} />}

      {lists.data.length === 0 ? (
        <EmptyState
          action={
            <Link className="button-link" to="/stock/target-lists/new">
              Add a target stock list
            </Link>
          }
          headline="No target stock lists yet"
          sentence="Add one — a normal week is the usual first — then shop against it."
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Items on the list</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lists.data.map((list) => (
              <tr key={list.id}>
                <th scope="row">{list.name}</th>
                <td>{list.lines.length}</td>
                <td className={styles.actions}>
                  <Link
                    aria-label={`Amend ${list.name}`}
                    className="button-link button-plain"
                    to={`/stock/target-lists/${list.id}`}
                    title={`Amend ${list.name}`}
                  >
                    <ResponsiveIconLabel label="Edit">
                      <PencilIcon />
                    </ResponsiveIconLabel>
                  </Link>
                  <button
                    aria-label={`Delete ${list.name}`}
                    className="button-danger button-plain"
                    onClick={() => {
                      setDeleting(list);
                    }}
                    title={`Delete ${list.name}`}
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
            This cannot be undone. A shopping list already printed from it is unaffected — it was
            worked out at the time and is not stored.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function TargetListsHeader({ action }: { readonly action?: ReactNode } = {}) {
  return (
    <PageHeader
      action={action}
      description={
        <p>
          A target stock list is how many of each item the food bank wants to hold. A team lead
          picks one on the <Link to="/stock/shopping">Shopping</Link> screen and is told what to buy
          — the target less what is on hand.
        </p>
      }
      icon={<TargetIcon />}
      title="Target stock lists"
    />
  );
}
