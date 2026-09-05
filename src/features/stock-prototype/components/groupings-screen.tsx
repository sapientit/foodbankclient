import { Fragment, useId, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { PageHeader } from '../../../components/page-header';
import { parseWholeNumber } from '../../../lib/whole-number';
import { useStockPrototypeStore } from '../stock-prototype-store';
import { countingStatus, findGroupingName, groupByCategory } from '../stock-prototype.logic';
import type { CountingStatus, Crate, Grouping, ProtoStockItem } from '../types';
import styles from './groupings-screen.module.css';

const NOT_GROUPED_VALUE = '';

const PACKING_UNIT_BOUNDS = { minimum: 1, maximum: 99_999 };

const PACKING_UNIT_MESSAGES: Record<string, string> = {
  'not-a-whole-number': 'Use a whole number, for example 24.',
  'below-minimum': 'Enter 1 or more, or clear the box for no packing unit.',
  'above-maximum': 'That number is too large.',
};

/** The plain-English status line for a row, and whether it needs the "not counted" style badge. */
function statusDisplay(
  item: ProtoStockItem,
  crates: readonly Crate[],
  groupings: readonly Grouping[],
): { readonly text: string; readonly status: CountingStatus } {
  const status = countingStatus(item, crates);
  switch (status) {
    case 'direct':
      return { text: `Direct — ${findGroupingName(item.groupingId, groupings)}`, status };
    case 'crate':
      return { text: `Covered by crate (shelf ${item.shelfNumber})`, status };
    case 'double-counted':
      return { text: 'Counted twice', status };
    case 'uncounted':
      return { text: 'Not counted', status };
  }
}

/**
 * Admin maintenance for stock-take groupings (planning doc §1): the groupings themselves, and every
 * stock item's direct assignment to one — including the counting-coverage status that the Validation
 * screen otherwise summarises, so an admin can fix a bad assignment right where they see it.
 */
export function GroupingsScreen() {
  const { state, saveGrouping, setItemGrouping, setItemUnitsPerPack, setItemPackUnitLabel } =
    useStockPrototypeStore();
  const newGroupingInputId = useId();
  const groupingsHeadingId = useId();
  const itemsHeadingId = useId();

  return (
    <>
      <PageHeader title="Stock-take groupings" />
      <p className={styles.intro}>
        A grouping is what a stock take is actually run against. Every item is counted exactly once
        — either directly, by grouping, or as a member of a crate.
      </p>

      <section aria-labelledby={groupingsHeadingId}>
        <h2 className={styles.sectionHeading} id={groupingsHeadingId}>
          Groupings
        </h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
            </tr>
          </thead>
          <tbody>
            {state.groupings.map((grouping) => (
              <GroupingRow grouping={grouping} key={grouping.id} onSave={saveGrouping} />
            ))}
          </tbody>
        </table>

        <NewGroupingForm inputId={newGroupingInputId} onSave={saveGrouping} />
      </section>

      <section aria-labelledby={itemsHeadingId}>
        <h2 className={styles.sectionHeading} id={itemsHeadingId}>
          Stock items
        </h2>
        {state.items.length === 0 ? (
          <EmptyState
            headline="No stock items yet"
            level="h3"
            sentence="Items will appear here once they exist."
          />
        ) : (
          <ItemsTable
            groupings={state.groupings}
            items={state.items}
            onSetItemGrouping={setItemGrouping}
            onSetItemUnitsPerPack={setItemUnitsPerPack}
            onSetItemPackUnitLabel={setItemPackUnitLabel}
            crates={state.crates}
          />
        )}
      </section>
    </>
  );
}

function GroupingRow({
  grouping,
  onSave,
}: {
  grouping: Grouping;
  onSave: (grouping: Grouping) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputId = useId();
  const value = draft ?? grouping.name;

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed === '') {
      setMessage(`A name is needed — kept “${grouping.name}”.`);
      setDraft(null);
      return;
    }
    if (trimmed !== grouping.name) onSave({ id: grouping.id, name: trimmed });
    setDraft(null);
  };

  return (
    <tr>
      <td>
        <div className={styles.renameRow}>
          <label className={styles.visuallyHidden} htmlFor={inputId}>
            Name for grouping “{grouping.name}”
          </label>
          <input
            className={styles.renameInput}
            id={inputId}
            onBlur={commit}
            onChange={(event) => {
              setDraft(event.target.value);
              setMessage(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            type="text"
            value={value}
          />
          <button onClick={commit} type="button">
            Save
          </button>
          {message !== null && (
            <p className={styles.fieldError} role="alert">
              {message}
            </p>
          )}
        </div>
      </td>
    </tr>
  );
}

function NewGroupingForm({
  inputId,
  onSave,
}: {
  inputId: string;
  onSave: (grouping: Grouping) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addGrouping = () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Enter a name before adding a grouping.');
      return;
    }
    onSave({ id: crypto.randomUUID(), name: trimmed });
    setName('');
    setError(null);
  };

  return (
    <div className={styles.addForm}>
      <label htmlFor={inputId}>New grouping name</label>
      <input
        id={inputId}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            addGrouping();
          }
        }}
        type="text"
        value={name}
      />
      <button onClick={addGrouping} type="button">
        Add grouping
      </button>
      {error !== null && (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ItemsTable({
  items,
  crates,
  groupings,
  onSetItemGrouping,
  onSetItemUnitsPerPack,
  onSetItemPackUnitLabel,
}: {
  items: readonly ProtoStockItem[];
  crates: readonly Crate[];
  groupings: readonly Grouping[];
  onSetItemGrouping: (stockItemId: string, groupingId: string | null) => void;
  onSetItemUnitsPerPack: (stockItemId: string, unitsPerPack: number | null) => void;
  onSetItemPackUnitLabel: (stockItemId: string, packUnitLabel: string | null) => void;
}) {
  const rows = groupByCategory(items).flatMap((group) => group.rows);

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Shelf</th>
          <th scope="col">Status</th>
          <th scope="col">Grouping</th>
          <th className={styles.numeric} scope="col">
            Units per pack
          </th>
          <th scope="col">Counting unit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item, index) => {
          const newCategory = index === 0 || rows[index - 1]?.category !== item.category;
          const { text, status } = statusDisplay(item, crates, groupings);
          const selectId = `item-grouping-${item.id}`;

          return (
            <Fragment key={item.id}>
              {newCategory && (
                <tr>
                  <th className={styles.categoryHeading} colSpan={6} scope="rowgroup">
                    {item.category}
                  </th>
                </tr>
              )}
              <tr>
                <th scope="row">{item.name}</th>
                <td>{item.shelfNumber}</td>
                <td>
                  {status === 'uncounted' || status === 'double-counted' ? (
                    <span className={styles.statusBadge}>{text}</span>
                  ) : (
                    text
                  )}
                </td>
                <td>
                  <label className={styles.visuallyHidden} htmlFor={selectId}>
                    Grouping for {item.name}
                  </label>
                  <select
                    id={selectId}
                    onChange={(event) => {
                      onSetItemGrouping(
                        item.id,
                        event.target.value === NOT_GROUPED_VALUE ? null : event.target.value,
                      );
                    }}
                    value={item.groupingId ?? NOT_GROUPED_VALUE}
                  >
                    <option value={NOT_GROUPED_VALUE}>— not directly grouped —</option>
                    {groupings.map((grouping) => (
                      <option key={grouping.id} value={grouping.id}>
                        {grouping.name}
                      </option>
                    ))}
                  </select>
                  {status === 'crate' && (
                    <p className={styles.note}>assigned via crate membership</p>
                  )}
                </td>
                <td className={styles.numeric}>
                  <PackingUnitInput item={item} onSet={onSetItemUnitsPerPack} />
                </td>
                <td>
                  <PackUnitLabelInput item={item} onSet={onSetItemPackUnitLabel} />
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * A stock item's packing-unit figure (planning doc §3) — how many units make up a pack, so a
 * counter can enter a pack count instead of a raw unit count at a stock take. Blank means the item
 * has no packing unit and is always counted directly.
 */
function PackingUnitInput({
  item,
  onSet,
}: {
  item: ProtoStockItem;
  onSet: (stockItemId: string, unitsPerPack: number | null) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = `packing-unit-${item.id}`;
  const errorId = `${id}-error`;
  const value = typed ?? (item.unitsPerPack === null ? '' : String(item.unitsPerPack));

  const onChange = (raw: string) => {
    setTyped(raw);
    if (raw.trim() === '') {
      setError(null);
      onSet(item.id, null);
      return;
    }
    const parsed = parseWholeNumber(raw, PACKING_UNIT_BOUNDS);
    if (!parsed.ok) {
      setError(PACKING_UNIT_MESSAGES[parsed.problem] ?? 'Check this number.');
      return;
    }
    setError(null);
    onSet(item.id, parsed.value);
  };

  return (
    <>
      <label className={styles.visuallyHidden} htmlFor={id}>
        Units per pack for {item.name}
      </label>
      <input
        aria-describedby={error === null ? undefined : errorId}
        aria-invalid={error !== null}
        className={styles.packingInput}
        id={id}
        inputMode="numeric"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        type="text"
        value={value}
      />
      {error !== null && (
        <span className={styles.fieldError} id={errorId}>
          {error}
        </span>
      )}
    </>
  );
}

/**
 * What a "pack" is actually called for this item, plural — "boxes", "trays", "cases". Left blank,
 * the stock-take screen falls back to the generic "packs" rather than assuming that word fits every
 * item (planning doc §3).
 */
function PackUnitLabelInput({
  item,
  onSet,
}: {
  item: ProtoStockItem;
  onSet: (stockItemId: string, packUnitLabel: string | null) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const id = `pack-unit-label-${item.id}`;
  const value = typed ?? item.packUnitLabel ?? '';

  return (
    <>
      <label className={styles.visuallyHidden} htmlFor={id}>
        Counting-unit name for {item.name}
      </label>
      <input
        id={id}
        onChange={(event) => {
          const raw = event.target.value;
          setTyped(raw);
          onSet(item.id, raw.trim() === '' ? null : raw);
        }}
        placeholder="packs"
        type="text"
        value={value}
      />
    </>
  );
}
