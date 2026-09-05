/**
 * Plain local types — deliberately not derived from `src/api/schema.d.ts`. See `README.md`: the
 * server has none of these concepts yet, so there is no generated shape to reuse.
 */

export interface ProtoStockItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly shelfNumber: string;
  readonly quantityOnHand: number;
  /** Units per pack for count-entry convenience. `null` when the item has no packing unit. */
  readonly unitsPerPack: number | null;
  /** What a "pack" is actually called for this item — plural, e.g. "boxes", "trays", "cases".
   * `null` (or blank) falls back to the generic "packs" wherever it is shown. Meaningless while
   * `unitsPerPack` is `null`. */
  readonly packUnitLabel: string | null;
  /** Direct membership of a stock-take grouping. `null` when the item is not directly grouped —
   * either because it is covered by a crate instead, or because it is not yet assigned at all. */
  readonly groupingId: string | null;
}

export interface Grouping {
  readonly id: string;
  readonly name: string;
}

export interface CrateMember {
  readonly stockItemId: string;
  /** Percentage used to decompose a freshly-counted crate figure into this item's stock quantity.
   * Percentages across a crate's members need not sum to exactly 100 — decomposition divides by
   * their sum, not by an assumed 100, so a table mid-edit still produces a sane split. */
  readonly stockCompositionPercent: number;
  /** Percentage used to decompose a shopping shortfall into named items to buy. Maintained
   * independently of `stockCompositionPercent` — the two can differ by an admin's judgement. */
  readonly shoppingCompositionPercent: number;
}

export interface Crate {
  readonly id: string;
  /** An admin-set descriptive name — "Spread", not "Shelf F9" — shown wherever a crate appears to
   * a person. The shelf key is a technical identifier, not something a counter or shopper should
   * have to read as the crate's name. */
  readonly name: string;
  /** The shelf number this crate is keyed to. At most one crate per shelf. */
  readonly shelfKey: string;
  /** A crate has no stock-take grouping of its own choosing to make — it belongs to whichever
   * grouping its member items would otherwise belong to. */
  readonly groupingId: string;
  /** Units per crate, used to compute the reference count shown at a stock take. */
  readonly sizePerCrate: number;
  readonly members: readonly CrateMember[];
}

export interface ItemTargetLine {
  readonly stockItemId: string;
  readonly target: number;
}

export interface CrateTargetLine {
  readonly crateId: string;
  readonly target: number;
}

export interface StockPrototypeState {
  readonly groupings: readonly Grouping[];
  readonly items: readonly ProtoStockItem[];
  readonly crates: readonly Crate[];
  readonly itemTargets: readonly ItemTargetLine[];
  readonly crateTargets: readonly CrateTargetLine[];
}

export type CountingStatus = 'direct' | 'crate' | 'uncounted' | 'double-counted';

export type ValidationIssueKind =
  | 'shelf-without-crate'
  | 'crate-too-few-members'
  | 'member-shelf-mismatch'
  | 'item-uncounted'
  | 'item-double-counted';

export interface ValidationIssue {
  readonly kind: ValidationIssueKind;
  /** One sentence, plain enough to act on without reading a spec. */
  readonly message: string;
}
