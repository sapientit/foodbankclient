import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import * as z from 'zod';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useStockItems, type StockItem } from '../../stock/queries';
import {
  MAX_MODEL_PARCEL_DESCRIPTION_LENGTH,
  buildContentLines,
  type DraftContentLine,
} from '../model-parcels.logic';
import { useAmendModelParcel, useModelParcel, type ModelParcel } from '../queries';
import { ModelParcelContentsEditor } from './model-parcel-contents-editor';
import styles from './model-parcel-form.module.css';

/**
 * Amend a model parcel: its description and its contents.
 *
 * **There is no name field on this form at all** — not a disabled one, the
 * same shape as the amend-user screen leaving email off entirely. A disabled
 * input invites "so how do I change it?", and there is an answer, just not
 * here: delete this parcel and add a new one. `openapi.yaml` is explicit that
 * the name is not amendable, because it is the key the household grid
 * references — the amend `PATCH` body type generated from the contract has no
 * `name` property at all, so there is nothing to accidentally wire up even by
 * mistake, and verified against a running server: a `name` sent on this
 * `PATCH` is silently ignored, exactly the trap `email` is on the user form.
 *
 * The row is read from the one cached list — there is no `GET
 * /model-parcels/{id}` — so it is a projection the same way `useUser` and
 * `useStockItem` are.
 */
const amendModelParcelSchema = z.object({
  description: z
    .string()
    .trim()
    .max(
      MAX_MODEL_PARCEL_DESCRIPTION_LENGTH,
      `Use ${String(MAX_MODEL_PARCEL_DESCRIPTION_LENGTH)} characters or fewer.`,
    ),
});

type AmendModelParcelValues = z.infer<typeof amendModelParcelSchema>;

export function AmendModelParcelScreen() {
  const { modelParcelId = '' } = useParams();
  const target = useModelParcel(modelParcelId);
  const stockItems = useStockItems();

  if (target.isPending || stockItems.isPending) {
    return (
      <>
        <PageHeader title="Amend a model parcel" />
        <Spinner label="Loading the model parcel…" />
      </>
    );
  }

  if (target.isError) {
    return (
      <>
        <PageHeader title="Amend a model parcel" />
        <ErrorNotice error={target.error} onRetry={() => void target.refetch()} />
      </>
    );
  }

  if (stockItems.isError) {
    return (
      <>
        <PageHeader title="Amend a model parcel" />
        <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />
      </>
    );
  }

  if (target.data === null) {
    return (
      <>
        <PageHeader title="Amend a model parcel" />
        <EmptyState
          action={<Link to="/model-parcels">Back to model parcels</Link>}
          headline="That model parcel is not in the list"
          sentence="The link may be out of date, or it has been deleted."
        />
      </>
    );
  }

  return <AmendModelParcelForm parcel={target.data} stockItems={stockItems.data} />;
}

function AmendModelParcelForm({
  parcel,
  stockItems,
}: {
  parcel: ModelParcel;
  stockItems: readonly StockItem[];
}) {
  const navigate = useNavigate();
  const amend = useAmendModelParcel();
  const [lines, setLines] = useState<readonly DraftContentLine[]>(() =>
    parcel.contents.map((line) => ({
      stockItemId: line.stockItemId,
      name: stockItems.find((item) => item.id === line.stockItemId)?.name ?? line.stockItemId,
      quantity: String(line.quantity),
    })),
  );
  const [linesError, setLinesError] = useState<string | null>(null);

  const descriptionId = useId();
  const descriptionErrorId = useId();
  const linesErrorId = useId();

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<AmendModelParcelValues>({
    resolver: zodResolver(amendModelParcelSchema),
    defaultValues: { description: parcel.description ?? '' },
  });

  const submit = handleSubmit(async (values) => {
    const built = buildContentLines(lines);
    if (!built.ok) {
      setLinesError(built.message);
      return;
    }
    setLinesError(null);

    try {
      // Deliberately no `name` key — see the module comment. `description`
      // and `contents` are always both sent, so this amend is never a
      // no-op `PATCH` with nothing in it.
      await amend.mutateAsync({
        id: parcel.id,
        patch: {
          description: values.description === '' ? null : values.description,
          contents: built.lines,
        },
      });
      await navigate('/model-parcels');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const descriptionError = errors.description?.message;

  return (
    <>
      <PageHeader title={`Amend ${parcel.name}`} />

      {amend.error !== null && !isFieldFailure(amend.error) && <ErrorNotice error={amend.error} />}

      <dl className={styles.static}>
        <dt>Name</dt>
        <dd>{parcel.name}</dd>
      </dl>

      <p className={styles.help}>
        A model parcel&rsquo;s name cannot be changed here — it is what the{' '}
        <Link to="/model-parcels/grid">household grid</Link> points at, so changing it would leave
        every cell naming it pointing at nothing. To rename it, delete this parcel from the{' '}
        <Link to="/model-parcels">model parcels list</Link> and add the right one, then update the
        grid.
      </p>

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={descriptionId}>Description (optional)</label>
          <textarea
            {...register('description')}
            aria-describedby={descriptionError === undefined ? undefined : descriptionErrorId}
            aria-invalid={descriptionError === undefined ? undefined : true}
            className={styles.textarea}
            id={descriptionId}
            rows={3}
          />
          {descriptionError !== undefined && (
            <p className={styles.fieldError} id={descriptionErrorId}>
              {descriptionError}
            </p>
          )}
        </div>

        <h2>Contents</h2>
        <ModelParcelContentsEditor lines={lines} onChange={setLines} stockItems={stockItems} />
        {linesError !== null && (
          <p className={styles.fieldError} id={linesErrorId}>
            {linesError}
          </p>
        )}

        <div className={styles.formActions}>
          <button
            aria-describedby={linesError === null ? undefined : linesErrorId}
            className={styles.submit}
            type="submit"
          >
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
          <Link to="/model-parcels">Cancel</Link>
        </div>
      </form>
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<AmendModelParcelValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'description') setError(path, { message });
  }
}
