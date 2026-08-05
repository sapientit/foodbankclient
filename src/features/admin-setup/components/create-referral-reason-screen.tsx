import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import * as z from 'zod';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import {
  MAX_REASON_CODE_LENGTH,
  MAX_REASON_LABEL_LENGTH,
  REASON_CODE_PATTERN,
  findReferralReasonByCode,
  parseDisplayOrder,
} from '../admin-setup.logic';
import { useCreateReferralReason, useReferralReasons } from '../queries';
import styles from './reason-form.module.css';

/**
 * Add a reason for referral.
 *
 * **`code` is settable here and nowhere else.** `openapi.yaml`: "`code` is
 * the stable reporting key and is never renamed." It has no `PATCH`
 * counterpart at all — `AmendReferralReasonScreen`'s form has no field for
 * it, the same way a model parcel's name is only ever set on create.
 */
const createReasonSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter a code.')
    .max(MAX_REASON_CODE_LENGTH, `Use ${String(MAX_REASON_CODE_LENGTH)} characters or fewer.`)
    .regex(REASON_CODE_PATTERN, 'Use lowercase letters, numbers and underscores only.'),
  label: z
    .string()
    .trim()
    .min(1, 'Enter the label a referrer will see.')
    .max(MAX_REASON_LABEL_LENGTH, `Use ${String(MAX_REASON_LABEL_LENGTH)} characters or fewer.`),
  displayOrder: z
    .string()
    .refine((text) => parseDisplayOrder(text).ok, { message: 'Enter a whole number.' }),
});

type CreateReasonValues = z.infer<typeof createReasonSchema>;

export function CreateReferralReasonScreen() {
  const navigate = useNavigate();
  const reasons = useReferralReasons();
  const create = useCreateReferralReason();

  const codeId = useId();
  const codeErrorId = useId();
  const duplicateId = useId();
  const labelId = useId();
  const labelErrorId = useId();
  const displayOrderId = useId();
  const displayOrderErrorId = useId();

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<CreateReasonValues>({
    resolver: zodResolver(createReasonSchema),
    defaultValues: { code: '', label: '', displayOrder: '0' },
  });

  const code = useWatch({ control, name: 'code' });
  const duplicate =
    reasons.data === undefined ? undefined : findReferralReasonByCode(reasons.data, code);

  const submit = handleSubmit(async (values) => {
    if (duplicate !== undefined) return;

    // The resolver's `refine` already proved this parses; re-parsing here
    // rather than trusting a cast is what keeps `parseDisplayOrder` the one
    // place that can be wrong.
    const parsedOrder = parseDisplayOrder(values.displayOrder);
    if (!parsedOrder.ok) return;

    try {
      await create.mutateAsync({
        code: values.code,
        label: values.label,
        displayOrder: parsedOrder.value,
      });
      await navigate('/referral-reasons');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const codeError = errors.code?.message;
  const labelError = errors.label?.message;
  const displayOrderError = errors.displayOrder?.message;
  const refused = duplicate !== undefined;

  return (
    <>
      <PageHeader title="Add a reason for referral" />

      {create.error !== null && !isFieldFailure(create.error) && (
        <ErrorNotice error={create.error} />
      )}

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={codeId}>Code</label>
          <p className={styles.help} id={`${codeId}-help`}>
            Lowercase letters, numbers and underscores only. This cannot be changed once saved — it
            is what every referral that uses this reason is stored against.
          </p>
          <input
            {...register('code')}
            aria-describedby={
              [
                `${codeId}-help`,
                codeError === undefined ? null : codeErrorId,
                refused ? duplicateId : null,
              ]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={codeError === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={codeId}
            type="text"
          />
          {codeError !== undefined && (
            <p className={styles.fieldError} id={codeErrorId}>
              {codeError}
            </p>
          )}
          {duplicate !== undefined && (
            <p className={styles.refusal} id={duplicateId}>
              “{duplicate.code}” already exists ({duplicate.label}).{' '}
              <Link to={`/referral-reasons/${duplicate.id}`}>Amend that reason</Link> instead.
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={labelId}>Label</label>
          <p className={styles.help} id={`${labelId}-help`}>
            What a referrer sees on the dropdown.
          </p>
          <input
            {...register('label')}
            aria-describedby={labelError === undefined ? undefined : labelErrorId}
            aria-invalid={labelError === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={labelId}
            type="text"
          />
          {labelError !== undefined && (
            <p className={styles.fieldError} id={labelErrorId}>
              {labelError}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={displayOrderId}>Display order</label>
          <p className={styles.help} id={`${displayOrderId}-help`}>
            Lower numbers appear first on the dropdown. Reasons sharing a number are ordered by
            label.
          </p>
          <input
            {...register('displayOrder')}
            aria-describedby={displayOrderError === undefined ? undefined : displayOrderErrorId}
            aria-invalid={displayOrderError === undefined ? undefined : true}
            className={styles.input}
            id={displayOrderId}
            inputMode="numeric"
            type="text"
          />
          {displayOrderError !== undefined && (
            <p className={styles.fieldError} id={displayOrderErrorId}>
              {displayOrderError}
            </p>
          )}
        </div>

        <div className={styles.formActions}>
          <button
            aria-describedby={refused ? duplicateId : undefined}
            aria-disabled={refused}
            className={styles.submit}
            type="submit"
          >
            {isSubmitting ? 'Adding…' : 'Add reason'}
          </button>
          <Link to="/referral-reasons">Cancel</Link>
        </div>
      </form>
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<CreateReasonValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'code' || path === 'label' || path === 'displayOrder') {
      setError(path, { message });
    }
  }
}
