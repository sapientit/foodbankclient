import { useId, useState } from 'react';
import { Link } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useStockItems, type StockItem } from '../../stock/queries';
import {
  GRID_ADULTS,
  GRID_CHILDREN,
  PREVIEW_ADULTS_BOUNDS,
  PREVIEW_CHILDREN_BOUNDS,
  buildGridPayload,
  describeHouseholdClamping,
  describeHouseholdSize,
  gridCellKey,
  gridCompleteness,
  parseWholeNumber,
  unknownGridCells,
  type WholeNumberProblem,
} from '../model-parcels.logic';
import {
  useModelParcels,
  useParcelGrid,
  usePreviewHousehold,
  useSaveParcelGrid,
  type Grid,
  type ModelParcel,
  type PreviewResult,
} from '../queries';
import styles from './household-grid-screen.module.css';

/**
 * Thirty cells, one for every household size from 1 adult with no children up
 * to 5 adults and 5 children, each naming the model parcel that size
 * receives.
 *
 * **Saved whole, in one `PUT`, never cell by cell** — `openapi.yaml`: "Sent
 * whole, never cell by cell — one write, no half-updated state." So this
 * screen keeps a local draft and only ever calls `useSaveParcelGrid` once,
 * with everything in it, on Save.
 *
 * A partly filled grid and a grid naming a since-deleted parcel are both
 * **normal states, not errors** — see `gridCompleteness` and
 * `unknownGridCells`. Both are reported as information above the table, and
 * neither blocks Save: the server is the one place a `422` genuinely means
 * something is wrong, because only the server knows the current, authoritative
 * list of parcel names at the moment of writing.
 */
export function HouseholdGridScreen() {
  const grid = useParcelGrid();
  const parcels = useModelParcels();

  if (grid.isPending || parcels.isPending) {
    return (
      <>
        <PageHeader title="Household grid" />
        <Spinner label="Loading the household grid…" />
      </>
    );
  }

  if (grid.isError) {
    return (
      <>
        <PageHeader title="Household grid" />
        <ErrorNotice error={grid.error} onRetry={() => void grid.refetch()} />
      </>
    );
  }

  if (parcels.isError) {
    return (
      <>
        <PageHeader title="Household grid" />
        <ErrorNotice error={parcels.error} onRetry={() => void parcels.refetch()} />
      </>
    );
  }

  return <GridEditor initialGrid={grid.data.grid} parcels={parcels.data} />;
}

function GridEditor({
  initialGrid,
  parcels,
}: {
  initialGrid: Grid;
  parcels: readonly ModelParcel[];
}) {
  // Seeded once from the loaded grid. A background refetch must not overwrite
  // an admin's in-progress edits — the same reasoning as `AmendUserForm`
  // reading its `defaultValues` once from the row already fetched.
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...initialGrid }));
  const [saved, setSaved] = useState(false);
  const save = useSaveParcelGrid();

  const knownNames = parcels.map((parcel) => parcel.name);
  const { isComplete, missingCells } = gridCompleteness(draft);
  const unknownCells = unknownGridCells(draft, knownNames);

  const setCell = (key: string, value: string) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const doSave = () => {
    save.mutate(buildGridPayload(draft), {
      onSuccess: () => {
        setSaved(true);
      },
    });
  };

  return (
    <>
      <PageHeader title="Household grid" action={<Link to="/model-parcels">Model parcels</Link>} />

      <p className={styles.intro}>
        Every household size from 1 adult with no children up to 5 adults and 5 children needs a
        model parcel to receive. A household larger than that in either direction is treated as 5 —
        see the preview below.
      </p>

      {save.error !== null && <ErrorNotice error={save.error} />}

      {saved && (
        <p className={styles.savedNotice} role="status">
          Grid saved.
        </p>
      )}

      {!isComplete && (
        <p className={styles.infoNotice} role="status">
          {missingCells.length === 1
            ? '1 household size has no model parcel yet.'
            : `${String(missingCells.length)} household sizes have no model parcel yet.`}{' '}
          That is not an error while you are setting up — a household landing on a blank cell simply
          cannot be given a parcel until one is chosen, which picking will report when it happens.
        </p>
      )}

      {unknownCells.length > 0 && (
        <p className={styles.infoNotice} role="status">
          {unknownCells.length === 1
            ? '1 cell names a model parcel that no longer exists.'
            : `${String(unknownCells.length)} cells name a model parcel that no longer exists.`}{' '}
          Choose a replacement for each one marked below before saving, or saving will be refused.
        </p>
      )}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <caption className={styles.caption}>Model parcel by household size</caption>
          <thead>
            <tr>
              <th scope="col">Adults ↓ / Children →</th>
              {GRID_CHILDREN.map((children) => (
                <th key={children} scope="col">
                  {children}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GRID_ADULTS.map((adults) => (
              <tr key={adults}>
                <th scope="row">{adults}</th>
                {GRID_CHILDREN.map((children) => {
                  const key = gridCellKey(adults, children);
                  const value = draft[key] ?? '';
                  const isUnknown = unknownCells.includes(key);

                  return (
                    <td key={key}>
                      <select
                        aria-label={`Model parcel for ${describeHouseholdSize(adults, children)}`}
                        className={isUnknown ? styles.unknownCell : styles.select}
                        onChange={(event) => {
                          setCell(key, event.target.value);
                        }}
                        value={value}
                      >
                        <option value="">— none —</option>
                        {isUnknown && <option value={value}>{value} (no longer exists)</option>}
                        {parcels.map((parcel) => (
                          <option key={parcel.id} value={parcel.name}>
                            {parcel.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.formActions}>
        <button
          aria-disabled={save.isPending}
          className={styles.submit}
          onClick={doSave}
          type="button"
        >
          {save.isPending ? 'Saving…' : 'Save the grid'}
        </button>
      </div>

      <PreviewTool />
    </>
  );
}

const HOUSEHOLD_MESSAGES: Record<WholeNumberProblem, string> = {
  empty: 'Enter a number.',
  'not-a-whole-number': 'Use a whole number, for example 3.',
  'below-minimum': 'Enter at least 1.',
  'above-maximum': 'That number is too large.',
};

/**
 * "What would this household receive?" — runs the real endpoint, which runs
 * the real lookup, so this can never show an answer generation would not
 * also give.
 */
function PreviewTool() {
  const stockItems = useStockItems();
  const preview = usePreviewHousehold();
  const [adultsText, setAdultsText] = useState('1');
  const [childrenText, setChildrenText] = useState('0');
  const [result, setResult] = useState<{
    adults: number;
    children: number;
    data: PreviewResult;
  } | null>(null);

  const adultsId = useId();
  const childrenId = useId();
  const adultsErrorId = useId();
  const childrenErrorId = useId();

  const adultsParsed = parseWholeNumber(adultsText, PREVIEW_ADULTS_BOUNDS);
  const childrenParsed = parseWholeNumber(childrenText, PREVIEW_CHILDREN_BOUNDS);

  const run = () => {
    if (!adultsParsed.ok || !childrenParsed.ok) return;

    const adults = adultsParsed.value;
    const children = childrenParsed.value;

    preview.mutate(
      { adults, children },
      {
        onSuccess: (data) => {
          setResult({ adults, children, data });
        },
      },
    );
  };

  const findName = (stockItemId: string): string => {
    if (!stockItems.isSuccess) return stockItemId;
    return stockItems.data.find((item: StockItem) => item.id === stockItemId)?.name ?? stockItemId;
  };

  // Stated from the input the admin typed, not from anything the response
  // says — the server echoes the household back unclamped even when the
  // lookup it ran was clamped. See `describeHouseholdClamping`.
  const clamping =
    result === null ? null : describeHouseholdClamping(result.adults, result.children);

  return (
    <section className={styles.preview}>
      <h2>Preview a household</h2>
      <p className={styles.intro}>What would a household of this size receive right now?</p>

      <div className={styles.previewFields}>
        <div className={styles.field}>
          <label htmlFor={adultsId}>Adults</label>
          <input
            aria-describedby={adultsParsed.ok ? undefined : adultsErrorId}
            aria-invalid={adultsParsed.ok ? undefined : true}
            autoComplete="off"
            className={styles.numberInput}
            id={adultsId}
            inputMode="numeric"
            onChange={(event) => {
              setAdultsText(event.target.value);
            }}
            type="text"
            value={adultsText}
          />
          {!adultsParsed.ok && (
            <p className={styles.fieldError} id={adultsErrorId}>
              {HOUSEHOLD_MESSAGES[adultsParsed.problem]}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={childrenId}>Children</label>
          <input
            aria-describedby={childrenParsed.ok ? undefined : childrenErrorId}
            aria-invalid={childrenParsed.ok ? undefined : true}
            autoComplete="off"
            className={styles.numberInput}
            id={childrenId}
            inputMode="numeric"
            onChange={(event) => {
              setChildrenText(event.target.value);
            }}
            type="text"
            value={childrenText}
          />
          {!childrenParsed.ok && (
            <p className={styles.fieldError} id={childrenErrorId}>
              {HOUSEHOLD_MESSAGES[childrenParsed.problem]}
            </p>
          )}
        </div>

        <button
          aria-disabled={!adultsParsed.ok || !childrenParsed.ok || preview.isPending}
          className={styles.submit}
          onClick={run}
          type="button"
        >
          {preview.isPending ? 'Checking…' : 'Preview'}
        </button>
      </div>

      {preview.error !== null && <ErrorNotice error={preview.error} />}

      {result !== null && (
        <div className={styles.previewResult} role="status">
          {clamping !== null && <p className={styles.clampNotice}>{clamping}</p>}

          {result.data.modelParcelName === undefined ? (
            <p>No model parcel is defined for that household size yet.</p>
          ) : (
            <>
              <p>
                Receives the <strong>{result.data.modelParcelName}</strong>:
              </p>
              <ul>
                {(result.data.lines ?? []).map((line) => (
                  <li key={line.stockItemId}>
                    {findName(line.stockItemId)} × {line.quantity}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
