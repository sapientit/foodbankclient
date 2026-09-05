import { Fragment, useId, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { PageHeader } from '../../../components/page-header';
import { copyToClipboard } from '../../../lib/clipboard';
import { parseWholeNumber } from '../../../lib/whole-number';
import { useStockPrototypeStore } from '../stock-prototype-store';
import {
  crateTargetFor,
  decomposeCrateShortfall,
  groupByCategory,
  isCrateMember,
  itemTargetFor,
} from '../stock-prototype.logic';
import type { ProtoStockItem } from '../types';
import styles from './prototype-shopping-screen.module.css';

const TARGET_BOUNDS = { minimum: 1, maximum: 99_999 };

const TARGET_MESSAGES: Record<string, string> = {
  'not-a-whole-number': 'Use a whole number, for example 40.',
  'below-minimum': 'Enter 1 or more, or clear the box to take it off the list.',
  'above-maximum': 'That number is too large.',
};

const LINE_BOUNDS = { minimum: 0, maximum: 99_999 };

const LINE_MESSAGES: Record<string, string> = {
  'not-a-whole-number': 'Use a whole number, for example 40.',
  'below-minimum': 'A quantity to buy cannot be below zero.',
  'above-maximum': 'That number is too large.',
};

interface ShoppingLine {
  readonly stockItemId: string;
  readonly category: string;
  readonly name: string;
  readonly computedQuantity: number;
}

/**
 * Targets and the shopping list they produce, in one screen — deliberately simplified from the real
 * app's split between list maintenance and a separate shopping screen (see the module comment in
 * `README.md`). A crate's target is a single figure "in crates"; its shortfall decomposes into named
 * items via the shopping-composition percentages and sorts into their own ordinary categories, not a
 * separate "from crates" heading — planning doc §3. A crate member is never individually targeted —
 * only the crate's own target reaches it — and every generated line is directly editable before it
 * is printed or copied, since a shopper on the day may know the figures better than the computation
 * does. Prototype only: state lives in `useStockPrototypeStore`, nothing here calls the API.
 */
export function PrototypeShoppingScreen() {
  const { state, setItemTarget, setCrateTarget } = useStockPrototypeStore();
  const errorIdBase = useId();
  const [itemTargetTyped, setItemTargetTyped] = useState<Record<string, string>>({});
  const [itemTargetErrors, setItemTargetErrors] = useState<Record<string, string>>({});
  const [crateTargetTyped, setCrateTargetTyped] = useState<Record<string, string>>({});
  const [crateTargetErrors, setCrateTargetErrors] = useState<Record<string, string>>({});
  const [lineOverrides, setLineOverrides] = useState<Record<string, string>>({});
  const [lineOverrideErrors, setLineOverrideErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // A crate member's desired quantity is only ever set on the crate itself — see planning doc §2.
  const targetableItems = state.items.filter((item) => !isCrateMember(item, state.crates));
  const itemGroups = groupByCategory(targetableItems);

  const displayedItemTarget = (item: ProtoStockItem): string => {
    const typed = itemTargetTyped[item.id];
    if (typed !== undefined) return typed;
    const stored = itemTargetFor(state.itemTargets, item.id);
    return stored === null ? '' : String(stored);
  };

  const onItemTargetChange = (item: ProtoStockItem, value: string) => {
    setItemTargetTyped((current) => ({ ...current, [item.id]: value }));
    setItemTargetErrors((current) => {
      const { [item.id]: _ignored, ...rest } = current;
      return rest;
    });
    if (value.trim() === '') {
      setItemTarget(item.id, null);
      return;
    }
    const parsed = parseWholeNumber(value, TARGET_BOUNDS);
    if (!parsed.ok) {
      setItemTargetErrors((current) => ({
        ...current,
        [item.id]: TARGET_MESSAGES[parsed.problem] ?? 'Check this number.',
      }));
      return;
    }
    setItemTarget(item.id, parsed.value);
  };

  const displayedCrateTarget = (crateId: string): string => {
    const typed = crateTargetTyped[crateId];
    if (typed !== undefined) return typed;
    const stored = crateTargetFor(state.crateTargets, crateId);
    return stored === null ? '' : String(stored);
  };

  const onCrateTargetChange = (crateId: string, value: string) => {
    setCrateTargetTyped((current) => ({ ...current, [crateId]: value }));
    setCrateTargetErrors((current) => {
      const { [crateId]: _ignored, ...rest } = current;
      return rest;
    });
    if (value.trim() === '') {
      setCrateTarget(crateId, null);
      return;
    }
    const parsed = parseWholeNumber(value, TARGET_BOUNDS);
    if (!parsed.ok) {
      setCrateTargetErrors((current) => ({
        ...current,
        [crateId]: TARGET_MESSAGES[parsed.problem] ?? 'Check this number.',
      }));
      return;
    }
    setCrateTarget(crateId, parsed.value);
  };

  // Recomputed directly from the current targets on every render — a prototype, not something that
  // needs to defend against recomputing on a keystroke.
  const shortfallByItemId = new Map<string, number>();
  for (const item of state.items) {
    // Defensive: the UI never offers a target box for a crate member (above), but skip it here too
    // in case one is ever left behind by a state change — it must never double up with the crate's
    // own decomposed line for the same item.
    if (isCrateMember(item, state.crates)) continue;
    const target = itemTargetFor(state.itemTargets, item.id);
    if (target === null) continue;
    const shortfall = Math.max(target - item.quantityOnHand, 0);
    if (shortfall > 0)
      shortfallByItemId.set(item.id, (shortfallByItemId.get(item.id) ?? 0) + shortfall);
  }
  for (const crate of state.crates) {
    const target = crateTargetFor(state.crateTargets, crate.id);
    if (target === null) continue;
    for (const member of decomposeCrateShortfall(crate, target, state.items)) {
      if (member.quantity <= 0) continue;
      shortfallByItemId.set(
        member.stockItemId,
        (shortfallByItemId.get(member.stockItemId) ?? 0) + member.quantity,
      );
    }
  }

  const shoppingLines: ShoppingLine[] = [];
  for (const [stockItemId, quantity] of shortfallByItemId) {
    const item = state.items.find((candidate) => candidate.id === stockItemId);
    if (item === undefined) continue;
    shoppingLines.push({
      stockItemId,
      category: item.category,
      name: item.name,
      computedQuantity: quantity,
    });
  }
  const shoppingGroups = groupByCategory(shoppingLines);

  // A shopper on the day may know the figures better than the computation does — a crate's actual
  // mix drifted further than its shopping-composition table reflects, say. An edit here changes
  // nothing stored; it only affects the list as printed or copied this time (planning doc §2).
  const effectiveQuantity = (row: ShoppingLine): number => {
    const overrideText = lineOverrides[row.stockItemId];
    if (overrideText === undefined) return row.computedQuantity;
    const parsed = parseWholeNumber(overrideText, LINE_BOUNDS);
    return parsed.ok ? parsed.value : row.computedQuantity;
  };

  const onLineChange = (stockItemId: string, value: string) => {
    setLineOverrides((current) => ({ ...current, [stockItemId]: value }));
    if (value.trim() === '') {
      setLineOverrideErrors((current) => ({
        ...current,
        [stockItemId]: 'Enter a number, or reset this line to the computed figure.',
      }));
      return;
    }
    const parsed = parseWholeNumber(value, LINE_BOUNDS);
    setLineOverrideErrors((current) => {
      if (parsed.ok) {
        const { [stockItemId]: _ignored, ...rest } = current;
        return rest;
      }
      return { ...current, [stockItemId]: LINE_MESSAGES[parsed.problem] ?? 'Check this number.' };
    });
  };

  const resetLine = (stockItemId: string) => {
    setLineOverrides((current) => {
      const { [stockItemId]: _ignored, ...rest } = current;
      return rest;
    });
    setLineOverrideErrors((current) => {
      const { [stockItemId]: _ignored, ...rest } = current;
      return rest;
    });
  };

  const onCopy = () => {
    const text = shoppingGroups
      .map(
        (group) =>
          `${group.category}\n${group.rows.map((row) => `  ${row.name}: ${String(effectiveQuantity(row))}`).join('\n')}`,
      )
      .join('\n\n');
    void copyToClipboard(text).then((ok) => {
      setCopied(ok);
      setCopyFailed(!ok);
    });
  };

  return (
    <>
      <PageHeader title="Targets and shopping" />

      <section className={styles.targets}>
        <h2>Item targets</h2>
        <p className={styles.sectionIntro}>
          An item covered by a crate isn&rsquo;t listed here — its desired quantity is set on the
          crate itself, below.
        </p>
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
            {itemGroups.map((group) => (
              <Fragment key={group.category}>
                <tr>
                  <th className={styles.categoryHeading} colSpan={2} scope="rowgroup">
                    {group.category}
                  </th>
                </tr>
                {group.rows.map((item) => {
                  const id = `item-target-${item.id}`;
                  const errorId = `${errorIdBase}-${item.id}`;
                  return (
                    <tr key={item.id}>
                      <th scope="row">{item.name}</th>
                      <td className={styles.numeric}>
                        <label className={styles.visuallyHidden} htmlFor={id}>
                          Target quantity for {item.name}
                        </label>
                        <input
                          aria-describedby={
                            itemTargetErrors[item.id] === undefined ? undefined : errorId
                          }
                          aria-invalid={itemTargetErrors[item.id] !== undefined}
                          className={styles.quantity}
                          id={id}
                          inputMode="numeric"
                          onChange={(event) => {
                            onItemTargetChange(item, event.target.value);
                          }}
                          type="text"
                          value={displayedItemTarget(item)}
                        />
                        {itemTargetErrors[item.id] !== undefined && (
                          <span className={styles.fieldError} id={errorId}>
                            {itemTargetErrors[item.id]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.targets}>
        <h2>Crate targets</h2>
        {state.crates.length === 0 ? (
          <EmptyState
            headline="No crates yet"
            sentence="Add one on the Crates screen first."
            level="h3"
          />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Crate</th>
                <th className={styles.numeric} scope="col">
                  Target, in crates
                </th>
              </tr>
            </thead>
            <tbody>
              {state.crates.map((crate) => {
                const id = `crate-target-${crate.id}`;
                const errorId = `${errorIdBase}-${crate.id}`;
                return (
                  <tr key={crate.id}>
                    <th scope="row">{crate.name}</th>
                    <td className={styles.numeric}>
                      <label className={styles.visuallyHidden} htmlFor={id}>
                        Target crates for {crate.name}
                      </label>
                      <input
                        aria-describedby={
                          crateTargetErrors[crate.id] === undefined ? undefined : errorId
                        }
                        aria-invalid={crateTargetErrors[crate.id] !== undefined}
                        className={styles.quantity}
                        id={id}
                        inputMode="numeric"
                        onChange={(event) => {
                          onCrateTargetChange(crate.id, event.target.value);
                        }}
                        type="text"
                        value={displayedCrateTarget(crate.id)}
                      />
                      {crateTargetErrors[crate.id] !== undefined && (
                        <span className={styles.fieldError} id={errorId}>
                          {crateTargetErrors[crate.id]}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.shoppingList}>
        <div className={styles.shoppingHeading}>
          <h2>Shopping list</h2>
          {shoppingGroups.length > 0 && (
            <button className="button-secondary" onClick={onCopy} type="button">
              {copied ? 'Copied' : 'Copy to clipboard'}
            </button>
          )}
        </div>
        {copyFailed && (
          <p className={styles.copyError} role="alert">
            Couldn&rsquo;t copy — the list below is still there to copy by hand.
          </p>
        )}
        {shoppingGroups.length === 0 ? (
          <EmptyState
            headline="Nothing to buy"
            sentence="Every item and crate with a target is at or above it."
            level="h3"
          />
        ) : (
          <>
            <p className={styles.sectionIntro}>
              Each line is editable — if a shopper knows the real figure better than this
              computation does (a crate&rsquo;s actual mix has drifted, say), change it here before
              copying or printing. An edit here is not saved anywhere else.
            </p>
            {shoppingGroups.map((group) => (
              <div className={styles.categoryGroup} key={group.category}>
                <h3 className={styles.categoryGroupHeading}>{group.category}</h3>
                <ul className={styles.lineList}>
                  {group.rows.map((row) => {
                    const id = `shopping-line-${row.stockItemId}`;
                    const errorId = `${errorIdBase}-line-${row.stockItemId}`;
                    const overridden = lineOverrides[row.stockItemId] !== undefined;
                    return (
                      <li className={styles.line} key={row.stockItemId}>
                        <span>{row.name}</span>
                        <span className={styles.lineControls}>
                          <label className={styles.visuallyHidden} htmlFor={id}>
                            Quantity to buy for {row.name}
                          </label>
                          <input
                            aria-describedby={
                              lineOverrideErrors[row.stockItemId] === undefined
                                ? undefined
                                : errorId
                            }
                            aria-invalid={lineOverrideErrors[row.stockItemId] !== undefined}
                            className={styles.quantity}
                            id={id}
                            inputMode="numeric"
                            onChange={(event) => {
                              onLineChange(row.stockItemId, event.target.value);
                            }}
                            type="text"
                            value={lineOverrides[row.stockItemId] ?? String(row.computedQuantity)}
                          />
                          {overridden && (
                            <button
                              className="button-plain"
                              onClick={() => {
                                resetLine(row.stockItemId);
                              }}
                              type="button"
                            >
                              Reset
                            </button>
                          )}
                        </span>
                        {lineOverrideErrors[row.stockItemId] !== undefined && (
                          <span className={styles.fieldError} id={errorId}>
                            {lineOverrideErrors[row.stockItemId]}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>
    </>
  );
}
