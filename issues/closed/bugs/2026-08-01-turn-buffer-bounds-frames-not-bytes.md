---
title: "TurnBuffer bounds frame count, not bytes — heavy turns hold arbitrary memory"
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — post-fix sweep
resolution: implemented
---

Resolved by `5147906d`. `TurnBuffer` now tracks serialized UTF-8 payload bytes
as frames arrive and evicts the oldest frames when either the 4,000-frame cap or
the 8 MiB byte cap is exceeded.

`callback-box/src/core/chat/turn-buffer.ts` caps a turn's replay buffer at
`MAX_FRAMES = 4000`, but each frame holds a whole `ChatMessage` — a turn heavy
on `tool_use` inputs (full `Write` bodies) or image blocks makes those 4000
frames arbitrarily large. Multiplied by N concurrent turns, and held for
`FINISHED_TTL_MS` (60 s) after a turn completes. Request path
(`chat.turnStream` resumable subscription) on `cb serve`.

Same allocation class as the 2026-08-01 OOM (bounded-count, unbounded-bytes —
sibling of [[2026-08-01-session-retention-counts-entries-not-bytes]]).

Fix shape: add a byte budget alongside `MAX_FRAMES` and evict on whichever
trips first.
