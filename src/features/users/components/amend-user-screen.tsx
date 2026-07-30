import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import * as z from 'zod';
import { useAuth } from '../../../auth/auth-context';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useAmendUser, useRefreshUsers, useUser, useUsers, type Role, type User } from '../queries';
import { ROLE_OPTIONS, classifyLockoutConflict, isRole, refuseLockout } from '../users.logic';
import styles from './user-form.module.css';

/**
 * Amend a user: their name and what they may do.
 *
 * **There is no email field at all** — not a disabled one. A disabled input
 * invites "so who *can* unlock it?", and the answer is nobody: the address is how
 * every provider resolves the account and what the audit trail means by "who".
 * Static text says so, and says what to do instead.
 *
 * **`isActive` is not on this form either.** Retiring an account is a separate
 * action on the list, behind a dialog, which is what makes every `409` from this
 * form have exactly one possible cause.
 *
 * The row is read from the one cached list — there is no `GET /users/{id}` — so a
 * retired account can be opened by link, which is the whole reason the list is
 * fetched including retired.
 */
const amendUserSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter the name to show on their account.')
    .max(120, 'Use 120 characters or fewer.'),
  role: z.custom<Role>(isRole, 'Choose what this person may do.'),
});

type AmendUserValues = z.infer<typeof amendUserSchema>;

export function AmendUserScreen() {
  const { userId = '' } = useParams();

  /*
   * Two observers of one query key, so this is one request and one cache entry —
   * `useUser` is a `select` over the same list. The array is needed as well
   * because the last-active-admin refusal is a property of the whole table, not
   * of the row being edited.
   */
  const target = useUser(userId);
  const users = useUsers();

  if (target.isPending) {
    return (
      <>
        <PageHeader title="Amend a user" />
        <Spinner label="Loading the account…" />
      </>
    );
  }

  if (target.isError) {
    return (
      <>
        <PageHeader title="Amend a user" />
        <ErrorNotice
          error={target.error}
          onRetry={() => {
            void target.refetch();
          }}
        />
      </>
    );
  }

  if (target.data === null) {
    return (
      <>
        <PageHeader title="Amend a user" />
        <EmptyState
          action={<Link to="/users">Back to users</Link>}
          headline="That account is not in the list"
          sentence="The link may be out of date. Nothing has been deleted — accounts are only ever retired."
        />
      </>
    );
  }

  return <AmendUserForm user={target.data} users={users.data ?? []} />;
}

function AmendUserForm({ user, users }: { user: User; users: readonly User[] }) {
  const { state } = useAuth();
  const navigate = useNavigate();
  const amend = useAmendUser();
  const refreshUsers = useRefreshUsers();

  const nameId = useId();
  const nameErrorId = useId();
  const roleId = useId();
  const refusalId = useId();

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<AmendUserValues>({
    resolver: zodResolver(amendUserSchema),
    // Not reset on failure, so whatever they typed survives a 400.
    defaultValues: { displayName: user.displayName, role: user.role },
  });

  // `useWatch` rather than `watch()`: a subscription hook the React Compiler can
  // reason about, where the returned function is not.
  const chosenRole = useWatch({ control, name: 'role' });

  const refusal =
    state.status === 'signed-in'
      ? refuseLockout({
          users,
          actorId: state.user.id,
          target: user,
          change: { kind: 'role', role: chosenRole },
        })
      : null;

  const submit = handleSubmit(async ({ displayName, role }) => {
    if (refusal !== null) return;

    try {
      /*
       * displayName and role, and deliberately nothing else. The server's patch
       * schema is a plain object, so an `email` sent here would be **silently
       * stripped**: a 200, no change, and no symptom until somebody wonders why
       * an address never corrected itself. There is a test named after it.
       */
      await amend.mutateAsync({ id: user.id, patch: { displayName, role } });
      await navigate('/users');
    } catch (error) {
      applyFieldErrors(error, setError);

      // A lockout refusal we did not predict means this list is out of date —
      // another admin has changed something since it was fetched.
      if (error instanceof ApiError && error.status === 409) {
        if (classifyLockoutConflict(error.message) !== 'unclassified') refreshUsers();
      }
    }
  });

  const nameError = errors.displayName?.message;

  return (
    <>
      <PageHeader title={`Amend ${user.displayName}`} />

      {/* 409 and 422 are rendered verbatim by the shared notice, and nothing is
          added to them: a manufactured next step on a refusal we did not
          classify would be a guess in the one place a guess costs most. */}
      {amend.error !== null && !isFieldFailure(amend.error) && <ErrorNotice error={amend.error} />}

      <dl className={styles.static}>
        <dt>Signs in as</dt>
        <dd>{user.email}</dd>
        <dt>Status</dt>
        <dd>{user.isActive ? 'Active' : 'Retired'}</dd>
      </dl>

      <p className={styles.help}>
        An email address cannot be changed. It is how somebody signs in and how the audit trail
        identifies them, so repointing it would move one person&rsquo;s history onto another. If it
        is wrong, retire this account from the <Link to="/users">users list</Link> and add the right
        one.
      </p>

      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className={styles.field}>
          <label htmlFor={nameId}>Name</label>
          <input
            {...register('displayName')}
            aria-describedby={nameError === undefined ? undefined : nameErrorId}
            aria-invalid={nameError === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={nameId}
            type="text"
          />
          {nameError !== undefined && (
            <p className={styles.fieldError} id={nameErrorId}>
              {nameError}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={roleId}>Role</label>
          <select
            {...register('role')}
            aria-describedby={refusal === null ? undefined : refusalId}
            className={styles.input}
            id={roleId}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {refusal !== null && (
          <p className={styles.refusal} id={refusalId}>
            {refusal.reason}
          </p>
        )}

        <div className={styles.formActions}>
          {/* Refused, not removed: aria-disabled on a real focusable button, with
              the reason attached to it. */}
          <button
            aria-describedby={refusal === null ? undefined : refusalId}
            aria-disabled={refusal !== null}
            className={styles.submit}
            type="submit"
          >
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
          <Link to="/users">Cancel</Link>
        </div>
      </form>
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<AmendUserValues>): void {
  if (!(error instanceof ApiError) || error.status !== 400) return;

  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'displayName' || path === 'role') setError(path, { message });
  }
}
