# Client open questions

Unresolved questions about this application's screens, interactions, or browser-side privacy
boundaries. The server's [`OPEN-QUESTIONS.md`](../foodbankserver/OPEN-QUESTIONS.md) holds domain,
data-retention, and API questions instead.

**Only Pete answers these.** An answer belongs in [`screenDetails.md`](./screenDetails.md) when it
settles a screen requirement, and the entry is then deleted in the same change. Never renumber or
reuse a question number: existing call sites and documents name these questions by number.

---

## Q38 — How far back should a team leader be able to open a completed session?

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

## Q42 — Has the charity accepted that Cloudflare's bot check runs inside the public referral form?

`Raised: 2026-08-20` · `Raised by: foodbankclient, building Turnstile into /refer`

**This is not a question about whether to use Turnstile.** That is settled: the server verifies a
token on `POST /public/referrals` and refuses to boot in production without a secret. The question is
narrower, and it is one only the charity can answer.

`.claude/rules/pii-security.md` says the charity's acceptance of the spreadsheet extract "covers
`/extracts` and nothing else; anything new that sends data off-origin needs its own". The extract's
acceptance was recorded on 14 August 2026 in `docs/engineering/personal-data.md`, deliberately,
because "an undocumented sign-off is indistinguishable from no sign-off six months later". When
this question was raised, there was no equivalent record for Turnstile.

What the charity would be accepting:

- **A Cloudflare script runs in the page a referrer is filling in.** The widget loads
  `https://challenges.cloudflare.com/turnstile/v0/api.js`, which has the same access to that page as
  the food bank's own code — and that page holds a household's name, address, phone number and
  reason for needing food, as it is typed. This is inherent to any bot check that runs in a browser;
  the mitigation available is a CSP `script-src` naming that origin, and nothing else.
- **Turnstile collects signals about the visitor's browser** in order to decide whether they are a
  person. It is not sent the form's contents by this client — the token travels as a request header
  and the answers never go near it — but the script is in the page and could see them.
- **It is a condition of submitting.** Unlike the extract, which an administrator chooses to run,
  every referrer meets this, including one referring a household in an emergency.

The alternative to accepting it is not "no bot check": it is a different mechanism on the only
unauthenticated write in the system, which is rate-limited but otherwise open to anyone.

**Question for the charity:** do you accept that Cloudflare's bot-check script runs inside the public
referral form, on the same terms as Google's identity script on the extract screen — and should that
acceptance be recorded in `docs/engineering/personal-data.md` alongside it?

**A:**

Yes. The charity accepts Turnstile running in the public referral form and its processing of the
visitor/browser/network data needed for bot protection. This does not mean Cloudflare receives the
referral fields: the client sends it no form contents, and Cloudflare documents that Turnstile does
not access, store or transmit form entries or other page inputs. The script nevertheless runs in the
same page and therefore has the technical ability to read them; the charity accepts reliance on
Cloudflare's documented behaviour. This acceptance is recorded in
`docs/engineering/personal-data.md`.
