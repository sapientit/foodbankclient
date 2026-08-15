# Code review — foodbankclient, 14 Aug 2026

Reviewed the whole client at `master` (`f9bdea3`) plus the uncommitted fuel-help change. Read in
full: `src/api/`, `src/auth/`, `src/lib/`, `src/components/`, `src/worker/`, the pick-lists,
extracts, fuel-help and referrals features, the test harness and the rule files. Skimmed the
remaining feature screens.

**Verification:** `npm run check` **passes** — 81 test files / 666 tests, up from 656 when this
review began, and it did not pass at all then. The two reasons are written up as **F15**, both now
cleared.

The codebase is in genuinely good shape. The invariants in `CLAUDE.md` are not decoration — the
token really is memory-only, no `console.log` touches a referral, `localStorage` appears only in
comments explaining why it is banned, roles pick menus and never gate routes, and every calendar
date is pinned to UTC for the reason the comment gives. The reasoning-in-comments style is doing
real work; most of what follows is at the edges rather than in the core.

Findings are ordered by consequence. Each has a concrete fix.

**Status: every finding is now closed or recorded.** F1–F6, F8–F10, F15 and F16 are fixed; F7 is
closed by the charity's acceptance; F11 is recorded as `DEFERRED-WORK.md` W5; F12's two coverage gaps
were closed by F1 and F2's own tests, leaving the SMS panel's, which W5 sits alongside. Each code fix
began with a failing test where there was a bug to catch, and the latent ones (F4, F5, F6(b) and W4)
were verified by re-breaking the code and watching the new test go red.

**One edit was made outside this repo**, and only because Pete asked for it: the fuel-list prose in
`../foodbankserver/openapi.yaml` (F3(c)/F6(a2)). Validated with the server's own
`npm run check:openapi`.

---

## F1 — A session ended by a 401 leaves the previous user's referrals in the query cache

> **FIXED.** `src/auth/auth-provider.tsx` now clears the cache on the `signed-out` event, and
> `signIn()` clears as well. The failing test came first, in `src/app.test.tsx` — "empties the cache
> when a lapsed sign-in ends the session, not only when someone signs out". Before the fix it
> reached the sign-in screen and still found Jamie Rowe's name, address, postcode and date of birth
> in the cache.

**Severity: high (personal data on a shared laptop).** `src/api/auth-fetch.ts:111`,
`src/auth/session.ts:63`, `src/auth/auth-provider.tsx:25`.

There are two ways a session ends and only one of them clears the cache.

`session.ts`'s `signOut()` calls `queryClient.clear()`, with a comment that says exactly why:
_"Without it the next person to sign in on this machine sees the previous user's referrals rendered
from cache before their own load."_

But `auth-fetch.ts`'s `endSession()` — the path taken when a refresh fails, the cookie is gone, or
the eight-hour cap expires — only clears the token and publishes `signed-out`. `AuthProvider` moves
to `signed-out`, `RequireAuth` redirects to `/login`, and **the cache is never cleared**. The next
person signs in on the same machine and, for the 60-second `staleTime` the app client uses, screens
render the previous user's referrals — names, addresses, phone numbers — from cache before their own
fetch resolves. This is precisely the shared-church-hall-laptop scenario `query-client.ts`'s module
comment describes; the volunteer does not even have to do anything unusual, only wait long enough
for a session to lapse.

**Fix.** Clear on the event, not only on the deliberate path, so both routes converge. In
`auth-provider.tsx`:

```ts
subscribeToAuthEvents((event) => {
  if (event.type === 'signed-out') queryClient.clear();
  setState(/* … */);
});
```

`AuthProvider` already sits above `QueryClientProvider`'s client in practice, and `session.ts`
already imports `queryClient`, so this adds no new dependency direction. Clearing in
`auth-fetch.ts` itself would be wrong — the API layer must not import the query client.

Belt and braces worth adding at the same time: `signIn()` in `session.ts:40` should clear too. A
sign-in is the one moment the app knows the actor may have changed, and clearing an empty cache
costs nothing.

**Test to write first:** sign in as A, force a 401 that fails refresh, sign in as B, assert B's
screen never renders A's fixture. `test/render-app.tsx`'s one-actor-per-file rule means this needs
its own file.

---

## F2 — The first extract to a fresh spreadsheet corrupts the hidden key row, and every later extract then fails

> **FIXED.** `archiveKeys()` now reports `isEmpty`, and `writeClaim()` writes the full key row from
> column A when the sheet is blank. Two failing tests came first, in `google-sheets.test.ts` under
> "the first claim written to an empty spreadsheet", backed by a new stateful `stubSpreadsheet()`
> helper — the established-sheet stub could not see this, because the bug only appears when the
> _second_ extract reads what the first left behind. Both new tests end by extracting twice.
>
> The second test's failure output was the clearest evidence: row one of the archive held
> `2026-08-07`, `St Mary's Hall`, a referral UUID and the household counts — a data row sitting
> where the hidden key row belongs.

**Severity: high (the extract stops working, loudly, on the second run).**
`src/features/extracts/google-sheets.ts:16-40` and `:55-65`.

`archiveKeys()` returns `[...FIXED_HEADERS]` when the archive's row 1 is blank — a sensible default.
`writeClaim()` then computes `startingColumn = keys.length + 1` (15) and writes **only the
additions** to `archive!O1` and `archive!O2`. The fourteen fixed keys it just invented are never
written to columns A–N.

On the next run, `archiveKeys()` reads row 1, gets `['', '', … , 'Cause Details', …]`, fails the
`FIXED_HEADERS.some(...)` guard and throws _"The hidden archive key row does not match the extract
format. Nothing was written."_ — permanently, until somebody edits the sheet by hand.

If the first claim happens to carry no dynamic answers at all, it is worse: `additions.length === 0`
so no header write happens either, and the data rows are appended starting at row 1, which then
_becomes_ the hidden key row.

The dead branch is the tell. `if (additions.length > 0 || keys.length === 0)` — `keys.length` can
never be `0`, because `archiveKeys()` returns fourteen entries in exactly the case that condition
was written for. Somebody saw the fresh-sheet case and the guard did not survive.

**Fix.** Have `archiveKeys()` report whether row 1 was blank, and write the full `allKeys` from
column A when it was:

```ts
const { keys, isNew } = await archiveKeys(spreadsheetId, accessToken);
// …
if (isNew) {
  await putValues(id, token, archiveHeaderRange(1, allKeys.length, 1), [[...allKeys]]);
  await putValues(id, token, archiveHeaderRange(1, allKeys.length, 2), [[...allKeys]]);
} else if (additions.length > 0) {
  /* the existing O1/O2 path */
}
```

**Why no test caught it:** all three cases in `google-sheets.test.ts` seed `stubSheets()` with
`FIXED_HEADERS` already present. Add a fourth that stubs `values: []` for `archive!1:1`, asserts the
fixed keys are written from column A, and — the assertion that actually pins the bug — feeds the
resulting row 1 back into a second `writeClaim` and asserts it does not throw.

---

## F3 — The fuel help list renders empty columns, because this repo's generated types are a server release behind

> **CLOSED.** All three parts done, and `npm run check` passes.
>
> - **(a)** `npm run api:types` regenerated `schema.d.ts` (additive — the one new field). The date of
>   birth column now reads `household.refereeDateOfBirth` through `formatCalendarDate`, so it shows
>   `4 Aug 1975` rather than a raw string, UTC-pinned like every other calendar date here.
> - **(b)** Settled by Pete: the fuel team does not want `needsFuelHelp`, because every household on
>   the list needs fuel help by definition. The marker came off in `referral-form.config.json`, and
>   `fuel-help.logic.ts` now **drops** a marked key field the endpoint does not send instead of
>   rendering it empty — `KEY_FIELD_READERS` is the single list of what the screen can show, so
>   adding a field to the response is one entry and forgetting one cannot produce a dead column.
> - **(c)** Still open, and it is the server's: schema and prose disagree. Raised with Pete.
>
> `screenDetails.md` updated in the same change, as the repo requires: the marker is the authority
> for what **may** appear, a marked detail the list does not carry is left out rather than standing
> empty, the date of birth is shown as a date and never an age, and `needsFuelHelp` is named as not
> a column and why. Tests: the logic file gained cases for the formatted date, the null date, and a
> marked-but-unavailable field being dropped; the screen test gained a regression guard that no
> column headed "Does the client need help with Energy costs?" exists, plus a
> `Not provided` / `Not answered` case for a household that gave neither.

**Severity: high (working-tree change).** `src/features/fuel-help/fuel-help.logic.ts:57-58`,
`src/api/schema.d.ts`, `src/features/referrals/referral-form.config.json:56` and `:581`,
`screenDetails.md:124`.

> **Corrected after first writing this.** I originally read this as the config contradicting a
> server contract that refuses to send a date of birth. That was wrong, and the reason is itself the
> finding: **`src/api/schema.d.ts` is stale.** `npm run api:types:check` fails on the current tree,
> and regenerating shows the server has since added `refereeDateOfBirth` to `FuelHelpHousehold` —
> server commit `3dac152`, _"The fuel help list gains the household's date of birth"_, described as
> _"Here to identify the household to whoever follows the bill up."_ The client cannot see a field
> its types do not have.

The uncommitted change is a good idea — deriving the columns from a `forFuelTeam` marker beats a
second hard-coded list that drifts. Three separate things follow from the stale types.

**(a) `refereeDateOfBirth` is available and the client is not reading it.** The marker is right, the
server sends the field, and `keyFieldValue` returns `'Not provided'` for it — so the column is
empty for a reason that has nothing to do with the requirement. Fix: `npm run api:types`, then read
`household.refereeDateOfBirth` through `formatCalendarDate` (`lib/london-time.ts`, which exists for
exactly this and is already pinned to UTC).

**(b) `needsFuelHelp` is still not in the response**, so that column _is_ permanently `Not provided`
on every row of every extract, in a table whose entire purpose is being pasted into Excel.
`fuel-help.logic.test.ts` currently enshrines that as intended. Either the server should send it or
the marker should come off — see F6(a).

**(c) The server's own spec now contradicts itself, and this is worth telling Pete.** The
`FuelHelpHousehold` schema carries `refereeDateOfBirth`, while the endpoint's prose description
immediately above it still says:

> **No reason for referral, no date of birth, no household counts and no delivery flag.** None of
> them bears on helping with a fuel bill, and the row already holds enough to identify somebody.

Both cannot be true. That is the server repo's to correct, not this one's — I have not touched it.

**Fix — the code half.** Regenerate the types first; that is a prerequisite for `npm run check`
passing at all (see F15). Then read the real field for (a), and for (b) drop a column whose value
can never be present rather than rendering an empty one:

```ts
export function fuelColumns(definition = referralFormDefinition): FuelColumn[] {
  // A key field the fuel-list endpoint does not return can never have a value,
  // and an always-empty column in a paste-into-Excel table is worse than none.
  const UNAVAILABLE: readonly KeyFieldName[] = ['needsFuelHelp' /* … */];
  // …skip question.type === 'keyField' && UNAVAILABLE.includes(question.field)
}
```

Keep `keyFieldValue`'s exhaustive switch as the second lock, and keep its comment — the reasoning
in it ("do not derive a value from eligibility: that would turn a missing value into a claim about
the household") is right and stays right.

**Fix — the requirement half, Pete's call.** See F6.

---

## F4 — The pick-list draft survives a change of parcel

> **FIXED.** `key={parcel.id}` on `ParcelPanel`, and `RunSessionClientScreen` now reads the live
> `sessionId` param rather than a copy frozen at mount. Regression test: _"never carries one
> household's unsaved pick list onto another"_ — it types 9 tins onto Sam Taylor, navigates to Jo
> Patel, and asserts Jo's own 5 are shown. **Verified to catch the bug**: removing the key alone
> fails it.

**Severity: medium (wrong household's contents saved, in the one screen where that matters most).**
`src/features/pick-lists/components/run-sessions-screen.tsx:455` and `:484-487`.

`ParcelPanel` seeds `savedLines`, `draftLines`, `savedNotes` and `draftNotes` from the `parcel` prop
with lazy `useState` initialisers, which run **once per mounted instance**. It is rendered without a
`key`, so if React ever reuses the instance across a change of `parcel`, the panel shows — and
`save()` writes — the previous household's quantities and pick-list information against the new
`parcel.id`.

Today's routes make this hard to reach: the only way between two clients is via the list, which
unmounts the screen. But `/run-sessions/:sessionId/clients/:parcelId` is a parameterised route and
React Router will happily swap the params without remounting, so any future "next client" link — an
obvious thing to add to a workspace built for working through a session — turns this into a live
bug that writes one household's parcel onto another's.

**Fix.** One line, at the call site:

```tsx
<ParcelPanel key={parcel.id} … />
```

Same class of latent staleness, worth the same treatment: `RunSessionClientScreen` captures
`useState(sessionId)` at line 395, so a `sessionId` param change without a remount would leave the
panel showing the old session's pick list.

---

## F5 — There is no way to leave a client workspace without saving

> **FIXED.** The dialog now has three answers — **Stay on this pick list / Discard changes / Save
> changes** — and the save error renders inside it rather than behind it. Discarding puts the draft
> back to what was last saved, so leaving without saving really does.
>
> `ConfirmDialog` gained two optional props (`cancelLabel`, `secondary`) rather than a second modal
> being hand-rolled here: its focus trap, focus return and `<dialog>` fallback are already the least
> proven code in the repo (`KNOWN-GAPS.md`), and a second copy would double that exposure. Existing
> callers are untouched. Regression test: _"lets a team lead leave a pick list without saving, and
> does not save when they do"_, which also asserts **no** `PUT` is sent. **Verified to catch the
> bug**: removing the third answer fails it.

**Severity: medium (usability, on the hall-floor screen).**
`src/features/pick-lists/components/run-sessions-screen.tsx:686-700`.

`screenDetails.md:58` asks that the system "asks whether to save first" when leaving with unsaved
changes. The `ConfirmDialog` implements that with **Save changes** and **Cancel** — but Cancel
cancels the _navigation_, not the _save_. A volunteer who has typed something into the wrong
household's pick list has no way out of the screen except to save it or reload the browser.

Compounding it: if the save fails, `afterSave` never fires, the dialog stays open, and the
`ErrorNotice` renders behind the modal in the editor pane where it cannot be read.

**Fix.** Three answers, not two — Save and continue / Discard and continue / Stay here. That needs
either a third button on `ConfirmDialog` or a small local dialog on this screen; given
`ConfirmDialog` is deliberately two-answer ("the destructive answer is never the one a stray Enter
lands on"), I would add the third button locally rather than widen the shared component. Render
`saveLines.error` inside the dialog while it is open.

---

## F6 — Requirement questions for Pete

**Not for an assistant to answer.** The open ones belong in `../foodbankserver/OPEN-QUESTIONS.md`;
I have not written them there.

**(a) ~~Does the fuel team need `needsFuelHelp` as a column?~~ ANSWERED — no.** Every household on
the fuel list needs fuel help by definition, so the column said nothing. The marker is off and
`screenDetails.md:124` now records the reason. Built; see F3(b).

**(a2) ~~The server's fuel-list description contradicts its own schema.~~ ANSWERED and FIXED.**
Pete: the fuel team needs the date of birth because **some of the organisations they hand a
household on to will not act without an age**. So the schema was right and the prose was stale.

> Corrected in `../foodbankserver/openapi.yaml` — the one place Pete authorised me to edit in that
> repo. The passage now says the date of birth is carried and why, and keeps the field's own reason
> for it being a date rather than an age: an age is right on the day it is written down and wrong a
> year later. `screenDetails.md` updated to the real reason too — I had inferred a different one
> ("so two households of the same name can be told apart") from the server's field description, and
> that was a guess.
>
> **Three neighbouring references were stale in the same way** and I fixed them while I was in the
> file: the contract used _Cause Details_ as its worked example of "the client extracts an answer by
> name", in the listener-sheet endpoint, the `ListenerSheetHousehold.answers` field and the parcel
> answers field. That key is not in the questionnaire — it is precisely the trap that produced
> F6(b) — so leaving it as the contract's example would have walked the next reader straight back
> into it. The point each was making is preserved and now says the client's form _marks_ which
> answers belong on a sheet.
>
> Validated with the server's own tooling: `npm run check:openapi` passes ("matches all 79
> registered routes") and `prettier --check` is clean. Client types regenerated; `npm run check`
> passes at 665 tests.

**(a3) ~~What does a referrer see above the household composition grid?~~ ANSWERED —
"Household composition".** The `questionTitle` had been changed to "Generated", which is the stored
label the admin answers list already excludes by key, but it is also rendered as the `<legend>` on
the public form (`referral-question-field.tsx:178`) — so a referrer would have been asked to fill in
a grid headed "Generated". Reverted that one line; nothing else touched.

**(b) ~~The listener sheet has four columns and the spec describes five.~~ ANSWERED and BUILT.**
Pete: _"the listener sheet should show whatever is required based on the config file for the referral
questionnaire"_ — the same arrangement as the fuel help list and the pick-list information.

> **What the investigation turned up first.** The missing column was not the whole story. The screen
> read `answers['Cause Details']`, and **`Cause Details` is not a key in the current questionnaire**
> — it survives only in `referral-answer-keys.frozen.ts` as a key the form once released. So that
> column read "None given" on every sheet of every session, while the two questions the charity
> actually asks — `reasonAdditional` ("Additional information about crisis") and `Secondary`
> ("Secondary cause of crisis") — never reached the page at all. The spec's "other information" and
> "secondary reason" were both missing, and the fourth column was dead.
>
> **This is the third instance of one failure mode**, after the fuel list's `needsFuelHelp` and the
> server's `dietaryNotes`: a key hard-coded or marked in one place, not present in the data, showing
> as a permanently empty column that no test and no reviewer notices. It is the strongest argument
> in this review for the marker-driven approach, and for the guard that comes with it.
>
> **Built:** a `forListenerSheet` marker on the question schema, and `listener-sheet.logic.ts`
> mirroring `fuel-help.logic.ts` — columns selected by the marker in form order, values read through
> a `KEY_FIELD_READERS` map that is the list of what the endpoint can actually fill, and anything it
> cannot fill dropped rather than printed blank. The screen now holds no list of its own. Six
> questions are marked, giving the five things `screenDetails.md` asks for. `screenDetails.md` and
> `.claude/rules/printing.md` both updated to say the marker decides.
>
> **The privacy boundary is unchanged and now stated twice.** `GET /sessions/{id}/listener-sheet`
> sends the name, the reason's label, the fuel flag and the answers whole — no address, postcode,
> phone or date of birth — so a marker cannot widen what reaches the page. A test marks
> `refereePostcode` for the sheet and asserts it produces no column.
>
> Verified the marker is load-bearing by removing it from `Secondary` and watching the test fail on
> the missing column.

**What it said before:** `screenDetails.md:121`
requires "the household name, other information, reason for crisis, secondary reason and the
fuel-help flag". `listener-sheet-screen.tsx` renders Name / Reason for referral / Cause Details /
Fuel help. Whichever of "other information" and "secondary reason" is missing, it is missing from
the only sheet on which a team leader may see a reason at all — so it is worth being certain rather
than inferring.

---

## F7 — The Google Identity script is a third-party script on a page that holds referral data

> **CLOSED — the charity accepts it.** Recorded in
> `docs/engineering/personal-data.md` under "Sending household data off-origin", dated, and naming
> what was accepted: that household rows leave the system into the charity's own spreadsheet, that
> Google's script runs in a page holding referrals, and that the Sheets token lives in memory for the
> length of a run. `.claude/rules/pii-security.md` now points at it, and both say the acceptance
> covers `/extracts` **and nothing else** — analytics, error reporting and session replay still need
> their own conversation.
>
> An undocumented sign-off is indistinguishable from no sign-off six months later, which is the whole
> reason this is written down rather than closed silently. The two hygiene improvements (drop the
> injected `<script>` on unmount, revoke the token on finish) are noted there as not done; neither
> changes what was accepted.

**Severity: worth a conscious decision, not a code defect.** `src/features/extracts/google-auth.ts:37-51`.

`loadGis()` injects `https://accounts.google.com/gsi/client` into the document. That script runs with
full access to the DOM of an authenticated staff session and to the in-memory access token's
consequences. This is inherent to using Google Identity Services and there is no meaningfully safer
way to do OAuth in a browser — but `CLAUDE.md` says anything sending data off-origin needs the
charity's sign-off, not just a technical one, and the extract screen's own copy admits it ("This
sends household details outside this system").

**What to do:** confirm the sign-off happened and record it in `docs/`, alongside a note that a CSP
`script-src` for this origin is the one mitigation available. Two cheap improvements while you are
there: remove the injected `<script>` on unmount, and call `google.accounts.oauth2.revoke()` in
`stop()` so the token `screenDetails.md` promises is "kept only while the extract is running" is
actually withdrawn rather than merely dropped from a ref.

---

## F8 — `STATUS.md` describes a client that no longer exists

> **FIXED.** Test count corrected (69 → 81 files, 664 tests) and "twelve menu destinations" →
> seventeen. Five rows added to the Implemented table for everything after slice 11 — running a
> session, the listener and referral-details sheets, SMS, fuel help, the extract and search. No slice
> numbering existed past 11, so I continued the sequence; renumber if yours differs.
>
> Three "Not implemented" entries were removed because they are built: pick lists/printing/
> attendance, `POST /sessions/{id}/confirm`, and the referral answers editor — which turned out to be
> built exactly as that entry said it should be, reusing `ReferralQuestionField`. Slice 9's row still
> said "read-only answers"; corrected. **W4 added** as a genuinely unimplemented item.
>
> The open-questions table was the worst of it: **five of its six rows were closed questions.** Only
> Q12 survives. It now mirrors the real set — Q12, Q20, Q27, Q29, Q30, Q32, Q33 — each with what this
> client does meanwhile, and carries a note that `OPEN-QUESTIONS.md` is the authority and this is a
> mirror. I answered none of them. Q2 is closed too (retention settled at twelve months), so the
> purge row now describes a deployment step rather than a question.

**Severity: medium (the file `CLAUDE.md` sends people to for "what is built" is wrong).**

Its "Not implemented" section says:

> **Pick lists, printing and attendance.** No `src/features/pick-lists/` exists. This is the largest
> remaining area…

`src/features/pick-lists/` is thirteen files, a 798-line screen, the print view, the listener sheet,
attendance, SMS and preference rules, with four test files covering them. The same section still
lists `POST /sessions/{id}/confirm` as out of scope; `useConfirmSession` exists and is wired to the
Complete session button.

Also stale: "green at 69 test files" (it is 81), "All twelve menu destinations" (`MENU` has
seventeen), and the Implemented table stops at slice 11 with no row for fuel help, extracts, SMS,
preference rules or run-sessions.

**Fix.** Bring the table up to date and delete the three false "not implemented" bullets. Worth
doing before the next session reads it and re-plans work that is finished.

---

## F9 — Accessibility: the disabled print button explains itself only to people who can see

> **FIXED.** Both copies replaced by one `PrintUnavailable` component: `aria-disabled` instead of
> `disabled`, so the control stays in the tab order, with `aria-describedby` tying it to the reason.
> The unavailable look had to be drawn in CSS, because only the real attribute gets it from the
> browser — kept legible rather than greyed to the edge, since somebody will now land on it. The
> existing assertion was `toBeDisabled()`; it now checks the control is **not** disabled, is
> `aria-disabled`, and has the accessible description.

`run-sessions-screen.tsx:301` and `:448`.

```tsx
<button disabled type="button">Print all pick lists</button>{' '}
Review every pick list before printing.
```

A `disabled` button is removed from the tab order, so a keyboard or screen-reader user never lands
on it and never hears the sentence next to it. They see a link that has silently become a
non-interactive control.

**Fix.** `aria-disabled` plus a no-op handler, with the explanation associated:

```tsx
<button aria-describedby={reasonId} aria-disabled type="button" onClick={preventDefault}>
  Print all pick lists
</button>
<span id={reasonId}>Review every pick list before printing.</span>
```

`sms-panel.tsx:43` already uses `aria-disabled` with a ref guard for exactly this reason — the good
pattern is in the codebase, just not applied here.

## F10 — Accessibility: attendance buttons are indistinguishable in a button list

> **FIXED.** Each button is now named `Attended — pick #1, Sam Taylor`. The visible words come
> first, so the name still starts with what a voice-control user says and what a sighted user reads
> (WCAG 2.5.3, Label in Name).
>
> Worth noting for the pattern: two existing assertions were `queryByRole('button', { name:
'Attended' })).toBeNull()`. Those kept passing after the change — but **for the wrong reason**,
> matching nothing rather than finding nothing, so they would no longer have caught the buttons
> appearing when they should not. Both are now `/^Attended/`. This is the vacuous-assertion trap in
> `testing.md` in its quietest form: the tests never went red.

`run-sessions-screen.tsx:363-385`. Every row renders buttons named only "Attended" and "No show".
A screen-reader user pulling up the button list on a session with twenty households gets twenty
identical pairs. The pick number and name are in the surrounding `<li>` text, which does not become
the accessible name.

**Fix.** `aria-label={`Mark pick #${parcel.pickNumber} ${name} attended`}` on each. These are the
buttons that move stock and decide whether a household is recorded as fed; ambiguity here is not
cosmetic.

## F16 — `.claude/rules/printing.md` describes an unbuilt feature and contradicts the shipped one

> **FIXED, and the domain question turned out not to be one.** I had flagged the attendance conflict
> as needing Pete. It did not: the server's `API.md` settles it, and says the **client** is right —
> _"An outcome can be taken back while the session is open… no confirmation dialogue is warranted for
> a tap that is reversible. Confirming the session ends that… put the weight of the confirmation on
> the session."_ Reading the contract is explicitly allowed; only what the charity wants needs Pete.
>
> Corrected across four rule files, each claim checked against the generated schema or the server's
> docs first — see the sweep at the end of this section for what else was wrong and what was
> verified as still true.

**Severity: medium (a rule file that misleads is worse than no rule file).** Found while fixing F10,
because that rule file is loaded automatically when you touch these files — so it is read by whoever
next changes attendance, and it is wrong twice.

**It opens by saying the area does not exist:**

> There is no PDF endpoint. **Printing is the browser's print dialog against a print stylesheet**…
> Nothing in this area is built yet — see `STATUS.md`.

Pick lists, printing, the listener sheet and attendance are all built and tested. This is the same
staleness as F8, in a file that carries more authority because it is presented as a rule.

**And its attendance section contradicts the code, the tests and `screenDetails.md`:**

> **The outcome is final.** Submitting the _other_ outcome afterwards is refused with `409`; a
> confirmed collection or delivery cannot be undone. … **confirm before sending in the first place —
> this is the one tap in the app that cannot be taken back.**

The shipped behaviour is the opposite, deliberately and with its own comment
(`run-sessions-screen.tsx`: _"A recorded outcome stops the parcel changing, but does not stop it
being corrected. Only confirming the containing session locks both."_), its own test
(_"allows a reviewed household outcome to change while its session remains open"_, which asserts no
"cannot be undone" warning appears), and its own line in `screenDetails.md` (_"Once reviewed,
Attended/Delivered and No Show/Not in become clickable"_).

I have **not** changed either the rule file or the behaviour. Which is right is a domain question:
if an outcome really is irreversible until the session is confirmed, the buttons need a confirmation
step they do not have; if it is correctable while the session is open — which is what the client
implements and what a hall actually needs — then `printing.md` should say so. **Only Pete can settle
that**, and it is the server's contract that decides whether the `409` exists, so it belongs in
`../foodbankserver/OPEN-QUESTIONS.md`.

### The sweep of all ten rule files

Every factual claim checked against the generated schema, the server's `API.md`, or the code.

**Corrected:**

| File              | Was                                                                           |
| ----------------- | ----------------------------------------------------------------------------- |
| `printing.md`     | "Nothing in this area is built yet" — it is all built                         |
| `printing.md`     | Attendance final, confirm each tap — the opposite of the contract             |
| `printing.md`     | "Show `dietaryNotes`" — removed from the contract; it is the parcel's `notes` |
| `printing.md`     | "The referral's own id goes on the sheet" — `PrintParcel` has no id           |
| `printing.md`     | "`skipped` lists referrals with no model parcel" — replaced by five counters  |
| `printing.md`     | A `paths:` glob (`src/**/*print*`) matching no file in the repo               |
| `testing.md`      | Attendance priority repeating the "outcome is final" error                    |
| `pii-security.md` | The same `dietaryNotes` line                                                  |
| `api-contract.md` | `RecurringSessionPatch` cited as a live `@ts-expect-error`; there are none    |

**Checked and still true** — recorded so the next reviewer need not repeat it:
`authentication.md` (including its W1 caveat, still accurate), `data-fetching.md` (the SMS-summary
polling exception is real — `refetchInterval: 5_000`), `time.md`, `deployment.md`,
`public-referral-flow.md` (Turnstile genuinely is the one outstanding piece),
`referral-form.md` (`KEY_FIELD_NAMES` matches the sixteen it lists), and every cross-document link
in all ten files.

**One rule was kept rather than matched to the code.** `printing.md` requires the confirm `409`'s
`pendingPickNumbers` to be shown; nothing shows them, and `pendingPickNumbers` in `lib/errors.ts` has
no caller. `CLAUDE.md` says not to weaken a rule to make it pass, so the rule stands and the gap is
now **`DEFERRED-WORK.md` W4**, with a "the code does not yet match this" note in the rule file
following the pattern `authentication.md` already uses for W1.

**Also corrected, in code rather than a rule:** `referral-form-definition.ts` claimed five key fields
were "pending on the server". All sixteen are on `ReferralSubmission` now.

## F11 — Small consistency and robustness points

> **RECORDED as outstanding — `DEFERRED-WORK.md` W5**, grouped so they can be done in one pass rather
> than argued about one at a time. The referral-details query key, built inline rather than named in
> `keys.ts`, is folded in as a seventh item.

- **`sms-panel.tsx:190`** — one shared `useMarkSmsRead()` for the whole list means clicking "Mark
  read" on any message disables every other message's button while it is in flight. Move the
  mutation into a per-message component, as `ClientRow` already does for attendance.
- **`sms-panel.tsx:107`** — a failed `markRead` is silent. `reply.isError` is surfaced; this one is
  not, so a message stays unread with no indication why.
- **`sms-panel.tsx:173`** — `UnmatchedSmsScreen` hand-rolls an `<h1>` instead of using `PageHeader`,
  the only screen in the app that does.
- **`google-sheets.ts:17`** — `readMappings()`'s return value is discarded; it is called purely for
  its validation side effect. Either use the map or rename it to say what it does
  (`assertMappingsValid`).
- **`pick-list-information.ts:29`** — `{ key: question.key, label: question.key }` carries the same
  value twice. If the label really is the key by design (and `screenDetails.md:58` implies it is),
  drop the field; if it was meant to be `question.label`, the printed sheet is currently showing
  keys where it should show questions.
- **`lib/errors.ts:176`** — `readEnvelope` returns `null` for any `code` outside the union, which
  discards the server's `message` along with it. If the server ever adds a code, `409` and `422`
  silently degrade to "Something went wrong" — the exact failure the module comment exists to
  prevent. Validate `message` independently of `code`.
- **`fuel-help-list-screen.module.css`** (working tree) — the new `.tableWrap:focus-visible` outline
  uses `#005a9c` where the global rule in `index.css:27` uses `#0b5fff`, and the global rule already
  covers this element. Delete the override.

## F15 — `npm run check` does not currently pass, on two counts

Both pre-date this review; neither is caused by anything in it. Worth stating plainly because
`CLAUDE.md` makes a green `check` the definition of done, so anyone finishing a change right now
will hit them and may assume they broke something.

**(a) ~~`api:types:check` fails — `src/api/schema.d.ts` is a server release behind.~~ FIXED.** The
only difference was the `refereeDateOfBirth` the fuel list gained in server commit `3dac152`.
`npm run api:types` regenerated it as part of F3; the change was purely additive.

**(b) ~~The suite times out under load.~~ FIXED — `testTimeout: 15_000` in `vitest.config.ts`.**
Every failure seen was `Test timed out in 5000ms`, never an assertion — and the set of victims
changed run to run:

| Run                                       | Result                             |
| ----------------------------------------- | ---------------------------------- |
| First full run, machine otherwise idle    | 656/656 pass, 38s                  |
| `git stash` (master, clean, machine busy) | 6 fail across 3 files              |
| Two suites running concurrently           | 14 fail across 7 files, 69s        |
| Idle machine                              | 1 timeout (`public-referral`) only |
| Idle machine, immediately after           | **662/662 pass, `check` exit 0**   |
| Every isolated single-file run            | pass, every time                   |

**Caveat on my own measurements:** the middle two runs were taken while I had other test runs going
in the background, so they overstate it. Discount them. What survives is the last three lines: the
same tree passes or fails purely on how busy the machine is, and two different tests in
`public-referral-screen.test.tsx` have each tipped over the 5-second limit once. That file takes
about 40 seconds on its own.

So this was a **thin timeout margin**, not a broken suite — thin enough that a loaded CI runner or a
developer with a build going saw red for no reason anybody could act on.

Measured per test on an idle machine, the two that failed take **1486 ms** and **1206 ms**, and the
slowest in the file is 1514 ms. The cost is not waiting on anything: `fillPageOne` is about
eighty-five keystrokes and seven select changes against a form built at runtime from the
forty-three-question config, where every answer re-evaluates the conditional guards, plus the
referrer-address check's real 400 ms debounce, which those tests deliberately do not fake. Neither
test crosses more than one page — the first one's "next" click is a _blocked_ transition that stays
on page one.

`testTimeout: 15_000` gives roughly ten times headroom on the slowest test while still failing a
genuine hang promptly.

**That was only half the fix, and the second half is the interesting one.** A later loaded run failed
two _different_ tests, with a completely different message: not "timed out" but _"Unable to find
role=button and name 'Send SMS reminders'"_. That is **Testing Library's** `asyncUtilTimeout`, which
bounds a single `findBy*` or `waitFor` and defaults to **one second** — a separate clock that
`testTimeout` does not touch. Both tests passed in isolation.

This one is nastier than a timeout, because it does not look like a timing failure at all: it reads
as a missing element and sends you hunting for a bug in the screen. `test/setup.ts` now sets
`asyncUtilTimeout: 5_000`, still far below `testTimeout`, so a test that genuinely hangs still fails
on the element it could not find rather than on the clock.

Both verified under deliberate contention — three concurrent runs of the slowest file alongside a
full `npm run check` — 55.3 s against 34.4 s idle, green.

**(c) ~~Three fuel-help tests fail against the config as it now stands.~~ FIXED with F3.**
`referral-form.config.json` changed on disk mid-review (not by me), taking `forFuelTeam` off
`needsFuelHelp` — which answered F6(a) — while the tests still expected the column. Both test files
are now updated to the settled behaviour.

The same edit also reformatted the JSON in a style Prettier disagrees with and dropped the trailing
newline. **The cause is not an editor: `referral-form.config.json` is generated from the charity's
questionnaire spreadsheet**, so every questionnaire change re-imports that formatting and
`npm run check` would fail until somebody reformatted a file they did not hand-write.

Fixed by adding it to `.prettierignore`, alongside `schema.d.ts` and `worker-configuration.d.ts`
under the same reasoning already recorded there: generated files are not held to a hand-formatting
standard. Verified by regenerating the file in the exporter's shape and confirming `format:check`
passes.

**Related, and worth knowing:** a test was matching the household composition grid by the question's
own heading (`/^Household composition/`, case-sensitive). That heading is editorial text a volunteer
edits in the spreadsheet, and it has now been reworded twice — "Household composition" → "Generated"
→ "Household Composition", the last of which the regex would not have matched. The test now finds
the grid by its cell labels, which the grid component builds, so rewording the question can no
longer fail a test about whether a household contains an adult. **The general lesson: a test may
assert on questionnaire text only when that text is what it is testing.**

## F12 — Test gaps worth closing

The suite is strong where `.claude/rules/testing.md` says it should be — the print test at
`run-sessions-team-lead.test.tsx:723` really does assert a reason cannot render even when the server
sends one, which is the hard version of that rule. Three gaps:

1. ~~**The fresh-spreadsheet extract path** (F2).~~ Covered.
2. ~~**A session ended by a 401, then a different sign-in** (F1).~~ Covered.
3. **`SessionSmsPanel` and `UnmatchedSmsScreen`** have no test of their own beyond the one
   reminder-sending case in `run-sessions-team-lead.test.tsx:106`. SMS is a channel that carries
   text to a household's phone; the "never include a name or address" warning and the reply path
   deserve their own file.

## F13 — Things I checked and found correct

Recording these so the next reviewer does not spend the time again: the single-flight refresh and
its cross-tab lock (the timeout, the abort race and the `finally` that clears `inFlight` are all
right); `unwrap`/`unwrapVoid`'s 204 split; the retry policy, including the 429 exception; the Worker
forwarding requests unmodified so `cf-connecting-ip` and `Set-Cookie` survive; `safeNextPath`'s
open-redirect guards including `/\`; `hasAdminFields` keying on the _response_ rather than on a role
from `useAuth`; every calendar date pinned to UTC and every instant to `Europe/London`; the print
view withholding the reason; and `ConfirmDialog`'s focus trap and focus return. The known
unverifiable items in `KNOWN-GAPS.md` (real `LockManager`, real `<dialog>`, print on paper) are
correctly described and I have nothing to add to them.

## F14 — Already owned elsewhere, not re-raised

`DEFERRED-WORK.md` W1 covers `runRefresh()` signing the user out on any refresh failure and the
missing eight-hour-cap handling. It is accurate and its analysis is right; F1 above is a _different_
bug on the same code path (the cache, not the sign-out), so fixing W1 does not fix F1.

---

## Suggested order

Nothing is left open in this document. What it leaves behind, in the places the repo keeps such
things:

- **`DEFERRED-WORK.md` W5** — the six small consistency points from F11, plus the inline query key.
- **`DEFERRED-WORK.md` W1 and W3** — both predate this review and both still stand.
- **`OPEN-QUESTIONS.md` Q12, Q20, Q27, Q29, Q30, Q32, Q33** — untouched, and only Pete closes one.
- **A `forListenerSheet` column in the questionnaire spreadsheet.** Without it the next import drops
  the markers this review added and the listener sheet silently loses its columns.

**One thing to do before the next questionnaire import.** The `forListenerSheet` markers were
written into `referral-form.config.json`, which is generated from the charity's spreadsheet — so the
spreadsheet needs the same column that already carries `forFuelTeam`, or the next import silently
drops them and the listener sheet loses its columns. This is W3's whole argument in miniature.

## A note on the questionnaire pipeline

Three of the problems in this review came through `referral-form.config.json` rather than through
code: a marker the endpoint could not honour (F3), formatting that fails `check` on every import
(F15c), and a reworded heading that a test was matching on. The file is generated from a spreadsheet
a non-developer edits, and it drives what a referrer is asked, what the fuel team sees, and what goes
on a pick sheet — but nothing between the spreadsheet and the repo checks any of that.

`STATUS.md` already names this as unbuilt ("Automated questionnaire import and release workflow",
`DEFERRED-WORK.md` W3) and calls it a go-live prerequisite. This review is evidence for that
sequencing: the guards that exist (`reusedKeys`, `unrecordedKeys`) catch key-ledger mistakes, and
every problem found here slipped past them because none of them is about keys. Worth adding to W3's
scope when it is built: a marked field the relevant endpoint does not return, and formatting
normalised on import rather than argued about afterwards.
