---
description: Independent multi-agent review of the current uncommitted diff (or a named scope)
argument-hint: [optional scope, e.g. a path or "the referrals screen"]
---

Review the current change independently. Scope: **$ARGUMENTS** (default: everything in
`git status` / `git diff` that is not already committed).

1. Establish the diff first — `git status --short` and `git diff` — and summarise what changed
   before dispatching anything. If the working tree mixes unrelated work, say so and review only the
   part in scope.
2. Dispatch **in parallel**, choosing by what the diff actually touches:
   - **reviewer** — always. Correctness, requirements, edge cases, privacy, role visibility, error
     handling, tests, scope creep, rule divergence, stale generated types.
   - **accessibility-reviewer** — any change to a screen, form, dialog, navigation, table, loading
     or error state, CSS module, print layout or responsive behaviour.
   - **client-state-reviewer** — any change to `queries.ts`, `keys.ts`, `src/api/**`, `src/auth/**`,
     invalidation, retry policy, routing that affects data loading, or `src/worker/**`.

   Give each the exact file list and what the change was meant to do. Their scopes are disjoint by
   design; do not ask one to cover another's ground.

3. **Do not accept the reports at face value.** Verify each material finding against the code
   yourself. Drop what does not hold up and say that you dropped it.
4. Present the surviving findings **Critical → High → Medium → Low**, deduplicated across agents,
   each with file, what is wrong, why it matters, and the smallest fix.
5. State plainly what was **not** verified — especially the things no test here can prove: real
   cross-tab refresh, an actual screen reader, an actual A4 printout, the deployed proxy.

Report only. Do not fix anything unless asked.
