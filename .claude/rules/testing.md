---
paths:
  - 'test/**'
  - 'src/**/*.test.ts'
  - 'src/**/*.test.tsx'
  - 'vitest.config.ts'
---

# Testing rules

- **Every behaviour change ships with a test. Bug fixes start with a failing test.**
- **MSW against the generated types**, so a fixture that no longer matches the contract fails to
  compile. Hand-rolled `fetch` mocks drift from the API and stop testing anything.
- **Test what the user does**: render a screen, click, assert on what is on it. Query by role and
  label, not by test id or class.
- **Unit-test the pure logic directly** — London time, schema building from a form definition, error
  parsing, household clamping. Highest value per line in the repo.
- **`test/render-app.tsx` renders the real route table with the real providers**, so a screen test
  proves its own wiring. Its signed-in actor is fixed per module — a test for the other role needs
  its own file.
- **Name a test as the rule it enforces**: `never renders the reason for referral on a pick sheet`.

## Priorities

In order, because these are where a bug means a household goes hungry or private information is
exposed:

1. **The auth interceptor.** Two simultaneous `401`s must produce exactly one refresh. Write that
   test before the code.
2. **The print view.** Shelf order preserved, reason absent, name on every sheet, address and
   postcode and phone only when `isDelivery`, one page per parcel. Assert the print payload
   **cannot** render a reason even if the server sends one.
3. **Attendance.** Submitting the same outcome twice moves stock once, submitting the _other_
   outcome shows the `409` (the outcome is final), and confirm shows the pending pick numbers.
4. **Role-based rendering.** A team lead's referral view renders with `reasonId` absent and never
   displays it.

## Two harness defaults that make assertions vacuous

Both have bitten this repo. Check for them before trusting a green test:

- **`renderApp` sets `staleTime: 0`.** Every remount refetches, so an invalidation assertion passes
  whether the invalidation fired or not. Pass a query client built with the app's real policy —
  `stock-invalidation.test.tsx`, `model-parcels-invalidation.test.tsx`,
  `admin-setup-invalidation.test.tsx` and `referrals-invalidation.test.tsx` all do.
- **`renderApp` turns retries off**, which makes "does not retry a `429`" prove nothing.
  `public-referral-screen.test.tsx` builds its own client with the real retry policy for exactly this.

`test/setup.ts` shims `Request` so a relative URL resolves against the document — Node's throws on
one, and `baseUrl: ''` in `api/client.ts` is load-bearing. `test/tooling/eslint-rules.test.ts` asserts
each load-bearing lint rule still fires; a lint rule that stops working fails open and nothing else
would notice.
