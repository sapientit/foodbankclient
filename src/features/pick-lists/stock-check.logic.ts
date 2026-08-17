import type { StockRequirementLine } from './queries';

/**
 * Reading the session's stock requirement: how many items it names, and how
 * many of them the warehouse cannot cover.
 *
 * **The server's `shortfall` is the only authority on whether an item is
 * short.** It is `requiredQuantity - quantityOnHand` floored at zero, and this
 * client does not recompute it: `quantityOnHand` may be negative, and a
 * subtraction written a second time here is a second place for the sign to go
 * wrong. Anything above zero is the number that cannot be found.
 */
export interface StockCheckSummary {
  /** How many stock items the session's parcels call for. */
  readonly itemCount: number;
  /** How many of them cannot be covered. */
  readonly shortCount: number;
}

export function summariseStockCheck(items: readonly StockRequirementLine[]): StockCheckSummary {
  return {
    itemCount: items.length,
    shortCount: items.filter(isShort).length,
  };
}

export function isShort(line: StockRequirementLine): boolean {
  return line.shortfall > 0;
}

/**
 * The one sentence above the table, which is what a team lead reads before they
 * read anything else.
 *
 * It leads with the count that means work — how many items are short — because
 * that is the whole reason to open this. The reassuring case says so plainly
 * rather than leaving an unexplained table to be scanned for a problem that is
 * not there.
 */
export function describeStockCheck({ itemCount, shortCount }: StockCheckSummary): string {
  if (itemCount === 0) return 'This session asks for no stock items.';

  if (itemCount === 1) {
    return shortCount === 0
      ? 'The one stock item this session asks for is covered.'
      : 'The one stock item this session asks for cannot be covered.';
  }

  const asked = `the ${String(itemCount)} stock items this session asks for`;

  return shortCount === 0
    ? `Every one of ${asked} is covered.`
    : `${String(shortCount)} of ${asked} cannot be covered.`;
}
