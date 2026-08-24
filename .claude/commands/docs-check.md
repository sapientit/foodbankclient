---
description: Check this repo's screen spec, generated types and status documents for drift
argument-hint: [optional area to focus on]
---

Check the documentation and contract for drift. Focus: **$ARGUMENTS** (default: everything).

Investigate with **Explore** where a sweep is needed, then verify each candidate yourself.

1. **Generated types.** Run `npm run api:types:check`. If `src/api/schema.d.ts` is stale, say what
   changed in the server's `openapi.yaml` and what it would break here — do not regenerate silently
   as part of a documentation pass.
2. **`screenDetails.md` against the code.** Anything a screen does that the spec does not say, and
   anything the spec says that no screen does. Report both; change neither without Pete. Pay
   attention to screens marked unbuilt in `STATUS.md` that now exist, and vice versa.
3. **Both open-question files.** Check this repo's `OPEN-QUESTIONS.md` for client/UI questions and
   `../foodbankserver/OPEN-QUESTIONS.md` for domain/API questions. Which entries block work here,
   and has any been answered _by the code_ rather than by Pete? That is a requirement decided without
   anyone deciding it. **Never answer one** — only Pete closes one.
4. **Guess markers.** Every place this repo guessed should carry a comment naming the guess and a
   live entry in the question file that owns it. Report guesses with no entry, and entries with no
   call site.
5. **`KNOWN-GAPS.md` and `DEFERRED-WORK.md`** — every entry still real. A documented
   `@ts-expect-error` with no `KNOWN-GAPS.md` entry, or an entry whose gap has since been fixed, is
   drift. W1 (the auth refresh/eight-hour-cap gap) is deliberately still open — confirm it, do not
   close it.
6. **`STATUS.md`** — does it match what is actually built and configured?
7. **`docs/` and `.claude/rules/`** — any rule contradicted by the current code, any doc link that
   404s, any rule file whose `paths:` no longer match a real file. Note where a rule file
   deliberately describes intended behaviour the code has not reached yet; that is not drift.

Report findings grouped by document, each with the evidence. Propose corrections for `STATUS.md`,
`KNOWN-GAPS.md`, `DEFERRED-WORK.md` and `docs/`. **Do not edit `screenDetails.md` or either
open-questions file** — list what needs Pete's decision instead.
