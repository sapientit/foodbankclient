# Deferred work

Work this repo knows it owes, with the answer already known — a contract that moved, a decision
already taken, a rework identified and postponed rather than debated. Each entry is something a
future session can pick up and finish without asking anyone anything.

## What goes where

Three files, and the split is what stops any of them becoming a dumping ground:

| File                                  | Holds                                                              | Who closes it       |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------- |
| `../foodbankserver/OPEN-QUESTIONS.md` | Requirements nobody has decided. **Domain questions, both repos.** | Pete, and only Pete |
| `KNOWN-GAPS.md`                       | Built, but less proven than the test count suggests                | Whoever proves it   |
| `DEFERRED-WORK.md` (this file)        | Known answer, work not done                                        | Whoever does it     |

**Do not raise a domain question here.** `OPEN-QUESTIONS.md` in the server repo is deliberately the
single home for those and already covers client screens — Q14 is about this repo's session views.
Splitting them by repo would give one requirement two homes, which is the failure `AGENTS.md` was
reduced to a stub to prevent. If the answer is "ask Pete", it belongs in that file, not this one.

**Entries are numbered `W1`, `W2`, … Never renumber, never reuse a number.** When one is done, the
change that does it deletes the entry in the same commit — the length of this file is meant to be
the size of the backlog. Git keeps the wording; the reasoning, if it is worth keeping, belongs in
the `docs/` file for that area, where a reader would look for it.

---

## W1 — The refresh contract changed under us, and `auth-fetch.ts` still argues from the old one

`Raised: 2026-07-31` · `Found by: regenerating types after the server's a5aaa2d` · `Risk: low today`

The server's refresh semantics inverted, and the client was built on the previous version.

**Then:** presenting an already-rotated refresh token was treated as theft. It revoked the entire
token family and signed the user out everywhere. That hazard is the stated reason for the
single-flight refresh and the cross-tab `navigator.locks` serialisation.

**Now** (`../foodbankserver/API.md`, "The refresh cycle"): a spent token is refused and nothing more.
The sign-in it belonged to carries on, and the guidance is explicit — _"do not sign the user out on
it. Retry instead."_ Separately, **a sign-in now lasts eight hours from sign-in**, and refresh never
extends it: the replacement token inherits the expiry of the one it replaced.

Two things to change, and one not to:

- **`runRefresh` in `src/api/auth-fetch.ts` calls `endSession()` on any refresh failure**, reasoning
  in its comment that a failure "cannot be told apart from a revoked family". There are no families
  any more. A `401` from refresh now means either the eight hours are up or the cookie is gone —
  both of which do warrant a sign-out — but a network failure or a timeout does not, and neither
  does losing a race that the lock was already there to prevent. The retry-then-sign-out shape
  `API.md` describes is the target.
- **The eight-hour cap has no handling at all.** Nothing anticipates it, and the experience today is
  that a volunteer mid-session is bounced to the sign-in screen with the generic message. At minimum
  it should say the sign-in has ended rather than implying something went wrong. `expiresAt` on the
  token response is capped at the same instant, so the client can see it coming without a new
  endpoint.
- **Keep the single-flight refresh and the cross-tab lock.** Their original justification is gone,
  but they remain correct: one refresh per failure is still fewer round trips, still avoids a
  thundering herd of tabs, and still means the client almost never produces the losing-race `401` in
  the first place. Do not "simplify" them away on the strength of this entry.

**Why it is low risk today rather than urgent:** because single-flight works, the client rarely
generates a spent-token `401` at all, so the over-aggressive sign-out branch is mostly unreachable.
The eight-hour cap is the part a real volunteer will actually meet.

This is priority-one code by this repo's own testing order — "the auth interceptor" is first on that
list in `.claude/rules/testing.md` — so it wants its own change with its own tests, not a fold-in.
The tests to write first are the ones that fail today: a refresh `401` while the sign-in is still
valid must retry rather than sign out, and a network failure must not end the session.

`.claude/rules/authentication.md` and `docs/architecture/authentication.md` have already been
corrected to describe the new contract, each with a note saying the code has not caught up. Delete
both notes when this entry closes.

---

## W2 — Three model-parcels/parcel-grid responses carry more than `openapi.yaml` types

`Raised: 2026-07-31` · `Found by: building the model parcels and household grid slice` ·
`Risk: none today — nothing relies on it`

`openapi.yaml` declares three responses in this area with no content at all (`content?: never`):
`PUT /parcel-grid`'s `200`, `DELETE /model-parcels/{id}`'s `409`, and `PUT /parcel-grid`'s `422`.
Verified against a running server, all three actually carry a body:

- The `200` echoes the saved grid back: `{"grid": {"1-0": "Single parcel", …}}`.
- The `409` (delete refused because the grid still uses the parcel) carries
  `details.cells`: the list of grid cells still naming it.
- The `422` (grid save refused) carries `details.unknownParcels` — `{cell, name}` pairs for a cell
  naming a parcel that does not exist — and `details.unexpectedCells`, cell keys that are not one of
  the thirty real household sizes.

**None of this client's code depends on any of it.** `useSaveParcelGrid` in
`src/features/model-parcels/queries.ts` stays on `unwrapVoid` because the screen already has the grid
it just sent, and `ErrorNotice` shows `error.message` on both refusals — the one thing the contract
actually promises, and the reason the `409`/`422` copy reads as one sentence regardless of exactly
which cells or names caused it.

**The known improvement, once the contract is fixed:** type the three responses in `openapi.yaml`
(server repo), then

- the model-parcels delete confirmation dialog can name the specific cells still using a parcel,
  instead of a generic "the household grid still points at it";
- the grid save's `422` can highlight the offending cells directly rather than making the admin
  compare the whole table against the message by eye.

Both are additive UI, not a rework of anything already built — the whole point of raising this now
rather than guessing at the shape is that `src/features/model-parcels/model-parcels.logic.ts` and its
tests are exactly where the new reader functions would go, next to `unknownGridCells`, once there is a
typed shape to read.

Worth raising with the server repo directly rather than waiting to be asked: `openapi.yaml`'s own
rule (`npm run check:openapi`, described in the server's `CLAUDE.md`) is that "a schema typed `object`
must say which fields it holds", and all three of these are typed `object` in spirit — they just
never got the `content:` block that would say so.

---

## W3 — Automate the questionnaire import before go-live

`Raised: 2026-08-12` · `Risk: go-live prerequisite`

The charity authors the questionnaire in the Google Sheet. Its Apps Script validates the Sheet and
generates the client configuration JSON, but that JSON is not itself a release: the client ships a
static `referral-form.config.json`. A new stored question also needs recording in the append-only
`referral-answer-keys.frozen.ts` ledger, so old referrals can never be silently reinterpreted under
a reused key.

Before go-live, build a developer import command which takes the reviewed generated JSON and:

- validates the configuration and writes `referral-form.config.json`;
- detects genuinely new dynamic answer keys and appends their declared question types to the frozen
  ledger, while refusing a key whose type has changed;
- formats the affected files and runs the referral-form checks; and
- reports that a normal client release is still required for the questionnaire to become live.

This is deliberately an import-and-release workflow, not live Google-Sheet configuration: a
questionnaire change must remain reviewed, tested and deployed before referrers see it. Until W3 is
done, a developer must perform those same steps manually for each questionnaire change.
