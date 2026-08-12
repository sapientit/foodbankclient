import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import * as z from 'zod';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useCreateStockItem, useStockItems } from '../queries';
import { findStockItemByName } from '../stock.logic';
import styles from './stock-item-form.module.css';

const stockItemSchema = z.object({
  name: z.string().trim().min(1, 'Enter an item name.').max(120, 'Use 120 characters or fewer.'),
  category: z.string().trim().min(1, 'Enter a category.').max(40, 'Use 40 characters or fewer.'),
  description: z.string().trim().max(200, 'Use 200 characters or fewer.'),
  shelfNumber: z.string().trim().min(1, 'Enter the shelf.').max(20, 'Use 20 characters or fewer.'),
});
type StockItemFormValues = z.infer<typeof stockItemSchema>;

export function CreateStockItemScreen() {
  const navigate = useNavigate();
  const items = useStockItems();
  const create = useCreateStockItem();
  const nameId = useId();
  const nameErrorId = useId();
  const categoryId = useId();
  const categoryErrorId = useId();
  const descriptionId = useId();
  const descriptionErrorId = useId();
  const shelfId = useId();
  const shelfErrorId = useId();
  const duplicateId = useId();
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<StockItemFormValues>({
    resolver: zodResolver(stockItemSchema),
    defaultValues: { name: '', category: '', description: '', shelfNumber: '' },
  });

  /*
   * Checked as they type, against the list this screen already has. The server
   * answers a duplicate here with a clean `409`, so the pre-check is not what
   * makes this safe — it is what makes it useful, because a **retired** item
   * holding the name is a collision with a row that is not on the screen, and
   * "already exists" for something invisible is a dead end.
   */
  const name = useWatch({ control, name: 'name' });
  const duplicate = items.data === undefined ? undefined : findStockItemByName(items.data, name);

  const submit = handleSubmit(async (values) => {
    if (duplicate !== undefined) return;

    try {
      const { description, ...item } = values;
      await create.mutateAsync(description === '' ? item : { ...item, description });
      await navigate('/stock/items');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const refused = duplicate !== undefined;

  return (
    <>
      <PageHeader title="Add a stock item" />
      {create.error !== null && !isFieldFailure(create.error) && (
        <ErrorNotice error={create.error} />
      )}
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
              {duplicate.isActive ? (
                <>
                  “{duplicate.name}” is already on shelf {duplicate.shelfNumber}.{' '}
                  <Link to={`/stock/items/${duplicate.id}`}>Amend that item</Link> instead.
                </>
              ) : (
                <>
                  “{duplicate.name}” is retired and still holds that name. Reactivate it rather than
                  adding a second one: <Link to="/stock/items?retired=1">show retired items</Link>.
                </>
              )}
            </p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor={categoryId}>Category</label>
          <input
            {...register('category')}
            aria-describedby={errors.category === undefined ? undefined : categoryErrorId}
            aria-invalid={errors.category === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={categoryId}
            type="text"
          />
          {errors.category !== undefined && (
            <p className={styles.fieldError} id={categoryErrorId}>
              {errors.category.message}
            </p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor={descriptionId}>Description (optional)</label>
          <textarea
            {...register('description')}
            aria-describedby={errors.description === undefined ? undefined : descriptionErrorId}
            aria-invalid={errors.description === undefined ? undefined : true}
            className={styles.input}
            id={descriptionId}
            rows={3}
          />
          {errors.description !== undefined && (
            <p className={styles.fieldError} id={descriptionErrorId}>
              {errors.description.message}
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
            {isSubmitting ? 'Adding…' : 'Add item'}
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

function applyFieldErrors(error: unknown, setError: UseFormSetError<StockItemFormValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'name' || path === 'category' || path === 'description' || path === 'shelfNumber')
      setError(path, { message });
  }
}
