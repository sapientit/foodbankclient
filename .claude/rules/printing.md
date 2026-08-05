---
paths:
  - 'src/features/pick-lists/**'
  - 'src/**/*print*'
  - 'src/components/app-shell.module.css'
---

# Pick list and printing rules

There is no PDF endpoint. **Printing is the browser's print dialog against a print stylesheet**, used
every session by somebody who cannot debug it. Nothing in this area is built yet — see `STATUS.md`.

## What must never reach a sheet

- **Never print the reason for referral. Not even for an admin.** Sheets get carried round halls and
  left on tables. A test must assert the print payload cannot render one **even if the server sends
  it**.
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
- **Show the pick number large.** It is how a sheet gets matched to a bag in a hall. The referral's
  own id goes on it too, so a sheet can be traced back to the referral behind it.
- **Show `dietaryNotes` prominently.** The picker is the only person who can act on them.
- `@media print` drops navigation, buttons and colour. Test at A4. Keep the print layout in its own
  stylesheet next to the print component. `src/components/app-shell.module.css` already carries the
  frame — `@page` margins and the nav/controls/colour drop — so inherit it rather than fight it.

## The API's shape, which the UI must not smooth over

- **Generation is idempotent.** A repeat `POST /sessions/{id}/pick-list` returns the existing list
  with `parcelsCreated: 0`. Just `POST` when the screen opens; no "does it exist yet" branch.
- **`skipped` lists referrals with no model parcel for their household size.** Show it as a warning
  an admin can act on — the rest of the list is still pickable.
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
- **The outcome is final.** Submitting the _other_ outcome afterwards is refused with `409`; a
  confirmed collection or delivery cannot be undone. A mis-tap is put right with a stock adjustment
  (`POST /stock/adjustments`, which a team lead may also do), which leaves the correction on the
  record. **Surface that message rather than swallowing it, and confirm before sending in the first
  place — this is the one tap in the app that cannot be taken back.**
- **`POST /sessions/{id}/confirm` refuses while anyone is unmarked** and returns
  `details.pendingPickNumbers`. **Show those numbers** — the team lead needs to know who is missing,
  not that something went wrong. There is no override.
- **Stock levels can be negative** after a correction. Do not assume non-negative and do not render a
  negative level as an error.
