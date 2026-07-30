import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../../../auth/auth-context';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError } from '../../../lib/errors';
import { formatLondonDate, formatLondonDateTime } from '../../../lib/london-time';
import { useAmendUser, useRefreshUsers, useUsers, type User } from '../queries';
import { ROLE_LABELS, classifyLockoutConflict, refuseLockout, splitByStatus } from '../users.logic';
import styles from './users-screen.module.css';

/**
 * Who may sign in, and as what. Admin only — and only because the server says
 * so: **there is no role guard on this route.** A team lead who types the URL
 * makes the request and gets a real `403`, rendered by the shared notice. The
 * server's check on the signed token is the only one that means anything, and a
 * client-side gate would merely hide the link from somebody who had already
 * edited their way past it.
 */

/** `?retired=1`. In the URL so the create screen can link straight to a retired row. */
const RETIRED_PARAM = 'retired';

export function UsersScreen() {
  const { state } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const users = useUsers();
  const amend = useAmendUser();
  const refreshUsers = useRefreshUsers();
  const [deactivating, setDeactivating] = useState<User | null>(null);
  const reasonBaseId = useId();

  // Rendered inside the shell, which renders inside RequireAuth. Narrowing
  // rather than asserting; see AppShell.
  if (state.status !== 'signed-in') return null;
  const actorId = state.user.id;

  if (users.isPending) {
    return (
      <>
        <PageHeader title="Users" />
        <Spinner label="Loading users…" />
      </>
    );
  }

  if (users.isError) {
    return (
      <>
        <PageHeader title="Users" />
        <ErrorNotice
          error={users.error}
          onRetry={() => {
            void users.refetch();
          }}
        />
      </>
    );
  }

  const showRetired = searchParams.get(RETIRED_PARAM) === '1';
  const { active, retired } = splitByStatus(users.data);
  const visible = showRetired ? [...active, ...retired] : active;

  const change = (target: User, isActive: boolean) => {
    amend.mutate(
      { id: target.id, patch: { isActive } },
      {
        onSuccess: () => {
          setDeactivating(null);
        },
        onError: (error) => {
          // A lockout refusal we did not predict is proof our copy of who can
          // administer the food bank is out of date. Refetching is the only
          // useful thing to do about it; the message itself is shown verbatim.
          if (error instanceof ApiError && error.status === 409) {
            if (classifyLockoutConflict(error.message) !== 'unclassified') refreshUsers();
          }
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Users"
        action={
          <Link className={styles.add} to="/users/new">
            Add a user
          </Link>
        }
      />

      <p className={styles.intro}>
        Adding an account here is the only way somebody can sign in. There is no way to delete one:
        retiring an account stops it working while keeping the person named on the stock, attendance
        and audit records they are part of.
      </p>

      {amend.error !== null && <ErrorNotice error={amend.error} />}

      <p>
        <label className={styles.toggle}>
          <input
            checked={showRetired}
            onChange={(event) => {
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  if (event.target.checked) next.set(RETIRED_PARAM, '1');
                  else next.delete(RETIRED_PARAM);
                  return next;
                },
                // A checkbox must not fill the back button with its own history.
                { replace: true },
              );
            }}
            type="checkbox"
          />
          {/* The count is what makes hiding them honest: "3 hidden" is a fact
              somebody can act on, an unlabelled checkbox is not. */}
          Show retired accounts ({retired.length})
        </label>
      </p>

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Last signed in</th>
            <th scope="col">Added</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const refusal = refuseLockout({
              users: users.data,
              actorId,
              target: row,
              change: { kind: 'deactivate' },
            });
            const reasonId = `${reasonBaseId}-${row.id}`;

            return (
              <tr key={row.id}>
                <th scope="row">
                  {row.displayName}
                  {row.id === actorId && <span className={styles.you}> (you)</span>}
                </th>
                {/* Plain text, not a mailto: this is a login identity, and one
                    mis-tap in a hall opening a mail client is no help to anyone. */}
                <td>{row.email}</td>
                <td>{ROLE_LABELS[row.role]}</td>
                {/* In words. Colour alone would say nothing to a colour-blind
                    volunteer, and a strikethrough would say "deleted" — the
                    person is still named on everything they did. */}
                <td>{row.isActive ? 'Active' : 'Retired'}</td>
                <td>
                  {row.lastLoginAt === null ? (
                    /* Never blank. An account nobody has ever signed in with is
                       usually one created with a typo in the address, and this
                       column plus "Added" is how that gets spotted. It means
                       last fresh sign-in, not last active — a refresh does not
                       touch it — so no copy here may imply presence. */
                    <span className={styles.never}>Never signed in</span>
                  ) : (
                    formatLondonDateTime(row.lastLoginAt)
                  )}
                </td>
                <td>{formatLondonDate(row.createdAt)}</td>
                <td className={styles.actions}>
                  <Link to={`/users/${row.id}`}>Amend</Link>

                  {row.isActive ? (
                    <>
                      {/* aria-disabled on a real focusable button, never a
                          removed control: somebody looking for Deactivate has to
                          be able to find it and be told why not. */}
                      <button
                        aria-describedby={refusal === null ? undefined : reasonId}
                        aria-disabled={refusal !== null}
                        onClick={() => {
                          if (refusal !== null) return;
                          setDeactivating(row);
                        }}
                        type="button"
                      >
                        Deactivate
                      </button>
                      {refusal !== null && (
                        <p className={styles.reason} id={reasonId}>
                          {refusal.reason}
                        </p>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        change(row, true);
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

      {deactivating !== null && (
        <ConfirmDialog
          busy={amend.isPending}
          confirmLabel="Deactivate"
          onCancel={() => {
            setDeactivating(null);
          }}
          onConfirm={() => {
            change(deactivating, false);
          }}
          title={`Deactivate ${deactivating.displayName}?`}
        >
          {/*
           * The truth about the delay, because the person reading this is the
           * only one who can plan around it. "May take a few minutes" would be a
           * lie an admin could act on — they would close the laptop believing
           * somebody was locked out.
           */}
          <p>They will not be able to sign in again.</p>
          <p>
            If they are signed in right now they can keep working for up to fifteen minutes, and
            there is no way to end that session sooner. If that matters, ring them.
          </p>
          <p>
            Nothing is deleted. {deactivating.displayName} stays named on the stock, attendance and
            audit records they are part of, and you can reactivate the account at any time.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
