import { Fragment, useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';
import { parseWholeNumber } from '../../../lib/whole-number';
import {
  TARGET_QUANTITY_BOUNDS,
  type AttentionRow,
  type CrateTargetDraft,
  type EditorRow,
} from '../target-stock-lists.logic';
import styles from './target-stock-list-form.module.css';

/**
 * The shared body of the create and amend screens: every active stock item,
 * grouped by category, with a box for how many the food bank wants to hold.
 * **A blank box means the item is not on the list** — clearing a box is how a
 * line is removed, so there is no per-row delete for an active item.
 *
 * Retired and missing stored lines arrive in `attention`. Each must be removed
 * (or its item reinstated) before the list can be saved; a renamed line is not
 * here — it shows on its active item's row with a quiet note.
 *
 * Around 120 items are shown at once, the same as pick-list maintenance and the
 * model-parcel contents editor: few enough for one list, so no search box. That
 * makes focus management matter: `focusRow` moves the caret to a rejected box on
 * a failed save, and removing an attention line moves focus to the next one
 * (or, once they are all gone, calls `onAllResolved`) rather than dropping it.
 */
const QUANTITY_MESSAGES: Record<string, string> = {
  'not-a-whole-number': 'Use a whole number, for example 24.',
  'below-minimum': 'Enter 1 or more, or clear the box.',
  'above-maximum': 'That number is too large.',
};

export function TargetStockListEditor({
  rows,
  onRowsChange,
  attention,
  onRemoveAttention,
  onAllResolved,
  focusRow,
}: {
  rows: readonly EditorRow[];
  onRowsChange: (rows: readonly EditorRow[]) => void;
  attention: readonly AttentionRow[];
  onRemoveAttention: (stockItemId: string) => void;
  /** Called after the last attention line is removed, so the screen can move focus to Save. */
  onAllResolved?: () => void;
  /** `{ stockItemId }` with a fresh `nonce` moves focus to that item's box; `null` does nothing. */
  focusRow?: { readonly stockItemId: string; readonly nonce: number } | null;
}) {
  const attentionHeadingId = useId();
  const errorIdBase = useId();
  const inputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const removeRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const focusAfterRemove = useRef<string | null>(null);

  const setTarget = (stockItemId: string, target: string) => {
    onRowsChange(rows.map((row) => (row.stockItemId === stockItemId ? { ...row, target } : row)));
  };

  useEffect(() => {
    if (focusRow == null) return;
    inputRefs.current.get(focusRow.stockItemId)?.focus();
  }, [focusRow]);

  useEffect(() => {
    const wanted = focusAfterRemove.current;
    if (wanted === null) return;
    focusAfterRemove.current = null;
    if (wanted === '') onAllResolved?.();
    else removeRefs.current.get(wanted)?.focus();
  }, [attention, onAllResolved]);

  const removeAttention = (stockItemId: string) => {
    const remaining = attention.filter((row) => row.stockItemId !== stockItemId);
    focusAfterRemove.current = remaining[0]?.stockItemId ?? '';
    onRemoveAttention(stockItemId);
  };

  return (
    <div className={styles.editor}>
      {attention.length > 0 && (
        <section aria-labelledby={attentionHeadingId} className={styles.attention}>
          <h3 className={styles.attentionHeading} id={attentionHeadingId}>
            Lines that need attention
          </h3>
          <p className={styles.attentionIntro}>
            This list still names {attention.length === 1 ? 'an item' : 'items'} that{' '}
            {attention.length === 1 ? 'is' : 'are'} no longer available. Remove{' '}
            {attention.length === 1 ? 'it' : 'them'}, or bring the item back on the{' '}
            <Link to="/stock/items">stock items</Link> screen, before saving.
          </p>
          <ul className={styles.attentionList}>
            {attention.map((row) => (
              <li key={row.stockItemId} className={styles.attentionItem}>
                <span aria-hidden="true">⚠ </span>
                <span>
                  <strong>{row.storedName}</strong> (target {row.targetQuantity}) —{' '}
                  {row.kind === 'retired'
                    ? 'this item has been retired'
                    : 'this item is no longer in the catalogue'}
                </span>
                <button
                  className="button-secondary"
                  onClick={() => {
                    removeAttention(row.stockItemId);
                  }}
                  ref={(el) => {
                    removeRefs.current.set(row.stockItemId, el);
                  }}
                  type="button"
                >
                  Remove {row.storedName}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th className={styles.numeric} scope="col">
              Target
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const newCategory = index === 0 || rows[index - 1]?.category !== row.category;
            const trimmed = row.target.trim();
            const parsed =
              trimmed === '' ? null : parseWholeNumber(row.target, TARGET_QUANTITY_BOUNDS);
            const problem = parsed !== null && !parsed.ok ? parsed.problem : null;
            const errorId = `${errorIdBase}-${row.stockItemId}`;

            return (
              <Fragment key={row.stockItemId}>
                {newCategory && (
                  <tr>
                    <th className={styles.categoryHeading} colSpan={2} scope="rowgroup">
                      {row.category}
                    </th>
                  </tr>
                )}
                <tr>
                  <th scope="row">
                    {row.name}
                    {row.renamedFrom !== null && (
                      <span className={styles.renamed}>
                        {' '}
                        — was “{row.renamedFrom}”, updated on save
                      </span>
                    )}
                  </th>
                  <td className={styles.numeric}>
                    <input
                      aria-describedby={problem !== null ? errorId : undefined}
                      aria-invalid={problem !== null ? true : undefined}
                      aria-label={`Target quantity for ${row.name}`}
                      autoComplete="off"
                      className={styles.quantity}
                      inputMode="numeric"
                      onChange={(event) => {
                        setTarget(row.stockItemId, event.target.value);
                      }}
                      ref={(el) => {
                        inputRefs.current.set(row.stockItemId, el);
                      }}
                      type="text"
                      value={row.target}
                    />
                    {problem !== null && (
                      <span className={styles.fieldError} id={errorId}>
                        {QUANTITY_MESSAGES[problem] ?? 'Check this number.'}
                      </span>
                    )}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The crate half of a target list; separate because its target may be fractional. */
export function CrateTargetEditor({
  rows,
  onRowsChange,
  focusCrate,
  errorCrateId,
}: {
  readonly rows: readonly CrateTargetDraft[];
  readonly onRowsChange: (rows: readonly CrateTargetDraft[]) => void;
  readonly focusCrate?: { readonly crateId: string; readonly nonce: number } | null;
  readonly errorCrateId?: string | null;
}) {
  const inputRefs = useRef(new Map<string, HTMLInputElement | null>());
  useEffect(() => {
    if (focusCrate !== undefined && focusCrate !== null)
      inputRefs.current.get(focusCrate.crateId)?.focus();
  }, [focusCrate]);
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Crate</th>
          <th className={styles.numeric} scope="col">
            Target crates
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const inputId = `crate-target-${row.crateId}`;
          const invalid = errorCrateId === row.crateId;
          return (
            <tr key={row.crateId}>
              <th scope="row">{row.crateName}</th>
              <td className={styles.numeric}>
                <input
                  aria-label={`Target crates for ${row.crateName}`}
                  aria-describedby={invalid ? `${inputId}-error` : undefined}
                  aria-invalid={invalid || undefined}
                  autoComplete="off"
                  className={styles.quantity}
                  id={inputId}
                  inputMode="decimal"
                  onChange={(event) => {
                    onRowsChange(
                      rows.map((candidate) =>
                        candidate.crateId === row.crateId
                          ? { ...candidate, target: event.target.value }
                          : candidate,
                      ),
                    );
                  }}
                  ref={(element) => {
                    inputRefs.current.set(row.crateId, element);
                  }}
                  type="text"
                  value={row.target}
                />
                {invalid && (
                  <span className={styles.fieldError} id={`${inputId}-error`}>
                    Use a positive number with at most one decimal place.
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
