import { useEffect, useId, useRef, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { PageHeader } from '../../../components/page-header';
import { useStockPrototypeStore } from '../stock-prototype-store';
import {
  computeCrateReferenceCount,
  findGroupingName,
  shelvesWithMultipleItems,
} from '../stock-prototype.logic';
import type { Crate, CrateMember } from '../types';
import styles from './crates-screen.module.css';

/** A member row mid-edit: percentages kept as strings so a field can sit empty or partial
 * while typing, parsed back to numbers only on submit. */
interface DraftMember {
  readonly stockItemId: string;
  readonly included: boolean;
  readonly stockCompositionPercent: string;
  readonly shoppingCompositionPercent: string;
}

function draftMembersFor(
  shelfItemIds: readonly string[],
  existing: readonly CrateMember[],
): DraftMember[] {
  return shelfItemIds.map((stockItemId) => {
    const member = existing.find((m) => m.stockItemId === stockItemId);
    return {
      stockItemId,
      included: member !== undefined,
      stockCompositionPercent: member !== undefined ? String(member.stockCompositionPercent) : '',
      shoppingCompositionPercent:
        member !== undefined ? String(member.shoppingCompositionPercent) : '',
    };
  });
}

/**
 * Create and edit crates, and see the ones that already exist. A crate is keyed to a shelf, needs
 * more than one member, and carries two independently-maintained percentage tables — see planning
 * doc §2. Prototype only: state lives in `useStockPrototypeStore`, nothing here calls the API.
 */
export function CratesScreen() {
  const { state, saveCrate, deleteCrate } = useStockPrototypeStore();
  const nameId = useId();
  const shelfId = useId();
  const groupingId = useId();
  const sizeId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const shelfSelectRef = useRef<HTMLSelectElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shelfKey, setShelfKey] = useState('');
  const [selectedGroupingId, setSelectedGroupingId] = useState('');
  const [sizePerCrate, setSizePerCrate] = useState('1');
  const [members, setMembers] = useState<readonly DraftMember[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (formError !== null) errorRef.current?.focus();
  }, [formError]);

  const qualifyingShelves = shelvesWithMultipleItems(state.items);
  // Editing an existing crate must never lose its shelf, even if that shelf no longer qualifies
  // (e.g. items moved off it since).
  const editingCrate = state.crates.find((c) => c.id === editingId) ?? null;
  const shelfOptions = new Set(qualifyingShelves.keys());
  // At most one crate per shelf (planning doc §2) — a shelf already keyed to a different crate is
  // not offered when adding a new one, so "Add a crate" can't create a second crate on top of it.
  for (const crate of state.crates) {
    if (crate.id !== editingCrate?.id) shelfOptions.delete(crate.shelfKey);
  }
  if (editingCrate !== null) shelfOptions.add(editingCrate.shelfKey);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setShelfKey('');
    setSelectedGroupingId('');
    setSizePerCrate('1');
    setMembers([]);
    setFormError(null);
  };

  const cancelEdit = () => {
    resetForm();
    headingRef.current?.focus();
  };

  const loadCrateIntoForm = (crate: Crate) => {
    setEditingId(crate.id);
    setName(crate.name);
    setShelfKey(crate.shelfKey);
    setSelectedGroupingId(crate.groupingId);
    setSizePerCrate(String(crate.sizePerCrate));
    // A stored member whose own shelf has since drifted away from the crate's key must still show
    // up here — dropping it silently on the next save is exactly the member-shelf-mismatch state
    // the Validation screen exists to catch, not something this form should do quietly.
    const shelfItemIds = new Set(
      state.items.filter((i) => i.shelfNumber === crate.shelfKey).map((i) => i.id),
    );
    for (const member of crate.members) shelfItemIds.add(member.stockItemId);
    setMembers(draftMembersFor([...shelfItemIds], crate.members));
    setFormError(null);
    nameInputRef.current?.focus();
  };

  const chooseShelf = (nextShelf: string) => {
    setShelfKey(nextShelf);
    const shelfItemIds = state.items.filter((i) => i.shelfNumber === nextShelf).map((i) => i.id);
    const existing =
      editingCrate !== null && editingCrate.shelfKey === nextShelf ? editingCrate.members : [];
    setMembers(draftMembersFor(shelfItemIds, existing));
  };

  const updateMember = (stockItemId: string, patch: Partial<DraftMember>) => {
    setMembers((current) =>
      current.map((m) => (m.stockItemId === stockItemId ? { ...m, ...patch } : m)),
    );
  };

  const includedMembers = members.filter((m) => m.included);
  const stockTotal = includedMembers.reduce(
    (sum, m) => sum + (Number(m.stockCompositionPercent) || 0),
    0,
  );
  const shoppingTotal = includedMembers.reduce(
    (sum, m) => sum + (Number(m.shoppingCompositionPercent) || 0),
    0,
  );

  const submit = () => {
    const size = Number(sizePerCrate);
    if (name.trim() === '') {
      setFormError('Enter a name for this crate, for example “Spread”.');
      return;
    }
    if (shelfKey === '') {
      setFormError('Choose a shelf.');
      return;
    }
    if (selectedGroupingId === '') {
      setFormError('Choose a grouping.');
      return;
    }
    if (!Number.isInteger(size) || size < 1) {
      setFormError('Size per crate must be a whole number of 1 or more.');
      return;
    }
    if (includedMembers.length < 2) {
      setFormError(
        'Include at least two member items — a crate with only one item is a misuse of the mechanism.',
      );
      return;
    }
    if (
      includedMembers.some(
        (m) => Number(m.stockCompositionPercent) < 0 || Number(m.shoppingCompositionPercent) < 0,
      )
    ) {
      setFormError('A composition percentage cannot be negative.');
      return;
    }

    const crate: Crate = {
      id: editingId ?? crypto.randomUUID(),
      name: name.trim(),
      shelfKey,
      groupingId: selectedGroupingId,
      sizePerCrate: size,
      members: includedMembers.map((m) => ({
        stockItemId: m.stockItemId,
        stockCompositionPercent: Number(m.stockCompositionPercent) || 0,
        shoppingCompositionPercent: Number(m.shoppingCompositionPercent) || 0,
      })),
    };
    saveCrate(crate);
    resetForm();
  };

  return (
    <>
      <PageHeader title="Crates" />

      {state.crates.length === 0 ? (
        <EmptyState
          headline="No crates yet"
          sentence="Add one below once a shelf carries more than one item."
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Shelf</th>
              <th scope="col">Grouping</th>
              <th className={styles.numeric} scope="col">
                Size per crate
              </th>
              <th className={styles.numeric} scope="col">
                Members
              </th>
              <th className={styles.numeric} scope="col">
                Computed reference count
              </th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.crates.map((crate) => (
              <tr key={crate.id}>
                <th scope="row">{crate.name}</th>
                <td>{crate.shelfKey}</td>
                <td>{findGroupingName(crate.groupingId, state.groupings)}</td>
                <td className={styles.numeric}>{crate.sizePerCrate}</td>
                <td className={styles.numeric}>{crate.members.length}</td>
                <td className={styles.numeric}>
                  {computeCrateReferenceCount(crate, state.items).toFixed(2)}
                </td>
                <td className={styles.actions}>
                  <button
                    className="button-secondary"
                    onClick={() => {
                      loadCrateIntoForm(crate);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="button-danger"
                    onClick={() => {
                      if (window.confirm(`Delete the crate “${crate.name}”?`))
                        deleteCrate(crate.id);
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className={styles.formHeading} ref={headingRef} tabIndex={-1}>
        {editingId === null ? 'Add a crate' : 'Edit crate'}
      </h2>

      {shelfOptions.size === 0 && (
        <EmptyState
          headline="No shelf carries more than one item"
          sentence="There is nothing to make a crate from yet."
          level="h3"
        />
      )}

      <div className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={nameId}>Name</label>
          <input
            className={styles.input}
            id={nameId}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="e.g. Spread"
            ref={nameInputRef}
            type="text"
            value={name}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor={shelfId}>Shelf</label>
          <select
            className={styles.input}
            id={shelfId}
            onChange={(event) => {
              chooseShelf(event.target.value);
            }}
            ref={shelfSelectRef}
            value={shelfKey}
          >
            <option value="">Choose a shelf…</option>
            {[...shelfOptions].map((shelf) => (
              <option key={shelf} value={shelf}>
                {shelf}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor={groupingId}>Grouping</label>
          <select
            className={styles.input}
            id={groupingId}
            onChange={(event) => {
              setSelectedGroupingId(event.target.value);
            }}
            value={selectedGroupingId}
          >
            <option value="">Choose a grouping…</option>
            {state.groupings.map((grouping) => (
              <option key={grouping.id} value={grouping.id}>
                {grouping.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor={sizeId}>Size per crate</label>
          <input
            className={styles.input}
            id={sizeId}
            inputMode="numeric"
            onChange={(event) => {
              setSizePerCrate(event.target.value);
            }}
            type="text"
            value={sizePerCrate}
          />
        </div>

        {shelfKey !== '' && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Include</th>
                <th scope="col">Item</th>
                <th className={styles.numeric} scope="col">
                  Stock-composition %
                </th>
                <th className={styles.numeric} scope="col">
                  Shopping-composition %
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((draft) => {
                const item = state.items.find((i) => i.id === draft.stockItemId);
                if (item === undefined) return null;
                const shelfMismatch = item.shelfNumber !== shelfKey;
                return (
                  <tr key={item.id}>
                    <td>
                      <label className={styles.visuallyHidden} htmlFor={`include-${item.id}`}>
                        Include {item.name} as a member
                      </label>
                      <input
                        checked={draft.included}
                        id={`include-${item.id}`}
                        onChange={(event) => {
                          updateMember(item.id, { included: event.target.checked });
                        }}
                        type="checkbox"
                      />
                    </td>
                    <th scope="row">
                      {item.name}
                      {shelfMismatch && (
                        <span className={styles.mismatch}>
                          {' '}
                          — its own shelf is now {item.shelfNumber}, not {shelfKey}
                        </span>
                      )}
                    </th>
                    <td className={styles.numeric}>
                      {draft.included && (
                        <>
                          <label className={styles.visuallyHidden} htmlFor={`stock-pct-${item.id}`}>
                            Stock-composition percent for {item.name}
                          </label>
                          <input
                            className={styles.percentInput}
                            id={`stock-pct-${item.id}`}
                            inputMode="numeric"
                            onChange={(event) => {
                              updateMember(item.id, {
                                stockCompositionPercent: event.target.value,
                              });
                            }}
                            type="text"
                            value={draft.stockCompositionPercent}
                          />
                        </>
                      )}
                    </td>
                    <td className={styles.numeric}>
                      {draft.included && (
                        <>
                          <label
                            className={styles.visuallyHidden}
                            htmlFor={`shopping-pct-${item.id}`}
                          >
                            Shopping-composition percent for {item.name}
                          </label>
                          <input
                            className={styles.percentInput}
                            id={`shopping-pct-${item.id}`}
                            inputMode="numeric"
                            onChange={(event) => {
                              updateMember(item.id, {
                                shoppingCompositionPercent: event.target.value,
                              });
                            }}
                            type="text"
                            value={draft.shoppingCompositionPercent}
                          />
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Totals</td>
                <td className={styles.numeric}>Stock-composition total: {stockTotal}%</td>
                <td className={styles.numeric}>Shopping-composition total: {shoppingTotal}%</td>
              </tr>
            </tfoot>
          </table>
        )}

        {formError !== null && (
          <p className={styles.error} ref={errorRef} role="alert" tabIndex={-1}>
            {formError}
          </p>
        )}

        <div className={styles.actions}>
          <button onClick={submit} type="button">
            {editingId === null ? 'Add crate' : 'Save changes'}
          </button>
          {editingId !== null && (
            <button className="button-link" onClick={cancelEdit} type="button">
              Cancel edit
            </button>
          )}
        </div>
      </div>
    </>
  );
}
