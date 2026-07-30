# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Food Bank Client

The React frontend for the food bank system: a public referral form, an admin back office, and the
screens a team lead uses to run a session — pick lists, printing, attendance.

Requirements are in [`INITIAL_SPEC1.txt`](./INITIAL_SPEC1.txt).

**The API is a separate repository at `../foodbankserver`.** It serves JSON only — no HTML, no SSR,
no PDF. Every screen, every layout and every printed sheet is this repo's job.

Read these two files in the server repo before writing client code that touches the API. They are
the contract and they are good:

- `../foodbankserver/API.md` — the sequences, the role visibility rules, the things that will
  otherwise be got wrong. Prose, short, worth reading in full.
- `../foodbankserver/openapi.yaml` — every shape.
- `../foodbankserver/CLAUDE.md` — the domain model and the settled decisions behind it.
  Do not read or modify the server code.

Also read [`KNOWN-GAPS.md`](./KNOWN-GAPS.md) before trusting a green `npm run check` in an area it
covers. It records what is built but less proven than the test count suggests — the cross-tab refresh
lock has never run against a real `LockManager`, the responsive nav is untested, and three
deploy-time checks fail silently and need a human.

## Current state

**Slice 1a — toolchain.** Vite, React, TypeScript with the project split below, eslint and Prettier
matching the server, Vitest with jsdom and MSW, generated API types, and `npm run check` green.
The app itself is a placeholder.

Landed alongside it in `../foodbankserver`: complete `required:` arrays and response schemas in
`openapi.yaml` (generated types were marking every field optional), and a `booked` count on the
session response so an admin can see how full a session is.

**Slice 1b — deployment topology.** `wrangler.jsonc`, the proxy Worker and its tests,
`tsconfig.worker.json`, and `cf-typegen` / `dry-run` in `check`. `npm run dev` runs the real proxy
with the `API` service binding resolved to the server's `wrangler dev`. Deploy-time checks that still
need a human are listed under "Deploy as one origin, not two".

**Slice 2 — API layer and auth.** `src/api/` (two `openapi-fetch` clients, the token store, the
single-flight `auth-fetch`, the cross-tab `refresh-lock`, `unwrap`/`unwrapVoid` and the query
client), `src/lib/errors.ts`, `src/auth/` (provider, context, `RequireAuth`, `?next=` validation,
session start/restore/end) and the sign-in screen at `src/features/auth/`. `src/app.tsx` now mounts
the query client and the auth provider around the placeholder.

Two things about it that are easy to undo by accident. `test/setup.ts` shims `Request` to resolve a
relative URL against the document, because Node's throws on one and `baseUrl: ''` in `api/client.ts`
is load-bearing — see "Deploy as one origin, not two". And `src/auth/auth-provider.test.tsx` resets
the module graph per test, because "boot exactly once per page load" is a module-level memo and a
test that reused it would prove nothing.

**Slice 3 — app shell and routing.** `src/routes.tsx` (a data router), `src/app.tsx` as providers
plus `RouterProvider`, `src/auth/menu.ts`, the shared components in `src/components/` — `spinner`,
`empty-state`, `error-notice`, `page-header`, `not-found`, `route-error`, `not-built-yet` and
`app-shell` — and a deliberately thin home screen at `src/features/home/`. The sign-in screen is now
routed.

Three things in it are structural rather than cosmetic, and undoing any of them costs a refactor:

- **The guard and the shell hang off a pathless layout route.** `/login` and `/refer/*` are plain
  siblings of it, not exceptions carved out of a shell that wraps everything, so adding the public
  referral flow later is a pure addition. `/refer` is reserved now with an honest stub, and a test
  asserts it issues no `POST /auth/refresh`.
- **The catch-all `*` route is required.** See "Deploy as one origin, not two" — the origin answers
  an unknown path with `index.html` and HTTP 200, so there is no server 404 to fall back on.
- **Routing uses the data router; fetching does not.** No route loaders — every request goes through
  a TanStack Query hook, because the two mechanisms share no cache, no auth path and no retry
  policy. That decision is written down in `routes.tsx` where someone would otherwise add a
  `loader:`.

`src/components/error-notice.tsx` is the one place the error table below is enforced, and
`src/components/app-shell.module.css` already carries the `@media print` frame — nav, controls and
colour dropped, `@page` margins set — so the printing slice inherits it rather than fighting it.

**Slice 3b — users.** `src/features/users/` (`keys.ts`, `queries.ts`, `users.logic.ts` and three
screens under `components/`), routed at `/users`, `/users/new` and `/users/:userId`; the shared
`src/components/confirm-dialog.tsx`; the first two helpers in `src/lib/london-time.ts`; and
`test/render-app.tsx`, which renders the real route table with the real providers so a screen test
proves its own wiring. The sign-in screen's development hint now lists `lead@x.com` alongside the
bootstrap admin. **This is the slice that unblocks role testing** — there is no other way to create a
team lead, and therefore no other way to see the partial menu.

Five things in it are structural, and undoing any of them costs more than it looks:

- **One cache entry, always `includeInactive=true`, split active/retired client-side.** Forced by
  there being no `GET /users/{id}`: the amend screen is a projection of the list and must be able to
  deep-link a _retired_ row, because reactivating one is the main reason to open it. `useUser(id)` is
  a `select` over that same query — a test asserts the amend screen issues exactly one `GET`.
  `includeInactive` never leaves `queries.ts`: the generated type is `'true' | undefined` and the
  server compares `!== 'true'`, so any other value silently means active-only.
- **Both mutations splice the response into the list and then invalidate.** The splice is what keeps
  every _other_ row's controls correct at once, since the last-active-admin refusal is a pure
  function of the whole array; the invalidate is because that predicate races other admins and the
  server is the authority. Dropping either half breaks a case that looks fine in one browser.
- **The `409` classification keys off fragments of the server's prose** — `'your own account'`,
  `'last active admin'` — because both lockout refusals are `code: 'CONFLICT'` and differ only by
  message. It is fragile, deliberately contained (all it decides is whether to refetch), and when it
  fails the message is shown verbatim with **nothing added**. In KNOWN-GAPS.md, and a `details`
  discriminator is on the server's wishlist.
- **Lockout is UX, not error handling: predict what is safe, submit what is not.** Self-lockout is
  refused up front because it depends only on the actor and the row. Last-active-admin is refused
  only as "as far as this list shows", never hidden, and anything unpredicted is submitted and the
  `409` handled. There is no guard on deactivating a team lead, because the server has none.
- **No email field on the amend form at all**, and `isActive` is not on it either. The server's patch
  schema silently strips an `email`, so a bug there returns 200 and changes nothing —
  `sends no email field when amending a user` is the only thing that would notice. Keeping rename
  and retire apart is what gives every `409` from that form exactly one possible cause.

**Slice 3c — thin public probe.** `src/features/referrals/` (`keys.ts`, `queries.ts`,
`public-referral.logic.ts`, `use-debounced-value.ts` and the screen under `components/`), the third
helper in `src/lib/london-time.ts`, and the two unauthenticated endpoints that exist today:
`GET /public/sessions` and `POST /public/referrers/check`. **No form, no Turnstile, no edit key, no
submission of any kind** — that is Slice 6. The point of it was to prove the unauthenticated route
tree, the `publicApi` client and the per-IP rate-limit path through the proxy before two feature
slices get built on assumptions about them, and all three hold.

Four things in it are structural:

- **The page is not a form, and must not become one by accident.** There is no `<form>`, no submit
  control and no field a referral could be typed into. A page that looks like it takes referrals and
  does not leaves somebody believing a household is booked in — so the first thing under the heading
  is that referrals cannot be made online yet and the way to make one is to phone. The one input on
  it checks an address and says so on its label and its hint.
- **The debounce is a rate-limit defence, not a nicety.** Public endpoints allow ~60 calls per IP per
  minute (measured through the proxy: the 61st `GET /public/sessions` inside a minute is a `429`), and
  the check runs as somebody types. `looksLikeEmail` withholds every keystroke before there is an
  address to ask about; 400 ms of quiet releases exactly one request. `useReferrerCheck` also sets
  `retry: false` against the client's default of backing a `429` off twice — the person is already
  retrying, by typing, and an automatic attempt only spends more of the limit that produced it.
- **The address is the cache key, and that is what makes a stale answer harmless.** Two addresses are
  two cache entries, so a slow verdict for a typo cannot land on top of a fresh verdict for the
  corrected address. Replacing that with a single piece of state reintroduces the race. The address
  itself goes in the POST body and never in a URL, and is never logged.
- **`formatSessionDate` formats in UTC, deliberately.** A `sessionDate` is a calendar day with no
  instant attached; `new Date('2026-08-04')` is midnight _UTC_, so formatting it in a zone behind
  Greenwich moves the session to the day before. London is safe only by the accident of never being
  behind UTC. `startTime` is printed exactly as it arrived and never reconstructed, and the list is
  ordered on `startsAtUtc`.

`src/features/referrals/public-referral-screen.test.tsx` does **not** use `test/render-app.tsx`: that
harness turns retries off, which would make "does not retry a 429" vacuous. It builds a client with
the app's real policy instead, so the `retry: false` on the query is what the assertion proves.

**Not built yet:** every feature except users, and the public referral flow is a probe rather than
the flow — `/refer` still takes no referrals. Seven of the eight menu destinations are routed to a
"not built yet" screen so no nav link is dead; each slice replaces one line of `routes.tsx`. Keep
this section honest as slices land, the way the server repo does.

## Commands

| Command                   | Description                                                     |
| ------------------------- | --------------------------------------------------------------- |
| `npm run dev`             | Vite dev server on :5173                                        |
| `npm run build`           | `tsc -b && vite build` → `dist/`                                |
| `npm run typecheck`       | `tsc -b` across every tsconfig project                          |
| `npm run lint`            | `eslint .`                                                      |
| `npm run format:check`    | `prettier --check .`                                            |
| `npm test`                | `vitest run`                                                    |
| `npm run test:watch`      | `vitest`                                                        |
| `npm run api:types`       | Regenerate `src/api/schema.d.ts` from the server's openapi.yaml |
| `npm run api:types:check` | Fail if that file is stale; skips when the API repo is absent   |
| `npm run cf-typegen`      | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc`    |
| `npm run dry-run`         | Build and validate the production deploy without uploading      |
| `npm run deploy`          | Build and deploy the `production` environment                   |
| `npm run check`           | All of the above — run before committing                        |

`check` needs no Cloudflare credentials: `wrangler types` reads the config locally and `--dry-run`
never calls the API. It regenerates `worker-configuration.d.ts` rather than checking it, so a stale
one fails review rather than production — the same arrangement the server uses.

The build layout the vite plugin emits, and the two footguns in it (`assets.directory` is the
plugin's, and the wrangler environment is chosen at build time by `CLOUDFLARE_ENV`, not by `--env` on
the deploy), are in [`README.md`](./README.md).

**`typecheck` is `tsc -b`, not `tsc --noEmit`.** With project references, `--noEmit` only checks the
solution root, which contains no files — it would pass while checking nothing.

Run a single test file or one test:

```bash
npx vitest run src/features/pick-lists/print.test.tsx
npx vitest run -t 'orders lines by shelf'
```

The API must be running for anything real: in `../foodbankserver`, `npm run db:migrate:local &&
npm run dev` (:8787).

### Signing in for the first time

Logging in never creates an account. A freshly migrated database contains exactly one, from
`migrations/0007_bootstrap-admin.sql`: **`pete@x.com`**. Any other address is a `401`, which looks
like a broken login and is not one.

To get a team lead — and therefore to see the partial menu at all — sign in as that admin, add a user
with the team lead role at **`/users`**, then sign in as them. `dev-login` takes only an email; the
name and role come from the `users` row, so a role picker on the sign-in screen would be a control
that silently does nothing.

In a development build the sign-in screen offers both addresses as click-to-fill buttons, from a
literal list in source that writes nothing anywhere. `lead@x.com` is the second of them by
convention, and it only works once an admin has added it: there is no bootstrap migration for a team
lead, on purpose — it would create an account nobody asked for in production and remove the forcing
function to dogfood the screen that creates one.

## The tsconfig split

Four projects, and the split is a hard requirement rather than organisation: the browser and the
Workers runtime both declare `Request`, `Response` and `fetch` with different shapes, and a project
that sees both produces errors saying `Request` is not assignable to `Request`.

| Project                | Owns                                            | Types           |
| ---------------------- | ----------------------------------------------- | --------------- |
| `tsconfig.json`        | nothing — references the others                 | —               |
| `tsconfig.app.json`    | `src/` (minus `src/worker`), `test/`            | DOM, no Node    |
| `tsconfig.node.json`   | Vite/Vitest config, `scripts/`, `test/tooling/` | Node            |
| `tsconfig.worker.json` | `src/worker/`, including its tests              | Workers, no DOM |

`tsconfig.app.json` names its `types` explicitly. Left unset, TypeScript pulls in every `@types/*`
package it can reach — including the 551 KB `worker-configuration.d.ts`. That is the
whole fix, and it is why `test/tooling/` (which uses `node:fs` and the ESLint API) lives in the Node
project: keeping it out of the app project is what stops `process` becoming reachable from a
component.

## Lint rules that carry weight

Five rules in `eslint.config.js` exist to make rules in this file enforceable rather than
remembered, and `test/tooling/eslint-rules.test.ts` asserts each still fires — a lint rule that stops
working fails open, and nothing else would notice.

- `localStorage` and `sessionStorage` are banned outright.
- `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` are banned outside
  `src/lib/london-time.ts`, because they silently format in the device's timezone.
- `src/api/client`, `src/api/auth-fetch` and `src/api/schema` may only be imported from `src/api/**`,
  `src/auth/**` and a feature's `queries.ts`.
- `src/worker/**` and the rest of `src/**` may not import each other. The two tsconfig projects stop
  the types mixing; this stops the code mixing, and fails at the import rather than at a build.
- `jsx-a11y`, which is pinned past its declared eslint peer range — hence the test.

## Generated API types are not optional

```bash
npx openapi-typescript ../foodbankserver/openapi.yaml -o src/api/schema.d.ts
```

Wire that up as `api:types` on day one and pair it with `openapi-fetch`, so every path, body and
response is checked by the compiler instead of by someone remembering to read the spec. Hand-written
request/response interfaces are a bug: they drift silently and the first symptom is a blank field on
a screen someone depends on.

**Commit `src/api/schema.d.ts`.** It is generated, but committing it means a build does not need the
sibling repo checked out. Regenerate whenever the server's spec changes and let the type errors show
you what to fix — that diff is the most useful review of an API change you will get.

## Deploy as one origin, not two

This is the first architectural decision and it is forced by the server, not a preference.

The refresh cookie is `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. **A browser will not
send a `SameSite=Strict` cookie on a cross-site request.** So if the client is served from a
different site than the API, refresh silently fails and every user is signed out fifteen minutes
after logging in. Worse, it works perfectly in testing, because nobody sits on one screen for
fifteen minutes.

Note that `*.workers.dev` is on the Public Suffix List, which means `foodbank-client.workers.dev`
and `foodbank-server-production.workers.dev` are **different sites**. The obvious deployment is the
broken one.

So: this Worker serves the built SPA and proxies `/api/*` to the server over a service binding.
Everything is same-origin, which also means no CORS, no preflights, and no `ALLOWED_ORIGINS` to
maintain.

This lives in `wrangler.jsonc` and `src/worker/index.ts`. Both are short, both are commented, and
neither is reproduced here — a copy in this file would drift. The reasoning, which will not drift:

The Worker is deliberately tiny — forward and get out of the way. Forward the request **unmodified**.
The server rate-limits on `cf-connecting-ip` and verifies Turnstile; rebuilding the request with a
fresh `Headers` throws that away and turns per-IP limiting into per-datacentre limiting. A broken
rate limit on an open, unauthenticated write is not a subtle problem.

`Set-Cookie` must pass through untouched too, and the cookie's `Path=/api/v1/auth` already matches
this layout because the proxy keeps the `/api/v1` prefix. Do not rewrite paths.

`run_worker_first: ["/api/*"]` means only the API path costs a Worker invocation, and it makes the
`ASSETS` branch of the Worker unreachable in production. Keep that branch: it is what makes the
Worker correct if the setting is ever removed, and it is what serves assets in dev.

`not_found_handling: "single-page-application"` makes deep links like `/sessions/:id` work, and has a
consequence: an unknown path returns `index.html` with HTTP 200. The router carries its own catch-all
404 route because of it — the `*` entry at the end of `src/routes.tsx`. Do not remove it.

Wrangler environments **do not inherit top-level keys** — repeat every binding in full under
`env.production`. The server's `wrangler.jsonc` has the same duplication for the same reason. With
the vite plugin the environment is selected at **build** time by `CLOUDFLARE_ENV`; `--env` on
`wrangler deploy` is accepted and silently ignored. See `README.md`.

### Local development

`npm run dev` runs the same Worker via `@cloudflare/vite-plugin`, and the `API` service binding
resolves to the server's `wrangler dev` through wrangler's dev registry — the registry matches on
script name, which is why the binding target differs per environment. The browser only ever sees
`http://localhost:5173`, so the cookie behaves exactly as it will in production.

**Use `localhost`, not `127.0.0.1`,** for anything the browser sees. They are different hosts, so
mixing them makes requests cross-site and reintroduces the bug this whole section exists to avoid.

If refresh works in Chrome but not another browser locally, suspect `Secure` over plain HTTP:
`localhost` is treated as a trustworthy origin by some browsers and not others.

### Verify at deploy time

Three things cannot be proved by any test in this repo, and all three fail silently. Do them by hand
the first time the proxy is deployed, and again if the Worker changes:

1. **The sixteen-minute session.** Sign in, leave the tab open past the fifteen-minute access token
   lifetime, then do something that calls the API. It must succeed without a re-login. This is the
   whole reason for the proxy, and the only test for it is a clock.
2. **Per-IP rate limiting through the proxy.** Hit `POST /api/v1/public/referrals` past its limit
   from one address and confirm the `429`, then confirm a second address is unaffected. If the
   Worker ever rebuilds the request, everyone behind one Cloudflare datacentre shares a budget.
3. **`Set-Cookie` byte-identical.** Compare the header on `POST /api/v1/auth/dev-login` through the
   proxy against the API directly. `Max-Age`, `Path=/api/v1/auth`, `HttpOnly`, `Secure` and
   `SameSite=Strict` must all survive, unaltered.

### The alternative

A custom domain also works, because same registrable domain is same-site: app on
`foodbank.example.org`, API on `api.foodbank.example.org`. That needs the server's
`ALLOWED_ORIGINS` set and credentialed CORS on every request. Prefer the proxy. If you switch, never
use a wildcard origin — the API sends a cookie, so `*` cannot work and the "fix" is always to
reflect whatever `Origin` arrives, which is no policy at all.

## Stack

Keep it small. Every dependency ships to a volunteer's phone on a hall's wifi.

- **Vite + React + TypeScript** — SPA, no SSR. There is nothing to server-render; the API is JSON
  and every interesting screen is behind a login.
- **React Router** in data-router mode — real URLs matter here. "The pick list for Tuesday" must be
  a link someone can send.
- **TanStack Query** for everything from the API. Server state is not component state: it is remote,
  shared, cached and refetched. Do not put API responses in `useState`, `useReducer`, or a global
  store.
- **React Hook Form + Zod** — the referral form is long, partly server-defined, and filled in by
  people under stress. Uncontrolled inputs and field-level validation, not a re-render per keystroke.
- **openapi-fetch** over the generated types. One typed client, one place that handles auth.
- **Vitest + React Testing Library + MSW.**
- **CSS**: plain CSS Modules unless there is a reason. Print stylesheets are a first-class
  requirement (see below) and they are easier to get right without a runtime CSS library in the way.

There is no state management library and there should not be one. Server state is TanStack Query's;
the rest is the current user, and a URL.

## Architecture

```
src/
  api/
    schema.d.ts       generated — do not edit
    client.ts         two openapi-fetch instances: `api` (authenticated), `publicApi`
    auth-fetch.ts     bearer header + single-flight 401 refresh; the ONLY place fetch is called
    refresh-lock.ts   cross-tab serialisation of refresh, with a timeout
    token-store.ts    the in-memory access token and the auth event listeners
    unwrap.ts         openapi-fetch result → data, or throw ApiError (`unwrapVoid` for 204)
    query-client.ts   retry policy; the cache that is never persisted
  auth/               AuthProvider, useAuth, session boot, route guard
  features/<area>/    one folder per domain area, mirroring the server's modules
    queries.ts        TanStack Query hooks — the only import boundary for data
    components/
    *.test.tsx
  components/         genuinely shared UI only
  lib/                london-time.ts, errors.ts, formatting — pure, tested directly
  routes.tsx
  worker/index.ts     the proxy Worker (Workers types, NOT DOM types)
```

Feature folders match the server's modules — `sessions`, `referrals`, `stock`, `pick-lists`,
`model-parcels`, `admin-setup` — so a change to one API area lands in one folder in both repos.

Rules that keep this from rotting:

- **Components do not call `fetch`.** They call a hook from `queries.ts`. Anything else bypasses
  auth, retry policy and the cache.
- Query keys are structured and exported from the feature that owns them
  (`['sessions', 'list', filters]`). No inline string keys — an invalidation that misses is a screen
  showing yesterday's data.
- Pure logic — London time, shelf ordering assumptions, household clamping, form validation from a
  server definition — lives in `lib/` or a `*.logic.ts` beside the feature, with no React import.
  Those are the cheapest and most valuable tests in the repo, and they only exist if the code is
  written to allow them.
- A feature may import another feature's `queries.ts`. It may not import its components' internals.

## Auth: the two rules that matter

**The access token lives in memory only.** Not `localStorage`, not `sessionStorage`, not a cookie
you set. Losing it on reload is fine, because **`POST /api/v1/auth/refresh` is how startup rebuilds
state from the cookie — never `GET /api/v1/auth/me`.** `/me` sits behind `requireAuth`, and a cold
reload has no token in memory, so it can only 401; you would then refresh anyway. And the refresh
response already carries the user **including `displayName`, which `/me` does not return** — it
answers `{ id, email, role }` only. So `/me` costs an extra round trip to learn less. It is for
re-reading the current actor mid-session, not for booting. A token in `localStorage` is readable by
any injected script, and this app is one XSS away from names, addresses and reasons for referral.

The boot runs **exactly once per page load**, held by a module-level memo. StrictMode double-invokes
effects, so without it the second effect fires a second refresh, the server sees the first token
replayed, and every development reload signs you out for reasons that look supernatural.

It is triggered by the **route guard, not by `AuthProvider`'s mount.** The provider wraps the whole
router so the sign-in screen can use it, but refreshing on mount would fire a pointless
`POST /auth/refresh` for every unauthenticated referrer who opens `/refer`. That is structural, not
an optimisation: it is what keeps the public referral flow independent of auth.

**Refresh exactly once, and never in parallel — including across tabs.** Each refresh rotates the
token. If two requests 401 together and both refresh, the second presents an already-rotated token,
and the server treats that as theft: it revokes the whole token family and signs the user out
everywhere. So `POST /api/v1/auth/refresh` must be single-flight, and that has two halves:

- **In one tab:** hold the in-flight promise in a module-level variable, queue concurrent 401s behind
  it, then retry each original request once. If refresh itself 401s, sign out. A 403 is never
  refreshed — it is a role problem, and refreshing on it loops.
- **Across tabs:** a module-level promise only covers one JS context. Two tabs reloading together are
  two contexts and both refresh, which is the family-revocation case again — invisible in single-tab
  testing and reported as "it randomly logs me out". Serialise with **`navigator.locks`**, which
  needs no dependency: the second tab then waits and refreshes with the _new_ cookie, which is valid.
  Fall back to the in-process promise where Web Locks are missing (older browsers, jsdom) rather than
  crashing, and give the lock a timeout — a lock is held until its callback settles, so a hung
  network would otherwise wedge every tab of the app at once.

This belongs in `auth-fetch.ts` and `refresh-lock.ts`, and nowhere else. A retry written at a call
site is how the concurrent-refresh bug gets in.

Never read or write the refresh cookie from JavaScript. It is `HttpOnly` and scoped to
`/api/v1/auth`, so it is not attached to any domain request. That is what stops a CSRF against
`/api/v1/referrals` having anything to ride on.

Today's login is `POST /api/v1/auth/dev-login` with any email. When Google auth arrives the response
shape does not change — an unknown email starts being rejected. Build the rejection path now: treat
`401` from login as "not a known user", with the same message as a bad credential.

## Roles drive menus, never access

Two roles: `admin` and `team_lead`. Use `role` to choose the menu, and nothing else. The server
re-checks it on every request from the signed token, so someone editing `role` in devtools sees
extra menu items and gets `403` on all of them.

Team leads run sessions — pick lists, printing, attendance — read sessions, stock, referrals and
model parcels, and **do the stock work: shops, stock takes and corrections.** Admins additionally
create and amend sessions and referrals, **maintain the stock item list**, maintain model parcels and
the grid, manage referrers, reasons, form definitions and users, and see why someone was referred.
The full table is in `API.md`, which is the authority — the split between "move stock" (both roles)
and "change what stock items exist" (admin only) is easy to get backwards.

The menu lives in `src/auth/menu.ts` as data rather than as conditionals in the shell, so the split
is testable without rendering anything. `src/auth/menu.test.ts` is where that table is enforced,
including a check that every entry points at a route which is not the catch-all 404.

**A team lead does not receive `reasonId`, `referrerEmail` or `referrerPhone` on a referral. The
fields are absent, not `null`.** The generated types make them optional; do not `!` them away. A
component that renders those fields must handle their absence without a hole in the layout and
without the string `undefined` reaching the screen.

Why: the reason for referral can mean financial hardship, domestic abuse, or immigration status. A
picker needs household size.

## Personal data on the client

The same rules as the server, and they bind harder here because a browser has more places to leak
into.

- **No third-party analytics, error reporting or session replay without asking first.** A stack
  trace or a replay from the referral form ships somebody's name, address and reason for referral to
  a company the charity has no agreement with. If error reporting is added, it must scrub request
  bodies, form state and URLs, and that scrubbing needs a test.
- **Never persist referral data.** No `localStorage` draft of the form, no query cache persistence,
  no service-worker caching of API responses. TanStack Query's in-memory cache is fine; anything
  written to disk is not.
- **Never put personal data in a URL** — not a path, not a query string. Ids only. URLs reach
  history, referrers and logs.
- **The referral edit key is a credential.** In memory only, never in a URL, never in storage. It
  authorises access to someone's name and address.
- Do not `console.log` a referral, a parcel with a name on it, or a form payload. Not even
  temporarily — that is exactly the line that gets committed.
- Reason for referral never appears on anything printable. See printing.

## Time is Europe/London wall clock

Sessions store the wall clock the charity typed (`date` + `startTime` like `"10:00"`) plus a derived
`startsAtUtc`.

- **Display `startTime`. Sort and filter on `startsAtUtc`.** A 10:00 session stays `"10:00"` across
  the BST changeover.
- **Never send `startsAtUtc`** — the server derives it. Send the date and wall-clock time.
- Never build a `Date` from a session's date and time and format it back — a browser in another
  timezone will move every session by hours. Format the strings you were given, or use
  `Intl.DateTimeFormat` with `timeZone: 'Europe/London'` explicitly.
- Volunteers use their own phones and laptops. Assume at least one has the wrong timezone set, and
  make that harmless.
- Keep all of this in `lib/london-time.ts`, pure and directly tested. Do not add a date library for
  it.

## Data fetching

- Generous `staleTime`. Session lists and stock levels do not change second to second, and the
  public endpoints are rate limited (roughly 5 referral submissions and 60 other public calls per IP
  per minute). **Never poll.** A retry loop is the only realistic way to hit those limits.
- **Do not retry `4xx`.** Retrying a `409` cannot help — the session really is full. Retry network
  failures and `5xx` only; `429` gets a backoff.
- Mutations invalidate the queries they affect, by key. Recording attendance changes the session's
  parcels and stock levels; both must be invalidated.
- Optimistic updates only where a mistake is cheap to undo. **Not for attendance** — that moves
  stock. Show a pending state and wait for the server.

## The public referral flow

Unauthenticated, and the only open write in the system.

```
GET  /api/v1/public/sessions          sessions with space, next 14 days
POST /api/v1/public/referrers/check   is this address allowed to refer?
GET  /api/v1/public/referral-form     the questions and reason options
POST /api/v1/public/referrals         submit → returns editKey ONCE
```

Check the referrer's address **as they type it** (debounced), so an unauthorised one is caught before
they fill in a whole form. When authorised, the response carries `organisationName` — pre-fill it.

### The form is data, not JSX

`GET /public/referral-form` returns `fields` (each with `key`, `label`, `helpText`, `type`,
`isRequired`, `options`, `minValue`, `maxValue`, `maxLength`, `displayOrder`) and the `reasons`
dropdown. **Render it dynamically and build the Zod schema at runtime from those constraints.** The
charity changes this form periodically and must not need a deploy to do it — that is the whole point
of the feature.

Answers go back in `answers`, keyed by each field's `key`. Respect `displayOrder`. An unknown field
`type` must render as a sensible text input rather than crashing the form; the server can publish a
type this build has never heard of.

Fixed columns are separate and typed: session, referrer email and phone, referee name, address,
postcode, phone, adults, children, reason, delivery. Do not fold them into `answers`.

`adults` is at least 1 — every referral must map to a real cell of the household grid. Households
over 5 adults or 5 children clamp into the corner, so a household of nine gets the same parcel as
five; do not surface that as an error.

### Turnstile

`POST /public/referrals` needs a Turnstile token in the `cf-turnstile-response` header in
production, and never in local development. Two failure modes to build for:

- **Tokens are single-use.** Never retry a submission with the same token — reset the widget and get
  a fresh one.
- **Tokens expire after five minutes.** Somebody filling in a long form slowly will hit this and get
  a `400` saying the check expired. Reset the widget and let them resubmit. Do not show a generic
  error; they did nothing wrong.

### The fifteen-minute edit window

The submission response contains `editKey` **once and nowhere else**. It authorises
`GET|PATCH|DELETE /api/v1/public/referrals/{id}` via the `x-referral-key` header.

- **Fifteen minutes from submission, absolute.** Amending does not extend it. Show a countdown and
  hide the edit UI when it lapses.
- Amending does not return a new key. Keep the original.
- `DELETE` consumes it. After withdrawing, the key is dead.
- After expiry there is no self-service route — the referrer must phone the food bank. Say so
  plainly. A `409` here is not something to apologise for.

## Pick lists and printing

```
POST /api/v1/sessions/{sessionId}/pick-list   generate or fetch — call on screen open
GET  /api/v1/pick-lists/{id}/print            one sheet per parcel
POST /api/v1/pick-lists/{id}/print            mark printed
POST /api/v1/pick-lists/{id}/confirm          lock
POST /api/v1/parcels/{id}/attendance          per household
POST /api/v1/sessions/{sessionId}/confirm     close the session
```

Generation is **idempotent** — a repeat call returns the existing list with `parcelsCreated: 0`. So
just `POST` when the picking screen opens; no "does it exist yet" branch.

`skipped` lists referrals with no model parcel for their household size. Show it as a warning an
admin can act on — the rest of the list is still pickable.

**Lines are editable while `draft` and after `printed`.** The list locks only on `confirm`. This is
not an oversight: pickers discover shortages at the shelf, holding a printed sheet. A UI that
disables editing after printing breaks the actual workflow.

`PUT /parcels/{id}/lines` with `quantity: 0` **removes** the line. That is how "we had none" is
recorded — do not send a delete, and do not treat 0 as invalid input.

`GET /pick-lists/{id}/divergence` reports referrals that arrived after generation, households whose
size changed, and referrals since cancelled. **Nothing is applied automatically and there is no sync
endpoint.** Present it as a warning and let a human decide.

### Printing is a real feature

There is no PDF endpoint. Printing is the browser's print dialog against a print stylesheet, and it
is used every session by someone who cannot debug it.

- `GET /pick-lists/{id}/print` returns lines **already ordered by shelf** so a picker walks the
  aisle once (`A1, A2, A10` — not alphabetical). **Render in the order given. Never re-sort.**
- One sheet per parcel: `break-after: page` between parcels, and `break-inside: avoid` on a parcel's
  line table. Fetch the whole payload once and render every sheet — no lazy loading, no
  virtualisation, no per-sheet request.
- Show the **pick number** large. It is how a sheet gets matched to a bag in a hall.
- Show `dietaryNotes` prominently. The picker is the only person who can act on them, and the
  alternative is a parcel the household cannot eat.
- **Never print the reason for referral.** Not even for an admin. Sheets get carried round halls and
  left on tables.
- **Do not print name and address unless `isDelivery` is true**, where the address is the entire
  point.
- Use `@media print` to drop navigation, buttons and colour. Test at A4. Keep the print layout in
  its own stylesheet next to the print component so it is obvious when someone changes it.

## Attendance

**This is where stock moves** — not on confirm.

`attended` issues the parcel and decrements stock. `no_show` moves nothing; the parcel is unpacked.
One or the other must be recorded for every parcel.

- **Submitting twice is safe.** `alreadyRecorded: true` means it was already in that state and stock
  did not move again. Disabling the button is kinder but not load-bearing.
- A mistake can be corrected **once in each direction**. A third change is refused with `409` and
  needs an admin stock adjustment. Surface that message; do not swallow it.
- `POST /sessions/{sessionId}/confirm` refuses while anyone is `pending` and returns
  `details.pendingPickNumbers`. **Show those numbers** — the team lead needs to know who is missing,
  not that something went wrong.
- Stock levels can be **negative** after a correction. Do not assume non-negative, and do not render
  a negative level as an error.

## Errors

Every failure has the same shape:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "That session is full",
    "details": { "capacity": 25, "booked": 25 },
    "requestId": "9f2c…"
  }
}
```

Parse it once in `lib/errors.ts` into a typed error the UI can switch on. `message` is written to be
shown to a user and never contains personal data.

| Status | What the client does                                      |
| ------ | --------------------------------------------------------- |
| `400`  | Field errors from `details.issues` → `setError` per field |
| `401`  | Single-flight refresh, retry once, else sign out          |
| `403`  | Treat as a bug, except on sign-in — see below             |
| `404`  | "No longer exists", not a crash                           |
| `409`  | **Show `message`.** It is meaningful, and not retryable   |
| `422`  | **Show `message`.** A rule forbids it                     |
| `429`  | Back off. Do not loop                                     |
| `500`  | Generic apology plus `requestId`                          |

**The `403` exception is the sign-in screen.** A deactivated account gets `403` from
`POST /auth/dev-login`, and that is a real answer to a real request rather than a menu showing
something it should not. Show the server's message verbatim plus "ask an administrator to
reactivate it". Everywhere else `403` still means the menu and the role disagree — but note that
routes are never role-guarded, so a team lead who types an admin URL _does_ make the request and
_does_ get a `403`. That must read as a plain explanation, which is what `describeApiError` in
`lib/errors.ts` is for. It must never be a crash, and the request must still be made: the server's
check on the signed token is the only one that means anything.

`409` and `422` are the two that get mishandled. They mean _the session is full_, _this list is
confirmed_, _that reason is no longer offered_. A generic "Something went wrong" throws away the one
useful sentence the server sent.

**Validation errors name the field and the rule but never echo the value.** You cannot render "you
entered X" from the response, so keep your own copy of what the user typed — which React Hook Form
does for free, as long as the form is not reset on error.

Show `requestId` somewhere copyable on a `500`. It is also in the `x-request-id` header, and it is
what makes a volunteer's bug report actionable.

## TypeScript rules

Mirror the server's strictness — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
`useUnknownInCatchVariables`. Do not relax them per file, and never add a `@ts-expect-error` or
`eslint-disable` without a comment saying why it is unavoidable.

- **Erasable syntax only.** No `enum`, no `namespace`, no decorators, no parameter properties. Union
  types and `as const` objects instead.
- No `any`, no non-null assertions (`!`), no unchecked casts. `unknown` at the boundary, a precise
  type after parsing. The team-lead-missing-fields case is exactly where an `!` does damage.
- **Imports are extensionless here**, unlike the server's `.ts` specifiers. Deliberate divergence —
  Vite resolves them. Do not "fix" one repo to match the other.
- **Keep DOM types and Workers types apart.** `src/worker/` compiles against
  `worker-configuration.d.ts`; everything else against `lib: ["DOM", "ES2024"]`. They disagree about
  `fetch`, `Request` and `Response`, and mixing them produces errors that look like nonsense. Two
  tsconfig projects, and `npm run typecheck` builds both.
- Quantities are integers. Never floats.
- Prefer discriminated unions over optional-field soup, especially for pick list and parcel states —
  `draft | printed | confirmed` and `pending | attended | no_show` are the shape of half the UI.

## Testing

- Every behaviour change ships with a test. Bug fixes start with a failing test.
- **MSW against the generated types**, so a fixture that no longer matches the contract fails to
  compile. Hand-rolled `fetch` mocks drift from the API and stop testing anything.
- Test what the user does: render a screen, click, assert on what is on it. Query by role and label,
  not by test id or class.
- **Unit-test the pure logic directly** — London time, runtime schema building from a form
  definition, error parsing, household clamping.
- Priorities, in order, because these are where a bug means a household goes hungry or someone's
  private information is exposed:
  1. **The auth interceptor.** Two simultaneous 401s must produce exactly one refresh. Write that
     test before the code.
  2. **The print view.** Shelf order preserved, reason absent, name and address only when
     `isDelivery`, one page per parcel.
  3. **Attendance.** Double submit is safe, the third correction shows the `409`, confirm shows
     pending pick numbers.
  4. **Role-based rendering.** A team lead's referral view renders with `reasonId` absent, and never
     displays it.
- Name tests as the rule they enforce: `never renders the reason for referral on a pick sheet`.
- Add a test asserting the print payload cannot render a reason even if the server sends one. Cheap,
  and it is the failure nobody would notice in review.

## Conventions

- Files `kebab-case.ts` / `kebab-case.tsx`; components and types `PascalCase`; values and functions
  `camelCase`; hooks `useThing`.
- Prettier settings identical to the server's `.prettierrc.json`: single quotes, semicolons, trailing
  commas, 100 columns, 2 spaces.
- **Use the server's domain words** — session, recurring session, referral, household, parcel, pick
  list, stock item, attendance, referrer, model parcel, grid. Do not invent synonyms; "client",
  "order", "basket" and "template" all mean something else here. `../foodbankserver/CLAUDE.md` has
  the definitions.
- Comments explain _why_. Do not narrate what the code says.
- No dead code, no commented-out blocks, no abstraction for a requirement that has not arrived.
- Accessibility is not optional: this is used by volunteers on unfamiliar devices and by referrers
  who may be anyone. Labelled inputs, visible focus, keyboard-reachable everything, errors associated
  with their fields, and real contrast.

## Before adding a dependency

Prefer the platform. `Intl`, `fetch`, `URL`, `crypto.randomUUID` and modern CSS cover more than
people expect, and everything here ships over a phone connection in a church hall.

If a package is genuinely needed, say what it is for, why it beats writing it, and check it is
maintained. Anything that touches tokens, personal data or crypto needs explicit sign-off. Anything
that sends data off-origin — analytics, error reporting, fonts, a CDN — needs sign-off from the
charity's point of view, not just a technical one.
