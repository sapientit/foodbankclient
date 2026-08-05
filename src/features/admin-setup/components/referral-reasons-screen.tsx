import { useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useAmendReferralReason, useReferralReasons, type AdminReferralReason } from '../queries';
import styles from './referral-reasons-screen.module.css';

/**
 * The reason-for-referral dropdown, admin-maintained. Admin only, and — as
 * everywhere else — **no route is role-guarded**: a team lead who types this
 * URL makes the real request and gets a real `403`.
 *
 * **Every reason is always shown, retired included.** `openapi.yaml`:
 * retiring "stops offering it without breaking historical referrals that
 * used it" — the reason stays real, it just stops appearing on
 * `GET /public/referral-reasons`. A "show retired" toggle that defaults to
 * hidden would make a retired row read as gone, which is exactly the
 * impression this endpoint's own description is written to avoid.
 */
export function ReferralReasonsScreen() {
  const reasons = useReferralReasons();
  const amend = useAmendReferralReason();
  const [retiring, setRetiring] = useState<AdminReferralReason | null>(null);

  if (reasons.isPending) {
    return (
      <>
        <PageHeader title="Reasons for referral" />
        <Spinner label="Loading reasons for referral…" />
      </>
    );
  }

  if (reasons.isError) {
    return (
      <>
        <PageHeader title="Reasons for referral" />
        <ErrorNotice error={reasons.error} onRetry={() => void reasons.refetch()} />
      </>
    );
  }

  const setActive = (reason: AdminReferralReason, isActive: boolean) => {
    amend.mutate(
      { id: reason.id, patch: { isActive } },
      {
        onSuccess: () => {
          setRetiring(null);
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Reasons for referral"
        action={
          <Link className={styles.add} to="/referral-reasons/new">
            Add a reason
          </Link>
        }
      />

      <p className={styles.intro}>
        The options a referrer chooses from when they say why a household needs food. Only
        administrators ever see which reason a referral used — see{' '}
        <Link to="/referrals">referrals</Link>.
      </p>

      {amend.error !== null && <ErrorNotice error={amend.error} />}

      {reasons.data.length === 0 ? (
        <EmptyState
          action={<Link to="/referral-reasons/new">Add a reason</Link>}
          headline="No reasons yet"
          sentence="Add the first one before anyone can submit a referral."
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Code</th>
              <th scope="col">Order</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reasons.data.map((reason) => (
              <tr key={reason.id}>
                <th scope="row">{reason.label}</th>
                <td className={styles.code}>{reason.code}</td>
                <td className={styles.numeric}>{reason.displayOrder}</td>
                <td>{reason.isActive ? 'Active' : 'Retired'}</td>
                <td className={styles.actions}>
                  <Link to={`/referral-reasons/${reason.id}`}>Amend</Link>
                  {reason.isActive ? (
                    <button
                      onClick={() => {
                        setRetiring(reason);
                      }}
                      type="button"
                    >
                      Retire
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setActive(reason, true);
                      }}
                      type="button"
                    >
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {retiring !== null && (
        <ConfirmDialog
          busy={amend.isPending}
          confirmLabel="Retire"
          onCancel={() => {
            setRetiring(null);
          }}
          onConfirm={() => {
            setActive(retiring, false);
          }}
          title={`Retire ${retiring.label}?`}
        >
          <p>
            It stops appearing on the referral form, but every past referral that used it keeps
            showing “{retiring.label}”. You can restore it at any time.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
