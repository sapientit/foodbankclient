import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import * as z from 'zod';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useAdjustStock, useStockLevel, type MovementType, type StockLevel } from '../queries';
import {
  MOVEMENT_TYPE_OPTIONS,
  formatSignedQuantity,
  isMovementType,
  parseQuantityDelta,
  type QuantityDeltaProblem,
} from '../stock.logic';
import styles from './adjust-stock-screen.module.css';

/**
 * Correct one item's level by hand. Both roles: the team lead is the person
 * standing in the warehouse when the count is wrong.
 *
 * `POST /stock/adjustments` answers **204**, so the mutation uses `unwrapVoid`;
 * see `queries.ts`. Everything else about this screen follows from the three
 * things the server insists on — a signed non-zero delta, one of exactly six
 * movement types, and a reason. The reason is the audit trail: a hand
 * correction is the only movement that does not explain itself.
 */

/** The copy for each way the quantity can be wrong. The rule itself is in `stock.logic.ts`. */
const QUANTITY_MESSAGES: Record<QuantityDeltaProblem, string> = {
  empty: 'Enter how many, with a minus sign to take stock off.',
  'not-a-whole-number': 'Use a whole number of items, for example 6 or -6.',
  zero: 'Zero would change nothing. Enter how many were added or taken away.',
  'too-large': 'That number is too large.',
};

const adjustmentSchema = z.object({
  movementType: z.custom<MovementType>(isMovementType, 'Choose what happened.'),
  quantityDelta: z.string().superRefine((value, ctx) => {
    const parsed = parseQuantityDelta(value);
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: QUANTITY_MESSAGES[parsed.problem] });
  }),
  reason: z
    .string()
    .trim()
    .min(1, 'Say why, so the change makes sense to whoever reads it later.')
    .max(300, 'Use 300 characters or fewer.'),
});

/**
 * Every field is named exactly as its API body key, so a `400`'s dot-joined
 * `details.issues[].path` maps onto `setError` with no translation table.
 * `quantityDelta` is held as text and parsed on submit: an `<input type=number>`
 * reports an empty box and a lone minus sign identically, and the difference
 * between them is a sentence a person can act on.
 */
type AdjustmentValues = z.infer<typeof adjustmentSchema>;

export function AdjustStockScreen() {
  const { stockItemId = '' } = useParams();
  const level = useStockLevel(stockItemId);

  if (level.isPending)
    return (
      <>
        <PageHeader title="Adjust stock" />
        <Spinner label="Loading the item…" />
      </>
    );
  if (level.isError)
    return (
      <>
        <PageHeader title="Adjust stock" />
        <ErrorNotice error={level.error} onRetry={() => void level.refetch()} />
      </>
    );
  if (level.data === null)
    return (
      <>
        <PageHeader title="Adjust stock" />
        <EmptyState
          action={<Link to="/stock">Back to stock</Link>}
          headline="That item is not in the list"
          sentence="The link may be out of date."
        />
      </>
    );

  return <AdjustStockForm level={level.data} />;
}

function AdjustStockForm({ level }: { level: StockLevel }) {
  const navigate = useNavigate();
  const adjust = useAdjustStock();
  const movementId = useId();
  const movementErrorId = useId();
  const quantityId = useId();
  const quantityErrorId = useId();
  const reasonId = useId();
  const reasonErrorId = useId();
  const previewId = useId();

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<AdjustmentValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { movementType: 'correction', quantityDelta: '', reason: '' },
  });

  // The same parse the resolver uses, so the preview and the refusal can never
  // disagree about what was typed.
  const typedQuantity = useWatch({ control, name: 'quantityDelta' });
  const parsed = parseQuantityDelta(typedQuantity);

  const submit = handleSubmit(async (values) => {
    const quantity = parseQuantityDelta(values.quantityDelta);
    if (!quantity.ok) return;

    try {
      await adjust.mutateAsync({
        stockItemId: level.id,
        quantityDelta: quantity.value,
        movementType: values.movementType,
        reason: values.reason.trim(),
      });
      await navigate('/stock');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const movementError = errors.movementType?.message;
  const quantityError = errors.quantityDelta?.message;
  const reasonError = errors.reason?.message;

  return (
    <>
      <PageHeader title={`Adjust ${level.name}`} />

      <dl className={styles.summary}>
        <dt>Shelf</dt>
        <dd>{level.shelfNumber}</dd>
        <dt>On hand now</dt>
        <dd>{level.quantityOnHand}</dd>
      </dl>

      {/* A 400 has already become field errors, so the notice as well would say
          the same thing twice, further from the input. */}
      {adjust.error !== null && !isFieldFailure(adjust.error) && (
        <ErrorNotice error={adjust.error} />
      )}

      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <fieldset className={styles.fieldset}>
          <legend>What happened?</legend>
          {/* All six movement types, from a Record over the generated union —
              so a change to the server's list fails to compile rather than
              quietly dropping an option. `expiry` is not one of them: anything
              thrown away is wastage, whatever the reason. */}
          {MOVEMENT_TYPE_OPTIONS.map((option) => (
            <label
              className={styles.choice}
              htmlFor={`${movementId}-${option.value}`}
              key={option.value}
            >
              <input
                {...register('movementType')}
                aria-describedby={`${movementId}-${option.value}-hint`}
                id={`${movementId}-${option.value}`}
                type="radio"
                value={option.value}
              />
              <span>
                {option.label}
                <span className={styles.hint} id={`${movementId}-${option.value}-hint`}>
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
          {movementError !== undefined && (
            <p className={styles.fieldError} id={movementErrorId}>
              {movementError}
            </p>
          )}
        </fieldset>

        <div className={styles.field}>
          <label htmlFor={quantityId}>How many</label>
          <p className={styles.help} id={`${quantityId}-help`}>
            A plain number adds stock. Put a minus sign in front to take it off — <code>-6</code>{' '}
            for six thrown away.
          </p>
          <input
            {...register('quantityDelta')}
            aria-describedby={
              [
                `${quantityId}-help`,
                quantityError === undefined ? null : quantityErrorId,
                parsed.ok ? previewId : null,
              ]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={quantityError === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={quantityId}
            inputMode="numeric"
            type="text"
          />
          {quantityError !== undefined && (
            <p className={styles.fieldError} id={quantityErrorId}>
              {quantityError}
            </p>
          )}
          {parsed.ok && (
            /* The level after the change, stated before it is made. A negative
               result is shown as the number it is: the ledger really can go
               below zero, and hiding that is how a warehouse stops trusting
               the figure. */
            <p className={styles.preview} id={previewId}>
              {formatSignedQuantity(parsed.value)} would take {level.name} from{' '}
              {level.quantityOnHand} to {level.quantityOnHand + parsed.value}.
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={reasonId}>Why</label>
          <p className={styles.help} id={`${reasonId}-help`}>
            Every adjustment carries a reason, and it stays on the record. Write what you would want
            to read in six months.
          </p>
          <input
            {...register('reason')}
            aria-describedby={
              [`${reasonId}-help`, reasonError === undefined ? null : reasonErrorId]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={reasonError === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={reasonId}
            maxLength={300}
            type="text"
          />
          {reasonError !== undefined && (
            <p className={styles.fieldError} id={reasonErrorId}>
              {reasonError}
            </p>
          )}
        </div>

        <div className={styles.formActions}>
          <button className={styles.submit} type="submit">
            {isSubmitting ? 'Recording…' : 'Record adjustment'}
          </button>
          <Link to="/stock">Cancel</Link>
        </div>
      </form>
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

/**
 * A `400` names the field and the rule and never echoes the value, so what was
 * typed stays exactly where it was typed — the form is never reset on failure.
 */
function applyFieldErrors(error: unknown, setError: UseFormSetError<AdjustmentValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;

  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'quantityDelta' || path === 'movementType' || path === 'reason') {
      setError(path, { message });
    }
  }
}
