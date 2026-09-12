---
description: "Put recurring work on a schedule or into a procedure, and read the result afterwards instead of remembering to do it."
---
# Routines that run without you

Some work recurs: checking a thing every Monday, a summary each morning, a
monthly pass over a list. It happens when you remember it, which means it happens
for three weeks and then stops. A **box** is one directory of your data, a
**card** is one markdown file in it, and **the agent** is the coding agent the box
hands the work to when the time comes.

**What you do.** Ask for it in words: check this every Monday, remind me on the
first of the month, write me something each morning. Read what it produced and
say what to change. Turn a routine off without deleting it.

**What the box does.** A scheduled-script card declares when a command runs: a repeating schedule (a cron expression, for the curious), a single future date
and time, or a recurrence rule, plus a minimum interval, a time budget, a
timeout, a lock that keeps it from overlapping related tasks, and the connectors
it requires. The box checks every sixty seconds for work that is due and runs it, and one
box's failure does not affect another on the same machine. Work with several
steps is a procedure card, with precheck, run, and validate phases. The agent can
also set a timer from chat. Overdue and failing schedules are reported to you.

**What it needs.** A machine that stays on, so the box can keep checking for
due work.
[Schedules](../capabilities/schedules.md),
[procedures](../capabilities/procedures.md),
[timers set from chat](../concepts/chat-schedules.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** On a fresh box scheduled runs are off until you turn
them on, and the routines that ship with a box (the nightly pass that titles and
summarizes the day's chats, the weekly retrospective) are seeded disabled. Out of
model quota, a due script is marked waiting rather than failing, and you are told
once per episode. A hung script is killed with its process tree. Finished
procedure runs expire after thirty days unless pinned. There is no visual editor
for either: both are cards.

**What makes it possible**

- **Schedules** ([schedules](../capabilities/schedules.md)): a schedule is a card declaring when a command runs, and a window your machine slept through fires on the next check rather than being skipped.
- **Procedures** ([procedures](../capabilities/procedures.md)): every step's work is saved before the next begins, so each point in a run is a clean state you can inspect.
- **The history** ([durability and provenance](../design/durability-and-provenance.md)): the box's history of changes is the audit trail, so what ran while you were away is recorded rather than merely reported.

**Read next.** [Procedures](../concepts/procedures.md),
[scheduled-script](../reference/cards/scheduled-script.md),
[procedure](../reference/cards/procedure.md),
[procedure-run](../reference/cards/procedure-run.md).
