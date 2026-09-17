import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import * as z from 'zod';
import { ErrorNotice } from '../../../components/error-notice';
import { BoxesIcon, PencilIcon, TargetIcon } from '../../../components/icons';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useCrates, useStockItems } from '../../stock/queries';
import {
  MAX_TARGET_STOCK_LIST_NAME_LENGTH,
  buildEditorModel,
  buildTargetPayload,
  findTargetStockListByName,
  type CrateTargetDraft,
  type EditorRow,
} from '../target-stock-lists.logic';
import { useCreateTargetStockList, useTargetStockLists } from '../queries';
import { CrateTargetEditor, TargetStockListEditor } from './target-stock-list-editor';
import styles from './target-stock-list-form.module.css';

/**
 * Add a target stock list: a name, then a target quantity against any of the
 * stock items it buys for. A new list has no stored lines, so no reconciliation
 * and no attention rows — that only happens on amend.
 */
const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a name for this list.')
    .max(
      MAX_TARGET_STOCK_LIST_NAME_LENGTH,
      `Use ${String(MAX_TARGET_STOCK_LIST_NAME_LENGTH)} characters or fewer.`,
    ),
});

type CreateValues = z.infer<typeof createSchema>;

export function CreateTargetStockListScreen() {
  const navigate = useNavigate();
  const lists = useTargetStockLists();
  const stockItems = useStockItems('category');
  const crates = useCrates();
  const create = useCreateTargetStockList();
  const [rows, setRows] = useState<readonly EditorRow[] | null>(null);
  const [crateRows, setCrateRows] = useState<readonly CrateTargetDraft[] | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [focusRow, setFocusRow] = useState<{ stockItemId: string; nonce: number } | null>(null);
  const [focusCrate, setFocusCrate] = useState<{ crateId: string; nonce: number } | null>(null);
  const [errorCrateId, setErrorCrateId] = useState<string | null>(null);
  const [focusLinesError, setFocusLinesError] = useState(0);

  const nameId = useId();
  const nameErrorId = useId();
  const duplicateId = useId();
  const linesErrorId = useId();
  const linesErrorRef = useRef<HTMLParagraphElement>(null);

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '' },
  });

  const name = useWatch({ control, name: 'name' });
  const duplicate =
    lists.data === undefined ? undefined : findTargetStockListByName(lists.data, name);

  const initialRows = useMemo(() => {
    if (stockItems.data === undefined || crates.data === undefined) return null;
    const memberIds = new Set(
      crates.data.flatMap((crate) => crate.members.map((member) => member.stockItemId)),
    );
    return buildEditorModel(
      stockItems.data.filter((item) => !memberIds.has(item.id)),
      [],
    ).rows;
  }, [crates.data, stockItems.data]);
  const currentRows = rows ?? initialRows;
  const initialCrateRows = useMemo(
    () =>
      crates.data?.map((crate) => ({ crateId: crate.id, crateName: crate.name, target: '' })) ??
      null,
    [crates.data],
  );
  const currentCrateRows = crateRows ?? initialCrateRows;

  useEffect(() => {
    if (focusLinesError > 0) linesErrorRef.current?.focus();
  }, [focusLinesError]);

  const submit = handleSubmit(async (values) => {
    if (duplicate !== undefined || currentRows === null || currentCrateRows === null) return;

    const built = buildTargetPayload(currentRows, currentCrateRows);
    if (!built.ok) {
      setLinesError(built.message);
      setErrorCrateId(built.focusCrateId);
      const crateId = built.focusCrateId;
      if (crateId !== null) {
        setFocusCrate((previous) => ({
          crateId,
          nonce: (previous?.nonce ?? 0) + 1,
        }));
        return;
      }
      const focusId = built.focusStockItemId;
      if (focusId === null) setFocusLinesError((n) => n + 1);
      else setFocusRow((prev) => ({ stockItemId: focusId, nonce: (prev?.nonce ?? 0) + 1 }));
      return;
    }
    setLinesError(null);
    setErrorCrateId(null);

    try {
      await create.mutateAsync({ name: values.name, lines: [...built.lines] });
      await navigate('/stock/target-lists');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const nameError = errors.name?.message;
  const refused = duplicate !== undefined;

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader
          description={<p>Set how many of each item the food bank wants to hold.</p>}
          icon={<TargetIcon />}
          title="Add a target stock list"
        />
      </div>

      {create.error !== null && !isFieldFailure(create.error) && (
        <ErrorNotice error={create.error} />
      )}

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.card}>
          <h2 className={styles.cardHeading}>
            <span className={styles.cardHeadingIcon}>
              <PencilIcon />
            </span>
            Name
          </h2>
          <div className={styles.field}>
            <label htmlFor={nameId}>Name</label>
            <p className={styles.help} id={`${nameId}-help`}>
              What the team calls this set of targets — “Standard week”, “Christmas”.
            </p>
            <input
              {...register('name')}
              aria-describedby={
                [
                  `${nameId}-help`,
                  nameError === undefined ? null : nameErrorId,
                  refused ? duplicateId : null,
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
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardHeading}>
            <span className={styles.cardHeadingIcon}>
              <TargetIcon />
            </span>
            Targets
          </h2>
          {(stockItems.isPending || crates.isPending) && <Spinner label="Loading targets…" />}
          {stockItems.isError && (
            <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />
          )}
          {currentRows !== null && (
            <TargetStockListEditor
              attention={[]}
              focusRow={focusRow}
              onRemoveAttention={() => undefined}
              onRowsChange={setRows}
              rows={currentRows}
            />
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardHeading}>
            <span className={styles.cardHeadingIcon}>
              <BoxesIcon />
            </span>
            Crate targets
          </h2>
          {crates.isPending && <Spinner label="Loading crates…" />}
          {crates.isError && (
            <ErrorNotice error={crates.error} onRetry={() => void crates.refetch()} />
          )}
          {currentCrateRows !== null && (
            <CrateTargetEditor
              errorCrateId={errorCrateId}
              focusCrate={focusCrate}
              onRowsChange={setCrateRows}
              rows={currentCrateRows}
            />
          )}
        </div>
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

        <div className={styles.formActions}>
          <button
            aria-describedby={
              [refused ? duplicateId : null, linesError === null ? null : linesErrorId]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-disabled={refused}
            className={styles.submit}
            type="submit"
          >
            {isSubmitting ? 'Adding…' : 'Add target stock list'}
          </button>
          <Link to="/stock/target-lists">Cancel</Link>
        </div>
      </form>
    </div>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<CreateValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'name') setError(path, { message }, { shouldFocus: true });
  }
}
