# Addendum 1 — copy becomes a review, not a silent carry-forward

This supersedes one part of
[`versioned-configuration-releases-server-handoff.md`](./versioned-configuration-releases-server-handoff.md),
which you may already have read and started against. Nothing else in that document changes. Named and
numbered separately rather than edited in place, since it lands after that one did.

**Supersedes:** §2's bullet _"`POST /referrals/{id}/copy` sets the new referral's `form_id` to the
environment's currently `published` release — never the source referral's `form_id`"_ and the
corresponding §6 test bullet _"Copy: the new referral's `formId` is the environment's active
release..."_. Do not implement either as written — implement this instead.

## Why

Silently reinterpreting a source referral's `answers` under today's rules and stock — the original
proposal — turned out to be the wrong call. It can produce a referral silently missing a preference
line for a question the household was never asked, or one that silently drops an answer naming stock
that no longer exists, with nothing on screen to say either happened. There is no reliable way to
decide which stored answers still apply to today's form; the fix is to stop guessing and have an
administrator look at the current form instead. Settled in `screenDetails.md`, "Copying a referral."

## Behaviour

`POST /referrals/{id}/copy` keeps its existing gate unchanged: offered, and only offered, where the
source referral's `status` is `cancelled`/`rejected` or its `outcome` is `no_show`/`attended` — the
same 409 otherwise it already returns today.

- **Source `form_id` equals the active release's id:** no change from the original handoff or from
  today's shipped behaviour. `answers` and every other carried field copy across exactly as `API.md`
  already documents.
- **Source `form_id` does not equal the active release's id:** `POST /referrals/{id}/copy` now
  returns `409` — wrong state, same family as its existing status/outcome gate — with a message
  telling the caller this referral must be reviewed on the current form first. It creates nothing.
  The client is expected to check this itself before ever calling `copy` (it already holds both
  `form_id`s), so this `409` is a defensive backstop for a stale client cache or a release published
  mid-session, not the primary signal.

## New endpoint: submit a reviewed re-referral

No new read endpoint is needed — the client already holds the full source referral (it's open on the
referral detail screen) and already has the active questionnaire from the existing bulk/public reads.
What's missing is somewhere for the admin's completed, reviewed form to land.

```
POST /api/v1/referrals/{id}/re-refer
  { sessionId, acknowledgeOverCapacity?, answers, adults, children, householdSize,
    collectionMethod, needsFuelHelp, reasonId, refereeFirstName, refereeSurname,
    refereeDateOfBirth, refereeAddress, refereePostcode, refereePhone }
  → 201 Referral
```

- `{id}` is the **source** referral, purely to enforce the same status/outcome gate `copy` uses (409
  otherwise) and to stamp `adminInfo`. It is not the referral this call creates.
- Admin only. No Turnstile, no referrer authorisation check — `referrerName`, `referrerOrganisation`,
  `referrerEmail`, `referrerPhone` are carried forward from the source exactly as `copy` already
  carries them forward unquestioned, not supplied fresh and not re-verified.
- The body is shaped like the admin's completed form: fixed fields plus `answers`, the same shape
  `ReferralSubmission` uses elsewhere. `answers` is stored exactly as sent — the server does not
  validate it against the questionnaire, same as everywhere else in this plan; the admin's browser
  already built and validated it from the active release before submitting.
- `formId` is **not a request field.** The server always stamps the currently active release's id.
  There is nothing to validate or reconcile because the caller cannot supply a mismatched one, the
  same reasoning that keeps `form_id` server-generated on draft creation.
- `status: "reviewed"`, `reviewComment: null`, `adminInfo` = `Copied from referral dated YYYY-MM-DD`
  (the source's `referredAt`, London), `referredAt` = now — identical to `copy`'s stamping.
- Capacity: warn-but-allow with `acknowledgeOverCapacity`, same as `copy` and `move`.
- Not idempotent, not guarded against a double submit, for the same reason `copy` isn't.

## Docs

- `API.md`, "Copying a referral" — add the `409` for a `form_id` mismatch.
- `API.md` — new section for `POST /referrals/{id}/re-refer`, immediately after "Copying a referral."
- `openapi.yaml` — the new route; `formId` absent from its request schema, present in its response.

## Tests (in addition to the original handoff's §6)

- `copy` returns `409` with a clear message when the source's `form_id` is not the active release's,
  and creates nothing.
- `copy` is unchanged when the two match — a regression guard, not new behaviour.
- `re-refer`: `403` for a non-admin; `409` when the source referral is not in a copy-eligible
  status/outcome; ignores/refuses a client-supplied `formId` field rather than trusting it; the
  created referral's `formId` is always the active release regardless of what the source's was;
  `answers` stored verbatim and unvalidated; `adminInfo`, `status`, `reviewComment`, `referredAt`
  stamped exactly as `copy`'s; capacity warn-not-refuse behaviour matches `copy`/`move`.
