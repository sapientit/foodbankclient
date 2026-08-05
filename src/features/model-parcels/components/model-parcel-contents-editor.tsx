import { useId } from 'react';
import type { StockItem } from '../../stock/queries';
import {
  parseWholeNumber,
  type DraftContentLine,
  CONTENT_QUANTITY_BOUNDS,
} from '../model-parcels.logic';
import styles from './model-parcel-form.module.css';

/**
 * The contents list shared by the create and amend screens: what is in this
 * parcel, and how many of each.
 *
 * A plain `<select>` to add a line, not the shop's search-as-you-type — there
 * are around forty stock items in total, few enough to offer as one list, and
 * the autocomplete in `record-shop-screen.tsx` earns its complexity from a
 * volunteer typing one-handed mid-shop, which does not apply to an admin
 * setting up a parcel definition.
 *
 * Picking an item already on the list **adds to its quantity** rather than
 * adding a second line — a nicety here, since the server merges duplicate
 * items in `contents` on its own, but it keeps what is on screen matching
 * what gets saved.
 */

const QUANTITY_MESSAGES: Record<string, string> = {
  empty: 'Enter how many.',
  'not-a-whole-number': 'Use a whole number, for example 4.',
  'below-minimum': 'Enter 1 or more. Remove the line instead of zero.',
  'above-maximum': 'That number is too large.',
};

export function ModelParcelContentsEditor({
  lines,
  onChange,
  stockItems,
}: {
  lines: readonly DraftContentLine[];
  onChange: (lines: readonly DraftContentLine[]) => void;
  /** The full list — active and retired — so a line already in this parcel always resolves a name. */
  stockItems: readonly StockItem[];
}) {
  const addId = useId();
  const activeItems = stockItems
    .filter((item) => item.isActive && !lines.some((line) => line.stockItemId === item.id))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const add = (stockItemId: string) => {
    const item = stockItems.find((candidate) => candidate.id === stockItemId);
    if (item === undefined) return;

    onChange([...lines, { stockItemId: item.id, name: item.name, quantity: '1' }]);
  };

  return (
    <div className={styles.contents}>
      <div className={styles.field}>
        <label htmlFor={addId}>Add an item</label>
        <select
          className={styles.input}
          id={addId}
          onChange={(event) => {
            const { value } = event.target;
            if (value !== '') add(value);
            event.target.value = '';
          }}
          value=""
        >
          <option value="">Choose a stock item…</option>
          {activeItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      {lines.length === 0 ? (
        <p className={styles.emptyContents}>Nothing added yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th className={styles.numeric} scope="col">
                Quantity
              </th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const item = stockItems.find((candidate) => candidate.id === line.stockItemId);
              const parsed = parseWholeNumber(line.quantity, CONTENT_QUANTITY_BOUNDS);

              return (
                <tr key={line.stockItemId}>
                  <th scope="row">
                    {line.name}
                    {item !== undefined && !item.isActive && (
                      <span className={styles.retired}> (retired)</span>
                    )}
                  </th>
                  <td className={styles.numeric}>
                    <input
                      aria-invalid={parsed.ok ? undefined : true}
                      aria-label={`Quantity of ${line.name}`}
                      autoComplete="off"
                      className={styles.quantity}
                      inputMode="numeric"
                      onChange={(event) => {
                        const { value } = event.target;
                        onChange(
                          lines.map((row) =>
                            row.stockItemId === line.stockItemId
                              ? { ...row, quantity: value }
                              : row,
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
                        onChange(lines.filter((row) => row.stockItemId !== line.stockItemId));
                      }}
                      type="button"
                    >
                      Remove {line.name}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
