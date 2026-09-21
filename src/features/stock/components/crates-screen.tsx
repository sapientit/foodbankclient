import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ErrorNotice } from '../../../components/error-notice';
import { BoxIcon, PencilIcon, TrashIcon } from '../../../components/icons';
import { ResponsiveIconLabel } from '../../../components/responsive-icon-label';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import {
  useAmendCrate,
  useCreateCrate,
  useCrates,
  useDeleteCrate,
  useStockItems,
  useStockLevels,
  useStockTakeGroupings,
  type Crate,
  type CrateInput,
  type StockItem,
} from '../queries';
import { computeCrateReferenceCount } from '../stock.logic';
import styles from './stock-item-form.module.css';

interface DraftMember {
  readonly stockItemId: string;
  readonly included: boolean;
  readonly stockCompositionPercent: string;
  readonly shoppingCompositionPercent: string;
}

const EMPTY = {
  name: '',
  shelfKey: '',
  groupingId: '',
  sizePerCrate: '',
  members: [] as readonly DraftMember[],
};

/** Create and maintain the explicit shelf crate definitions. Membership is never inferred. */
export function CratesScreen() {
  const crates = useCrates();
  const items = useStockItems('shelf');
  const groupings = useStockTakeGroupings();
  const levels = useStockLevels();
  const create = useCreateCrate();
  const amend = useAmendCrate();
  const remove = useDeleteCrate();
  const [editing, setEditing] = useState<Crate | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Crate | null>(null);
  const [deletedName, setDeletedName] = useState<string | null>(null);
  const addCrateButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (deletedName !== null) addCrateButtonRef.current?.focus();
  }, [deletedName]);

  const shelves = useMemo(() => {
    if (items.data === undefined) return new Map<string, StockItem[]>();
    const grouped = new Map<string, StockItem[]>();
    // Retired stock remains in this query for maintenance/history, but it is
    // not current shelf stock and must not make a shelf into a crate candidate.
    for (const item of items.data.filter((item) => item.isActive))
      grouped.set(item.shelfNumber, [...(grouped.get(item.shelfNumber) ?? []), item]);
    return grouped;
  }, [items.data]);
  const hasDraftMembers = draft.members.length > 0;
  const selectableShelves = [...shelves.entries()].filter(
    ([shelf, rows]) => rows.length >= 2 || shelf === editing?.shelfKey,
  );

  if (crates.isPending || items.isPending || groupings.isPending || levels.isPending)
    return (
      <div className={styles.page}>
        <CratesHeader />
        <Spinner label="Loading crates…" />
      </div>
    );
  if (crates.isError)
    return (
      <div className={styles.page}>
        <CratesHeader />
        <ErrorNotice error={crates.error} onRetry={() => void crates.refetch()} />
      </div>
    );
  if (items.isError)
    return (
      <div className={styles.page}>
        <CratesHeader />
        <ErrorNotice error={items.error} onRetry={() => void items.refetch()} />
      </div>
    );
  if (groupings.isError)
    return (
      <div className={styles.page}>
        <CratesHeader />
        <ErrorNotice error={groupings.error} onRetry={() => void groupings.refetch()} />
      </div>
    );
  if (levels.isError)
    return (
      <div className={styles.page}>
        <CratesHeader />
        <ErrorNotice error={levels.error} onRetry={() => void levels.refetch()} />
      </div>
    );

  const reset = () => {
    setEditing(null);
    setDraft(EMPTY);
    setFormError(null);
  };
  const confirmDelete = async () => {
    if (deleteCandidate === null) return;
    try {
      await remove.mutateAsync(deleteCandidate);
      setDeleteCandidate(null);
      setDeletedName(deleteCandidate.name);
      // The effect runs after ConfirmDialog closes, rather than racing its
      // opener-focus cleanup while the deleted row is unmounting.
    } catch {
      // Keep the confirmation open with the parsed server error visible above.
    }
  };
  const beginEdit = (crate: Crate) => {
    const current = items.data.filter(
      (item) => item.isActive && item.shelfNumber === crate.shelfKey,
    );
    const byId = new Map(crate.members.map((member) => [member.stockItemId, member]));
    const allIds = new Set([
      ...current.map((item) => item.id),
      ...crate.members.map((member) => member.stockItemId),
    ]);
    setEditing(crate);
    setDraft({
      name: crate.name,
      shelfKey: crate.shelfKey,
      groupingId: crate.groupingId,
      sizePerCrate: String(crate.sizePerCrate),
      members: [...allIds].map((stockItemId) => {
        const member = byId.get(stockItemId);
        return {
          stockItemId,
          included: member !== undefined,
          stockCompositionPercent:
            member === undefined ? '' : String(member.stockCompositionPercent),
          shoppingCompositionPercent:
            member === undefined ? '' : String(member.shoppingCompositionPercent),
        };
      }),
    });
    setFormError(null);
  };
  const selectShelf = (shelfKey: string) => {
    const current = shelves.get(shelfKey) ?? [];
    // Switching away replaces the visible draft with the new shelf's active
    // candidates. When returning, rebuild from the saved crate members so a
    // retired historical member cannot vanish from the next PATCH.
    const existing =
      editing?.shelfKey === shelfKey
        ? draft.shelfKey === shelfKey
          ? draft.members
          : editing.members.map((member) => ({
              ...member,
              included: true,
              stockCompositionPercent: String(member.stockCompositionPercent),
              shoppingCompositionPercent: String(member.shoppingCompositionPercent),
            }))
        : [];
    const existingById = new Map(existing.map((member) => [member.stockItemId, member]));
    const memberIds = new Set([...current.map((item) => item.id), ...existingById.keys()]);
    setDraft((value) => ({
      ...value,
      shelfKey,
      members: [...memberIds].map(
        (stockItemId) =>
          existingById.get(stockItemId) ?? {
            stockItemId,
            included: false,
            stockCompositionPercent: '',
            shoppingCompositionPercent: '',
          },
      ),
    }));
  };
  const updateMember = (stockItemId: string, patch: Partial<DraftMember>) => {
    setDraft((value) => ({
      ...value,
      members: value.members.map((member) =>
        member.stockItemId === stockItemId ? { ...member, ...patch } : member,
      ),
    }));
  };
  const submit = async () => {
    const included = draft.members.filter((member) => member.included);
    const size = Number(draft.sizePerCrate);
    const stockTotal = included.reduce(
      (total, member) => total + Number(member.stockCompositionPercent),
      0,
    );
    const shoppingTotal = included.reduce(
      (total, member) => total + Number(member.shoppingCompositionPercent),
      0,
    );
    if (draft.name.trim() === '') {
      setFormError('Enter a crate name.');
      return;
    }
    if (draft.shelfKey === '') {
      setFormError('Choose a shelf.');
      return;
    }
    if (draft.groupingId === '') {
      setFormError('Choose a grouping.');
      return;
    }
    if (!Number.isInteger(size) || size < 1) {
      setFormError('Size per crate must be a whole number of 1 or more.');
      return;
    }
    if (included.length < 2) {
      setFormError('Include at least two member items.');
      return;
    }
    if (
      included.some(
        (member) =>
          !Number.isInteger(Number(member.stockCompositionPercent)) ||
          !Number.isInteger(Number(member.shoppingCompositionPercent)) ||
          Number(member.stockCompositionPercent) < 0 ||
          Number(member.shoppingCompositionPercent) < 0,
      )
    ) {
      setFormError('Composition percentages must be whole non-negative numbers.');
      return;
    }
    if (stockTotal !== 100 || shoppingTotal !== 100) {
      setFormError('Both stock and shopping composition totals must add up to exactly 100.');
      return;
    }
    const input: CrateInput = {
      name: draft.name.trim(),
      shelfKey: draft.shelfKey,
      groupingId: draft.groupingId,
      sizePerCrate: size,
      members: included.map(
        ({ stockItemId, stockCompositionPercent, shoppingCompositionPercent }) => ({
          stockItemId,
          stockCompositionPercent: Number(stockCompositionPercent),
          shoppingCompositionPercent: Number(shoppingCompositionPercent),
        }),
      ),
    };
    try {
      if (editing === null) await create.mutateAsync(input);
      else await amend.mutateAsync({ id: editing.id, patch: input, previous: editing });
      reset();
    } catch {
      /* rendered below */
    }
  };
  const stockTotal = draft.members
    .filter((member) => member.included)
    .reduce((total, member) => total + (Number(member.stockCompositionPercent) || 0), 0);
  const shoppingTotal = draft.members
    .filter((member) => member.included)
    .reduce((total, member) => total + (Number(member.shoppingCompositionPercent) || 0), 0);

  return (
    <div className={styles.page}>
      <CratesHeader />
      {crates.data.length === 0 ? (
        <EmptyState
          headline="No crates yet"
          sentence="Add a crate below for a shelf with more than one item."
        />
      ) : (
        <section aria-label="Crates results" className={styles.results}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Crate</th>
                <th scope="col">Shelf</th>
                <th scope="col">Grouping</th>
                <th scope="col">Size</th>
                <th scope="col">Members</th>
                <th scope="col">Current crates</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {crates.data.map((crate) => (
                <tr key={crate.id}>
                  <th scope="row">{crate.name}</th>
                  <td>{crate.shelfKey}</td>
                  <td>
                    {groupings.data.find((grouping) => grouping.id === crate.groupingId)?.name ??
                      'Unknown grouping'}
                  </td>
                  <td>{crate.sizePerCrate}</td>
                  <td>{crate.members.length}</td>
                  <td>{computeCrateReferenceCount(crate, levels.data).toFixed(1)}</td>
                  <td className={styles.tableActions}>
                    <button
                      aria-label={`Edit ${crate.name}`}
                      className="button-plain"
                      onClick={() => {
                        beginEdit(crate);
                      }}
                      title={`Edit ${crate.name}`}
                      type="button"
                    >
                      <ResponsiveIconLabel label="Edit">
                        <PencilIcon />
                      </ResponsiveIconLabel>
                    </button>
                    <button
                      aria-label={`Delete ${crate.name}`}
                      className="button-danger button-plain"
                      disabled={remove.isPending}
                      onClick={() => {
                        setDeleteCandidate(crate);
                      }}
                      title={`Delete ${crate.name}`}
                      type="button"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section aria-labelledby="crate-editor-heading" className={styles.crateEditor}>
        <h2 id="crate-editor-heading">
          {editing === null ? 'Add a crate' : `Amend ${editing.name}`}
        </h2>
        {(create.error !== null || amend.error !== null || remove.error !== null) && (
          <ErrorNotice error={create.error ?? amend.error ?? remove.error} />
        )}
        <p aria-live="polite" className={styles.visuallyHidden} role="status">
          {deletedName !== null && `Deleted ${deletedName}.`}
        </p>
        <div className={styles.field}>
          <label htmlFor="crate-name">Name</label>
          <input
            id="crate-name"
            onChange={(event) => {
              setDraft((value) => ({ ...value, name: event.target.value }));
            }}
            type="text"
            value={draft.name}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="crate-shelf">Shelf</label>
          <select
            id="crate-shelf"
            onChange={(event) => {
              selectShelf(event.target.value);
            }}
            value={draft.shelfKey}
          >
            <option value="">Choose a shelf…</option>
            {selectableShelves.map(([shelf]) => (
              <option key={shelf} value={shelf}>
                {shelf}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="crate-grouping">Stock-take grouping</label>
          <select
            id="crate-grouping"
            onChange={(event) => {
              setDraft((value) => ({ ...value, groupingId: event.target.value }));
            }}
            value={draft.groupingId}
          >
            <option value="">Choose a grouping…</option>
            {groupings.data.map((grouping) => (
              <option key={grouping.id} value={grouping.id}>
                {grouping.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="crate-size">Units per crate</label>
          <input
            id="crate-size"
            inputMode="numeric"
            onChange={(event) => {
              setDraft((value) => ({ ...value, sizePerCrate: event.target.value }));
            }}
            type="text"
            value={draft.sizePerCrate}
          />
        </div>
        {hasDraftMembers && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Include</th>
                <th scope="col">Stock %</th>
                <th scope="col">Shopping %</th>
              </tr>
            </thead>
            <tbody>
              {draft.members.map((member) => {
                const item = items.data.find((candidate) => candidate.id === member.stockItemId);
                return (
                  <tr key={member.stockItemId}>
                    <th scope="row">
                      {item?.name ?? member.stockItemId}
                      {item !== undefined && !item.isActive ? ' (Retired)' : ''}
                    </th>
                    <td>
                      <label>
                        <input
                          checked={member.included}
                          onChange={(event) => {
                            updateMember(member.stockItemId, { included: event.target.checked });
                          }}
                          type="checkbox"
                        />{' '}
                        Include
                      </label>
                    </td>
                    <td>
                      <label
                        className={styles.visuallyHidden}
                        htmlFor={`crate-stock-${member.stockItemId}`}
                      >
                        Stock percentage for {item?.name ?? member.stockItemId}
                      </label>
                      <input
                        disabled={!member.included}
                        id={`crate-stock-${member.stockItemId}`}
                        inputMode="numeric"
                        onChange={(event) => {
                          updateMember(member.stockItemId, {
                            stockCompositionPercent: event.target.value,
                          });
                        }}
                        type="text"
                        value={member.stockCompositionPercent}
                      />
                    </td>
                    <td>
                      <label
                        className={styles.visuallyHidden}
                        htmlFor={`crate-shopping-${member.stockItemId}`}
                      >
                        Shopping percentage for {item?.name ?? member.stockItemId}
                      </label>
                      <input
                        disabled={!member.included}
                        id={`crate-shopping-${member.stockItemId}`}
                        inputMode="numeric"
                        onChange={(event) => {
                          updateMember(member.stockItemId, {
                            shoppingCompositionPercent: event.target.value,
                          });
                        }}
                        type="text"
                        value={member.shoppingCompositionPercent}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2} scope="row">
                  Totals
                </th>
                <td>{stockTotal}</td>
                <td>{shoppingTotal}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {formError !== null && (
          <p className={styles.fieldError} role="alert">
            {formError}
          </p>
        )}
        <div className={styles.formActions}>
          <button
            disabled={create.isPending || amend.isPending}
            onClick={() => void submit()}
            ref={addCrateButtonRef}
            type="button"
          >
            {editing === null ? 'Add crate' : 'Save changes'}
          </button>
          {editing !== null && (
            <button className="button-secondary" onClick={reset} type="button">
              Cancel
            </button>
          )}
        </div>
      </section>
      {deleteCandidate !== null && (
        <ConfirmDialog
          busy={remove.isPending}
          confirmLabel={`Delete ${deleteCandidate.name}`}
          destructive
          onCancel={() => {
            setDeleteCandidate(null);
          }}
          onConfirm={() => void confirmDelete()}
          title={`Delete ${deleteCandidate.name}?`}
        >
          This removes the crate definition. Target lists that name it will need administrator
          attention.
        </ConfirmDialog>
      )}
    </div>
  );
}

function CratesHeader() {
  return (
    <div className={styles.headerCard}>
      <PageHeader
        description={
          <p>
            A crate is an explicit set of items on one shelf. Its stock and shopping composition
            columns must each total 100.
          </p>
        }
        icon={<BoxIcon />}
        title="Crates"
      />
    </div>
  );
}
