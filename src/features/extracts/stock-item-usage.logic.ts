/**
 * The session-level stock-usage sheet is deliberately separate from the
 * referral archive. A session id is useful here: unlike a referral id, it is
 * the only durable way to reconcile the one row written for a whole session.
 */
export const STOCK_ITEM_USAGE_FIXED_HEADERS = [
  'sessionId',
  'sessionDate',
  'sessionLocation',
] as const;

export interface StockItemUsage {
  readonly stockItemId: string;
  readonly stockItemName: string;
  readonly quantity: number;
}

export interface StockItemUsageSession {
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly sessionLocation: string;
  readonly stockItemUsage: readonly StockItemUsage[];
}

export interface StockItemUsageColumn {
  readonly key: string;
  readonly heading: string;
}

export function stockItemUsageKey(stockItemId: string): string {
  return `stockItem.${stockItemId}`;
}

/**
 * A renamed (or retired) item is identified by its id, never by its name. The
 * Sheets writer will use the friendly heading only when it creates a column,
 * leaving any existing editable heading alone.
 */
export function stockItemUsageColumns(
  usage: readonly StockItemUsage[],
): readonly StockItemUsageColumn[] {
  const columns = new Map<string, string>();
  for (const item of usage) columns.set(stockItemUsageKey(item.stockItemId), item.stockItemName);
  return [...columns.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, heading]) => ({ key, heading }));
}

export function stockItemUsageRow(
  session: StockItemUsageSession,
  headers: readonly string[],
): (string | number)[] {
  const values = new Map(
    session.stockItemUsage.map((item) => [stockItemUsageKey(item.stockItemId), item.quantity]),
  );
  return headers.map((header) => {
    if (header === 'sessionId') return session.sessionId;
    if (header === 'sessionDate') return session.sessionDate;
    if (header === 'sessionLocation') return session.sessionLocation;
    return values.get(header) ?? '';
  });
}
