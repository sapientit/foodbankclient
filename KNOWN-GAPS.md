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

**The application-wide control style has never been seen on a screen.** Blue
for a control that can be used and grey for one that cannot now comes from
`src/index.css` for every `<button>` in the app, with three variants over it
(`button-secondary`, `button-danger`, `button-plain`). jsdom evaluates no CSS,
so nothing in the suite renders any of it: `test/tooling/button-styles.test.ts`
reads the stylesheets and proves only that no screen draws its own palette, and
the contrast figures in the comments are calculated rather than measured. What
to look for in a browser, on the screens that moved furthest — the confirmation
dialogue, a table row's actions, the referral form's Back and Next, the
development sign-in list: that no available control reads as dead, that a
`button-plain` control still reads as something to press, that a link drawn as
a control keeps its underline, and that nothing prints as a filled block of
colour. The run-a-session screens are the one part with a sighted history: they
carried this palette locally from 2026-08-17 and only lost their copy of it.

**The Turnstile widget has never run against the real Cloudflare script.**
`src/features/referrals/turnstile.ts` injects
`https://challenges.cloudflare.com/turnstile/v0/api.js`, which jsdom will not
load, so **every test drives a stub of `window.turnstile`** — a fake whose
`render`, `reset` and `remove` the tests call by hand. What that proves is this
client's half of the contract: that a token reaches the header, that a spent one
is never sent twice, that the send button waits and says why. What it cannot
prove is that the real script calls those callbacks when we think it does, that
`expired-callback` genuinely fires at five minutes, or that the widget renders
legibly on a phone above the send button. The dev sitekey in `.env.development.local` is the
live test widget, so `npm run dev` against the local API is the cheapest real
check: the local server now has a matching `TURNSTILE_SECRET_KEY`, so a
submission that lands proves the whole path end to end.

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

**Nothing proves a screen reader announces the referral form's refusal.** When
the food bank refuses a submission, `public-referral-screen.tsx` moves the
referrer to page one, moves focus to the progress paragraph, and mounts
`ErrorNotice` — a `role="alert"` — carrying the reason. Three things therefore
land in one paint: a programmatic focus move onto text that has itself just
changed ("Page 7 of 7" to "Page 1 of 7"), an assertive region appearing, and the
polite `role="status"` referrer verdict re-appearing with page one. A freshly
inserted alert is announced per the ARIA spec, which is why focus is left on the
progress line rather than dragged into the notice; but how NVDA, JAWS and
VoiceOver actually order and interrupt those three is not consistent between
them, and jsdom models none of it. **The failure to look for is a referrer who
hears "Page 1 of 7" and never hears why they were sent there** — they would be
looking at a form that appears to have thrown their work away. Needs a real
screen reader before go-live; if it is wrong, the fix is to give the notice a
focus target and land focus on it instead.

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

**Copying a referral (`POST /referrals/{id}/copy`) has never been called against a running server.**
The screen was built from `openapi.yaml` and `API.md` the day the route was added. Three things to
watch the first time it runs for real, because a copy holds a real place on a real session:

- **That `adminInfo` on the copy really does read `Copied from referral dated YYYY-MM-DD`, and that
  the date is the _original's_ submission date in `Europe/London`.** The client never composes this
  string and never sends one — it is written entirely by the server — so nothing here fails if the
  wording or the timezone differs; it would simply be quietly wrong on the screen an administrator
  reads. Worth looking at once, against a referral submitted late in the evening in British Summer
  Time, where a UTC-based date would come out a day early.
- **That the copy really arrives `status: "reviewed"`.** The screen shows whatever it gets and does
  not assert it, so a copy arriving `active` or `pending_review` would put the household back in the
  review queue silently rather than breaking anything visible.
- **The `409` when the target session is confirmed or cancelled.** The copy dialog offers every
  session `useSessions` returns and does not filter those out, on the grounds that the server's
  refusal carries the one useful sentence and this client should not maintain a second copy of the
  rule. Nobody has seen that sentence.

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

**A duplicate stock-item name on `PATCH /stock/items/{id}` is a `500`, though
the client prevents it in normal use.** Verified against a running server on 2026-07-30:
`POST /stock/items` refuses a duplicate with a clean
`409 A stock item with that name already exists`, but the same duplicate on
`PATCH` reaches the handler as an unmapped constraint violation and comes back
as `INTERNAL_ERROR` with no explanation. `findStockItemByName` in
`src/features/stock/stock.logic.ts` catches it before the request, matching the
server's comparison (trimmed, case-folded, retired rows included, the item
itself excluded — all four verified). The remaining path requires a direct API
caller, a future client regression, or two people editing stock items at once.
The charity has one person doing that work, so this is **defence-in-depth, not
work to prioritise**. If the workflow changes, the server should map the
constraint to the same `409` the create path returns.

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

**The shopping list has never been printed on paper or pasted into a
spreadsheet.** `shopping-screen.module.css` sets `@page { size: A4 landscape }`,
a three-column grid and `break-inside: avoid` on each category group, but jsdom
evaluates no CSS: the tests prove the column split keeps a heading with its
items and that the markup is there, not that three columns actually fill down
the first before the second on A4, that a category heavier than a column
overflows to the next rather than being clipped, or that no heading is stranded
at a page break. The `Copy to clipboard` button is tested against
`userEvent`'s clipboard stub, not a real `navigator.clipboard`, and nothing
proves the tab-separated text lands as two columns in Google Sheets or Excel.
Worth doing by hand on Chrome, Firefox and Safari before go-live.

**Neither the model parcel screens nor the household grid has been opened in a
real browser.** The grid is the hard case: thirty native `<select>` elements
in one table, each with an `aria-label` combining both dimensions rather than
a visible `<label>`, because a table cell has no natural place to put one.
jsdom proves the label text is computed correctly and that keyboard-driven
`userEvent.selectOptions` reaches every cell, but not what a screen reader
actually announces moving between cells, or whether the row/column headers
read sensibly with VoiceOver or NVDA. The contents editor's `<select>`-to-add
pattern is unverified in a real browser. Worth doing on Chrome, Safari and
Firefox, and specifically with a screen reader on the grid.

## Contract gaps found while building this slice

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

**Referrals submitted before 2026-08-15 hold the two operational counts under
the old definition, and nothing recalculates them.** Until that date the client
derived `adults` and `children` as everyone 18 or over and everyone under 18;
they are now everyone 12 or over and the 5-11 band alone, with the under-fives
in neither. The columns did not change shape and the server never knew what
they meant, so an older referral reads as perfectly valid and simply sizes its
parcel by the old rule — a household with a teenager gets a smaller parcel than
the same household referred today, and one with only under-fives and an adult
gets a larger one. Pete decided on 2026-08-15 to leave them: a backfill would
have to reinterpret the retained `Household Components` answer, referrals
without one could not be corrected at all, and anything already picked was
picked to the numbers on the sheet. There is nothing to look for in the code —
the two values are just data — so this note is the only record that a referral's
age is now part of reading its household size.

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
