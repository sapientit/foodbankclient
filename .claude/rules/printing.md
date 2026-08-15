---
paths:
  - 'src/features/pick-lists/**'
  - 'src/components/app-shell.module.css'
---

# Pick list and printing rules

There is no PDF endpoint. **Printing is the browser's print dialog against a print stylesheet**, used
every session by somebody who cannot debug it.

**All of this is built**, in `src/features/pick-lists/`: the run-session screens, the picking sheets,
the listener sheet, the session referral-details sheet, attendance and the SMS panel. These are rules
for changing it, not a plan for writing it.

## What must never reach a sheet

- **Never print the reason for referral on a picking sheet.** Sheets get carried round halls and
  left on tables. A test must assert the picking-sheet payload cannot render one **even if the
  server sends it**.
- **The listener sheet is the sole exception.** It is one sensitive sheet per session, for selected
  listeners only. **What it shows is chosen by the referral form's `forListenerSheet` marker**, not
  by a list in the screen — the charity decides what a listener needs by marking the questionnaire.
  It uses `GET /sessions/{id}/listener-sheet`, whose narrow payload is the boundary: it sends the
  name, the reason's label, the fuel flag and the answers whole, so **no other referral field can
  reach the page and no unmarked answer may**. A marked question the endpoint cannot fill is left
  out rather than printed empty. The server has already excluded delivery, cancelled and rejected
  households. `listener-sheet.logic.ts` is where both rules live.
- **The referee's name goes on every sheet.** A volunteer handing a bag over needs to know it is the
  right one. Reversed deliberately on 2026-08-05 — `screenDetails.md`, "The printed picking sheet".
- **Do not print the address, postcode or phone unless `isDelivery` is true**, where the address is
  the point and the sheet also says `DELIVERY`.

## Layout

- **`GET /pick-lists/{id}/print` returns lines already ordered by shelf** so a picker walks the aisle
  once (`A1, A2, A10` — not alphabetical). **Render in the order given. Never re-sort.**
- **One sheet per parcel**: `break-after: page` between parcels, `break-inside: avoid` on a parcel's
  line table. Fetch the whole payload once and render every sheet — no lazy loading, no
  virtualisation, no per-sheet request.
- **Show the pick number large.** It is how a sheet gets matched to a bag in a hall. It is also the
  only identifier on the sheet: `PrintParcel` carries no referral id, deliberately, and a sheet is
  traced back through the session's pick list rather than by printing one.
- **Show the parcel's `notes` prominently** — the pick-list information, which the picker is the only
  person in a position to act on. It is composed by this client when the pick list is created, from
  the questions the form marks `pickListInformation`, and saved on the parcel; the sheet prints what
  was saved, never the referral's answers as they read today. `buildPickListInformation` is where it
  is assembled. **There is no `dietaryNotes`** — it was removed from the contract because it scanned
  four guessed key names, none of which the real form uses, so it would have been `null` from the day
  the questions shipped.
- `@media print` drops navigation, buttons and colour. Test at A4. Keep the print layout in its own
  stylesheet next to the print component. `src/components/app-shell.module.css` already carries the
  frame — `@page` margins and the nav/controls/colour drop — so inherit it rather than fight it.

## The API's shape, which the UI must not smooth over

- **Generation is idempotent.** A repeat `POST /sessions/{id}/pick-list` returns the existing list
  with `parcelsCreated: 0`. Just `POST` when the screen opens; no "does it exist yet" branch.
- **Reconciling reports counts, and they are the only feedback there is.** `parcelsCreated`,
  `linesCreated`, `preferenceLinesApplied`, `preferenceLinesDropped` and `preferenceReferralsIgnored`.
  A non-zero `parcelsCreated` after the list was printed means a late referral arrived and the sheets
  need printing again — say so. `preferenceLinesDropped` counts lines whose stock item was retired
  since the catalogue loaded; they are dropped rather than refused, so a retired item cannot stop a
  session generating.
- **Lines are editable while `draft` and after `printed`.** The list locks only on `confirm`. This is
  not an oversight: pickers discover shortages at the shelf, holding a printed sheet. **A UI that
  disables editing after printing breaks the actual workflow.**
- **`PUT /parcels/{id}/lines` with `quantity: 0` removes the line.** That is how "we had none" is
  recorded — do not send a delete, and do not treat 0 as invalid input.
- **`GET /pick-lists/{id}/divergence` is advisory. Nothing is applied automatically and there is no
  sync endpoint.** Present it as a warning and let a human decide.

## Attendance — where stock actually moves

Not on confirm. `attended` issues the parcel and decrements stock; `no_show` moves nothing and the
parcel is unpacked. One or the other must be recorded for every parcel. A delivery uses the same two
values — _delivered_ is `attended`, _not in_ is `no_show`. Label them for the driver if that reads
better, but **do not expect a third or fourth state.**

- **Submitting the same outcome twice is safe.** `alreadyRecorded: true` means stock did not move
  again. Disabling the button is kinder but not load-bearing.
- **An outcome can be taken back while the session is open, and that is the point.** Submitting the
  _other_ value puts the stock back and marks the household the other way, as often as needed. It is
  the only way to fix a mis-tap, so **offer it plainly and do not put a confirmation in front of it**
  — a dialogue guarding a reversible tap teaches people to dismiss dialogues. `screenDetails.md` says
  the same thing from the screen's side: "Once reviewed, Attended/Delivered and No Show/Not in become
  clickable."
- **Confirming the session is what ends that**, and it is the tap in this app that cannot be taken
  back. After `POST /sessions/{id}/confirm` a change is a `409`, so the controls are hidden once the
  session reads `confirmed` rather than left to fail. **Put the weight of the confirmation on the
  session, not on each household.**
- **`POST /sessions/{id}/confirm` refuses while anyone is unmarked** and returns
  `details.pendingPickNumbers`. **Show those numbers** — the team lead needs to know who is missing,
  not that something went wrong. There is no override.
- **Stock levels can be negative** after a correction. Do not assume non-negative and do not render a
  negative level as an error.

The `409` is only reachable by a race, because `Complete session` is disabled until every parcel on
screen has an outcome — so it takes a late referral reconciled in by somebody else between the screen
loading and the tap. `SessionRefusal` in `run-sessions-screen.tsx` is what shows it, and there is a
test named for the rule.
