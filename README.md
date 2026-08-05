# Food Bank Client

The React frontend for the food bank system: a public referral form, an admin back office, and the
screens a team lead uses to run a session — pick lists, printing, attendance.

The API is a separate repository at `../foodbankserver` and serves JSON only. This app is deployed as
a Cloudflare Workers static-assets site with a tiny Worker (`src/worker/index.ts`) that proxies
`/api/*` to the server over a service binding, so the client and the API are **one origin**. That is
not a preference: the API's refresh cookie is `SameSite=Strict`, and `*.workers.dev` is on the Public
Suffix List, so two `workers.dev` hostnames would be two different sites and refresh would silently
fail. See [`docs/architecture/deployment-topology.md`](./docs/architecture/deployment-topology.md),
"Deploy as one origin, not two".

See [`CLAUDE.md`](./CLAUDE.md) for the architecture and the rules that matter, and
[`STATUS.md`](./STATUS.md) for what is actually built.

## Requirements

- Node 26 or newer
- `../foodbankserver` checked out alongside this repo, for `npm run api:types` and for local
  development

## Getting started

```bash
npm install
npm run cf-typegen        # writes worker-configuration.d.ts
npm run check             # must be green before anything is considered done
```

Then, in `../foodbankserver`:

```bash
npm run db:migrate:local
npm run dev               # :8787
```

and here:

```bash
npm run dev               # http://localhost:5173
```

## Scripts

| Command                   | Description                                                     |
| ------------------------- | --------------------------------------------------------------- |
| `npm run dev`             | Vite dev server on :5173, with the proxy Worker running         |
| `npm run build`           | `tsc -b && vite build` → `dist/`                                |
| `npm run preview`         | Serves the built output in workerd, via the plugin              |
| `npm run typecheck`       | `tsc -b` across every tsconfig project                          |
| `npm run lint`            | `eslint .` (`lint:fix` to autofix)                              |
| `npm run format:check`    | `prettier --check .` (`format` to write)                        |
| `npm test`                | `vitest run` (`test:watch`, `test:coverage`)                    |
| `npm run api:types`       | Regenerate `src/api/schema.d.ts` from the server's openapi.yaml |
| `npm run api:types:check` | Fail if that file is stale; skips when the API repo is absent   |
| `npm run cf-typegen`      | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc`    |
| `npm run dry-run`         | Build and validate the production deploy without uploading      |
| `npm run deploy`          | Build and deploy the `production` environment                   |
| `npm run check`           | Everything above that can fail — run before considering it done |

`check` needs no Cloudflare credentials: `wrangler types` reads `wrangler.jsonc` locally and
`--dry-run` never calls the API. Keep it that way.

`preview` serves whatever is already in `dist/`, and `check` leaves a **production** build there —
one whose `API` binding points at `foodbank-server-production` and will not resolve locally. Run
`npm run build` before `npm run preview`.

`npm run dev` uses `localhost`, never `127.0.0.1`, and `strictPort` is on. They are different hosts,
so mixing them makes requests cross-site and reintroduces the cookie bug the proxy exists to avoid.
If something else already holds :5173, free it rather than falling back to another port.

## The build layout

`@cloudflare/vite-plugin` runs two builds and owns the asset directory. What it actually emits:

```
dist/
  client/                     ← the assets. This is assets.directory.
    index.html
    .assetsignore
    assets/index-*.{js,css}
  foodbank_client/            ← named after the Worker, dashes to underscores
    index.js                  the bundled Worker
    wrangler.json             generated config, with "directory": "../client"
.wrangler/deploy/config.json  redirects wrangler to that generated config
```

Three consequences, each found the hard way:

- **`assets.directory` is not set in `wrangler.jsonc`.** A hand-written value is silently ignored —
  the plugin overwrites it with `../client` in the generated config. Setting one would only invite it
  to drift and mislead.
- **`wrangler deploy` needs a build first**, because `.wrangler/deploy/config.json` is what points it
  at the generated config. Without a build it falls back to `wrangler.jsonc` and fails on the missing
  `directory`. Both `deploy` and `dry-run` build first for this reason.
- **The wrangler environment is chosen at build time, by `CLOUDFLARE_ENV`** — not by `--env` on the
  deploy. `wrangler deploy --env production` against a default build is accepted silently and
  deploys the default bindings, which is exactly the wrong failure. Hence
  `CLOUDFLARE_ENV=production` in the `deploy` and `dry-run` scripts.

## Local development and the API

`npm run dev` runs the real proxy Worker inside Vite, and the `API` service binding resolves to the
server's `wrangler dev` through wrangler's dev registry. So `http://localhost:5173/api/v1/...` is
served by the local API, through the same code path as production: one origin, no CORS, the `/api/v1`
prefix intact and `Set-Cookie` passed straight back.

The registry matches on the deployed script name, so `wrangler.jsonc` binds to `foodbank-server` at
top level (the server's local name) and `foodbank-server-production` under `env.production`. If the
binding stops resolving, the usual cause is a wrangler version mismatch between the two repos —
check `npx wrangler --version` in both before anything else.

If refresh works in Chrome but not another browser locally, suspect `Secure` over plain HTTP:
`localhost` is treated as a trustworthy origin by some browsers and not others.

## Signing in for the first time

Logging in never creates an account. A freshly migrated database contains exactly one, from the
server's `migrations/0007_bootstrap-admin.sql`: **`pete@x.com`**. Any other address is a `401`, which
looks like a broken login and is not one.

To get a team lead — and therefore to see the partial menu at all — sign in as that admin, add a user
with the team lead role at **`/users`**, then sign in as them. `dev-login` takes only an email; the
name and role come from the `users` row, so there is nothing to pick on the sign-in screen.

In a development build that screen offers `pete@x.com` and `lead@x.com` as click-to-fill buttons,
from a literal list in source that writes nothing to disk. The second only works once an admin has
added it — there is deliberately no bootstrap migration for a team lead.
