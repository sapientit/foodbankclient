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

/** Parse a non-negative count that the crate and packing-unit contracts allow to one decimal place. */
export function parseOneDecimalQuantity(text: string, minimum: number): Quantity {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  if (!/^[+-]?\d+(?:\.\d)?$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER)
    return { ok: false, problem: 'too-large' };
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

/** The server's low-stock summary is active watched items strictly below their threshold. */
export function isLowStock(
  level: Pick<StockLevel, 'isActive' | 'lowStockThreshold' | 'quantityOnHand'>,
): boolean {
  return (
    level.isActive &&
    level.lowStockThreshold !== null &&
    level.quantityOnHand < level.lowStockThreshold
  );
}

/** The part of a crate returned by the API needed by stock-take presentation. */
export interface StockTakeCrate {
  readonly sizePerCrate: number;
  readonly members: readonly StockTakeCrateMember[];
}

export interface StockTakeCrateMember {
  readonly stockItemId: string;
}

/** A crate has no stored stock level: its reference is derived from its members. */
export function computeCrateReferenceCount(
  crate: StockTakeCrate,
  levels: readonly Pick<StockLevel, 'id' | 'quantityOnHand'>[],
): number {
  const quantityByItemId = new Map(levels.map((level) => [level.id, level.quantityOnHand]));
  const totalUnits = crate.members.reduce(
    (sum, member) => sum + (quantityByItemId.get(member.stockItemId) ?? 0),
    0,
  );
  return totalUnits / crate.sizePerCrate;
}

/** A blank optional label deliberately reads as the useful generic plural. */
export function packUnitLabelFor(item: {
  readonly unitsPerPack: number | null;
  readonly packUnitLabel: string | null;
}): string {
  const label = item.packUnitLabel?.trim();
  return label === undefined || label === '' ? 'packs' : label;
}

/** Converts a one-decimal pack count to the nearest whole item the stock ledger can store. */
export function applyPackingUnit(packCount: number, unitsPerPack: number): number {
  return Math.round(packCount * unitsPerPack);
}
