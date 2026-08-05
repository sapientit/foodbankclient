# Known gaps and residual risk

Things that are built but less proven than the green test run suggests, and things a
test cannot prove at all. Written down because they were discovered during
implementation and would otherwise live only in someone's memory.

`npm run check` passing does **not** mean these are covered. Read this before
trusting a green build in an area listed here, and delete an entry when it stops
being true.

---

## Untested because the environment cannot test it

**The cross-tab refresh lock has never run against a real `LockManager`.**
`src/api/refresh-lock.ts` is the thing that stops two tabs refreshing at once and
tripping the server's token-family replay detection, which signs the user out
everywhere. jsdom ships no Web Locks, so **every test exercises the fallback
path**, and the production path is covered only by a hand-written fake that models
FIFO grants and release-on-settle. A real implementation could differ, most likely
in what an abort does after a grant.

This is the least-proven code in the repository guarding the most expensive
failure. Verify by hand: sign in, open a second tab, let the fifteen minutes
lapse, then act in both at once. Nobody should be signed out. Check in Safari and
Firefox as well as Chrome, and confirm the fallback is not silently the live path.

**`ConfirmDialog` has never run against a real `<dialog>`.** jsdom implements no
part of the element — not `showModal`, not the top layer, not the backdrop, not
native focus containment — so **every test exercises the fallback path**, which
sets the `open` attribute instead. That fallback is also what a browser without
`<dialog>` support would take, so it is worth having, but the production path is
unproven: in particular whether the explicit Tab trap and the explicit
focus-return agree with what a real modal dialog already does, and whether
`preventDefault` on the Escape keydown really stops the browser closing the
element behind React's back. Open the deactivation dialog in Chrome, Safari and
Firefox: check the page behind it is inert, Escape closes it once, Tab stays
inside, and focus lands back on the button that opened it.

It now has three callers, not one: deactivating a user, starting a stock take
and committing one. The two new ones are the more consequential — neither can be
undone through the API — so the same browser check is worth repeating on
`/stock/take`.

**Neither of the two new stock screens has been opened in a browser.** The shop
and the stock take are covered by tests and by direct `curl` against a running
server, and the endpoints were confirmed to work through the dev proxy on
`localhost:5173`, but no human has looked at either screen. That leaves the
things jsdom cannot see: the search results list under a real keyboard, the
count sheet's forty-odd inputs on a phone, whether the print rules on
`stock-take-screen.module.css` produce a usable count sheet on A4, and whether
the `role="status"` announcements after adding an item are heard once rather
than continuously.

**Neither referral screen has been opened in a real browser.** The list and
the detail screen — filters, the amend form, the move panel's capacity
warning, the cancel dialog — are covered by MSW-backed tests only. That leaves
whatever jsdom cannot see: the reason `<select>` and the move `<select>` under
a real keyboard, whether the move panel's `role="status"` warning is
announced sensibly when a screen reader user changes the session dropdown
twice in a row, and the answers list's `<dl>` on a phone.

**The small-screen nav collapse is untested.** jsdom evaluates neither media
queries nor layout, so the `~700 px` disclosure is pure CSS with no coverage. The
keyboard behaviour (`aria-expanded`, `aria-controls`, Escape, focus return) _is_
tested; whether the button ever appears is not.

**Print styles are unverified on paper.** The `@media print` block is confirmed
present in the production bundle, and nothing more. The pick-list slice inherits
whatever it actually does.

**The live region on `/refer` has never been heard.** jsdom implements no
accessibility tree and no announcements, so the tests prove only that a
`role="status"` element exists before the answer arrives, that its content
changes, and that the input's `aria-describedby` points at it. Whether a screen
reader actually announces the verdict — and whether it announces it _once_
rather than interrupting somebody mid-address — needs VoiceOver or NVDA. The
shared `Spinner` is deliberately not used inside that region, because it is
itself a `role="status"` and a nested live region is the usual cause of a
double announcement; that reasoning is also untested.

**The clipboard copy on a 500 is tested against a stub**, not a real
`navigator.clipboard`. Failure is swallowed and the `requestId` stays on screen
with `user-select: all`, so the fallback is "select it yourself" — also untested
in a browser, and `navigator.clipboard` may be absent over plain HTTP.

## Assumptions not checked against a running server

**Slice 9 (referral maintenance) was also built from `openapi.yaml` and `API.md` alone, with no
running server to confirm against.** Two specific things worth checking by hand:

- **The exact `409` message on `PATCH /referrals/{id}` when a move is not acknowledged.**
  `openapi.yaml` gives that response no `content:` at all — only the summary "Target session is full
  and not acknowledged" — so the move panel has never seen the real sentence, only `ErrorNotice`'s
  generic `409` handling. This client should never actually trigger that refusal in practice
  (`acknowledgeOverCapacity` is always sent correctly from the same numbers the operator sees), but a
  race — another admin filling the session between this client's read and the submit — would reach
  it, and nobody has watched what the screen does when it happens.
- **Whether `GET /referrals` really accepts `sessionId` and `status` with no other constraint.** Read
  directly off `openapi.yaml`'s declared query parameters, not confirmed by calling it — in
  particular, whether an unknown or another actor's `sessionId` is a clean empty list (the assumption
  `ReferralsScreen` makes) rather than a `400` or `403`.

**The whole of Slice 7 (referrers and reasons) was built from `openapi.yaml` and `API.md` alone,
with no running server to confirm against — unlike every stock and model-parcels claim in this file
that says "verified against a running server."** Three specific things worth checking by hand the
first time this is deployed against a real instance:

- **The exact `409` message text on a duplicate referrer or a duplicate reason code.**
  `openapi.yaml` gives only the descriptions "That referrer is already on the list" and "That code
  already exists" as response summaries, not guaranteed server prose. `ErrorNotice` shows whatever
  the server actually sends verbatim regardless, so nothing breaks if the wording differs — but the
  pre-submit duplicate checks (`findAuthorisedReferrer`, `findReferralReasonByCode`) are what stop an
  admin reaching that `409` at all in the common case, and neither has been proven to agree with the
  server's own uniqueness check on a live database.
- **Whether the server compares a domain case-sensitively.** `blockedActiveDomain` in
  `admin-setup.logic.ts` lower-cases both the email's domain part and a stored domain row before
  comparing, on the assumption that `Guildford.gov.uk` and `guildford.gov.uk` are the same domain to
  whatever matches referrers on submission — reasonable for a DNS name, but not confirmed against the
  matching module `../foodbankserver/CLAUDE.md` says exists in `modules/referrers`, which this repo
  is not permitted to read.
- **Whether `GET /authorised-referrers` and `GET /referral-reasons` really return everything with no
  parameters, on every deployment.** Read directly off `openapi.yaml`, which declares no query
  parameters on either — `queries.ts` relies on this to justify having no `includeInactive` (or
  equivalent) to get wrong, unlike `users.ts`. Confirmed by reading the spec, not by calling it.

**The verbatim `403` message on sign-in.** `openapi.yaml` declares
`content?: never` for dev-login's 401/403/404, which contradicts the prose saying
an error envelope is always sent. The login screen is hardened so a bodiless 403
still reads sensibly, but nobody has seen a real deactivated-account response.
Deactivate an account against a running server and confirm.

**The `409` lockout classification depends on the server's wording, and nothing
in either repo would catch a change to it.** `classifyLockoutConflict` in
`src/features/users/users.logic.ts` matches the fragments `'your own account'` and
`'last active admin'`, because both refusals are `code: 'CONFLICT'` with identical
`details`. The server has no test asserting either sentence, so an editorial pass
over `users.service.ts` would silently degrade this to "unclassified" — the
refusal would still be shown verbatim, which is the point of the fallback, but the
list would stop refetching after a conflict nobody predicted and would keep
showing a stale row. **The fix is a `details` discriminator** (`self_lockout`,
`last_active_admin`, `duplicate_email`); it is on the list to raise with the
server repo. Until then, the only instrument is the two tests naming those
sentences, and they assert what this client does, not what the server says.

**The last-active-admin refusal is almost unreachable through the UI, so only its
unit tests really exercise it.** An admin looking at another admin's row is
itself a second active admin, so the predicate answers "allowed" every time; it
can only fire when the actor is _not_ an active admin in the list — a stale
fifteen-minute token after somebody else demoted them. That path has never been
walked in a browser. The `409` route past it is covered.

**The `403` surface is now integration-tested** for the users screen —
`users-screen-forbidden.test.tsx` signs in as a team lead, opens `/users`, and
asserts both the notice and that the request was made. Every other admin-only
destination is still a `not-built-yet` screen that makes no request at all, so
this holds for exactly one route today.

**The `404` copy for `AUTH_MODE ≠ dummy`** has never been seen against a real
deployment.

**A duplicate stock-item name on `PATCH /stock/items/{id}` is a `500`, and the
client only hides it.** Verified against a running server on 2026-07-30:
`POST /stock/items` refuses a duplicate with a clean
`409 A stock item with that name already exists`, but the same duplicate on
`PATCH` reaches the handler as an unmapped constraint violation and comes back
as `INTERNAL_ERROR` with no explanation. `findStockItemByName` in
`src/features/stock/stock.logic.ts` catches it before the request, matching the
server's comparison (trimmed, case-folded, retired rows included, the item
itself excluded — all four verified). **That check is a cached predicate, so the
`500` is still reachable**: another admin renaming an item in the same minute,
or a list fetched before they did. When it happens the volunteer sees "something
went wrong at our end", which is neither true nor actionable. **The fix belongs
in the server** — map the constraint to the same `409` the create path returns —
and it is on the list to raise.

**Per-IP rate limiting is proven to _happen_ through the proxy and nothing
more.** Driving `GET /api/v1/public/sessions` through `localhost:5173` returns
sixty `200`s and then `429`s, with the envelope
`{"error":{"code":"BAD_REQUEST","message":"Too many requests. Please wait a
moment and try again."}}`. That confirms the limiter sees the request and that
the client's `429` copy is reachable. It confirms nothing about
**partitioning** — every request came from one address, and the failure mode
that matters is a Worker which rebuilds the request and makes everyone behind
one Cloudflare datacentre share a single budget. Still a deploy-time check;
see the list at the end of this file.

Note the code on a `429` is `BAD_REQUEST`, not a rate-limit code of its own.
Nothing in this client branches on it — `ErrorNotice` and `describeApiError`
both switch on the **status** — but a screen that ever switched on `code` would
be wrong here, and there is no test in either repo that would say so.

**The 429 on the referrer check is tested through MSW, never against the real
limiter.** `useReferrerCheck` sets `retry: false`, and the test proves it under
a client configured to retry — but a real 429 arrives mid-typing, after a
sequence of successful checks, and what a person actually sees while they carry
on typing into a rate-limited field has not been watched.

**A user row whose `role` is `volunteer` would render a blank Role cell.**
`openapi.yaml` declares one `Role` enum for requests and responses, so the
generated union is `admin | team_lead` and `ROLE_LABELS` is exhaustive over it —
but the database's CHECK constraint still permits `volunteer`, and no route
assigns it. The plan called for two types on the server, request-narrow and
response-wide; that half did not land. If a `volunteer` row ever appears, the cell
is empty rather than showing the string `undefined`, which is the better of the two
failures but is still not a label.

**Shelf ordering is proven by one observation, not by a test that could fail.**
`GET /stock/levels` and `GET /stock/items` were confirmed on a running server to
answer `A1, A2, A10` — the zero-padded shelf sort — and this client renders that
order untouched. The tests assert only that a fixture in that order survives to
the screen, which is the right thing to assert here, but nothing in this repo
would notice if the **server's** sort regressed. The failure would be a picker
walking the aisle twice.

**The shop's double-submit guard has never faced a real double tap.** The
synchronous ref lock in `record-shop-screen.tsx` is the only thing standing
between a fumbled tap and a second shop on the ledger — `POST /stock/purchases`
has no idempotency key, and the server mints a fresh `purchaseId` every time.
The test dispatches two `click()`s inside one `act()`, both before React
re-renders, and it was confirmed to post **twice** when the ref check is
removed — and, importantly, **twice again when the ref is removed and the
control is given a real `disabled` attribute instead**, which is the evidence
that `disabled` alone would not have saved it even in jsdom. But jsdom's event
timing is not a browser's: a real double tap on a phone involves touch events,
a ~300 ms click delay on some configurations, and a compositor thread, none of
which exist here. Nobody has yet tapped Save twice, fast, on a real device.
Worth doing on a phone and on a trackpad, on a throttled connection so the
request is still in flight for the second tap.

The release rule is equally unproven by hand. `classifyPurchaseFailure` unlocks
on a `4xx` and stays locked on a network failure or a `5xx`, on the reasoning
that only the server can say nothing was written. The `5xx` half has never been
seen: it is reached through MSW only, and it is the branch that tells a
volunteer to go and look at the levels rather than offering them a button.

**A duplicate `stockItemId` in one shop is a `500`, and the client only avoids
it.** Verified against a running server on 2026-07-31: two lines naming the same
item in one `POST /stock/purchases` reach the handler as an unmapped constraint
violation and come back as `INTERNAL_ERROR`. Nothing was written (the level was
unchanged), so it is the same class of bug as the duplicate-name `PATCH` above:
a real refusal arriving as "something went wrong at our end". The shop screen
cannot produce it — adding an item already on the list bumps that line's
quantity rather than adding a second line, and that is **load-bearing rather
than a nicety**. It is still reachable in principle by anything else that posts
a purchase. Worse, this client classifies a `5xx` as _ambiguous_, so if it ever
did happen the operator would be told the shop might have saved when in fact
nothing did — safe, but wrong. **The fix belongs in the server**: either sum
duplicate lines or map the violation to a `400`. On the list to raise.

**The stock take's `409` copy is shown verbatim and its two causes are not told
apart.** `POST /takes/{id}/commit` answers `409` for _already committed_ and for
_no counts recorded_, and the real message for the second was confirmed to be
`This stock take has no counts recorded`. Nothing branches on which, so both
render through `ErrorNotice` as the server's sentence — which is right, but it
means the screen cannot offer "save your counts first" as a next step for the
one where that is the answer. A `details` discriminator would fix it; it is the
same request already on the list for the user `409`s.

**Nothing has confirmed what `POST /takes/{id}/counts` does to an item counted
twice across two saves**, because the screen cannot do it: one page, one Save,
and a second Save re-sends every non-blank box. The contract says a later count
replaces an earlier one and that was taken on trust.

**No screen has yet seen a real `400` from `/stock/adjustments`.** The three
issue paths were read off a running server (`quantityDelta`, `movementType`,
`reason`) and they match the form's field names, so `setError` lands — but the
adjustment form's `applyFieldErrors` is exercised only through MSW.

**None of the session screens has been opened in a real browser.** The create
and amend forms use native `<input type="date">` and `<input type="time">`
because their value format is exactly `sessionDate` and `startTime` — no
parsing, nothing to get backwards — but jsdom's implementation of both is
minimal and does not exercise the segment-by-segment editing UI a real
browser gives each, on desktop or a phone's native picker. `user.type` fills
both happily in a test; whether a volunteer can do the same with a keyboard,
a mouse, or a thumb has not been watched. Worth doing by hand on Chrome,
Safari and Firefox, and on a phone.

**Neither the model parcel screens nor the household grid has been opened in a
real browser.** The grid is the hard case: thirty native `<select>` elements
in one table, each with an `aria-label` combining both dimensions rather than
a visible `<label>`, because a table cell has no natural place to put one.
jsdom proves the label text is computed correctly and that keyboard-driven
`userEvent.selectOptions` reaches every cell, but not what a screen reader
actually announces moving between cells, or whether the row/column headers
read sensibly with VoiceOver or NVDA. The contents editor's `<select>`-to-add
pattern is unverified the same way `record-shop-screen.tsx`'s autocomplete
was before it was checked by hand — see the entry above for the shop and the
stock take. Worth doing on Chrome, Safari and Firefox, and specifically with a
screen reader on the grid.

## Contract gaps found while building this slice

**`PUT /parcel-grid`'s `200` and two of this slice's error responses carry
more than `openapi.yaml` says they do.** The spec declares the grid save's
success response and the model-parcel delete's `409` with no content at all,
and the grid save's `422` the same way — all three `content?: never`. Verified
against a running server: the `200` actually echoes the saved grid back
(`{"grid": {...}}`), the `409` carries `details.cells` (which grid cells still
reference the parcel), and the `422` carries `details.unknownParcels` (cell
and name pairs) and `details.unexpectedCells`. None of it is used —
`useSaveParcelGrid` stays on `unwrapVoid` because the screen already has what
it just sent, and both error notices show `error.message` only, which is the
part the contract actually promises. If `openapi.yaml` is ever corrected to
type these, the delete confirmation and the grid save's refusal could both
name the affected cells instead of repeating one sentence for every cause —
see `DEFERRED-WORK.md` W2.

**Fixed, 31 July 2026: `PATCH /recurring-sessions/{id}` now names its
properties.** It was declared `{ type: object, minProperties: 1 }` with no
`properties:` block, generating `Record<string, never>` — a type that refuses
every real field. The client carried a hand-declared `RecurringSessionPatch`
and one `@ts-expect-error` for a single release; both are gone and the type is
derived from `paths` like every other body. Worth keeping the entry as the
worked example: the thing that announced the fix was `tsc` failing on an
**unused** `@ts-expect-error`, which is the argument for narrow, documented
directives over a cast that would have silently gone on working and hidden the
improvement.

## Deliberate behaviour that will look like a bug

**Deleting a model parcel and later creating a new one under the same name
silently reattaches every grid cell that used to name it.** The grid stores a
parcel's **name**, not its id, by design — "so several household sizes can
share one model parcel and changing that parcel updates all of them" — and
that design has no way to tell "the same parcel, edited" apart from "a
different parcel that happens to share a name". The server's delete route
refuses while the grid still points at a parcel, so reaching this needs two
separate actions (delete, then recreate under the identical name) rather than
one, but nothing stops it, and this client has no way to warn about it: by the
time the second parcel exists, the cell simply resolves again, indistinguishable
from having always pointed at it. Guarding against it would mean tracking an
id the contract never exposes to this client. Worth knowing before assuming a
grid cell's meaning is stable across a delete-and-recreate.

**A stock take can never be tidied away, and the screen can only warn about
it.** `abandoned` exists in the database and no route produces it, so a take
opened by mistake stays open for ever. Starting one is behind a confirmation
that says so, and where several are already open the operator is told plainly
that the extras cannot be removed — but the only way to clear one is to count
something and commit it, which is what the two probe takes left in the local dev
database on 2026-07-31 had to be closed with (both committed with counts
matching the ledger exactly, so no stock moved). A deployed instance will
accumulate them. **The fix belongs in the server**: a route that abandons a
take. On the list to raise.

**The count sheet shows a retired item only when it still holds a balance.**
`countableLevels` includes every active item plus any retired one whose
`quantityOnHand` is not zero, on the reasoning that a retired row with stock
against it is exactly what a stock take exists to find and is invisible on the
levels screen. It is a rule this client invented; nothing in the server or the
spec says a stock take should behave that way, and a warehouse that expected the
count sheet to match the shelf labels exactly would find the extra row
surprising.

**A negative stock level is shown as a plain number with nothing said about
it.** It is a real state after a correction, so it is not an error and is not
styled as one — but a warehouse seeing `-45` on a shelf gets no hint from this
screen about what to do next, and the only route back to zero is an adjustment
they have to think of themselves. Deliberate for now: anything stronger would
have to guess whether the ledger or the shelf is wrong.

**A network blip during refresh signs the user out.** It is indistinguishable from
a revoked token family without another round trip, and guessing "still signed in"
leaves the app making requests that will all 401. Defensible, but more aggressive
than the charter's wording implies, and it will be reported as "it randomly logs
me out".

**A thrown error replaces the whole shell.** `errorElement` sits on the layout
route, and React Router does not render a route's `element` when its
`errorElement` fires — so the volunteer loses the nav. `RouteError` carries its
own `<main>` and a link home to compensate. Putting an `errorElement` on each
child would preserve the shell; worth revisiting once a real screen can throw.

## The referral form definition machinery (Slice 8) has never been wired to a form

Everything in `src/features/referrals/referral-form-definition.ts`,
`referral-form-schema.ts`, `referral-answers.logic.ts`,
`referral-form-guards.ts` and the modules added with the real questions
(`referral-form-config.ts`, `referral-key-fields.ts`, `referral-form.logic.ts`,
`referral-submission.logic.ts`) is unit-tested, and the guards now run against
the charity's actual `referral-form.config.json` rather than only against
invented fixtures. It is now wired to a real screen and exercised end to end by
`public-referral-screen.test.tsx`, which fills all seven pages and submits.
Three things still worth watching:

- **The public form does not use React Hook Form, and every other form here
  does.** `buildFormSchema`'s output is never passed to `zodResolver`; the
  screen holds the answer map in `useState` and calls `safeParse` a page at a
  time. That was the right call — the field set is built at runtime, a checkbox
  group hands back a list, and the resolver would change per page — but it does
  mean this form shares no plumbing with the rest of the app, so a bug fixed in
  one will not be fixed in the other.
- **`checkDefinitionLimits`'s 16KB estimate is arithmetic, not a measurement.**
  It runs against the real config and passes with room to spare, but it has
  never been checked against the server's actual enforcement on
  `POST /public/referrals` — no running-server verification exists for it the
  way this file records for stock and model parcels. It is deliberately
  conservative (every free-text field at its
  declared `maxLength`, every choice at `answerMax` copies of its longest
  `value`, ignoring JSON escape growth), so a definition it accepts should be
  safe, but "should be" is doing the same work here as above.
- **Six questions ship with a guessed list of choices** — toiletries, household
  items, spread, nappy sizes, baby milk types, and the tea/coffee row whose
  question mentions hot chocolate and whose answers do not. That is **Q20**, and
  the guess is named at `referral-form-config.ts`. The **keys** are the
  charity's own, which is what a wrong guess here cannot damage: an option list
  can change between releases and `describeAnswers` already renders a stored
  value the current list no longer offers.
- **The page titles are the client's wording, not the charity's.**
  `Referral questions.csv` says each page has a title and does not give one.
  Seven invented headings, correctable by anybody who reads them.

**The key-reuse guard (`reusedKeys` in `referral-form-guards.ts`) cannot catch
its own most dangerous failure mode.** It fires when a retired key is reused
under a **different type**, because a type mismatch is the one thing a machine
can check. It cannot fire when a key is reused for a same-typed question with
a different meaning — two free-text questions, or two dropdowns with
different option lists, are indistinguishable by shape — which is arguably
the more likely mistake in practice (copying an existing question as a
starting point for a new one and forgetting to change the key). The doc
comment on `reusedKeys` says this; it is repeated here because it is the kind
of limit that is easy to forget once the function exists and appears to be
"the" safety net.

## Test-harness compromises

**`test/setup.ts` patches `globalThis.Request`** so relative URLs resolve against
the document, because Node's `Request` throws on them and `baseUrl: ''` is
load-bearing (an absolute origin could drift into being cross-site and kill the
`SameSite=Strict` cookie). It restores browser behaviour — but it also means a
genuinely malformed URL now resolves in tests instead of throwing.

**`unwrap`'s `ApiResult<T>` is a hand-written mirror** of openapi-fetch's return
shape rather than an import. An upstream change fails to compile, which is the
right failure, but it is still a mirror.

**Two guarded `as` casts survive** in `readTokenResponse`, and one in
`asRecord`. Every field is `typeof`-checked afterwards; the casts exist because
`typeof x === 'object'` cannot narrow an index signature into existence.

**Mostly fixed, 31 July 2026: the "flaky under parallel load" cluster was five real
bugs, not resource contention.** Four files had been filed here across three
slices as intermittently failing and always passing in isolation, each read as
the suite being loaded rather than as anything wrong. Running the whole suite
repeatedly found four distinct causes, all fixed — after which ten consecutive
`vitest run`s and three consecutive `npm run check`s were clean:

- **`test/setup.ts` tore MSW down in the wrong order.** `server.resetHandlers()`
  ran _before_ `cleanup()`, so the React tree was still mounted with no handlers
  registered. Anything it fired in that window — a TanStack Query refetch, a
  promise from the finishing test settling into a re-render — hit no handler, and
  `onUnhandledRequest: 'error'` reported it against whichever test ran **next**.
  That misattribution is the whole reason it looked like unrelated files failing
  at random. Unmount first, then reset.
- **Three tests asserted on a captured request without waiting for it.** In
  `sessions-screen.test.tsx` and `sessions-team-lead.test.tsx`, `await
findByRole('heading', …)` resolves when the heading renders, which can beat the
  query firing — leaving `requestedUrl` as `''`, so `new URL('')` threw, or
  leaving a sentinel in place of the captured value. They now wait for the
  request itself.
- **`test/tooling/eslint-rules.test.ts` was not flaky, it was slow.** The first
  `lintFiles` call pays for typescript-eslint's `projectService` building a
  TypeScript program over the app, and under full parallel load that exceeded the
  5s default timeout. It now sets 30s, with the reasoning in the file.
- **`record-shop-screen.test.tsx`'s `addItem` helper returned before the item was
  in the list.** Clicking "Add" is not the same as the line having rendered, so a
  test adding two items raced the second add against the first render and posted
  a shop with one line instead of two. The helper now waits for the line's own
  quantity field before returning. **Improved, not closed — see below.**

**One cause remains open: the shop's `addItem` can click a detached button.**
`ItemSearch` renders its results only while the query for the _current_ debounced
term is successful, so the list unmounts and remounts as the term settles. A
button found immediately before that is detached when the click lands, and a
click on a detached node silently does nothing. Roughly **one full
`npm run check` in five** still fails on it. The helper's wait means it now fails
at the add itself rather than downstream as a wrong payload, which is the honest
place for it, but the race is real.

**Do not fix it by only clicking when the line is absent.** That guard makes the
second tap in `adds up a second tap on the same item` impossible; tried on
31 July 2026 and it failed six `npm run check` runs out of six, having passed
four of five before. The direction that should work is waiting for the results
list to correspond to the term just typed before querying the button at all.

**Two cautions learned in the fixing.** First: ten clean `vitest run`s said this
was finished, and the very next full `npm run check` failed. `check` builds,
types and lints before testing, so the machine and module graph are in a
different state — confirm a flake is dead with `npm run check`, repeatedly, not
with the test runner alone. Second: **"passes in isolation, fails in the suite"
is a description, not a diagnosis.** Filing it as environmental three slices
running cost more than the afternoon it took to look, and one of the causes was a
teardown bug capable of masking a genuine failure anywhere in the repo.

The lesson worth keeping: **"passes in isolation, fails in the suite" is a
description, not a diagnosis.** Filing it as environmental three times running
cost more than the afternoon it took to actually look, and one of the three was
a teardown bug capable of masking a genuine failure in any test in the repo.

**A further flake pattern, seen twice, not yet fixed: a `findBy*` query timing
out, only under `npm run check`, in files this session never touched.** Found
while building Slice 9 (referral maintenance), which touches neither
`src/features/stock` nor `src/features/model-parcels` — confirmed with `git
status`/`git diff --stat` before looking further each time. Two instances,
different files, same shape:

- `record-shop-screen.test.tsx > sends one request carrying every line`:
  `Unable to find a label with the text of: How many Rice`, timing out inside
  `addItem`'s own `await screen.findByLabelText(...)` — the exact wait the
  31 July fix above added.
- `amend-model-parcel-screen.test.tsx > sends no name field on save`: `Unable
to find role="heading" and name "Model parcels"`, timing out on the redirect
  after a successful save.
- Both: clean across five consecutive isolated `vitest run <file>` runs each,
  and clean across three consecutive plain `vitest run`s of the whole suite.
  Each reproduced exactly once out of four `npm run check` runs in this
  session, in different files each time.
- That pattern — clean alone, clean in the plain suite, occasionally late only
  behind `npm run check`'s build and `wrangler deploy --dry-run` — matches the
  diagnosis already made for `eslint-rules.test.ts` above: a real async wait
  whose default timeout (`findBy*`'s 1000 ms) is tight under the heavier CPU
  contention `check` adds on top of the suite, not a logic bug in either test
  or screen. It is not confined to one file or one feature, which argues
  against fixing it file-by-file the way `eslint-rules.test.ts` was — a global
  `asyncUtilTimeout` in the Testing Library config, or accepting the noise and
  re-running `check` once on a genuine failure, are both more proportionate
  than hunting one `findBy*` call at a time. Nobody has done either yet; this
  entry exists so the next person who sees a `findBy*` timeout only-under-check
  starts here instead of re-diagnosing it as environmental from scratch.

**`Spinner`'s 150 ms delay now has callers** — the users screens — but nothing
asserts what a volunteer sees during those 150 ms, because the mocked API answers
within one. The delayed path is unit-tested directly.

**`test/render-app.tsx` fixes one signed-in actor per test file.**
`ensureSession()` is memoised per page load by design, and a test file is one
module registry, so the first `POST /auth/refresh` a file makes decides who is
signed in for every test in it. That is why the team-lead `403` case lives in its
own file. A test that quietly assumed it could switch role mid-file would pass
against the wrong actor rather than failing.

**`renderApp`'s default `staleTime: 0` makes an invalidation test vacuous.**
Every remount refetches under it, so "the levels refetched after an item
changed" would pass whether or not anything was invalidated — which is the exact
bug the fold onto one `stockKeys` root exists to prevent. `renderApp` therefore
takes an optional query client, and
`src/features/stock/stock-invalidation.test.tsx` passes one with the app's real
`staleTime`. Both of its tests were confirmed to fail when the item mutations
invalidate only `stockKeys.items()`. **Any other test asserting that a mutation
refreshed a different screen has to do the same** — the default client will lie
to it.

**One users-list assertion had to fall back to a regex.** The row header for your
own row is `Pete Bennett` plus a `(you)` span, and `getByRole('rowheader', { name:
'Pete Bennett (you)' })` does not match — `dom-accessibility-api` computes
something else for that nesting. The test matches the role by regex and asserts on
`textContent` instead, which still proves the badge is rendered on the right row
but does not prove what a screen reader announces for it.

## Dependency overrides that are load-bearing

Documented in full in the `//overrides` block in `package.json`. In short: one is a
**security fix** (`brace-expansion` forced to the patched 5.0.8, because the 1.x
and 2.x lines are end-of-life and npm's suggested fix was a pair of major
_downgrades_ that would have broken eslint entirely). The other two are stale peer
ranges. `test/tooling/eslint-rules.test.ts` is what catches it if any of them
breaks the tooling.

## Deploy-time checks only a human can do

All three fail **silently**. Also listed, with what each one proves, in
`docs/operations/deploy-verification.md`; the reasoning is in
`docs/architecture/deployment-topology.md` under "Deploy as one origin, not two".

- [ ] **The sixteen-minute session.** Sign in on the deployed origin, leave the tab
      idle past the 15-minute access-token lifetime, then use the app. It must not
      require signing in again. This is the entire reason the proxy Worker exists
      and the only instrument is a clock.
- [ ] **Per-IP rate limiting through the proxy.** Drive an unauthenticated write
      past its limit from one address, confirm the `429`, then confirm a _second_
      address still has its own budget. If the Worker ever rebuilds the request,
      everyone behind one Cloudflare datacentre shares a single budget on an open
      write. Partitioning has never been proven — only that limiting happens,
      which Slice 3c did confirm locally at sixty calls a minute. The second
      address is the whole test and it needs a deployed pair.
- [ ] **`Set-Cookie` byte-identical** through the proxy versus direct: `Max-Age`,
      `Path=/api/v1/auth`, `HttpOnly`, `Secure`, `SameSite=Strict`. Confirmed
      locally through dev; not on a deployed pair.
