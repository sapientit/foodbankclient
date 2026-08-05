# Food Bank Client

The React frontend for the food bank system: a public referral form, an admin back office, and the
screens a team lead uses to run a session — pick lists, printing, attendance.

**The API is a separate repository at `../foodbankserver`.** It serves JSON only — no HTML, no SSR,
no PDF, so every screen, layout and printed sheet is this repo's job. `openapi.yaml`, `API.md` and
`OPEN-QUESTIONS.md` there are the whole channel between the two repos, by design. **Read the
server's docs; never read or modify the server's code.**

## Requirements come from the spec, not from the code

- **[`screenDetails.md`](./screenDetails.md) is the source of truth for client screen and
  interaction requirements.** **`../foodbankserver/INITIAL_SPEC1.txt` is the source of truth for the
  shared domain.** If code and spec disagree, ask rather than guess.
- **When Pete settles a screen requirement the spec does not cover, write it into `screenDetails.md`
  in the same change** — in the spec's voice, as what the charity wants, not what the code does. Edit
  the statement it changes; do not append a contradicting one. **A requirement decided in
  conversation and not written down did not happen.** Settled _domain_ requirements go in the
  server's spec — raise them there rather than starting a second copy here.
- **Unanswered product questions go in `../foodbankserver/OPEN-QUESTIONS.md`**, deliberately the
  single home for both repos, which already covers client screens. **Never answer an entry yourself,
  including one this repo raised. Only Pete closes one** — two assistants agreeing about what a food
  bank wants is the same guess written twice. Answer questions about _what the API does_ freely;
  refuse to invent _what the charity wants_.
- **When you cannot avoid guessing, mark the guess**: an `OPEN-QUESTIONS.md` entry, plus a comment
  naming it at the code it touches. (No `openapi.yaml` here, so no `x-assumed` of its own — the
  server marks the contract, this repo marks the call site.) The danger is never the guess; it is
  that a guess reads exactly like a requirement six weeks later.

## Commands

| Task           | Command                                                        |
| -------------- | -------------------------------------------------------------- |
| Run locally    | `npm run dev` (:5173, with the proxy Worker)                   |
| Type check     | `npm run typecheck` — `tsc -b`, **not** `--noEmit`             |
| Lint / format  | `npm run lint` · `npm run format` (`:fix`, `:check`)           |
| Test           | `npm test` (`test:watch`, `test:coverage`)                     |
| Regenerate     | `npm run api:types` · `npm run cf-typegen`                     |
| **Everything** | `npm run check` (`build`, `dry-run` and `deploy` are separate) |

**`npm run check` must pass before any change is considered done. Do not weaken a rule to make it
pass.** It needs no Cloudflare credentials. One test: `npx vitest run <file>` or `-t '<name>'`.
Anything real needs the API running: in `../foodbankserver`, `npm run db:migrate:local && npm run
dev` (:8787). First sign-in and the build layout's footguns are in [`README.md`](./README.md).

## Stack

Keep it small — every dependency ships to a volunteer's phone on a hall's wifi. **Vite + React +
TypeScript** (SPA, no SSR) · **React Router** in data-router mode · **TanStack Query** for
everything from the API · **React Hook Form + Zod** · **openapi-fetch** over the generated types ·
**Vitest + React Testing Library + MSW** · plain **CSS Modules**.

**There is no state management library and there should not be one:** server state is TanStack
Query's, the rest is the current user and a URL. Before adding a dependency, prefer the platform
(`Intl`, `fetch`, `URL`, `crypto.randomUUID`, modern CSS), say why it beats writing it, and check it
is maintained. Tokens, personal data and crypto need sign-off; anything sending data off-origin needs
the charity's, not just a technical one.

## Architecture

`src/api/` (generated schema, both clients, auth-fetch, query-client) · `src/auth/` · `src/lib/`
(pure helpers) · `src/components/` (genuinely shared UI only) · `src/routes.tsx` ·
`src/worker/index.ts` (the proxy Worker — Workers types, **not** DOM types) · and
`src/features/<area>/`, one folder per domain area mirroring the server's modules, each with
`keys.ts`, `queries.ts`, `*.logic.ts`, `components/` and its tests.

**Dependencies point inwards: `components → queries.ts → api/`. Nothing goes the other way.**

- **Components do not call `fetch`.** They call a hook from `queries.ts`. Anything else bypasses
  auth, the retry policy and the cache. A lint rule enforces the import boundary.
- **Query keys are structured and exported from the feature that owns them.** No inline string keys
  — an invalidation that misses is a screen showing yesterday's data. A feature may import another
  feature's `keys.ts` or `queries.ts`, never its components.
- **Pure logic lives in `lib/` or a `*.logic.ts`, with no React import.** Those are the cheapest and
  most valuable tests here, and they only exist if the code is written to allow them.
- **`src/worker/` and the rest of `src/` share no code** and compile against different globals.

Full layout, the four-project tsconfig split and the lint rules that carry weight:
[`docs/architecture/project-structure.md`](./docs/architecture/project-structure.md).

## Non-negotiables

- **The access token lives in memory only** — never `localStorage`, `sessionStorage` or a cookie you
  set. Startup rebuilds state with `POST /auth/refresh`, never `GET /auth/me`. Refresh is
  single-flight and cross-tab serialised, in `auth-fetch.ts` / `refresh-lock.ts` and nowhere else.
- **Never persist referral data** — no form draft between the form's pages, no cache persistence, no
  service worker. **Never put personal data in a URL**; ids only. Never `console.log` a referral, a
  named parcel or a form payload. **No third-party analytics, error reporting or session replay
  without asking first.** A referrer cannot amend after submitting; there is no edit key.
- **Roles drive menus, never access.** Routes are not role-guarded; the server's check on the signed
  token is the only one that means anything. A team lead does not receive `reasonId`,
  `referrerEmail`, `referrerPhone` or `reviewComment` — the fields are **absent, not `null`**. Never
  `!` them away.
- **Never print the reason for referral.** The name goes on every sheet; the address, postcode and
  phone only when `isDelivery`.
- **`Europe/London` is the only local timezone.** Display `startTime`; sort and filter on
  `startsAtUtc`; never send `startsAtUtc`.
- **`409` and `422` show the server's `message`** — the one useful sentence sent, which a generic
  "Something went wrong" throws away. Never retry a `4xx`.
- **`src/api/schema.d.ts` is generated.** Hand-written request or response interfaces are a bug.

Each has a scoped rule file in [`.claude/rules/`](./.claude/rules/) with the detail, loaded
automatically when you touch the files it governs, and linking the reasoning in `docs/`.

## TypeScript and conventions

- The strictness set (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`)
  is intentional. Never loosen it; never add a `@ts-expect-error` or `eslint-disable` without a
  comment saying why it is unavoidable. No `any`, no `!`, no unchecked casts: `unknown` at the
  boundary, a precise type after parsing. **Erasable syntax only** — no `enum`, `namespace`,
  decorators or parameter properties; union types and `as const` instead.
- **Imports are extensionless here**, unlike the server's `.ts` specifiers — a deliberate divergence;
  do not "fix" either repo to match the other. Quantities are integers, never floats. Files
  `kebab-case.ts(x)`; components and types `PascalCase`; values `camelCase`; hooks `useThing`.
  Comments explain _why_. No dead code, no speculative abstraction — git remembers.
- **Use the server's domain words** — session, recurring session, referral, household, parcel, pick
  list, stock item, attendance, referrer, model parcel, grid. "Client", "order", "basket" and
  "template" all mean something else here.
- **Accessibility is not optional**: labelled inputs, visible focus, keyboard-reachable everything,
  errors associated with their fields, real contrast.

## Testing

**Every behaviour change ships with a test; bug fixes start with a failing test.** MSW against the
generated types, so a fixture that no longer matches the contract fails to compile. Test what the
user does — by role and label, not test id — and unit-test the pure logic directly. Priorities, being
where a bug means a household goes hungry or private information is exposed: the auth interceptor,
the print view, attendance, role-based rendering. Two harness defaults can quietly make an assertion
vacuous — see [`.claude/rules/testing.md`](./.claude/rules/testing.md).

## How to work here

- **Investigate before editing.** Read the relevant code and docs first; this codebase has several
  rules whose reasons are not visible from the call site.
- **Plan briefly** for anything substantial or cross-module, and say what you are about to do.
- **Delegate to subagents proactively** — see below. Keep architecture, requirement interpretation,
  integration and final verification in the main context.
- **Do not refactor what you were not asked to.** Scope creep in a repo with this many invariants is
  how one of them gets lost.
- **Review the final diff, then run `npm run check`.** Report the files you changed, the verification
  you ran, and what you are still unsure about. Never report a task complete on an unverified
  assumption.

## Subagents

**Delegate without being asked.** The agents in [`.claude/agents/`](./.claude/agents/) carry this
repo's rules; use them by default rather than waiting to be told.

| Agent                      | Use it for                                                              |
| -------------------------- | ----------------------------------------------------------------------- |
| **Explore** (built in)     | Broad read-only investigation — where something lives, how it is done   |
| **implementation-worker**  | A bounded, routine change following an existing pattern                 |
| **test-writer**            | A regression test, behavioural coverage, or a suspect vacuous test      |
| **reviewer**               | Independent review after a substantial, risky or cross-feature change   |
| **accessibility-reviewer** | Meaningful screen, form, navigation, dialog, responsive or print change |
| **client-state-reviewer**  | Auth, query hooks, caching, invalidation, retry, cross-tab, the proxy   |

The three reviewers have disjoint scopes and run **in parallel**. A new screen that fetches data
wants all three; a pure CSS change wants only `accessibility-reviewer`.

**Stays here, in the main context:** requirement interpretation, anything touching `screenDetails.md`
or the server's `OPEN-QUESTIONS.md`, architecture, cross-feature integration, and the final
`npm run check`.

- Delegate only what you can state as a bounded objective with completion criteria.
- Give each agent the context and file scope it needs — it starts cold and cannot see this
  conversation.
- Run independent investigations and reviews in parallel; never let two editing agents touch
  overlapping files at once.
- **Review what comes back.** A subagent's report is evidence, not a result — read the diff.
- Subagents do not commit, push or deploy, and do not touch `../foodbankserver`.
- Do it yourself when the change is one file and briefing would cost more than the work.

## Where everything is

| Looking for                               | Go to                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| What the charity wants, on screen         | [`screenDetails.md`](./screenDetails.md)                                             |
| What the charity wants, in the domain     | `../foodbankserver/INITIAL_SPEC1.txt`                                                |
| Unanswered product questions              | `../foodbankserver/OPEN-QUESTIONS.md` — **only Pete closes one**                     |
| The API contract                          | `../foodbankserver/API.md`, `../foodbankserver/openapi.yaml`                         |
| What is built, configured, or outstanding | [`STATUS.md`](./STATUS.md)                                                           |
| Less proven than the tests suggest · owed | [`KNOWN-GAPS.md`](./KNOWN-GAPS.md) · [`DEFERRED-WORK.md`](./DEFERRED-WORK.md)        |
| Build layout, scripts, first sign-in      | [`README.md`](./README.md)                                                           |
| Why a rule is a rule                      | [`docs/`](./docs/) — linked from the rule file for each area                         |
| Go-live checks only a human can do        | [`docs/operations/deploy-verification.md`](./docs/operations/deploy-verification.md) |
