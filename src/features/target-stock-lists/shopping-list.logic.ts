import { reconcileLines, type StoredTargetLine } from './target-stock-lists.logic';

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
  /** May be negative after an attendance correction — do not clamp it. */
  readonly quantityOnHand: number;
}

export interface ShoppingItem {
  /** The live catalogue name. */
  readonly name: string;
  readonly category: string;
  readonly targetQuantity: number;
  readonly quantityOnHand: number;
  /** `targetQuantity - quantityOnHand`, always `> 0` for an item that reaches the list. */
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
  readonly kind: 'retired' | 'missing';
}

export interface ShoppingList {
  /** Category groups, categories alphabetical, items alphabetical by name within each. */
  readonly groups: readonly CategoryGroup[];
  /** Retired and missing lines: not bought, shown to the team lead for an admin to fix. */
  readonly attention: readonly AttentionLine[];
  /** Live names of renamed items — shown inline on the sheet and counted in the summary. */
  readonly renamed: readonly string[];
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

    const need = line.targetQuantity - level.quantityOnHand;
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
