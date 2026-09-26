# Addendum 2 — `formId` stays permanently optional on public submission

Supplements
[`versioned-configuration-releases-server-handoff.md`](./versioned-configuration-releases-server-handoff.md)
and [addendum 1](./versioned-configuration-releases-server-handoff-addendum-1.md). Kept separate for
the same reason as addendum 1: both earlier documents may already be read and in progress.

**Supersedes:**

- §1's step 4, _"Only after the backfill lands does `form_id` become required for a **new** public
  referral (tracked in the compatibility-period step below, not in this migration)."_
- §3's public-submission bullet, specifically _"once the period ends, a missing `formId` is a `400`."_
- §4's whole bullet on _"the bounded old-client compatibility period"_ — that decision is now made,
  so there is nothing left open to settle there. Delete the bullet rather than answer it.
- §6's test bullet covering the compatibility-period `400`.

## The decision

**`formId` on `POST /public/referrals` never becomes required. A missing value always means the
currently active release, for as long as the endpoint exists — not for a bounded window.** There is
no future migration step, no config flag, and no date to plan around for this. An old cached client
that never sends `formId` at all keeps working indefinitely.

This is not a compatibility shim being left in longer than planned; it is the permanent, correct
behaviour. A referral with no `formId` genuinely was submitted against whatever was active at
that moment, so backfilling it to the release that was active at submission time is exactly right,
indefinitely, not an approximation tolerated during a transition.

## What doesn't change

- `formId` is still returned and still recorded — every referral still ends up with a real
  `form_id` row reference after backfill, matching everything else in the original handoff (historic
  rendering, pick-list generation, the `re-refer` endpoint from addendum 1). This addendum only
  removes the plan to ever start _requiring the client to send it_.
- `formId` must still reference a `published` or `superseded` release when it **is** sent — never a
  `draft` — and an unrecognised or `draft` id is still a `422`, unchanged from the original handoff.
- Nothing about draft/publish/rollback, the manifest, or the bulk-read endpoint changes.

## Tests (replaces the superseded §6 bullet)

- A submission with no `formId` is backfilled to whichever release is active at the moment of
  submission, indefinitely — assert this still holds with no time-based or version-based
  fallback path in the implementation, not just as of today.
- A submission with a `formId` referencing a `superseded` release succeeds; referencing a `draft` or
  unknown id is `422`.
- No test should exist asserting a missing `formId` is ever rejected — if one is ever added, that is
  itself a regression against this decision.
