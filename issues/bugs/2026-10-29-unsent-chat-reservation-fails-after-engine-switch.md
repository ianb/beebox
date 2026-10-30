---
title: "An unsent chat reserved before an engine switch fails to restore with \"claude is not enabled for this box\""
workstream: unattached
area: beebox
labels: [chat, engines]
filed-by: agent
discovered-by: agent
discovered-in: "pi-engine worktree — in-app test after switching test1 from Claude to pi, 2026-10-29"
---

The chat page reserves a Claude session id before the first message and keeps
a receipt for it in the browser. When the box's default engine then changes
and Claude is no longer enabled, opening that chat replays the receipt
(`components/chat/everywhere/reservation-recovery.ts`). The server refuses it
(`webapp/trpc/routers/chat/control-procedures.ts`, `reserveSession`: *"claude
is not enabled for this box"*). The page shows "This conversation has no saved
transcript in this box" with Retry and Start new conversation, and keeps the
typed text in the composer.

Seen on a switch from Claude to pi. A switch from Claude to Codex with Claude
turned off takes the same path.

The tension: the receipt records an engine choice the box no longer allows.
Restoring it as a Claude chat is refused; dropping it silently loses the
person's place. "Start new conversation" recovers, but the message names
nothing about the engine change.
