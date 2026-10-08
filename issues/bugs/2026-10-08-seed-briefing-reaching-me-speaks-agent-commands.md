---
title: "The seed briefing section Reaching me speaks in agent commands"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — F-newcomer journey walk, 2026-10-08
---

The seed briefing card gives the person a section called "Reaching me". It is
written in the person's voice and shown on the briefing card. Half of it is
agent directives: `notify:`, `bbx changes`, `bbx judge`. The F-newcomer walker
said it was "half about me, half in a language I don't speak".

The text is `REACHING_ME_DEFAULT` in `beebox/src/schemas/briefing.tsx:238-246`.
The last two sentences ("make a schedule card with `notify:`", "runs
`bbx changes` and `bbx judge` before any agent") instruct the agent. The
agent reads the same card as its standing orders, so one text serves two
readers.

## Fix direction

Keep the section in the person's voice, for example "Tell me when something
fails; ask me only when something is blocked", and move the commands to
agent-facing docs (`beebox/box-docs/`). Related:
[agent writes "the user" on pages the person reads](2026-10-08-agent-writes-the-user-on-boxholder-pages.md).

Report: [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (shot 10).
