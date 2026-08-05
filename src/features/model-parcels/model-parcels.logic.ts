import type { ModelParcel } from './queries';

/**
 * The pure half of model parcels and the household grid: cell keys, the
 * completeness and unknown-name derivations, the duplicate-name check, and the
 * quantity parsing the contents editor shares with both the create and amend
 * screens.
 *
 * No React, no fetching, tested directly.
 */

/** Every valid number of adults a grid cell can hold. Fixed by the domain, not derived from the server. */
export const GRID_ADULTS: readonly number[] = [1, 2, 3, 4, 5];

/** Every valid number of children a grid cell can hold. Zero is a real household size — a lone adult. */
export const GRID_CHILDREN: readonly number[] = [0, 1, 2, 3, 4, 5];

export function gridCellKey(adults: number, children: number): string {
  return `${String(adults)}-${String(children)}`;
}

/**
 * All thirty keys, in the order the table is drawn: by adults, then by
 * children within each row. `GET /parcel-grid` also returns a `cells` array,
 * but this is not derived from it — the 1-5-by-0-5 shape is a fact about the
 * domain (`screenDetails.md`, the server's `CLAUDE.md`), not something the
 * server is free to change the meaning of, and the table needs the adults/
 * children pair back out of each key to draw its headers, which a flat list of
 * strings does not give for free.
 */
export const GRID_CELL_KEYS: readonly string[] = GRID_ADULTS.flatMap((adults) =>
  GRID_CHILDREN.map((children) => gridCellKey(adults, children)),
);

export function describeHouseholdSize(adults: number, children: number): string {
  const adultWord = adults === 1 ? 'adult' : 'adults';
  const childWord = children === 1 ? 'child' : 'children';
  return `${String(adults)} ${adultWord}, ${String(children)} ${childWord}`;
}

/**
 * Maintenance order for the model parcel list: `displayOrder`, then name as
 * the tiebreak. The endpoint makes no ordering promise, so this is this
 * client's own rule — the same reasoning as `sortRecurringSessions`.
 */
export function sortModelParcels(parcels: readonly ModelParcel[]): ModelParcel[] {
  return [...parcels].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
}

/**
 * How the server compares two model parcel names: trimmed, but **not**
 * case-folded. Verified against a running server — `Single parcel` and
 * `single PARCEL` coexist as two different parcels, which is the opposite of
 * `normaliseStockItemName` in the stock feature and is called out here so
 * nobody "fixes" this to match that one.
 */
export function normaliseModelParcelName(name: string): string {
  return name.trim();
}

/**
 * The duplicate-name check. Unlike the stock item list, a duplicate name on
 * `POST /model-parcels` is a clean `409` either way — there is no `PATCH`
 * equivalent to worry about, because a model parcel's name cannot be amended
 * at all. This check exists purely so the create screen can say which parcel
 * already holds the name and link to it, rather than making the admin submit
 * to find out.
 */
export function findModelParcelByName(
  parcels: readonly ModelParcel[],
  name: string,
): ModelParcel | undefined {
  const wanted = normaliseModelParcelName(name);
  if (wanted === '') return undefined;

  return parcels.find((parcel) => normaliseModelParcelName(parcel.name) === wanted);
}

export interface GridCompleteness {
  readonly isComplete: boolean;
  readonly missingCells: readonly string[];
}

/**
 * Computed from whatever grid is currently on screen — the loaded one, or a
 * draft mid-edit — rather than read off the server's own `isComplete`. The two
 * agree right after a fetch, but only this one stays right while the admin is
 * editing, and there is exactly one rule to get right either way: a cell
 * counts as filled when it names something.
 */
export function gridCompleteness(grid: Readonly<Record<string, string>>): GridCompleteness {
  const missingCells = GRID_CELL_KEYS.filter((key) => (grid[key] ?? '').trim() === '');
  return { isComplete: missingCells.length === 0, missingCells };
}

/**
 * Cells naming a parcel that is not in the current list of model parcels.
 *
 * **The grid holds names, not ids**, so a cell can survive the deletion of the
 * parcel it names — the server's own delete route refuses that while the grid
 * still points at the parcel, but nothing stops a name going stale by a route
 * this client cannot see (another admin's delete racing this admin's read; the
 * server's `CLAUDE.md` is explicit that D1 gives it no atomic
 * read-then-write). `GET /parcel-grid` reports this as `unknownParcels`, but
 * that field is typed as an array of propertyless objects — `openapi.yaml`
 * declares no shape for it — so this is computed locally instead, from data
 * this client already has and already trusts: the grid values and the current
 * parcel names.
 */
export function unknownGridCells(
  grid: Readonly<Record<string, string>>,
  knownNames: readonly string[],
): string[] {
  const known = new Set(knownNames);
  return GRID_CELL_KEYS.filter((key) => {
    const value = grid[key];
    return value !== undefined && value !== '' && !known.has(value);
  });
}

/**
 * What gets sent on `PUT /parcel-grid`: every filled cell, and **no** blank
 * ones. The server's shape is sparse — `GET` only lists cells somebody has
 * set — and sending thirty entries including empty strings for the unset ones
 * would say something different: that every cell had been considered and
 * thirty of them were deliberately cleared, rather than that some were never
 * touched. `missingCells` on the next `GET` should read the same before and
 * after a save that only fills in gaps.
 */
export function buildGridPayload(draft: Readonly<Record<string, string>>): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const key of GRID_CELL_KEYS) {
    const value = (draft[key] ?? '').trim();
    if (value !== '') payload[key] = value;
  }
  return payload;
}

/**
 * Whether an input household would clamp into the grid's corner, stated
 * directly from the rule in `screenDetails.md` and the server's `CLAUDE.md` —
 * **not** read off the preview response. Verified against a running server:
 * `POST /parcel-grid/preview` echoes back the `household` exactly as sent,
 * uncl­amped, even though `modelParcelName` is chosen from the clamped lookup.
 * So the response alone cannot tell a caller that clamping happened; the input
 * can, because the rule is fixed and public.
 */
export function describeHouseholdClamping(adults: number, children: number): string | null {
  const clampedAdults = Math.min(adults, 5);
  const clampedChildren = Math.min(children, 5);
  if (clampedAdults === adults && clampedChildren === children) return null;

  return `A household of ${describeHouseholdSize(adults, children)} is treated as ${describeHouseholdSize(clampedAdults, clampedChildren)} — households above 5 of either clamp to 5.`;
}

export type WholeNumberProblem = 'empty' | 'not-a-whole-number' | 'below-minimum' | 'above-maximum';

export type WholeNumberResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: WholeNumberProblem };

/**
 * An unsigned whole number within `[minimum, maximum]`, held and parsed as
 * text — the same reasoning as `parseWholeNumber` in the sessions feature and
 * `parseWholeQuantity` in stock: an `<input type="number">` cannot tell an
 * empty box from a lone minus sign, and the difference is a sentence a person
 * can act on. Not imported from either sibling feature — only a feature's
 * `queries.ts` may be shared, so this is the model-parcels copy.
 */
export function parseWholeNumber(
  text: string,
  bounds: { readonly minimum: number; readonly maximum: number },
): WholeNumberResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  if (!/^\d+$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, problem: 'not-a-whole-number' };
  if (value < bounds.minimum) return { ok: false, problem: 'below-minimum' };
  if (value > bounds.maximum) return { ok: false, problem: 'above-maximum' };

  return { ok: true, value };
}

/** `ParcelContentLine.quantity`: `minimum: 1, maximum: 1000`. */
export const CONTENT_QUANTITY_BOUNDS = { minimum: 1, maximum: 1000 };

/** `parcel-grid/preview`'s declared bounds are `0..30`; a household needs at least one adult to be real. */
export const PREVIEW_ADULTS_BOUNDS = { minimum: 1, maximum: 30 };
export const PREVIEW_CHILDREN_BOUNDS = { minimum: 0, maximum: 30 };

/** `ModelParcel.name`: `maxLength: 80`. */
export const MAX_MODEL_PARCEL_NAME_LENGTH = 80;

/** `ModelParcel.description`: `maxLength: 300`. */
export const MAX_MODEL_PARCEL_DESCRIPTION_LENGTH = 300;

/** A line being built up on the create or amend form. `quantity` is text until it is submitted. */
export interface DraftContentLine {
  readonly stockItemId: string;
  readonly name: string;
  readonly quantity: string;
}

export interface ParsedContentLine {
  readonly stockItemId: string;
  readonly quantity: number;
}

export type ContentLinesResult =
  | { readonly ok: true; readonly lines: ParsedContentLine[] }
  | { readonly ok: false; readonly message: string };

/**
 * Turns the draft list into what `POST`/`PATCH` want, or says in one sentence
 * why not. Both endpoints require **at least one line** — `contents` is
 * `minItems: 1` whenever it is sent at all, on create and on amend alike — so
 * that check lives here rather than being duplicated at each call site.
 */
export function buildContentLines(draft: readonly DraftContentLine[]): ContentLinesResult {
  if (draft.length === 0) {
    return { ok: false, message: 'Add at least one item to this parcel.' };
  }

  const lines: ParsedContentLine[] = [];
  for (const line of draft) {
    const parsed = parseWholeNumber(line.quantity, CONTENT_QUANTITY_BOUNDS);
    if (!parsed.ok) {
      return { ok: false, message: `Check the quantity for ${line.name}.` };
    }
    lines.push({ stockItemId: line.stockItemId, quantity: parsed.value });
  }

  return { ok: true, lines };
}
