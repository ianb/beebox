---
title: "The seed briefing section Reaching me speaks in agent commands"
workstream: user-facing-language
resolution: implemented
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

Report: [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (shot 10).

## Resolution (user-facing-language, 2026-10-09)

Closed by the user-facing-language merge to main.

`REACHING_ME_DEFAULT` ends "When I ask for a reminder or to be told when
something happens, make sure it reaches me wherever I am." The schedule-card
mechanics were already in the guide's REACHING_THE_BOXHOLDER section.
Template sync rewrites a briefing whose text is still the seed; a briefing the
person has edited keeps its old wording.

Report: [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (shot 10).

## Re-encounter 2026-10-09 (journey walks, before the fix)

The 2026-10-09 walks ran on main `24d84746f`, before this issue's fix landed (`4d9a15fe8`). They are evidence of the old behavior, not of the fix failing.

Seen again in [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 16, shot 05): the seed briefing's "Reaching me" section (`beebox/src/schemas/briefing.tsx`, `REACHING_ME_DEFAULT`) speaks in the person's voice, which they did not write, and uses "a dot", "loud", `notify:`, `bbx changes` and `bbx judge`. The walker: "instructions to the machine that leaked into a page that's supposed to be about me".
