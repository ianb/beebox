---
title: "A drafted message in a card has no copy control"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting journey walk, 2026-10-08
resolution: implemented
---

> **Closed 2026-10-17** (`e84154b1a`): fenced code blocks in cards and chat
> have a Copy button. A draft written as a blockquote (the 2026-10-09 case)
> still has none; no guidance tells the agent to put drafts in a fence.

The person asked the agent to draft a message to send to someone. The agent
put the draft in a fenced code block and wrote that it was "easy to copy". The
card shows no copy control on the block, so the person must select the text by
hand.

The job: the person wants to move a ready-to-send message from the box into an
email or chat app in one action.

`beebox/src/frontend/src/components/Markdown/body.tsx` renders code blocks.
Check whether a copy button on fenced blocks, or a distinct "draft" block
type, fits better. A copy button on every code block is the smaller change.

Report: [C](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (shot 07, turn 4).

## Re-encounter 2026-10-09 (journey walks)

Seen again in [C](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) (row 28): the walker found no copy button on the draft. The draft was a Markdown quote this time (italic, shot 08); 2026-10-08 used a code block. Neither has a copy control, and the agent said "ready to copy".
