# Data fetching, caching and screen patterns

TanStack Query is the data layer of this application — there is no database here and no global store,
so the cache is where correctness bugs live. The enforceable rules are in
[`.claude/rules/data-fetching.md`](../../.claude/rules/data-fetching.md). This file records the
patterns that have been settled by building screens against the real API, and **why each shape was
chosen over the obvious alternative**.

Nearly every entry here was found by building a screen and getting it wrong first.

## Reading one row: projection or real fetch?

The API is not consistent about single-item `GET`s, and the client's shape must follow it rather than
paper over it.

- **No single-item endpoint → the detail screen is a `select` over the list query.** Users, stock
  items, model parcels and recurring sessions all work this way. `useUser(id)` is a projection of
  `useUsers()`, and a test asserts the amend screen issues exactly **one** `GET`.
- **A real endpoint → a real fetch with its own cache entry**, kept current with `setQueryData`.
  Sessions and referrals work this way, because `GET /sessions/{id}` and `GET /referrals/{id}` exist
  and are **not capped by role** (`API.md` §2: "Not capped: `GET /sessions/{id}` and every pick-list
  route"). There is no array to splice into.

The users list is the worked example of why the projection is not just a shortcut: the list is fetched
**always with `includeInactive=true`** and split active/retired client-side, because the amend screen
must be able to deep-link a _retired_ row — reactivating one is the main reason to open it.
`includeInactive` never leaves `queries.ts`: the generated type is `'true' | undefined` and the server
compares `!== 'true'`, so any other value silently means active-only.

## Writing: splice, invalidate, or both?

- **Both** where a predicate spans the whole list. The users mutations splice the response into the
  cached array **and then** invalidate: the splice keeps every _other_ row's controls correct at once
  (the last-active-admin refusal is a pure function of the whole array), and the invalidate is because
  that predicate races other admins and the server is the authority. Dropping either half breaks a
  case that looks fine in one browser.
- **Invalidate only** where the response is not a full row. `POST /authorised-referrers` answers
  `{ id, matchValue }` and its `PATCH` answers `{ id, isActive }` — neither carries
  `organisationName` or `notes`, so there is nothing to splice. `referral-reasons` chose the same
  shape **even though its responses do carry the full row**, so that module has one pattern rather
  than an asymmetry that exists only because one response happens to allow more.
- **Invalidate across features** where a derived count lives elsewhere. `Session.booked` is derived
  from referral data, so cancelling or moving a referral invalidates `sessionKeys`, imported from the
  sessions feature's `keys.ts` (not its `queries.ts`). Moving a referral changes **two** sessions'
  occupancy and the response only carries the new `sessionId`, so `previousSessionId` is passed
  through as an extra mutation variable rather than recovered from a cache after the fact.

## Query key roots: fold only on a real coupling

`src/features/stock/` has **one** `stockKeys` root for item maintenance and stock movement together,
because adding an item makes a row appear in the levels list and changing its shelf number
**reorders** that list. Two disjoint roots cannot invalidate each other, and the resulting bug is a
picker walking the aisle in last week's order.

`src/features/admin-setup/` deliberately keeps **two** roots for referrers and reasons: an authorised
referrer never names a reason, and a mutation on one has nothing useful to invalidate on the other.
Folding them would have been the reflexive move after the model-parcels slice — but the fold there
was earned by a genuine coupling between a parcel's name and the grid's cells, not by two resources
sharing a folder.

## Refusals: predict what is safe, submit what is not

The doctrine, in one line: **refuse up front only what depends on data already on screen and cannot
change underneath you; submit everything else and show the `409`.**

- **Safe to predict.** Self-lockout on the users screen depends only on the actor and the row. A
  `confirmed` session cannot be un-confirmed by another admin, so `describeLockedSession` refuses the
  amend up front.
- **Not safe to predict.** Last-active-admin races other admins, so it is refused only as "as far as
  this list shows", never hidden, and anything unpredicted is submitted.
- **When the prediction misses, show the server's message verbatim with nothing added.**

Two client-side checks are **required rather than courteous**, because the server's failure mode is
worse than a `409`:

- **Stock item duplicate names.** A duplicate on `POST /stock/items` is a clean `409`; the same
  duplicate on `PATCH /stock/items/{id}` is a **500** (verified against a running server). The check
  runs against the list **including retired items**, because a retired row still holds its name and
  the server still refuses it — and that is the case an admin cannot diagnose, since the colliding row
  is not on screen.
- **Model parcel duplicate names — but without case folding.** Verified against a running server,
  `Single parcel` and `single PARCEL` coexist as two different model parcels. Copying
  `normaliseStockItemName`'s case folding here would tell an admin that two genuinely different
  parcels collide when the server would happily create both.

## Fields that cannot be amended get no form field at all

Not a disabled one — **absent**. A user's `email`, a model parcel's `name`, a referral reason's
`code`: the generated `PATCH` body types have no such property, so there is nothing to wire up even by
mistake, and a `409` from that form then has exactly one possible cause.

This matters because the failure is silent. The server's patch schemas **strip** an unexpected field
rather than rejecting it — verified against a running server, a `name` sent to
`PATCH /model-parcels/{id}` returns `200` and changes nothing. `sends no email field when amending a
user` is the only thing that would notice the equivalent bug on the user form.

`isActive` is off the amend forms too. Retire/restore and deactivate/reactivate stay **actions on the
list screen**, behind a `ConfirmDialog` on the destructive-reading half and a plain button on the
other.

## Double submit on a write with no idempotency key

`POST /stock/purchases` mints a fresh `purchaseId` per request, so a double tap is two shops on the
ledger.

The guard is a **synchronous `useRef`**, and the Save control carries **`aria-disabled` rather than
`disabled`** because of it: a `disabled` attribute is applied on the next render and a real double tap
lands both clicks first, whereas `aria-disabled` leaves the second click reaching the handler, where
the ref refuses it. That also makes the guard testable rather than shadowed by the browser.

**The lock is released only when the server has said it wrote nothing** (`classifyPurchaseFailure`):
a `4xx` unlocks; a network failure or a `5xx` does **not**, because the shop may well have been
recorded. That case offers no Retry and sends the operator to the levels screen to look.

Contrast the session-materialisation job, which **is** idempotent: a plain `disabled` is fine there,
and "zero created" is a normal answer rather than a failure.

## Where the API's shape forces the screen's shape

- **The stock take is one page, one Save, then Commit** — deliberately against the grain of an API
  whose counts are batched, repeatable and upserted by item. Shelf-at-a-time looks intended, but
  there is **no `GET /stock/takes/{id}`**, so a reload cannot show which shelves have already been
  counted. Counting the lot on one page is resumable by not needing to resume. **Do not "improve"
  this until that endpoint exists.** `abandoned` is unreachable and several takes can be open at once,
  so a mis-clicked take is permanent: starting one is confirmed, an open one is resumed, several make
  the operator choose, and a take just opened **stays selected even while the refetched list has not
  caught up** — bouncing back to "no stock take is open" would invite a second one that nothing can
  ever discard.
- **The household grid is saved once, whole, never per cell.** `buildGridPayload` produces one sparse
  object (filled cells only) and `PUT /parcel-grid` is called exactly once from one Save control.
- **`/sessions` is one route rendering two screens, not two routes**, and `useSessions` **never sends
  `from` or `to`** for either role. `API.md` §2 says an admin's planning view and a team lead's shift
  view "are different screens"; what makes that true is what the screen _offers_, not a client-computed
  date window. The token already carries the horizon, and guessing a `to` here can only get it wrong
  in the direction of quietly hiding a session that is genuinely there. Two tests, each named after
  its role, assert no window is sent.
- **A weekly template generates nothing by itself, and the screen has to say so.** Only the nightly
  cron materialises sessions. The first version of that slice let an admin add a weekly session,
  return to the list, and find it unchanged with nothing explaining why — indistinguishable from a
  save that failed. Hence the **Generate sessions now** control (`POST /jobs/session-materialisation/run`),
  and a create form that says plainly it makes a template. `describeMaterialisation` **does not
  default a missing `sessionsCreated` to zero**: the job report has no `required:` array, so every
  field is optional to the compiler, and printing "no new sessions" on a response that never said so
  is the one wrong answer on a screen whose whole job is saying whether anything happened.

## Reading the contract more carefully than the generated types

The generated types are the floor, not the ceiling — `openapi.yaml` sometimes under-describes a
response, and occasionally the prose is the only discriminator available.

- **`unknownParcels` on `GET /parcel-grid` is typed as an array of propertyless objects**, so
  "unknown" is computed client-side instead: `unknownGridCells` compares each cell against the
  model-parcel list this client already has. A cell naming a deleted parcel **keeps its stale value
  selected**, marked with an extra "(no longer exists)" option, rather than being silently blanked —
  nothing the admin has not chosen to change is lost.
- **Three model-parcel/grid responses carry more than the spec types** (the grid save's `200`, the
  delete's `409`, the save's `422`). This client deliberately parses none of it and shows
  `error.message`, which is what the contract actually promises. `DEFERRED-WORK.md` W2 has the
  improvement, once the spec is fixed.
- **The users `409` classification keys off fragments of the server's prose** — `'your own account'`,
  `'last active admin'` — because both lockout refusals are `code: 'CONFLICT'` and differ only by
  message. It is fragile, **deliberately contained** (all it decides is whether to refetch), and when
  it fails the message is shown verbatim with nothing added. In `KNOWN-GAPS.md`; a `details`
  discriminator is on the server's wishlist.
- **The over-capacity warning on a referral move is computed here and never disables the control.**
  `screenDetails.md` says an admin can move a referral "even if that exceeds capacity with a client
  generated warning". `wouldExceedCapacity` reads the same `booked`/`capacity` the operator can see in
  the dropdown, and `acknowledgeOverCapacity` is set from that same read on submit.
- **Household clamping is stated from the input, not the response.** `POST /parcel-grid/preview`
  echoes `household` back **unclamped** even when `modelParcelName` reflects the clamped lookup, so
  nothing in the response says a household was treated as smaller than it is.
  `describeHouseholdClamping` states the fixed public rule from what the admin typed, and renders it
  as **information, never a warning**.

## Numbers in forms are held and parsed as text

`<input type="number">` cannot tell an empty box from a lone minus sign, and React Hook Form hands
back whatever the uncontrolled input holds. So every numeric form field in this codebase is a string
that a named parser converts — `parseWholeNumber`, `parseDisplayOrder`, and the session form's
duration and capacity.

`parseDisplayOrder` is the one that accepts a leading `-`, because a display order is legitimately
allowed to be negative (a reason meant to sort before everything else) while a quantity is not.
