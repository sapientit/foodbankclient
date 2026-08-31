import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import * as z from 'zod';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useStockItems, type StockItem } from '../../stock/queries';
import {
  MAX_TARGET_STOCK_LIST_NAME_LENGTH,
  buildEditorModel,
  buildListPayload,
  findTargetStockListByName,
  hasUnresolvedLines,
  type AttentionRow,
  type EditorRow,
} from '../target-stock-lists.logic';
import { useAmendTargetStockList, useTargetStockList, useTargetStockLists } from '../queries';
import type { TargetStockList } from '../queries';
import { TargetStockListEditor } from './target-stock-list-editor';
import styles from './target-stock-list-form.module.css';

/**
 * Amend a target stock list: its name and its targets. The row is a projection
 * over the one cached list — there is no `GET /{id}` — the same as
 * `useModelParcel` and `useStockItem`.
 *
 * **Save is blocked while the list still names a retired or missing item.**
 * Those lines are pulled out into the editor's attention section and each has to
 * be removed (or its item reinstated) first. A renamed line does not block — it
 * shows on its item's row and the stored name is refreshed on save.
 */
export function AmendTargetStockListScreen() {
  const { targetStockListId = '' } = useParams();
  const target = useTargetStockList(targetStockListId);
  const stockItems = useStockItems('category');

  if (target.isPending || stockItems.isPending) {
    return (
      <>
        <PageHeader title="Amend a target stock list" />
        <Spinner label="Loading the target stock list…" />
      </>
    );
  }

  if (target.isError) {
    return (
      <>
        <PageHeader title="Amend a target stock list" />
        <ErrorNotice error={target.error} onRetry={() => void target.refetch()} />
      </>
    );
  }

  if (stockItems.isError) {
    return (
      <>
        <PageHeader title="Amend a target stock list" />
        <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />
      </>
    );
  }

  if (target.data === null) {
    return (
      <>
        <PageHeader title="Amend a target stock list" />
        <EmptyState
          action={<Link to="/stock/target-lists">Back to target stock lists</Link>}
          headline="That target stock list is not in the list"
          sentence="The link may be out of date, or it has been deleted."
        />
      </>
    );
  }

  return <AmendForm list={target.data} stockItems={stockItems.data} />;
}

const amendSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a name for this list.')
    .max(
      MAX_TARGET_STOCK_LIST_NAME_LENGTH,
      `Use ${String(MAX_TARGET_STOCK_LIST_NAME_LENGTH)} characters or fewer.`,
    ),
});

type AmendValues = z.infer<typeof amendSchema>;

function AmendForm({
  list,
  stockItems,
}: {
  list: TargetStockList;
  stockItems: readonly StockItem[];
}) {
  const navigate = useNavigate();
  const lists = useTargetStockLists();
  const amend = useAmendTargetStockList();

  const [model] = useState(() => buildEditorModel(stockItems, list.lines));
  const [rows, setRows] = useState<readonly EditorRow[]>(model.rows);
  const [attention, setAttention] = useState<readonly AttentionRow[]>(model.attention);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [focusRow, setFocusRow] = useState<{ stockItemId: string; nonce: number } | null>(null);
  const [focusLinesError, setFocusLinesError] = useState(0);

  const nameId = useId();
  const nameErrorId = useId();
  const duplicateId = useId();
  const blockedId = useId();
  const linesErrorId = useId();
  const linesErrorRef = useRef<HTMLParagraphElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<AmendValues>({
    resolver: zodResolver(amendSchema),
    defaultValues: { name: list.name },
  });

  const name = useWatch({ control, name: 'name' });
  const duplicate =
    lists.data === undefined ? undefined : findTargetStockListByName(lists.data, name, list.id);

  const blocked = hasUnresolvedLines(attention);
  const refused = duplicate !== undefined || blocked;

  const submit = handleSubmit(async (values) => {
    if (refused) return;

    const built = buildListPayload(rows);
    if (!built.ok) {
      setLinesError(built.message);
      const focusId = built.focusStockItemId;
      if (focusId === null) setFocusLinesError((n) => n + 1);
      else setFocusRow((prev) => ({ stockItemId: focusId, nonce: (prev?.nonce ?? 0) + 1 }));
      return;
    }
    setLinesError(null);

    try {
      await amend.mutateAsync({ id: list.id, patch: { name: values.name, lines: built.lines } });
      await navigate('/stock/target-lists');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const onAllResolved = useCallback(() => {
    saveRef.current?.focus();
  }, []);

  useEffect(() => {
    if (focusLinesError > 0) linesErrorRef.current?.focus();
  }, [focusLinesError]);

  const nameError = errors.name?.message;

  return (
    <>
      <PageHeader title={`Amend ${list.name}`} />

      {amend.error !== null && !isFieldFailure(amend.error) && <ErrorNotice error={amend.error} />}

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={nameId}>Name</label>
          <input
            {...register('name')}
            aria-describedby={
              [
                nameError === undefined ? null : nameErrorId,
                duplicate !== undefined ? duplicateId : null,
              ]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
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
          {duplicate !== undefined && (
            <p className={styles.refusal} id={duplicateId}>
              “{duplicate.name}” already exists.{' '}
              <Link to={`/stock/target-lists/${duplicate.id}`}>Amend that list</Link> instead.
            </p>
          )}
        </div>

        <h2>Targets</h2>
        <TargetStockListEditor
          attention={attention}
          focusRow={focusRow}
          onAllResolved={onAllResolved}
          onRemoveAttention={(stockItemId) => {
            setAttention((current) => current.filter((row) => row.stockItemId !== stockItemId));
          }}
          onRowsChange={setRows}
          rows={rows}
        />
        {linesError !== null && (
          <p
            className={styles.fieldError}
            id={linesErrorId}
            ref={linesErrorRef}
            role="alert"
            tabIndex={-1}
          >
            {linesError}
          </p>
        )}

        {blocked && (
          <p className={styles.blocked} id={blockedId} role="alert">
            Deal with the {attention.length === 1 ? 'line' : 'lines'} that need attention above
            before saving.
          </p>
        )}

        <div className={styles.formActions}>
          <button
            aria-describedby={
              [
                blocked ? blockedId : null,
                duplicate !== undefined ? duplicateId : null,
                linesError === null ? null : linesErrorId,
              ]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-disabled={refused}
            className={styles.submit}
            ref={saveRef}
            type="submit"
          >
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
          <Link to="/stock/target-lists">Cancel</Link>
        </div>
      </form>
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<AmendValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'name') setError(path, { message }, { shouldFocus: true });
  }
}
