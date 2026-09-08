# Stock handling changes

**Status: exploratory. Nothing on this page is a settled requirement.** It is a working record of a
planning conversation, done on the `stock-handling-changes` branch specifically to get to grips with
everything a proposed set of stock changes would involve, before taking it to the charity. Pete is
not sold on the idea yet, and several pieces below reverse or replace earlier ones as the shape of
the problem became clearer during the conversation — that is expected and is why this lives here
rather than in `screenDetails.md`. Nothing here should be read into `screenDetails.md` or the
server's spec until the charity conversation has happened and Pete settles it; where a genuine
open question fell out of the discussion, it is listed in full at the end rather than added to
`OPEN-QUESTIONS.md` piecemeal, since most of it is contingent on whether this goes ahead at all.

The trigger: the charity currently does one weekly stock take. They want non-perishables and
perishables ("fresh food") counted separately, on separate days, and the perishables process
already works differently in practice — it is driven by what is coming up on the session calendar
rather than a shelf count. Pulling on that thread surfaced several more pieces.

## 1. Stock-take groupings

A stock take is no longer a single fixed weekly event covering every item. Stock items are split
into admin-maintained **groupings** — in practice probably just "non-perishables" and "fresh goods"
to start with, but the grouping mechanism itself is flexible rather than hardcoded to two, since the
membership needs maintaining regardless and there is no real saving in limiting it.

**Fresh/perishable goods still get their own periodic stock-take grouping.** The fresh shopping
policy (§4) is a _separate, additional_ forward-planning tool, not a replacement for counting what
is actually on the shelf. Every stock item must end up counted by exactly one mechanism: direct
membership of a grouping, or coverage by a crate (below). An item counted by neither, or by both,
is an invalid state.

## 2. Crates

**The problem this solves is narrower than it first looked**: it is specifically for stock items that
are physically indistinguishable or commingled on a shared shelf (marmite and jam tubs stored
together as "spread"; different tea-bag box sizes stored together) — not simply "a lot of one item
stacked up" (see Packing units, below, for that).

A crate is its own maintained entity, not a stock item:

- **Carries an admin-set descriptive name** — "Spread", not "Shelf F9" — shown wherever a crate
  appears to a person: the stock-take page, the target-stock list, the shopping list. The shelf key
  is what the mechanism keys membership to, not something a counter or shopper should have to read
  as the crate's name.
- **Keyed to a shelf number.** At most one crate per shelf. Membership is explicitly maintained with
  the two percentage tables; it is not silently changed when a stock item's shelf number changes.
  The shelf key is therefore checked by validation, rather than being an automatic membership rule.
  Two items that are physically near each other but not actually commingled are kept out of this by
  giving them distinguishing-but-adjacent shelf codes (`F9a`, `F9b`) rather than an identical shelf
  number — the shelf identifier is alphanumeric, so this is easy to keep unique while still sorting
  the two together.
- **Must have more than one member item.** A "crate" with only one item is a misuse of the mechanism
  — that case is Packing units instead.
- Carries a **crate size** (units per crate) and two independently-maintained percentage tables, one
  per explicitly maintained member item. Each table totals exactly 100%:
  - **Stock-composition** — used to decompose a freshly-counted crate figure into each member item's
    stock quantity at a stock take.
  - **Shopping-composition** — used to decompose an aggregate shopping shortfall into named items to
    actually buy. This can differ from the stock-composition figures (e.g. because the actual mix
    sitting on the shelf has drifted from what is worth proactively buying), and an admin adjusts
    either table directly, by judgement — there is no automated feed driving the difference.
- **Has no stock level of its own.** The crate's aggregate figure is always _computed_, never stored:
  `sum(member items' current stock) / crate size`. This is used both as the reference figure shown on
  a stock-take page and wherever an aggregate quantity is needed for a shopping calculation.
- **At a stock take**, the counter enters a **fractional** crate count (e.g. `3.5`) against the
  computed reference. If it differs, the new figure is decomposed via the stock-composition
  percentages into new saved per-item quantities, exactly like today's "only save what changed" rule
  for an ordinary item. This assumes depletion across the crate's items is roughly even — genuinely
  asymmetric depletion (someone using up marmite from an otherwise-intact crate without touching the
  jam) is not separately handled; nobody flagged it as a real scenario worth the extra mechanism.
- **Is itself assigned to a stock-take grouping**, since its member items are not independently
  assignable — the crate's "number of crates" line appears on whichever grouping's stock-take page it
  belongs to.
- **On the stock-take page**, a crate's line and ordinary individually-counted lines can sit side by
  side; nothing requires a grouping to be crates-only or items-only.
- **A target-stock list needs to support an aggregate/crate line** alongside ordinary item lines — a
  target is set against the crate as a whole (e.g. "Spread: 250"), and the resulting shortfall is
  decomposed via the shopping-composition percentages into named items for the shopping screen and
  printed/copied output. Those named items sort into their own ordinary categories there — crate
  membership does not get its own heading — on the expectation (not an enforced rule) that a crate's
  members typically share a category as well as a shelf, given how the warehouse is actually laid
  out. If that ever needs a definite answer (rather than "take the first member's category"), it
  could be cached directly on the crate definition.
- **A crate member cannot carry its own individual target.** Marmite is never targeted on its own —
  only "Spread" (the crate) is. The member-item rows a target-stock list would otherwise show for
  marmite and the other crate members are not offered; the crate's own aggregate row is the only
  lever over their desired quantity. This falls directly out of the "counted by exactly one
  mechanism" rule in §1 above — a target is meaningless for stock nobody counts as a named item.
- **The generated shopping list — both plain item lines and the named lines a crate decomposes
  into — is directly editable, line by line, before it is printed or copied.** A shopper who knows
  the real state on the shelf (the mix of a crate has drifted further than its shopping-composition
  table reflects, or something else they know that the figures don't) can hand-adjust a line's
  quantity for that run only. The edit changes nothing stored — not the target, not the crate's
  composition percentages — it only affects the list as printed or copied this time.
- **If a derived stock-take breakdown looks visibly wrong to the counter** (the numbers clearly do not
  match what is on the shelf), that gets flagged to whoever does the shopping directly, by the
  counter — nothing in-system for this. (Distinct from the point above: this is the stock-take
  screen's crate decomposition, not the shopping list.)

### Validation

Crate correctness cannot be enforced at the point of the edit that breaks it — editing an unrelated
stock item's shelf number is the main way a crate becomes invalid, and there is no reasonable way to
block that edit. Instead:

- A **validate crates** check runs automatically after every stock-item edit, and is also available as
  a standalone, admin-triggered action — probably folded into a generic **Validation** area alongside
  the existing preference-rule-check screen, rather than being its own separate scattered entry point.
- It checks: every shelf carrying more than one stock item has a crate definition; every crate
  definition has more than one member item; every crate member's own shelf-number field still matches
  the crate's key (catching drift after an item is moved without the crate being updated).
- **Nothing is blocked.** A failure is surfaced immediately as something the admin must fix promptly,
  because a broken crate breaks real functionality (stock figures, stock-take pages) until it is
  fixed — this is not a background report to review "when convenient."
- There **is** a bulk-load facility for stock items, separate from anything visible in this client's
  code or `screenDetails.md` today (the closest things here are the one-way Google Sheets referral
  extract and the shopping-list "copy to clipboard" output, neither of which is this). It bypasses the
  edit-triggered validation entirely, which is exactly why the standalone, independently-runnable
  validation action matters — it's not just a convenience, it's the only check that ever runs against
  a bulk-loaded batch. No further design needed here beyond that.

## 3. Packing units

A separate, much lighter mechanism for the "a lot of one single, unambiguous item" case (cans of
baked beans stacked several crates deep) — deliberately kept apart from crates, since there is no
ambiguity to resolve and dragging in shelf-keying or composition tables for a single item would be
pure overhead.

- A stock item optionally carries a **units-per-pack** number, and its own **counting-unit name**
  (plural — "boxes", "trays", "cases") alongside it. "Pack" is not assumed: the physical thing being
  counted at a glance differs by item, and the stock-take page should say what the counter is
  actually looking at, not a generic word for it. Left blank, it falls back to the generic "packs".
- A packing unit never changes how the item is assigned for a stock take. The item stays directly
  assigned to its stock-take grouping, separate from crates; a box of beans (24 beans per box) is
  one item, not a one-member crate.
- At a stock take, a counter chooses whether to enter that directly grouped item as whole individual
  units or in its named packing unit. A packing-unit count may have one decimal place (for example,
  3.5 boxes); it is multiplied out and treated exactly like an ordinary directly-counted figure.
  Since the stock ledger holds whole items, a non-whole result is rounded to the nearest individual
  unit and the screen says what will be recorded. An individual-unit count remains a whole number.
- The entered count itself is never persisted — pure entry convenience, same as the crate count
  above.
- This is orthogonal to the "how is this item counted" validation: an item with a packing unit is
  still counted _directly_ (as opposed to via a crate).

## 4. The fresh shopping policy (server's Q43)

This resolves — and gives concrete shape to — the server's existing
[Q43](../../foodbankserver/OPEN-QUESTIONS.md) ("which fresh-food items may use stock already on
hand"), plus the "late referrals" gap that motivated this whole thread originally, which turned out
to be Q43 as well, not a separate thing.

A new named entity, a **fresh shopping policy**, selected when running the fresh-food shopping
calculation (today that screen only takes a date range — this adds a required policy choice
alongside it):

- **Fixes the date range outright** (e.g. "to close of Friday") — a team leader cannot override it on
  the day once a policy is chosen. Christmas, which shops more frequently, would be a different named
  policy with a tighter range, following the same pattern the standing target-stock lists already use
  for "different behaviour at Christmas" rather than teaching the system calendar awareness.
- **One boolean for the whole policy**: whether to respect each covered item's own, separately
  maintained "ignore stock on hand" setting (bread: ignore, because a recorded figure for something
  that goes off quickly is not trustworthy; cheese: use it, because it keeps). This is what lets the
  same item behave differently under a normal-week policy versus a Christmas one, where more frequent
  shopping means the stock figure is trustworthy again.
- **A covered-item list.** An item left off is dropped from that run's shopping list entirely — there
  is no "covered with zero effect" state, mirroring how a target-stock list already treats an absent
  item versus one with an explicit zero.
- **A contingency**, added to the requirement _before_ the stock-on-hand offset is applied, to buffer
  for referrals not yet known about when the list is generated. **Only one of two possible mechanisms
  will actually be built, not both** — a single global percentage applied to every covered item, or a
  per-item fixed-amount table (a flat number does not mean the same thing across items with very
  different typical volumes, so fixed mode would need to be per-item; percentage mode does not have
  that problem and could be one number for everything). **Which one is genuinely undecided** — this is
  the concrete question to put to the charity.

## 5. Updating stock from shopping

**Non-perishables: no change at all.** The standing target-stock-list shopping screen keeps working
exactly as it does today — computed fresh each time, printed or copied, never saved, never fed back
into stock. The periodic stock take (per grouping) remains the sole source of truth, as it is now.

**Fresh/perishable goods**: the fresh shopping list (the policy-driven calculation above) is **not
persisted as a stored entity anywhere**. It is reviewed and, if needed, amended by the shopper — and
agreed and confirmed _before_ the shopping trip happens, not reconciled against it afterwards.
Confirming adds the agreed quantities straight onto the relevant items' stock, as a single,
straightforward addition. There is no second pass to true the figures up against what was actually
bought.

If reality still diverges after the trip (the shop turns out to have none of something, despite
having agreed to buy some), the fix is the fresh-goods periodic stock take from section 1 — used as
and when needed, not as routine practice. If it started being used routinely to "correct" every
shopping run, it would quietly reintroduce the reconciliation step this design deliberately avoided.

Stock takes stay periodic. Concurrency is not a concern here: a plain, direct addition to the item's
stock figure is fine, since this only happens once per shopping trip, not from multiple places at
once.

## Open questions, consolidated

One thing left that needs the charity conversation, not a guess:

1. **Fixed-amount vs. global-percentage contingency** for the fresh shopping policy (§4) — refines
   server Q43, but the choice itself is undecided.

## What this would touch beyond this repo

Stock-take groupings, crate definitions (with their two percentage tables), the fresh shopping
policy entity, and packing units are all new domain concepts the server does not know about today.
None of this belongs in `../foodbankserver/INITIAL_SPEC1.txt` yet — it would need writing up there,
alongside a proper answer to Q43, once — and if — this direction is actually agreed with the charity.
