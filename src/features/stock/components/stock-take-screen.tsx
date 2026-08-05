import { useId, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatLondonDateTime } from '../../../lib/london-time';
import {
  useCommitStockTake,
  useOpenStockTake,
  useRecordCounts,
  useStockLevels,
  useStockTakes,
  type CommitResult,
  type StockCount,
  type StockLevel,
} from '../queries';
import {
  countableLevels,
  describeVariances,
  openStockTakes,
  parseWholeQuantity,
  type QuantityProblem,
} from '../stock.logic';
import styles from './stock-take-screen.module.css';

/**
 * Counting the shelves, and reconciling what is there against what the ledger
 * believes. Both roles: this is warehouse work.
 *
 * **One page, every item, one Save, then Commit — and that is a deliberate
 * choice against the grain of the API.** `POST /takes/{id}/counts` is batched,
 * repeatable and upserted by item, which makes drip-feeding a shelf at a time
 * look like the intended pattern. It is not usable as one, because **there is no
 * `GET /stock/takes/{id}`**: recorded counts cannot be read back, so after a
 * reload — a dropped connection, a locked phone, a closed tab — the shelves
 * already counted would be indistinguishable from the ones still to do, and the
 * operator would have no way to tell which was which. Counting the lot on one
 * page is resumable by not needing to resume.
 *
 * **Do not "improve" this into shelf-at-a-time until `GET /stock/takes/{id}`
 * exists.** The day it does, this screen can show what has already been recorded
 * and the drip-feed becomes safe. It is on the list to ask the server for.
 *
 * The other constraint shapes the entry: **`abandoned` is unreachable through
 * the API and several takes can be open at once.** A mis-clicked take is
 * permanent — there is no route that discards one — so starting one is confirmed
 * first, an existing open take is resumed rather than duplicated, and where
 * somebody has already made several the operator is told plainly that the extras
 * cannot be tidied away.
 */
export function StockTakeScreen() {
  const takes = useStockTakes();
  const [chosen, setChosen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const open = useOpenStockTake();

  if (takes.isPending) {
    return (
      <>
        <PageHeader title="Stock take" />
        <Spinner label="Looking for a stock take…" />
      </>
    );
  }

  if (takes.isError) {
    return (
      <>
        <PageHeader title="Stock take" />
        <ErrorNotice error={takes.error} onRetry={() => void takes.refetch()} />
      </>
    );
  }

  const openTakes = openStockTakes(takes.data);
  const soleOpen = openTakes.length === 1 ? openTakes[0] : undefined;

  /*
   * `chosen` wins over the list, and it wins **even when the list does not
   * contain it yet**. The list is refetched after a take is opened, and until
   * that lands the screen would otherwise fall back to "no stock take is open"
   * and offer Start again — to somebody who has just started one. There is no
   * route that discards a stock take, so that bounce would leave permanent
   * litter, which is the exact failure this screen exists to prevent.
   */
  const activeId = chosen ?? soleOpen?.id;
  const active = openTakes.find((take) => take.id === activeId);

  if (activeId !== undefined) {
    return (
      <CountSheet
        // Remounting on a change of take throws away counts typed against the
        // previous one, which is the only safe thing to do with them.
        key={activeId}
        others={openTakes.filter((take) => take.id !== activeId).length}
        // Absent while the refetched list catches up with a take just opened.
        startedAt={active?.countedAt ?? null}
        takeId={activeId}
      />
    );
  }

  if (openTakes.length > 1) {
    return (
      <>
        <PageHeader title="Stock take" />
        <div className={styles.warning} role="alert">
          <h2 className={styles.panelHeadline}>There is more than one stock take open</h2>
          <p>
            Choose the one you are counting. <strong>The others cannot be removed</strong> — there
            is no way to discard a stock take once it has been opened, so they will stay on this
            list until somebody commits them.
          </p>
        </div>
        <ul className={styles.takeList}>
          {openTakes.map((take) => (
            <li key={take.id}>
              <button
                onClick={() => {
                  setChosen(take.id);
                }}
                type="button"
              >
                Count the stock take started {formatLondonDateTime(take.countedAt)}
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Stock take" />
      <EmptyState
        action={
          <button
            className={styles.primary}
            onClick={() => {
              setConfirming(true);
            }}
            type="button"
          >
            Start a stock take
          </button>
        }
        headline="No stock take is open"
        sentence="A stock take records what is actually on the shelves, then corrects the ledger to match it."
      />

      {open.error !== null && <ErrorNotice error={open.error} />}

      {confirming && (
        <ConfirmDialog
          busy={open.isPending}
          confirmLabel="Start the stock take"
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            open.mutate(undefined, {
              onSuccess: (result) => {
                setConfirming(false);
                // The id comes back optional in the contract, so nothing here
                // asserts it. The refetched list is the reliable source either
                // way, and it will contain exactly one open take.
                if (result.id !== undefined) setChosen(result.id);
              },
            });
          }}
          title="Start a stock take?"
        >
          {/*
           * The honest warning, because the person clicking is the only one who
           * can avoid the problem: there is no route that discards a stock take.
           */}
          <p>
            <strong>A stock take cannot be cancelled.</strong> Once it is started the only way to
            close it is to count the shelves and commit the result.
          </p>
          <p>
            Starting one moves no stock. Stock moves when you commit, and only for items whose count
            differs from the ledger.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

const COUNT_MESSAGES: Record<QuantityProblem, string> = {
  empty: 'Enter a number, or leave it blank if you have not counted it.',
  'not-a-whole-number': 'Use a whole number, for example 6.',
  'below-minimum': 'A count cannot be negative. Enter 0 for an empty shelf.',
  'too-large': 'That number is too large.',
};

function CountSheet({
  takeId,
  startedAt,
  others,
}: {
  takeId: string;
  /** Null while the refetched list has not caught up with a take just opened. */
  startedAt: string | null;
  others: number;
}) {
  const levels = useStockLevels();
  const save = useRecordCounts();
  const commit = useCommitStockTake();

  const [counts, setCounts] = useState<Readonly<Record<string, string>>>({});
  const [saved, setSaved] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);

  const refusalId = useId();

  if (levels.isPending) {
    return (
      <>
        <PageHeader title="Stock take" />
        <Spinner label="Loading the shelves…" />
      </>
    );
  }

  if (levels.isError) {
    return (
      <>
        <PageHeader title="Stock take" />
        <ErrorNotice error={levels.error} onRetry={() => void levels.refetch()} />
      </>
    );
  }

  if (result !== null) {
    return <CommitOutcome levels={levels.data} result={result} />;
  }

  const rows = countableLevels(levels.data);

  const collect = (): StockCount[] | null => {
    const collected: StockCount[] = [];

    for (const row of rows) {
      const typed = counts[row.id] ?? '';
      // Blank means not counted, and not counted means untouched. It is the
      // only way to say "I did not get to this shelf" on a screen that has no
      // way of remembering which shelves it has already been told about.
      if (typed.trim() === '') continue;

      const parsed = parseWholeQuantity(typed, 0);
      if (!parsed.ok) {
        setRefusal(`Check the count for ${row.name}.`);
        return null;
      }

      collected.push({ stockItemId: row.id, countedQuantity: parsed.value });
    }

    if (collected.length === 0) {
      setRefusal('Enter at least one count before saving.');
      return null;
    }

    return collected;
  };

  return (
    <>
      <PageHeader title="Stock take" />

      <div className={styles.banner} role="status">
        <p>
          {startedAt === null
            ? 'Counting the stock take you have just started.'
            : `Counting the stock take started ${formatLondonDateTime(startedAt)}.`}
          {others > 0 && (
            <>
              {' '}
              {others === 1
                ? 'One other stock take is open and cannot be removed.'
                : `${String(others)} other stock takes are open and cannot be removed.`}
            </>
          )}
        </p>
      </div>

      <p className={styles.intro}>
        Every item is on this one page, in the order you walk the shelves. Count what is there and
        type it in. <strong>Leave anything you have not counted blank</strong> — a blank is left
        alone, and a zero means the shelf is empty.
      </p>
      <p className={styles.intro}>
        Save as often as you like. Committing is the last step: it corrects the ledger for every
        item whose count differs, and that is when stock moves.
      </p>

      {save.error !== null && <ErrorNotice error={save.error} />}
      {commit.error !== null && <ErrorNotice error={commit.error} />}

      {saved !== null && (
        <p className={styles.savedNotice} role="status">
          {saved === 1 ? 'One count saved.' : `${String(saved)} counts saved.`}
        </p>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Shelf</th>
            <th className={styles.numeric} scope="col">
              Ledger says
            </th>
            <th className={styles.numeric} scope="col">
              Counted
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Server order, never re-sorted: this is the order the aisle is
              walked in, and re-sorting it sends somebody back down it. */}
          {rows.map((row) => {
            const typed = counts[row.id] ?? '';
            const parsed = typed.trim() === '' ? null : parseWholeQuantity(typed, 0);

            return (
              <tr key={row.id}>
                <th scope="row">
                  {row.name}
                  {!row.isActive && <span className={styles.retired}> (retired)</span>}
                </th>
                <td>{row.shelfNumber}</td>
                <td className={styles.numeric}>{row.quantityOnHand}</td>
                <td className={styles.numeric}>
                  <input
                    aria-invalid={parsed === null || parsed.ok ? undefined : true}
                    aria-label={`Counted ${row.name}`}
                    autoComplete="off"
                    className={styles.count}
                    inputMode="numeric"
                    onChange={(event) => {
                      const { value } = event.target;
                      setCounts((current) => ({ ...current, [row.id]: value }));
                    }}
                    type="text"
                    value={typed}
                  />
                  {parsed !== null && !parsed.ok && (
                    <span className={styles.fieldError}>{COUNT_MESSAGES[parsed.problem]}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {refusal !== null && (
        <p className={styles.fieldError} id={refusalId}>
          {refusal}
        </p>
      )}

      <div className={styles.formActions}>
        <button
          aria-describedby={refusal === null ? undefined : refusalId}
          className={styles.primary}
          onClick={() => {
            const collected = collect();
            if (collected === null) return;

            setRefusal(null);
            save.mutate(
              { id: takeId, counts: collected },
              {
                onSuccess: () => {
                  setSaved(collected.length);
                },
              },
            );
          }}
          type="button"
        >
          {save.isPending ? 'Saving…' : 'Save counts'}
        </button>
        <button
          onClick={() => {
            setConfirming(true);
          }}
          type="button"
        >
          Commit the stock take
        </button>
        <Link to="/stock">Back to stock</Link>
      </div>

      {confirming && (
        <ConfirmDialog
          busy={commit.isPending}
          confirmLabel="Commit and correct the ledger"
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            commit.mutate(takeId, {
              onSuccess: (committed) => {
                setConfirming(false);
                setResult(committed);
              },
              onError: () => {
                setConfirming(false);
              },
            });
          }}
          title="Commit this stock take?"
        >
          <p>
            Every item whose count differs from the ledger gets a correction, and{' '}
            <strong>that moves stock</strong>. Items you did not count are left alone.
          </p>
          {/*
           * The one thing this screen cannot check for them. Counts live only on
           * the server once saved, and there is no endpoint to read them back,
           * so "did I save?" is a question only the operator can answer.
           */}
          <p>
            Committing uses the counts that have been <strong>saved</strong>. Anything typed on this
            page that has not been saved is not included — save first if you are not sure.
          </p>
          <p>This cannot be undone. A mistake afterwards is a hand adjustment.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function CommitOutcome({
  result,
  levels,
}: {
  result: CommitResult;
  levels: readonly StockLevel[];
}) {
  const variances = describeVariances(result.adjustments ?? [], levels);

  return (
    <>
      <PageHeader title="Stock take" />
      {variances.length === 0 ? (
        /*
         * **An empty list is a result, not an absence.** The server returns only
         * the items whose count differed, so nothing back means every shelf
         * counted matched the ledger — which is the best possible outcome and
         * has to read like one. An empty table with a "no rows" message would
         * say the opposite.
         */
        <div className={styles.matched} role="status">
          <h2 className={styles.panelHeadline}>Everything matched</h2>
          <p>
            Every item you counted agreed with the ledger, so nothing needed correcting and no stock
            moved. The stock take is committed.
          </p>
          <p>
            <Link to="/stock">Back to stock</Link>
          </p>
        </div>
      ) : (
        <>
          <div className={styles.banner} role="status">
            <h2 className={styles.panelHeadline}>Stock take committed</h2>
            <p>
              {variances.length === 1
                ? 'One item did not match the ledger and has been corrected.'
                : `${String(variances.length)} items did not match the ledger and have been corrected.`}{' '}
              Everything else you counted agreed with it.
            </p>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th className={styles.numeric} scope="col">
                  Ledger said
                </th>
                <th className={styles.numeric} scope="col">
                  Counted
                </th>
                <th className={styles.numeric} scope="col">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {variances.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.name}</th>
                  {/* Every number on an adjustment is optional in the contract,
                      so an em dash rather than the string `undefined`. */}
                  <td className={styles.numeric}>{row.expected ?? '—'}</td>
                  <td className={styles.numeric}>{row.counted ?? '—'}</td>
                  <td className={styles.numeric}>
                    {row.delta === null ? '—' : row.delta > 0 ? `+${String(row.delta)}` : row.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.formActions}>
            <Link to="/stock">Back to stock</Link>
          </p>
        </>
      )}
    </>
  );
}
