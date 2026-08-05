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
configured**, which is `OPEN-QUESTIONS.md` Q2 and only Pete can close. Two related questions are also
open: Q12 (may any answers survive a purge) and Q17, raised by this repo (does a purge clear
`reasonId`, `referrerEmail` and `referrerPhone`, or only the referee's own fields). This client's
purged-referral rendering is written to be correct either way.

## Printing

Reason for referral **never appears on anything printable**, not even for an admin, because sheets get
carried round halls and left on tables.

The referee's **name** goes on every sheet — reversed deliberately on 2026-08-05, because a volunteer
handing a bag over needs to know it is the right one. Nothing else about them does unless
`isDelivery` is true, where the address is the entire point of the sheet and a driver who cannot find
the door needs to ring. The rules and the test that must exist are in
[`.claude/rules/printing.md`](../../.claude/rules/printing.md).
