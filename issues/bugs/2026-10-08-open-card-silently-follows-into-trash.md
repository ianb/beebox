---
title: "An open card panel follows the card into the trash with no sign"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending journey walk, 2026-10-08
---

In the A-lending walk the agent replaced a first-draft page ("Who has what")
with structured cards and trashed the draft with `bbx rm`. The page was open
beside the chat. The panel kept showing the same content, but its address
changed from `_content/lending/Lending_Ledger.doc.card` to
`_bookkeeping/trash/Lending_Ledger.doc.card` (shots 04, 05, 06). Nothing on
the panel said the card was now in the trash. The walker later asked whether
the page was gone; it was recoverable, but no control restores it
([report](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md), rows 14, 81).

## Mechanism

- Trash is a move into the box trash directory
  (`beebox/src/core/commands/trash/command.ts:137-138`; the header at `:4`
  says cards "can be restored manually").
- The workspace follows a moved card: `onMoved` calls `retargetCard`
  (`beebox/src/frontend/src/components/chat/workspace/WorkspaceCanvas/view.tsx:59`).
  A move into trash looks like any other move.

## Not obvious

The report did not confirm whether following into the trash is intended. The
choices: close the panel when the new path is under the trash directory, or
keep it and mark it "In the trash" with a restore control. The agent also did
not say where the page went until the walker had watched it vanish.
