# Stock handling — server implementation handoff

This is the ordered server work for the crates/groupings/packing-units build. It
is deliberately limited to `stock-handling-changes.md` sections 1–3. Do not
implement the fresh-food policy or updating stock from shopping: server Q43 is
still open and those are not part of this branch build.

The corresponding client plan is
[`stock-handling-implementation-plan.md`](./stock-handling-implementation-plan.md).
This handoff records the concrete decisions made for the reversible branch
build; it is not a replacement for the charity's settled domain specification.

## 1. Migrate and seed safely

1. Create `stock_take_groupings` (`id`, `name`).
2. Seed one `Non-perishable` grouping.
3. Add nullable `grouping_id`, nullable `units_per_pack`, and nullable
   `pack_unit_label` to `stock_items`. Backfill **every existing stock item**
   with the seeded grouping. The create path defaults a new item to that
   grouping when no grouping is supplied.
4. Create `crates` (`id`, `name`, unique `shelf_key`, `grouping_id`,
   `size_per_crate`) and `crate_members` (`crate_id`, `stock_item_id`,
   `stock_composition_percent`, `shopping_composition_percent`). Members are
   explicit: changing an item's shelf must never silently alter this table.
5. Extend target-stock-list persistence for a crate line beside an item line.
   This needs the target-line lifecycle decision in section 4 before migration
   and OpenAPI are finalised.

## 2. Domain behaviour

- A crate has at least two explicit members, one unique shelf key, a positive
  integer size, and belongs to one stock-take grouping.
- Each of its two percentage tables consists of non-negative values and totals
  **exactly 100** independently. Reject a create/update that violates this;
  do not retain the prototype's all-zero fallback.
- A crate count is decomposed server-side as
  `round(enteredCount * sizePerCrate * memberPercent / 100)` for each member,
  using stock composition. Quantities saved to stock remain integers. Shopping
  shortfall splitting is calculated in the client, from the returned crate
  definition, stock levels and shopping composition.
- Validation is non-blocking for stock-item create/patch. It reports: a
  multi-item shelf without a crate; a crate with fewer than two members; a
  member whose shelf no longer equals its crate shelf key; and each item that
  is uncounted, directly grouped plus crate-member, or belongs to more than
  one crate.
- Targeting an explicit crate member individually is not allowed for a newly
  saved target list. The handling of an already-stored line is in section 4.
- A stock-take request must reject an item count and a crate count which would
  both set the same stock item. This protects the API even though the client
  excludes the collision.

## 3. OpenAPI/API contract to publish before client wiring

- `GET /api/v1/stock/groupings` and `GET /api/v1/stock/crates` are readable by
  `admin` and `team_lead`: both roles use grouped stock take. Their writes are
  admin-only.
- Extend stock-item create/patch/response with grouping and packing-unit
  fields. A crate member has `groupingId: null`; items are otherwise directly
  grouped. `unitsPerPack` is a positive integer. When it is absent, normalise
  `packUnitLabel` to `null`; when it is present, a blank label reads as
  `packs` in the client.
- Extend `POST /api/v1/stock/take` with `crateCounts`. A request must contain
  at least one changed direct or crate count, return the final levels of every
  item actually changed, and document the collision `400`.
- Add an admin-only `GET /api/v1/stock/validation`, returning stable issue
  kinds and user-readable messages. After a successful client stock-item
  create/patch, the client calls this endpoint and shows its results; it does
  not use it to reject the original write.
- Update `API.md` role table and request sequencing, then `openapi.yaml`.
  The client runs `npm run api:types` only after those changes land.

## 4. Settled target-list and shopping contract

- A crate target is a positive number with at most **one decimal place**. Model
  it in OpenAPI as `type: number`, `minimum: 0.1`, `multipleOf: 0.1` (and the
  same upper bound as an ordinary target unless the server has a stricter safe
  limit).
- Crate target lines store a crate id and crate-name snapshot, matching item
  lines. A deleted crate, or an old individual target whose item later becomes
  a crate member, remains stored and is returned so the client can show it as
  an administrator-attention line until removed or replaced.
- No shopping-calculation endpoint is added. The existing browser calculation
  remains responsible for ordinary and crate-derived shopping lines, and
  merges them before the user applies any per-run edit.

## 5. Required tests

- Migration/backfill: every existing item belongs to `Non-perishable`.
- Percentage totals, non-negative values, and all validation issue kinds.
- Stock take with direct and crate counts; zero, decimal crate input, and the
  collision rejection.
- A second crate on the same shelf is refused.
- Role coverage: both roles read groupings/crates; only administrators write.
- Target-list crate handling after the section 4 decisions are implemented.

Only after these tests and contract updates are in place should the client
regenerate `src/api/schema.d.ts` and replace the prototype routes.
