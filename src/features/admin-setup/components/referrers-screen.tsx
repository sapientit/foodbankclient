import { useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { blockedActiveDomain, displayMatchValue } from '../admin-setup.logic';
import {
  useAmendAuthorisedReferrer,
  useAuthorisedReferrers,
  type AuthorisedReferrer,
} from '../queries';
import styles from './referrers-screen.module.css';

/**
 * Who may refer. Admin only — and, as everywhere else in this app, **no
 * route is role-guarded**: a team lead who types this URL makes the real
 * request and gets a real `403`, rendered by `ErrorNotice`.
 *
 * **Every row is always shown. There is no "show inactive" toggle**, unlike
 * `UsersScreen` and `StockItemsScreen`. `openapi.yaml` says it in terms —
 * "Never filter these out" — because an inactive exact-address row is not
 * dead data sitting beside an unrelated active one: it is what blocks that
 * one address while an active domain entry keeps authorising everyone else
 * at it. Hiding it by default would hide the very row that is doing
 * something. `blockedActiveDomain` is what makes that visible in the row
 * itself rather than left for an admin to notice by cross-referencing the
 * table.
 */
export function ReferrersScreen() {
  const referrers = useAuthorisedReferrers();
  const amend = useAmendAuthorisedReferrer();
  const [deactivating, setDeactivating] = useState<AuthorisedReferrer | null>(null);

  if (referrers.isPending) {
    return (
      <>
        <PageHeader title="Authorised referrers" />
        <Spinner label="Loading authorised referrers…" />
      </>
    );
  }

  if (referrers.isError) {
    return (
      <>
        <PageHeader title="Authorised referrers" />
        <ErrorNotice error={referrers.error} onRetry={() => void referrers.refetch()} />
      </>
    );
  }

  const setActive = (referrer: AuthorisedReferrer, isActive: boolean) => {
    amend.mutate(
      { id: referrer.id, patch: { isActive } },
      {
        onSuccess: () => {
          setDeactivating(null);
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Authorised referrers"
        action={
          <Link className={styles.add} to="/referrers/new">
            Authorise a referrer
          </Link>
        }
      />

      <p className={styles.intro}>
        Whoever submits a referral must give an email address on this list — either their exact
        address, or any address at an authorised domain. An exact address always overrides a domain,
        in both directions: deactivating one address blocks that person even while their domain
        stays authorised for everyone else.
      </p>

      {amend.error !== null && <ErrorNotice error={amend.error} />}

      {referrers.data.length === 0 ? (
        <EmptyState
          action={<Link to="/referrers/new">Authorise a referrer</Link>}
          headline="No authorised referrers yet"
          sentence="Nobody can submit a referral until at least one address or domain is authorised."
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Organisation</th>
              <th scope="col">Authorises</th>
              <th scope="col">Status</th>
              <th scope="col">Notes</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {referrers.data.map((row) => {
              const blockedDomain = blockedActiveDomain(referrers.data, row);

              return (
                <tr key={row.id}>
                  <th scope="row">{row.organisationName}</th>
                  <td>
                    {displayMatchValue(row)}
                    {blockedDomain !== null && (
                      <span className={styles.blocks}>
                        Blocks only this address — *@{blockedDomain} is still authorised for
                        everyone else.
                      </span>
                    )}
                  </td>
                  <td>{row.isActive ? 'Active' : 'Inactive'}</td>
                  <td className={styles.notes}>{row.notes ?? ''}</td>
                  <td className={styles.actions}>
                    <Link to={`/referrers/${row.id}`}>Amend</Link>
                    {row.isActive ? (
                      <button
                        onClick={() => {
                          setDeactivating(row);
                        }}
                        type="button"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setActive(row, true);
                        }}
                        type="button"
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {deactivating !== null && (
        <ConfirmDialog
          busy={amend.isPending}
          confirmLabel="Deactivate"
          onCancel={() => {
            setDeactivating(null);
          }}
          onConfirm={() => {
            setActive(deactivating, false);
          }}
          title={`Deactivate ${displayMatchValue(deactivating)}?`}
        >
          {deactivating.matchType === 'email' ? (
            <p>
              This blocks referrals from this address specifically, even if its domain is
              authorised. You can reactivate it at any time.
            </p>
          ) : (
            <p>
              This stops anyone at this domain referring, unless an individual address there is
              separately authorised. You can reactivate it at any time.
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
