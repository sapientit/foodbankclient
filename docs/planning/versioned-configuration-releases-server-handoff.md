# Versioned configuration releases — server implementation handoff

This is the ordered server work for
[`versioned-configuration-releases.md`](./versioned-configuration-releases.md). It turns that plan
into concrete migrations, an API contract and tests for `../foodbankserver`. It is not a replacement
for the charity's settled domain specification — `INITIAL_SPEC1.txt` §288 currently states "the
server is not given the rules and does not read them," which stays true in spirit (the server never
parses or evaluates a release) but needs a line added: the server now **stores** the rules JSON it is
never given permission to read. That rewording is this plan's step 1, alongside the client-repo docs
already listed there.

**Scope guard, matching the plan's own boundary:** every migration and route below stores or serves
release content **verbatim**. None of them parses, type-checks or evaluates a question or a rule. If
an implementation step below seems to need to understand the bounded rule grammar, that is a sign the
step belongs in the Apps Script uploader instead, not here.

## 1. Migrate and seed safely

1. Create `configuration_releases`:
   - `id` (`form_id` in the API — `text`, UUID, primary key, generated server-side on draft
     creation, not client-supplied);
   - `questionnaire_json` (`text`, stored verbatim, never parsed by the server);
   - `rules_json` (`text`, stored verbatim, same);
   - `questionnaire_hash`, `rules_hash` (the uploader's hashes, stored for audit — the server does
     not recompute or verify them against the payload, matching "does not inspect the release
     content");
   - `generation_id`, `generated_at` (from the Apps Script manifest, opaque strings/timestamp);
   - `source_workbook_id` (audit only — never the configuration workbook credential itself, which
     the server never sees);
   - `status` (`draft` \| `published` \| `superseded`);
   - `created_at`, `created_by_user_id`; `published_at`, `published_by_user_id` (nullable until
     published).
2. Add `referrals.form_id`, nullable, foreign key to `configuration_releases.id`, indexed.
3. Seed exactly one baseline release: copy the questionnaire and rules JSON the client currently
   ships, mark it `published`, and backfill every existing referral's `form_id` to it in the same
   migration. Do this **before** any real draft/publish exists, so the baseline cannot accidentally
   pick up an edited release — the plan calls this out as essential and it is a migration-ordering
   requirement, not just a sequencing preference.
4. Only after the backfill lands does `form_id` become required for a **new** public referral
   (tracked in the compatibility-period step below, not in this migration).

`configuration_releases` is append-only from the application's point of view: no `UPDATE` ever
touches `questionnaire_json`, `rules_json`, or the hash/generation columns after insert. Only
`status` and the `published_*` columns change after creation.

## 2. Domain behaviour and state machine

- **One active (`published`) release per environment, always.** Enforce with a partial unique index
  or an equivalent single-row invariant (`WHERE status = 'published'`), not just application logic —
  this is exactly the kind of invariant a race between two admins publishing at once would otherwise
  break.
- **`draft` → `published` → `superseded`.** Publishing a draft atomically: (a) moves the currently
  `published` row to `superseded`, (b) moves the target row to `published`, (c) stamps
  `published_at`/`published_by_user_id`. Both writes happen in one transaction/batch; a reader must
  never observe zero or two active releases.
- **Publishing never inspects `questionnaire_json` or `rules_json`.** It checks only that the target
  row exists and is in a publishable state (see rollback below) — a structural/state check, not
  content validation. All content validation already happened in the Apps Script uploader before the
  authenticated upload call.
- **The upload endpoint does not validate the bundle either.** It stores whatever `questionnaire`,
  `rules`, and manifest fields it is given, as a new `draft` row. This mirrors this codebase's
  existing "stored and returned exactly as sent, never validated" pattern for target stock lists and
  model parcels — the trust boundary is the admin-only auth check plus the uploader tool that ran
  before it, not the write endpoint.
- **Rollback is publishing an old release again, with a narrower precondition.** Rather than a
  separate "rollback" content path, `rollback` and `publish` share the same atomic pointer-flip; the
  distinction is which `status` the target row must currently be in (`draft` for `publish`,
  `superseded` for `rollback`) and which actor/audit label is recorded. This keeps there being only
  one way active-pointer state actually changes. Flagged in §4 as a design choice to confirm rather
  than a certainty.
- **No `answers` validation against the questionnaire, ever, at submission.** `POST
/public/referrals` records `formId` as a plain foreign key and stores `answers` exactly as it does
  today — unvalidated, unknown keys kept. This preserves the removed-in-`0008` boundary; it is not
  something this plan reopens.
- **`POST /referrals/{id}/copy` sets the new referral's `form_id` to the environment's currently
  `published` release — never the source referral's `form_id`.** Every other field it copies (per
  `API.md`, "Copying a referral") is unaffected by this plan. This is a deliberate divergence from
  the "the original is untouched" framing elsewhere on that endpoint: the _original_ keeps its own
  `form_id` unchanged; only the newly created _copy_ is pinned to today's release, because it is
  meant to be interpreted going forward under today's rules and stock, not preserved as of the
  original's era. `answers` still copies whole and unmodified — a stale or missing key relative to
  the new release's questionnaire is not an error, it just resolves no preference line for that key
  (see `resolvePreferenceLines`'s existing absent-key handling, which already treats a missing answer
  as "nothing selected").

## 3. API contract to publish before client wiring

All new routes get `x-assumed` on any field this document guesses rather than states as settled, per
this repo's own convention for marking a guess at its call site.

**Public (unauthenticated, rate-limited per IP, alongside the existing list in API.md §3):**

- `GET /api/v1/public/questionnaire` → `{ formId: uuid, questionnaire: <verbatim JSON> }` for the
  currently `published` release. Never includes `rules`.
- `POST /api/v1/public/referrals` gains `formId: uuid` on `ReferralSubmission`. During the
  compatibility period (§1.4) it is optional and a missing value is backfilled to the
  currently-published release's id server-side, so an old cached client keeps working; once the
  period ends, a missing `formId` is a `400`. `formId` must reference a `published` **or**
  `superseded` release (never a `draft` — nothing public can reach an unpublished release) or the
  request is a `422`.

**Authenticated, admin only:**

- `POST /api/v1/configuration-releases` — body carries `questionnaire`, `rules`, and the manifest
  fields (`generationId`, `generatedAt`, `questionnaireHash`, `rulesHash`, `sourceWorkbookId`).
  Returns the created `draft` row including its new `formId`. No response field for validation
  outcome — the uploader already ran that before this call.
- `POST /api/v1/configuration-releases/{formId}/publish` — `404` if unknown, `409` if not currently
  `draft`. Performs the atomic pointer flip in §2.
- `POST /api/v1/configuration-releases/{formId}/rollback` — `404` if unknown, `409` if not currently
  `superseded` (in particular, `409` for the row that is already `published`). Same pointer flip,
  distinct audit trail.
- `GET /api/v1/configuration-releases` — history list, newest first: `id`, `status`, `generationId`,
  `generatedAt`, `createdAt`/`createdBy`, `publishedAt`/`publishedBy`. Omits `questionnaire`/`rules`
  bodies — this is the picklist-style summary view, not the bulk bundle read below.

**Authenticated, admin, team_lead **and** fuel_admin** — every role that renders `answers` needs this,
not only Run a session. Missed in the first draft of this handoff: `fuel_admin`'s one screen
(`GET /fuel-help-list`) shows the pre-payment-meter and permission-to-ring answers, which are
ordinary marker-driven questions on a release the server cannot identify by name (API.md §5e) — it
needs exactly the same per-`formId` questionnaire lookup a team lead's historic-answer rendering
does.

- `GET /api/v1/configuration-releases/bulk?formIds=<uuid,uuid,...>` → **role-shaped response**, the
  same absent-not-null convention as every other role-scoped field in this API: `admin` and
  `team_lead` get the full bundle (`questionnaire`, `rules`); `fuel_admin` gets `questionnaire` only
  — `rules` is absent from its response, not `null`, since it never evaluates a preference rule and
  has no reason to see the stock-item mapping. `x-assumed`: a sane cap on the number of ids per call
  (e.g. 50) as defensive coding, matching this codebase's existing caps on bulk operations — the
  client is only ever expected to ask for the handful of distinct releases in one screen's worth of
  work, never an unbounded list.

Update `API.md` §2's role table with a `Configuration releases` row (upload/publish/rollback/history:
admin only; bulk read: admin, team_lead **and** fuel_admin, response shaped per role as above — a new
three-way split with no direct precedent in the existing role table, so call it out explicitly rather
than assuming it matches the target-stock-lists two-way one). Update `openapi.yaml` for all of the
above, then the client runs `npm run api:types` only once these land.

## 4. Contract decisions needing an explicit settle

These are this handoff's own guesses, each also worth a one-line `x-assumed` at its future call
site:

- **Rollback-as-publish-with-a-narrower-precondition** (§2) is the simplest state machine that
  satisfies "immutable releases, one active pointer, full history," but it means a `superseded`
  release can only ever become `published` again via `rollback`, never `publish` — confirm that
  split reads clearly to whoever builds the admin screen.
- **Can more than one `draft` exist at once?** This plan assumes yes — nothing stops two uploads
  before either is published — since rejecting a second draft would need the server to compare
  content, which it must not do. A stale, un-published draft is simply never referenced by
  `publish` unless somebody chooses its `formId`.
- **Is there a way to discard an unpublished draft?** Not in the plan's API list. Proposed: no
  delete endpoint for v1 — an unpublished draft is inert and costs nothing but a D1 row, and adding
  delete reopens the "can a formId disappear from under a referral" question for no real benefit
  before one is ever published.
- **The bounded old-client compatibility period** (plan §"Data model and migration" step 4) has no
  proposed length here. `../foodbankclient/docs/architecture/deployment-topology.md` already
  documents a sign-in-time client-version probe (`client-version.json`) — worth checking whether
  that mechanism can force a stale cached client to refresh before this period is chosen, rather than
  picking a duration blind.

## 5. Docs to update in this repo (`foodbankserver`)

The client-side plan's step 1 lists the client-repo docs. These are the server-repo equivalents,
missed by that list because they live here:

- `API.md` §3, "The form itself is yours" — this section currently states as settled fact that
  "the server does not hold the referral form... there is no draft, no publish call, and no
  form-maintenance screen to build." All three become false. Rewrite alongside the new route
  documentation above, keeping the parts that stay true: `answers` is still never validated against
  the questionnaire, and unknown keys are still stored, not dropped.
- `STATUS.md`'s **Removed** note (currently: _"there was a `modules/forms`... The referral form
  moved to the client, migration `0008` dropped both tables"_) — add the forward pointer to this
  slice, the same instruction the client plan already gives for its own copy of this note.
- API.md's "Copying a referral" section, "What the copy carries" — add that the new referral's
  `formId` is set to the environment's active release, not carried across from the original.
- `INITIAL_SPEC1.txt` §288 — add the one line noted at the top of this document; do not restate the
  rest of that paragraph, which stays correct.

## 6. Required tests

- Migration/backfill: baseline release is `published`, every pre-existing referral backfilled to it,
  and a partial-unique-index (or equivalent) test proving two concurrent publishes cannot both leave
  their row `published`.
- Immutability: no code path updates `questionnaire_json`/`rules_json`/hash columns after insert.
- State machine: `publish` rejects a non-`draft` target; `rollback` rejects a non-`superseded`
  target (including the currently-`published` row); both are no-ops on `questionnaire_json`/
  `rules_json`.
- Upload endpoint stores an arbitrary/malformed bundle verbatim (proving it does not validate) —
  this is a test _for_ the boundary, not a gap to close.
- Public questionnaire read never includes `rules`, and always reflects the currently `published`
  row even mid-publish (no window where it returns none).
- `POST /public/referrals` compatibility-period backfill of a missing `formId`, and its later `400`
  once the period is ended in config; `422` for a `formId` that is `draft`.
- Bulk read: role split (admin, team_lead and fuel_admin all succeed, everyone else `403`);
  fuel_admin's response has `rules` absent while admin/team_lead get the full bundle; a request over
  the proposed cap is rejected without touching the database.
- History list ordering and that it never includes bundle content.
- Copy: the new referral's `formId` is the environment's active release even when the source
  referral's own `formId` is historic or itself was created before this plan; `answers` copies across
  unmodified; pick-list generation against the copy uses the active release's rules and current stock,
  silently producing fewer lines when an old key or value no longer resolves rather than erroring.

Only after these tests and the `API.md`/`openapi.yaml` updates land should the client regenerate
`src/api/schema.d.ts` and start replacing the static questionnaire/rule imports, per steps 5–6 of the
client-side plan.
