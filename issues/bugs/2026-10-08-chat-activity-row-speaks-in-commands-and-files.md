---
title: "The chat activity row says \"ran 2 commands\" and \"Wrote schemas/loan.ts\""
workstream: user-facing-language
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, C-reconnecting, D-chemistry and F-newcomer journey walks, 2026-10-08
---

The collapsed row above an agent reply reads "thinking, ran 2 commands",
"thinking, used a tool, ran a command", or "Wrote schemas/loan.ts". Expanded,
it lists `grep`, `sed`, `ls`, `python3` and `git add` lines. Four walkers
reacted. The D-chemistry walker: "I didn't ask it to run anything". The
A-lending walker wondered what the agent was doing to the computer. Reports:
[A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (rows 7, 19),
[C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 7, which also
saw "Ran script: Look at box content, doc card docs, and notification reach"),
[D-chemistry](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (row 15),
[F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (rows 9, 73).

## Mechanism

`beebox/src/frontend/src/components/chat/ChatMessages/activity-rendering.tsx`:
tool names map to categories (`:106`, `Bash: "command"`), and
`categorySingular`, `categoryVerb`, `categoryPlural` (`:125-148`) produce the
words "command", "file", "ran". Single-tool labels come from the tool input
(`:32`, "Wrote <path>"; `:38`, "Ran a command"). The row speaks in the
agent's tool vocabulary, not in what the person asked for.

## Not obvious

A Bash call may read a card, run a lookup, or edit a file; the category alone
does not say which. The label could use the tool call's `description` field
(the C-reconnecting row already shows one) and fall back to a plain phrase
("looked something up"). The expanded view can stay literal for people who
want it.

## Related

[Implementation vocabulary leaks into the UI](../closed/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md)
(closed) did not cover this surface.
[The chat agent narrates implementation steps](2026-10-08-chat-agent-narrates-implementation-steps.md)
is the text side of the same problem.

## Resolution (user-facing-language, 2026-10-09)

The row now speaks in lay words (`ChatMessages/activity-wording.ts`):
collapsed "thought it over, looked up 2 things, made a change, took a step";
a line per step uses the command's `description`, the card's title ("Updated
Lemon Chicken"), or "Set up a place for your loans" for a schema. Every line expands to
the raw input and result. The guide now tells the agent that a command's
`description` is shown to the person.

The boxholder (2026-10-09): keep showing the agent's own step descriptions,
even though some are still technical; the guidance is the fix for those.
