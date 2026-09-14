import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PencilIcon, TrashIcon } from '../../../components/icons';
import { ResponsiveIconLabel } from '../../../components/responsive-icon-label';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useDeleteModelParcel, useModelParcels, type ModelParcel } from '../queries';
import styles from './model-parcels-screen.module.css';

/**
 * The named picking lists: what is in a "Family parcel", what is in a
 * "Single parcel". Admin only — **there is no role guard on this route**, so a
 * team lead who types the URL makes the real request and gets a real `403`,
 * rendered by `ErrorNotice`. See `require-auth.tsx` and the users screens for
 * the same shape.
 *
 * There is no retire/reactivate toggle here the way stock items and users
 * have one: a model parcel has no `isActive` field, only delete — refused by
 * the server with `409` while the household grid still names it.
 */
export function ModelParcelsScreen() {
  const parcels = useModelParcels();
  const remove = useDeleteModelParcel();
  const [deleting, setDeleting] = useState<ModelParcel | null>(null);
  const [deletedName, setDeletedName] = useState<string | null>(null);
  const addLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (deletedName !== null) addLinkRef.current?.focus();
  }, [deletedName]);

  if (parcels.isPending) {
    return (
      <>
        <PageHeader title="Model parcels" />
        <Spinner label="Loading model parcels…" />
      </>
    );
  }

  if (parcels.isError) {
    return (
      <>
        <PageHeader title="Model parcels" />
        <ErrorNotice error={parcels.error} onRetry={() => void parcels.refetch()} />
      </>
    );
  }

  const confirmDelete = (parcel: ModelParcel) => {
    remove.mutate(parcel.id, {
      onSuccess: () => {
        setDeleting(null);
        setDeletedName(parcel.name);
        // The effect runs after ConfirmDialog has closed and finished its own
        // focus restoration, so the dead Delete opener cannot steal focus back.
      },
      onError: () => {
        // Left open so the ConfirmDialog's caller can still see the notice
        // below explaining why — most often that the grid still uses it.
        setDeleting(null);
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Model parcels"
        action={
          <>
            <Link className="button-link" ref={addLinkRef} to="/model-parcels/new">
              Add a model parcel
            </Link>
            <Link className={styles.gridLink} to="/model-parcels/grid">
              Edit the household grid
            </Link>
          </>
        }
      />

      <p className={styles.intro}>
        A model parcel is a named list of stock items and quantities. The household grid decides
        which model parcel a household of a given size receives; this list is what that grid can
        point at.
      </p>

      <p aria-live="polite" className={styles.visuallyHidden} role="status">
        {deletedName !== null && `Deleted ${deletedName}.`}
      </p>

      {remove.error !== null && <ErrorNotice error={remove.error} />}

      {parcels.data.length === 0 ? (
        <EmptyState
          action={
            <Link className="button-link" to="/model-parcels/new">
              Add a model parcel
            </Link>
          }
          headline="No model parcels yet"
          sentence="Add the first one, then use it on the household grid."
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Description</th>
              <th scope="col">Items</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {parcels.data.map((parcel) => (
              <tr key={parcel.id}>
                <th scope="row">{parcel.name}</th>
                <td className={styles.description}>{parcel.description ?? ''}</td>
                <td>{parcel.contents.length}</td>
                <td className={styles.actions}>
                  <Link
                    aria-label={`Amend ${parcel.name}`}
                    className="button-link button-plain"
                    to={`/model-parcels/${parcel.id}`}
                    title={`Amend ${parcel.name}`}
                  >
                    <ResponsiveIconLabel label="Edit">
                      <PencilIcon />
                    </ResponsiveIconLabel>
                  </Link>
                  <button
                    aria-label={`Delete ${parcel.name}`}
                    className="button-danger button-plain"
                    onClick={() => {
                      setDeleting(parcel);
                    }}
                    title={`Delete ${parcel.name}`}
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
          <p>This cannot be undone. Contents already copied onto a pick list are unaffected.</p>
          <p>
            If the household grid still names this parcel anywhere, the food bank does not know what
            to give that household size any more — the server will refuse the delete rather than
            leave a cell pointing at nothing.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
