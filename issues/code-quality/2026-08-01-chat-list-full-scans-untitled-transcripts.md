---
title: "Chat list full-streams every untitled transcript on the request path"
workstream: chat-history-scale
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

## Fixed (2026-08-25)

`loadAllSessions` (`callback-box/src/core/chat/session/list.ts`) now resolves
labels through `labelFor`, which memoizes the transcript-derived label in an
in-process Map keyed by (transcript path, transcript mtime). A re-listing
rescans only the transcripts that changed since the last one. The Map is bounded
at 2000 entries with oldest-first eviction, so a long-lived server cannot
accumulate one entry per chat it has ever listed. Titled chats and Codex
previews never reach the cache — their labels cost no I/O.

Chosen over the issue's "persist it in `chat-session-history.json` or a sidecar":
the memo needs no new on-disk format or invalidation rules, and a cold process
pays the scan once. Persistence stays available if the cold-start cost matters.
