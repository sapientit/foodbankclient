# Project structure

The layout, the four-project tsconfig split, and the lint rules that turn prose in `CLAUDE.md` into
something the build enforces.

## Layout

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
  auth/               AuthProvider, useAuth, session boot, route guard, menu.ts
  features/<area>/    one folder per domain area, mirroring the server's modules
    keys.ts           query keys, exported for cross-feature invalidation
    queries.ts        TanStack Query hooks — the only import boundary for data
    *.logic.ts        pure, no React import
    components/
    *.test.tsx
  components/         genuinely shared UI only
  lib/                london-time.ts, errors.ts, use-debounced-value.ts — pure, tested directly
  routes.tsx
  worker/index.ts     the proxy Worker (Workers types, NOT DOM types)
```

Feature folders match the server's modules — `sessions`, `referrals`, `stock`, `pick-lists`,
`model-parcels`, `admin-setup` — so a change to one API area lands in one folder in both repos.

**Rules that keep this from rotting** are in `CLAUDE.md` under "Architecture". Two worth expanding:

- **A shared helper moves to `lib/` when it gets its second caller, not before.**
  `useDebouncedValue` lived in `src/features/referrals/` until the stock shop's autocomplete needed
  it. The referral-specific `CHECK_DEBOUNCE_MS` deliberately stayed behind, because what that
  constant defends is one endpoint's rate limit — not a general preference about typing.
- **A `*.logic.ts` may not import `src/api/schema`**, so it takes a structural parameter type
  instead. `describeAnswers` accepts `{ answers, piiPurgedAt }` rather than the generated `Referral`.
  The lint rule forces it; the payoff is a pure function that can be tested without a fixture and
  cannot be quietly coupled to a response shape.

## Routing

`src/routes.tsx` is a data router, and three things in it are structural:

- **The guard and the shell hang off a pathless layout route.** `/login` and `/refer/*` are plain
  siblings of it, not exceptions carved out of a shell that wraps everything, which is what makes
  adding the public referral flow a pure addition rather than a refactor.
- **The catch-all `*` route is required.** The origin answers an unknown path with `index.html` and
  HTTP 200, so there is no server 404 to fall back on. See
  [`deployment-topology.md`](./deployment-topology.md).
- **Routing uses the data router; fetching does not.** No route loaders — every request goes through
  a TanStack Query hook, because the two mechanisms share no cache, no auth path and no retry policy.
  That decision is written down in `routes.tsx` itself, where somebody would otherwise add a
  `loader:`.

**No route is role-guarded.** A team lead who types an admin URL makes the request and gets a `403`,
which is rendered as a plain explanation. The server's check on the signed token is the only one that
means anything, and a client-side route guard would only hide the fact.

## The tsconfig split

Four projects, and the split is a **hard requirement rather than organisation**: the browser and the
Workers runtime both declare `Request`, `Response` and `fetch` with different shapes, and a project
that sees both produces errors saying `Request` is not assignable to `Request`.

| Project                | Owns                                            | Types           |
| ---------------------- | ----------------------------------------------- | --------------- |
| `tsconfig.json`        | nothing — references the others                 | —               |
| `tsconfig.app.json`    | `src/` (minus `src/worker`), `test/`            | DOM, no Node    |
| `tsconfig.node.json`   | Vite/Vitest config, `scripts/`, `test/tooling/` | Node            |
| `tsconfig.worker.json` | `src/worker/`, including its tests              | Workers, no DOM |

`tsconfig.app.json` **names its `types` explicitly**. Left unset, TypeScript pulls in every
`@types/*` package it can reach — including the 551 KB `worker-configuration.d.ts`. That is the whole
fix, and it is why `test/tooling/` (which uses `node:fs` and the ESLint API) lives in the Node
project: keeping it out of the app project is what stops `process` becoming reachable from a
component.

**`npm run typecheck` is `tsc -b`, not `tsc --noEmit`.** With project references, `--noEmit` only
checks the solution root, which contains no files — it would pass while checking nothing.

## Lint rules that carry weight

Five rules in `eslint.config.js` exist to make rules enforceable rather than remembered, and
`test/tooling/eslint-rules.test.ts` asserts each still fires — **a lint rule that stops working fails
open, and nothing else would notice.**

- `localStorage` and `sessionStorage` are banned outright.
- `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` are banned outside
  `src/lib/london-time.ts`, because they silently format in the device's timezone.
- `src/api/client`, `src/api/auth-fetch` and `src/api/schema` may only be imported from `src/api/**`,
  `src/auth/**` and a feature's `queries.ts`.
- `src/worker/**` and the rest of `src/**` may not import each other. The two tsconfig projects stop
  the types mixing; this stops the code mixing, and fails at the import rather than at a build.
- `jsx-a11y`, which is pinned past its declared eslint peer range — hence the test.

Those rule messages quote `CLAUDE.md` section names that this document now holds. The rules
themselves are unchanged.
