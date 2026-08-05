---
paths:
  - 'src/api/**'
  - 'src/features/**/queries.ts'
  - 'src/features/**/keys.ts'
  - 'src/lib/errors.ts'
  - 'scripts/check-api-types.mjs'
---

# API contract rules

`openapi.yaml`, `API.md` and `OPEN-QUESTIONS.md` in `../foodbankserver` are the whole channel
between the two repos. **Read `API.md` in full before writing client code that touches a new area** —
it carries the sequences and the role-visibility rules that `openapi.yaml` cannot express.

## Types are generated, never written

- `src/api/schema.d.ts` comes from `npm run api:types`. **Hand-written request or response
  interfaces are a bug**: they drift silently and the first symptom is a blank field on a screen
  somebody depends on.
- **Commit `schema.d.ts`.** It is generated, but committing it means a build does not need the
  sibling repo checked out. `npm run api:types:check` fails when it is stale and skips when the API
  repo is absent.
- Regenerate whenever the server's spec changes and let the type errors show what to fix.
- Where the generated type is genuinely unusable, the call site carries a documented
  `@ts-expect-error` — never an unchecked cast — and an entry in `KNOWN-GAPS.md`. `RecurringSessionPatch`
  is the worked example: a body declared `{type: object, minProperties: 1}` generates
  `Record<string, never>`, a type that refuses every real field.

## The import boundary

`src/api/client`, `src/api/auth-fetch` and `src/api/schema` may only be imported from `src/api/**`,
`src/auth/**` and a feature's `queries.ts`. A lint rule enforces it.

- **Components do not call `fetch`.** Anything outside `queries.ts` bypasses auth, retry policy and
  the cache.
- A `*.logic.ts` may **not** import `src/api/schema`. Give it a structural parameter type
  (`{ answers, piiPurgedAt }`) instead — which also keeps it testable without a fixture.

## Errors

Every failure has one shape: `{ error: { code, message, details, requestId } }`. Parse it once in
`src/lib/errors.ts`; `message` is written to be shown to a user and never contains personal data.

| Status | What the client does                                      |
| ------ | --------------------------------------------------------- |
| `400`  | Field errors from `details.issues` → `setError` per field |
| `401`  | Single-flight refresh, retry once, else sign out          |
| `403`  | Treat as a bug, **except on sign-in** — see below         |
| `404`  | "No longer exists", not a crash                           |
| `409`  | **Show `message`.** It is meaningful, and not retryable   |
| `422`  | **Show `message`.** A rule forbids it                     |
| `429`  | Back off. Do not loop                                     |
| `500`  | Generic apology plus a copyable `requestId`               |

- **`409` and `422` are the two that get mishandled.** They mean _the session is full_, _this list is
  confirmed_, _that reason is no longer offered_. A generic "Something went wrong" throws away the
  one useful sentence the server sent.
- **The `403` exception is the sign-in screen**: a deactivated account gets `403` from
  `POST /auth/dev-login`, which is a real answer to a real request. Show the server's message plus
  "ask an administrator to reactivate it". Everywhere else `403` means the menu and the role
  disagree — but routes are never role-guarded, so a team lead who types an admin URL does make the
  request and does get a `403`. That must read as a plain explanation (`describeApiError`), never a
  crash, and **the request must still be made**.
- **Validation errors name the field and the rule but never echo the value.** Keep your own copy of
  what the user typed — React Hook Form does this for free, as long as the form is not reset on error.
- **Show `requestId` somewhere copyable on a `500`.** It is also in the `x-request-id` header, and it
  is what makes a volunteer's bug report actionable.

`src/components/error-notice.tsx` is the one place this table is enforced.
