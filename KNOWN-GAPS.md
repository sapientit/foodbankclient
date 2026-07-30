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

## Deliberate behaviour that will look like a bug

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

**`Spinner`'s 150 ms delay now has callers** — the users screens — but nothing
asserts what a volunteer sees during those 150 ms, because the mocked API answers
within one. The delayed path is unit-tested directly.

**`test/render-app.tsx` fixes one signed-in actor per test file.**
`ensureSession()` is memoised per page load by design, and a test file is one
module registry, so the first `POST /auth/refresh` a file makes decides who is
signed in for every test in it. That is why the team-lead `403` case lives in its
own file. A test that quietly assumed it could switch role mid-file would pass
against the wrong actor rather than failing.

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

All three fail **silently**. Also listed in `CLAUDE.md` under "Deploy as one
origin, not two".

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
