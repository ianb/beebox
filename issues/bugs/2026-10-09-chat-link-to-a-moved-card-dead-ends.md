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

## 2026-10-17: the read-side lookup exists; rename detection misses this case

Since 2026-09-10, opening a missing card follows its renames
(`beebox/src/core/moved-card-forwarding.ts`, `resolveMovedCardPath`, tests in
`beebox/test/core/moved-card-forwarding.doctest.md`). `MissingCardState`
shows only when that lookup finds nothing. On the worktree test box an old
email-thread path and an old memo path both forwarded to the new card.

Likely cause in the walk (not verified; the walk's box is gone): the loan card
was renamed and edited in one commit (`92eb558`). For a small card, git's
default rename detection (`-M`, 50% similarity) then reports a delete and an
add. A scratch repo with a card of that shape gives `D` + `A` at the default
and `R042` at `-M40%`.

Options for `committedRename`:

1. Lower the similarity threshold. Cheap, but cards of one type share their
   frontmatter keys, so an unrelated card added in the same commit can pass.
2. Accept a low-similarity pair only when the commit removed the old path and
   added exactly one card of the same type, or when the card's `.attach`
   directory moved with it. Lean: this one.
3. Have `bbx mv` record moves. It would not have helped here: the move landed
   in a trick's commit.

The lookup also follows a rename into `_bookkeeping/trash/`; that belongs to
[open-card-silently-follows-into-trash](2026-10-08-open-card-silently-follows-into-trash.md).
An unused patch for a separate successor endpoint on `MissingCardState` was
written and dropped as a duplicate of the existing lookup.
