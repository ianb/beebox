---
title: "A new chat's accepted first message is invisible after a box restart before the transcript is written"
workstream: unattached
needs: [decision]
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-direct-chat-load — cross-model review of the direct chat load change
---

The box accepts a new chat's first message, and then restarts before the agent writes a transcript. The message is then on no page the person can reach.

## Sequence

1. A coined Claude chat sends its first message. `POST /api/chat/send` records it on the event bus and answers 200. The client retires the reservation receipt (`use-bound-emission/hook.tsx`, `reservation-after-send.ts`).
2. The box restarts (deploy) before the agent writes the transcript. The reservation is in memory and is lost. The durable claim only deduplicates; it does not re-deliver (`webapp/routes/chat/send-dedup.ts`).
3. On reload, `chat.bootstrap` for that id answers `unavailable` / `missing-local-transcript`. Its `pending` field still carries the accepted message (`readAcceptedMessages`, `core/chat/session/accepted-messages.ts`), later marked undelivered.
4. The page resolves to a new chat (`resolve-conversation.ts`, since direct-chat-load). Before that change it showed "This conversation has no saved transcript in this box." Neither version renders `pending`, so the message is not shown.

## Decision needed

Where an accepted-but-undelivered message for a session that no longer exists should appear: in the replacement chat (as a saved message like `FailedConversationSends`), on the dead session's page, or nowhere (rare enough to accept).
