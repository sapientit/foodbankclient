---
paths:
  - 'src/features/**/queries.ts'
  - 'src/features/**/keys.ts'
  - 'src/api/query-client.ts'
  - 'src/api/unwrap.ts'
---

# Data fetching rules

There is no database in this repo — TanStack Query **is** the data layer, and the cache is the thing
that goes wrong. Patterns, worked examples and why each shape was chosen:
[`docs/engineering/data-fetching.md`](../../docs/engineering/data-fetching.md).

- **Server state is not component state.** Do not put API responses in `useState`, `useReducer` or a
  global store. It is remote, shared, cached and refetched.
- **Generous `staleTime`, and never poll, except the SMS summary while its run-session screen is open.** Session lists and stock levels do not change second to
  second, and the public endpoints are rate limited (roughly 5 referral submissions and 60 other
  public calls per IP per minute). A retry loop is the only realistic way to hit those limits.
- **Do not retry `4xx`.** Retrying a `409` cannot help — the session really is full. Retry network
  failures and `5xx` only; `429` gets a backoff. A query defending a rate limit may set
  `retry: false` outright, as `useReferrerCheck` does: the person is already retrying, by typing.
- **Query keys are structured and exported from the feature that owns them** (`keys.ts`), never
  inline strings. A feature may import another feature's `keys.ts` for a cross-feature invalidation.
- **Mutations invalidate every query they affect, by key.** Recording attendance changes the
  session's parcels _and_ stock levels. Cancelling or moving a referral changes `Session.booked`, so
  it invalidates `sessionKeys` too — moving one changes **two** sessions, and the response only
  carries the new `sessionId`, so pass the previous one through as a mutation variable rather than
  guessing it from a cache after the fact.
- **Fold query-key roots only where a real coupling exists.** Everything under `src/features/stock/`
  shares one `stockKeys` root because renaming an item reorders the levels list; `admin-setup`
  deliberately keeps two roots because nothing there couples. Two disjoint roots cannot invalidate
  each other.
- **Optimistic updates only where a mistake is cheap to undo. Not for attendance** — that moves
  stock. Show a pending state and wait for the server.
- **Debounce input that drives a public endpoint.** It is a rate-limit defence, not a nicety, and the
  input's value should be the cache key so a slow verdict for a typo cannot land on top of a fresh
  verdict for the corrected address.
- **A write with no idempotency key needs a synchronous `useRef` guard, not `disabled`.** `disabled`
  is applied on the next render and a real double tap lands both clicks first. Use `aria-disabled`
  so the second click still reaches the handler where the ref refuses it. **Release the lock only
  when the server has said it wrote nothing** — a `4xx` unlocks; a network failure or a `5xx` does
  not, because the write may well have landed.
- **Predict what is safe to refuse; submit what is not.** Refuse up front only what depends on data
  already on screen and cannot change underneath you. Anything racing another admin is submitted and
  the `409` shown verbatim, with nothing added.

**A test that asserts invalidation must build its own query client with the app's real `staleTime`.**
`test/render-app.tsx` defaults it to zero, under which every remount refetches and the assertion
passes whether invalidation fired or not.
