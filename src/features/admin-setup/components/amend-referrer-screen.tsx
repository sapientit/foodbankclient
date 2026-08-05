import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import * as z from 'zod';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { MAX_ORGANISATION_NAME_LENGTH, displayMatchValue } from '../admin-setup.logic';
import {
  useAmendAuthorisedReferrer,
  useAuthorisedReferrer,
  type AuthorisedReferrer,
} from '../queries';
import styles from './referrer-form.module.css';

/**
 * Amend a referrer: its organisation and its notes.
 *
 * **There is no `matchType` or `matchValue` field on this form at all** —
 * `openapi.yaml`'s patch schema names only `organisationName`, `notes` and
 * `isActive`, so what a referrer matches cannot be edited, only replaced by
 * authorising a new one. **`isActive` is not here either** — deactivating
 * and reactivating stay actions on the list, the same split
 * `AmendUserScreen` uses, so a `409` from this form has exactly one
 * possible cause.
 *
 * The row is read from the one cached list — there is no
 * `GET /authorised-referrers/{id}` — so it is a projection the same way
 * `useUser` and `useModelParcel` are.
 */
const amendReferrerSchema = z.object({
  organisationName: z
    .string()
    .trim()
    .min(1, 'Enter the organisation this referrer belongs to.')
    .max(
      MAX_ORGANISATION_NAME_LENGTH,
      `Use ${String(MAX_ORGANISATION_NAME_LENGTH)} characters or fewer.`,
    ),
  notes: z.string().trim(),
});

type AmendReferrerValues = z.infer<typeof amendReferrerSchema>;

export function AmendReferrerScreen() {
  const { referrerId = '' } = useParams();
  const target = useAuthorisedReferrer(referrerId);

  if (target.isPending) {
    return (
      <>
        <PageHeader title="Amend a referrer" />
        <Spinner label="Loading the referrer…" />
      </>
    );
  }

  if (target.isError) {
    return (
      <>
        <PageHeader title="Amend a referrer" />
        <ErrorNotice error={target.error} onRetry={() => void target.refetch()} />
      </>
    );
  }

  if (target.data === null) {
    return (
      <>
        <PageHeader title="Amend a referrer" />
        <EmptyState
          action={<Link to="/referrers">Back to authorised referrers</Link>}
          headline="That referrer is not in the list"
          sentence="The link may be out of date."
        />
      </>
    );
  }

  return <AmendReferrerForm referrer={target.data} />;
}

function AmendReferrerForm({ referrer }: { referrer: AuthorisedReferrer }) {
  const navigate = useNavigate();
  const amend = useAmendAuthorisedReferrer();

  const organisationId = useId();
  const organisationErrorId = useId();
  const notesId = useId();

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<AmendReferrerValues>({
    resolver: zodResolver(amendReferrerSchema),
    defaultValues: { organisationName: referrer.organisationName, notes: referrer.notes ?? '' },
  });

  const submit = handleSubmit(async (values) => {
    try {
      // Deliberately no `isActive` — see the module comment.
      await amend.mutateAsync({
        id: referrer.id,
        patch: {
          organisationName: values.organisationName,
          notes: values.notes === '' ? null : values.notes,
        },
      });
      await navigate('/referrers');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const organisationError = errors.organisationName?.message;

  return (
    <>
      <PageHeader title={`Amend ${referrer.organisationName}`} />

      {amend.error !== null && !isFieldFailure(amend.error) && <ErrorNotice error={amend.error} />}

      <dl className={styles.static}>
        <dt>Authorises</dt>
        <dd>{displayMatchValue(referrer)}</dd>
        <dt>Status</dt>
        <dd>{referrer.isActive ? 'Active' : 'Inactive'}</dd>
      </dl>

      <p className={styles.help}>
        What this entry matches cannot be changed here. To authorise a different address or domain,
        add it from the <Link to="/referrers">authorised referrers list</Link>. Deactivating or
        reactivating this one is also done from that list.
      </p>

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={organisationId}>Organisation</label>
          <input
            {...register('organisationName')}
            aria-describedby={organisationError === undefined ? undefined : organisationErrorId}
            aria-invalid={organisationError === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={organisationId}
            type="text"
          />
          {organisationError !== undefined && (
            <p className={styles.fieldError} id={organisationErrorId}>
              {organisationError}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={notesId}>Notes (optional)</label>
          <textarea {...register('notes')} className={styles.textarea} id={notesId} rows={3} />
        </div>

        <div className={styles.formActions}>
          <button className={styles.submit} type="submit">
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
          <Link to="/referrers">Cancel</Link>
        </div>
      </form>
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<AmendReferrerValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'organisationName' || path === 'notes') setError(path, { message });
  }
}
