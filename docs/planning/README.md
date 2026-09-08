# Planning references

## Stock handling changes

[`stock-handling-changes.md`](./stock-handling-changes.md) records an exploratory planning
conversation about splitting stock takes by grouping, a crate mechanism for commingled shelf stock,
packing units, and a fresh-food shopping policy resolving server Q43. Nothing in it is a settled
requirement — it exists to prepare for a charity conversation, not to replace one.

[`stock-handling-implementation-plan.md`](./stock-handling-implementation-plan.md) is the build plan
for the groupings/crates/packing-units part of the above (§1–§3 only — the fresh shopping policy
stays excluded, blocked on server Q43), once that direction is agreed. Written to be handed to
another engineer or agent without needing this conversation's context.

[`stock-handling-server-handoff.md`](./stock-handling-server-handoff.md) turns the agreed branch
build direction into an ordered server workstream, including migration/backfill, contract and test
requirements. Its explicitly marked contract choices must be settled before the generated client
implementation can be wired to a real API.

## Potential matches attendance confirmation

![Potential matches attendance confirmation mock-up](potential-matches-attendance-confirmation-mockup.png)

This approved planning mock-up records the intended direction for the existing potential-matches step: show the incoming referral's date of birth, phone number, postcode and address; show the same details, address, last-attended date and `Matched on` criteria for each prior referral; support surname-prefix search and excluding postcode-only matches; and have the administrator select the applicable prior referral or `Never attended`.

It is a planning reference only, not an implemented screen specification or product asset.
