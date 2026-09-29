# Known gaps and residual risk

Things that are built but less proven than the green test run suggests, and things a
test cannot prove at all. Written down because they were discovered during
implementation and would otherwise live only in someone's memory.

The system is in use on the test deployment, so anything ordinary use would expose
has been dropped from this file. What remains is **high impact and obscure enough
that testing is unlikely to stumble on it**. `npm run check` passing does **not**
mean these are covered. Delete an entry when it stops being true.

---

## Untested because the environment cannot test it

**The cross-tab refresh lock has never run against a real `LockManager`.**
`src/api/refresh-lock.ts` is the thing that stops two tabs refreshing at once and
tripping the server's token-family replay detection, which signs the user out
everywhere. jsdom ships no Web Locks, so **every test exercises the fallback
path**, and the production path is covered only by a hand-written fake. A real
implementation could differ, most likely in what an abort does after a grant.

It needs two tabs acting at the same moment after the access token has lapsed, which
ordinary use rarely does. Verify by hand: sign in, open a second tab, let the fifteen
minutes lapse, then act in both at once. Nobody should be signed out. Check in Safari
and Firefox as well as Chrome.

**Nothing proves a screen reader announces the referral form's refusal.** When
the food bank refuses a submission, `public-referral-screen.tsx` moves the
referrer to page one, moves focus to the progress paragraph, and mounts
`ErrorNotice` — a `role="alert"` — carrying the reason. A focus move onto
changed text, an assertive region and a polite one all land in one paint, and
NVDA, JAWS and VoiceOver order those differently. **The failure to look for is a
referrer who hears "Page 1 of 7" and never hears why they were sent there** —
they would be looking at a form that appears to have thrown their work away.
Needs a real screen reader; if it is wrong, give the notice a focus target and
land focus on it instead.

## The referral form's key-reuse guard cannot catch its most dangerous failure

`reusedKeys` in `referral-form-guards.ts` fires when a retired key is reused
under a **different type**, because a type mismatch is the one thing a machine
can check. It cannot fire when a key is reused for a same-typed question with a
different meaning — copying an existing question as a starting point and
forgetting to change the key — and stored answers would then be read under the
new question's meaning. Repeated here because it is the kind of limit that is
easy to forget once the function exists and appears to be "the" safety net.

## Decided, and will look like a bug

Pete's decisions, kept so a future review does not re-raise them.

**Referrals submitted before 2026-08-15 hold `adults` and `children` under the
old definition** (18 or over / under 18, rather than 12 or over / the 5–11 band),
and nothing recalculates them, so an older referral sizes its parcel by the old
rule. Pete decided on 2026-08-15 to leave them: a backfill would have to
reinterpret the retained `Household Components` answer, and anything already
picked was picked to the numbers on the sheet.

**Recording attendance does not invalidate stock queries.** `useRecordAttendance`
invalidates `pickListKeys.all` and `sessionKeys.all` but not `stockKeys`, so stock
screens can show pre-attendance figures for up to the 60s `staleTime`. Pete decided
on 2026-09-14 this is fine. The run-session stock-check panel is a separate,
always-fresh endpoint.

**Amending a referral's address or phone does not invalidate the session's
referral-details sheet.** `useAmendReferral` invalidates `referralKeys` and
`sessionKeys` but not `pickListKeys`, so an open referral-details screen can carry
the old detail for up to a minute. Pete decided on 2026-09-14 this is an acceptable
risk.

## Deploy-time check only a human can do

Also in `docs/operations/deploy-verification.md`, with the sixteen-minute session
and `Set-Cookie` checks that ordinary use of the test deployment now covers.

- [ ] **Per-IP rate limiting partitions by address through the proxy.** Limiting
      is proven to happen (sixty calls a minute, locally), not that a _second_
      address keeps its own budget. If the Worker ever rebuilds the request,
      everyone behind one Cloudflare datacentre shares a single budget on the
      public referral form — which one tester will never see and a busy morning
      of referrers will.
