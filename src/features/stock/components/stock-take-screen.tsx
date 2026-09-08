import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError } from '../../../lib/errors';
import {
  applyPackingUnit,
  computeCrateReferenceCount,
  countableLevels,
  packUnitLabelFor,
  parseOneDecimalQuantity,
  parseWholeQuantity,
  type QuantityProblem,
} from '../stock.logic';
import {
  useCrates,
  useSaveStockTake,
  useStockLevels,
  useStockTakeGroupings,
  type Crate,
  type StockTakeCount,
  type StockTakeCrateCount,
  type StockLevel,
} from '../queries';
import styles from './stock-take-screen.module.css';

const MAX_COUNT = 100_000;
const PAGE_SIZE = 40;
const COUNT_MESSAGES: Record<QuantityProblem | 'too-many', string> = {
  empty: 'Enter a count or leave this field alone.',
  'not-a-whole-number': 'Use a number with at most one decimal place.',
  'below-minimum': 'A count cannot be below zero.',
  'too-large': `Use ${String(MAX_COUNT)} or fewer.`,
  'too-many': 'This grouping has too many changed lines to save at once.',
};
const WHOLE_UNIT_COUNT_MESSAGE = 'Use a whole number of individual units.';

type StockTakeRow =
  | { readonly kind: 'item'; readonly level: StockLevel }
  | { readonly kind: 'crate'; readonly crate: Crate };

/**
 * A real stock take: one grouping at a time, with direct and explicit crate
 * counts kept separate.
 *
 * `onAuthError` is how the no-account counting screen (`/count`) hears that the
 * volunteer code has lapsed: on this screen a 401 is a final answer, not a
 * token to refresh, so the wrapper clears the code and shows the "ask your team
 * leader for a new one" message. A signed-in team lead passes nothing — a 401
 * there was already handled by `auth-fetch`'s refresh before it could reach
 * here.
 */
export function StockTakeScreen({ onAuthError }: { readonly onAuthError?: () => void } = {}) {
  const levels = useStockLevels();
  const groupings = useStockTakeGroupings();
  const crates = useCrates();
  const save = useSaveStockTake();
  const [groupingId, setGroupingId] = useState('');
  const [page, setPage] = useState(0);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [baselines, setBaselines] = useState<Record<string, number>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const model = useMemo(() => {
    if (levels.data === undefined || crates.data === undefined || groupingId === '') return null;
    const crateMemberIds = new Set(
      crates.data.flatMap((crate) => crate.members.map((member) => member.stockItemId)),
    );
    const direct = countableLevels(levels.data).filter(
      (level) => level.groupingId === groupingId && !crateMemberIds.has(level.id),
    );
    const groupingCrates = crates.data.filter((crate) => crate.groupingId === groupingId);
    const rows: readonly StockTakeRow[] = [
      ...direct.map((level, index) => ({
        row: { kind: 'item' as const, level },
        index,
        shelfSortKey: level.shelfSortKey,
      })),
      ...groupingCrates.map((crate, index) => ({
        row: { kind: 'crate' as const, crate },
        index: direct.length + index,
        shelfSortKey: crate.shelfSortKey,
      })),
    ]
      .sort((left, right) => {
        if (left.shelfSortKey === right.shelfSortKey) return left.index - right.index;
        return left.shelfSortKey < right.shelfSortKey ? -1 : 1;
      })
      .map(({ row }) => row);
    return {
      direct,
      crates: groupingCrates,
      rows,
    };
  }, [crates.data, groupingId, levels.data]);
  const pageCount = model === null ? 0 : Math.max(1, Math.ceil(model.rows.length / PAGE_SIZE));
  const pageIndex = Math.min(page, Math.max(0, pageCount - 1));
  const pageRows = model?.rows.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE) ?? [];
  const pageDirect = pageRows.flatMap((row) => (row.kind === 'item' ? [row.level] : []));
  const pageCrates = pageRows.flatMap((row) => (row.kind === 'crate' ? [row.crate] : []));

  const codeExpired =
    onAuthError !== undefined &&
    [levels.error, groupings.error, crates.error, save.error].some(
      (error) => error instanceof ApiError && error.status === 401,
    );
  useEffect(() => {
    if (codeExpired) onAuthError();
  }, [codeExpired, onAuthError]);
  // The wrapper is about to swap this screen for the expiry message; render
  // nothing in the meantime rather than a scary error notice.
  if (codeExpired) return null;

  if (levels.isPending || groupings.isPending || crates.isPending)
    return (
      <>
        <PageHeader title="Stock take" />
        <Spinner label="Loading stock levels…" />
      </>
    );
  if (levels.isError)
    return (
      <>
        <PageHeader title="Stock take" />
        <ErrorNotice error={levels.error} onRetry={() => void levels.refetch()} />
      </>
    );
  if (groupings.isError)
    return (
      <>
        <PageHeader title="Stock take" />
        <ErrorNotice error={groupings.error} onRetry={() => void groupings.refetch()} />
      </>
    );
  if (crates.isError)
    return (
      <>
        <PageHeader title="Stock take" />
        <ErrorNotice error={crates.error} onRetry={() => void crates.refetch()} />
      </>
    );

  const baselineFor = (id: string, fallback: number) => baselines[id] ?? fallback;
  const effectiveLevels = levels.data.map((level) => ({
    ...level,
    quantityOnHand: baselineFor(level.id, level.quantityOnHand),
  }));
  const change = (key: string, value: string) => {
    setTyped((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const { [key]: _ignored, ...rest } = current;
      return rest;
    });
    setSavedMessage(null);
  };
  const changePackedCount = (
    itemKey: string,
    packKey: string,
    unitsPerPack: number,
    value: string,
  ) => {
    setTyped((current) => {
      const next = { ...current, [packKey]: value };
      const parsed = parseOneDecimalQuantity(value, 0);
      if (parsed.ok) next[itemKey] = String(applyPackingUnit(parsed.value, unitsPerPack));
      else {
        const { [itemKey]: _individualCount, ...withoutIndividualCount } = next;
        return withoutIndividualCount;
      }
      return next;
    });
    setFieldErrors((current) => {
      const { [itemKey]: _itemError, [packKey]: _packError, ...rest } = current;
      return rest;
    });
    setSavedMessage(null);
  };
  const saveGrouping = async () => {
    if (model === null) return;
    const errors: Record<string, string> = {};
    const counts: StockTakeCount[] = [];
    const crateCounts: StockTakeCrateCount[] = [];
    for (const level of pageDirect) {
      const key = `item-${level.id}`;
      const packKey = `pack-${level.id}`;
      const packValue = typed[packKey];
      if (packValue !== undefined && packValue.trim() !== '') {
        const parsedPack = parseOneDecimalQuantity(packValue, 0);
        if (!parsedPack.ok) {
          errors[packKey] = COUNT_MESSAGES[parsedPack.problem];
          continue;
        }
      }
      const value = typed[key];
      if (value === undefined || value.trim() === '') continue;
      const parsed = parseWholeQuantity(value, 0);
      if (!parsed.ok) {
        errors[key] =
          parsed.problem === 'not-a-whole-number'
            ? WHOLE_UNIT_COUNT_MESSAGE
            : COUNT_MESSAGES[parsed.problem];
        continue;
      }
      const countedQuantity = parsed.value;
      if (countedQuantity > MAX_COUNT) {
        errors[key] = COUNT_MESSAGES['too-large'];
        continue;
      }
      if (countedQuantity !== baselineFor(level.id, level.quantityOnHand))
        counts.push({ stockItemId: level.id, countedQuantity });
    }
    for (const crate of pageCrates) {
      const key = `crate-${crate.id}`;
      const value = typed[key];
      if (value === undefined || value.trim() === '') continue;
      const parsed = parseOneDecimalQuantity(value, 0);
      if (!parsed.ok) {
        errors[key] = COUNT_MESSAGES[parsed.problem];
        continue;
      }
      if (parsed.value > MAX_COUNT) {
        errors[key] = COUNT_MESSAGES['too-large'];
        continue;
      }
      if (parsed.value !== computeCrateReferenceCount(crate, effectiveLevels))
        crateCounts.push({ crateId: crate.id, enteredCount: parsed.value });
    }
    if (counts.length + crateCounts.length > 200) errors.page = COUNT_MESSAGES['too-many'];
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (counts.length + crateCounts.length === 0) {
      setSavedMessage('Nothing changed in this grouping. Nothing was saved.');
      return;
    }
    try {
      const result = await save.mutateAsync({ counts, crateCounts });
      setBaselines((current) => {
        const next: Record<string, number> = { ...current };
        for (const level of result.levels) next[level.stockItemId] = level.quantityOnHand;
        return next;
      });
      const savedKeys = new Set([
        ...counts.map((count) => `item-${count.stockItemId}`),
        ...counts.map((count) => `pack-${count.stockItemId}`),
        ...crateCounts.map((count) => `crate-${count.crateId}`),
      ]);
      setTyped((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => !savedKeys.has(key))),
      );
      setSavedMessage(
        result.applied === 1
          ? 'One changed count saved.'
          : `${String(result.applied)} changed counts saved.`,
      );
    } catch {
      /* keep entered values so the server error can be read and corrected */
    }
  };

  return (
    <>
      <PageHeader title="Stock take" />
      <p className={styles.intro}>
        Choose a grouping. Count direct items in their displayed unit, or count a crate as a whole.
        Leave an unchanged row blank.
      </p>
      <p>
        <label htmlFor="stock-take-grouping">Grouping </label>
        <select
          id="stock-take-grouping"
          onChange={(event) => {
            setGroupingId(event.target.value);
            setPage(0);
            setTyped({});
            setFieldErrors({});
            setSavedMessage(null);
          }}
          value={groupingId}
        >
          <option value="">Choose a grouping…</option>
          {groupings.data.map((grouping) => (
            <option key={grouping.id} value={grouping.id}>
              {grouping.name}
            </option>
          ))}
        </select>
      </p>
      {groupingId !== '' && model !== null && (
        <>
          {savedMessage !== null && (
            <p className={styles.savedNotice} role="status">
              {savedMessage}
            </p>
          )}
          {save.error !== null && <ErrorNotice error={save.error} />}
          {fieldErrors.page !== undefined && (
            <p className={styles.fieldError}>{fieldErrors.page}</p>
          )}
          {model.rows.length === 0 ? (
            <EmptyState
              headline="Nothing to count in this grouping"
              sentence="An administrator may need to assign items or crates, then check Stock validation."
            />
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Item or crate</th>
                  <th scope="col">Shelf</th>
                  <th className={styles.numeric} scope="col">
                    Current level
                  </th>
                  <th scope="col">Counted quantity</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  if (row.kind === 'item') {
                    const level = row.level;
                    const key = `item-${level.id}`;
                    const packKey = `pack-${level.id}`;
                    const current = baselineFor(level.id, level.quantityOnHand);
                    const unitsPerPack = level.unitsPerPack;
                    return (
                      <tr key={level.id}>
                        <th scope="row">{level.name}</th>
                        <td>{level.shelfNumber}</td>
                        <td className={styles.numeric}>{String(current)}</td>
                        <td>
                          <label className={styles.visuallyHidden} htmlFor={key}>
                            Counted {level.name} individually
                          </label>
                          <input
                            aria-describedby={
                              fieldErrors[key] === undefined ? undefined : `${key}-error`
                            }
                            aria-invalid={fieldErrors[key] !== undefined}
                            className={styles.count}
                            id={key}
                            inputMode="numeric"
                            onChange={(event) => {
                              change(key, event.target.value);
                              setTyped((current) => {
                                const { [packKey]: _packCount, ...rest } = current;
                                return rest;
                              });
                            }}
                            type="text"
                            value={typed[key] ?? ''}
                          />
                          {fieldErrors[key] !== undefined && (
                            <span className={styles.fieldError} id={`${key}-error`}>
                              {fieldErrors[key]}
                            </span>
                          )}
                          {unitsPerPack !== null && (
                            <label className={styles.packCount} htmlFor={packKey}>
                              or {packUnitLabelFor(level)} of {String(unitsPerPack)}
                              <input
                                aria-label={`Counted ${level.name} in ${packUnitLabelFor(level)} of ${String(unitsPerPack)}`}
                                aria-describedby={
                                  fieldErrors[packKey] === undefined
                                    ? undefined
                                    : `${packKey}-error`
                                }
                                aria-invalid={fieldErrors[packKey] !== undefined}
                                className={styles.count}
                                id={packKey}
                                inputMode="decimal"
                                onChange={(event) => {
                                  changePackedCount(key, packKey, unitsPerPack, event.target.value);
                                }}
                                type="text"
                                value={typed[packKey] ?? ''}
                              />
                            </label>
                          )}
                          {fieldErrors[packKey] !== undefined && (
                            <span className={styles.fieldError} id={`${packKey}-error`}>
                              {fieldErrors[packKey]}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  }
                  const crate = row.crate;
                  const key = `crate-${crate.id}`;
                  const reference = computeCrateReferenceCount(crate, effectiveLevels);
                  const parsed =
                    typed[key] === undefined || typed[key].trim() === ''
                      ? null
                      : parseOneDecimalQuantity(typed[key], 0);
                  return (
                    <tr key={crate.id}>
                      <th scope="row">
                        {crate.name}
                        <span className={styles.retired}> ({crate.members.length} items)</span>
                      </th>
                      <td>{crate.shelfKey}</td>
                      <td className={styles.numeric}>{reference.toFixed(1)} crates</td>
                      <td>
                        <label className={styles.visuallyHidden} htmlFor={key}>
                          Counted {crate.name} crates
                        </label>
                        <input
                          aria-describedby={
                            fieldErrors[key] === undefined ? undefined : `${key}-error`
                          }
                          aria-invalid={fieldErrors[key] !== undefined}
                          className={styles.count}
                          id={key}
                          inputMode="decimal"
                          onChange={(event) => {
                            change(key, event.target.value);
                          }}
                          type="text"
                          value={typed[key] ?? ''}
                        />
                        {fieldErrors[key] !== undefined && (
                          <span className={styles.fieldError} id={`${key}-error`}>
                            {fieldErrors[key]}
                          </span>
                        )}
                        <CratePreview
                          crate={crate}
                          enteredCount={parsed?.ok ? parsed.value : null}
                          levels={levels.data}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {pageCount > 1 && (
            <nav aria-label="Stock take pages" className={styles.pagination}>
              <p>
                Page {String(pageIndex + 1)} of {String(pageCount)} — items{' '}
                {String(pageIndex * PAGE_SIZE + 1)}–
                {String(Math.min((pageIndex + 1) * PAGE_SIZE, model.rows.length))} of{' '}
                {String(model.rows.length)}.
              </p>
              <button
                className="button-secondary"
                disabled={pageIndex === 0}
                onClick={() => {
                  setPage(pageIndex - 1);
                  setTyped({});
                  setFieldErrors({});
                  setSavedMessage(null);
                }}
                type="button"
              >
                Previous page
              </button>{' '}
              <button
                className="button-secondary"
                disabled={pageIndex === pageCount - 1}
                onClick={() => {
                  setPage(pageIndex + 1);
                  setTyped({});
                  setFieldErrors({});
                  setSavedMessage(null);
                }}
                type="button"
              >
                Next page
              </button>
            </nav>
          )}
          <div className={styles.formActions}>
            <button
              className={styles.primary}
              disabled={save.isPending}
              onClick={() => void saveGrouping()}
              type="button"
            >
              {save.isPending ? 'Saving…' : 'Save this page'}
            </button>
            {/* A volunteer on a code has no `/stock` to go back to — it is
                guarded, and the link would bounce them to sign-in. Their way out
                is "Finish counting" in the counting screen's own frame. */}
            {onAuthError === undefined && (
              <Link className="button-link button-secondary" to="/stock">
                Back to stock
              </Link>
            )}
          </div>
        </>
      )}
    </>
  );
}

function CratePreview({
  crate,
  enteredCount,
  levels,
}: {
  readonly crate: {
    readonly sizePerCrate: number;
    readonly members: readonly {
      readonly stockItemId: string;
      readonly stockCompositionPercent: number;
    }[];
  };
  readonly enteredCount: number | null;
  readonly levels: readonly { readonly id: string; readonly name: string }[];
}) {
  const names = new Map(levels.map((level) => [level.id, level.name]));
  return (
    <ul aria-label="Crate composition" className={styles.crateComposition}>
      {crate.members.map((member) => (
        <li key={member.stockItemId}>
          {names.get(member.stockItemId) ?? member.stockItemId}: {member.stockCompositionPercent}%
          {enteredCount !== null &&
            ` — ${String(
              Math.round(
                (enteredCount * crate.sizePerCrate * member.stockCompositionPercent) / 100,
              ),
            )}`}
        </li>
      ))}
    </ul>
  );
}
