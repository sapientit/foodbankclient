import { Fragment, useEffect, useId, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { PageHeader } from '../../../components/page-header';
import { parseWholeNumber } from '../../../lib/whole-number';
import { useStockPrototypeStore } from '../stock-prototype-store';
import {
  applyPackingUnit,
  computeCrateReferenceCount,
  decomposeCrateCount,
  groupByCategory,
  packUnitLabelFor,
} from '../stock-prototype.logic';
import type { Crate, ProtoStockItem } from '../types';
import styles from './prototype-stock-take-screen.module.css';

const COUNT_BOUNDS = { minimum: 0, maximum: 100_000 };

const QUANTITY_MESSAGES: Record<string, string> = {
  'not-a-whole-number': 'Use a whole number, for example 24.',
  'below-minimum': 'A count cannot be below zero.',
  'above-maximum': 'That number is too large.',
};

/** A crate's count is entered as a fraction of a crate, e.g. "40.5" — unlike an ordinary item's
 * whole-number count, so it needs its own, more permissive parser. */
function parseFractionalCount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '' || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function itemNameFor(items: readonly ProtoStockItem[], stockItemId: string): string {
  return items.find((item) => item.id === stockItemId)?.name ?? stockItemId;
}

/**
 * A stock take for one grouping: ordinary item lines counted directly, and crate lines counted as a
 * single fractional figure and decomposed back into their members. Only what actually changed is
 * saved, per planning doc §3 and the same "blank means unchanged" rule the real stock-take screen
 * uses. Prototype only: state lives in `useStockPrototypeStore`, nothing here calls the API.
 */
export function PrototypeStockTakeScreen() {
  const { state, applyStockCounts } = useStockPrototypeStore();
  const pickerId = useId();
  const errorIdBase = useId();

  const [selectedGroupingId, setSelectedGroupingId] = useState(state.groupings[0]?.id ?? '');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [packTyped, setPackTyped] = useState<Record<string, string>>({});
  const [crateTyped, setCrateTyped] = useState<Record<string, string>>({});
  // A debounced copy of `crateTyped`, used only to drive the live decomposition preview — so a
  // screen-reader user isn't interrupted by a fresh announcement on every digit typed.
  const [previewSource, setPreviewSource] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setPreviewSource(crateTyped);
    }, 500);
    return () => {
      clearTimeout(handle);
    };
  }, [crateTyped]);

  const itemRows = state.items.filter((item) => item.groupingId === selectedGroupingId);
  const crateRows = [...state.crates]
    .filter((crate) => crate.groupingId === selectedGroupingId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const itemGroups = groupByCategory(itemRows);

  const setItemValue = (id: string, value: string) => {
    setTyped((current) => ({ ...current, [id]: value }));
    setFieldErrors((current) => {
      const { [id]: _ignored, ...rest } = current;
      return rest;
    });
  };

  const setPackValue = (item: ProtoStockItem, value: string) => {
    setPackTyped((current) => ({ ...current, [item.id]: value }));
    if (item.unitsPerPack === null) return;
    const packCount = parseFractionalCount(value);
    // Clearing (or invalidating) the packs box clears what it had filled in, rather than leaving a
    // stale computed count behind once the box no longer explains it.
    setItemValue(
      item.id,
      packCount === null ? '' : String(applyPackingUnit(packCount, item.unitsPerPack)),
    );
  };

  const setCrateValue = (id: string, value: string) => {
    setCrateTyped((current) => ({ ...current, [id]: value }));
    setFieldErrors((current) => {
      const { [id]: _ignored, ...rest } = current;
      return rest;
    });
  };

  const previewFor = (
    crate: Crate,
  ): { readonly stockItemId: string; readonly quantityOnHand: number }[] | null => {
    const entered = parseFractionalCount(previewSource[crate.id] ?? '');
    if (entered === null) return null;
    const reference = computeCrateReferenceCount(crate, state.items);
    if (Math.abs(entered - reference) < 1e-9) return null;
    return decomposeCrateCount(crate, entered);
  };

  const handleSave = () => {
    const itemCounts: { stockItemId: string; quantityOnHand: number }[] = [];
    const errors: Record<string, string> = {};
    const changedItemIds: string[] = [];
    const changedCrateIds: string[] = [];
    const crateMemberCounts: { stockItemId: string; quantityOnHand: number }[] = [];

    for (const item of itemRows) {
      const value = typed[item.id];
      if (value === undefined || value.trim() === '') continue;
      const parsed = parseWholeNumber(value, COUNT_BOUNDS);
      if (!parsed.ok) {
        errors[item.id] = QUANTITY_MESSAGES[parsed.problem] ?? 'Check this number.';
        continue;
      }
      if (parsed.value !== item.quantityOnHand) {
        itemCounts.push({ stockItemId: item.id, quantityOnHand: parsed.value });
        changedItemIds.push(item.id);
      }
    }

    for (const crate of crateRows) {
      const value = crateTyped[crate.id];
      if (value === undefined || value.trim() === '') continue;
      const entered = parseFractionalCount(value);
      if (entered === null) {
        errors[crate.id] = 'Enter a number, for example 40.5.';
        continue;
      }
      const reference = computeCrateReferenceCount(crate, state.items);
      if (Math.abs(entered - reference) > 1e-9) {
        crateMemberCounts.push(...decomposeCrateCount(crate, entered));
        changedCrateIds.push(crate.id);
      }
    }

    // A double-counted item (see the Groupings screen) can appear both as its own row here and as
    // a crate member — if both were typed into, one would silently overwrite the other. Refuse
    // rather than pick a winner; that state needs fixing on the Groupings screen first.
    const crateMemberIds = new Set(crateMemberCounts.map((c) => c.stockItemId));
    const collidingItemId = changedItemIds.find((id) => crateMemberIds.has(id));
    if (collidingItemId !== undefined) {
      errors[collidingItemId] =
        'This item is also a member of a crate counted below — fix its counting status on the Groupings screen before counting it here.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSavedMessage(null);
      const count = Object.keys(errors).length;
      setPageError(
        `${String(count)} ${count === 1 ? 'line needs' : 'lines need'} fixing before this can be saved.`,
      );
      return;
    }
    setPageError(null);

    const changedLines = changedItemIds.length + changedCrateIds.length;
    if (changedLines === 0) {
      setSavedMessage('Nothing changed. Nothing was saved.');
      return;
    }

    applyStockCounts([...itemCounts, ...crateMemberCounts]);

    setTyped((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !changedItemIds.includes(id))),
    );
    setPackTyped((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !changedItemIds.includes(id))),
    );
    setCrateTyped((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !changedCrateIds.includes(id))),
    );
    setSavedMessage(
      changedLines === 1
        ? 'One changed line saved.'
        : `${String(changedLines)} changed lines saved.`,
    );
  };

  return (
    <>
      <PageHeader title="Stock take" />
      <p className={styles.intro}>
        Count one grouping at a time. An ordinary item takes a whole-number count; a crate line
        takes a single fractional figure — how many whole crates the shelf now holds — and is
        decomposed back into its members on save. Only a value that actually changed is saved; leave
        a box blank to leave it alone.
      </p>

      <div className={styles.field}>
        <label htmlFor={pickerId}>Grouping</label>
        <select
          className={styles.select}
          id={pickerId}
          onChange={(event) => {
            setSelectedGroupingId(event.target.value);
            setSavedMessage(null);
          }}
          value={selectedGroupingId}
        >
          {state.groupings.map((grouping) => (
            <option key={grouping.id} value={grouping.id}>
              {grouping.name}
            </option>
          ))}
        </select>
      </div>

      {savedMessage !== null && (
        <p className={styles.savedNotice} role="status">
          {savedMessage}
        </p>
      )}
      {pageError !== null && (
        <p className={styles.fieldError} role="alert">
          {pageError}
        </p>
      )}

      {itemRows.length === 0 && crateRows.length === 0 ? (
        <EmptyState
          headline="Nothing to count here"
          sentence="This grouping has no directly grouped items and no crates."
        />
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Shelf</th>
                <th className={styles.numeric} scope="col">
                  Current level
                </th>
                <th scope="col">Counted quantity</th>
                <th scope="col">Crate preview</th>
              </tr>
            </thead>
            <tbody>
              {itemGroups.map((group) => (
                <Fragment key={group.category}>
                  <tr>
                    <th className={styles.categoryHeading} colSpan={5} scope="rowgroup">
                      {group.category}
                    </th>
                  </tr>
                  {group.rows.map((item) => {
                    const id = `count-${item.id}`;
                    const packId = `pack-${item.id}`;
                    const errorId = `${errorIdBase}-${item.id}`;
                    return (
                      <tr key={item.id}>
                        <th scope="row">{item.name}</th>
                        <td>{item.shelfNumber}</td>
                        <td className={styles.numeric}>{item.quantityOnHand}</td>
                        <td>
                          <label className={styles.visuallyHidden} htmlFor={id}>
                            Counted quantity for {item.name}
                          </label>
                          <input
                            aria-describedby={
                              fieldErrors[item.id] === undefined ? undefined : errorId
                            }
                            aria-invalid={fieldErrors[item.id] !== undefined}
                            className={styles.count}
                            id={id}
                            inputMode="numeric"
                            onChange={(event) => {
                              setItemValue(item.id, event.target.value);
                            }}
                            type="text"
                            value={typed[item.id] ?? ''}
                          />
                          {item.unitsPerPack !== null && (
                            <span className={styles.packField}>
                              <label htmlFor={packId}>
                                or {packUnitLabelFor(item)} of {item.unitsPerPack}
                              </label>
                              <input
                                className={styles.pack}
                                id={packId}
                                inputMode="decimal"
                                onChange={(event) => {
                                  setPackValue(item, event.target.value);
                                }}
                                type="text"
                                value={packTyped[item.id] ?? ''}
                              />
                            </span>
                          )}
                          {fieldErrors[item.id] !== undefined && (
                            <span className={styles.fieldError} id={errorId}>
                              {fieldErrors[item.id]}
                            </span>
                          )}
                        </td>
                        <td />
                      </tr>
                    );
                  })}
                </Fragment>
              ))}

              {crateRows.length > 0 && (
                <Fragment>
                  <tr>
                    <th className={styles.categoryHeading} colSpan={5} scope="rowgroup">
                      Crates
                    </th>
                  </tr>
                  {crateRows.map((crate) => {
                    const id = `crate-count-${crate.id}`;
                    const errorId = `${errorIdBase}-${crate.id}`;
                    const reference = computeCrateReferenceCount(crate, state.items);
                    const preview = previewFor(crate);
                    return (
                      <tr key={crate.id}>
                        <th scope="row">{crate.name}</th>
                        <td>{crate.shelfKey}</td>
                        <td className={styles.numeric}>{reference.toFixed(2)}</td>
                        <td>
                          <label className={styles.visuallyHidden} htmlFor={id}>
                            Counted crates for {crate.name}
                          </label>
                          <input
                            aria-describedby={
                              fieldErrors[crate.id] === undefined ? undefined : errorId
                            }
                            aria-invalid={fieldErrors[crate.id] !== undefined}
                            className={styles.count}
                            id={id}
                            inputMode="decimal"
                            onChange={(event) => {
                              setCrateValue(crate.id, event.target.value);
                            }}
                            type="text"
                            value={crateTyped[crate.id] ?? ''}
                          />
                          {fieldErrors[crate.id] !== undefined && (
                            <span className={styles.fieldError} id={errorId}>
                              {fieldErrors[crate.id]}
                            </span>
                          )}
                        </td>
                        <td>
                          {/* Always mounted — an aria-live region that comes and goes can have its
                              first update missed by assistive tech — and its content only refreshes
                              on a debounced copy of what was typed (see `previewSource`) so a
                              screen-reader user isn't interrupted by a fresh announcement on every
                              keystroke. One member per line, name and quantity in their own column,
                              rather than one long comma-joined line — that line was wide enough to
                              push the table and jump the page as it appeared. */}
                          <div aria-live="polite" className={styles.preview}>
                            {preview !== null && (
                              <dl className={styles.previewList}>
                                {preview.map((member) => (
                                  <Fragment key={member.stockItemId}>
                                    <dt>{itemNameFor(state.items, member.stockItemId)}</dt>
                                    <dd className={styles.numeric}>{member.quantityOnHand}</dd>
                                  </Fragment>
                                ))}
                              </dl>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              )}
            </tbody>
          </table>

          <div className={styles.formActions}>
            <button className={styles.primary} onClick={handleSave} type="button">
              Save
            </button>
          </div>
        </>
      )}
    </>
  );
}
