# Project status

What exists, what is waiting on configuration, what is deliberately unresolved, and what is not
built. Kept here rather than in `CLAUDE.md` so it can be corrected without touching the operating
instructions.

Screen requirements live in [`screenDetails.md`](./screenDetails.md), domain requirements in
`../foodbankserver/INITIAL_SPEC1.txt`, unanswered product questions in
`../foodbankserver/OPEN-QUESTIONS.md`. Things that are built but **less proven than the test count
suggests** are in [`KNOWN-GAPS.md`](./KNOWN-GAPS.md); things with a known answer and no work done are
in [`DEFERRED-WORK.md`](./DEFERRED-WORK.md).

`npm run check` is green at 81 test files and 673 tests.

---

## Implemented

| Slice                         | What landed                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a — toolchain**            | Vite, React, TypeScript with the four-project split, eslint and Prettier matching the server, Vitest with jsdom and MSW, generated API types.                                                                                                                                                                                                                                      |
| **1b — deployment topology**  | `wrangler.jsonc`, the proxy Worker and its tests, `tsconfig.worker.json`, `cf-typegen` and `dry-run` in `check`. `npm run dev` runs the real proxy against the server's `wrangler dev`.                                                                                                                                                                                            |
| **2 — API layer and auth**    | `src/api/` (both clients, token store, single-flight `auth-fetch`, cross-tab `refresh-lock`, `unwrap`, query client), `src/lib/errors.ts`, `src/auth/` (provider, `RequireAuth`, `?next=` validation, session start/restore/end), sign-in screen.                                                                                                                                  |
| **3 — app shell and routing** | `src/routes.tsx` as a data router, `src/auth/menu.ts`, the shared components in `src/components/`, the home screen. The `@media print` frame already lives in `app-shell.module.css`.                                                                                                                                                                                              |
| **3b — users**                | `/users`, `/users/new`, `/users/:userId`; `ConfirmDialog`; the first `london-time` helpers; `test/render-app.tsx`. **The slice that unblocks role testing** — the only way to create a team lead.                                                                                                                                                                                  |
| **3c — public probe**         | `/refer` against the first two unauthenticated endpoints. **Superseded by slice 11**, which turned it into the real form.                                                                                                                                                                                                                                                          |
| **4 — stock**                 | One `stockKeys` root for the whole module: levels at `/stock`, a page-at-a-time weekly stock take, and admin-only item maintenance under `/stock/items`.                                                                                                                                                                                                                           |
| **5 — sessions**              | `/sessions`, `/sessions/new`, `/sessions/:sessionId` and the three `/sessions/recurring*` screens. Create, amend and cancel; weekly-template maintenance; the ops call that materialises sessions without waiting for the cron.                                                                                                                                                    |
| **6 — model parcels**         | `/model-parcels*` and the thirty-cell household grid at `/model-parcels/grid`, saved whole. Create, amend, delete, and a preview of what a household size receives.                                                                                                                                                                                                                |
| **7 — referrers and reasons** | `src/features/admin-setup/`: `/referrers*` and `/referral-reasons*`. Authorise by exact address or domain; add, amend and retire a reason.                                                                                                                                                                                                                                         |
| **8 — referral form machine** | `referral-form-definition.ts`, `referral-form-schema.ts`, `referral-answers.logic.ts`, `referral-form-guards.ts`. **Machinery only — no screen, no route.**                                                                                                                                                                                                                        |
| **9 — referral maintenance**  | `/referrals` (filterable by session and status) and `/referrals/:referralId` — fixed fields, amend, move with an over-capacity warning, cancel. `NotBuiltYet` deleted with its last caller. Answers became editable a page at a time later, reusing `ReferralQuestionField` rather than growing a second hand-written form.                                                        |
| **10 — the real questions**   | `referral-form.config.json` — the charity's 43 questions over 7 pages — with `referral-form-config.ts`, `referral-key-fields.ts`, `referral-form.logic.ts`, `referral-submission.logic.ts`, `referral-answer-keys.frozen.ts` and `lib/postcode.ts`.                                                                                                                                |
| **11 — the referral flow**    | `/refer` takes referrals: seven pages driven by the config, the confirmation, and the review queue on `/referrals*`. Split name, date of birth, fuel help, `pending_review`/`rejected`, accept and reject with a one-line comment. **Turnstile is still outstanding.**                                                                                                             |
| **12 — running a session**    | `src/features/pick-lists/`: `/run-sessions`, the per-household workspace at `/run-sessions/:sessionId/clients/:parcelId`, pick-list reconciliation with the maintained preference rules, the printed picking sheets, `POST /sessions/{id}/confirm`, and attendance — where stock actually moves.                                                                                   |
| **13 — the other two sheets** | The listener sheet at `/run-sessions/:sessionId/listener`, the only printed page that may carry a reason for referral, and the session referral-details sheet beside it. Both are separate API responses, which is what keeps every other referral field off them.                                                                                                                 |
| **14 — text messages**        | The SMS panel on a run-session screen — reminders, per-household conversations, replies — and `/sms/unmatched` for replies from a number no referral matches.                                                                                                                                                                                                                      |
| **15 — fuel help**            | `/fuel-help` and the `fuel_admin` role, whose whole application this is. Columns are chosen by the referral form's `forFuelTeam` marker rather than a second list of keys.                                                                                                                                                                                                         |
| **16 — extract and search**   | `/extracts` sends confirmed sessions to the charity's Google spreadsheet, a claim at a time, with the hidden key row that lets new answers become new columns. `/referrals/search` finds a household by date of birth, postcode or phone, and each row carries the causes and the administrator notes; `/preference-rules` validates the rule configuration against the catalogue. |

**All seventeen menu destinations route to a real screen.** The role split is enforced as data in
`src/auth/menu.ts` and tested in `src/auth/menu.test.ts`.

The stock take is available to a team lead or administrator at `POST /stock/take`; levels and item
maintenance retain their existing role split, with only the item list admin-only.

The rationale behind the structural decisions in these slices — which is the part worth keeping — is
in [`docs/engineering/data-fetching.md`](./docs/engineering/data-fetching.md),
[`docs/engineering/referral-form.md`](./docs/engineering/referral-form.md) and
[`docs/architecture/`](./docs/architecture/).

---

## Implemented but awaiting configuration or verification

**None of these is a gap in the code.**

| Item                             | State                                                                                                                                                                         | What it needs                                                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purged-referral rendering**    | Built and tested: `piiPurgedAt` renders as _purged_, never as a blank screen or the string `undefined`. Server-side the purge job runs nightly and **purges nothing**.        | `PII_RETENTION_DAYS=365` on the server. **Q2 is closed** — the period is settled at twelve months — and setting the variable is now a deployment step rather than a question. Nothing here changes when it is. |
| **The three deploy-time checks** | Cannot be proved by any test here, and all three fail silently. Rate limiting and `Set-Cookie` pass-through were confirmed **locally**; per-IP _partitioning_ never has been. | A deployed pair. See [`docs/operations/deploy-verification.md`](./docs/operations/deploy-verification.md).                                                                                                     |
| **The cross-tab refresh lock**   | Written against `navigator.locks` with a fallback and a timeout, but **has never run against a real `LockManager`** — jsdom has none, so tests exercise the fallback path.    | A browser-based test, or a manual two-tab check.                                                                                                                                                               |
| **The responsive nav**           | Built; untested.                                                                                                                                                              | A test. In `KNOWN-GAPS.md`.                                                                                                                                                                                    |

---

## Deliberately unresolved — only Pete closes these

Tracked in `../foodbankserver/OPEN-QUESTIONS.md`, which is the single home for both repos. **Do not
answer one, including one this repo raised.**

**This table mirrors `OPEN-QUESTIONS.md` and is not the authority.** If the two disagree, that file
is right and this one is stale — check it before relying on a row here.

| #       | Question                                                                     | What this client does meanwhile                                                                                                                              |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Q12** | May any form answers survive a purge?                                        | Treats `piiPurgedAt` as "all answers gone", matching what the server does today.                                                                             |
| **Q20** | What are the actual choices on six of the referral form's questions?         | Ships the guessed lists, marked at `referral-form-config.ts`.                                                                                                |
| **Q27** | When a referral is forgotten, is it anonymised or deleted?                   | Renders `piiPurgedAt` as _purged_; a deleted one would `404` and read "That no longer exists". Correct either way, which is why nothing here blocks.         |
| **Q29** | Does changing a parcel's contents after review take the review back?         | It does not — `reviewedAt` survives an edit, and the print gate reads it. That is the behaviour the question asks about, not an answer to it.                |
| **Q30** | Should the age-band counts become columns in the spreadsheet extract?        | The extract already writes both: `adults` and `children` as fixed columns, and every grid cell as `householdComposition.<band>.<gender>`.                    |
| **Q32** | Does forgetting a referral also clear its parcel's pick-list information?    | This client composes that note at generation and prints what was saved. Whether the purge reaches it is the server's to decide; nothing here assumes either. |
| **Q33** | Can a household be cancelled after they have already collected their parcel? | A parcel reading `attendance: "cancelled"` is filtered out of every list, gate and sheet by `isCurrentParcel`.                                               |

**Q2, Q14, Q15, Q16, Q17, Q18, Q19, Q21, Q22 and Q23 have all been closed** and are no longer in
`OPEN-QUESTIONS.md`. Two of their answers are load-bearing here and worth keeping: a referral
awaiting review **holds its place** on the session, and there is **no "accept and authorise this
referrer" button**, because whether that should write one address or a whole domain is not
derivable and guessing could authorise an entire council.

**Q16 was closed by the field disappearing.** It asked where a parcel's `dietaryNotes` came from
given no such field on the form; the answer is that the server removed it for exactly that reason,
and what a picker needs to be told now reaches the sheet as the parcel's `notes`, composed by this
client. See [`.claude/rules/printing.md`](./.claude/rules/printing.md).

---

## Not implemented

Tracked so it is not mistaken for finished work.

- **Automated questionnaire import and release workflow.** Before go-live, build W3 in
  `DEFERRED-WORK.md`: it must validate reviewed Sheet JSON, safely extend the immutable answer-key
  ledger, run the form checks and make the required client release explicit. Until then, a developer
  must integrate each questionnaire change manually.
- **Turnstile on the public referral form.** `/refer` takes referrals and submits them, but no
  widget exists. The server verifies a token whenever a secret is configured and refuses to boot in
  production without one, so **the form works in development and would be refused in production**.
  This is the last thing between the referral flow and going live. There is no edit-key window to
  build; it left the specification on 2026-08-05.
- **Google sign-in.** `dev-login` is the only path. The rejection path for an unknown email is
  already built, so the switch does not change the response shape.
- **The auth refresh contract catch-up.** `runRefresh` still signs the user out on any refresh
  failure, and the eight-hour sign-in cap has no handling anywhere. Low risk today because
  single-flight means the client rarely produces the `401` at all. `DEFERRED-WORK.md` W1.
- **Six small consistency and robustness points** across the SMS panel, the extract and
  `lib/errors.ts` — none of them a bug a volunteer would report, grouped so they can be done in one
  pass. `DEFERRED-WORK.md` W5.
