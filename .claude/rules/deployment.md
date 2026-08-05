---
paths:
  - 'src/worker/**'
  - 'wrangler.jsonc'
  - 'vite.config.ts'
  - 'tsconfig.worker.json'
---

# Deployment and proxy Worker rules

This Worker serves the built SPA and proxies `/api/*` to the API over a service binding, so the
client and the API are **one origin**. Forced by the API's `SameSite=Strict` refresh cookie, not a
preference. Full reasoning:
[`docs/architecture/deployment-topology.md`](../../docs/architecture/deployment-topology.md).

- **Forward the request unmodified, and return the response unmodified.** The API rate-limits on
  `cf-connecting-ip` and verifies Turnstile from the same request. Rebuilding it with a fresh
  `Headers` — the obvious tidy-up — drops both and turns per-IP limiting into per-datacentre limiting
  on an open, unauthenticated write.
- **`Set-Cookie` must pass through untouched, and paths must not be rewritten.** The cookie's
  `Path=/api/v1/auth` matches only because the proxy keeps the `/api/v1` prefix.
- **Keep the `ASSETS` branch.** `run_worker_first: ["/api/*"]` makes it unreachable in production, but
  it is the whole of the Worker's correctness if that setting is ever removed, and it serves assets
  under `vite dev`. Deleting it leaves a Worker that 404s the app.
- **`not_found_handling: "single-page-application"` means an unknown path returns `index.html` with
  HTTP 200.** There is no server 404 to fall back on, so the router's catch-all `*` route at the end
  of `src/routes.tsx` is required. **Do not remove it.**
- **Wrangler environments do not inherit top-level keys** — repeat every binding in full under
  `env.production`.
- **The environment is chosen at build time by `CLOUDFLARE_ENV`**, not by `--env` on the deploy.
  `wrangler deploy --env production` against a default build is accepted silently and deploys the
  default bindings, which is exactly the wrong failure.
- **`assets.directory` is not set in `wrangler.jsonc`** — the vite plugin overwrites it in the
  generated config, so a hand-written value is silently ignored.
- **`src/worker/` and the rest of `src/` may not import each other**, enforced by a lint rule as well
  as by the tsconfig split. The browser and the Workers runtime declare `Request`, `Response` and
  `fetch` with different shapes, and a project that sees both produces errors saying `Request` is not
  assignable to `Request`.
- **Use `localhost`, not `127.0.0.1`,** for anything the browser sees. They are different hosts, so
  mixing them makes requests cross-site and reintroduces the bug the proxy exists to avoid.

**Three things no test in this repo can prove, all of which fail silently.** Do them by hand the
first time the proxy is deployed and again whenever the Worker changes:
[`docs/operations/deploy-verification.md`](../../docs/operations/deploy-verification.md).
