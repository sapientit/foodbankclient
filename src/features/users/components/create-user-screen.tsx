import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import * as z from 'zod';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useCreateUser, useUsers, type Role } from '../queries';
import { ROLE_OPTIONS, findUserByEmail, isRole } from '../users.logic';
import styles from './user-form.module.css';

/**
 * Add a user. The only way an account comes into existence — signing in never
 * creates one.
 *
 * Every field is named exactly as its API body key, so a `400`'s dot-joined
 * `details.issues[].path` maps onto `setError` with no translation table. See
 * `issuesToFieldErrors`.
 */
const createUserSchema = z.object({
  email: z
    .email('Enter the email address they will sign in with.')
    .max(254, 'That address is too long.'),
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter the name to show on their account.')
    .max(120, 'Use 120 characters or fewer.'),
  role: z.custom<Role>(isRole, 'Choose what this person may do.'),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

export function CreateUserScreen() {
  const navigate = useNavigate();
  const users = useUsers();
  const create = useCreateUser();

  const emailId = useId();
  const emailErrorId = useId();
  const nameId = useId();
  const nameErrorId = useId();
  const roleId = useId();
  const duplicateId = useId();

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', displayName: '', role: 'team_lead' },
  });

  /*
   * Watched, so the answer arrives as they finish typing the address rather than
   * after they have filled in the rest of the form and pressed Save. One field,
   * and it is the field that decides whether this screen is the right one at all.
   *
   * A cached match is trustworthy here in a way it usually is not: there is no
   * delete and email is not amendable, so a row that matches cannot have stopped
   * matching, and the server's 409 is guaranteed.
   */
  const email = useWatch({ control, name: 'email' });
  const duplicate = users.data === undefined ? undefined : findUserByEmail(users.data, email);

  const submit = handleSubmit(async (values) => {
    if (duplicate !== undefined) return;

    try {
      await create.mutateAsync(values);
      await navigate('/users');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const emailError = errors.email?.message;
  const nameError = errors.displayName?.message;
  const refused = duplicate !== undefined;

  return (
    <>
      <PageHeader title="Add a user" />

      {/* A 400 has already been turned into field errors, so showing the notice
          as well would say the same thing twice, further from the input. */}
      {create.error !== null && !isFieldFailure(create.error) && (
        <ErrorNotice error={create.error} />
      )}

      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className={styles.field}>
          <label htmlFor={emailId}>Email address</label>
          <p className={styles.help} id={`${emailId}-help`}>
            The address they will sign in with. It is stored lowercased, and it cannot be changed
            afterwards.
          </p>
          <input
            {...register('email')}
            aria-describedby={
              [
                `${emailId}-help`,
                emailError === undefined ? null : emailErrorId,
                refused ? duplicateId : null,
              ]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={emailError === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={emailId}
            type="email"
          />
          {emailError !== undefined && (
            <p className={styles.fieldError} id={emailErrorId}>
              {emailError}
            </p>
          )}

          {duplicate !== undefined && (
            <p className={styles.refusal} id={duplicateId}>
              {duplicate.isActive ? (
                <>
                  {duplicate.displayName} already signs in with that address.{' '}
                  <Link to={`/users/${duplicate.id}`}>Amend their account</Link> instead.
                </>
              ) : (
                /*
                 * The dead end the server's 409 would otherwise leave an admin
                 * in: "already exists", for an account they cannot see and
                 * cannot delete. Reactivating is the only way through, and it is
                 * also the right one — the history is already theirs.
                 */
                <>
                  {duplicate.displayName} used that address and their account is retired. Reactivate
                  it rather than adding a new one:{' '}
                  <Link to="/users?retired=1">show retired accounts</Link>.
                </>
              )}
            </p>
          )}
        </div>

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
          <p className={styles.help} id={`${roleId}-help`}>
            A team lead runs sessions and does the stock work. An administrator can also change
            sessions, referrals, users and why someone was referred.
          </p>
          <select
            {...register('role')}
            aria-describedby={`${roleId}-help`}
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

        <div className={styles.formActions}>
          <button
            aria-describedby={refused ? duplicateId : undefined}
            aria-disabled={refused}
            className={styles.submit}
            type="submit"
          >
            {isSubmitting ? 'Adding…' : 'Add user'}
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

/**
 * A `400` names the field and the rule and never echoes the value, so the user's
 * own text is left exactly where they typed it — the form is never reset on
 * failure.
 */
function applyFieldErrors(error: unknown, setError: UseFormSetError<CreateUserValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;

  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'email' || path === 'displayName' || path === 'role') {
      setError(path, { message });
    }
  }
}
