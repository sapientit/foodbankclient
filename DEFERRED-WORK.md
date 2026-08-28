# Deferred work

Work this repo knows it owes, with the answer already known — a contract that moved, a decision
already taken, a rework identified and postponed rather than debated. Each entry is something a
future session can pick up and finish without asking anyone anything.

## What goes where

Three files, and the split is what stops any of them becoming a dumping ground:

| File                                  | Holds                                                           | Who closes it       |
| ------------------------------------- | --------------------------------------------------------------- | ------------------- |
| `OPEN-QUESTIONS.md`                   | Client screens, browser behaviour and client privacy questions. | Pete, and only Pete |
| `../foodbankserver/OPEN-QUESTIONS.md` | Domain, retention and API questions.                            | Pete, and only Pete |
| `KNOWN-GAPS.md`                       | Built, but less proven than the test count suggests             | Whoever proves it   |
| `DEFERRED-WORK.md` (this file)        | Known answer, work not done                                     | Whoever does it     |

**Do not raise a domain question here.** It belongs in `../foodbankserver/OPEN-QUESTIONS.md`.
Questions about this client’s screens, browser behaviour or browser-side privacy boundary belong in
[`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md). If a question affects both, put it with the domain/API
question rather than maintaining two versions of it.

**Entries are numbered `W1`, `W2`, … Never renumber, never reuse a number.** When one is done, the
change that does it deletes the entry in the same commit — the length of this file is meant to be
the size of the backlog. Git keeps the wording; the reasoning, if it is worth keeping, belongs in
the `docs/` file for that area, where a reader would look for it.

## W1 — Team-lead SMS notification

The run-session screen already polls its SMS summary while an editable session is open. Do not add
an audible alert, browser notification, or on-screen popup yet: the food bank has not established
whether a team leader works continuously at this screen, moves between devices, or is expected to
notice an alert away from it. Preserve the existing polling behaviour. When the working practice is
known, decide the notification channel and its accessible visual equivalent before implementing it;
do not record notification delivery, acknowledgement, or a team-lead preference merely to support
the alert.

## W2 — Administrator SMS attention indicator

Do not add an unread-attention count, polling, badge, popup, or other prompt to the Menu, initial
screen, or another global part of the administrator application yet. The administrator SMS inbox
correctly labels messages that need attention, but the food bank has a new plan for how and when an
administrator should be prompted to visit it. Preserve the inbox and its server contract; implement
the prompt only once that plan is settled.
