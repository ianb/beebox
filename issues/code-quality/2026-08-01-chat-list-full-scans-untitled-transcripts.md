---
title: "Chat list full-streams every untitled transcript on the request path"
workstream: chat-history-oom-mobile-lock
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — post-fix sweep
---

`loadAllSessions` (`callback-box/src/core/chat/session/list.ts`) runs
`getSessionMetadata` — a full streaming scan of the transcript — for every
session that has no stored title, on the chat-list request path. Memory-safe
(the fold retains only scalars) but IO/latency scales with the total bytes of
all untitled transcripts; a box with a few large untitled sessions pays
seconds per chat-list render.

Fix shape: persist the derived metadata (first-line title, counts, mtime) in
`chat-session-history.json` (or a sidecar) keyed by transcript mtime, so the
scan runs once per transcript change instead of once per request.
