# Authentication design

The enforceable rules are in [`.claude/rules/authentication.md`](../../.claude/rules/authentication.md).
This file is the reasoning behind them, including the parts that are only obvious once you have been
bitten.

## Why the token is in memory and nowhere else

A token in `localStorage` is readable by any injected script, and this app is one XSS away from
names, addresses and reasons for referral. So the access token lives in a module variable and is lost
on reload — which is fine, because the refresh cookie is what rebuilds the session.

`localStorage` and `sessionStorage` are banned by a lint rule rather than by memory, because this is
exactly the rule somebody breaks while debugging and then commits.

## Why boot refreshes rather than calling `/me`

`GET /auth/me` sits behind `requireAuth`. A cold reload has no token in memory, so `/me` can only
`401`, and you would then refresh anyway. And the refresh response already carries the user
**including `displayName`**, which `/me` does not return — it answers `{ id, email, role }` only. So
`/me` costs an extra round trip to learn less. It is for re-reading the current actor mid-session,
not for booting.

## Why boot is memoised, and why it hangs off the route guard

The boot runs **exactly once per page load**, held by a module-level memo. StrictMode double-invokes
effects, so without it the second effect fires a second refresh, the server sees the first token
replayed, and every development reload signs you out for reasons that look supernatural.
`src/auth/auth-provider.test.tsx` resets the module graph per test for the same reason: a test that
reused the memo would prove nothing.

The trigger is the **route guard, not `AuthProvider`'s mount**. The provider wraps the whole router
so the sign-in screen can use it, but refreshing on mount would fire a pointless `POST /auth/refresh`
for every unauthenticated referrer who opens `/refer`. That is structural rather than an
optimisation: it is what keeps the public referral flow independent of auth, and a test asserts
`/refer` issues no refresh.

## Why refresh is single-flight, in one tab and across tabs

Each refresh rotates the token, and a rotated token is spent: presenting it again gets a `401`.

- **In one tab:** hold the in-flight promise in a module-level variable, queue concurrent `401`s
  behind it, then retry each original request once.
- **Across tabs:** a module-level promise only covers one JS context. Two tabs reloading together are
  two contexts and both refresh. `navigator.locks` serialises them with no dependency, so the second
  tab waits and refreshes with the _new_ cookie, which is valid. Fall back to the in-process promise
  where Web Locks are missing (older browsers, jsdom) rather than crashing, and **give the lock a
  timeout** — a lock is held until its callback settles, so a hung network would otherwise wedge
  every tab of the app at once.

A `403` is never refreshed: it is a role problem, and refreshing on it loops.

All of this belongs in `auth-fetch.ts` and `refresh-lock.ts`. A retry written at a call site is how
the concurrent-refresh bug gets in.

## The eight-hour sign-in

A sign-in lasts eight hours **counted from when the user signed in**, and refresh never extends it:
the replacement refresh token inherits the expiry of the one it replaced. So a `401` from
`/auth/refresh` means those eight hours are up, or the cookie is gone, and the user really must sign
in again. There is no idle timeout and no "keep me signed in" to offer — there is nothing behind it.
The access token issued by the last refresh of a sign-in may be shorter than fifteen minutes, because
it is capped at the same instant.

## The contract changed under this code — believe the docs, not the comments

Until 31 July 2026 the contract said a replayed refresh token was treated as **theft**: it revoked the
whole token family and signed the user out everywhere. That hazard is the stated reason for both the
single-flight refresh and the cross-tab lock, and it is why `runRefresh` in `auth-fetch.ts` calls
`endSession()` on _any_ refresh failure and says so in its comment.

**The server now refuses a spent token and nothing more.** The sign-in carries on, and `API.md` says
in terms not to sign the user out on it but to retry with the cookie now held.

Nothing is broken today, because single-flight means the client rarely produces that `401` at all —
but the sign-out branch is more aggressive than the contract requires, and the eight-hour cap has no
handling anywhere, so a volunteer meeting it is bounced to the sign-in screen with a generic message.
`DEFERRED-WORK.md` W1 carries the work. **Keep the single-flight refresh and the cross-tab lock when
it lands**: their original justification is gone, but they remain correct.

## Never touch the refresh cookie from JavaScript

It is `HttpOnly` and scoped to `/api/v1/auth`, so it is not attached to any domain request. That is
what stops a CSRF against `/api/v1/referrals` having anything to ride on.

## Login today, and login when Google arrives

Today's login is `POST /api/v1/auth/dev-login` with any known email. When Google auth arrives the
response shape does not change — an unknown email simply starts being rejected. **Build the rejection
path now:** treat `401` from login as "not a known user", with the same message as a bad credential.

Logging in never creates an account, and `dev-login` takes only an email — the name and role come
from the `users` row, so a role picker on the sign-in screen would be a control that silently does
nothing. Getting a team lead account is a `/users` job; see [`README.md`](../../README.md).

## Roles drive menus, never access

Two roles: `admin` and `team_lead`. Use `role` to choose the menu and nothing else. The server
re-checks it on every request from the signed token, so someone editing `role` in devtools sees extra
menu items and gets `403` on all of them.

The menu lives in `src/auth/menu.ts` **as data** rather than as conditionals in the shell, so the
split is testable without rendering anything. `src/auth/menu.test.ts` enforces the table, including a
check that every entry points at a route which is not the catch-all 404.

The full role table is in `../foodbankserver/API.md` §2, which is the authority. The split that is
easy to get backwards: **moving stock is both roles; changing what stock items exist is admin only.**
A team lead does the shops, the stock takes and the corrections; only an admin maintains the item
list. Admins additionally create and amend sessions and referrals, maintain model parcels and the
grid, manage referrers, reasons and users, and **see why someone was referred**.

There is no form maintenance screen — the referral form is this application's configuration, not
server data.
