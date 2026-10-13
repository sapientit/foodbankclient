# Session Run Sheet changes — server handoff

Pete settled six client changes on 2026-10-13. Three need the server: a new referral field, a
change to how a referral is cancelled, and a change to what a parcel's `notes` mean. This is the
ordered server work. The client requirements are in `screenDetails.md` (Session processing, the
pick-list sheet, and the referral detail screen); the domain wording below is for the server's spec,
which the server repo owns.

Nothing here is a client guess: each point was settled by Pete in conversation. Where a detail was
not settled it says so.

## 1. A new referral field: `picklistAdmin`

The name is Pete's. An administrator's one line for the picker — what the office needs whoever
packs the bag to know that the referral form does not ask.

1. Migration: a nullable `picklist_admin` text column on referrals. No backfill.
2. `Referral.picklistAdmin`: `type: [string, 'null']`, `maxLength: 80`. **Admin only**, on the
   same responses as `adminInfo` (the single-referral responses). Absent for a team lead.
3. `ReferralAmend.picklistAdmin`: settable by an administrator under exactly the rules that already
   govern `adminInfo` — the same lock once the referral can no longer be changed. `null` or blank
   clears it. More than 80 characters is a `422`.
4. **`Parcel.picklistAdmin`: required and nullable, returned to a team lead as well.** It is the
   referral's **current** value, read when the parcel is read — not a snapshot taken at
   generation. It heads the parcel's Information for pickers on the client workspace and on the
   printed sheet, so the team lead must receive it there even though they never receive it on the
   referral. `PrintParcel` does not need it: the print screen already joins each sheet to its
   session parcel.
   **It is printed on the picking sheet, which must never carry the reason for referral**, and
   only the administrator typing it stands between the two. The server cannot enforce that; the
   client's edit dialog will say plainly that the line is printed for pickers.
5. It is **not** on the listener sheet, the referral-details list, the fuel help list, SMS, the
   spreadsheet extract or `ReferralSearchResult`. It is deleted with the referral at the
   fifteen-month purge.
6. **Not settled:** whether a copied referral carries it. Ask Pete before choosing; the client sends
   nothing for it on copy either way.

## 2. Cancelling a referral writes the administrator notes, not a reason

The separate cancellation reason goes. The cancel dialog now shows the existing administrator
notes, editable, with a prompt to add the reason for cancelling to them.

1. `POST /referrals/{id}/cancel` request body: **remove `reason`**; add optional
   `adminInfo` (`type: [string, 'null']`, `maxLength: 2000`, the same rules as
   `ReferralAmend.adminInfo`). When present it replaces the referral's `adminInfo` **in the same
   transaction as the cancellation**. When the cancel is refused (`409`, `404`, `422`) nothing is
   written — in particular, notes saying "cancelled because…" must never be saved on a referral that
   was not cancelled. Absent means the notes are untouched.
2. Stop storing the referral cancellation reason. Pete: **the existing values do not need to be
   kept** — drop the column (or whatever holds it) in the migration.
3. The idempotent repeat cancel of an already-cancelled referral may still write `adminInfo`, or
   may ignore it — either is fine for the client; say which in the contract.
4. Session cancellation (`Session.cancelledReason`) is **not** affected.

## 3. A parcel's `notes` now hold only the "No longer stocked" note

The editable Information for pickers is gone. It is now composed by the client every time it is
shown or printed, from three parts in this order, each omitted when empty and each on a new line:

1. the referral's `picklistAdmin` (section 1);
2. a `key: value` line for each answer the parcel's own form release marks for pick-list
   information — the client composes these from `Parcel.answers` and `formId`, as it did at
   generation;
3. the parcel's stored `notes`, which from now on hold only the `No longer stocked: …` line the
   client writes at generation, when a historic release named an item that no longer resolves.

So:

1. `GeneratePickListRequest.pickListInformation` stays, unchanged in shape. The client will send
   an entry only for a referral with unavailable stock, holding just that line. Update the
   description.
2. `PATCH /parcels/{id}`: **remove `notes`**. Nobody edits it any more.
3. `Parcel.notes` and `PrintParcel.notes` descriptions change: no longer the whole pick-list
   information, and no longer "show this rather than recomposing it from `answers`" — the client
   now does recompose from the answers, deliberately.
4. Pete: there is no history in this field to worry about. Existing parcels' `notes` hold the old
   full snapshot, which would print twice beside the composed lines, so **set every existing
   parcel's `notes` to `null`** in the migration.
5. `Parcel.answers` must stay readable by a team lead, as it is now: the printed sheet now depends
   on it.
6. A completed session still shows its sheets "as they were printed". Composing on display keeps
   that only because nothing it reads can change once the session is closed: the answers and
   `picklistAdmin` are both locked with the referral. Keep `picklistAdmin` under that lock.

## 4. The server's spec

`INITIAL_SPEC1.txt` needs its wording brought into line, with Pete:

- the pick-list information paragraphs (around "Beside the parcel's contents there is its pick-list
  information" and "What is printed is what was saved"): it is now composed afresh from the pick
  list admin line, the marked answers and the "No longer stocked" note, and the team leader no
  longer edits it;
- the referral cancellation reason, wherever it is described: replaced by the administrator notes,
  saved together with the cancellation;
- the screen called "Run a session" is now **"Session Run Sheet"**.

## 5. What the client does, and when

All six are built. The rename, the `Other` column and the referral-details order needed nothing from
the server. The pick list admin notes panel, the cancel dialog and the composed read-only
Information for pickers were built against this contract once the server published it on
2026-10-13. One point the server settled that this handoff left open: a copied referral carries its
`picklistAdmin` across.
