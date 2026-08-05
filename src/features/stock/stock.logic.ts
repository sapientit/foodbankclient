import { ApiError } from '../../lib/errors';
import type {
  MovementType,
  StockItem,
  StockLevel,
  StockTake,
  StockTakeAdjustment,
} from './queries';

/**
 * The pure half of stock: the duplicate-name predicate, the active/retired
 * split, and the six movement labels.
 *
 * No React, no fetching, tested directly. Everything here mirrors a rule the
 * server enforces, so the tests are also where a divergence gets noticed.
 *
 * **There is deliberately no shelf comparison in this file.** Both stock lists
 * arrive ordered by a `shelfSortKey` the server derives, which zero-pads the
 * numeric run so `A2` precedes `A10`. Nothing in this client re-sorts them, so
 * there is nothing to compare and no second implementation to keep in step. If
 * a local ordering is ever genuinely needed, port `compareShelfNumbers` from
 * `../foodbankserver/src/modules/stock/shelf-sort.ts` rather than writing one.
 */

/**
 * How the server compares two item names: trimmed and case-folded. Verified
 * against a running server — `Dup Test A`, `dup test a` and `  Dup Test A  `
 * are all the same name to it.
 */
export function normaliseStockItemName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The duplicate-name check, and it is **required rather than a nicety**.
 *
 * A duplicate name on `POST /stock/items` is a clean `409` with a sentence worth
 * showing. A duplicate name on `PATCH /stock/items/{id}` is **a 500** — verified
 * against a running server, which answers `INTERNAL_ERROR` and no explanation at
 * all. Without this check the only thing an admin correcting a typo would see is
 * "something went wrong at our end", which is both useless and untrue.
 *
 * **Retired items count.** A retired row still holds its name, and the server
 * still refuses it (verified: renaming onto a retired item's name is the same
 * 500). This is why both stock lists are fetched with `includeInactive=true` —
 * a check over active items only would miss the case that is hardest to
 * diagnose, because the colliding row is not on the screen.
 *
 * `excludeId` is the item being amended: renaming something to the name it
 * already has is allowed, including with different capitalisation, and refusing
 * it would block saving an unchanged form.
 */
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

/**
 * Splits a list the server sent whole. Both stock screens hide retired rows
 * behind a checkbox that names the count, because hiding something without
 * saying how much is hidden is what makes an item look deleted when it is not.
 *
 * Generic over anything with `isActive`, so the items list and the levels list
 * share one implementation and one test.
 */
export function splitByStatus<T extends { readonly isActive: boolean }>(
  rows: readonly T[],
): ByStatus<T> {
  return {
    active: rows.filter((row) => row.isActive),
    retired: rows.filter((row) => !row.isActive),
  };
}

/**
 * **`Record<MovementType, string>` over the generated union, on purpose.** The
 * day the server's `CHECK` constraint changes, this stops compiling until the UI
 * names the new value — rather than silently offering five of six options, or
 * rendering `undefined` next to a ledger line.
 *
 * `expiry` is **not** here and must not come back: it was removed from the
 * contract, and food thrown away is `wastage` whatever the reason it was thrown
 * away. Sending it now is a `400`.
 */
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  opening_balance: 'Opening balance',
  purchase: 'Bought in a shop',
  donation: 'Donated',
  parcel_issued: 'Given out in a parcel',
  wastage: 'Thrown away',
  correction: 'Correcting a mistake',
};

/**
 * The help under each option. All six are offered — including the two the app
 * normally writes for itself — because stock does arrive without a recorded
 * shop and parcels do get handed over outside a session, and both have to have
 * a way onto the ledger.
 */
export const MOVEMENT_TYPE_HINTS: Record<MovementType, string> = {
  opening_balance: 'What was already on the shelf when the item was added to the list.',
  purchase: 'A shop that was not recorded at the time.',
  donation: 'Anything given to the food bank.',
  parcel_issued:
    'A parcel handed over outside a session, or one recorded against the wrong household.',
  wastage: 'Anything thrown away, for any reason — out of date, damaged or spoiled.',
  correction: 'Putting a counting or typing mistake right.',
};

export interface MovementTypeOption {
  readonly value: MovementType;
  readonly label: string;
  readonly hint: string;
}

/** Derived from the labels so the list cannot fall behind them. */
export const MOVEMENT_TYPE_OPTIONS: readonly MovementTypeOption[] = Object.entries(
  MOVEMENT_TYPE_LABELS,
).flatMap(([value, label]) =>
  isMovementType(value) ? [{ value, label, hint: MOVEMENT_TYPE_HINTS[value] }] : [],
);

export function isMovementType(value: unknown): value is MovementType {
  return typeof value === 'string' && Object.hasOwn(MOVEMENT_TYPE_LABELS, value);
}

/**
 * A signed quantity, written the way the ledger means it: the `+` is not
 * decoration, it is the difference between adding six and having six.
 *
 * Zero is formatted without a sign because it is never a valid delta — the
 * server rejects it — and a `+0` on a preview would read as though it were.
 */
export function formatSignedQuantity(delta: number): string {
  return delta > 0 ? `+${String(delta)}` : String(delta);
}

export type QuantityDeltaProblem = 'empty' | 'not-a-whole-number' | 'zero' | 'too-large';

export type QuantityDelta =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: QuantityDeltaProblem };

/**
 * The one place the adjustment quantity rule lives: **a signed whole number,
 * never zero**, which is exactly what the server accepts.
 *
 * It is a function rather than a Zod chain because the adjustment form needs
 * the same answer twice — once to refuse the submission and once to show what
 * the level would become — and two implementations of "is this a valid delta"
 * is how a preview ends up disagreeing with a validation message.
 *
 * Quantities are integers everywhere in this system, so `6.5` is rejected
 * rather than rounded, and a bare `-` is not a number.
 */
export function parseQuantityDelta(text: string): QuantityDelta {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  if (!/^[+-]?\d+$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, problem: 'too-large' };
  if (value === 0) return { ok: false, problem: 'zero' };

  return { ok: true, value };
}

export type QuantityProblem = 'empty' | 'not-a-whole-number' | 'below-minimum' | 'too-large';

export type Quantity =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: QuantityProblem };

/**
 * An unsigned whole quantity, with the floor the endpoint asks for: **1 for a
 * purchase line, 0 for a counted quantity.** Zero is the difference between the
 * two and it is not a detail — "we bought none" is not a line, and "the shelf
 * is empty" is one of the most important counts a stock take can record.
 *
 * Separate from `parseQuantityDelta`, which parses a *signed, never-zero* ledger
 * movement. Folding the two together would mean one of the callers accepting a
 * value the server refuses.
 *
 * A sign is parsed rather than rejected outright so that `-3` can be answered
 * with "that is below the minimum" instead of "that is not a whole number",
 * which is true but unhelpful when somebody has typed exactly what they meant.
 */
export function parseWholeQuantity(text: string, minimum: number): Quantity {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  if (!/^[+-]?\d+$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, problem: 'too-large' };
  if (value < minimum) return { ok: false, problem: 'below-minimum' };

  return { ok: true, value };
}

/** Takes that are still open. The only status a screen can act on. */
export function openStockTakes(takes: readonly StockTake[]): StockTake[] {
  return takes.filter((take) => take.status === 'open');
}

/**
 * What goes on the count sheet: **every active item, plus any retired item that
 * still holds a balance.**
 *
 * The second half is the part worth arguing about. A retired item is not on the
 * shelf list any more, so counting it looks like noise — but a retired row with
 * `quantityOnHand` of 12 is precisely the thing a stock take exists to find, and
 * it is invisible on the levels screen too, which hides retired rows by default.
 * Retired and already at zero is genuinely nothing to count, so it is left off.
 *
 * Server order is preserved: `filter` does not reorder, and the shelf order is
 * the order the aisle is walked in.
 */
export function countableLevels(levels: readonly StockLevel[]): StockLevel[] {
  return levels.filter((level) => level.isActive || level.quantityOnHand !== 0);
}

export interface VarianceRow {
  readonly key: string;
  readonly name: string;
  readonly expected: number | null;
  readonly counted: number | null;
  readonly delta: number | null;
}

/**
 * The commit response, joined to item names and made safe to render.
 *
 * **Every field on an adjustment is optional in the contract** — the `200`
 * schema declares no `required:` — so this is the one place that absence is
 * dealt with, rather than four `!`s in a table body. A missing number renders as
 * an em dash and a missing name falls back to the id, because an id on screen is
 * diagnosable and the string `undefined` is not.
 */
export function describeVariances(
  adjustments: readonly StockTakeAdjustment[],
  levels: readonly StockLevel[],
): VarianceRow[] {
  return adjustments.map((adjustment, index) => {
    const { stockItemId } = adjustment;
    const level =
      stockItemId === undefined ? undefined : levels.find((row) => row.id === stockItemId);

    return {
      key: `${stockItemId ?? 'unknown'}-${String(index)}`,
      name: level?.name ?? stockItemId ?? 'An item that is no longer listed',
      expected: adjustment.expected ?? null,
      counted: adjustment.counted ?? null,
      delta: adjustment.delta ?? null,
    };
  });
}

/**
 * The most lines the server will take in one shop (`maxItems: 200`). Checked
 * here as well so a long shop is refused with a sentence rather than a `400`.
 */
export const MAX_PURCHASE_LINES = 200;

export type PurchaseFailure = 'ambiguous' | 'unknown-item' | 'refused';

/**
 * What a failed shop means, and it decides two different things: what the
 * operator is told, and **whether the Save control unlocks**.
 *
 * `POST /stock/purchases` has no idempotency key, so a second attempt is a
 * second shop on the ledger. The only safe rule is to unlock exclusively when
 * the server has said, in so many words, that it wrote nothing:
 *
 * - **`ambiguous`** — the request never got an answer, or got a `5xx`. It may
 *   well have succeeded. Nothing here can tell, so nothing here may offer a
 *   retry: the operator is sent to the levels screen to look. This is the case
 *   the whole guard exists for.
 * - **`unknown-item`** — a `404`. A line named an item the server does not have,
 *   and the write is all-or-nothing, so **nothing at all was written**. Safe to
 *   fix and send again.
 * - **`refused`** — any other `4xx`. The request was rejected before anything
 *   was written, so it is equally safe to send again.
 */
export function classifyPurchaseFailure(error: unknown): PurchaseFailure {
  if (!(error instanceof ApiError)) return 'ambiguous';
  if (error.status >= 500) return 'ambiguous';
  return error.status === 404 ? 'unknown-item' : 'refused';
}
