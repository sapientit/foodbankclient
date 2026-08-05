---
paths:
  - 'src/features/referrals/referral-form.config.json'
  - 'src/features/referrals/referral-form-config.ts'
  - 'src/features/referrals/referral-form-definition.ts'
  - 'src/features/referrals/referral-form-schema.ts'
  - 'src/features/referrals/referral-form-guards.ts'
  - 'src/features/referrals/referral-form.logic.ts'
  - 'src/features/referrals/referral-key-fields.ts'
  - 'src/features/referrals/referral-submission.logic.ts'
  - 'src/features/referrals/referral-answer-keys.frozen.ts'
  - 'src/features/referrals/referral-answers.logic.ts'
---

# Referral form rules

**The server does not hold the referral form.** There is no `GET /public/referral-form`, no publish
call and no form-maintenance screen to build. The questions are **configuration in this
application** — `referral-form.config.json`, the charity's real questions: change them there, see
them in the test system, publish them by releasing a new version of the client. That is the
publishing mechanism. Full reasoning and the machinery's design:
[`docs/engineering/referral-form.md`](../../docs/engineering/referral-form.md).

**Two kinds of question, and the type system keeps them apart.** A `KeyFieldQuestion` names one of
the server's typed columns and takes its control and validation from `referral-key-fields.ts`; the
JSON supplies only where it sits and whether it is required. Everything else is a `DynamicQuestion`
stored in the `answers` bag. Because they are separate variants of a union rather than a flag, a key
field cannot reach `answers` by accident — everything downstream of `answers` takes
`DynamicQuestion`, so putting one there does not compile. **Do not collapse them into one type.**

Because the definition is local, constraints that would normally arrive from the server are ours to
declare **and ours to enforce**:

- **The server validates `answers` against nothing.** Required, max length, option lists and which
  questions appear at all are enforced here, before submit, or they are not enforced at all.
- **Keys are ours and must stay stable. Never reuse a key for a different question.** A referral
  captured last year comes back with the keys it was captured under, so reuse silently changes the
  meaning of old referrals and **nothing will fail when it happens**. `reusedKeys` / `unrecordedKeys`
  in `referral-form-guards.ts` are the only enforcement there is: adding a question means adding it
  to the definition **and** to the frozen-key ledger, in the same change.
- **Unknown keys are stored, not dropped**, so a renderer must show a key it does not recognise under
  its raw name rather than hiding it. The server has no list to compare them against.
- **The only server limits are size** — at most 100 keys, keys at most 60 characters, 16KB
  serialised. That is a bound on an unauthenticated write, not form validation, and no real form
  approaches it. `TextQuestion.maxLength` is **required** so that the 16KB check is arithmetic rather
  than a guess.
- **Build the Zod schema from the definition**, never by hand, so questions and validation cannot
  drift apart. Respect the declared display order.
- **Every field the schema builds is a string, or an array of them**, because React Hook Form hands
  back what a control holds regardless of question type — and `<input type="number">` cannot tell an
  empty box from a lone minus sign. `splitSubmission` in `referral-submission.logic.ts` is the
  deliberate second half: it re-parses validated strings into what the API wants, and **omits an
  unanswered optional question rather than sending `""`**, which would be a real stored answer to a
  question that was never asked.
- **"None" is an empty selection, never a stored value.** A question with `answerMin: 0` renders a
  None box, mutually exclusive with the rest; choosing it records nothing at all. There is no `None`
  sentinel in the array, which is what makes that true everywhere at once rather than wherever
  somebody remembered to strip it.
- **A single-answer choice stores the bare value, not a list of one** — `Eggs: "Yes"`, as
  `referral details.txt` describes. Multi-answer choices store an array.
- **A greyed-out question's answer is dropped, twice.** `clearDisabledAnswers` empties it as soon as
  the condition stops holding, and `splitSubmission` leaves it out regardless. Saying yes to fuel,
  answering what follows, then saying no must not leave a claim about somebody's gas meter behind.
  `enabledWhen` is deliberately **one level deep** and `referral-form-config.ts` refuses a config
  where the enabling question is itself conditional.
- **The reason dropdown is the exception and stays server-side** (`GET /public/referral-reasons`). It
  is a maintained lookup and the referral points at one by `reasonId`. The secondary cause of crisis
  draws from the same list via `optionsFrom` and is an ordinary answer. Fetch both; hard-code neither.
- **Fixed columns are separate and typed** — session, referrer name, email, organisation and phone,
  referee first name, surname, date of birth, address, postcode and phone, adults, children, reason,
  delivery, fuel help. **Do not fold them into `answers`.** `KEY_FIELD_NAMES` is the list.
- `adults` is at least 1, so every referral maps to a real cell of the household grid. Households
  over 5 adults or 5 children clamp into the corner — **do not surface that as an error.**
- **The postcode is stored formatted** — capitals, one space before the last three characters, via
  `src/lib/postcode.ts`. It is searched on, and one household spelled three ways matches nothing.

**`referral-answer-keys.frozen.ts` is append-only.** Every key the form has released, with the kind
of question it was. Adding a question means adding it there in the same change; `unrecordedKeys` is
what notices if you forget, and a test runs both guards against the shipped config. Never edit a
line, never delete one, never reuse a key. The keys are the `Key` column of
`Referral questions.csv` verbatim — spaces and capitals included — because that is where the charity
said how each answer should appear. They are data, not identifiers, and `camelCase` does not apply.
