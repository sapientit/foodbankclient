import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import * as z from 'zod';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useStockItems } from '../../stock/queries';
import {
  MAX_MODEL_PARCEL_DESCRIPTION_LENGTH,
  MAX_MODEL_PARCEL_NAME_LENGTH,
  buildContentLines,
  findModelParcelByName,
  type DraftContentLine,
} from '../model-parcels.logic';
import { useCreateModelParcel, useModelParcels } from '../queries';
import { ModelParcelContentsEditor } from './model-parcel-contents-editor';
import styles from './model-parcel-form.module.css';

/**
 * Add a model parcel: a name, an optional description, and its contents.
 *
 * **The name is not amendable once created** — `openapi.yaml`: "The name is
 * the key the grid references and cannot be changed afterwards. To rename,
 * delete and recreate, which forces the grid to be revisited." So this is the
 * only screen in the feature where the name can be set at all.
 */
const createModelParcelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a name for this model parcel.')
    .max(
      MAX_MODEL_PARCEL_NAME_LENGTH,
      `Use ${String(MAX_MODEL_PARCEL_NAME_LENGTH)} characters or fewer.`,
    ),
  description: z
    .string()
    .trim()
    .max(
      MAX_MODEL_PARCEL_DESCRIPTION_LENGTH,
      `Use ${String(MAX_MODEL_PARCEL_DESCRIPTION_LENGTH)} characters or fewer.`,
    ),
});

type CreateModelParcelValues = z.infer<typeof createModelParcelSchema>;

export function CreateModelParcelScreen() {
  const navigate = useNavigate();
  const parcels = useModelParcels();
  const stockItems = useStockItems();
  const create = useCreateModelParcel();
  const [lines, setLines] = useState<readonly DraftContentLine[]>([]);
  const [linesError, setLinesError] = useState<string | null>(null);

  const nameId = useId();
  const nameErrorId = useId();
  const descriptionId = useId();
  const descriptionErrorId = useId();
  const duplicateId = useId();
  const linesErrorId = useId();

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<CreateModelParcelValues>({
    resolver: zodResolver(createModelParcelSchema),
    defaultValues: { name: '', description: '' },
  });

  const name = useWatch({ control, name: 'name' });
  const duplicate =
    parcels.data === undefined ? undefined : findModelParcelByName(parcels.data, name);

  const submit = handleSubmit(async (values) => {
    if (duplicate !== undefined) return;

    const built = buildContentLines(lines);
    if (!built.ok) {
      setLinesError(built.message);
      return;
    }
    setLinesError(null);

    try {
      await create.mutateAsync({
        name: values.name,
        description: values.description === '' ? null : values.description,
        contents: built.lines,
      });
      await navigate('/model-parcels');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const nameError = errors.name?.message;
  const descriptionError = errors.description?.message;
  const refused = duplicate !== undefined;

  return (
    <>
      <PageHeader title="Add a model parcel" />

      {create.error !== null && !isFieldFailure(create.error) && (
        <ErrorNotice error={create.error} />
      )}

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={nameId}>Name</label>
          <p className={styles.help} id={`${nameId}-help`}>
            This cannot be changed once saved — it is what the household grid points at. To rename
            it later, delete this parcel and add a new one.
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
              <Link to={`/model-parcels/${duplicate.id}`}>Amend that parcel</Link> instead.
            </p>
          )}
        </div>

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
        {stockItems.isPending && <p>Loading stock items…</p>}
        {stockItems.isError && (
          <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />
        )}
        {stockItems.isSuccess && (
          <ModelParcelContentsEditor
            lines={lines}
            onChange={setLines}
            stockItems={stockItems.data}
          />
        )}
        {linesError !== null && (
          <p className={styles.fieldError} id={linesErrorId}>
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
            {isSubmitting ? 'Adding…' : 'Add model parcel'}
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

function applyFieldErrors(
  error: unknown,
  setError: UseFormSetError<CreateModelParcelValues>,
): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (path === 'name' || path === 'description') setError(path, { message });
  }
}
