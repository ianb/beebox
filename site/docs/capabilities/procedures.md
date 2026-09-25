---
description: "Multi-step workflows you or the agent define once and run repeatedly, with each step checked and committed before the next begins."
---
# Procedures

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. A procedure is a named, reusable, multi-step process defined as a card.

**What it does for you**

- Runs a defined sequence of steps in order, each with an optional
  precheck (should this step even run), the action itself, and a
  validation (did it actually work), including a model judging whether a
  step did what it was supposed to.
- Lets you pass a one-off instruction (a "directive") into a run without
  editing the procedure itself, e.g. "prefer the reading list over
  trashing."
- Keeps a record of every run, resumable if it fails partway through, so a
  long process does not have to restart from scratch.
- Can be triggered by a mail rule or other automation, not only run by hand.

**What it needs**

Nothing beyond the box itself. Procedures are cards you or the agent write
(kept in `_config/procedures/`, for the curious).

**How it works, briefly**

Each step saves its work to the box's history before the next step starts,
so the box's state after a partial run is always a clean, inspectable
snapshot. Steps can run a command, an agent turn, or both. A run is tracked
as a `procedure-run` card while it is recent; the box's history keeps every
finished run afterward. Procedures run when you invoke one, when another
automation triggers it, or as a triage "handle" step (the reference page
below covers the details).

**Limits**

A run's record is kept only temporarily, not as a permanent archive: finished
runs expire on a timer (30 days by default, configurable) unless pinned. The
documentation does not describe a visual procedure editor; procedures are
written as cards.

**Go deeper**

[../reference/procedures.md](../reference/procedures.md),
[../reference/cards/procedure.md](../reference/cards/procedure.md),
[../reference/cards/procedure-run.md](../reference/cards/procedure-run.md),
[../reference/bbx-commands.md](../reference/bbx-commands.md)
