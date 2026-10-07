---
title: "Deleting a chat fails its git step for a card never committed, and should delete the card rather than move it to Trash"
workstream: chat-delete-permanent
area: beebox
labels: [chat]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder saw "its git commit is still pending" when deleting a chat
---

Deleting a chat sometimes ends with: "The transcript is gone and the chat card
is in Trash, but its git commit is still pending. Retry cleanup to commit the
move." (`beebox/src/frontend/src/components/chat-delete/DeleteChatDialog.tsx:53`).
Retry fails the same way every time.

## Cause (verified 2026-10-06)

The delete moves the chat card to `_bookkeeping/trash/` and commits the move
through `commitTrashReceipt` (`beebox/src/core/commands/trash/command.ts:216`),
which stages both the source and destination paths
(`gitPaths = [relSourcePath, relDestPath]`, line 184). A chat card created
and deleted before any commit picked it up has no history, so staging its
source path fails:

```
chat-delete: trash commit failed after transcript deletion
GitCommandError: fatal: pathspec '_content/chat/web/<date>_<id>.chat.card' did not match any files
```

(`beebox/src/core/chat/session/delete/apply/husks.ts:114-121`.) The card is
left untracked in `_bookkeeping/trash/`.

## Decision (boxholder, 2026-10-06)

Deleting a chat is permanent. The chat card does not go to Trash:

- If the card was committed, delete it with a commit (`git rm`), not a move.
- If it was never committed, delete the file; there is nothing to commit for it.
- The confirm dialog already says "Delete permanently"; the result and the
  cleanup/retry messages must stop mentioning Trash.

Git history still holds earlier commits of a committed card; "permanent" here
means gone from the box's working tree and not recoverable from Trash. Say
that accurately in the dialog if it currently implies more.

`bbx rm` (general card trashing) keeps its Trash behavior, but its commit has
the same source-path bug for a never-committed card: fix
`commitTrashReceipt` so an untracked source does not break the commit.
