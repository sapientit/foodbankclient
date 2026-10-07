# Deploy-time verification

**Three things cannot be proved by any test in this repo, and all three fail silently.** Do them by
hand the first time the proxy is deployed, and again whenever `src/worker/index.ts` or
`wrangler.jsonc` changes.

For the test system, run `deploy_foodbank` first. It runs both repositories'
checks before either deployment, checks that the generated client API types
match the server's `openapi.yaml`, deploys the server before the client, and
then confirms both deployed commit versions, server health/readiness, the client shell, and a public API read through
the deployed proxy. Those automatic checks are necessary but do not
replace the deployed-browser checks below.

## Automated client release gate

`deploy-foodbank-client` stages a client as a Cloudflare Worker Version before
it changes live traffic. The staged Version URL must return the just-built
`index.html`, the build's `client-version.json`, and every emitted static
asset. JavaScript and CSS are also required to have their correct MIME types.
This is essential because the SPA fallback otherwise answers a missing hashed
module with `index.html`, which looks like a successful HTTP response but the
browser rightly refuses to execute it.

Only a candidate that passes this external check is promoted to 100% traffic.
The helper retries a failed candidate once after a clean rebuild; if it still
fails, it exits without changing live traffic. Do not replace this with a
direct `wrangler deploy`, a percentage rollout, or a post-live smoke check.

The session and `Set-Cookie` checks are covered by ordinary use of the test deployment; the
rate-limit partitioning check is still open in [`KNOWN-GAPS.md`](../../KNOWN-GAPS.md). The reasoning
behind all three is in
[`docs/architecture/deployment-topology.md`](../architecture/deployment-topology.md).

## 1. The sixteen-minute session

Sign in on the deployed origin, leave the tab idle past the fifteen-minute access-token lifetime,
then do something that calls the API.

**It must succeed without a re-login.** This is the entire reason the proxy Worker exists, and the
only instrument is a clock. If it fails, the refresh cookie is not reaching `/api/v1/auth` — check
that the client and API really are same-site, and remember that two `*.workers.dev` hostnames are
not.

## 2. Per-IP rate limiting through the proxy

Drive an unauthenticated write (`POST /api/v1/public/referrals`) past its limit from one address and
confirm the `429`. **Then confirm a second address still has its own budget.**

The second address is the whole test. If the Worker ever rebuilds the request with a fresh `Headers`,
`cf-connecting-ip` is lost and everyone behind one Cloudflare datacentre shares a single budget on an
open write.

**Status:** that limiting _happens_ was confirmed locally — the 61st `GET /public/sessions` inside a
minute returns `429` through the proxy in `wrangler dev`. **Partitioning by address has never been
proven** and needs a deployed pair.

## 3. `Set-Cookie` byte-identical

Compare the header on `POST /api/v1/auth/dev-login` through the proxy against the API directly.
`Max-Age`, `Path=/api/v1/auth`, `HttpOnly`, `Secure` and `SameSite=Strict` must all survive
unaltered.

**Status:** confirmed locally through dev; not on a deployed pair.

## Before the first production deploy

Beyond this repo, and owned by the server:

- **`TURNSTILE_SECRET_KEY` must be set on each deployed server**, and the widget it belongs to must
  be the one whose sitekey that environment's build carries. The client half is built — the check is
  on the last page of `/refer` — and it is **inert wherever no sitekey is configured**, so a
  half-configured deployment is the dangerous one: a server with a secret and a client without a
  sitekey refuses every referral, and a client with a sitekey against a server without a secret
  accepts them unchecked. The account's workers.dev subdomain is `losttemple`; the test widget
  `foodbank-referral-test` covers `foodbank-client.losttemple.workers.dev` and `localhost` only, so
  **production needs its own widget** — a token minted against test must not verify against
  production, for the same reason the test deployment has its own database. See
  [`STATUS.md`](../../STATUS.md).
- **`PII_RETENTION_DAYS` is unset**, so the purge job runs nightly and purges nothing. That is
  `OPEN-QUESTIONS.md` Q2 and it **blocks going live with real data**. Only Pete closes it.
- The server's own go-live sequence is in `../foodbankserver/docs/operations/production.md`.

## Build-time footguns worth re-reading first

Full detail in [`README.md`](../../README.md); the two that cause a wrong deploy rather than a failed
one:

- **The wrangler environment is chosen at build time by `CLOUDFLARE_ENV`**, not by `--env`.
  `wrangler deploy --env production` against a default build is accepted silently and deploys the
  default bindings.
- **`wrangler deploy` needs a build first**, because `.wrangler/deploy/config.json` is what points it
  at the plugin's generated config. Both `deploy` and `dry-run` build first for this reason.
