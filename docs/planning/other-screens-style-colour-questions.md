# Other screens: style and colour questions

This compares the remaining screens against their references in `Images and prompts5.docx` with the
current, live screens (checked in the browser, signed in as an administrator). Like
`stock-screen-style-colour-questions.md`, it deliberately excludes functionality, data and controls
that are not present in both versions — only appearance questions are asked here.

Two kinds of things are **not** repeated as questions below, because they were already settled by
the Stock document as applying everywhere:

- The larger header wordmark/nav and the active nav item's pale-blue tile.
- The pale-blue (or pale-green/pink, depending on section colour) full-width heading banner behind
  every screen title, except the dashboard.

Where a screen is still missing one of those two things, it's noted under **Implementation gaps**
at the end rather than asked as a question, since Pete has already answered it — it's just not built
there yet.

Answers are not filled in yet — this is the first pass, for Pete to work through.

## A shared pattern across list/results screens

The Stock document settled a table/results treatment (white rounded card, softer row dividers,
lighter blue-grey column-heading fill, compact rows, the whole results block — including its pager —
presented as one contained panel) but scoped the answer to the Stock screen's own table. Several
other screens below use the same kind of table and would need the same questions answered again, so
rather than repeat them screen by screen:

- Should every results/list table in the app (Referrals, Search referrals, Users, Referrers, Reasons
  for referral, Target stock lists, Model parcels, Crates, Sessions, Weekly sessions, Stock items)
  adopt the same rounded-card, softer-divider, lighter-header, compact-row treatment already agreed
  for the Stock table, rather than the plain white table with a single dark rule under the header
  that most of them use today?
  A: yes
- Should those tables also gain the reference's row-level `>` (view) and `⋮` (more actions) buttons
  in an "Action"/"Actions" column, where the current version instead makes a single text link (e.g.
  the client's name) the only way in?
  A: yes

## A shared pattern for standalone action panels

Several non-table screens (Stock take, Volunteer code, Stock groupings, Crates, Shopping, Model
parcels) show their controls directly on the coloured page background, where the reference wraps the
same controls in a white rounded bordered card (as `Send to Sheets`' "Run spreadsheet extract" card
already does, and as the Stock document's filters panel already does):

- Should these screens' main content — the grouping selector and count table on Stock take, the
  generated-code panel on Volunteer code, the groupings table on Stock groupings, the crates table and
  "Add a crate" form on Crates, the two calculation-option cards on Shopping — be wrapped in the same
  kind of white rounded card, rather than sitting directly on the page background?
  A: yes

The sections below only call out what is specific to a screen, on top of these two shared patterns.

## Dashboard

- Should the summary strip gain the reference's two extra cards — a "Stock items" count and a
  "Parcels today" count — alongside the existing Referrals and Today's session cards? (Their absence
  may be a data/functionality choice rather than a style one — flagging in case it is actually just
  unstyled.)
  A: no
- Should the divider line under "Upcoming sessions" and under "Alerts" be removed, matching the
  reference's unbroken card? (Currently there's a faint rule under each heading before the list
  starts.)
  A: yes

## Referrals — Check referrals (`/referrals`)

- Should the "Filter referrals" panel drop its own heading and instructional sentence ("Choose a
  session or status to narrow this list.") — which repeats what the banner above it already says —
  keeping just the Session/Status fields, as the reference shows?
  A: yes
- Should a "Clear filters" button be added next to the filter fields, as in the reference?
  A: yes
- Should the results panel gain the reference's "Export" control?
  A: no
- Should `Pending review` rows lose their pale-green row-tint (currently used to flag unreviewed rows
  at a glance) in favour of the reference's plain white/grey banding, relying on the status pill's
  colour alone to show a referral is pending? This would reverse a current visual cue, so flagging
  rather than assuming either way.
  A: no
- Should the status pills be filled with colour (amber for pending, green for reviewed) rather than
  outlined in black, matching the reference?
  A: yes

## Referrals — potential matches (a first-time referral's review screen)

- Should "Referral being submitted" and "Potential matches" become separate white rounded cards with
  borders (as the reference shows), rather than a single plain-bordered box under plain headings
  directly on the pink page background?
  A: yes
- Should the right-hand "Referral check" explanatory text sit in its own pale-pink rounded card, as
  in the reference, rather than floating on the page background to the right of a vertical divider
  line?
  A: yes
- Should the "Search" button, "Confirm and continue" button and the row-select controls pick up the
  app's standard filled-button and control styling used elsewhere, rather than the current
  thin-outlined buttons and plain browser radio inputs?
  A: yes

## Referrals — referral detail (a reviewed referral's detail screen)

This screen has had no visible style pass yet — it still looks like the "before" state. Rather than
list every element individually (it would repeat most of the Stock document), the general question
is:

- Should this screen be brought into the same style as the rest of the app — pale-pink heading banner
  with icon, and "Administrator notes" / "Referral summary" / "Referral actions" / "Previous
  referrals" / "Referral details" / "Household composition" / "Answers from the referral form" each
  in their own rounded white or pale-pink card (two cards side by side where the reference shows
  that), with the household-composition grid restyled as a bordered table — rather than the current
  plain key/value lists and a plain bordered grid sitting directly on the pink page background?
  A: yes
- Should the free-standing action buttons ("Cancel this referral", "Move to another session", "Edit
  administrator notes", household composition's "Edit") move inside their respective cards as the
  reference shows, rather than sitting under a plain heading on the page background?
  A: yes

## Referrals — search referrals (`/referrals/search`)

This screen already has the pale-pink banner and a bordered white card round the search fields, and
is close to the reference. Remaining differences:

- Should the input fields gain the reference's leading icons (calendar, pin, phone) and placeholder
  text ("Enter postcode", "Enter phone number"), rather than the current plain bordered inputs with a
  label only?
  A: yes
- Should "Search" become a filled red button with a search icon (as in the reference), rather than
  its current grey/disabled-looking appearance, with "Clear" as an outlined red button rather than
  outlined green?
  A: yes
- Should the results table pick up the shared list/table pattern above?
  A: yes

## Referrals — Send to Sheets (`/extracts`)

This screen already matches the reference closely — pale-pink banner, "Run spreadsheet extract" card,
green button. The only difference is decorative:

- Should the small cloud-and-spreadsheet illustration on the right of the banner be added, matching
  the reference, or is the current banner (without it) fine as a simpler version?
  A: implement cloud and spreadsheet

## Run a session — Clients, pick list review, Listener sheet, Referral details, Text messages

These tabs already match their references closely (session header banner, rounded card layout,
matching tables). The one difference worth asking about:

- Should the "First-time status" and per-client "Status" pills on the Clients tab be filled with
  colour, matching the filled-pill treatment asked about for Check referrals above, rather than the
  current plain grey/amber outlined pills?
  A: yes

## Sessions — Manage Sessions, Weekly sessions, Add a session

All three already match their references closely (green banner, "Date range" card, plain-background
form for Add a session, matching the reference's own unwrapped layout there). No screen-specific
style differences beyond the shared table pattern above.

## Master Data — Approved referrers, Users, Reasons for referral, Christmas vouchers, Cloudflare statistics

Approved referrers, Users, Reasons for referral and Cloudflare statistics already match their
references closely (blue banner, rounded icon, filled buttons, card-based date-range panel) beyond
the shared table pattern above. Christmas vouchers has had no visible style pass:

- Should Christmas vouchers gain the same banner-and-card treatment as its sibling Master Data
  screens — labels sitting above each date field, full-width bordered inputs, the pair wrapped in a
  white rounded card, and a filled green "Save voucher dates" button — rather than its current inline
  label-beside-input layout with a plain grey button, sitting directly on the page background?
  A: yes

## Stock — Parcel Grid (`/model-parcels/grid`)

This screen already matches the reference closely (shaded matrix header, bordered cells, dropdowns
in place). No further style differences worth raising.

## Stock — Stock items, Model parcels (list screens)

Beyond the shared table pattern and the shared action-panel pattern above, no screen-specific
differences.

## Stock — Target stock lists and its "Add a target stock list" form

- Beyond the shared table pattern for the list screen: should the "Add a target stock list" form
  split "Name", "Targets" and "Crate targets" into three separate white rounded cards (each with its
  own icon), as the reference shows, rather than the current single continuous form?
  A: yes — three separate cards (Name / Targets / Crate targets), matching the reference. Crate targets
  stay part of the same form and the same save action as item targets; this only changes how the form
  is laid out, not what it submits. (An earlier answer here said crate targets shouldn't get their own
  card — Pete corrected that in conversation on 2026-09-16: crate targets can have their own card.)

## Implementation gaps (already answered — not new questions)

Noting these so they aren't lost, since Pete already settled both points for every screen in the
Stock document:

- **Heading banner missing**: Dashboard is excluded by design, but Stock take, Volunteer code, Stock
  items, Stock groupings, Crates, Target lists, Shopping, and Model parcels currently have no
  full-width coloured banner behind their heading — just the icon and title directly on the page
  background.
- **Active nav pale-blue tile**: worth a spot-check across all sections (Referrals red, Sessions
  green, Master Data blue, Stock blue) to confirm the active top-level nav item shows the filled tile
  everywhere it should, not just the underline.
