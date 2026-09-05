# Stock handling prototype — disposable, not a real feature

Everything under `src/features/stock-prototype/` is a client-only demo built to show the charity
what [`docs/planning/stock-handling-changes.md`](../../../docs/planning/stock-handling-changes.md)
§1–§3 would feel like to use, before that plan is agreed. It exists to make a conversation easier,
not to ship.

**None of this talks to the API.** There is no `queries.ts`, no `keys.ts`, no import of
`src/api/**` anywhere in this folder — the server has none of these concepts yet (stock-take
groupings, crates, packing units), and designing the real contract is real cross-repo work that
only starts once the charity conversation happens and Pete decides this is worth building. All data
here lives in `stock-prototype-store.tsx`, seeded from `mock-data.ts`, and resets on page reload.

Deliberately out of scope, per the planning doc and Pete's steer: the fresh-shopping policy (§4)
and updating stock from a shopping confirmation (§5) — both genuinely blocked on the server's Q43.
Fresh/perishable stock items are shown here as ordinary stock items with their own grouping, exactly
like any other category — nothing fresh-specific is built.

Routes are registered as plain siblings under the authenticated layout (so they get `PageHeader`,
button styles, etc.) but are **not added to `src/auth/menu.ts`** — reachable only by direct URL,
the same way this codebase already keeps some admin screens out of a team lead's menu without
route-guarding them.

When the charity conversation happens and a direction is settled, this whole folder is deleted —
none of it is meant to survive into the real implementation. The real build starts from a proper
OpenAPI contract change in `../foodbankserver`, not from this code.
