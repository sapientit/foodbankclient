import {
  reconcileLines,
  type StoredCrateTargetLine,
  type StoredTargetLine,
} from './target-stock-lists.logic';

/**
 * The pure half of the Shopping screen: turning a chosen target stock list plus
 * the current stock position into what a team lead should buy.
 *
 * No React, no `api/schema` import — `computeShoppingList` takes the stored
 * lines and a structural view of the stock levels.
 *
 * **This runs in the browser** because a team lead reads a list's raw `lines`
 * (server Q48, settled) — a target stock list holds nothing a team lead does
 * not already see in the stock room.
 */

/** A stock level as the shopping computation needs to see it. */
export interface ShoppingStockLevel {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly isActive: boolean;
  /**
   * May be negative after an attendance correction. The shortfall arithmetic
   * clamps it at zero — a negative level is a tracking error, not stock this
   * week's shop can recover, so the buy quantity only ever reaches the target
   * from an empty shelf.
   */
  readonly quantityOnHand: number;
}

/** One live item from the cross-session requirements summary. */
export interface ShoppingRequirement {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly requiredQuantity: number;
}

export interface ShoppingItem {
  /** The live catalogue name. */
  readonly name: string;
  readonly category: string;
  readonly targetQuantity: number;
  readonly quantityOnHand: number;
  /**
   * `targetQuantity - max(0, quantityOnHand)`, always `> 0` for an item that
   * reaches the list.
   */
  readonly need: number;
  /** The stored snapshot name no longer matches the catalogue — flagged on the sheet. */
  readonly renamedFrom: string | null;
}

export interface CategoryGroup {
  readonly category: string;
  readonly items: readonly ShoppingItem[];
}

export interface AttentionLine {
  readonly storedName: string;
  readonly targetQuantity: number;
  /** `retired` — the item is inactive; `missing` — the id is not in the catalogue. */
  readonly kind: 'retired' | 'missing' | 'crate-member' | 'missing-crate';
}

export interface ShoppingList {
  /** Category groups, categories alphabetical, items alphabetical by name within each. */
  readonly groups: readonly CategoryGroup[];
  /** Retired and missing lines: not bought, shown to the team lead for an admin to fix. */
  readonly attention: readonly AttentionLine[];
  /** Live names of renamed items — shown inline on the sheet and counted in the summary. */
  readonly renamed: readonly string[];
}

/** The part of a crate definition needed to turn its shopping target into item lines. */
export interface ShoppingCrate {
  readonly sizePerCrate: number;
  readonly members: readonly ShoppingCrateMember[];
}

export interface ShoppingCrateMember {
  readonly stockItemId: string;
  /** The server only saves a crate where these values total exactly 100. */
  readonly shoppingCompositionPercent: number;
}

export interface CrateShoppingShortfall {
  readonly stockItemId: string;
  readonly quantity: number;
}

/**
 * Turns one fractional crate target into named raw-item quantities for the
 * ordinary shopping list. The shopper receives no separate "crate" section:
 * the caller merges these rows with its normal category-sorted rows.
 *
 * A negative level is treated as an empty shelf, exactly as an ordinary target
 * line is above. A parcel issue can make a ledger level negative between stock
 * takes, but that tracking error is not stock the shop can recover.
 */
export function decomposeCrateShoppingShortfall(
  crate: ShoppingCrate,
  targetCrates: number,
  levels: readonly Pick<ShoppingStockLevel, 'id' | 'quantityOnHand'>[],
): CrateShoppingShortfall[] {
  const quantityByItemId = new Map(levels.map((level) => [level.id, level.quantityOnHand]));
  const currentUnits = crate.members.reduce(
    (sum, member) => sum + Math.max(0, quantityByItemId.get(member.stockItemId) ?? 0),
    0,
  );
  const shortfallUnits = Math.max(targetCrates * crate.sizePerCrate - currentUnits, 0);

  const allocations = crate.members.map((member, index) => {
    const exact = (shortfallUnits * member.shoppingCompositionPercent) / 100;
    return {
      stockItemId: member.stockItemId,
      quantity: Math.floor(exact),
      remainder: exact % 1,
      index,
    };
  });
  let remaining =
    shortfallUnits - allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  for (const allocation of [...allocations].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  )) {
    if (remaining === 0) break;
    allocation.quantity += 1;
    remaining -= 1;
  }
  return allocations.map(({ stockItemId, quantity }) => ({ stockItemId, quantity }));
}

/**
 * For each line on the chosen list:
 * - id not in the catalogue → an `attention` line (`missing`), not bought
 * - id resolves to a retired item → an `attention` line (`retired`), not bought
 * - id resolves to an active item and `target - onHand > 0` → a `ShoppingItem`
 *   in its category group (flagged if the name has since changed)
 * - id resolves to an active item already at or above target → dropped
 */
export function computeShoppingList(
  storedLines: readonly StoredTargetLine[],
  stockLevels: readonly ShoppingStockLevel[],
): ShoppingList {
  const byId = new Map(stockLevels.map((level) => [level.id, level]));
  // The same renamed / retired / missing classifier the editor uses — a
  // `ShoppingStockLevel` is structurally a `CatalogueItem`.
  const reconciled = reconcileLines(storedLines, stockLevels);

  const items: ShoppingItem[] = [];
  const attention: AttentionLine[] = [];
  const renamed: string[] = [];

  for (const line of reconciled) {
    if (line.discrepancy === 'retired' || line.discrepancy === 'missing') {
      attention.push({
        storedName: line.storedName,
        targetQuantity: line.targetQuantity,
        kind: line.discrepancy,
      });
      continue;
    }

    // `null` or `renamed` — the id resolves to an active item, so it is in `byId`.
    const level = byId.get(line.stockItemId);
    if (level === undefined) continue;

    // Clamp a negative on-hand figure at zero: those units went out unrecorded
    // and next week's shop cannot put that right — buy only enough to reach the
    // target from an empty shelf.
    const need = line.targetQuantity - Math.max(0, level.quantityOnHand);
    if (need <= 0) continue;

    const renamedFrom = line.discrepancy === 'renamed' ? line.storedName : null;
    if (renamedFrom !== null) renamed.push(level.name);

    items.push({
      name: level.name,
      category: level.category,
      targetQuantity: line.targetQuantity,
      quantityOnHand: level.quantityOnHand,
      need,
      renamedFrom,
    });
  }

  return { groups: groupByCategory(items), attention, renamed };
}

/**
 * Turns the server's cross-session requirements total into a shop list. The
 * server deliberately returns requirements only: current stock is a live
 * client-side input, so the calculation remains fresh when a stock take or
 * attendance outcome changes while this screen is open.
 */
export function computeRequirementShoppingList(
  requirements: readonly ShoppingRequirement[],
  stockLevels: readonly Pick<ShoppingStockLevel, 'id' | 'quantityOnHand'>[],
): ShoppingList {
  const levelsById = new Map(stockLevels.map((level) => [level.id, level.quantityOnHand]));
  const items = requirements.flatMap((requirement) => {
    const quantityOnHand = levelsById.get(requirement.id) ?? 0;
    const need = requirement.requiredQuantity - Math.max(0, quantityOnHand);
    return need <= 0
      ? []
      : [
          {
            name: requirement.name,
            category: requirement.category,
            targetQuantity: requirement.requiredQuantity,
            quantityOnHand,
            need,
            renamedFrom: null,
          },
        ];
  });
  return { groups: groupByCategory(items), attention: [], renamed: [] };
}

/** Merge raw item targets with client-derived crate shortfalls, without asking the Worker to scan the catalogue. */
export function computeShoppingListWithCrates(
  itemLines: readonly StoredTargetLine[],
  crateLines: readonly StoredCrateTargetLine[],
  crates: readonly (ShoppingCrate & { readonly id: string; readonly name: string })[],
  stockLevels: readonly ShoppingStockLevel[],
): ShoppingList {
  const memberIds = new Set(
    crates.flatMap((crate) => crate.members.map((member) => member.stockItemId)),
  );
  const base = computeShoppingList(
    itemLines.filter((line) => !memberIds.has(line.stockItemId)),
    stockLevels,
  );
  const attention = [
    ...base.attention,
    ...itemLines
      .filter((line) => memberIds.has(line.stockItemId))
      .map((line) => ({
        storedName: line.name,
        targetQuantity: line.targetQuantity,
        kind: 'crate-member' as const,
      })),
  ];
  const additions: ShoppingItem[] = base.groups.flatMap((group) => group.items);
  const levelsById = new Map(stockLevels.map((level) => [level.id, level]));
  const cratesById = new Map(crates.map((crate) => [crate.id, crate]));
  for (const line of crateLines) {
    const crate = cratesById.get(line.crateId);
    if (crate === undefined) {
      attention.push({
        storedName: line.crateName,
        targetQuantity: line.targetQuantity,
        kind: 'missing-crate',
      });
      continue;
    }
    for (const shortfall of decomposeCrateShoppingShortfall(
      crate,
      line.targetQuantity,
      stockLevels,
    )) {
      const level = levelsById.get(shortfall.stockItemId);
      if (level === undefined || !level.isActive || shortfall.quantity === 0) continue;
      additions.push({
        name: level.name,
        category: level.category,
        targetQuantity: 0,
        quantityOnHand: level.quantityOnHand,
        need: shortfall.quantity,
        renamedFrom: null,
      });
    }
  }
  const merged = new Map<string, ShoppingItem>();
  for (const item of additions) {
    const key = `${item.category}\u0000${item.name}`;
    const current = merged.get(key);
    merged.set(key, current === undefined ? item : { ...current, need: current.need + item.need });
  }
  return { groups: groupByCategory([...merged.values()]), attention, renamed: base.renamed };
}

/**
 * Groups the buy list by category, **categories alphabetical and items
 * alphabetical by name within each**.
 *
 * This is the one place stock is deliberately not in the server's shelf order.
 * Everywhere else — `stock/queries.ts`, `stock-check-panel.tsx`, the printed
 * picking sheet — the rule is "render in the order given, never re-sort",
 * because the reader is walking the warehouse aisle. The person reading a
 * shopping list is walking a supermarket, where shelf order means nothing, so
 * an A–Z list is what helps them. Do not "fix" this to match the others.
 */
export function groupByCategory(items: readonly ShoppingItem[]): CategoryGroup[] {
  const byCategory = new Map<string, ShoppingItem[]>();

  for (const item of items) {
    const bucket = byCategory.get(item.category);
    if (bucket === undefined) byCategory.set(item.category, [item]);
    else bucket.push(item);
  }

  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, groupItems]) => ({
      category,
      items: [...groupItems].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/**
 * Splits the category groups into `columns` column-first groups for the printed
 * sheet — fill the first column top to bottom, then the second, then the third.
 *
 * The atomic unit is a whole group (its heading plus its rows): a heading is
 * never separated from its first item, and a category that is heavier than a
 * column is left to overflow rather than split — the same correctness-over-
 * balance trade-off `splitPrintLines` makes in the pick-lists feature, with
 * `break-inside: avoid` on the group letting the browser push an oversized one
 * to the next page.
 */
export function splitGroupedColumns(
  groups: readonly CategoryGroup[],
  columns = 3,
): CategoryGroup[][] {
  const weightOf = (group: CategoryGroup) => 1 + group.items.length;
  const totalWeight = groups.reduce((sum, group) => sum + weightOf(group), 0);
  const targetWeight = Math.ceil(totalWeight / columns);

  const result: CategoryGroup[][] = [];
  let current: CategoryGroup[] = [];
  let currentWeight = 0;

  for (const group of groups) {
    const weight = weightOf(group);
    if (
      current.length > 0 &&
      currentWeight + weight > targetWeight &&
      result.length < columns - 1
    ) {
      result.push(current);
      current = [];
      currentWeight = 0;
    }
    current.push(group);
    currentWeight += weight;
  }
  result.push(current);

  while (result.length < columns) result.push([]);
  return result;
}

/**
 * The buy list as plain text for the clipboard: a category heading on its own
 * line, then a tab between each item name and its quantity so it pastes into a
 * spreadsheet as two columns. A trailing block names anything an admin needs to
 * sort out, with the target only — there is no stock figure for a retired or
 * missing item.
 */
export function shoppingListToPlainText(
  groups: readonly CategoryGroup[],
  attention: readonly AttentionLine[],
): string {
  const blocks: string[] = groups.map((group) =>
    [group.category, ...group.items.map((item) => `${item.name}\t${String(item.need)}`)].join('\n'),
  );

  if (attention.length > 0) {
    blocks.push(
      [
        "Needs an administrator's attention — not bought",
        ...attention.map((line) => `${line.storedName}\t${String(line.targetQuantity)}`),
      ].join('\n'),
    );
  }

  return blocks.join('\n\n');
}
