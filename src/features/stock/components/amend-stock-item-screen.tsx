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
import {
  useAmendStockItem,
  useStockItem,
  useStockItems,
  type StockItem,
  type StockItemInput,
} from '../queries';
import { findStockItemByName } from '../stock.logic';
import styles from './stock-item-form.module.css';

const stockItemSchema = z.object({
  name: z.string().trim().min(1, 'Enter an item name.').max(120, 'Use 120 characters or fewer.'),
  shelfNumber: z.string().trim().min(1, 'Enter the shelf.').max(20, 'Use 20 characters or fewer.'),
});

export function AmendStockItemScreen() {
  const { stockItemId = '' } = useParams();
  const item = useStockItem(stockItemId);

  if (item.isPending)
    return (
      <>
        <PageHeader title="Amend a stock item" />
        <Spinner label="Loading the item…" />
      </>
    );
  if (item.isError)
    return (
      <>
        <PageHeader title="Amend a stock item" />
        <ErrorNotice error={item.error} onRetry={() => void item.refetch()} />
      </>
    );
  if (item.data === null) {
    return (
      <>
        <PageHeader title="Amend a stock item" />
        <EmptyState
          action={<Link to="/stock/items">Back to stock items</Link>}
          headline="That item is not in the list"
          sentence="The link may be out of date."
        />
      </>
    );
  }

  return <AmendStockItemForm item={item.data} />;
}

function AmendStockItemForm({ item }: { item: StockItem }) {
  const navigate = useNavigate();
  const items = useStockItems();
  const amend = useAmendStockItem();
  const nameId = useId();
  const nameErrorId = useId();
  const shelfId = useId();
  const shelfErrorId = useId();
  const duplicateId = useId();
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<StockItemInput>({
    resolver: zodResolver(stockItemSchema),
    defaultValues: { name: item.name, shelfNumber: item.shelfNumber },
  });

  /*
   * **This check is the only thing standing between a typo and a 500.** A
   * duplicate name on `POST /stock/items` is a `409` with a sentence worth
   * reading; the same duplicate on `PATCH /stock/items/{id}` is an
   * `INTERNAL_ERROR` — verified against a running server. So an admin correcting
   * a name would otherwise be told "something went wrong at our end", which is
   * neither true nor actionable.
   *
   * Retired items are included, because a retired row still holds its name and
   * the server still refuses it. The item being amended is excluded, so saving
   * an unchanged form — or only changing the capitalisation of its own name,
   * which the server allows — is not refused.
   */
  const name = useWatch({ control, name: 'name' });
  const duplicate =
    items.data === undefined ? undefined : findStockItemByName(items.data, name, item.id);

  const submit = handleSubmit(async (values) => {
    if (duplicate !== undefined) return;

    try {
      await amend.mutateAsync({ id: item.id, patch: values });
      await navigate('/stock/items');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const refused = duplicate !== undefined;

  return (
    <>
      <PageHeader title={`Amend ${item.name}`} />
      {amend.error !== null && !isFieldFailure(amend.error) && <ErrorNotice error={amend.error} />}
      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={nameId}>Name</label>
          <input
            {...register('name')}
            aria-describedby={
              [errors.name === undefined ? null : nameErrorId, refused ? duplicateId : null]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={errors.name === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={nameId}
            type="text"
          />
          {errors.name !== undefined && (
            <p className={styles.fieldError} id={nameErrorId}>
              {errors.name.message}
            </p>
          )}
          {duplicate !== undefined && (
            <p className={styles.refusal} id={duplicateId}>
              {duplicate.isActive
                ? `“${duplicate.name}” on shelf ${duplicate.shelfNumber} already uses that name. Two items cannot share one.`
                : `“${duplicate.name}” is retired and still holds that name. Two items cannot share one.`}
            </p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor={shelfId}>Shelf</label>
          <input
            {...register('shelfNumber')}
            aria-describedby={errors.shelfNumber === undefined ? undefined : shelfErrorId}
            aria-invalid={errors.shelfNumber === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={shelfId}
            type="text"
          />
          {errors.shelfNumber !== undefined && (
            <p className={styles.fieldError} id={shelfErrorId}>
              {errors.shelfNumber.message}
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
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
          <Link to="/stock/items">Cancel</Link>
        </div>
      </form>
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<StockItemInput>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'name' || path === 'shelfNumber') setError(path, { message });
  }
}
