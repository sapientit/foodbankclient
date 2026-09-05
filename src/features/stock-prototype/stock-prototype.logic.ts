import type {
  Crate,
  CountingStatus,
  CrateTargetLine,
  ItemTargetLine,
  ProtoStockItem,
  StockPrototypeState,
  ValidationIssue,
} from './types';

/** Whether a stock item is a declared member of any crate — a crate member is never targeted
 * individually (planning doc §2): only the crate's own aggregate target reaches it. */
export function isCrateMember(item: ProtoStockItem, crates: readonly Crate[]): boolean {
  return crates.some((crate) => crate.members.some((m) => m.stockItemId === item.id));
}

/** How a stock item is counted at a stock take: directly grouped, covered by a crate, not
 * covered by either (invalid), or covered by both (also invalid — see planning doc §1). */
export function countingStatus(item: ProtoStockItem, crates: readonly Crate[]): CountingStatus {
  const inCrate = isCrateMember(item, crates);
  const direct = item.groupingId !== null;
  if (inCrate && direct) return 'double-counted';
  if (inCrate) return 'crate';
  if (direct) return 'direct';
  return 'uncounted';
}

/** Crates keyed to shelves carrying more than one item, per planning doc §2. */
export function shelvesWithMultipleItems(
  items: readonly ProtoStockItem[],
): ReadonlyMap<string, readonly ProtoStockItem[]> {
  const byShelf = new Map<string, ProtoStockItem[]>();
  for (const item of items) {
    const existing = byShelf.get(item.shelfNumber);
    if (existing) existing.push(item);
    else byShelf.set(item.shelfNumber, [item]);
  }
  return new Map([...byShelf].filter(([, shelfItems]) => shelfItems.length > 1));
}

/** How a crate reads in a message meant for a person — its name first, the shelf as context. */
function describeCrate(crate: Crate): string {
  return `“${crate.name}” (shelf ${crate.shelfKey})`;
}

/**
 * The three crate-integrity checks from planning doc §2 "Validation", plus the §1 counting-coverage
 * invariant (an item counted by neither mechanism, or both, is invalid). Nothing here is blocking —
 * it is a plain list of what an admin needs to fix, in the order the doc lists the crate checks.
 */
export function validateStock(state: StockPrototypeState): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const itemsById = new Map(state.items.map((item) => [item.id, item]));

  for (const [shelf] of shelvesWithMultipleItems(state.items)) {
    const hasCrate = state.crates.some((crate) => crate.shelfKey === shelf);
    if (!hasCrate) {
      issues.push({
        kind: 'shelf-without-crate',
        message: `Shelf ${shelf} carries more than one item but has no crate definition.`,
      });
    }
  }

  for (const crate of state.crates) {
    if (crate.members.length <= 1) {
      issues.push({
        kind: 'crate-too-few-members',
        message: `The crate ${describeCrate(crate)} has ${String(crate.members.length)} member item${crate.members.length === 1 ? '' : 's'} — a crate needs more than one.`,
      });
    }

    for (const member of crate.members) {
      const item = itemsById.get(member.stockItemId);
      if (item !== undefined && item.shelfNumber !== crate.shelfKey) {
        issues.push({
          kind: 'member-shelf-mismatch',
          message: `${item.name} is a member of ${describeCrate(crate)} but its own shelf number is now ${item.shelfNumber}.`,
        });
      }
    }
  }

  for (const item of state.items) {
    const status = countingStatus(item, state.crates);
    if (status === 'uncounted') {
      issues.push({
        kind: 'item-uncounted',
        message: `${item.name} is not counted by any grouping or crate.`,
      });
    } else if (status === 'double-counted') {
      const crate = state.crates.find((c) => c.members.some((m) => m.stockItemId === item.id));
      issues.push({
        kind: 'item-double-counted',
        message: `${item.name} is directly grouped and also a member of ${crate === undefined ? 'a crate' : describeCrate(crate)} — it must be only one.`,
      });
    }
  }

  return issues;
}

/** `sum(member items' current stock) / crate size` — a crate has no stored level of its own. */
export function computeCrateReferenceCount(crate: Crate, items: readonly ProtoStockItem[]): number {
  if (crate.sizePerCrate <= 0) return 0;
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const total = crate.members.reduce(
    (sum, member) => sum + (itemsById.get(member.stockItemId)?.quantityOnHand ?? 0),
    0,
  );
  return total / crate.sizePerCrate;
}

function decomposeByPercent(
  crate: Crate,
  percentOf: (member: Crate['members'][number]) => number,
  totalUnits: number,
): { readonly stockItemId: string; readonly quantity: number }[] {
  const percentSum = crate.members.reduce((sum, member) => sum + percentOf(member), 0);
  if (percentSum <= 0) {
    return crate.members.map((member) => ({ stockItemId: member.stockItemId, quantity: 0 }));
  }
  return crate.members.map((member) => ({
    stockItemId: member.stockItemId,
    quantity: Math.round((totalUnits * percentOf(member)) / percentSum),
  }));
}

/**
 * Decomposes a freshly-counted, possibly fractional crate count into per-item stock quantities via
 * the stock-composition percentages. Divides by the members' percentage sum rather than assuming it
 * is exactly 100, so a table mid-edit still produces a sane split.
 */
export function decomposeCrateCount(
  crate: Crate,
  newCount: number,
): { readonly stockItemId: string; readonly quantityOnHand: number }[] {
  const totalUnits = newCount * crate.sizePerCrate;
  return decomposeByPercent(crate, (member) => member.stockCompositionPercent, totalUnits).map(
    ({ stockItemId, quantity }) => ({ stockItemId, quantityOnHand: quantity }),
  );
}

/** Decomposes a crate's shopping shortfall (target minus current computed units, floored at zero)
 * into named items to buy, via the shopping-composition percentages. */
export function decomposeCrateShortfall(
  crate: Crate,
  target: number,
  items: readonly ProtoStockItem[],
): { readonly stockItemId: string; readonly quantity: number }[] {
  const current = computeCrateReferenceCount(crate, items) * crate.sizePerCrate;
  const shortfallUnits = Math.max(target * crate.sizePerCrate - current, 0);
  return decomposeByPercent(crate, (member) => member.shoppingCompositionPercent, shortfallUnits);
}

/** A pack count is a pure entry convenience — never persisted, multiplied out on the spot. */
export function applyPackingUnit(packCount: number, unitsPerPack: number): number {
  return Math.round(packCount * unitsPerPack);
}

/** What to call a counted batch of this item — the item's own word if it has one, else the
 * generic plural "packs" (planning doc §3: "pack" is never assumed). */
export function packUnitLabelFor(item: ProtoStockItem): string {
  const label = item.packUnitLabel?.trim();
  return label === undefined || label === '' ? 'packs' : label;
}

export interface CategoryGroup<T> {
  readonly category: string;
  readonly rows: readonly T[];
}

/** Groups rows by category, A–Z by category and by name within it — the same ordering the real
 * shopping list uses, since a shopper reads a list alphabetically. */
export function groupByCategory<T extends { readonly category: string; readonly name: string }>(
  rows: readonly T[],
): readonly CategoryGroup<T>[] {
  const byCategory = new Map<string, T[]>();
  for (const row of rows) {
    const existing = byCategory.get(row.category);
    if (existing) existing.push(row);
    else byCategory.set(row.category, [row]);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, rows2]) => ({
      category,
      rows: [...rows2].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function findGroupingName(
  groupingId: string | null,
  groupings: StockPrototypeState['groupings'],
): string {
  if (groupingId === null) return '—';
  return groupings.find((g) => g.id === groupingId)?.name ?? '—';
}

export function itemTargetFor(
  itemTargets: readonly ItemTargetLine[],
  stockItemId: string,
): number | null {
  return itemTargets.find((line) => line.stockItemId === stockItemId)?.target ?? null;
}

export function crateTargetFor(
  crateTargets: readonly CrateTargetLine[],
  crateId: string,
): number | null {
  return crateTargets.find((line) => line.crateId === crateId)?.target ?? null;
}
