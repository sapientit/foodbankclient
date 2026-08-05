# The referral form is ours, not the server's

The enforceable rules are in [`.claude/rules/referral-form.md`](../../.claude/rules/referral-form.md).
This file is the reasoning, and the design of the machinery in `src/features/referrals/`.

## The publishing mechanism is a release of this client

There is no `GET /public/referral-form`, no draft or publish call, and no form-maintenance screen to
build. The server **had** one — versioned `form_definitions` / `form_fields`, a publish flow and an
answer-validation module — and it was removed: migration `0008` dropped both tables and
`referrals.form_definition_id`.

So the questions are configuration in this application. Change them here, see them in the test system,
publish them by releasing a new version of the client.

That moves a set of constraints from the server to us, and **nothing else enforces them**:

- **The server validates `answers` against nothing.** Required, max length, option lists and which
  questions appear at all are enforced here, before submit, or not at all.
- **The only server-side limits are size** — at most 100 keys, keys at most 60 characters, 16KB
  serialised. That is a bound on an unauthenticated write, not form validation, and no real form
  approaches it.
- **Unknown keys are stored, not dropped.** The server has no list to compare them against, so a
  renderer must show a key it does not recognise rather than hiding it.
- **After a retention purge, `answers` comes back empty.** The server cannot tell which answers were
  personal, so it drops all of them.

**The reason dropdown is the exception and stays server-side** (`GET /public/referral-reasons`). It is
a maintained lookup, admin-editable, and the referral points at one by `reasonId`.

## Why the key ledger is a ledger and not a lock

A referral captured last year comes back with the keys it was captured under. **Reusing a key for a
different question silently changes the meaning of old referrals, and nothing will fail when it
happens** — not a type error, not a test, not a server response.

`referral-form-guards.ts` is the only enforcement that exists, and it is built to be honest about its
own limit:

- A `FrozenAnswerKey` history — `referral-answer-keys.frozen.ts` — records every key a released
  definition has ever used, and the type it had. Key fields are not in it: they are typed columns
  the server owns, not `answers` entries.
- **`reusedKeys` fires when a key survives with a different type.**
- **`unrecordedKeys` fires when a live key has no history entry at all** — so adding a question is
  "add it to both, in the same change", and forgetting the second half is exactly what this catches.

**What it cannot catch** is a key reused for a same-typed question with a different meaning: two
free-text questions are indistinguishable by shape to any machine. The doc comment says so rather than
overselling it. It can prove a definition unsafe; it can never prove one safe.

## Why `maxLength` is required on a text question

Every other per-type constraint in `FormQuestion` is optional. `TextQuestion.maxLength` is not,
because the 16KB-serialised guard has to assume a worst case for every free-text answer for its
arithmetic to be a fact rather than a guess — and an unbounded field would make it one. It doubles as
the eventual input's `maxLength`, so nothing is lost by making it mandatory.

## Why every schema field is a string, or a list of them

`buildFormSchema` builds `z.string()` for every question regardless of its declared type, and
`z.array(z.string())` for a choice. This matches every other form in the codebase, and it is not
laziness: React Hook Form hands back exactly what a control holds — a string for an input or a
select, a list of checked values for a checkbox group — whatever the question type, and a number
question's `<input type="number">` cannot tell an empty box from a lone minus sign.

`splitSubmission` in `referral-submission.logic.ts` is the deliberate second half: it re-parses the
now-validated strings into what `ReferralSubmission` actually wants — a number question becomes a
real JS number, a count becomes an integer column, a postcode is reformatted — and **an unanswered
optional question is omitted, not sent as `""`**, because a blank string would be a real, stored
answer to a question that was never asked.

## Why "None" is not a value

A choice with `answerMin: 0` renders an extra "None" box, mutually exclusive with the rest and ticked
exactly when nothing else is. It is never in the stored array and never reaches `answers` at all:
`referral details.txt` is explicit that "None is also not recorded as a value."

The implementation makes that structural rather than remembered. **None _is_ the empty selection** —
there is no `NONE` sentinel to strip, no flag to clear when something else is ticked, and no
downstream module that has to know the convention. `splitSubmission` omits a question whose selection
is empty, which is the same line that omits a blank text box, for the same reason.

## Why a form config can grey a question out, but only one level deep

Two rows of `Referral questions.csv` are "greyed out unless Yes for fuel", so `enabledWhen` names one
question and one answer — no expressions, no `and`, no `or`. A config file that can express arbitrary
logic is a config file somebody has to debug at three o'clock on a Friday.

`referral-form-config.ts` refuses a config where the enabling question is itself conditional. That is
what lets `isEnabled` be a single lookup with no recursion and no cycle detection, and it is checked
rather than assumed.

The answer to a greyed-out question is dropped **twice**: `clearDisabledAnswers` empties it as soon as
the condition stops holding, and `splitSubmission` leaves it out regardless. Two locks on one door,
because the failure is a referral that claims something about somebody's gas meter that nobody typed
and nobody can see on the screen.

## Why key fields are a separate variant, not a flag

Eleven kinds of validation appear in `Referral questions.csv` — email, phone, date, postcode, valid
session, cause of crisis — and **every one of them is on a row marked `Key field`**. So none of them
needs a vocabulary in the JSON: a `KeyFieldQuestion` names a column, and
`referral-key-fields.ts` holds what a valid one looks like. The config supplies only where it sits and
whether it is required.

Making that a separate member of the union rather than an optional property buys one thing worth
having: everything downstream of `answers` takes `DynamicQuestion`, so **a typed column cannot reach
the answers bag by accident**. It does not compile. The alternative — a `keyField?:` flag and a
filter everybody has to remember — fails silently, which is the failure mode this whole file is
about.

The one place the two shapes are deliberately mixed is while somebody is filling the form in: a
single map keyed by question, which is what lets `enabledWhen` name a key field and a dynamic
question in the same breath. `referral details.txt` proposed exactly that — "build a map of all the
values and then extract the key fields at update time".

## Why the answers renderer takes a structural type

`describeAnswers` in `referral-answers.logic.ts` accepts `{ answers, piiPurgedAt }` rather than
importing the generated `Referral`. This is a `.logic.ts`, and the import-boundary lint rule does not
allow it to reach `src/api/schema`.

It renders three cases **without ever dropping data**:

- a key the **current** definition knows → under its label, showing an option's `label` rather than
  its stored `value`;
- a key it does not know — an older or retired question → still rendered, under its raw key;
- a purged referral (`piiPurgedAt` set) → `{ kind: 'purged' }`, not an empty-looking answers section
  a volunteer would read as a bug in the screen.

A stored value that no longer matches its question's shape — a stale dropdown option, a number
question somehow holding a string — still renders as _something_ rather than throwing. The server
never validated `answers` against anything, and that has to include rows this client did not write.

## The real questions, and the keys that came with them

`referral-form.config.json` holds the charity's own questions — 43 of them over seven pages, from
`Referral questions.csv`, replacing the Google Form. The placeholder that stood in for them
(`referral-form.provisional.ts`) is gone, deleted by the change that made it unnecessary.

The **answer keys are the CSV's `Key` column verbatim**: `Pasta/Rice`, `Child 0-2`,
`Contact approved`, spaces and capitals and slashes included. They read oddly next to this codebase's
`camelCase`, and that is the right trade. Pete's note against that column says how each answer should
appear in the JSON, these keys are frozen for the life of the system, and an assistant tidying them
into `pastaRice` would be silently renaming somebody else's data. They are data the charity chose,
not identifiers.

`referral-answer-keys.frozen.ts` is the ledger, started with those keys and **append-only** from
here. A test runs `unrecordedKeys` and `reusedKeys` against the shipped config, which is the first
time either guard has been pointed at a real form rather than a fixture.

Six questions ship with a **guessed list of choices** — toiletries, household items, spread, nappy
sizes, baby milk types, and a tea/coffee row whose question mentions hot chocolate and whose answers
do not. The CSV gives their defaults but never their options, and what a food bank stocks is not
something to invent quietly: that is **Q20** in the server's `OPEN-QUESTIONS.md`, marked at
`referral-form-config.ts`. A wrong option list is recoverable in a way a wrong key is not — lists
change between releases and `describeAnswers` already renders a value no longer offered.

`screenDetails.md` also draws a distinction the pick-list screen depends on: questions **about the
person** are what the referral is, while **preference** questions (do they need flour; plain or self
raising) are what the picking list is adjusted from. It is the second kind the pick-list screen has to
show, and `preference: true` in the config is what marks them.

## Fixed fields are not part of this

Session, referrer name, email, organisation and phone, referee first name, surname, date of birth,
address, postcode and phone, adults, children, reason, delivery and fuel help are **typed columns**.
`KEY_FIELD_NAMES` is the list. Do not fold them into `answers`. `adults` is at least 1 so every
referral maps to a real cell of the household grid, and households over 5 adults or 5 children clamp
into the corner — which is a rule, not an error to surface.

All of them exist on the server. The split name, the referrer's name, the date of birth and the fuel
flag landed with the `pending_review` and `rejected` statuses and the review comment; `KEY_FIELD_NAMES`
and the generated `schema.d.ts` are the two places that list stays true.
