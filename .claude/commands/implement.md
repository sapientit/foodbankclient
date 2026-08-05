---
description: Run a change through the full workflow for this repo — rules, plan, delegation, review, npm run check
argument-hint: <what to build or fix>
---

Implement the following in the food bank client: **$ARGUMENTS**

Work through this sequence. You own it end to end — subagents do slices, not the whole thing.

1. **Ground it in the requirement.** Screens are `screenDetails.md`; the domain is
   `../foodbankserver/INITIAL_SPEC1.txt`. If neither covers it, say so and either raise an entry in
   `../foodbankserver/OPEN-QUESTIONS.md` or ask Pete — do not decide it yourself. If Pete settles a
   screen requirement in conversation, write it into `screenDetails.md` **in this same change**.
2. **Investigate.** Use the **Explore** agent for anything broad — where the pattern lives, which
   feature owns the keys, what already invalidates this. Read the scoped rules in `.claude/rules/`
   that govern the files you will touch, and `../foodbankserver/API.md` for any endpoint area new to
   you. **Never read or modify the server's code.**
3. **Plan briefly** and say what you are about to do. Name the features, the query keys involved,
   and whether `npm run api:types` needs rerunning.
4. **Build.** Delegate bounded, pattern-following slices to **implementation-worker**, one agent per
   set of files with no overlap. Keep for yourself: architecture, cross-feature invalidation, query-
   key roots, and anything the spec does not already settle.
5. **Test.** Delegate to **test-writer**. If this is a bug fix, that comes _first_ and starts from a
   failing test. Watch for the two harness defaults that make assertions vacuous.
6. **Review.** Dispatch in parallel, by what the change actually touched: **reviewer** always;
   **accessibility-reviewer** for any user-facing change; **client-state-reviewer** for any query,
   cache, auth, retry or proxy change. Read the reports critically rather than accepting them; fix
   what is real.
7. **Integrate and verify.** Read the full diff yourself, then run `npm run check`. It must pass —
   never weaken a rule to make it pass.
8. **Report** the files changed, the checks you ran, what you assumed, and what remains unverified —
   including anything only a real device, screen reader or printout could prove.
