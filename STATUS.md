# Project status

What exists, what is waiting on configuration, what is deliberately unresolved, and what is not
built. Kept here rather than in `CLAUDE.md` so it can be corrected without touching the operating
instructions.

Screen requirements live in [`screenDetails.md`](./screenDetails.md), domain requirements in
`../foodbankserver/INITIAL_SPEC1.txt`, unanswered product questions in
`../foodbankserver/OPEN-QUESTIONS.md`. Things that are built but **less proven than the test count
suggests** are in [`KNOWN-GAPS.md`](./KNOWN-GAPS.md); things with a known answer and no work done are
in [`DEFERRED-WORK.md`](./DEFERRED-WORK.md).

`npm run check` is green at 69 test files.

---

## Implemented

| Slice                         | What landed                                                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a — toolchain**            | Vite, React, TypeScript with the four-project split, eslint and Prettier matching the server, Vitest with jsdom and MSW, generated API types.                                                                                                                          |
| **1b — deployment topology**  | `wrangler.jsonc`, the proxy Worker and its tests, `tsconfig.worker.json`, `cf-typegen` and `dry-run` in `check`. `npm run dev` runs the real proxy against the server's `wrangler dev`.                                                                                |
| **2 — API layer and auth**    | `src/api/` (both clients, token store, single-flight `auth-fetch`, cross-tab `refresh-lock`, `unwrap`, query client), `src/lib/errors.ts`, `src/auth/` (provider, `RequireAuth`, `?next=` validation, session start/restore/end), sign-in screen.                      |
| **3 — app shell and routing** | `src/routes.tsx` as a data router, `src/auth/menu.ts`, the shared components in `src/components/`, the home screen. The `@media print` frame already lives in `app-shell.module.css`.                                                                                  |
| **3b — users**                | `/users`, `/users/new`, `/users/:userId`; `ConfirmDialog`; the first `london-time` helpers; `test/render-app.tsx`. **The slice that unblocks role testing** — the only way to create a team lead.                                                                      |
| **3c — public probe**         | `/refer` against the first two unauthenticated endpoints. **Superseded by slice 11**, which turned it into the real form.                                                                                                                                              |
| **4 — stock**                 | One `stockKeys` root for the whole module: levels at `/stock`, hand adjustment, the shop, the stock take, and admin-only item maintenance under `/stock/items`.                                                                                                        |
| **5 — sessions**              | `/sessions`, `/sessions/new`, `/sessions/:sessionId` and the three `/sessions/recurring*` screens. Create, amend and cancel; weekly-template maintenance; the ops call that materialises sessions without waiting for the cron.                                        |
| **6 — model parcels**         | `/model-parcels*` and the thirty-cell household grid at `/model-parcels/grid`, saved whole. Create, amend, delete, and a preview of what a household size receives.                                                                                                    |
| **7 — referrers and reasons** | `src/features/admin-setup/`: `/referrers*` and `/referral-reasons*`. Authorise by exact address or domain; add, amend and retire a reason.                                                                                                                             |
| **8 — referral form machine** | `referral-form-definition.ts`, `referral-form-schema.ts`, `referral-answers.logic.ts`, `referral-form-guards.ts`. **Machinery only — no screen, no route.**                                                                                                            |
| **9 — referral maintenance**  | `/referrals` (filterable by session and status) and `/referrals/:referralId` — fixed fields, read-only answers, amend, move with an over-capacity warning, cancel. `NotBuiltYet` deleted with its last caller.                                                         |
| **10 — the real questions**   | `referral-form.config.json` — the charity's 43 questions over 7 pages — with `referral-form-config.ts`, `referral-key-fields.ts`, `referral-form.logic.ts`, `referral-submission.logic.ts`, `referral-answer-keys.frozen.ts` and `lib/postcode.ts`.                    |
| **11 — the referral flow**    | `/refer` takes referrals: seven pages driven by the config, the confirmation, and the review queue on `/referrals*`. Split name, date of birth, fuel help, `pending_review`/`rejected`, accept and reject with a one-line comment. **Turnstile is still outstanding.** |

**All twelve menu destinations route to a real screen.** The role split is enforced as data in
`src/auth/menu.ts` and tested in `src/auth/menu.test.ts`.

Verified against a running server rather than assumed: a team lead gets `200`/`201` on
`/stock/search`, `GET|POST /stock/takes`, the count and commit routes and `POST /stock/purchases`,
`200` on `/stock/levels`, `204` on `/stock/adjustments`, and `403` on `POST /stock/items`. Only the
item list is admin-only.

The rationale behind the structural decisions in these slices — which is the part worth keeping — is
in [`docs/engineering/data-fetching.md`](./docs/engineering/data-fetching.md),
[`docs/engineering/referral-form.md`](./docs/engineering/referral-form.md) and
[`docs/architecture/`](./docs/architecture/).

---

## Implemented but awaiting configuration or verification

**None of these is a gap in the code.**

| Item                             | State                                                                                                                                                                         | What it needs                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Purged-referral rendering**    | Built and tested: `piiPurgedAt` renders as _purged_, never as a blank screen or the string `undefined`. Server-side the purge job runs nightly and **purges nothing**.        | `PII_RETENTION_DAYS` on the server. That is **Q2**, and it blocks going live.                              |
| **The three deploy-time checks** | Cannot be proved by any test here, and all three fail silently. Rate limiting and `Set-Cookie` pass-through were confirmed **locally**; per-IP _partitioning_ never has been. | A deployed pair. See [`docs/operations/deploy-verification.md`](./docs/operations/deploy-verification.md). |
| **The cross-tab refresh lock**   | Written against `navigator.locks` with a fallback and a timeout, but **has never run against a real `LockManager`** — jsdom has none, so tests exercise the fallback path.    | A browser-based test, or a manual two-tab check.                                                           |
| **The responsive nav**           | Built; untested.                                                                                                                                                              | A test. In `KNOWN-GAPS.md`.                                                                                |

---

## Deliberately unresolved — only Pete closes these

Tracked in `../foodbankserver/OPEN-QUESTIONS.md`, which is the single home for both repos. **Do not
answer one, including one this repo raised.**

| #       | Question                                                                         | What this client does meanwhile                                                                  |
| ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Q2**  | How long is personal data kept?                                                  | Renders a purged referral correctly; the purge itself is dormant server-side.                    |
| **Q12** | May any form answers survive a purge?                                            | Treats `piiPurgedAt` as "all answers gone", matching what the server does today.                 |
| **Q14** | Does the team lead's six-day horizon stop them _opening_ a session further out?  | `useSessions` sends no `from`/`to` for either role; the token carries the horizon.               |
| **Q15** | Does a team lead ever need to see a model parcel or the household grid?          | Menu entries are admin-only; no route is role-guarded, so the server's `403` is the real answer. |
| **Q16** | Where does a parcel's `dietaryNotes` come from, given no such field on the form? | Nothing generates parcels here yet. The printing rules already require showing it.               |
| **Q17** | Does a purge clear `reasonId`, `referrerEmail` and `referrerPhone`?              | The purged notice is written to be correct either way.                                           |

**The referral form's real questions have arrived** and are in `referral-form.config.json`. Six of
them ship with a guessed list of choices — that is **Q20**, and the guess is marked at
`referral-form-config.ts`. **Q18** (does a referral awaiting review hold a session place?) and
**Q19** (does a team lead see one?) are this slice's other two.

**Q18 and Q19 are answered and built:** a referral awaiting review **holds its place** on the
session, and a team lead sees pending referrals marked but never a rejected one. **Q21, Q22 and Q23**
are the server's, all about the review screen, and none of them blocks — the four-status model
satisfies everything the screens need today. **Q22 is why there is no "accept and authorise this
referrer" button**: whether that should write one address or a whole domain, and under which
organisation name, is not derivable, and guessing could authorise an entire council.

---

## Not implemented

Tracked so it is not mistaken for finished work.

- **Turnstile on the public referral form.** `/refer` takes referrals and submits them, but no
  widget exists. The server verifies a token whenever a secret is configured and refuses to boot in
  production without one, so **the form works in development and would be refused in production**.
  This is the last thing between the referral flow and going live. There is no edit-key window to
  build; it left the specification on 2026-08-05.
- **Pick lists, printing and attendance.** No `src/features/pick-lists/` exists. This is the largest
  remaining area and the rules for it are already written down in
  [`.claude/rules/printing.md`](./.claude/rules/printing.md), including the two that are safety
  controls rather than layout: never print the reason for referral, and print the address, postcode
  and phone only when `isDelivery`.
- **`POST /sessions/{id}/confirm`.** Deliberately out of scope of the sessions slice; it belongs with
  attendance.
- **The referral answers editor.** Answers are read-only on the detail screen. Now that a referrer
  cannot amend their own referral, an administrator editing one on their behalf is a real
  requirement — and it should reuse `ReferralQuestionField` rather than growing a second
  hand-written form.
- **Google sign-in.** `dev-login` is the only path. The rejection path for an unknown email is
  already built, so the switch does not change the response shape.
- **The auth refresh contract catch-up.** `runRefresh` still signs the user out on any refresh
  failure, and the eight-hour sign-in cap has no handling anywhere. Low risk today because
  single-flight means the client rarely produces the `401` at all. `DEFERRED-WORK.md` W1.
