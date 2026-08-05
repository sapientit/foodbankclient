import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
import {
  SEARCH_MAX_LENGTH,
  useRecordPurchase,
  useStockSearch,
  type PurchaseLine,
  type StockItem,
} from '../queries';
import {
  MAX_PURCHASE_LINES,
  classifyPurchaseFailure,
  parseWholeQuantity,
  type QuantityProblem,
} from '../stock.logic';
import styles from './record-shop-screen.module.css';

/**
 * After a shop: what was bought, in one request.
 *
 * Both roles — shopping is a warehouse job, and the team leader is the person
 * who did it. Everything about this screen is shaped by one fact:
 *
 * **`POST /stock/purchases` has no idempotency key.** The server mints a fresh
 * `purchaseId` every time, so a double-tapped Save records the shop twice. That
 * is real money and a wrong stock figure, and nobody finds out for days, because
 * the two entries look like two ordinary shops. So:
 *
 * - The Save control is guarded by a **synchronous ref**, taken in the click
 *   handler before anything can yield. A `disabled` attribute is not enough on
 *   its own: it is applied on the next render, and a genuine double tap lands
 *   both clicks before React has re-rendered. The control carries
 *   `aria-disabled` rather than `disabled` so the second tap still reaches the
 *   handler — where the ref, the thing actually doing the work, refuses it.
 * - The lock is released **only when the server has said it wrote nothing**. A
 *   network failure or a `5xx` leaves it held, because the shop may well have
 *   been recorded. See `classifyPurchaseFailure`.
 * - There is no Retry on an ambiguous failure. The honest instruction is to go
 *   and look at the levels.
 *
 * `purchasedAt` is deliberately not offered. The server defaults it to now,
 * which is right for a shop being recorded as the bags come in, and a
 * date-and-time field is the one place a volunteer's misconfigured device could
 * silently backdate a ledger entry. If recording yesterday's shop is ever
 * genuinely needed it wants the London wall-clock handling in `lib/london-time`,
 * not an `<input type="datetime-local">`.
 */

const SEARCH_DEBOUNCE_MS = 300;

/** A line being built up. The quantity is text until it is submitted. */
interface DraftLine {
  readonly item: StockItem;
  readonly quantity: string;
}

const QUANTITY_MESSAGES: Record<QuantityProblem, string> = {
  empty: 'Enter how many were bought.',
  'not-a-whole-number': 'Use a whole number of items, for example 6.',
  'below-minimum': 'Enter 1 or more. Remove the line instead of buying none.',
  'too-large': 'That number is too large.',
};

type Outcome =
  | { readonly kind: 'saved'; readonly lines: number }
  /** The request got no answer. It may have saved. Nothing may retry it. */
  | { readonly kind: 'ambiguous' };

export function RecordShopScreen() {
  const [draft, setDraft] = useState<readonly DraftLine[]>([]);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const record = useRecordPurchase();

  /**
   * The double-submit guard. A ref, not state: it has to be true before the
   * second click of a double tap is dispatched, and a state update is not.
   */
  const posting = useRef(false);

  const noteId = useId();
  const refusalId = useId();

  const submit = () => {
    if (posting.current) return;

    if (draft.length === 0) {
      setRefusal('Add at least one item before recording the shop.');
      return;
    }

    if (draft.length > MAX_PURCHASE_LINES) {
      setRefusal(
        `A shop can hold ${String(MAX_PURCHASE_LINES)} items at most. Record the rest as a second shop.`,
      );
      return;
    }

    const lines: PurchaseLine[] = [];
    for (const line of draft) {
      const quantity = parseWholeQuantity(line.quantity, 1);
      if (!quantity.ok) {
        setRefusal(`Check the quantity for ${line.item.name}.`);
        return;
      }
      lines.push({ stockItemId: line.item.id, quantity: quantity.value });
    }

    setRefusal(null);
    posting.current = true;

    const trimmedNote = note.trim();

    record.mutate(
      { lines, ...(trimmedNote === '' ? {} : { note: trimmedNote }) },
      {
        onSuccess: (result) => {
          // The server's own count when it sends one; ours when it does not.
          // Neither field is required by the contract, so neither is asserted.
          setOutcome({ kind: 'saved', lines: result.lines ?? lines.length });
        },
        onError: (error) => {
          const failure = classifyPurchaseFailure(error);
          if (failure === 'ambiguous') {
            setOutcome({ kind: 'ambiguous' });
            return;
          }

          // The server refused it before writing anything, so it is safe to
          // let them fix the list and send it again.
          posting.current = false;
        },
      },
    );
  };

  if (outcome?.kind === 'saved') {
    return (
      <>
        <PageHeader title="Record a shop" />
        <div className={styles.done} role="status">
          <h2 className={styles.doneHeadline}>Shop recorded</h2>
          <p>
            {outcome.lines === 1
              ? 'One item was added to stock.'
              : `${String(outcome.lines)} items were added to stock.`}
          </p>
          <p className={styles.doneActions}>
            <Link to="/stock">Check the stock levels</Link>
            <button
              onClick={() => {
                posting.current = false;
                setDraft([]);
                setNote('');
                setOutcome(null);
                setAnnouncement('');
                record.reset();
              }}
              type="button"
            >
              Record another shop
            </button>
          </p>
        </div>
      </>
    );
  }

  const ambiguous = outcome?.kind === 'ambiguous';

  return (
    <>
      <PageHeader title="Record a shop" />
      <p className={styles.intro}>
        Find each thing you bought, say how many, then record the whole shop in one go. This adds to
        what is already on the shelf rather than replacing it.
      </p>

      {ambiguous ? (
        /*
         * **No Try again, on purpose.** The request may have been recorded
         * before the connection dropped, and a second attempt would be a second
         * shop on the ledger. The only safe next step is to look.
         */
        <div className={styles.ambiguous} role="alert">
          <h2 className={styles.doneHeadline}>We do not know whether this saved</h2>
          <p>
            The shop was sent but no answer came back, so it may already be recorded. Do not record
            it again yet.
          </p>
          <p>
            <strong>Check the stock levels first.</strong> If the numbers have not gone up, come
            back and record the shop again.
          </p>
          <p className={styles.doneActions}>
            {/*
             * A new tab, so that going to look does not throw the list away.
             * There is nowhere this draft is kept — nothing in this app is
             * written to disk — so leaving the page means typing the whole shop
             * out again, which is how somebody ends up guessing instead.
             */}
            <Link rel="noopener" target="_blank" to="/stock">
              Go and check the stock levels (opens a new tab)
            </Link>
          </p>
        </div>
      ) : (
        <>
          {record.error !== null && classifyPurchaseFailure(record.error) === 'unknown-item' && (
            <div className={styles.refused} role="alert">
              <h2 className={styles.doneHeadline}>Nothing was saved</h2>
              <p>
                One of the items on this list is no longer in the stock item list, and a shop is
                recorded all at once or not at all — so <strong>none</strong> of it went in. The
                whole shop is still to record.
              </p>
              <p>
                The server does not say which item. Remove anything that has been retired since you
                started, then record the shop again.
              </p>
            </div>
          )}
          {record.error !== null && classifyPurchaseFailure(record.error) === 'refused' && (
            <ErrorNotice error={record.error} />
          )}
        </>
      )}

      <ItemSearch
        onAdd={(item) => {
          setDraft((current) => {
            const existing = current.find((line) => line.item.id === item.id);
            if (existing === undefined) {
              setAnnouncement(`${item.name} added.`);
              return [...current, { item, quantity: '1' }];
            }

            const parsed = parseWholeQuantity(existing.quantity, 1);
            const next = parsed.ok ? parsed.value + 1 : 1;
            setAnnouncement(
              `${item.name} is already on the list. Quantity is now ${String(next)}.`,
            );

            return current.map((line) =>
              line.item.id === item.id ? { ...line, quantity: String(next) } : line,
            );
          });
        }}
      />

      <p className={styles.announcement} role="status">
        {announcement}
      </p>

      <h2 className={styles.sectionHeading}>What was bought</h2>
      {draft.length === 0 ? (
        <p className={styles.emptyDraft}>Nothing on the list yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Shelf</th>
              <th className={styles.numeric} scope="col">
                How many
              </th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((line) => {
              const parsed = parseWholeQuantity(line.quantity, 1);

              return (
                <tr key={line.item.id}>
                  <th scope="row">{line.item.name}</th>
                  <td>{line.item.shelfNumber}</td>
                  <td className={styles.numeric}>
                    <input
                      aria-invalid={parsed.ok ? undefined : true}
                      aria-label={`How many ${line.item.name}`}
                      autoComplete="off"
                      className={styles.quantity}
                      inputMode="numeric"
                      onChange={(event) => {
                        const { value } = event.target;
                        setDraft((current) =>
                          current.map((row) =>
                            row.item.id === line.item.id ? { ...row, quantity: value } : row,
                          ),
                        );
                      }}
                      type="text"
                      value={line.quantity}
                    />
                    {!parsed.ok && (
                      <span className={styles.fieldError}>{QUANTITY_MESSAGES[parsed.problem]}</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        setDraft((current) =>
                          current.filter((row) => row.item.id !== line.item.id),
                        );
                        setAnnouncement(`${line.item.name} removed.`);
                      }}
                      type="button"
                    >
                      Remove {line.item.name}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className={styles.field}>
        <label htmlFor={noteId}>Note (optional)</label>
        <p className={styles.help} id={`${noteId}-help`}>
          Anything that would help somebody reading the ledger later — which shop, or where the
          receipt is.
        </p>
        <input
          aria-describedby={`${noteId}-help`}
          autoComplete="off"
          className={styles.input}
          id={noteId}
          maxLength={500}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          type="text"
          value={note}
        />
      </div>

      {refusal !== null && (
        <p className={styles.fieldError} id={refusalId}>
          {refusal}
        </p>
      )}

      <div className={styles.formActions}>
        {/*
         * `aria-disabled`, never `disabled`. A disabled button swallows the
         * second tap in the browser and would make the ref lock look unnecessary
         * — and untestable — while leaving it as the only thing that actually
         * holds when the attribute has not been applied yet.
         */}
        <button
          aria-describedby={refusal === null ? undefined : refusalId}
          aria-disabled={ambiguous || record.isPending}
          className={styles.submit}
          onClick={submit}
          type="button"
        >
          {record.isPending ? 'Recording…' : 'Record the shop'}
        </button>
        <Link to="/stock">Cancel</Link>
      </div>
    </>
  );
}

/**
 * The autocomplete. A plain input and a list of buttons rather than an ARIA
 * combobox: it is used with a phone in one hand in a warehouse, every result is
 * reachable by Tab, and there is no custom keyboard model to get wrong.
 */
function ItemSearch({ onAdd }: { onAdd: (item: StockItem) => void }) {
  const [typed, setTyped] = useState('');
  const term = useDebouncedValue(typed.trim(), SEARCH_DEBOUNCE_MS);
  const results = useStockSearch(term);

  const searchId = useId();
  const statusId = useId();

  return (
    <div className={styles.search}>
      <div className={styles.field}>
        <label htmlFor={searchId}>Find an item</label>
        <p className={styles.help} id={`${searchId}-help`}>
          Type part of the name — <code>sug</code> finds <code>Sugar</code>.
        </p>
        <input
          aria-describedby={`${searchId}-help ${statusId}`}
          autoComplete="off"
          className={styles.input}
          id={searchId}
          // Forty is the server's limit and going over it is an error rather
          // than an empty result, so the field cannot exceed it.
          maxLength={SEARCH_MAX_LENGTH}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          type="search"
          value={typed}
        />
      </div>

      <p className={styles.announcement} id={statusId} role="status">
        {results.isSuccess
          ? results.data.length === 0
            ? 'No items match.'
            : `${String(results.data.length)} items found.`
          : ''}
      </p>

      {results.isFetching && <Spinner label="Searching…" />}
      {results.isError && (
        <ErrorNotice error={results.error} onRetry={() => void results.refetch()} />
      )}

      {results.isSuccess && results.data.length > 0 && (
        <ul className={styles.results}>
          {/* Rendered in the order the server sent — alphabetical here, not
              shelf order, because this list is read by somebody who knows the
              name rather than walked by somebody holding a trolley. */}
          {results.data.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => {
                  onAdd(item);
                }}
                type="button"
              >
                Add {item.name}
                <span className={styles.resultShelf}> (shelf {item.shelfNumber})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
