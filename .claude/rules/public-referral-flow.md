---
paths:
  - 'src/features/referrals/components/public-referral-screen.tsx'
  - 'src/features/referrals/public-referral.logic.ts'
  - 'src/features/referrals/queries.ts'
  - 'src/api/client.ts'
---

# Public referral flow rules

Unauthenticated, and **the only open write in the system.** Built, except for Turnstile — see
[`STATUS.md`](../../STATUS.md). The form's questions and validation are a separate concern:
[`.claude/rules/referral-form.md`](./referral-form.md).

```
GET  /api/v1/public/sessions           sessions with space, next 14 days
POST /api/v1/public/referrers/check    is this address on the charity's list?
GET  /api/v1/public/referral-reasons   the cause-of-crisis list
GET  /api/v1/public/organisations      the organisation dropdown
POST /api/v1/public/referrals          submit → 201, active or pending_review
```

- **Goes through `publicApi`, never the authenticated client.** No bearer header, no refresh, and
  nothing in this flow may trigger one — a `POST /auth/refresh` fired for an unauthenticated referrer
  is a bug, and a test asserts `/refer` issues none.
- **Check the referrer's address as they type it, debounced**, so an unrecognised one is known before
  they fill in a whole form. When recognised the response carries `organisationName` — pre-fill it.
  The debounce is a rate-limit defence, not a nicety; see
  [`.claude/rules/data-fetching.md`](./data-fetching.md).
- **An unrecognised address is not a refusal.** The referral is still taken and comes back
  `pending_review` for an administrator to accept or reject. Say that as it happens and again on the
  confirmation — "we will need to approve this", never "you cannot refer". The old `403` on
  `POST /public/referrals` is gone.
- **A page at a time, validated a page at a time.** Somebody on page four is not told about page one,
  and nobody reaches page two with a mandatory box blank on page one.
- **Nothing is written to disk.** No draft, no resume, no autosave — see
  [`.claude/rules/pii-security.md`](./pii-security.md). A wizard is exactly where somebody would
  reach for `localStorage`; navigating away loses the form and the screen says so before the last
  page rather than after.
- **Rate limits are roughly 5 referral submissions and 60 other public calls per IP per minute.**
  Never poll, and never auto-retry a `429` here.
- **`adults` is at least 1**, so every referral maps to a real cell of the household grid. Households
  over 5 adults or 5 children clamp into the corner — **information, never an error**.
- **The page must never claim more than it has done.** Somebody who believes a household is booked in
  when it is not is the failure this whole flow is shaped around, and the confirmation screen is where
  it would happen now: a `pending_review` referral is not a booking and must not read like one.

## Turnstile

`POST /public/referrals` requires a token in the **`cf-turnstile-response`** header whenever the
server has a secret configured — **always in production, never in local development**. Two failure
modes to build for:

- **Tokens are single-use.** Never retry a submission with the same token — reset the widget and get
  a fresh one.
- **Tokens expire after five minutes.** Somebody filling in a long form slowly will hit this and get
  a `400` saying the check expired. Reset the widget and let them resubmit. **Do not show a generic
  error; they did nothing wrong.**

## After submission there is no way back

**There is no edit key and no fifteen-minute window.** `screenDetails.md`, "After a referral is
submitted": a referrer cannot change or withdraw a referral at all. Do not build a countdown, do not
hold a key, and do not look for `GET|PATCH|DELETE /api/v1/public/referrals/{id}` — those endpoints
and the `x-referral-key` header are gone from the contract.

What replaces it is a confirmation screen, and it carries more weight than the old one because it is
now the only check there is:

- **Show every mandatory answer back.** It is the referrer's one chance to notice a wrong surname or
  the wrong session before it becomes a phone call.
- **Say when the referral is `pending_review`**, plainly. Somebody who leaves believing a household
  is booked in when it is not is the failure this whole page exists to prevent.
- **Say to phone the food bank to change anything.** A normal ending, not a fault, and not
  apologised for.
