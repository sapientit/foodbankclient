# Versioned questionnaire and preference-rule releases

## Decision

The referral questionnaire and preference rules will remain authored in the
Google Sheets workbook, but published releases will be held in the server's
D1 database instead of being bundled into and released with the client.

The **client continues to validate, implement and evaluate the rules**. The
server must not become a form or rules processor: it stores immutable release
payloads and referrals, and accepts the client's resolved parcel lines and
initial pick-list information as it does now.

Each referral records the immutable form/release it was submitted under. A
pick-list operation therefore interprets a referral with that release's rules,
not whichever rules happen to be current later.

## Scope and invariants

- A release contains its questionnaire and its preference rules together.
  Publishing one without the other is not allowed.
- Published releases are immutable. A correction creates and publishes another
  release; it never overwrites historic JSON.
- Stable question keys and stored answer values remain historic identifiers.
  Changing either is a compatibility change, not a wording edit.
- The Google authoring workbook remains the source of reviewed JSON. D1 is the
  published-runtime store, not an editable form-builder UI.
- Rules are evaluated in the client using the existing bounded grammar,
  ordering, `$selectedAnswer`, `$dummy`, quantity and item-level-attention
  semantics.
- Validation and any compilation of a release happen before upload and again
  when the client loads it. The server stores that prepared payload verbatim;
  it does not parse, validate or execute the questionnaire or rules.
- Existing parcels and their notes remain snapshots. Reconciliation must never
  alter them.
- There is no separate warning record or warning UI for a discontinued
  historic stock item. The only operational record is an initial entry in the
  parcel's **Information for pickers**.

## System configuration

Introduce a clearly named server/deployment parameter such as
`CONFIGURATION_SPREADSHEET_ID`. Every environment will deliberately use the
same authoring workbook ID, but source code must not contain it.

This is not the existing extract-spreadsheet setting: that setting is the
destination for referral extracts and must remain separate, particularly
between test and production. The configuration workbook ID is available only
to the controlled configuration-upload workflow; it is not a Google
credential.

The Worker does not need a Google service account or a stored Google token.
The existing owner/admin-controlled workflow obtains short-lived, read-only
Google access, reads both generated JSON cells together, and uploads the
reviewed bundle to the server.

## Generated-release manifest and upload confirmation

The two existing generated JSON cells alone cannot prove that their content was
generated together after the latest Rules and Questionnaire editing. Add one
Apps Script **Generate configuration release** action which regenerates both
outputs and, only after both succeed, writes a separate generated manifest.

The manifest contains a fresh generation ID, the generation date and time, and
a hash of each generated JSON payload. It is a generated artefact, not an
editable authoring field. Running either older individual generator, changing
a generated cell, or reading a stale manifest must make the uploader refuse to
continue because the downloaded payload hashes no longer match the manifest.

The uploader reads the Questionnaire JSON, Rules JSON and manifest together.
Before upload it shows the manifest's date and asks the operator to confirm
that this is the configuration generated on that date which they intend to
publish. It then runs the structural, compatibility, rule-reference and target
environment active-stock checks. Only a confirmed, manifest-matching and
validated bundle can be uploaded.

## Data model and migration

Add an immutable `configuration_releases` table, containing at least:

- an opaque `form_id` used by referrals and API callers;
- questionnaire JSON;
- rules JSON;
- a content hash and source-workbook metadata for audit;
- draft/published/superseded state; and
- created and published timestamps and actor identifiers.

Only one release is active in an environment at a time. Publishing atomically
changes that active pointer; it does not inspect the release content.

Add `referrals.form_id`, indexed and linked to the release table. Migration is
deliberately staged:

1. Publish a baseline release containing an exact copy of the presently
   released questionnaire and rules.
2. Add the referral column as nullable and backfill existing referrals to that
   baseline release.
3. Deploy client support for loading the active form and submitting `formId`.
4. After the bounded old-client compatibility period, require `formId` for new
   public referrals.

The baseline step is essential: existing referrals must not be linked to a
later edited release simply because it is active at migration time.

## Publication and form APIs

Provide these server capabilities, with OpenAPI-generated client types:

- a public read of the active questionnaire and its `formId`; rules are never
  returned to the public form;
- public referral submission carrying the loaded `formId`; the server records
  the release link but does not validate answers against its questionnaire;
- authenticated upload of one reviewed questionnaire-and-rules bundle as a
  draft;
- publication, history and rollback-to-an-earlier-release actions for
  administrators; and
- authenticated bulk reads of the distinct releases required to interpret
  referrals on an operational screen — needed by every staff **and
  `fuel_admin`** screen that renders `answers`, not only Run a session: the
  fuel help list is `fuel_admin`'s one screen and depends on it to find the
  pre-payment-meter and permission-to-ring questions for each referral's own
  release. Rules are shaped out of that response for a caller with no reason
  to see them, the same absent-not-null convention already used for
  role-shaped fields elsewhere in this API.

The uploader validates the generated Questionnaire and Rules JSON together,
including questionnaire structure, key compatibility, rule references and the
current stock catalogue, before it uploads a draft. The running client parses
and validates the stored release before using it. The server does neither; it
only stores and serves the payload. This replaces the current local-file
write/release step, so a normal questionnaire/rules edit no longer needs a
client deployment.

## Client behaviour

### Public referral form

The public form fetches the active questionnaire once, renders and validates
from it, retains its `formId` in memory with the in-progress form, and submits
that ID alongside the referral. No referral draft is persisted.

### Copying a referral (admin only)

`POST /referrals/{id}/copy` creates an ordinary new referral in one request — the admin picks a
session and it exists immediately, with no form or answer review step (`API.md`, "Copying a
referral"). Under this plan the copy records **the currently active `formId`, never the source
referral's**: a phoning household given another chance is provisioned under today's questionnaire,
rules and stock, not a snapshot of whichever release happened to be active when they first came in.

`answers` still copies across whole, unmodified — there is no per-key validity check to make. A key
the household answered before still means the same thing today, because stable keys and stored
values are historic identifiers a release must never repurpose. A key the current questionnaire has
retired, or a current preference the household was never asked, simply produces no automatically
resolved line for that preference — the rule engine already treats an absent answer key as "nothing
selected," not an error — rather than blocking the copy or needing to decide what is "valid" to keep.

**Open point:** if an old stored answer value names a stock item that has since gone inactive, that
preference is currently just dropped, unlike the historic-release path, which surfaces a "No longer
stocked: X" note instead. Whether a copy under the active release should get the same note when this
happens is not yet settled.

### Historic answer rendering

Staff screens fetch definitions by the `formId` carried by the referral and
render labels, options and marker-driven fields with that definition. The
existing raw-key fallback remains for genuinely unknown legacy data.

### Pick-list generation

The client performs the rule evaluation:

1. Identify referrals that need a newly created parcel; existing parcels are
   not reconsidered.
2. Collect their distinct `formId` values and fetch those releases in bulk.
3. Parse and validate each release once, cache it for this generation
   operation, and group referrals by its release.
4. Evaluate every referral using that release's questionnaire and rules.
5. Send the resolved `preferenceLines` and the initial
   `pickListInformation` with the existing pick-list creation request.

This is deliberately not a database read or validation per referral. A
release is loaded and validated only when at least one uncovered referral
requires it.

The current active release continues to use the existing rule-health behaviour:
a rule that names no uniquely active stock item is a configuration error and
prevents generation.

## Historic unavailable stock

For a referral using a non-current historic release, an item may no longer be
active in the stock catalogue. In that case the client:

- omits that item from the resolved parcel lines; and
- adds one deterministic, deduplicated entry such as
  `No longer stocked: Marmite.` to that new parcel's Information for pickers.

There is no fake stock line, `quantity: -1` line, warning state or separate
audit record. The saved picker information is sufficient for the team lead to
decide whether a substitute is appropriate.

The note is generated only for a newly created parcel. The current server
contract already leaves an existing parcel's note untouched on reconciliation,
so reopening or regenerating a session cannot append duplicate discontinued
item entries. A referral that later receives a genuinely new parcel, for
example in another session, receives a fresh snapshot.

Stock may be deactivated after a parcel is created. That is ordinary snapshot
behaviour already present for parcel lines, so this design does not add a retry
protocol or server-side rule evaluation to address that race.

## Implementation sequence

1. Settle this plan in the shared domain specification and update the existing
   documentation which says the form and rules are client-owned, bundled
   configuration:

   - rewrite `docs/engineering/referral-form.md`, including its title and the
     explanation of publication, validation, historic keys and rendering;
   - replace the enforced client-bundled ownership rule in
     `.claude/rules/referral-form.md`;
   - update `docs/engineering/automatic-preference-picking.md` where it says
     the server does not load form JSON, the generated file is committed and
     promoted through development/test, and the server is unaware of client
     JSON; and
   - update `../foodbankserver/STATUS.md`'s former-form-definition **Removed**
     note with a forward pointer to the new versioned-release implementation,
     rather than silently leaving it stale.

   The revised wording must preserve the boundary that the server stores and
   returns releases but does not validate or evaluate them.

2. Implement server D1 migrations, release storage, active-release/public form
   and authenticated publication/history APIs, and referral `form_id` support.
3. Seed the baseline release and backfill referrals before enabling live
   configuration publishing.
4. Update the workbook intake/uploader to read the configured workbook ID and
   upload a reviewed bundle rather than changing client source files.
5. Regenerate the client API types and replace static questionnaire/rule
   imports with release-loading hooks and pure parsers.
6. Update public submission, historic rendering, listener/fuel/picker marker
   consumers, and client-side grouped pick-list evaluation.
7. Retire the old bundled-runtime configuration path after compatibility has
   elapsed; retain the baseline JSON only where needed for migration fixtures.
8. Deploy the server before the client, then verify the active release,
   versioned referral submission and mixed historical-release pick-list case on
   the paired deployed system.

## Required verification

- D1 migration/backfill and immutability tests.
- Uploader rejection tests for malformed bundles, key/type reuse, invalid rule
  references and invalid current stock references before any upload occurs.
- Apps Script and uploader tests for a complete generated-release manifest,
  mismatched payload hashes, a missing/stale manifest, and confirmation showing
  the manifest generation date before upload.
- Public form tests for fetching/submitting `formId` and applying the loaded
  questionnaire's required validation in the client.
- Client pure-logic tests covering multiple releases in one generation,
  one-load/one-validation caching, historical rules, and `$selectedAnswer`.
- Behavioural pick-list tests proving an inactive historic item is omitted and
  produces one initial picker-information entry, while current invalid rules
  still block generation.
- Reconciliation tests proving an existing note, including a manually amended
  note, is never rewritten or duplicated.
- API type regeneration, both repositories' focused contract tests, the
  client `npm run check`, server equivalent gate, and final documentation and
  diff review.
