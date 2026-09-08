# Stock handling: implementation plan (groupings, crates, packing units)

**Status: implemented on the reversible client branch; awaiting final full-suite and live-API verification; not yet a settled charity requirement.** This is the build plan for turning
[`stock-handling-changes.md`](./stock-handling-changes.md) §1–§3 into real, shipped functionality —
stock-take groupings, crates, and packing units. It assumes the reader has **not** seen the
conversation that produced it: every decision it relies on is either restated here or cited by
section number in that document.

**Out of scope, deliberately:** §4 (the fresh shopping policy) and §5 (updating stock from
shopping) are excluded. Both are blocked on the server's own
[Q43](../../foodbankserver/OPEN-QUESTIONS.md), which is unrelated to this build and unresolved. Do
not implement them as a side effect of this work.

A disposable, client-only prototype of this functionality already exists at
[`src/features/stock-prototype/`](../../src/features/stock-prototype/) in this repo, reachable at
`/stock-prototype` when signed in. It has no connection to the API and is not production code, but
it is a working, browser-verified reference for the interaction design and the trickier arithmetic
(crate decomposition, shortfall splitting). §5.6 below says exactly what to carry over from it and
when to delete it.

---

## 1. Before starting

- [x] **Pete has authorised this build on its separate branch, despite the outstanding charity
      conversation.** A database backup exists and the branch can be reverted. This is authority to
      build and test the proposed direction, not authority to describe it as a settled charity
      requirement in `screenDetails.md` or `INITIAL_SPEC1.txt` before Pete says it is settled.
- [x] The server-side implementation is a separate workstream. The client work supplies its
      owner with the ordered instructions in §4, and does not read or edit server code from this
      repository.
- [ ] Once this work is settled and underway, the two source documents this plan is built from
      (`stock-handling-changes.md` and this file) stop being the reference — `screenDetails.md`
      (client) and `../foodbankserver/INITIAL_SPEC1.txt` (domain) are. Update those as each piece
      lands (see §6, "Definition of done").

---

## 2. Decisions this plan makes that `stock-handling-changes.md` leaves open

The planning doc settles _what the charity wants_. It deliberately doesn't settle _how the server
computes it_ — that's an implementation choice, not a domain one, so it's made here rather than
left for whoever picks up each ticket to decide independently and inconsistently.

**Decision: stock-take crate decomposition and validation are computed server-side; shopping-list
calculation remains client-side.**

The prototype computes both in the browser, against data it already has fetched — that was the
right call for a disposable demo, but wrong for the real thing:

- **Validation must be authoritative.** `stock-handling-changes.md` §2 says a bulk-load facility
  bypasses the edit-triggered check, and that the standalone validation action is what catches a
  bulk-loaded batch. A client-side check computed over whatever the client happens to have fetched
  cannot make that promise — a check that only runs against loaded rows isn't a real check on the
  underlying data. The server must expose an endpoint that runs the checks against the actual stock
  table, and the client calls it, rather than reimplementing the checks over a fetched list.
- **Stock-take decomposition needs one source of truth.** The composition percentages live on the
  crate; if both the client and the server can turn a submitted crate count into per-item stock
  quantities, they can disagree. The server already owns the "only save what changed" comparison
  for an ordinary stock-take line (`POST /api/v1/stock/take`), so it also decomposes crate counts.
- **Shopping-list calculation remains in the browser.** The existing target-stock shopping list is
  computed from raw target lines and stock levels in the client. Keep that model: it avoids a
  server-side calculation across the full catalogue and lets the client merge crate-derived lines
  with ordinary lines before the shopper makes their per-run edits. The client computes a crate
  shortfall from the crate definition, its member levels and shopping composition; as with ordinary
  item targets, a negative member level is treated as zero. The result is never persisted.

**Confirmed by Pete for this branch build:** stock-take crate decomposition and validation are
server-side; shopping calculation is client-side.

---

## 3. Domain model

New concepts, all currently absent from `../foodbankserver/INITIAL_SPEC1.txt`:

```
StockTakeGrouping
  id            uuid
  name          string                 — admin-set, e.g. "Non-perishables"

Crate
  id            uuid
  name          string                 — admin-set, e.g. "Spread". Never derived from the shelf key.
  shelfKey      string                 — the shelf number this crate is keyed to. Unique — at most
                                          one crate per shelf.
  groupingId    uuid (FK → StockTakeGrouping)
  sizePerCrate  integer ≥ 1            — units per crate
  members       CrateMember[]          — explicitly maintained; must have ≥ 2

CrateMember (embedded in Crate, or a join table — implementer's choice)
  stockItemId               uuid (FK → StockItem)
  stockCompositionPercent   number     — non-negative integer; totals exactly 100 across the crate
  shoppingCompositionPercent number    — independently maintained; non-negative integer and also
                                          totals exactly 100 across the crate

StockItem (existing entity, gains three fields)
  groupingId      uuid | null (FK → StockTakeGrouping)  — direct grouping membership
  unitsPerPack    integer ≥ 1 | null                    — packing-unit figure, §3
  packUnitLabel   string | null                          — plural counting-unit name, e.g. "cases";
                                                             blank/null falls back to "packs" in the UI
```

**Explicit membership, not automatic shelf membership:** `CrateMember` is the maintained list of
items and their two composition percentages. A crate's shelf key is a consistency check and the
way the warehouse identifies the commingled shelf; it does not silently add or remove members when
an item's shelf number changes. This is why validation is needed.

**Invariant to enforce (validation, not a hard constraint at write time — see §4.2):** every
`StockItem` is counted by exactly one mechanism — direct `groupingId`, or membership of exactly one
`Crate`. Neither, membership of more than one crate, or both is invalid. This **cannot** be enforced
synchronously on every edit: changing an item's shelf number or creating an item can temporarily
make the configuration invalid, and the write must still succeed. The validation action runs after
the successful write and reports what the administrator must fix.

**Packing units are not crates:** `StockItem.groupingId` remains the item's direct stock-take
assignment when `unitsPerPack` is set. For example, beans may belong directly to Non-perishable,
store 24 units per box, and be counted either as whole beans or as boxes to one decimal place. A
crate remains exclusively for a commingled shelf with more than one member item. The item ledger is
integer-only, so a decimal pack entry that does not multiply to a whole item is rounded to the
nearest item; the stock-take screen displays that saved quantity before submission.

**Combined stock-take order:** `GET /stock/levels` and `GET /stock/crates` each return the
server-computed opaque `shelfSortKey`. The client merges direct-item and crate rows by comparing
that key as a plain string; it must not parse or derive an order from the visible shelf names.

**Initial data:** migration creates a `Non-perishable` stock-take grouping and assigns every
existing stock item directly to it. No existing item is left without a counting method. A later
crate configuration removes direct grouping from each declared member; a new stock item defaults to
the `Non-perishable` grouping unless an administrator explicitly assigns another grouping.

**Target-stock lists** (existing entity) gain a crate-target line type alongside their existing
item-target lines — a target set against a `Crate` as a whole, "in crates" (the same unit as the
crate's computed reference figure), not in raw units. Crate targets are positive numbers with at
most one decimal place. Like item lines, they store the crate id and name snapshot: a missing crate,
or an old item target for an item now declared a crate member, is an administrator-attention line
until removed or replaced.

---

## 4. Part A — Server (`../foodbankserver`)

This is a specification for that repository's own implementation effort — nothing here is written
by an agent working in _this_ repo, per this repo's own rule against touching server code.

### 4.1 Migrations

- [ ] `stock_take_groupings` table (id, name).
- [ ] `crates` table (id, name, shelf_key unique, grouping_id FK, size_per_crate).
- [ ] `crate_members` table (crate_id FK, stock_item_id FK, stock_composition_percent,
      shopping_composition_percent) — composite key on (crate_id, stock_item_id).
- [ ] `stock_items` gains `grouping_id` (nullable FK), `units_per_pack` (nullable int),
      `pack_unit_label` (nullable text).
- [ ] Data migration creates `Non-perishable` and assigns every existing stock item to it. The
      stock-item create path uses that grouping as its default when no grouping is supplied.
- [ ] `target_stock_list_lines` (or equivalent) gains a way to represent a crate-target line
      alongside its existing item-target lines — either a nullable `crate_id` column alongside the
      existing `stock_item_id` one (exactly one of the two set per line), or a parallel table. Match
      whatever pattern that table already uses for "this row is one of two kinds."

### 4.2 Domain rules to implement

- [ ] **Crate decomposition** (stock-take): given a crate and an entered fractional count, compute
      each member's new quantity as `round(enteredCount * sizePerCrate * memberPercent /
sumOfMembersPercent)`, using `stockCompositionPercent`. This is exactly
      [`decomposeCrateCount`](../../src/features/stock-prototype/stock-prototype.logic.ts) in the
      prototype — port the arithmetic, retype it against real domain types, and replace its
      permissive percentage/size edge cases with the production validation below.
- [ ] **Validation checks**, run against the real stock table (not a fetched snapshot). All four are
      ported from [`validateStock`](../../src/features/stock-prototype/stock-prototype.logic.ts) in
      the prototype, which has the exact check shapes and message wording to start from:
  1. Every shelf carrying more than one stock item has a crate definition keyed to it.
  2. Every crate has more than one member.
  3. Every crate member's own current shelf number still matches the crate's shelf key (catches
     drift after an item is moved without the crate being updated).
  4. Every stock item is counted by exactly one mechanism — direct grouping or membership of one
     crate, never neither, more than one crate, or both (§3 invariant above).
- [ ] Each composition table consists of non-negative percentages which total **exactly 100**
      independently for stock composition and shopping composition. Reject a crate create/update
      that does not meet that rule; do not use the prototype's all-zero fallback in production.
- [ ] **At most one crate per shelf** — reject a create/update that would key a second crate to a
      shelf another crate already holds.
- [ ] **A crate member cannot carry its own individual target.** If `StockItem.groupingId` targeting
      already exists as a concept, block (or simply never expose) a target-stock-list line for an
      item that's a declared crate member.
- [ ] **Mixed stock-take collision:** reject a take containing a direct item count and a crate count
      that would both set that item's level. The client prevents the normal UI path; the server is
      authoritative against a crafted request.

### 4.3 New/changed endpoints

Sketched against this repo's existing `/api/v1/stock/*` conventions (see `../foodbankserver/API.md`
for the real ones — these are a starting proposal, not a spec to copy verbatim):

- [ ] `GET /api/v1/stock/groupings`, `POST /api/v1/stock/groupings`,
      `PATCH /api/v1/stock/groupings/{id}` — both roles read groupings because team leads take
      stock by grouping; writes are admin-only.
- [ ] `GET /api/v1/stock/crates`, `POST /api/v1/stock/crates`,
      `PATCH /api/v1/stock/crates/{id}`, `DELETE /api/v1/stock/crates/{id}` — both roles read
      crates because team leads need their stock-take lines; writes are admin-only.
- [ ] `PATCH /api/v1/stock/items/{id}` extended to accept `groupingId`, `unitsPerPack`,
      `packUnitLabel`. `POST /api/v1/stock/items` (create) extended the same way.
- [ ] `POST /api/v1/stock/take` extended to accept crate lines alongside its existing item
      `counts` array — e.g. a `crateCounts: { crateId, enteredCount }[]` field. The server
      decomposes each (§4.2) and applies the results the same way it already applies `counts`: only
      a value that differs from the current figure is written, and the response's `levels` reflects
      every stock item actually changed, item-counted or crate-decomposed alike, so the client never
      needs to compute anything itself to show an updated screen.
- [ ] `GET /api/v1/stock/validation` (or similar) — runs the four checks in §4.2 against the live
      table and returns the same shape of issue list the prototype's `ValidationIssue[]` returns
      (`kind`, `message`). Both roles or admin-only — match whichever the existing preference-rule
      health check uses, since `stock-handling-changes.md` §2 explicitly proposes folding this
      screen in alongside that one. After every successful stock-item create or patch, the client
      calls this endpoint and shows any resulting issues immediately; it never prevents the write.
- [ ] Target-stock-list endpoints extended to accept a discriminated crate-target line alongside
      item-target lines. It contains a crate id, a crate-name snapshot and a positive target in
      crates with at most one decimal place. Stored item and crate lines remain snapshots: a missing
      crate, or an item line whose item is now a crate member, is retained for the client to show as
      an administrator-attention line rather than silently dropped.
- [ ] Confirm how the existing bulk-load stock-item facility (mentioned in
      `stock-handling-changes.md` §2, "There **is** a bulk-load facility... separate from anything
      visible in this client's code") interacts with `groupingId` / crate membership on import —
      this plan doesn't have visibility into that facility's current shape, so check with whoever
      owns it before assuming it needs no changes.

### 4.4 Spec and contract updates

- [ ] `../foodbankserver/INITIAL_SPEC1.txt` — write up the domain model from §3 above, once this
      plan's server work actually starts (not before — the planning doc's own rule: nothing gets
      written into the settled spec until the direction is agreed and building begins).
- [ ] `../foodbankserver/openapi.yaml` and `API.md` — the new/changed endpoints from §4.3, including
      role-visibility notes (this client's `api-contract.md` rule leans on `API.md` for exactly this
      kind of detail that the OpenAPI schema alone can't express).
- [ ] Resolve server Q43 mention only if it turns out to be genuinely entangled with this work after
      all — the planning doc's read is that it isn't (§4/§5 are cleanly separable), but confirm
      that's still true once the real schema is in front of you.

### 4.5 Tests (server)

- [ ] Unit tests for stock-take crate decomposition — including fractional counts and the exact-100
      composition constraint. The client owns unit coverage for crate shopping shortfall splitting.
- [ ] Unit tests for all four validation checks, including the deliberately-adversarial cases the
      prototype's seed data used to prove them: a crate member whose shelf has drifted, an item
      that's simultaneously grouped and a crate member, an item covered by neither.
- [ ] Integration test: `POST /api/v1/stock/take` with a mix of item counts and crate counts in one
      request applies both correctly and reports every changed stock item in the response.
- [ ] Integration test: creating a second crate on an already-keyed shelf is rejected.

---

## 5. Part B — Client (this repo)

### 5.1 Regenerate types

- [x] The server's OpenAPI spec supplies the new endpoints; `npm run api:types` has regenerated
      `src/api/schema.d.ts`. Everything below assumes this has happened — no hand-written request or
      response interfaces (`api-contract.md`).

### 5.2 Where the new code lives

Groupings, crates and packing units are tightly coupled to the existing stock feature — a grouping
or crate change affects what the stock-take page shows, and stock levels are already one shared
`stockKeys` root because an item edit reorders the levels list (`src/features/stock/keys.ts`). Keep
that coupling:

- [x] `src/features/stock/` has the grouping/crate query hooks in its existing `queries.ts`
      (or a same-folder `groupings-queries.ts` / `crates-queries.ts` if `queries.ts` gets unwieldy —
      implementer's call), all invalidating `stockKeys.all` on any write, same as every other stock
      mutation does today.
- [x] `src/features/stock/stock.logic.ts` has the crate reference/packing-unit helpers; the
      target-list shopping logic gains crate-shortfall decomposition. Both are pure functions with
      no API import, retyped from the prototype against structural inputs.
- [x] The target-list/shopping side (crate-target lines, decomposed shopping lines) extends
      `src/features/target-stock-lists/`, importing `src/features/stock/keys.ts` for cross-feature
      invalidation where needed — a feature may import another feature's `keys.ts`, never its
      components (`data-fetching.md`).

### 5.3 Screens

Each maps to a prototype screen that's a working reference for the interaction, not something to
copy code from directly (its state management is a local in-memory store standing in for what a real
`useQuery`/`useMutation` pair does — see §5.6 for what's actually reusable).

- [x] **Groupings maintenance** (admin) — new screen, `/stock/groupings`. List, create, rename.
      Reference: `groupings-screen.tsx`'s "Groupings" section in the prototype.
- [x] **Crates maintenance** (admin) — new screen, `/stock/crates`. List with computed reference
      count per crate; create/edit form (name, shelf, grouping, size, per-member composition
      percentages with running totals); delete. Reference: `crates-screen.tsx` in the prototype —
      this is the most complex form in the set, and the prototype's accessibility fixes (focus
      moved to the form on Edit, focus moved to the error on a failed save rather than left silent,
      a shelf already keyed to a different crate excluded from the "add" picker) are worth building
      in from the start rather than as a follow-up pass.
- [x] **Stock item maintenance** — `create-stock-item-screen.tsx` / `amend-stock-item-screen.tsx`
      gain a grouping selector, a units-per-pack field, and a counting-unit-name field. These are
      the real app's RHF+Zod forms (not the prototype's plain-`useState` versions, which only exist
      because the prototype skips forms it didn't need to touch) — add the new fields as ordinary
      schema fields on the existing form.
- [x] **Stock take** — `stock-take-screen.tsx` gains: a grouping picker (the real per-grouping stock
      take, replacing today's single fixed weekly event across every item); crate lines interleaved
      with item lines, each taking a fractional count with a live decomposition preview; a
      per-item choice between whole individual-unit entry and a one-decimal packing-unit entry on
      any directly grouped item that has one. Reference:
      `prototype-stock-take-screen.tsx`, including its fix for the decomposition preview (own
      two-column grid per member, debounced rather than updating on every keystroke, so it doesn't
      spam a screen reader or visibly jump the page).
- [x] **Validation** — new screen, folded in alongside `preference-rule-health-screen.tsx`
      (`stock-handling-changes.md` §2's own suggestion) rather than a separate scattered entry
      point. Two sections (crate-integrity issues, counting-coverage issues), computed from
      `GET /api/v1/stock/validation`, not client-side. Reference: `validation-screen.tsx`.
- [x] **Target-stock-list editor** — `target-stock-list-editor.tsx` gains a crate-target line
      alongside its existing item-target rows, and excludes any item that's a crate member from its
      own item rows (a crate member is never individually targeted — `stock-handling-changes.md`
      §2). Reference: the "Item targets" / "Crate targets" split in
      `prototype-shopping-screen.tsx`.
- [x] **Shopping screen** — `shopping-screen.tsx` merges a crate's decomposed shortfall lines into
      its normal per-category output (no separate "from crates" heading), **and every line becomes
      directly editable before it's printed or copied** — a shopper who knows the real state on the
      shelf can hand-adjust a quantity for that run only, with nothing saved back to any target or
      composition percentage. Reference: `prototype-shopping-screen.tsx`'s editable-line
      implementation (a per-line override, a visible "Reset" once a line is overridden, the override
      folded into both the on-screen list and the copy-to-clipboard text).

### 5.4 Routes and menu

Unlike the prototype (deliberately outside the real menu, reachable only by URL), this is real
functionality and belongs in both:

- [x] `src/routes.tsx` — registers the new routes as ordinary siblings under the existing
      authenticated layout, following the file's own commenting convention for explaining a
      role split (see the existing comment above the `stock/*` routes).
- [x] `src/auth/menu.ts` — adds Groupings and Crates to `MENU`, admin-only (`ADMIN_ONLY`), alongside
      the existing "Stock items" and "Target lists" entries. **Routes are never role-guarded** —
      this only changes what a team lead is _shown_, not what they can reach (`menu.ts`'s own
      docblock, `CLAUDE.md`).

### 5.5 Reuse from the prototype, and when to delete it

- [ ] **Port, don't copy wholesale:** `stock-prototype.logic.ts`'s pure functions
      (`decomposeCrateCount`, `decomposeCrateShortfall`, `computeCrateReferenceCount`,
      `validateStock`, `isCrateMember`, `countingStatus`, `packUnitLabelFor`) are correct,
      browser-verified, and unit-tested — re-derive them against real generated types rather than
      the prototype's local `types.ts`, but there's no reason to redesign the algorithms.
  - Where validation moves server-side (§2's decision), the client no longer needs
    `validateStock` itself, only something to render whatever `GET /api/v1/stock/validation`
    returns — but the check _definitions_ and message wording are still the right reference.
- [x] **Delete `src/features/stock-prototype/` once its replacement screens exist and work** —
      per its own `README.md`, it's disposable and was never meant to survive into the real
      implementation. Don't leave it running alongside the real screens; two ways to reach
      overlapping functionality (`/stock-prototype/*` and `/stock/*`) is confusing, which is exactly
      what this plan exists to avoid.
- [ ] `.claude/launch.json` (added during the prototype's browser verification) is a generic local
      dev-server convenience, not prototype-specific — keep it.

### 5.6 Tests

Per `.claude/rules/testing.md` — every behaviour change ships with a test, MSW against the
generated types:

- [ ] Unit tests for the ported logic functions (§5.5) — the prototype's own
      `stock-prototype.logic.test.ts` is close to a direct template for these; retype the fixtures
      against real schema types.
- [ ] Screen tests for each new/changed screen in §5.3, by role and label (not test id), including
      the invalidation tests this repo's own harness footgun requires: a real `staleTime`, not the
      test harness's default of `0` (`data-fetching.md`, `testing.md` — the same pattern as
      `stock-invalidation.test.tsx`).
- [ ] A regression test for the double-counted collision case: an item that's both directly grouped
      and a crate member must refuse to save on the stock-take screen rather than let one figure
      silently overwrite the other (a real bug caught during the prototype's own review pass —
      worth a named test so it can't come back).
- [ ] A regression test that editing an existing crate never silently drops a member whose shelf has
      drifted from the crate's key (the same review pass's other real bug).

### 5.7 Accessibility

The prototype went through an `accessibility-reviewer` pass; these are real, confirmed findings
worth building in from the start rather than fixing after the fact:

- [ ] Every numeric/text entry field has a real associated `<label>`, not a placeholder standing in
      for one.
- [ ] A failed save announces something (`role="status"` or `role="alert"`) — never leaves a
      screen-reader user in silence after a submit that didn't work.
- [ ] A control that unmounts on click (e.g. "Cancel edit") moves focus somewhere stable first,
      rather than dropping focus into `<body>`.
- [ ] A live-updating preview (the crate decomposition preview on the stock-take screen) is
      debounced and permanently mounted with its text swapped, not mounted/unmounted per keystroke.
- [ ] Use `accessibility-reviewer` proactively per this repo's own subagent table once each screen
      is built, rather than relying on this list being exhaustive.

---

## 6. Sequencing

1. Server: migrations → domain logic (§4.2) → endpoints (§4.3) → OpenAPI/API.md (§4.4) → server
   tests (§4.5).
2. Client: `npm run api:types` (§5.1).
3. Client: groupings screen, crates screen, stock item maintenance fields (§5.3, first three items)
   — these are the foundational maintenance screens everything else depends on having real data to
   work against.
4. Client: stock-take screen changes.
5. Client: validation screen.
6. Client: target-list editor and shopping screen changes.
7. Client: routes, menu (§5.4).
8. Client: delete the prototype (§5.5), once every screen it stood in for has a real replacement.
9. Docs: `screenDetails.md` gets each settled screen requirement written into it as its screen
   ships (in the spec's voice, per `CLAUDE.md` — not copied from this plan's own voice); the
   server's `INITIAL_SPEC1.txt` gets the domain model (§4.4).

Client work on a given screen can start against MSW-mocked responses shaped like §4.3's sketched
contract before the real server endpoints exist, the same way this repo's tests already mock the
API — but treat that as a way to unblock UI work in parallel, not as a reason to skip regenerating
real types and wiring real `queries.ts` calls once the server ships.

---

## 7. Definition of done

- [ ] `npm run check` passes in this repo (typecheck, lint, format, api-types check, dry-run build,
      full test suite) — non-negotiable per `CLAUDE.md`, and don't weaken a rule to make it pass.
- [ ] The equivalent check passes in `../foodbankserver`.
- [ ] Every screen in §5.3 exists, is reachable from the real menu for the right role, and has been
      exercised in a browser against the real running API (`npm run dev` + `../foodbankserver`'s own
      dev server) — not just typechecked.
- [ ] `src/features/stock-prototype/` no longer exists.
- [ ] `screenDetails.md` and `../foodbankserver/INITIAL_SPEC1.txt` reflect the shipped behaviour.
- [ ] Nothing from §4/§5 of `stock-handling-changes.md` (the fresh shopping policy, updating stock
      from shopping) was built as a side effect.

## 8. References

- [`stock-handling-changes.md`](./stock-handling-changes.md) — the settled decisions this plan
  builds from. Read it first for the _why_ behind anything in this plan that seems under-explained.
- The deleted `src/features/stock-prototype/` was the working reference implementation. Its pure
  logic was re-derived against the generated contract; it is deliberately no longer a second route.
- [`../foodbankserver/OPEN-QUESTIONS.md`](../../foodbankserver/OPEN-QUESTIONS.md) Q43 — why §4/§5
  are out of scope here.
- `.claude/rules/api-contract.md`, `.claude/rules/data-fetching.md`, `.claude/rules/testing.md` —
  the standing rules this plan's client work must follow; not repeated in full here.
