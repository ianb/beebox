---
title: "chat-session-history.json is re-read and re-parsed O(n) times per lookup"
workstream: chat-history-scale
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — post-fix sweep
---

`readHistoryFile` (`callback-box/src/core/chat/session/history.ts`) reads and
`JSON.parse`s the whole session-history file on every call, and
`getLastSessionForDirectory` calls `resolveSessionLogPath` (→
`loadHistoryEntries` → `readHistoryFile`) per entry inside a loop — O(n) full
reads + n full parses per landmark "Chat" click. The file grows one entry per
web-chat session ever created and is never pruned, so this gets quadratically
slower with age. Also re-read on every `transcript-sync` poll. Cost is CPU/IO
on the request path, not resident memory (entries are small).

Fix shape: hoist `loadHistoryEntries` out of the `getLastSessionForDirectory`
loop; add a short-TTL or mtime-keyed in-process cache in `readHistoryFile`;
consider pruning/rotation for the file itself.

## Fixed (2026-08-25)

`sessionLogPathFor(boxRoot, entry)` (`callback-box/src/core/chat/session/history.ts`)
is the pure resolution for an entry the caller already holds.
`getLastSessionForDirectory` uses it in its loop, so a landmark "Chat" click no
longer re-reads and re-parses the whole history file once per iterated entry;
`resolveSessionLogPath` resolves through the same helper. No cache was added —
the per-lookup read remains, only the O(n) amplification is gone. Covered by
`callback-box/test/core/chat-session-history.doctest.md`.

Still open: the per-call `readHistoryFile` read (including on every
`transcript-sync` poll), and pruning/rotation of the file itself.
