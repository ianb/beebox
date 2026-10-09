---
title: "A reloaded new chat is labelled \"Conversation\" instead of \"New conversation\""
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending journey walk, 2026-10-09
---

Start a new chat and reload the page. The chat chip changes from "New
conversation" to "Conversation", while the opener buttons stay, because the
chat is still unstarted. Reproduced in a browser session during the A-lending
walk; the walker saw a related change after a reload without a clear cause.

This is the residual that the closed
[conversation-keeps-placeholder-title](../closed/bugs/2026-10-08-conversation-keeps-placeholder-title.md)
named: "Not changed: the label still reads 'New conversation' (and, during a
fresh chat's first turn, sometimes 'Conversation') until the title arrives."

## Mechanism

`restoreTarget` labels a fresh start "New conversation"
(`beebox/src/frontend/src/components/chat/everywhere/resolve-conversation.ts:95-98`).
After a reload the chat resolves as `resumed`, which labels an untitled session
"Conversation" (`resolve-conversation.ts:103`) even when the same function marks
it `unstarted`. The two labels name one state.

## Why the fix is not obvious

It is a small change: use "New conversation" when `unstarted` is true and the
session has no title. A chat that has history but no title yet (the title run
failed or has not finished) is a different state. It should not read as new, and
its right label is open. See the first-turn gap in the closed issue.

Report: [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) R7.
