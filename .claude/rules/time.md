---
paths:
  - 'src/lib/london-time.ts'
  - 'src/lib/london-time.test.ts'
  - 'src/features/sessions/**'
---

# Time rules

Sessions store the wall clock the charity typed (`date` + `startTime` like `"10:00"`) plus a derived
`startsAtUtc`.

- **`Europe/London` is the only local timezone.** **Display `startTime`. Sort and filter on
  `startsAtUtc`.** A 10:00 session stays `"10:00"` across the BST changeover.
- **Never send `startsAtUtc`** — the server derives it. Send the date and the wall-clock time.
- **Never build a `Date` from a session's date and time and format it back.** A browser in another
  timezone moves every session by hours. Format the strings you were given, or use
  `Intl.DateTimeFormat` with `timeZone: 'Europe/London'` explicitly.
- **A `sessionDate` is a calendar day with no instant attached, so it is formatted in UTC on
  purpose.** `new Date('2026-08-04')` is midnight _UTC_; formatting it in a zone behind Greenwich
  moves the session to the day before. London is safe only by the accident of never being behind UTC,
  which is not a reason to rely on the device's zone. `formatSessionDate` is the worked example.
- **All of this lives in `src/lib/london-time.ts`, pure and directly tested.** `toLocaleDateString`,
  `toLocaleTimeString` and `toLocaleString` are banned everywhere else by a lint rule, because they
  silently format in the device's timezone. **Do not add a date library** — `Intl` covers it.
- Volunteers use their own phones and laptops. **Assume at least one has the wrong timezone set**,
  and make that harmless.
