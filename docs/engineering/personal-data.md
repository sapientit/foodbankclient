# Personal data on the client

The enforceable rules are in [`.claude/rules/pii-security.md`](../../.claude/rules/pii-security.md).
This file is why they are the rules.

## What is actually at stake

A referral holds a name, an address, a postcode, two phone numbers, a household composition and a
**reason for needing food**. That reason can mean financial hardship, domestic abuse, or immigration
status. The people whose data this is did not choose to be in a database, and most of them will never
see this application.

The same rules apply as on the server, and they bind harder here, because a browser has more places
to leak into: storage, history, referrers, extensions, crash reporters, and a console that somebody
left open.

## Why each rule is shaped the way it is

**No third-party analytics, error reporting or session replay without asking first.** A stack trace or
a replay from the referral form ships somebody's name, address and reason for referral to a company
the charity has no agreement with. This is a data-protection question before it is a technical one,
so it needs the charity's sign-off, not an engineer's. If error reporting is ever added it must scrub
request bodies, form state and URLs, **and that scrubbing needs a test** — an unverified scrubber is
worse than none, because it is trusted.

**Never persist referral data.** No `localStorage` draft of the form, no query-cache persistence, no
service-worker caching of API responses. TanStack Query's in-memory cache is fine; anything written
to disk is not. A shared laptop in a church hall is the normal deployment, not the edge case.

**Never put personal data in a URL.** Not a path, not a query string — ids only. URLs reach browser
history, `Referer` headers, and any log the request passes through. This is why the referrer check
puts the address in a `POST` body rather than a query string, and why that address is never logged.

**There is no referral edit key, and nothing may reintroduce one.** A referrer cannot amend or
withdraw after submitting (`screenDetails.md`, "After a referral is submitted"), so the credential
that authorised `GET|PATCH|DELETE` on one referral — that is, access to somebody's name and address —
no longer exists. The endpoints behind it are being removed too.

**A part-filled referral form is held in memory and nowhere else.** Seven pages on a phone is exactly
where somebody reaches for a draft in `localStorage`; losing the form on navigation is the correct
behaviour, and the screen warns before the last page rather than after.

**Do not `console.log` a referral, a parcel with a name on it, or a form payload.** Not even
temporarily. That is exactly the line that gets committed.

## Role visibility is a privacy control, not a UI preference

A team lead does not receive `reasonId`, `referrerEmail` or `referrerPhone` on a referral, because a
picker needs the household size and does not need to know why the household is in difficulty. **The
fields are absent, not `null`.**

The generated types make them optional. **Do not `!` them away** — that is the exact spot where a
non-null assertion does real damage, because it turns a deliberate omission into `undefined` on a
screen.

Gate the UI on **reading the object** (`Object.hasOwn(referral, 'reasonId')`), never on the signed-in
role from `useAuth`. The three fields are decided together by one role check in the server's response
mapper, so reading the object keeps the screen correct even if the client's idea of the role and the
server's ever disagree. It also means a team lead's screen never fetches the admin-only reasons
lookup at all, rather than fetching it and hiding the result.

## The retention purge

After a retention purge, `answers` comes back **empty** along with the identifying fields — the
server cannot tell which answers were personal, so it drops all of them. `piiPurgedAt` is how a
purged referral is told apart from one that genuinely answered nothing, and a screen must render that
state as _purged_ rather than as an empty section a volunteer would read as a bug.

The purge job exists and is scheduled server-side, but **purges nothing until a retention period is
configured**. The period itself is settled — twelve months — so what remains is a deployment step:
`PII_RETENTION_DAYS=365` on the server. Q12 is still open (may any answers survive a purge), as is
Q27 (when a referral is forgotten, is it anonymised or deleted) and Q32 (does forgetting also clear
its parcel's pick-list information). This client's purged-referral rendering is written to be correct
whichever way each falls.

## Printing

Reason for referral never appears on a picking sheet, not even for an admin, because those sheets get
carried round halls and left on tables. The listener sheet is the one deliberate exception: selected
listeners receive one sensitive, session-wide sheet for the non-delivery households the server
returned. **What is on it is chosen by the referral form's `forListenerSheet` marker**, so the
charity decides what a listener needs by marking the questionnaire rather than by anybody editing a
list in the screen. Its dedicated API response is still the access-control boundary — it sends the
name, the reason's label, the fuel flag and the answers, and nothing else can reach the page however
it is marked. Do not reuse that response for another screen.

The marker replaced a hard-coded key, and the reason is worth keeping: the key it looked for
(`Cause Details`) had been renamed in the questionnaire, so the column read "None given" on every
sheet of every session while the two questions the charity actually asks never appeared at all. A
list of answer keys held anywhere other than the form goes stale silently, and the failure looks like
a household who said nothing.

The referee's **name** goes on every sheet — reversed deliberately on 2026-08-05, because a volunteer
handing a bag over needs to know it is the right one. Nothing else about them does unless
`isDelivery` is true, where the address is the entire point of the sheet and a driver who cannot find
the door needs to ring. The rules and the test that must exist are in
[`.claude/rules/printing.md`](../../.claude/rules/printing.md).

## Sending household data off-origin: the spreadsheet extract

Everything above is about keeping personal data inside this system. `/extracts` deliberately sends
some of it out, to the charity's own Google spreadsheet, and it is the only thing in the client that
does.

**The charity has accepted this**, on 14 August 2026. It is recorded here because
[`.claude/rules/pii-security.md`](../../.claude/rules/pii-security.md) requires anything sending data
off-origin to have the charity's agreement rather than a technical one, and an undocumented sign-off
is indistinguishable from no sign-off six months later. What they accepted:

- **Household rows leave the system.** The extract writes the referral's fixed columns and its
  answers into a spreadsheet the charity owns and administers. The screen says so before it starts —
  "This sends household details outside this system" — and asks a second time before doing anything.
- **Google's identity script runs in an authenticated staff page.** `google-auth.ts` injects
  `https://accounts.google.com/gsi/client` to obtain a Sheets token. That script has the same access
  to the page as our own code, and the page holds referrals. This is inherent to browser OAuth and
  there is no meaningfully safer way to do it from a client; the mitigation available is a CSP
  `script-src` naming that origin, and nothing else.
- **The Google token is held in memory for the length of the run.** A `useRef`, never storage,
  cleared when the run finishes — the same rule as the API access token.

Two improvements that would tighten it and are not done: remove the injected `<script>` when the
screen unmounts, and call `google.accounts.oauth2.revoke()` on finish so the token is withdrawn
rather than merely dropped. Neither changes what the charity agreed to.

**This acceptance covers the spreadsheet extract and nothing else.** Analytics, error reporting and
session replay remain out without a fresh conversation — a stack trace from the referral form carries
somebody's name, address and reason for referral to a company the charity has no agreement with.
