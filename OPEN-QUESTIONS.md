# Client open questions

Unresolved questions about this application's screens, interactions, or browser-side privacy
boundaries. The server's [`OPEN-QUESTIONS.md`](../foodbankserver/OPEN-QUESTIONS.md) holds domain,
data-retention, and API questions instead.

**Only Pete answers these.** An answer belongs in [`screenDetails.md`](./screenDetails.md) when it
settles a screen requirement, and the entry is then deleted in the same change. Never renumber or
reuse a question number: existing call sites and documents name these questions by number.

---

## Q38 — How far back should a team leader be able to open a completed session?

This answer will also set the bounded lookback used by the dashboard's alert for sessions from previous weeks that are not completed.

`Status: open` · `Raised by: client` · `Blocks: nothing — the date box reaches as far back as somebody types, which is the guess`

The Run a session list now offers completed sessions behind a `Show completed` checkbox, so a team
leader can look back at one: who attended, what each household was given, and — through the link
that has always been on that screen — the session's listener sheet, which is the one printed page in
the system that may carry a reason for referral.

Nothing about the permissions changed, and that is the point. `GET /sessions/{id}` and every
pick-list route are deliberately uncapped for a team lead (`API.md`, "Not capped, and settled that
way"), and `GET /sessions` caps only the far end — a team lead has always been able to list the
sessions just gone, with no lower bound at all. What changed is that there is now a screen that
walks somebody there. Before this, a completed session was not on any list a team leader could see,
so reaching one meant already holding its id.

The client bounds its own default at a fortnight back, which is a guess about what somebody
plausibly needs, not a rule. The date box is a plain date box: typing 2024 in it lists 2024.

What the charity should know before deciding:

- **The horizon that exists is about planning, not about privacy.** Six days ahead stops a team lead
  reading next month's rota; it was never meant to say anything about the past, and it does not.
- **The sensitive page is the listener sheet.** Attendance and parcel contents are operational. A
  reason for referral can mean domestic abuse or immigration status, and it is on that sheet for the
  session's trained listeners on the day — which is not obviously the same thing as being on it for
  anybody running a session two years later.
- **There is a real reason to look back.** Outcomes are recorded after the event, a query about a
  household's last parcel is ordinary, and a session that was signed off wrongly is worth being able
  to examine. A short window would cut those off too.
- **Three shapes of answer.** No limit, which is what the code does now. A limit on the whole
  screen, so a completed session older than some period is simply not listed and not openable. Or a
  limit on the listener sheet alone, leaving attendance and pick lists readable indefinitely while
  the reasons stop being reachable — which would need the server to refuse
  `GET /sessions/{id}/listener-sheet` past that age for a team lead, since a client-side rule is not
  a control.

**Question for the charity:** how far back should a team leader be able to open a completed session
and read its listener sheet — indefinitely, or only for some period after the session? And if there
is a limit, does it apply to the whole session or only to the reasons for referral?

**A:**

---
