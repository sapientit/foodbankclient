# Deploy-time verification

**Three things cannot be proved by any test in this repo, and all three fail silently.** Do them by
hand the first time the proxy is deployed, and again whenever `src/worker/index.ts` or
`wrangler.jsonc` changes.

The same checklist is tracked, with what has and has not been confirmed so far, in
[`KNOWN-GAPS.md`](../../KNOWN-GAPS.md) under "Deploy-time checks only a human can do". The reasoning
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

- **`TURNSTILE_SECRET_KEY` must be set**, and a Turnstile widget must exist in this client, before
  `POST /public/referrals` can be submitted from production. The server verifies a token whenever a
  secret is configured and **refuses to boot in production without one**; this client has no widget
  yet, because it has no submission yet. See [`STATUS.md`](../../STATUS.md).
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
