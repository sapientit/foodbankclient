import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import * as z from 'zod';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import {
  MAX_ORGANISATION_NAME_LENGTH,
  displayMatchValue,
  findAuthorisedReferrer,
  normaliseDomainInput,
} from '../admin-setup.logic';
import { useAuthoriseReferrer, useAuthorisedReferrers, type AuthorisedReferrer } from '../queries';
import styles from './referrer-form.module.css';

/**
 * Authorise a referrer: an exact email address, or any address at a domain.
 *
 * **The domain round trip lives in `admin-setup.logic.ts`, not here.**
 * `openapi.yaml`: "`matchType: domain` accepts `*@example.org`,
 * `@example.org` or `example.org` — all stored as the bare domain." This
 * screen accepts whichever form somebody types and normalises before
 * sending; `AmendReferrerScreen` re-adds the `*@` on the way back out. Get
 * either half wrong and a round trip through this form silently edits the
 * row.
 */
const createReferrerSchema = z
  .object({
    matchType: z.enum(['email', 'domain']),
    matchValue: z.string().trim().min(1, 'Enter an email address or a domain.'),
    organisationName: z
      .string()
      .trim()
      .min(1, 'Enter the organisation this referrer belongs to.')
      .max(
        MAX_ORGANISATION_NAME_LENGTH,
        `Use ${String(MAX_ORGANISATION_NAME_LENGTH)} characters or fewer.`,
      ),
    notes: z.string().trim(),
  })
  .refine(
    (values) => values.matchType !== 'email' || z.email().safeParse(values.matchValue).success,
    { message: 'Enter a valid email address.', path: ['matchValue'] },
  )
  .refine(
    (values) => values.matchType !== 'domain' || normaliseDomainInput(values.matchValue) !== '',
    { message: 'Enter a domain — for example guildford.gov.uk.', path: ['matchValue'] },
  );

type CreateReferrerValues = z.infer<typeof createReferrerSchema>;

export function CreateReferrerScreen() {
  const navigate = useNavigate();
  const referrers = useAuthorisedReferrers();
  const authorise = useAuthoriseReferrer();

  const matchTypeId = useId();
  const matchValueId = useId();
  const matchValueErrorId = useId();
  const duplicateId = useId();
  const organisationId = useId();
  const organisationErrorId = useId();
  const notesId = useId();

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<CreateReferrerValues>({
    resolver: zodResolver(createReferrerSchema),
    defaultValues: { matchType: 'email', matchValue: '', organisationName: '', notes: '' },
  });

  const matchType = useWatch({ control, name: 'matchType' });
  const matchValue = useWatch({ control, name: 'matchValue' });
  const duplicate: AuthorisedReferrer | undefined =
    referrers.data === undefined
      ? undefined
      : findAuthorisedReferrer(referrers.data, matchType, matchValue);

  const submit = handleSubmit(async (values) => {
    if (duplicate !== undefined) return;

    const normalisedValue =
      values.matchType === 'domain'
        ? normaliseDomainInput(values.matchValue)
        : values.matchValue.trim();

    try {
      await authorise.mutateAsync({
        matchType: values.matchType,
        matchValue: normalisedValue,
        organisationName: values.organisationName,
        notes: values.notes === '' ? null : values.notes,
      });
      await navigate('/referrers');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const matchValueError = errors.matchValue?.message;
  const organisationError = errors.organisationName?.message;
  const refused = duplicate !== undefined;

  return (
    <>
      <PageHeader title="Authorise a referrer" />

      {authorise.error !== null && !isFieldFailure(authorise.error) && (
        <ErrorNotice error={authorise.error} />
      )}

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <fieldset className={styles.fieldset}>
          <legend>What does this authorise?</legend>
          <label className={styles.choice} htmlFor={`${matchTypeId}-email`}>
            <input
              {...register('matchType')}
              id={`${matchTypeId}-email`}
              type="radio"
              value="email"
            />
            <span>One exact email address</span>
          </label>
          <label className={styles.choice} htmlFor={`${matchTypeId}-domain`}>
            <input
              {...register('matchType')}
              id={`${matchTypeId}-domain`}
              type="radio"
              value="domain"
            />
            <span>Any address at a domain</span>
          </label>
        </fieldset>

        <div className={styles.field}>
          <label htmlFor={matchValueId}>
            {matchType === 'domain' ? 'Domain' : 'Email address'}
          </label>
          <p className={styles.help} id={`${matchValueId}-help`}>
            {matchType === 'domain'
              ? 'For example guildford.gov.uk, @guildford.gov.uk or *@guildford.gov.uk — they are all the same to the server, and stored as guildford.gov.uk.'
              : 'The exact address that may refer. An exact address always overrides a domain entry, in both directions.'}
          </p>
          <input
            {...register('matchValue')}
            aria-describedby={
              [
                `${matchValueId}-help`,
                matchValueError === undefined ? null : matchValueErrorId,
                refused ? duplicateId : null,
              ]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={matchValueError === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={matchValueId}
            type={matchType === 'domain' ? 'text' : 'email'}
          />
          {matchValueError !== undefined && (
            <p className={styles.fieldError} id={matchValueErrorId}>
              {matchValueError}
            </p>
          )}
          {duplicate !== undefined && (
            <p className={styles.refusal} id={duplicateId}>
              {displayMatchValue(duplicate)} is already{' '}
              {duplicate.isActive ? 'authorised' : 'on the list, but inactive'} for{' '}
              {duplicate.organisationName}.{' '}
              <Link to={`/referrers/${duplicate.id}`}>Amend that entry</Link> instead.
            </p>
          )}
        </div>

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
          <button
            aria-describedby={refused ? duplicateId : undefined}
            aria-disabled={refused}
            className={styles.submit}
            type="submit"
          >
            {isSubmitting ? 'Authorising…' : 'Authorise referrer'}
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

function applyFieldErrors(error: unknown, setError: UseFormSetError<CreateReferrerValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'matchValue' || path === 'organisationName' || path === 'notes') {
      setError(path, { message });
    }
  }
}
