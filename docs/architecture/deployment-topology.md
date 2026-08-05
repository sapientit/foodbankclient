# Deploy as one origin, not two

This is the first architectural decision in the repo and it is **forced by the server, not a
preference**. The mandatory rules distilled from it are in
[`.claude/rules/deployment.md`](../../.claude/rules/deployment.md); this file is why they exist.

## The forcing constraint

The refresh cookie is `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. **A browser will not
send a `SameSite=Strict` cookie on a cross-site request.** So if the client is served from a
different site than the API, refresh silently fails and every user is signed out fifteen minutes
after logging in.

Worse, it works perfectly in testing, because nobody sits on one screen for fifteen minutes.

`*.workers.dev` is on the Public Suffix List, which means `foodbank-client.workers.dev` and
`foodbank-server-production.workers.dev` are **different sites**. The obvious deployment is the
broken one.

So: this Worker serves the built SPA and proxies `/api/*` to the server over a service binding.
Everything is same-origin, which also means no CORS, no preflights, and no `ALLOWED_ORIGINS` to
maintain. (The server does carry an allowlist CORS middleware, applied app-wide; with no origins
configured it emits nothing, which is the correct same-origin behaviour. It stays unused as long as
this topology holds.)

## Why the Worker is tiny

It lives in `wrangler.jsonc` and `src/worker/index.ts`. Both are short and both are commented, and
neither is reproduced here — a copy would drift. The reasoning, which will not:

**Forward the request unmodified.** The server rate-limits on `cf-connecting-ip` and verifies
Turnstile from the same request. Rebuilding it with a fresh `Headers` throws that away and turns
per-IP limiting into per-datacentre limiting. A broken rate limit on an open, unauthenticated write
is not a subtle problem.

**`Set-Cookie` must pass through untouched**, and the cookie's `Path=/api/v1/auth` already matches
this layout because the proxy keeps the `/api/v1` prefix. Do not rewrite paths.

**`run_worker_first: ["/api/*"]`** means only the API path costs a Worker invocation, and it makes
the `ASSETS` branch unreachable in production. Keep that branch: it is what makes the Worker correct
if the setting is ever removed, and it is what serves assets in dev.

**`not_found_handling: "single-page-application"`** makes deep links like `/sessions/:id` work, and
has a consequence: an unknown path returns `index.html` with HTTP 200. The router carries its own
catch-all 404 route because of it — the `*` entry at the end of `src/routes.tsx`.

**Wrangler environments do not inherit top-level keys** — repeat every binding in full under
`env.production`. The server's `wrangler.jsonc` has the same duplication for the same reason. With
the vite plugin the environment is selected at **build** time by `CLOUDFLARE_ENV`; `--env` on
`wrangler deploy` is accepted and silently ignored. The emitted build layout, and the three
consequences found the hard way, are in [`README.md`](../../README.md).

## Local development

`npm run dev` runs the same Worker via `@cloudflare/vite-plugin`, and the `API` service binding
resolves to the server's `wrangler dev` through wrangler's dev registry — the registry matches on
deployed script name, which is why the binding target differs per environment (`foodbank-server` at
top level, `foodbank-server-production` under `env.production`). The browser only ever sees
`http://localhost:5173`, so the cookie behaves exactly as it will in production.

**Use `localhost`, not `127.0.0.1`,** for anything the browser sees. They are different hosts, so
mixing them makes requests cross-site and reintroduces the bug this whole document exists to avoid.

If the binding stops resolving, the usual cause is a wrangler version mismatch between the two repos
— check `npx wrangler --version` in both before anything else.

If refresh works in Chrome but not another browser locally, suspect `Secure` over plain HTTP:
`localhost` is treated as a trustworthy origin by some browsers and not others.

## The alternative, and why it is not the choice

A custom domain also works, because same registrable domain is same-site: app on
`foodbank.example.org`, API on `api.foodbank.example.org`. That needs the server's `ALLOWED_ORIGINS`
set and credentialed CORS on every request.

**Prefer the proxy.** If you ever switch, never use a wildcard origin — the API sends a cookie, so
`*` cannot work, and the "fix" is always to reflect whatever `Origin` arrives, which is no policy at
all.
