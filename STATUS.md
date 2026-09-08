# Project status

What exists, what is waiting on configuration, what is deliberately unresolved, and what is not
built. Kept here rather than in `CLAUDE.md` so it can be corrected without touching the operating
instructions.

Screen requirements live in [`screenDetails.md`](./screenDetails.md), domain requirements in
`../foodbankserver/INITIAL_SPEC1.txt`, client questions in [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md),
and unresolved server/domain questions in `../foodbankserver/OPEN-QUESTIONS.md`. Things that are built but **less proven than the test count
suggests** are in [`KNOWN-GAPS.md`](./KNOWN-GAPS.md); things with a known answer and no work done are
in [`DEFERRED-WORK.md`](./DEFERRED-WORK.md).

`npm run check` is green at 117 test files and 1131 tests.

---

## Implemented

| Slice                         | What landed                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a — toolchain**            | Vite, React, TypeScript with the four-project split, eslint and Prettier matching the server, Vitest with jsdom and MSW, generated API types.                                                                                                                                                                                                                                                                                                              |
| **1b — deployment topology**  | `wrangler.jsonc`, the proxy Worker and its tests, `tsconfig.worker.json`, `cf-typegen` and `dry-run` in `check`. `npm run dev` runs the real proxy against the server's `wrangler dev`.                                                                                                                                                                                                                                                                    |
| **2 — API layer and auth**    | `src/api/` (both clients, token store, single-flight `auth-fetch`, cross-tab `refresh-lock`, `unwrap`, query client), `src/lib/errors.ts`, `src/auth/` (provider, `RequireAuth`, `?next=` validation, session start/restore/end), sign-in screen.                                                                                                                                                                                                          |
| **3 — app shell and routing** | `src/routes.tsx` as a data router, `src/auth/menu.ts`, the shared components in `src/components/`, the home screen. The `@media print` frame already lives in `app-shell.module.css`.                                                                                                                                                                                                                                                                      |
| **3d — dashboard**            | `/` now shows role-appropriate referral, session and attention summaries, Sunday–Saturday session ranges, paged table actions and persistent shortcut tabs. The client relies on `Session.deliveryBooked` and `StockItem.lowStockThreshold`.                                                                                                                                                                                                               |
| **3b — users**                | `/users`, `/users/new`, `/users/:userId`; `ConfirmDialog`; the first `london-time` helpers; `test/render-app.tsx`. **The slice that unblocks role testing** — the only way to create a team lead.                                                                                                                                                                                                                                                          |
| **3c — public probe**         | `/refer` against the first two unauthenticated endpoints. **Superseded by slice 11**, which turned it into the real form.                                                                                                                                                                                                                                                                                                                                  |
| **4 — stock**                 | One `stockKeys` root for the whole module: levels at `/stock`, a page-at-a-time weekly stock take, and admin-only item maintenance under `/stock/items`.                                                                                                                                                                                                                                                                                                   |
| **5 — sessions**              | `/sessions`, `/sessions/new`, `/sessions/:sessionId` and the three `/sessions/recurring*` screens. Create, amend and cancel; weekly-template maintenance; the ops call that materialises sessions without waiting for the cron.                                                                                                                                                                                                                            |
| **6 — model parcels**         | `/model-parcels*` and the thirty-cell household grid at `/model-parcels/grid`, saved whole. Create, amend, delete, and a preview of what a household size receives.                                                                                                                                                                                                                                                                                        |
| **7 — referrers and reasons** | `src/features/admin-setup/`: `/referrers*` and `/referral-reasons*`. Authorise by exact address or domain; add, amend and retire a reason.                                                                                                                                                                                                                                                                                                                 |
| **8 — referral form machine** | `referral-form-definition.ts`, `referral-form-schema.ts`, `referral-answers.logic.ts`, `referral-form-guards.ts`. The config-driven machinery used by Slice 11's public referral screen.                                                                                                                                                                                                                                                                   |
| **9 — referral maintenance**  | `/referrals` (filterable by session and status) and `/referrals/:referralId` — fixed fields, amend, move with an over-capacity warning, cancel. `NotBuiltYet` deleted with its last caller. Answers became editable a page at a time later, reusing `ReferralQuestionField` rather than growing a second hand-written form. Copying a referral that came to nothing onto another session came later still, with the household's outcome beside the status. |
| **10 — the real questions**   | `referral-form.config.json` — the charity's 43 questions over 7 pages — with `referral-form-config.ts`, `referral-key-fields.ts`, `referral-form.logic.ts`, `referral-submission.logic.ts`, `referral-answer-keys.frozen.ts` and `lib/postcode.ts`.                                                                                                                                                                                                        |
| **11 — the referral flow**    | `/refer` takes referrals: seven pages driven by the config, the confirmation, and the review queue on `/referrals*`. Split name, date of birth, fuel help, `pending_review`/`rejected`, accept and reject with a one-line comment. Turnstile came later, on the last page, and is present only where a sitekey is configured.                                                                                                                              |
| **12 — running a session**    | `src/features/pick-lists/`: `/run-sessions`, the per-household workspace at `/run-sessions/:sessionId/clients/:parcelId`, pick-list reconciliation with the maintained preference rules, the printed picking sheets, `POST /sessions/{id}/confirm`, attendance — where stock actually moves — and the stock check panel, which compares what the session's reviewed pick lists ask for against what is on the shelves.                                     |
| **13 — the other two sheets** | The listener sheet at `/run-sessions/:sessionId/listener`, the only printed page that may carry a reason for referral, and the session referral-details sheet beside it. Both are separate API responses, which is what keeps every other referral field off them.                                                                                                                                                                                         |
| **14 — text messages**        | The SMS panel on a run-session screen — reminders, per-household conversations, replies — and the administrator SMS inbox as two tabs: Session messages at `/sms` (active and closed sessions, with the household's name) and Loose messages at `/sms/unmatched` (no referral behind them, phone number and a prefilled referral search).                                                                                                                  |
| **15 — fuel help**            | `/fuel-help` and the `fuel_admin` role, whose whole application this is. Columns are chosen by the referral form's `forFuelTeam` marker rather than a second list of keys.                                                                                                                                                                                                                                                                                 |
| **16 — extract and search**   | `/extracts` sends confirmed sessions to the charity's Google spreadsheet, a claim at a time, with the hidden key row that lets new answers become new columns. `/referrals/search` finds a household by date of birth, postcode or phone, and each row carries the causes and the administrator notes; `/preference-rules` validates the rule configuration against the catalogue.                                                                         |
| **17 — target stock lists**   | `src/features/target-stock-lists/`: the named standing target lists an admin maintains at `/stock/target-lists*`, and `/stock/shopping` where a team lead picks one and gets the buy list — target minus current stock, positive only, grouped by category, printed landscape or copied. Renamed / retired / missing reconciliation is client-side; the buy list joins the list to `GET /stock/levels`. Contract settled (server Q44–Q48).                 |
| **18 — Christmas vouchers**   | `/voucher-config` under Master Data maintains the voucher dates. Referral review opens the dedicated first-time review screen, using existing previous-referral matches to save a previous session or no previous referral. Run a session receives only the `First time`/`Admin` marker; printed pick lists receive only the live voucher instruction.                                                                                                     |

**All twenty-one menu destinations route to a real screen.** The role split is enforced as data in
`src/auth/menu.ts` and tested in `src/auth/menu.test.ts`.

The stock take is available to a team lead or administrator at `POST /stock/take`; levels and item
maintenance retain their existing role split, with only the item list admin-only. A team lead or
admin can also mint a stock-take volunteer code at `/stock/volunteer-code`; a no-account volunteer
then counts at `/count` (no shell, no sign-in) authenticating on an `X-Volunteer-Code` header held
in memory only — `src/api/volunteer-code-store.ts`, `src/api/auth-fetch.ts`.

The rationale behind the structural decisions in these slices — which is the part worth keeping — is
in [`docs/engineering/data-fetching.md`](./docs/engineering/data-fetching.md),
[`docs/engineering/referral-form.md`](./docs/engineering/referral-form.md) and
[`docs/architecture/`](./docs/architecture/).

---

## Implemented but awaiting configuration or verification

**None of these is a gap in the code.**

| Item                             | State                                                                                                                                                                                   | What it needs                                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purged-referral rendering**    | Built and tested: `piiPurgedAt` renders as _purged_, never as a blank screen or the string `undefined`. Server-side the purge job runs nightly and **purges nothing**.                  | `PII_RETENTION_DAYS=365` on the server. **Q2 is closed** — the period is settled at twelve months — and setting the variable is now a deployment step rather than a question. Nothing here changes when it is. |
| **The three deploy-time checks** | Cannot be proved by any test here, and all three fail silently. Rate limiting and `Set-Cookie` pass-through were confirmed **locally**; per-IP _partitioning_ never has been.           | A deployed pair. See [`docs/operations/deploy-verification.md`](./docs/operations/deploy-verification.md).                                                                                                     |
| **The cross-tab refresh lock**   | Written against `navigator.locks` with a fallback and a timeout, but **has never run against a real `LockManager`** — jsdom has none, so tests exercise the fallback path.              | A browser-based test, or a manual two-tab check.                                                                                                                                                               |
| **The responsive nav**           | Built; untested.                                                                                                                                                                        | A test. In `KNOWN-GAPS.md`.                                                                                                                                                                                    |
| **The blue/grey control style**  | One global style in `src/index.css` draws every button in the app; `test/tooling/button-styles.test.ts` stops a screen drawing its own. **No screen has been seen in a browser since.** | A look at a real screen. jsdom evaluates no CSS, so nothing in the suite renders it. In `KNOWN-GAPS.md`.                                                                                                       |

---

## Deliberately unresolved — only Pete closes these

Server/domain questions are tracked in `../foodbankserver/OPEN-QUESTIONS.md`; client screen and
browser questions are tracked in [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md). **Do not answer one,
including one this repo raised.**

**This table mirrors the server's `OPEN-QUESTIONS.md` and is not the authority.** Client questions
are not listed here. If the two disagree, the server file is right and this one is stale — check it
before relying on a row here.

| #       | Question                                                                     | What this client does meanwhile                                                                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q12** | May any form answers survive a purge?                                        | Treats `piiPurgedAt` as "all answers gone", matching what the server does today.                                                                                                                                                 |
| **Q20** | What are the actual choices on six of the referral form's questions?         | Ships the guessed lists, marked at `referral-form-config.ts`.                                                                                                                                                                    |
| **Q27** | When a referral is forgotten, is it anonymised or deleted?                   | Renders `piiPurgedAt` as _purged_; a deleted one would `404` and read "That no longer exists". Correct either way, which is why nothing here blocks.                                                                             |
| **Q29** | Does changing a parcel's contents after review take the review back?         | It does not — `reviewedAt` survives an edit, and the print gate reads it. That is the behaviour the question asks about, not an answer to it.                                                                                    |
| **Q30** | Should the age-band counts become columns in the spreadsheet extract?        | The extract already writes both: `adults` and `children` as fixed columns, and every grid cell as `householdComposition.<band>.<gender>`.                                                                                        |
| **Q32** | Does forgetting a referral also clear its parcel's pick-list information?    | This client composes that note at generation and prints what was saved. Whether the purge reaches it is the server's to decide; nothing here assumes either.                                                                     |
| **Q33** | Can a household be cancelled after they have already collected their parcel? | A parcel reading `attendance: "cancelled"` is filtered out of every list, gate and sheet by `isCurrentParcel`.                                                                                                                   |
| **Q36** | Should copying a referral twice onto the same session be prevented?          | **Answered — not to be restricted.** Awaiting the server's close, which owns the entry. Nothing here changes: the copy button keeps its own double-click guard, which it would need either way.                                  |
| **Q41** | When is the session's stock check meant to be read?                          | **Settled both ways.** The API moved to this screen's gate — every parcel reviewed — and Pete settled on 2026-08-17 that a completed session does not offer the check at all. Awaiting the server's close, which owns the entry. |

**Q2, Q14, Q15, Q16, Q17, Q18, Q19, Q21, Q22 and Q23 have all been closed** and are no longer in
`OPEN-QUESTIONS.md`. Two of their answers are load-bearing here and worth keeping: a referral
awaiting review **holds its place** on the session, and an administrator can accept a referral and
authorise that referrer's **exact email address** at the same time. The approval screen requires an
organisation for this new authorised-referrer entry rather than guessing one.

**Q16 was closed by the field disappearing.** It asked where a parcel's `dietaryNotes` came from
given no such field on the form; the answer is that the server removed it for exactly that reason,
and what a picker needs to be told now reaches the sheet as the parcel's `notes`, composed by this
client. See [`.claude/rules/printing.md`](./.claude/rules/printing.md).

---

## Not implemented

Tracked so it is not mistaken for finished work.

- **A production Turnstile widget, and its secret.** The client half is built:
  `src/features/referrals/turnstile.ts` and `TurnstileCheck` put the check on the last page of
  `/refer` and send `cf-turnstile-response`, and both halves are inert where no sitekey is
  configured, which is local development. What is not done is deployment configuration — a widget
  for **production** (the test one, `foodbank-referral-test`, covers
  `foodbank-client.losttemple.workers.dev` and `localhost` only) and `TURNSTILE_SECRET_KEY` on each
  deployed server. The charity has accepted Cloudflare Turnstile running inside the referral form;
  that acceptance is recorded in `docs/engineering/personal-data.md`.
- **Google sign-in.** `dev-login` is the only path. The rejection path for an unknown email is
  already built, so the switch does not change the response shape.
