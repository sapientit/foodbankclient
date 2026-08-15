---
paths:
  - 'src/features/referrals/**'
  - 'src/features/pick-lists/**'
  - 'src/api/query-client.ts'
  - 'src/api/token-store.ts'
  - 'src/lib/errors.ts'
  - 'src/auth/**'
---

# Personal data and security rules

Referrals hold names, addresses, phone numbers and a reason for needing food. The reason can mean
financial hardship, domestic abuse or immigration status. Background and the reasoning behind each
rule: [`docs/engineering/personal-data.md`](../../docs/engineering/personal-data.md).

The same rules as the server, and they bind harder here because a browser has more places to leak
into.

- **Never persist referral data.** No `localStorage` draft of the form, no query-cache persistence,
  no service-worker caching of API responses. TanStack Query's in-memory cache is fine; anything
  written to disk is not. `localStorage` and `sessionStorage` are banned outright by a lint rule.
- **Never put personal data in a URL** — not a path, not a query string. **Ids only.** URLs reach
  history, referrers and logs. An address checked against `POST /public/referrers/check` goes in the
  POST body, never in a URL, and is never logged.
- **There is no referral edit key any more**, and nothing may reintroduce one. A referrer cannot
  amend or withdraw after submitting; see
  [`.claude/rules/public-referral-flow.md`](./public-referral-flow.md).
- **The referral form holds nothing on disk between pages.** A seven-page wizard is exactly where
  somebody reaches for a draft in `localStorage`. In memory only, and losing the form on navigation
  is the correct behaviour.
- **`reviewComment` is admin-only**, like `reasonId`, `referrerEmail` and `referrerPhone`. It can
  name a referrer or record a suspicion. Same rule: absent, not `null`, and gated on
  `Object.hasOwn`.
- **Do not `console.log` a referral, a parcel with a name on it, or a form payload.** Not even
  temporarily — that is exactly the line that gets committed.
- **The spreadsheet extract is the one sanctioned way household data leaves this system**, and the
  charity accepted it on 2026-08-14 — including that Google's identity script runs in a page holding
  referrals. Recorded in
  [`docs/engineering/personal-data.md`](../../docs/engineering/personal-data.md). That acceptance
  covers `/extracts` and nothing else; anything new that sends data off-origin needs its own.
- **No third-party analytics, error reporting or session replay without asking first.** A stack trace
  or a replay from the referral form ships somebody's name, address and reason for referral to a
  company the charity has no agreement with. If error reporting is ever added it must scrub request
  bodies, form state and URLs, **and that scrubbing needs a test.**
- **A team lead does not receive `reasonId`, `referrerEmail` or `referrerPhone`. The fields are
  absent, not `null`.** The generated types make them optional; **do not `!` them away.** Gate the UI
  on reading the object (`Object.hasOwn(referral, 'reasonId')`), never on the signed-in role — that
  keeps the screen correct even if the two ever disagree. Render their absence without a hole in the
  layout and without the string `undefined` reaching the screen.
- **A purged referral must render as purged, not as an empty screen.** After a retention purge
  `answers` comes back empty along with the identifying fields; `piiPurgedAt` is how you tell that
  from a referral that genuinely answered nothing. An empty-looking section reads as a bug in the
  screen.

## Printing

- **Never print the reason for referral. Not even for an admin.** Sheets get carried round halls and
  left on tables. A test asserts the print payload cannot render a reason **even if the server sends
  one** — cheap, and it is the failure nobody would notice in review.
- **The referee's name goes on every sheet**, so a volunteer handing a bag over can tell it is the
  right one. That is a deliberate reversal of the older rule, decided by Pete on 2026-08-05 —
  `screenDetails.md`, "The printed picking sheet".
- **Nothing else about them, unless `isDelivery` is true.** Then the sheet says `DELIVERY` and
  carries the address, postcode and phone, where that is the entire point. **Never on a collection
  sheet.**
- Show the parcel's `notes` — the pick-list information — prominently: the picker is the only person
  in a position to act on it, and the alternative is a parcel the household cannot eat. It is a
  snapshot this client composed when the pick list was created, not the referral's live answers, so
  it is also the only place a marked answer is allowed onto paper. There is no `dietaryNotes`; see
  [`.claude/rules/printing.md`](./printing.md).
