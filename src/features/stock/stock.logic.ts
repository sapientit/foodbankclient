import type { StockItem, StockLevel } from './queries';

/** How the server compares two item names. */
export function normaliseStockItemName(name: string): string {
  return name.trim().toLowerCase();
}

/** Finds an existing name, including a retired item which still reserves it. */
export function findStockItemByName(
  items: readonly StockItem[],
  name: string,
  excludeId?: string,
): StockItem | undefined {
  const wanted = normaliseStockItemName(name);
  if (wanted === '') return undefined;

  return items.find(
    (item) => item.id !== excludeId && normaliseStockItemName(item.name) === wanted,
  );
}

export interface ByStatus<T> {
  readonly active: readonly T[];
  readonly retired: readonly T[];
}

/** Split a complete server list without changing its shelf order. */
export function splitByStatus<T extends { readonly isActive: boolean }>(
  rows: readonly T[],
): ByStatus<T> {
  return {
    active: rows.filter((row) => row.isActive),
    retired: rows.filter((row) => !row.isActive),
  };
}

export type QuantityProblem = 'empty' | 'not-a-whole-number' | 'below-minimum' | 'too-large';

export type Quantity =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: QuantityProblem };

/** Parse an unsigned whole quantity. A zero count is a legitimate empty shelf. */
export function parseWholeQuantity(text: string, minimum: number): Quantity {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  if (!/^[+-]?\d+$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, problem: 'too-large' };
  if (value < minimum) return { ok: false, problem: 'below-minimum' };

  return { ok: true, value };
}

/**
 * Every active item, plus a retired item that still has a balance to reset.
 * `filter` preserves the shelf order supplied by the API.
 */
export function countableLevels(levels: readonly StockLevel[]): StockLevel[] {
  return levels.filter((level) => level.isActive || level.quantityOnHand !== 0);
}
