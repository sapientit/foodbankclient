import { parseWholeNumber } from '../../lib/whole-number';

/**
 * The pure half of target stock lists: the maintenance sort order, the
 * duplicate-name check, reconciling a stored list against the current stock
 * catalogue, projecting it into editor rows, and turning those rows back into a
 * save payload.
 *
 * No React, no `api/schema` import — every function takes a structural shape so
 * it is tested directly. `shopping-list.logic.ts` is the other half: what a
 * team lead actually buys.
 */

/** `TargetStockList.name`: `maxLength: 80` in the contract. */
export const MAX_TARGET_STOCK_LIST_NAME_LENGTH = 80;

/**
 * The bounds a target quantity is held and parsed within. `minimum: 1` is the
 * contract (`TargetStockLine.targetQuantity`); the maximum is a client sanity
 * cap, not a contract limit — a real target is dozens, and five digits is far
 * past anything the food bank would buy to.
 */
export const TARGET_QUANTITY_BOUNDS = { minimum: 1, maximum: 99_999 };

/** A stored line, structurally — `TargetStockLine` from the contract. */
export interface StoredTargetLine {
  readonly kind: 'item';
  readonly stockItemId: string;
  readonly name: string;
  readonly targetQuantity: number;
}

/** A crate line stores a snapshot just like an item line, but permits one decimal place. */
export interface StoredCrateTargetLine {
  readonly kind: 'crate';
  readonly crateId: string;
  readonly crateName: string;
  readonly targetQuantity: number;
}

export interface CrateTargetDraft {
  readonly crateId: string;
  readonly crateName: string;
  readonly target: string;
}

/** Narrows the generated target-line union without importing the API contract into a component. */
export function isItemTargetLine<T extends { readonly kind: string }>(
  line: T,
): line is T & StoredTargetLine {
  return line.kind === 'item';
}

export function isCrateTargetLine<T extends { readonly kind: string }>(
  line: T,
): line is T & StoredCrateTargetLine {
  return line.kind === 'crate';
}

/**
 * Maintenance order for the list of target stock lists: by name. The endpoint
 * makes no ordering promise, so this is the client's own rule — the same
 * reasoning as `sortModelParcels`.
 */
export function sortTargetStockLists<T extends { readonly name: string }>(
  lists: readonly T[],
): T[] {
  return [...lists].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How this client compares two list names for its own duplicate check: trimmed,
 * but **not** case-folded — the `normaliseModelParcelName` rule, not
 * `normaliseStockItemName`. Called out here so nobody "fixes" it to match the
 * stock feature. This only pre-empts a clash already on screen; a real race is
 * still submitted and the server's `409` shown verbatim, so the exact server
 * rule does not have to be mirrored here.
 */
export function normaliseTargetStockListName(name: string): string {
  return name.trim();
}

/**
 * Finds a list already holding a name, so the create and amend screens can name
 * it and link to it rather than making the admin submit to find out. `excludeId`
 * is the list being amended — its own name is not a clash with itself.
 */
export function findTargetStockListByName<T extends { readonly id: string; readonly name: string }>(
  lists: readonly T[],
  name: string,
  excludeId?: string,
): T | undefined {
  const wanted = normaliseTargetStockListName(name);
  if (wanted === '') return undefined;

  return lists.find(
    (list) => list.id !== excludeId && normaliseTargetStockListName(list.name) === wanted,
  );
}

// ---------------------------------------------------------------- reconcile --

export type LineDiscrepancy = 'renamed' | 'retired' | 'missing';

/** A stock item as reconciliation needs to see it. */
export interface CatalogueItem {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

export interface ReconciledLine {
  readonly stockItemId: string;
  /** The name as it was snapshotted onto the list. */
  readonly storedName: string;
  /** The item's name in the catalogue now, or `null` when the item is gone. */
  readonly liveName: string | null;
  readonly targetQuantity: number;
  readonly discrepancy: LineDiscrepancy | null;
}

/**
 * Classifies every stored line against the current catalogue:
 * - `missing`  — the id is not in the catalogue at all
 * - `retired`  — the id resolves to an item that is no longer active
 * - `renamed`  — the id resolves to an active item whose name has changed
 * - `null`     — the id resolves to an active item and the name still matches
 */
export function reconcileLines(
  storedLines: readonly StoredTargetLine[],
  catalogue: readonly CatalogueItem[],
): ReconciledLine[] {
  const byId = new Map(catalogue.map((item) => [item.id, item]));

  return storedLines.map((line) => {
    const item = byId.get(line.stockItemId);

    if (item === undefined) {
      return {
        stockItemId: line.stockItemId,
        storedName: line.name,
        liveName: null,
        targetQuantity: line.targetQuantity,
        discrepancy: 'missing',
      };
    }

    if (!item.isActive) {
      return {
        stockItemId: line.stockItemId,
        storedName: line.name,
        liveName: item.name,
        targetQuantity: line.targetQuantity,
        discrepancy: 'retired',
      };
    }

    return {
      stockItemId: line.stockItemId,
      storedName: line.name,
      liveName: item.name,
      targetQuantity: line.targetQuantity,
      discrepancy: item.name === line.name ? null : 'renamed',
    };
  });
}

// ------------------------------------------------------------- editor model --

/** A stock item as the editor needs to see it — the catalogue in its own order. */
export interface EditorCatalogueItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly isActive: boolean;
}

export interface EditorRow {
  readonly stockItemId: string;
  /** The live name — the editor always shows the current catalogue name. */
  readonly name: string;
  readonly category: string;
  /** The current target as text: `''` when this item is not on the list. */
  readonly target: string;
  /** The stored snapshot name when it differs from the live one — a renamed line. */
  readonly renamedFrom: string | null;
}

export interface AttentionRow {
  readonly stockItemId: string;
  readonly storedName: string;
  readonly targetQuantity: number;
  readonly kind: 'retired' | 'missing';
}

export interface EditorModel {
  /** One row per **active** stock item, in the order the catalogue was given. */
  readonly rows: readonly EditorRow[];
  /** Stored lines whose item is retired or gone — these block saving until removed. */
  readonly attention: readonly AttentionRow[];
}

/**
 * Projects a stored list onto the editor: every active stock item gets a row
 * with its target pre-filled (blank where the item is not on the list), and any
 * stored line pointing at a retired or missing item is pulled into the
 * attention list. A renamed line is **not** an attention row — its active item
 * already has a row, showing the live name with `renamedFrom` set, and the
 * snapshot is refreshed silently on save.
 *
 * Pass the catalogue in the order the editor should render it (category order,
 * server-owned — do not re-sort here).
 */
export function buildEditorModel(
  catalogue: readonly EditorCatalogueItem[],
  storedLines: readonly StoredTargetLine[],
): EditorModel {
  const reconciled = reconcileLines(storedLines, catalogue);
  const byId = new Map(reconciled.map((line) => [line.stockItemId, line]));

  const rows: EditorRow[] = catalogue
    .filter((item) => item.isActive)
    .map((item) => {
      const line = byId.get(item.id);
      return {
        stockItemId: item.id,
        name: item.name,
        category: item.category,
        target: line === undefined ? '' : String(line.targetQuantity),
        renamedFrom: line?.discrepancy === 'renamed' ? line.storedName : null,
      };
    });

  const attention: AttentionRow[] = [];
  for (const line of reconciled) {
    if (line.discrepancy !== 'retired' && line.discrepancy !== 'missing') continue;
    attention.push({
      stockItemId: line.stockItemId,
      storedName: line.storedName,
      targetQuantity: line.targetQuantity,
      kind: line.discrepancy,
    });
  }

  return { rows, attention };
}

/**
 * Whether the admin still has retired or missing lines to deal with. Save is
 * blocked while this is true — a renamed line never blocks.
 */
export function hasUnresolvedLines(attention: readonly AttentionRow[]): boolean {
  return attention.length > 0;
}

// ----------------------------------------------------------------- payload --

/** A row as the form holds it: `target` is text until it is submitted. */
export interface DraftRow {
  readonly stockItemId: string;
  /** The live name — this is what gets snapshotted onto the saved line. */
  readonly name: string;
  readonly target: string;
}

export type ListPayloadResult =
  | { readonly ok: true; readonly lines: StoredTargetLine[] }
  | {
      readonly ok: false;
      readonly message: string;
      /** The row to move focus to, or `null` when the fault is "no items at all". */
      readonly focusStockItemId: string | null;
    };

/**
 * Turns the editor rows into the `lines` array to save, or says in one sentence
 * why not — and which row to send the admin to. Only rows with a value are kept
 * — an empty box means "not on this list", so clearing a box removes the line.
 * Each saved line carries the **live** name, so a renamed line is re-snapshotted
 * here.
 */
export function buildListPayload(rows: readonly DraftRow[]): ListPayloadResult {
  const lines: StoredTargetLine[] = [];

  for (const row of rows) {
    if (row.target.trim() === '') continue;

    const parsed = parseWholeNumber(row.target, TARGET_QUANTITY_BOUNDS);
    if (!parsed.ok) {
      const message =
        parsed.problem === 'below-minimum'
          ? `Enter 1 or more for ${row.name}, or clear the box to leave it off the list.`
          : `Check the target quantity for ${row.name}.`;
      return { ok: false, message, focusStockItemId: row.stockItemId };
    }

    lines.push({
      kind: 'item',
      stockItemId: row.stockItemId,
      name: row.name,
      targetQuantity: parsed.value,
    });
  }

  if (lines.length === 0) {
    return {
      ok: false,
      message: 'Set a target quantity for at least one item.',
      focusStockItemId: null,
    };
  }

  return { ok: true, lines };
}

/** Build crate snapshot lines, accepting positive values with no more than one decimal place. */
export function buildCrateTargetLines(
  rows: readonly CrateTargetDraft[],
):
  | { readonly ok: true; readonly lines: readonly StoredCrateTargetLine[] }
  | { readonly ok: false; readonly message: string; readonly focusCrateId: string } {
  const lines: StoredCrateTargetLine[] = [];
  for (const row of rows) {
    const value = row.target.trim();
    if (value === '') continue;
    if (!/^\d+(?:\.\d)?$/.test(value))
      return {
        ok: false,
        message: `Enter a positive number with at most one decimal place for ${row.crateName}.`,
        focusCrateId: row.crateId,
      };
    const targetQuantity = Number(value);
    if (!Number.isFinite(targetQuantity) || targetQuantity < 0.1 || targetQuantity > 99_999.9)
      return {
        ok: false,
        message: `Enter a positive number with at most one decimal place for ${row.crateName}.`,
        focusCrateId: row.crateId,
      };
    lines.push({ kind: 'crate', crateId: row.crateId, crateName: row.crateName, targetQuantity });
  }
  return { ok: true, lines };
}

/** Combined item and crate payload for the real target-list endpoints. */
export function buildTargetPayload(
  itemRows: readonly DraftRow[],
  crateRows: readonly CrateTargetDraft[],
):
  | { readonly ok: true; readonly lines: readonly (StoredTargetLine | StoredCrateTargetLine)[] }
  | {
      readonly ok: false;
      readonly message: string;
      readonly focusStockItemId: string | null;
      readonly focusCrateId: string | null;
    } {
  const itemRowsWithTargets = itemRows.filter((row) => row.target.trim() !== '');
  const items =
    itemRowsWithTargets.length === 0
      ? { ok: true as const, lines: [] as readonly StoredTargetLine[] }
      : buildListPayload(itemRows);
  if (!items.ok) return { ...items, focusCrateId: null };
  const crates = buildCrateTargetLines(crateRows);
  if (!crates.ok)
    return {
      ok: false,
      message: crates.message,
      focusStockItemId: null,
      focusCrateId: crates.focusCrateId,
    };
  const lines = [...items.lines, ...crates.lines];
  if (lines.length === 0)
    return {
      ok: false,
      message: 'Set a target quantity for at least one item or crate.',
      focusStockItemId: null,
      focusCrateId: null,
    };
  return { ok: true, lines };
}
