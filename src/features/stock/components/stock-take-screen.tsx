import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { EmptyState } from '../../../components/empty-state';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { countableLevels, parseWholeQuantity, type QuantityProblem } from '../stock.logic';
import { useSaveStockTake, useStockLevels, type StockTakeCount } from '../queries';
import styles from './stock-take-screen.module.css';

const PAGE_SIZE = 40;
const MAX_COUNT = 100_000;

const COUNT_MESSAGES: Record<QuantityProblem | 'too-many', string> = {
  empty: 'Enter a count or leave this field alone.',
  'not-a-whole-number': 'Use a whole number of items.',
  'below-minimum': 'A count cannot be below zero.',
  'too-large': `Use ${String(MAX_COUNT)} or fewer.`,
  'too-many': 'This page has too many changed items to save.',
};

/**
 * A weekly count has no server-side lifecycle. Each page is saved on its own,
 * and only values differing from the last confirmed level are sent: submitting
 * an unchanged row would replace history the charity intends to retain.
 */
export function StockTakeScreen() {
  const levels = useStockLevels();
  const save = useSaveStockTake();
  const [page, setPage] = useState(0);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [baselines, setBaselines] = useState<Record<string, number>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  if (levels.isPending)
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

  const rows = countableLevels(levels.data);
  if (rows.length === 0)
    return (
      <>
        <PageHeader title="Stock take" />
        <EmptyState
          headline="No stock to count"
          sentence="Add a stock item before taking a count."
          action={<Link to="/stock/items/new">Add a stock item</Link>}
        />
      </>
    );

  const pageCount = Math.ceil(rows.length / PAGE_SIZE);
  const currentPage = Math.min(page, pageCount - 1);
  const first = currentPage * PAGE_SIZE;
  const pageRows = rows.slice(first, first + PAGE_SIZE);

  const baselineFor = (id: string, fallback: number): number => baselines[id] ?? fallback;

  const savePage = async () => {
    const nextErrors: Record<string, string> = {};
    const counts: StockTakeCount[] = [];

    for (const row of pageRows) {
      const value = typed[row.id];
      if (value === undefined || value.trim() === '') continue;

      const parsed = parseWholeQuantity(value, 0);
      if (!parsed.ok) {
        nextErrors[row.id] = COUNT_MESSAGES[parsed.problem];
        continue;
      }
      if (parsed.value > MAX_COUNT) {
        nextErrors[row.id] = COUNT_MESSAGES['too-large'];
        continue;
      }
      if (parsed.value !== baselineFor(row.id, row.quantityOnHand)) {
        counts.push({ stockItemId: row.id, countedQuantity: parsed.value });
      }
    }

    if (counts.length > 200) nextErrors.page = COUNT_MESSAGES['too-many'];
    setFieldErrors(nextErrors);
    setSavedMessage(null);
    if (Object.keys(nextErrors).length > 0) return;
    if (counts.length === 0) {
      setSavedMessage('Nothing changed on this page. Nothing was saved.');
      return;
    }

    try {
      const result = await save.mutateAsync(counts);
      setBaselines((current) => {
        const next = { ...current };
        for (const level of result.levels) next[level.stockItemId] = level.quantityOnHand;
        return next;
      });
      setTyped((current) => {
        const savedIds = new Set(counts.map((count) => count.stockItemId));
        return Object.fromEntries(Object.entries(current).filter(([id]) => !savedIds.has(id)));
      });
      setSavedMessage(
        result.applied === 1
          ? 'One changed count saved.'
          : `${String(result.applied)} changed counts saved.`,
      );
    } catch {
      // ErrorNotice renders the parsed server error; keep the entered values to fix or retry.
    }
  };

  return (
    <>
      <PageHeader title="Stock take" />
      <p className={styles.intro}>
        Count the shelves one page at a time. The current level is shown for reference; only a
        number different from it is saved. Leave a field blank when it has not changed.
      </p>
      <p>
        Page {String(currentPage + 1)} of {String(pageCount)} — items {String(first + 1)}–
        {String(first + pageRows.length)} of {String(rows.length)}.
      </p>
      {savedMessage !== null && (
        <p className={styles.savedNotice} role="status">
          {savedMessage}
        </p>
      )}
      {save.error !== null && <ErrorNotice error={save.error} />}
      {fieldErrors.page !== undefined && <p className={styles.fieldError}>{fieldErrors.page}</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Shelf</th>
            <th className={styles.numeric} scope="col">
              Current level
            </th>
            <th scope="col">Counted quantity</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => {
            const id = `count-${row.id}`;
            return (
              <tr key={row.id}>
                <th scope="row">
                  {row.name}
                  {!row.isActive && <span className={styles.retired}> (retired)</span>}
                </th>
                <td>{row.shelfNumber}</td>
                <td className={styles.numeric}>{baselineFor(row.id, row.quantityOnHand)}</td>
                <td>
                  <label className={styles.visuallyHidden} htmlFor={id}>
                    Counted {row.name}
                  </label>
                  <input
                    aria-describedby={fieldErrors[row.id] === undefined ? undefined : `${id}-error`}
                    aria-invalid={fieldErrors[row.id] !== undefined}
                    className={styles.count}
                    id={id}
                    inputMode="numeric"
                    onChange={(event) => {
                      const value = event.target.value;
                      setTyped((current) => ({ ...current, [row.id]: value }));
                      setFieldErrors((current) => {
                        const { [row.id]: _ignored, ...rest } = current;
                        return rest;
                      });
                    }}
                    type="text"
                    value={typed[row.id] ?? ''}
                  />
                  {fieldErrors[row.id] !== undefined && (
                    <span className={styles.fieldError} id={`${id}-error`}>
                      {fieldErrors[row.id]}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.formActions}>
        <button
          className={styles.primary}
          disabled={save.isPending}
          onClick={() => void savePage()}
          type="button"
        >
          {save.isPending ? 'Saving…' : 'Save this page'}
        </button>
        {currentPage > 0 && (
          <button
            onClick={() => {
              setPage(currentPage - 1);
              setSavedMessage(null);
            }}
            type="button"
          >
            Previous page
          </button>
        )}
        {currentPage + 1 < pageCount && (
          <button
            onClick={() => {
              setPage(currentPage + 1);
              setSavedMessage(null);
            }}
            type="button"
          >
            Next page
          </button>
        )}
        <Link to="/stock">Back to stock</Link>
      </div>
    </>
  );
}
