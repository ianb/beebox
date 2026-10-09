---
title: "A chat link to a card that was renamed leads to \"This card is no longer here\""
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending journey walk, 2026-10-09
---

In the A-lending walk the agent linked a loan card in its setup reply, then
renamed the card with `bbx mv` (a mystery book that turned out to be
"Piranesi"). `bbx mv` updated the reference in another card, but not the link
in the earlier chat message. Clicking the old link shows "This card is no longer
here. It may have been moved or sent to Trash." with a button to the card's
history. The person has no way to reach the card from there. The walker did not
click the old link; the reader reproduced it.

## Mechanism

Chat messages are transcript entries, not cards, so the move's reference update
does not reach them. The not-found view
(`beebox/src/frontend/src/components/card-actions/MissingCardState.tsx:16-22`)
checks only that the path has git history. It does not look for where the path
went. The rename is in the box's git history (`git log --follow` finds it).
Unverified: the scope of the reference update in `beebox/src/cli/commands/move.ts`.

## Why the fix is not obvious

Rewriting the transcript is wrong: a transcript records what was said. The
repair belongs on the read side: when a path is missing and git history shows a
rename, the view can offer the new location. Deletes and trash have no
successor, and a path can be renamed more than once.

Related: [open-card-silently-follows-into-trash](2026-10-08-open-card-silently-follows-into-trash.md)
(an open panel after a move or trash).

Report: [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) R5.
