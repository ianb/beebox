---
description: "Runs a command or agent task on a recurring cadence you set (cron, a one-time timer, or a recurrence rule), and tells you when one starts failing."
---
# Schedules

A box is a directory of your data kept in git; a card is a markdown file
with structured frontmatter; the agent is the coding agent (Claude Code or
Codex) that operates the box. A schedule is a recurring or one-shot task
defined as a card, plus a background daemon that keeps them running.

**What it does for you**

- Runs a task on your own cadence: cron syntax, a one-time "at" time, or a
  recurrence rule, without you needing to remember to trigger it.
- Recovers from your computer sleeping through a scheduled window by firing
  the missed run on the next check rather than skipping it silently.
- Tells you (in chat, or another proactive channel) when a scheduled task
  starts failing or goes overdue, rather than failing quietly forever.
- Lets you run any schedule immediately from the dashboard instead of
  waiting for its next tick, and turn one off without deleting it.
- Waits instead of failing when a schedule needs a connector (e.g. Gmail)
  that is not currently configured.

**What it needs**

A machine that stays on, so the scheduler daemon can tick. See
[../install/index.md](../install/index.md).

**How it works, briefly**

Schedules are `scheduled-script` cards under `_config/schedules/`, checked
every 60 seconds by a background daemon (`bbx tick`) that runs whatever is
due. One box's schedule failing does not affect another box on the same
machine. When the underlying model engine is out of quota, a due script
skips cleanly and is marked "waiting," not "failing," and you're told once
per episode.

**Limits**

A hung scheduled script is eventually killed along with its whole process
tree rather than left running forever, but the documentation does not
describe a way to run schedules without a machine that is on and reachable
at tick time.

**Go deeper**

[../reference/cards/scheduled-script.md](../reference/cards/scheduled-script.md),
[../reference/bbx-commands.md](../reference/bbx-commands.md),
[procedures.md](procedures.md)
