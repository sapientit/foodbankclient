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
import { MAX_REASON_LABEL_LENGTH, parseDisplayOrder } from '../admin-setup.logic';
import { useAmendReferralReason, useReferralReason, type AdminReferralReason } from '../queries';
import styles from './reason-form.module.css';

/**
 * Amend a reason for referral: its label and its display order.
 *
 * **There is no `code` field on this form at all.** `openapi.yaml`: "`code`
 * is the stable reporting key and is never renamed" — the amend `PATCH`
 * body type generated from the contract has no `code` property, so there is
 * nothing to accidentally wire up. **`isActive` is not here either** —
 * retiring and restoring stay actions on the list, behind a confirmation,
 * the same split `AmendUserScreen` and `AmendReferrerScreen` use.
 *
 * The row is read from the one cached list — there is no
 * `GET /referral-reasons/{id}` — so a retired reason can still be opened by
 * link, the same way a retired user account can.
 */
const amendReasonSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Enter the label a referrer will see.')
    .max(MAX_REASON_LABEL_LENGTH, `Use ${String(MAX_REASON_LABEL_LENGTH)} characters or fewer.`),
  displayOrder: z
    .string()
    .refine((text) => parseDisplayOrder(text).ok, { message: 'Enter a whole number.' }),
});

type AmendReasonValues = z.infer<typeof amendReasonSchema>;

export function AmendReferralReasonScreen() {
  const { reasonId = '' } = useParams();
  const target = useReferralReason(reasonId);

  if (target.isPending) {
    return (
      <>
        <PageHeader title="Amend a reason for referral" />
        <Spinner label="Loading the reason…" />
      </>
    );
  }

  if (target.isError) {
    return (
      <>
        <PageHeader title="Amend a reason for referral" />
        <ErrorNotice error={target.error} onRetry={() => void target.refetch()} />
      </>
    );
  }

  if (target.data === null) {
    return (
      <>
        <PageHeader title="Amend a reason for referral" />
        <EmptyState
          action={<Link to="/referral-reasons">Back to reasons for referral</Link>}
          headline="That reason is not in the list"
          sentence="The link may be out of date. Nothing has been deleted — reasons are only ever retired."
        />
      </>
    );
  }

  return <AmendReasonForm reason={target.data} />;
}

function AmendReasonForm({ reason }: { reason: AdminReferralReason }) {
  const navigate = useNavigate();
  const amend = useAmendReferralReason();

  const labelId = useId();
  const labelErrorId = useId();
  const displayOrderId = useId();
  const displayOrderErrorId = useId();

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<AmendReasonValues>({
    resolver: zodResolver(amendReasonSchema),
    defaultValues: { label: reason.label, displayOrder: String(reason.displayOrder) },
  });

  const submit = handleSubmit(async (values) => {
    const parsedOrder = parseDisplayOrder(values.displayOrder);
    if (!parsedOrder.ok) return;

    try {
      // Deliberately no `code` and no `isActive` — see the module comment.
      await amend.mutateAsync({
        id: reason.id,
        patch: { label: values.label, displayOrder: parsedOrder.value },
      });
      await navigate('/referral-reasons');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const labelError = errors.label?.message;
  const displayOrderError = errors.displayOrder?.message;

  return (
    <>
      <PageHeader title={`Amend ${reason.label}`} />

      {amend.error !== null && !isFieldFailure(amend.error) && <ErrorNotice error={amend.error} />}

      <dl className={styles.static}>
        <dt>Code</dt>
        <dd>{reason.code}</dd>
        <dt>Status</dt>
        <dd>{reason.isActive ? 'Active' : 'Retired'}</dd>
      </dl>

      <p className={styles.help}>
        The code cannot be changed here — every referral that used this reason is stored against it.
        Retiring or restoring this reason is also done from the{' '}
        <Link to="/referral-reasons">reasons for referral list</Link>.
      </p>

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={labelId}>Label</label>
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
          <button className={styles.submit} type="submit">
            {isSubmitting ? 'Saving…' : 'Save changes'}
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

function applyFieldErrors(error: unknown, setError: UseFormSetError<AmendReasonValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'label' || path === 'displayOrder') setError(path, { message });
  }
}
