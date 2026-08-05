---
paths:
  - 'src/api/auth-fetch.ts'
  - 'src/api/refresh-lock.ts'
  - 'src/api/token-store.ts'
  - 'src/auth/**'
  - 'src/features/auth/**'
---

# Authentication rules

What the charity asked for is in `../foodbankserver/INITIAL_SPEC1.txt` under `#Login`. Full design,
trade-offs and the history behind each rule:
[`docs/architecture/authentication.md`](../../docs/architecture/authentication.md).

- **The access token lives in memory only.** Not `localStorage`, not `sessionStorage`, not a cookie
  you set — both storages are banned by a lint rule. Losing it on reload is fine. This app is one
  XSS away from names, addresses and reasons for referral.
- **Startup rebuilds state with `POST /auth/refresh`, never `GET /auth/me`.** `/me` sits behind
  `requireAuth`, so a cold reload can only `401` it; and refresh already returns the user
  **including `displayName`**, which `/me` does not. `/me` costs a round trip to learn less.
- **The boot runs exactly once per page load**, held by a module-level memo. StrictMode
  double-invokes effects, and without the memo the second one replays the first token and signs you
  out for reasons that look supernatural. A test that reuses the module graph proves nothing — reset
  it per test.
- **Boot is triggered by the route guard, not by `AuthProvider`'s mount.** The provider wraps the
  whole router so the sign-in screen can use it, but refreshing on mount would fire a pointless
  `POST /auth/refresh` for every unauthenticated referrer who opens `/refer`. Structural, not an
  optimisation: it is what keeps the public referral flow independent of auth.
- **Refresh exactly once, and never in parallel — including across tabs.** Each refresh rotates the
  token and a rotated token is spent. In one tab: hold the in-flight promise in a module-level
  variable, queue concurrent `401`s behind it, retry each original request once. Across tabs:
  serialise with **`navigator.locks`** (no dependency needed), fall back to the in-process promise
  where Web Locks are missing (older browsers, jsdom) rather than crashing, and **give the lock a
  timeout** — a lock is held until its callback settles, so a hung network would wedge every tab at
  once.
- **A `403` is never refreshed.** It is a role problem, and refreshing on it loops.
- **This belongs in `auth-fetch.ts` and `refresh-lock.ts` and nowhere else.** A retry written at a
  call site is how the concurrent-refresh bug gets in.
- **A sign-in lasts eight hours from sign-in, and refresh never extends it.** The replacement token
  inherits the expiry of the one it replaced, so a `401` from `/auth/refresh` means those eight hours
  are up or the cookie is gone. There is no idle timeout and no "keep me signed in" to offer.
- **Never read or write the refresh cookie from JavaScript.** It is `HttpOnly` and scoped to
  `/api/v1/auth`, so it is not attached to any domain request — which is what stops a CSRF against
  `/api/v1/referrals` having anything to ride on.
- Today's login is `POST /auth/dev-login` with any known email. When Google auth arrives the response
  shape does not change; an unknown email starts being rejected. **Treat `401` from login as "not a
  known user" now**, with the same message as a bad credential.

**The code does not yet match the last two rules.** `runRefresh` still signs the user out on any
refresh failure, and the eight-hour cap has no handling anywhere. Believe this file over the code and
over any comment in `auth-fetch.ts` still arguing from revoked token families. See `DEFERRED-WORK.md`
W1 — it is priority-one code and wants its own change with its own tests.
